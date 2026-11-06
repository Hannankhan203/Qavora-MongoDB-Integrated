import test from 'node:test';
import assert from 'node:assert/strict';
import {
  queueChecklistCreate,
  queueChecklistUpdate,
  queueChecklistDelete,
  getPendingOperations,
  clearAllOfflineData
} from '../qaChecklistSyncQueue.js';

test('IndexedDB offline sync queue persists and isolates operations per user', async () => {
  await clearAllOfflineData();

  const userA = 'user_a_test';
  const userB = 'user_b_test';

  await queueChecklistCreate({ id: 'chk_a1', title: 'Checklist A1', phases: [] }, userA);
  await queueChecklistUpdate({ id: 'chk_a1', title: 'Checklist A1 Updated', phases: [] }, userA);
  await queueChecklistDelete('chk_b1', userB);

  const opsA = await getPendingOperations(userA);
  const opsB = await getPendingOperations(userB);

  assert.equal(opsA.length, 1);
  assert.equal(opsA[0].type, 'CREATE');
  assert.equal(opsA[0].payload.title, 'Checklist A1 Updated');
  assert.equal(opsB.length, 1);
  assert.equal(opsB[0].type, 'DELETE');

  await clearAllOfflineData();
});

test('processChecklistSyncQueue coordinates concurrent tabs via Web Locks API', async () => {
  const { processChecklistSyncQueue } = await import('../qaChecklistSyncQueue.js');
  const { authController } = await import('../authController.js');

  const origGetUser = authController.getUser;
  const origNavigator = globalThis.navigator;
  const heldLocks = new Set();

  authController.getUser = () => ({ userId: 'user_lock_test' });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        async request(name, options, callback) {
          if (options?.ifAvailable && heldLocks.has(name)) {
            return callback(null);
          }
          heldLocks.add(name);
          try {
            return await callback({ name });
          } finally {
            heldLocks.delete(name);
          }
        }
      }
    }
  });

  try {
    // Simulate lock already held by another tab
    heldLocks.add('qavora_sync_user_lock_test');
    const blocked = await processChecklistSyncQueue('user_lock_test');
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'Sync in progress');

    // Release lock and verify sync succeeds
    heldLocks.delete('qavora_sync_user_lock_test');
    const allowed = await processChecklistSyncQueue('user_lock_test');
    assert.equal(allowed.ok, true);
    assert.equal(heldLocks.has('qavora_sync_user_lock_test'), false);
  } finally {
    authController.getUser = origGetUser;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: origNavigator
    });
  }
});

test('IndexedDB fallback lease/lock prevents cross-tab contention, isolates users, and recovers expired locks', async () => {
  const {
    acquireIndexedDbSyncLock,
    renewIndexedDbSyncLock,
    verifyIndexedDbSyncLock,
    releaseIndexedDbSyncLock,
    processChecklistSyncQueue
  } = await import('../qaChecklistSyncQueue.js');
  const { authController } = await import('../authController.js');

  const lockKeyA = 'qavora_sync_user_a';
  const lockKeyB = 'qavora_sync_user_b';

  // Tab 1 acquires lock for User A; Tab 2 is blocked
  const lock1 = await acquireIndexedDbSyncLock(lockKeyA, 'tab_1', 10000);
  assert.equal(lock1.acquired, true);
  assert.equal(lock1.generation, 1);

  const lock2Blocked = await acquireIndexedDbSyncLock(lockKeyA, 'tab_2', 10000);
  assert.equal(lock2Blocked.acquired, false);

  // Lease renewal succeeds for valid owner + generation, fails for wrong owner/generation
  assert.equal(await renewIndexedDbSyncLock(lockKeyA, 'tab_1', lock1.generation, 10000), true);
  assert.equal(await renewIndexedDbSyncLock(lockKeyA, 'tab_2', lock1.generation, 10000), false);
  assert.equal(await renewIndexedDbSyncLock(lockKeyA, 'tab_1', 999, 10000), false);

  // Different user (User B) can acquire their own lock independently
  const lockB = await acquireIndexedDbSyncLock(lockKeyB, 'tab_2', 10000);
  assert.equal(lockB.acquired, true);

  // Tab 2 cannot release Tab 1's lock
  await releaseIndexedDbSyncLock(lockKeyA, 'tab_2', lock1.generation);
  assert.equal(await verifyIndexedDbSyncLock(lockKeyA, 'tab_1', lock1.generation), true);

  // Tab 1 releases lock; Tab 2 can now acquire it with incremented generation
  await releaseIndexedDbSyncLock(lockKeyA, 'tab_1', lock1.generation);
  const lock2 = await acquireIndexedDbSyncLock(lockKeyA, 'tab_2', 10000);
  assert.equal(lock2.acquired, true);
  assert.equal(lock2.generation, 2);
  await releaseIndexedDbSyncLock(lockKeyA, 'tab_2', lock2.generation);
  await releaseIndexedDbSyncLock(lockKeyB, 'tab_2', lockB.generation);

  // Expired lock recovery & stale-owner protection
  const crashedLock = await acquireIndexedDbSyncLock(lockKeyA, 'crashed_tab', 1);
  assert.equal(crashedLock.acquired, true);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(await verifyIndexedDbSyncLock(lockKeyA, 'crashed_tab', crashedLock.generation), false);

  const recoveryLock = await acquireIndexedDbSyncLock(lockKeyA, 'recovery_tab', 10000);
  assert.equal(recoveryLock.acquired, true);
  assert.ok(recoveryLock.generation > crashedLock.generation);

  // Old owner cannot release newer owner's lock
  await releaseIndexedDbSyncLock(lockKeyA, 'crashed_tab', crashedLock.generation);
  assert.equal(await verifyIndexedDbSyncLock(lockKeyA, 'recovery_tab', recoveryLock.generation), true);

  // processChecklistSyncQueue respects held fallback lock when navigator.locks is unavailable
  const origGetUser = authController.getUser;
  authController.getUser = () => ({ userId: 'user_a' });
  try {
    const blocked = await processChecklistSyncQueue('user_a');
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'Sync in progress');
  } finally {
    authController.getUser = origGetUser;
    await releaseIndexedDbSyncLock(lockKeyA, 'recovery_tab', recoveryLock.generation);
  }
});

test('dequeueOperationIfLockValid atomically rejects stale/wrong owners and deletes only for active owner', async () => {
  const {
    queueChecklistCreate,
    getPendingOperations,
    acquireIndexedDbSyncLock,
    releaseIndexedDbSyncLock,
    dequeueOperationIfLockValid
  } = await import('../qaChecklistSyncQueue.js');

  const userId = 'atomic_user_1';
  const lockKey = `qavora_sync_${userId}`;
  await queueChecklistCreate({ id: 'chk_atomic_1', title: 'Atomic Test', phases: [] }, userId);
  const [op] = await getPendingOperations(userId);

  const lock1 = await acquireIndexedDbSyncLock(lockKey, 'tab_1', 10000);
  assert.equal(lock1.acquired, true);

  // Wrong owner or wrong generation cannot delete
  assert.equal(await dequeueOperationIfLockValid(op.id, lockKey, 'tab_2', lock1.generation), false);
  assert.equal(await dequeueOperationIfLockValid(op.id, lockKey, 'tab_1', lock1.generation + 99), false);
  assert.equal((await getPendingOperations(userId)).length, 1);

  // Valid owner + generation deletes atomically
  assert.equal(await dequeueOperationIfLockValid(op.id, lockKey, 'tab_1', lock1.generation), true);
  assert.equal((await getPendingOperations(userId)).length, 0);

  await releaseIndexedDbSyncLock(lockKey, 'tab_1', lock1.generation);
});

test('QAV-AUDIT-002: reconcileChecklistUpdate preserves newer server data while merging client changes', async () => {
  const { reconcileChecklistUpdate } = await import('../qaChecklistSyncQueue.js');

  const serverDoc = {
    id: 'chk_rec_1',
    title: 'Newer Server Title',
    updatedAt: '2026-11-06T12:00:00.000Z',
    documentNotes: [{ text: 'Server note 1' }],
    phases: [
      {
        id: 'phase_1',
        name: 'Smoke',
        sections: [
          {
            id: 'sec_1',
            name: 'Login',
            tests: [
              { id: 't1', text: 'Login with email', status: 'Passed', completed: true },
              { id: 't2', text: 'Login with SSO', status: 'Not Started', completed: false }
            ]
          }
        ]
      }
    ]
  };

  const clientPayload = {
    title: 'Client Changed Title',
    documentNotes: [{ text: 'Client note 2' }],
    phases: [
      {
        id: 'phase_1',
        name: 'Smoke',
        sections: [
          {
            id: 'sec_1',
            name: 'Login',
            tests: [
              // Client marked t2 as passed while t1 was passed on server
              { id: 't2', text: 'Login with SSO', status: 'Passed', completed: true, notes: 'Passed in 12ms' }
            ]
          },
          {
            id: 'sec_2',
            name: 'New Client Section',
            tests: [{ id: 't3', text: 'Forgot password', status: 'Passed', completed: true }]
          }
        ]
      }
    ]
  };

  const reconciled = reconcileChecklistUpdate(clientPayload, serverDoc);
  assert.ok(reconciled);

  // 1. Preserves newer server title
  assert.equal(reconciled.title, 'Newer Server Title');

  // 2. Merges document notes
  assert.equal(reconciled.documentNotes.length, 2);

  // 3. Merges test cases without losing server test t1 or client test t2
  const smokePhase = reconciled.phases.find(p => p.id === 'phase_1');
  assert.ok(smokePhase);
  const sec1 = smokePhase.sections.find(s => s.id === 'sec_1');
  const t1 = sec1.tests.find(t => t.id === 't1');
  const t2 = sec1.tests.find(t => t.id === 't2');
  assert.equal(t1.status, 'Passed', 'Server test t1 is preserved');
  assert.equal(t2.status, 'Passed', 'Client test t2 is merged');
  assert.equal(t2.notes, 'Passed in 12ms');

  // 4. Preserves client newly added section sec_2
  const sec2 = smokePhase.sections.find(s => s.id === 'sec_2');
  assert.ok(sec2, 'Client added section sec_2 must be preserved');

  // 5. Invalid inputs return null safely
  assert.equal(reconcileChecklistUpdate(null, serverDoc), null);
  assert.equal(reconcileChecklistUpdate(clientPayload, null), null);
});

test('QAV-AUDIT-002: processChecklistSyncQueue handles HTTP 409 conflict, reconciles, and retries with updated expectedUpdatedAt', async () => {
  const {
    clearAllOfflineData,
    queueChecklistUpdate,
    getPendingOperations,
    processChecklistSyncQueue
  } = await import('../qaChecklistSyncQueue.js');
  const { ChecklistAPI } = await import('../qaChecklistStore.js');
  const { authController } = await import('../authController.js');

  await clearAllOfflineData();

  const userId = 'sync_occ_user';
  const origGetUser = authController.getUser;
  authController.getUser = () => ({ userId });

  const origUpdate = ChecklistAPI.update;
  const origGet = ChecklistAPI.get;

  let updateCalls = [];
  let getCalls = [];

  const serverState = {
    id: 'chk_occ_sync_1',
    title: 'Server Authoritative Title',
    updatedAt: '2026-11-06T15:00:00.000Z',
    phases: []
  };

  ChecklistAPI.update = async (id, payload) => {
    updateCalls.push({ id, payload: JSON.parse(JSON.stringify(payload)) });
    if (updateCalls.length === 1) {
      // First attempt fails with 409 Conflict due to stale expectedUpdatedAt
      return { ok: false, status: 409, error: 'Conflict: Stale version' };
    }
    // Second attempt (after reconciliation) succeeds
    return { ok: true, status: 200, data: { ...payload, id, updatedAt: '2026-11-06T15:05:00.000Z' } };
  };

  ChecklistAPI.get = async (id) => {
    getCalls.push(id);
    return { ok: true, status: 200, data: serverState };
  };

  try {
    // Queue update with old expectedUpdatedAt
    await queueChecklistUpdate({
      id: 'chk_occ_sync_1',
      title: 'Client Title',
      phases: [],
      expectedUpdatedAt: '2026-11-06T10:00:00.000Z'
    }, userId);

    const pendingBefore = await getPendingOperations(userId);
    assert.equal(pendingBefore.length, 1);
    assert.equal(pendingBefore[0].expectedUpdatedAt, '2026-11-06T10:00:00.000Z');

    // Process sync queue
    const syncRes = await processChecklistSyncQueue(userId);
    assert.equal(syncRes.ok, true);
    assert.equal(syncRes.syncedCount, 1);

    // Verify 2 update calls occurred: first with stale version, second with reconciled version
    assert.equal(updateCalls.length, 2);
    assert.equal(updateCalls[0].payload.expectedUpdatedAt, '2026-11-06T10:00:00.000Z');
    assert.equal(getCalls.length, 1);
    assert.equal(updateCalls[1].payload.expectedUpdatedAt, '2026-11-06T15:00:00.000Z');

    // Operation was successfully dequeued after reconciliation and retry
    const pendingAfter = await getPendingOperations(userId);
    assert.equal(pendingAfter.length, 0);
  } finally {
    ChecklistAPI.update = origUpdate;
    ChecklistAPI.get = origGet;
    authController.getUser = origGetUser;
    await clearAllOfflineData();
  }
});

test('QAV-AUDIT-002: processChecklistSyncQueue preserves operation in queue when 409 reconciliation fails', async () => {
  const {
    clearAllOfflineData,
    queueChecklistUpdate,
    getPendingOperations,
    processChecklistSyncQueue
  } = await import('../qaChecklistSyncQueue.js');
  const { ChecklistAPI } = await import('../qaChecklistStore.js');
  const { authController } = await import('../authController.js');

  await clearAllOfflineData();

  const userId = 'sync_occ_fail_user';
  const origGetUser = authController.getUser;
  authController.getUser = () => ({ userId });

  const origUpdate = ChecklistAPI.update;
  const origGet = ChecklistAPI.get;

  ChecklistAPI.update = async () => {
    return { ok: false, status: 409, error: 'Conflict: Stale version' };
  };

  // Simulate network failure when trying to fetch server state for reconciliation
  ChecklistAPI.get = async () => {
    return { ok: false, status: 503, error: 'Failed to contact server' };
  };

  try {
    await queueChecklistUpdate({
      id: 'chk_occ_fail_1',
      title: 'Client Pending Title',
      phases: [],
      expectedUpdatedAt: '2026-11-06T08:00:00.000Z'
    }, userId);

    const syncRes = await processChecklistSyncQueue(userId);
    // Queue processor stops gracefully and reports syncedCount 0
    assert.equal(syncRes.syncedCount, 0);

    // Queue operation MUST be retained with status 'pending' and original expectedUpdatedAt preserved across retries
    const pendingAfter = await getPendingOperations(userId);
    assert.equal(pendingAfter.length, 1);
    assert.equal(pendingAfter[0].status, 'pending');
    assert.equal(pendingAfter[0].expectedUpdatedAt, '2026-11-06T08:00:00.000Z');
    assert.ok(pendingAfter[0].lastError.includes('Conflict'));
    assert.equal(pendingAfter[0].retryCount, 1);
  } finally {
    ChecklistAPI.update = origUpdate;
    ChecklistAPI.get = origGet;
    authController.getUser = origGetUser;
    await clearAllOfflineData();
  }
});

