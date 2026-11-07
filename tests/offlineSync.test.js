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

// ==========================================================================
// QAV-OFFLINE-001 — Formal Project Mutations Offline Support Tests (15 Scenarios)
// ==========================================================================

test('QAV-OFFLINE-001 (1, 2, 3): Creating, updating, and deleting projects while offline', async () => {
  const {
    clearAllOfflineData,
    setOfflineModeForTesting,
    getPendingProjectOperations,
    getCachedProjectById
  } = await import('../qaChecklistSyncQueue.js');
  const {
    createProject,
    updateProjectMetadata,
    deleteProjectById
  } = await import('../src/modules/projectManager.js');
  const { getProjects, setProjects, setActiveProjectId } = await import('../src/modules/state.js');
  const { authController } = await import('../authController.js');

  await clearAllOfflineData();
  const userId = 'offline_proj_user_1';
  const origGetUser = authController.getUser;
  authController.getUser = () => ({ userId });
  setOfflineModeForTesting(true);
  setProjects([]);
  setActiveProjectId(null);

  try {
    // 1. Create project while offline
    const createRes = await createProject({
      name: 'Offline Checkout Engine',
      description: 'Created without internet',
      type: 'E-Commerce',
      version: '2.0.0'
    });
    assert.equal(createRes.ok, true);
    assert.equal(createRes.offline, true);
    assert.equal(createRes.queued, true);
    const created = createRes.project;
    assert.ok(created);
    assert.equal(created.name, 'Offline Checkout Engine');
    assert.equal(getProjects().length, 1);

    let ops = await getPendingProjectOperations(userId);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].entityType, 'project');
    assert.equal(ops[0].operationType, 'CREATE');
    assert.equal(ops[0].projectId, created.id);

    // 2. Update project metadata and status while offline (coalesces into pending CREATE payload)
    const updateRes = await updateProjectMetadata(created.id, {
      name: 'Offline Checkout Engine v2',
      status: 'Completed',
      version: '2.1.0'
    });
    assert.equal(updateRes.ok, true);
    assert.equal(updateRes.project.name, 'Offline Checkout Engine v2');
    assert.equal(updateRes.project.status, 'Completed');

    ops = await getPendingProjectOperations(userId);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].operationType, 'CREATE');
    const coalescedProj = ops[0].payload.project || ops[0].payload;
    assert.equal(coalescedProj.name, 'Offline Checkout Engine v2');
    assert.equal(coalescedProj.status, 'Completed');

    const cached = await getCachedProjectById(created.id, userId);
    assert.ok(cached);
    assert.equal(cached.name, 'Offline Checkout Engine v2');

    // 3. Delete offline-created project before sync removes all pending ops for that project
    const deleteRes = await deleteProjectById(created.id);
    assert.equal(deleteRes.ok, true);
    assert.equal(getProjects().length, 0);
    ops = await getPendingProjectOperations(userId);
    assert.equal(ops.length, 0);

    // Also test deleting a previously synced project while offline queues a DELETE operation
    const syncedProj = {
      id: 'proj_synced_del_1',
      name: 'Server Synced Project',
      status: 'Active',
      updatedAt: '2026-11-06T12:00:00.000Z',
      testSuites: [],
      executions: [],
      defects: []
    };
    setProjects([syncedProj]);
    const delSyncedRes = await deleteProjectById(syncedProj.id);
    assert.equal(delSyncedRes.ok, true);
    ops = await getPendingProjectOperations(userId);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].operationType, 'DELETE');
    assert.equal(ops[0].entityId, 'proj_synced_del_1');
  } finally {
    setOfflineModeForTesting(false);
    authController.getUser = origGetUser;
    await clearAllOfflineData();
  }
});

test('QAV-OFFLINE-001 (4, 5, 6): Creating and updating suites, test cases, executions, and defects offline', async () => {
  const {
    clearAllOfflineData,
    setOfflineModeForTesting,
    getPendingProjectOperations,
    getCachedProjectById
  } = await import('../qaChecklistSyncQueue.js');
  const { createProject } = await import('../src/modules/projectManager.js');
  const { saveTestSuite, saveTestCase } = await import('../src/modules/testPlanManager.js');
  const { startExecutionRun, saveExecutionResult, completeExecutionRun } = await import('../src/modules/executionManager.js');
  const { saveDefect, updateDefectQuickStatus } = await import('../src/modules/defectManager.js');
  const { setProjects, setActiveProjectId } = await import('../src/modules/state.js');
  const { authController } = await import('../authController.js');

  await clearAllOfflineData();
  const userId = 'offline_domain_user_1';
  const origGetUser = authController.getUser;
  authController.getUser = () => ({ userId });
  setOfflineModeForTesting(true);
  setProjects([]);
  setActiveProjectId(null);

  try {
    const createRes = await createProject({
      name: 'Domain Offline Suite Project',
      description: 'Testing suites, cases, executions, defects offline',
      type: 'Web Application'
    });
    const proj = createRes.project;
    setActiveProjectId(proj.id);

    // 4. Create & update test suite and test case offline
    const suiteRes = await saveTestSuite({
      name: 'Authentication Suite',
      category: 'Security',
      description: 'Offline auth verification'
    });
    assert.equal(suiteRes.ok, true);
    const suite = suiteRes.suite;
    assert.ok(suite);
    assert.equal(suite.name, 'Authentication Suite');

    const updatedSuiteRes = await saveTestSuite({
      id: suite.id,
      name: 'Authentication & MFA Suite',
      category: 'Security',
      description: 'Updated offline'
    });
    assert.equal(updatedSuiteRes.ok, true);
    assert.equal(updatedSuiteRes.suite.name, 'Authentication & MFA Suite');

    const tcRes = await saveTestCase(suite.id, {
      testCaseId: 'TC-OFF-001',
      title: 'Verify Offline Login Session',
      priority: 'Critical',
      category: 'Security',
      steps: [{ action: 'Submit credentials', expectedResult: 'Dashboard loads' }]
    });
    assert.equal(tcRes.ok, true);
    const tc = tcRes.testCase;
    assert.ok(tc);
    assert.equal(tc.title, 'Verify Offline Login Session');

    // 5. Start run, submit test execution outcome, and complete run offline
    const runRes = await startExecutionRun({
      name: 'Sprint 14 Offline Run',
      environment: 'Staging',
      buildVersion: 'v1.4.0',
      notes: 'Offline regression pass'
    });
    assert.equal(runRes.ok, true);
    assert.equal(runRes.activeRun.name, 'Sprint 14 Offline Run');

    const execRes = await saveExecutionResult({
      caseId: tc.id,
      testCaseId: tc.id,
      suiteId: suite.id,
      status: 'Fail',
      tester: 'QA Offline Engineer',
      environment: 'Staging',
      actualResult: 'Token refresh failed while offline',
      notes: 'Logged defect offline'
    });
    assert.equal(execRes.ok, true);
    const execRecord = execRes.execution;
    assert.ok(execRecord);
    assert.equal(execRecord.status, 'Fail');

    const completedRunRes = await completeExecutionRun();
    assert.equal(completedRunRes.ok, true);
    assert.equal(completedRunRes.executionRun.status, 'Completed');

    // 6. Create and update defect offline
    const defectRes = await saveDefect({
      title: 'Auth token refresh fails in Staging',
      severity: 'Critical',
      priority: 'High',
      status: 'Open',
      linkedTestCaseId: tc.id,
      steps: '1. Go offline\n2. Attempt token refresh',
      expectedResult: 'Queue mutation',
      actualResult: 'Error thrown'
    });
    assert.equal(defectRes.ok, true);
    const defect = defectRes.defect;
    assert.ok(defect);
    assert.equal(defect.title, 'Auth token refresh fails in Staging');

    const updatedDefectRes = await updateDefectQuickStatus(defect.id, 'In Progress');
    assert.equal(updatedDefectRes.ok, true);
    assert.equal(updatedDefectRes.defect.status, 'In Progress');

    // Verify all entities are persisted in IndexedDB project cache
    const cachedProj = await getCachedProjectById(proj.id, userId);
    assert.ok(cachedProj);
    assert.equal(cachedProj.testSuites.length, 1);
    assert.equal(cachedProj.testSuites[0].name, 'Authentication & MFA Suite');
    assert.equal(cachedProj.testSuites[0].cases.length, 1);
    assert.equal(cachedProj.executions.length, 1);
    assert.equal(cachedProj.executionRuns.length, 1);
    assert.equal(cachedProj.defects.length, 1);
    assert.equal(cachedProj.defects[0].status, 'In Progress');

    const pendingOps = await getPendingProjectOperations(userId);
    assert.ok(pendingOps.length >= 1);
  } finally {
    setOfflineModeForTesting(false);
    authController.getUser = origGetUser;
    await clearAllOfflineData();
  }
});

test('QAV-OFFLINE-001 (7): Persistence after page refresh restores offline projects and pending mutations', async () => {
  const {
    clearAllOfflineData,
    setOfflineModeForTesting,
    queueProjectMutation,
    cacheProjectsListOffline
  } = await import('../qaChecklistSyncQueue.js');
  const { loadProjectsFromBackend } = await import('../src/modules/projectManager.js');
  const { getProjects, setProjects } = await import('../src/modules/state.js');
  const { authController } = await import('../authController.js');

  await clearAllOfflineData();
  const userId = 'refresh_persist_user';
  const origGetUser = authController.getUser;
  authController.getUser = () => ({ userId });

  const baseServerProject = {
    id: 'proj_refresh_1',
    name: 'Server Base Project',
    description: 'Initial state',
    status: 'Active',
    updatedAt: '2026-11-06T09:00:00.000Z',
    testSuites: [],
    executions: [],
    defects: []
  };

  await cacheProjectsListOffline([baseServerProject], userId);
  await queueProjectMutation({
    projectId: 'proj_refresh_1',
    entityType: 'suite',
    entityId: 'suite_persisted_1',
    operationType: 'CREATE',
    expectedUpdatedAt: '2026-11-06T09:00:00.000Z',
    payload: {
      delta: {
        suite: {
          id: 'suite_persisted_1',
          name: 'Suite Created Before Page Reload',
          cases: []
        }
      }
    }
  }, userId);

  // Simulate page reload while offline
  setProjects([]);
  setOfflineModeForTesting(true);

  try {
    const loadRes = await loadProjectsFromBackend();
    assert.equal(loadRes.ok, true);
    assert.equal(loadRes.offline, true);
    const loaded = getProjects();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, 'proj_refresh_1');
    assert.equal(loaded[0]._hasPendingOfflineMutations, true);
    assert.equal(loaded[0].testSuites.length, 1);
    assert.equal(loaded[0].testSuites[0].name, 'Suite Created Before Page Reload');
  } finally {
    setOfflineModeForTesting(false);
    authController.getUser = origGetUser;
    await clearAllOfflineData();
  }
});

test('QAV-OFFLINE-001 (8, 9, 10): Dependency ordering, automatic sync on reconnect, and duplicate submission prevention', async () => {
  const {
    clearAllOfflineData,
    queueProjectMutation,
    getPendingProjectOperations,
    processProjectSyncQueue,
    sortProjectOperationsByDependency
  } = await import('../qaChecklistSyncQueue.js');
  const { authController } = await import('../authController.js');

  await clearAllOfflineData();
  const userId = 'dep_order_user';
  const origGetUser = authController.getUser;
  authController.getUser = () => ({ userId });

  const projectId = 'proj_dep_100';

  // 10. Verify dependency sorter puts Project CREATE -> Suite CREATE -> TestCase CREATE -> Execution CREATE -> Defect CREATE
  const unsorted = [
    { id: 'op_def', seq: 5, projectId, entityType: 'defect', operationType: 'CREATE' },
    { id: 'op_exec', seq: 4, projectId, entityType: 'execution', operationType: 'CREATE' },
    { id: 'op_tc', seq: 3, projectId, entityType: 'testCase', operationType: 'CREATE' },
    { id: 'op_suite', seq: 2, projectId, entityType: 'suite', operationType: 'CREATE' },
    { id: 'op_proj', seq: 1, projectId, entityType: 'project', operationType: 'CREATE' }
  ];
  const sorted = sortProjectOperationsByDependency(unsorted);
  assert.deepEqual(
    sorted.map((o) => o.entityType),
    ['project', 'suite', 'testCase', 'execution', 'defect']
  );

  // Queue Project CREATE followed by Suite CREATE and Defect CREATE
  await queueProjectMutation({
    id: 'op_unique_proj_create',
    idempotencyKey: 'idem_proj_100',
    projectId,
    entityType: 'project',
    entityId: projectId,
    operationType: 'CREATE',
    payload: {
      project: {
        id: projectId,
        name: 'Ordered Sync Project',
        type: 'Web Application',
        status: 'Active',
        testSuites: [],
        executions: [],
        defects: []
      }
    }
  }, userId);

  // 9. Duplicate submission with identical idempotencyKey returns existing op without duplicating
  const dupAttempt = await queueProjectMutation({
    idempotencyKey: 'idem_proj_100',
    projectId,
    entityType: 'project',
    entityId: projectId,
    operationType: 'CREATE',
    payload: { project: { id: projectId, name: 'Ordered Sync Project' } }
  }, userId);
  assert.equal(dupAttempt.id, 'op_unique_proj_create');

  await queueProjectMutation({
    projectId,
    entityType: 'suite',
    entityId: 'suite_ord_1',
    operationType: 'CREATE',
    expectedUpdatedAt: '2026-11-06T10:00:00.000Z',
    payload: {
      delta: {
        suite: { id: 'suite_ord_1', name: 'Ordered Suite 1', cases: [] }
      }
    }
  }, userId);

  await queueProjectMutation({
    projectId,
    entityType: 'defect',
    entityId: 'def_ord_1',
    operationType: 'CREATE',
    expectedUpdatedAt: '2026-11-06T10:00:00.000Z',
    payload: {
      delta: {
        defect: { id: 'def_ord_1', title: 'Ordered Defect 1', status: 'Open' }
      }
    }
  }, userId);

  const opsBeforeSync = await getPendingProjectOperations(userId);
  assert.equal(opsBeforeSync.length, 3);

  const apiCalls = [];
  let patchCounter = 0;

  const mockTransport = async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : null;
    apiCalls.push({ method, url, body });

    if (method === 'POST' && url === '/api/projects') {
      return {
        ok: true,
        status: 201,
        data: { ...body, updatedAt: '2026-11-06T11:00:00.000Z' }
      };
    }

    if (method === 'PATCH') {
      patchCounter += 1;
      return {
        ok: true,
        status: 200,
        data: {
          id: projectId,
          ...body,
          updatedAt: `2026-11-06T11:0${patchCounter}:00.000Z`
        }
      };
    }

    return { ok: true, status: 200, data: {} };
  };

  try {
    // 8 & 9. Trigger two concurrent sync calls to verify Web Lock / mutex prevents duplicate submissions
    const [res1, res2] = await Promise.all([
      processProjectSyncQueue(userId, { transport: mockTransport }),
      processProjectSyncQueue(userId, { transport: mockTransport })
    ]);

    const totalSynced = (res1.syncedCount || 0) + (res2.syncedCount || 0);
    assert.equal(totalSynced, 3);
    assert.equal(apiCalls.length, 3);

    // 1st call: POST /api/projects
    assert.equal(apiCalls[0].method, 'POST');
    assert.equal(apiCalls[0].url, '/api/projects');

    // 2nd call: PATCH /api/projects/proj_dep_100/data with expectedUpdatedAt advanced from POST response
    assert.equal(apiCalls[1].method, 'PATCH');
    assert.equal(apiCalls[1].body.expectedUpdatedAt, '2026-11-06T11:00:00.000Z');
    assert.equal(apiCalls[1].body.testSuites.length, 1);

    // 3rd call: PATCH /api/projects/proj_dep_100/data with expectedUpdatedAt advanced from 1st PATCH response AND both suite + defect preserved!
    assert.equal(apiCalls[2].method, 'PATCH');
    assert.equal(apiCalls[2].body.expectedUpdatedAt, '2026-11-06T11:01:00.000Z');
    assert.equal(apiCalls[2].body.testSuites.length, 1);
    assert.equal(apiCalls[2].body.defects.length, 1);

    const remaining = await getPendingProjectOperations(userId);
    assert.equal(remaining.length, 0);
  } finally {
    authController.getUser = origGetUser;
    await clearAllOfflineData();
  }
});

test('QAV-OFFLINE-001 (11): Multi-tab synchronization via BroadcastChannel and Web Locks', async () => {
  const {
    clearAllOfflineData,
    subscribeToSyncBroadcast
  } = await import('../qaChecklistSyncQueue.js');

  await clearAllOfflineData();

  const origBC = globalThis.BroadcastChannel;
  const channels = new Set();

  class MockBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      channels.add(this);
    }
    postMessage(data) {
      for (const ch of channels) {
        if (ch !== this && ch.name === this.name && typeof ch.onmessage === 'function') {
          ch.onmessage({ data });
        }
      }
    }
    close() {
      channels.delete(this);
    }
  }

  globalThis.BroadcastChannel = MockBroadcastChannel;

  try {
    const receivedEvents = [];
    const unsubscribe = subscribeToSyncBroadcast((msg) => {
      receivedEvents.push(msg);
    });

    // Simulate another tab broadcasting a mutation queued event
    const otherTabChannel = new MockBroadcastChannel('qavora_offline_sync_channel');
    otherTabChannel.postMessage({
      type: 'MUTATION_QUEUED',
      userId: 'multitab_user',
      projectId: 'proj_mt_1',
      senderTabId: 'other_tab_999'
    });

    assert.equal(receivedEvents.length, 1);
    assert.equal(receivedEvents[0].type, 'MUTATION_QUEUED');
    assert.equal(receivedEvents[0].projectId, 'proj_mt_1');

    unsubscribe();
    otherTabChannel.close();
  } finally {
    globalThis.BroadcastChannel = origBC;
    await clearAllOfflineData();
  }
});

test('QAV-OFFLINE-001 (12): Authentication expiration (HTTP 401) during synchronization preserves queued mutations', async () => {
  const {
    clearAllOfflineData,
    queueProjectMutation,
    getPendingProjectOperations,
    processProjectSyncQueue
  } = await import('../qaChecklistSyncQueue.js');
  const { authController } = await import('../authController.js');

  await clearAllOfflineData();
  const userId = 'auth_expired_user';
  const origGetUser = authController.getUser;
  authController.getUser = () => ({ userId });

  await queueProjectMutation({
    projectId: 'proj_401_test',
    entityType: 'project',
    entityId: 'proj_401_test',
    operationType: 'UPDATE',
    expectedUpdatedAt: '2026-11-06T08:00:00.000Z',
    payload: { updates: { name: 'Pending Title Before 401' } }
  }, userId);

  const mock401Transport = async () => ({
    ok: false,
    status: 401,
    data: { error: 'Authentication session expired' }
  });

  try {
    const res = await processProjectSyncQueue(userId, { transport: mock401Transport });
    assert.equal(res.ok, false);
    assert.equal(res.authExpired, true);
    assert.equal(res.syncedCount, 0);

    // Queued operation is safely preserved with status 'pending' so user can re-authenticate and resume sync
    const ops = await getPendingProjectOperations(userId);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].status, 'pending');
    assert.ok(ops[0].lastError.includes('401'));
  } finally {
    authController.getUser = origGetUser;
    await clearAllOfflineData();
  }
});

test('QAV-OFFLINE-001 (13): HTTP 409 conflict handling and safe conflict resolution (merge vs keep_server)', async () => {
  const {
    clearAllOfflineData,
    queueProjectMutation,
    getPendingProjectOperations,
    processProjectSyncQueue,
    resolveProjectConflict,
    cacheProjectOffline
  } = await import('../qaChecklistSyncQueue.js');
  const { authController } = await import('../authController.js');

  await clearAllOfflineData();
  const userId = 'conflict_409_user';
  const origGetUser = authController.getUser;
  authController.getUser = () => ({ userId });

  const projectId = 'proj_conflict_409';
  await cacheProjectOffline({
    id: projectId,
    name: 'Conflict Project',
    updatedAt: '2026-11-06T08:00:00.000Z',
    testSuites: [{ id: 'suite_1', name: 'Existing Suite', cases: [] }],
    executions: [],
    defects: []
  }, userId);

  const queuedOp = await queueProjectMutation({
    projectId,
    entityType: 'defect',
    entityId: 'def_offline_new',
    operationType: 'CREATE',
    expectedUpdatedAt: '2026-11-06T08:00:00.000Z',
    payload: {
      delta: {
        defect: { id: 'def_offline_new', title: 'Offline Discovered Defect', status: 'Open' }
      }
    }
  }, userId);

  const serverNewerProject = {
    id: projectId,
    name: 'Conflict Project',
    updatedAt: '2026-11-06T12:30:00.000Z',
    testSuites: [
      { id: 'suite_1', name: 'Existing Suite', cases: [] },
      { id: 'suite_server_2', name: 'Colleague Added Suite', cases: [] }
    ],
    executions: [],
    defects: [{ id: 'def_server_1', title: 'Colleague Defect', status: 'Open' }]
  };

  let shouldConflict = true;
  const patchPayloads = [];

  const mockConflictTransport = async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && url === '/api/projects') {
      return {
        ok: true,
        status: 200,
        data: [serverNewerProject]
      };
    }

    const body = options.body ? JSON.parse(options.body) : {};
    patchPayloads.push(body);

    if (shouldConflict) {
      return {
        ok: false,
        status: 409,
        data: {
          error: 'Conflict: Project was modified by another session',
          currentUpdatedAt: '2026-11-06T12:30:00.000Z',
          expectedUpdatedAt: body.expectedUpdatedAt
        }
      };
    }

    return {
      ok: true,
      status: 200,
      data: {
        ...serverNewerProject,
        ...body,
        updatedAt: '2026-11-06T13:00:00.000Z'
      }
    };
  };

  try {
    // First sync attempt hits 409 Conflict -> marks operation as status = 'conflict'
    const syncRes = await processProjectSyncQueue(userId, { transport: mockConflictTransport });
    assert.equal(syncRes.conflictCount, 1);

    const opsAfterConflict = await getPendingProjectOperations(userId);
    assert.equal(opsAfterConflict.length, 1);
    assert.equal(opsAfterConflict[0].status, 'conflict');
    assert.equal(opsAfterConflict[0].requiresManualResolution, true);
    assert.equal(opsAfterConflict[0].conflictDetails.currentUpdatedAt, '2026-11-06T12:30:00.000Z');

    // Resolve conflict using 'merge' strategy: preserves colleague's suite_server_2 & def_server_1 AND merges our def_offline_new!
    shouldConflict = false;
    const resolved = await resolveProjectConflict(queuedOp.id, 'merge', userId, {
      transport: mockConflictTransport
    });
    assert.equal(resolved.ok, true);

    assert.equal(patchPayloads.length, 2);
    const mergedPayload = patchPayloads[1];
    assert.equal(mergedPayload.expectedUpdatedAt, '2026-11-06T12:30:00.000Z');
    assert.equal(mergedPayload.testSuites.length, 2);
    assert.equal(mergedPayload.defects.length, 2);

    const remainingOps = await getPendingProjectOperations(userId);
    assert.equal(remainingOps.length, 0);
  } finally {
    authController.getUser = origGetUser;
    await clearAllOfflineData();
  }
});

test('QAV-OFFLINE-001 (14): Failed mutation recovery (permanent 4xx dead-letter vs transient 5xx retry & manual retry)', async () => {
  const {
    clearAllOfflineData,
    queueProjectMutation,
    getPendingProjectOperations,
    processProjectSyncQueue,
    retryFailedProjectOperations,
    discardProjectOperation
  } = await import('../qaChecklistSyncQueue.js');
  const { authController } = await import('../authController.js');

  await clearAllOfflineData();
  const userId = 'failed_recovery_user';
  const origGetUser = authController.getUser;
  authController.getUser = () => ({ userId });

  await queueProjectMutation({
    projectId: 'proj_fail_400',
    entityType: 'project',
    entityId: 'proj_fail_400',
    operationType: 'UPDATE',
    expectedUpdatedAt: '2026-11-06T08:00:00.000Z',
    payload: { updates: { name: 'Invalid Update' } }
  }, userId);

  let serverResponse = {
    ok: false,
    status: 422,
    data: { error: 'Validation failed: invalid payload' }
  };
  const mockTransport = async () => serverResponse;

  try {
    // Permanent 422 marks operation as 'failed' (dead-letter) so it doesn't infinitely loop
    const res1 = await processProjectSyncQueue(userId, { transport: mockTransport });
    assert.equal(res1.failedCount, 1);

    let ops = await getPendingProjectOperations(userId);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].status, 'failed');
    assert.equal(ops[0].requiresManualResolution, true);

    // Now fix server response and trigger manual retryFailedProjectOperations
    serverResponse = {
      ok: true,
      status: 200,
      data: { id: 'proj_fail_400', name: 'Valid Update', updatedAt: '2026-11-06T12:00:00.000Z' }
    };

    const retryRes = await retryFailedProjectOperations(userId, { transport: mockTransport });
    assert.equal(retryRes.syncedCount, 1);

    ops = await getPendingProjectOperations(userId);
    assert.equal(ops.length, 0);

    // Also verify discardProjectOperation cleanly removes an unwanted operation
    const opToDiscard = await queueProjectMutation({
      projectId: 'proj_discard_1',
      entityType: 'project',
      entityId: 'proj_discard_1',
      operationType: 'DELETE'
    }, userId);
    await discardProjectOperation(opToDiscard.id, userId);
    ops = await getPendingProjectOperations(userId);
    assert.equal(ops.length, 0);
  } finally {
    authController.getUser = origGetUser;
    await clearAllOfflineData();
  }
});

test('QAV-OFFLINE-001 (15): User and workspace isolation for offline project cache and mutation queue', async () => {
  const {
    clearAllOfflineData,
    queueProjectMutation,
    getPendingProjectOperations,
    cacheProjectOffline,
    getCachedProjectsForUser,
    processProjectSyncQueue
  } = await import('../qaChecklistSyncQueue.js');
  const { authController } = await import('../authController.js');

  await clearAllOfflineData();
  const userAlpha = 'workspace_user_alpha';
  const userBeta = 'workspace_user_beta';
  const origGetUser = authController.getUser;

  try {
    await cacheProjectOffline({ id: 'proj_alpha', name: 'Alpha Secret Project', testSuites: [], executions: [], defects: [] }, userAlpha);
    await cacheProjectOffline({ id: 'proj_beta', name: 'Beta Confidential Project', testSuites: [], executions: [], defects: [] }, userBeta);

    await queueProjectMutation({
      projectId: 'proj_alpha',
      entityType: 'project',
      entityId: 'proj_alpha',
      operationType: 'CREATE',
      payload: { project: { id: 'proj_alpha', name: 'Alpha Secret Project' } }
    }, userAlpha);

    await queueProjectMutation({
      projectId: 'proj_beta',
      entityType: 'project',
      entityId: 'proj_beta',
      operationType: 'CREATE',
      payload: { project: { id: 'proj_beta', name: 'Beta Confidential Project' } }
    }, userBeta);

    const alphaProjects = await getCachedProjectsForUser(userAlpha);
    const betaProjects = await getCachedProjectsForUser(userBeta);
    assert.equal(alphaProjects.length, 1);
    assert.equal(alphaProjects[0].id, 'proj_alpha');
    assert.equal(betaProjects.length, 1);
    assert.equal(betaProjects[0].id, 'proj_beta');

    const alphaOps = await getPendingProjectOperations(userAlpha);
    const betaOps = await getPendingProjectOperations(userBeta);
    assert.equal(alphaOps.length, 1);
    assert.equal(alphaOps[0].projectId, 'proj_alpha');
    assert.equal(betaOps.length, 1);
    assert.equal(betaOps[0].projectId, 'proj_beta');

    // Cross-account protection: User Alpha cannot trigger synchronization of User Beta's queue
    authController.getUser = () => ({ userId: userAlpha });
    const crossSyncAttempt = await processProjectSyncQueue(userBeta);
    assert.equal(crossSyncAttempt.ok, false);
    assert.equal(crossSyncAttempt.reason, 'Cross-account sync prevented');

    // Beta's operation remains untouched
    const betaOpsAfter = await getPendingProjectOperations(userBeta);
    assert.equal(betaOpsAfter.length, 1);
  } finally {
    authController.getUser = origGetUser;
    await clearAllOfflineData();
  }
});



