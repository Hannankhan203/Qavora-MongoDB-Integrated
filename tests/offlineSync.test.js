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

