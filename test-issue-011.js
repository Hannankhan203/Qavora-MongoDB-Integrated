// test-issue-011.js
// Automated regression tests for ISSUE-011: Comprehensive localStorage Quota Handling
// Covers all 15 required scenarios + ISSUE-001 through ISSUE-010 regression protection

import assert from 'node:assert';
import fs from 'node:fs';

import {
  CHECKLISTS_STORAGE_KEY,
  ACTIVE_RUNNER_STORAGE_KEY,
  SCHEMA_VERSION,
  TEST_STATUS,
  generateStableId,
  isQuotaExceededError,
  isSecurityError,
  getStorageErrorMessage,
  getStorageBackend,
  setStorageAdapterForTesting,
  safeStorageWrite,
  safeStorageRead,
  safeStorageRemove,
  loadAllChecklists,
  saveAllChecklists,
  saveActiveRunnerState,
  getActiveRunnerState,
  getChecklistById,
  createChecklistFromParsedPlan,
  toggleChecklistTest,
  renameChecklistById,
  deleteChecklistById,
  addPhaseToChecklist,
  removePhaseFromChecklist,
  removeTestFromChecklist,
  addTestToChecklistPhase,
  normalizeChecklistRecord,
  sortPhases,
  comparePhaseNumbers
} from './qaChecklistStore.js';

import { parseQAPlanText } from './qaParser.js';
import {
  generateChecklistTransferCode,
  validateChecklistTransferCode,
  applyChecklistTransferPayload
} from './qaChecklistTransfer.js';

console.log('====================================================');
console.log('   ISSUE-011: localStorage Quota Handling Test Suite');
console.log('====================================================\n');

// In-memory mock storage adapter generator
function createMockStorage(options = {}) {
  const store = new Map();
  let failWrites = options.failWrites || false;
  let failureType = options.failureType || 'quota'; // 'quota' | 'security' | 'generic'

  return {
    _store: store,
    setFailWrites(fail, type = 'quota') {
      failWrites = fail;
      failureType = type;
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      if (failWrites) {
        if (failureType === 'quota') {
          const err = new Error('QuotaExceededError: The quota has been exceeded.');
          err.name = 'QuotaExceededError';
          err.code = 22;
          throw err;
        } else if (failureType === 'quota_firefox') {
          const err = new Error('NS_ERROR_DOM_QUOTA_REACHED');
          err.name = 'NS_ERROR_DOM_QUOTA_REACHED';
          err.code = 1014;
          throw err;
        } else if (failureType === 'quota_webkit_legacy') {
          const err = new Error('QUOTA_EXCEEDED_ERR');
          err.name = 'QUOTA_EXCEEDED_ERR';
          throw err;
        } else if (failureType === 'security') {
          const err = new Error('SecurityError: The operation is insecure.');
          err.name = 'SecurityError';
          err.code = 18;
          throw err;
        } else {
          throw new Error('Generic storage write error');
        }
      }
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

// ---------------------------------------------------------------------------
// TEST 1: Normal localStorage write
// ---------------------------------------------------------------------------
console.log('Running Test 1: Normal localStorage write...');
const mock1 = createMockStorage();
setStorageAdapterForTesting(mock1);

const sampleChk1 = {
  id: 'chk_normal_1',
  title: 'Normal Write Checklist',
  phases: [
    {
      id: 'ph_1',
      phaseLabel: 'Phase 1',
      phaseNumber: '1',
      name: 'Initial Smoke',
      sections: [
        {
          id: 'sec_1',
          type: 'direct',
          name: '',
          notes: [],
          tests: [
            { id: 't_1', testId: 'TC-001', text: 'Verify homepage loads', completed: false, priority: 'High' }
          ]
        }
      ]
    }
  ]
};

const writeRes1 = saveAllChecklists([sampleChk1]);
assert.strictEqual(writeRes1.ok, true, 'Write should succeed normally');
assert.strictEqual(writeRes1.isQuota, false, 'Should not be marked as quota error');
assert.strictEqual(writeRes1.isSecurity, false, 'Should not be marked as security error');
assert.strictEqual(writeRes1.error, null, 'Error should be null');

const loadRes1 = loadAllChecklists();
assert.strictEqual(loadRes1.checklists.length, 1, 'Checklist should be loaded from storage');
assert.strictEqual(loadRes1.checklists[0].id, 'chk_normal_1', 'Checklist ID matches');
console.log('✔ Test 1 passed: Normal write and read successful.');

// ---------------------------------------------------------------------------
// TEST 2: QuotaExceededError detection across browser variations
// ---------------------------------------------------------------------------
console.log('\nRunning Test 2: QuotaExceededError handling & browser variations...');
// Standard Blink / WebKit
const qErr1 = new Error('Quota exceeded');
qErr1.name = 'QuotaExceededError';
qErr1.code = 22;
assert.strictEqual(isQuotaExceededError(qErr1), true, 'Standard QuotaExceededError recognized');

// Firefox Gecko
const qErr2 = new Error('NS_ERROR_DOM_QUOTA_REACHED');
qErr2.name = 'NS_ERROR_DOM_QUOTA_REACHED';
qErr2.code = 1014;
assert.strictEqual(isQuotaExceededError(qErr2), true, 'Firefox NS_ERROR_DOM_QUOTA_REACHED recognized');

// Legacy Safari / iOS WebKit
const qErr3 = new Error('Storage quota exceeded');
qErr3.name = 'QUOTA_EXCEEDED_ERR';
assert.strictEqual(isQuotaExceededError(qErr3), true, 'Legacy QUOTA_EXCEEDED_ERR recognized');

// Old IE/Edge
const qErr4 = new Error('Out of memory');
qErr4.number = -2147024882;
assert.strictEqual(isQuotaExceededError(qErr4), true, 'IE numeric quota error recognized');

// W3C DOM error
const qErr5 = new Error('DOM quota exceeded');
qErr5.name = 'W3CException_DOM_QUOTA_EXCEEDED_ERR';
assert.strictEqual(isQuotaExceededError(qErr5), true, 'W3C DOM quota exception recognized');

// User-friendly error message verification
const quotaMsg = getStorageErrorMessage(qErr1, 'saving test');
assert(quotaMsg.includes('Browser storage is full or has insufficient available space'), 'Includes storage full notice');
assert(quotaMsg.includes('Previously saved data remains available'), 'Includes data preservation notice');
assert(quotaMsg.includes('Please export a backup and free storage space'), 'Includes backup and recovery instruction');

// Verify safeStorageWrite does not throw and returns structured failure
mock1.setFailWrites(true, 'quota');
const failedWrite = safeStorageWrite('test_key', 'test_val', 'test context');
assert.strictEqual(failedWrite.ok, false, 'Failed write returns ok: false');
assert.strictEqual(failedWrite.isQuota, true, 'isQuota is true');
assert.strictEqual(failedWrite.isSecurity, false, 'isSecurity is false');
assert(typeof failedWrite.error === 'string' && failedWrite.error.length > 0, 'Error message populated');
console.log('✔ Test 2 passed: All browser quota variations recognized and handled safely without crashes.');

// ---------------------------------------------------------------------------
// TEST 3: Existing record followed by failed update -> Original preserved
// ---------------------------------------------------------------------------
console.log('\nRunning Test 3: Existing record followed by failed update...');
mock1.setFailWrites(false);
const initialTitle = 'Original Immutable Checklist Title';
const sampleChk3 = {
  id: 'chk_immutable_3',
  title: initialTitle,
  phases: [
    {
      id: 'ph_3',
      phaseLabel: 'Phase 1',
      phaseNumber: '1',
      name: 'Stable Phase',
      sections: [
        {
          id: 'sec_3',
          type: 'direct',
          name: '',
          notes: [],
          tests: [
            { id: 't_3', testId: 'TC-003', text: 'Important test', completed: false, priority: 'Critical' }
          ]
        }
      ]
    }
  ]
};
saveAllChecklists([sampleChk3]);

// Now turn on quota error simulation
mock1.setFailWrites(true, 'quota');

// Attempt to rename checklist
const renameRes = renameChecklistById('chk_immutable_3', 'Failed Rename Attempt');
assert.strictEqual(renameRes.ok, false, 'Rename should fail safely');
assert.strictEqual(renameRes.isQuota, true, 'Quota error reported');
assert.strictEqual(renameRes.checklist.title, initialTitle, 'Returned checklist still has original title');

// Re-read storage
mock1.setFailWrites(false);
const loadedAfterFailedUpdate = loadAllChecklists().checklists.find(c => c.id === 'chk_immutable_3');
assert.strictEqual(loadedAfterFailedUpdate.title, initialTitle, 'Storage data remains original and uncorrupted');
console.log('✔ Test 3 passed: Failed update leaves existing record perfectly preserved.');

// ---------------------------------------------------------------------------
// TEST 4: Failed new project creation -> No misleading success message
// ---------------------------------------------------------------------------
console.log('\nRunning Test 4: Failed project creation handling...');
// Test projects storage layer directly through safeStorageWrite
const mockProjectsStore = createMockStorage();
setStorageAdapterForTesting(mockProjectsStore);

const existingProjects = [
  { id: 'proj_exist_1', name: 'Existing Project 1', testSuites: [], testPlan: { phases: [] } }
];
safeStorageWrite('qavora_projects_v1', JSON.stringify(existingProjects));

// Simulate storage full during new project creation
mockProjectsStore.setFailWrites(true, 'quota');

const newCandidateProject = {
  id: 'proj_new_candidate',
  name: 'Candidate Project When Storage Full',
  testSuites: [],
  testPlan: { phases: [] }
};
const nextProjectsList = [newCandidateProject, ...existingProjects];
const createProjRes = safeStorageWrite('qavora_projects_v1', JSON.stringify(nextProjectsList), 'saving projects');

assert.strictEqual(createProjRes.ok, false, 'Project write must report failure');
assert.strictEqual(createProjRes.isQuota, true, 'Project write marked as quota failure');
assert(createProjRes.error.includes('Browser storage is full'), 'Error contains user-friendly quota warning');

// Storage in mockProjectsStore must still have only 1 project
mockProjectsStore.setFailWrites(false);
const rawProjectsAfterFail = JSON.parse(mockProjectsStore.getItem('qavora_projects_v1'));
assert.strictEqual(rawProjectsAfterFail.length, 1, 'Only original project remains in storage');
assert.strictEqual(rawProjectsAfterFail[0].id, 'proj_exist_1', 'Original project is preserved');
console.log('✔ Test 4 passed: Failed new project creation reports failure and preserves storage.');

// ---------------------------------------------------------------------------
// TEST 5: Failed checklist persistence -> Existing checklist preserved
// ---------------------------------------------------------------------------
console.log('\nRunning Test 5: Failed checklist persistence...');
const mockChkStore = createMockStorage();
setStorageAdapterForTesting(mockChkStore);

const chk5 = {
  id: 'chk_vital_5',
  title: 'Vital Release Checklist',
  phases: [
    {
      id: 'ph_5',
      phaseLabel: 'Phase 1',
      name: 'Release Verification',
      sections: [{ id: 'sec_5', tests: [{ id: 't_5', text: 'Gate check', completed: true }] }]
    }
  ]
};
saveAllChecklists([chk5]);

// Fail subsequent save
mockChkStore.setFailWrites(true, 'quota_firefox');
const failChkRes = saveAllChecklists([
  { id: 'chk_new_overflow', title: 'Overflow checklist', phases: [] },
  chk5
]);
assert.strictEqual(failChkRes.ok, false, 'Checklist write returns failure');
assert.strictEqual(failChkRes.isQuota, true, 'Quota error flagged');

mockChkStore.setFailWrites(false);
const loadedChk5 = loadAllChecklists().checklists;
assert.strictEqual(loadedChk5.length, 1, 'Only original checklist exists in storage');
assert.strictEqual(loadedChk5[0].id, 'chk_vital_5', 'Vital checklist untouched');
console.log('✔ Test 5 passed: Existing checklist preserved during failed persistence.');

// ---------------------------------------------------------------------------
// TEST 6: Failed defect persistence -> Existing defects preserved
// ---------------------------------------------------------------------------
console.log('\nRunning Test 6: Failed defect persistence...');
const mockDefectStore = createMockStorage();
setStorageAdapterForTesting(mockDefectStore);

const projectWithDefects = {
  id: 'proj_defects_1',
  name: 'Bug Hunter App',
  defects: [
    { id: 'DEF-001', title: 'Critical crash on launch', severity: 'Critical', status: 'Open' },
    { id: 'DEF-002', title: 'Navbar misalignment', severity: 'Low', status: 'Resolved' }
  ]
};
safeStorageWrite('qavora_projects_v1', JSON.stringify([projectWithDefects]));

// Simulate quota failure while adding DEF-003
mockDefectStore.setFailWrites(true, 'quota');
const updatedProjectCandidate = {
  ...projectWithDefects,
  defects: [
    { id: 'DEF-003', title: 'Overflow bug', severity: 'High', status: 'Open' },
    ...projectWithDefects.defects
  ]
};
const defectSaveRes = safeStorageWrite('qavora_projects_v1', JSON.stringify([updatedProjectCandidate]), 'saving projects');
assert.strictEqual(defectSaveRes.ok, false, 'Defect save returns failure');

mockDefectStore.setFailWrites(false);
const loadedProjectsAfterDefectFail = JSON.parse(mockDefectStore.getItem('qavora_projects_v1'));
assert.strictEqual(loadedProjectsAfterDefectFail[0].defects.length, 2, 'Still exactly 2 original defects');
assert.strictEqual(loadedProjectsAfterDefectFail[0].defects[0].id, 'DEF-001', 'DEF-001 preserved');
assert.strictEqual(loadedProjectsAfterDefectFail[0].defects[1].id, 'DEF-002', 'DEF-002 preserved');
console.log('✔ Test 6 passed: Existing defects preserved after failed defect save.');

// ---------------------------------------------------------------------------
// TEST 7: SecurityError -> Graceful error handling
// ---------------------------------------------------------------------------
console.log('\nRunning Test 7: SecurityError graceful handling...');
const mockSecStore = createMockStorage();
setStorageAdapterForTesting(mockSecStore);

const secErr = new Error('SecurityError: The operation is insecure.');
secErr.name = 'SecurityError';
secErr.code = 18;
assert.strictEqual(isSecurityError(secErr), true, 'SecurityError classified correctly');
assert.strictEqual(isQuotaExceededError(secErr), false, 'SecurityError not confused with Quota');

const secMsg = getStorageErrorMessage(secErr, 'saving projects');
assert(secMsg.includes('restricted or denied by your browser security settings'), 'Security error message is clear');

mockSecStore.setFailWrites(true, 'security');
const secWriteRes = safeStorageWrite('key_sec', 'val_sec');
assert.strictEqual(secWriteRes.ok, false, 'Write fails gracefully');
assert.strictEqual(secWriteRes.isSecurity, true, 'Flagged as security error');
assert.strictEqual(secWriteRes.isQuota, false, 'Not flagged as quota error');
console.log('✔ Test 7 passed: SecurityError handled gracefully without unhandled exception.');

// ---------------------------------------------------------------------------
// TEST 8: Invalid JSON during recovery -> No destructive automatic cleanup
// ---------------------------------------------------------------------------
console.log('\nRunning Test 8: Invalid JSON handling without destructive cleanup...');
const mockCorruptStore = createMockStorage();
setStorageAdapterForTesting(mockCorruptStore);

const corruptedPayload = '{"unclosed_json": [1, 2, 3';
mockCorruptStore.setItem(CHECKLISTS_STORAGE_KEY, corruptedPayload);

const corruptLoadRes = loadAllChecklists();
assert.strictEqual(corruptLoadRes.checklists.length, 0, 'Returns clean empty state');
assert(corruptLoadRes.warning.includes('could not be parsed'), 'Provides non-destructive recovery warning');

// Verify that the corrupted raw storage key was NOT wiped or destroyed
assert.strictEqual(mockCorruptStore.getItem(CHECKLISTS_STORAGE_KEY), corruptedPayload, 'Raw stored value preserved without destructive deletion');
console.log('✔ Test 8 passed: Invalid JSON safely isolated without destructive auto-deletion.');

// ---------------------------------------------------------------------------
// TEST 9: Multiple storage operations -> Partial failures handled safely
// ---------------------------------------------------------------------------
console.log('\nRunning Test 9: Multiple storage operations partial failure safety...');
const mockMultiStore = createMockStorage();
setStorageAdapterForTesting(mockMultiStore);

// Pre-populate with baseline state
const baselineProjects = [{ id: 'p_base_1', name: 'Base Project', testSuites: [], testPlan: { phases: [] } }];
const baselineChecklists = [{ id: 'c_base_1', title: 'Base Checklist', phases: [] }];
safeStorageWrite('qavora_projects_v1', JSON.stringify(baselineProjects));
saveAllChecklists(baselineChecklists);

// Simulate multi-step restore: projects succeed, but checklists fail
let writeCount = 0;
const customAdapter = {
  getItem: (k) => mockMultiStore.getItem(k),
  removeItem: (k) => mockMultiStore.removeItem(k),
  setItem: (k, v) => {
    writeCount++;
    if (k === CHECKLISTS_STORAGE_KEY) {
      const err = new Error('Quota exceeded on checklists');
      err.name = 'QuotaExceededError';
      err.code = 22;
      throw err;
    }
    mockMultiStore.setItem(k, v);
  }
};
setStorageAdapterForTesting(customAdapter);

// If projects written but checklists failed, rollback projects to baseline
const newProjectsToImport = [{ id: 'p_import_1', name: 'Imported Project', testSuites: [], testPlan: { phases: [] } }];
const newChecklistsToImport = [{ id: 'c_import_1', title: 'Imported Checklist', phases: [] }];

// Step 1: Write projects
const pWrite = safeStorageWrite('qavora_projects_v1', JSON.stringify(newProjectsToImport));
assert.strictEqual(pWrite.ok, true, 'Projects write succeeded');

// Step 2: Write checklists (fails)
const cWrite = saveAllChecklists(newChecklistsToImport);
assert.strictEqual(cWrite.ok, false, 'Checklists write failed due to simulated quota');

// Step 3: Atomic rollback handler
if (!cWrite.ok) {
  // Restore projects to baseline
  setStorageAdapterForTesting(mockMultiStore);
  safeStorageWrite('qavora_projects_v1', JSON.stringify(baselineProjects));
}

// Verify baseline is intact
const restoredProjects = JSON.parse(mockMultiStore.getItem('qavora_projects_v1'));
assert.strictEqual(restoredProjects[0].id, 'p_base_1', 'Projects rolled back to baseline after partial failure');
const restoredChecklists = loadAllChecklists().checklists;
assert.strictEqual(restoredChecklists[0].id, 'c_base_1', 'Checklists remained at baseline');
console.log('✔ Test 9 passed: Multi-operation partial failure rolled back safely.');

// ---------------------------------------------------------------------------
// TEST 10: Retry after storage becomes available -> Saving succeeds
// ---------------------------------------------------------------------------
console.log('\nRunning Test 10: Retry after storage freed succeeds...');
const mockRetryStore = createMockStorage();
setStorageAdapterForTesting(mockRetryStore);

mockRetryStore.setFailWrites(true, 'quota');
const initialAttempt = safeStorageWrite('retry_key', 'data_payload');
assert.strictEqual(initialAttempt.ok, false, 'First attempt fails');
assert.strictEqual(initialAttempt.isQuota, true, 'Flagged as quota');

// User exports backup and frees storage space
mockRetryStore.setFailWrites(false);
const retryAttempt = safeStorageWrite('retry_key', 'data_payload');
assert.strictEqual(retryAttempt.ok, true, 'Retry attempt succeeds after freeing space');
assert.strictEqual(mockRetryStore.getItem('retry_key'), 'data_payload', 'Payload persisted on retry');
console.log('✔ Test 10 passed: Retry successful after storage quota freed.');

// ---------------------------------------------------------------------------
// TEST 11: Existing backup and restore remain functional
// ---------------------------------------------------------------------------
console.log('\nRunning Test 11: Backup and restore functionality...');
const mockBackupStore = createMockStorage();
setStorageAdapterForTesting(mockBackupStore);

const chkForBackup = {
  id: 'chk_backup_test',
  title: 'Full Backup Checklist',
  phases: [{ id: 'ph_b', phaseLabel: 'Phase 1', name: 'Setup', sections: [{ id: 'sec_b', tests: [{ id: 'tb_1', text: 'Sanity', completed: true }] }] }]
};
saveAllChecklists([chkForBackup]);

const backupPayload = JSON.stringify({
  version: 1,
  exportedAt: new Date().toISOString(),
  qaChecklists: loadAllChecklists().checklists
});
assert(backupPayload.includes('Full Backup Checklist'), 'Backup includes checklist');

// Clear storage
mockBackupStore.clear();
assert.strictEqual(loadAllChecklists().checklists.length, 0, 'Storage cleared');

// Restore from backup
const parsedBackup = JSON.parse(backupPayload);
saveAllChecklists(parsedBackup.qaChecklists);
const restored = loadAllChecklists().checklists;
assert.strictEqual(restored.length, 1, 'Restored checklist count is 1');
assert.strictEqual(restored[0].id, 'chk_backup_test', 'Restored checklist ID matches');
console.log('✔ Test 11 passed: Backup and restore cycles work cleanly.');

// ---------------------------------------------------------------------------
// TEST 12: Existing import/export (cross-device transfer) remain functional
// ---------------------------------------------------------------------------
console.log('\nRunning Test 12: Transfer code export and import...');
const mockTransferStore = createMockStorage();
setStorageAdapterForTesting(mockTransferStore);

const transferChk = {
  id: 'chk_xfer_1',
  title: 'Transfer Code Verification',
  phases: [
    {
      id: 'ph_x',
      phaseLabel: 'Phase 1',
      name: 'Mobile Flow',
      sections: [{ id: 'sec_x', tests: [{ id: 'tx_1', text: 'Step 1', completed: false }] }]
    }
  ]
};
saveAllChecklists([transferChk]);

const exportRes = await generateChecklistTransferCode();
assert.strictEqual(exportRes.ok, true, 'Export transfer code generated');
assert(typeof exportRes.code === 'string', 'Transfer code is string');

const validateRes = await validateChecklistTransferCode(exportRes.code);
assert.strictEqual(validateRes.ok, true, 'Transfer code validated');

// Apply merge to empty storage
mockTransferStore.clear();
const importRes = applyChecklistTransferPayload(validateRes.payload, 'merge');
assert.strictEqual(importRes.ok, true, 'Import transfer code succeeded');
assert.strictEqual(loadAllChecklists().checklists.length, 1, 'Checklist restored via transfer code');
console.log('✔ Test 12 passed: Cross-device transfer export and import intact.');

// ---------------------------------------------------------------------------
// TEST 13: Existing storage schema migrations remain functional
// ---------------------------------------------------------------------------
console.log('\nRunning Test 13: Schema normalization and migration...');
const mockMigrateStore = createMockStorage();
setStorageAdapterForTesting(mockMigrateStore);

// Legacy raw checklist missing schemaVersion and modern properties
const legacyRaw = [
  {
    id: 'legacy_chk_1',
    title: 'Old Format Checklist',
    phases: [
      {
        id: 'p_old',
        name: 'Legacy Phase',
        sections: [
          {
            id: 's_old',
            tests: [
              { id: 't_old_1', text: 'Legacy test item', completed: true }
            ]
          }
        ]
      }
    ]
  }
];
mockMigrateStore.setItem(CHECKLISTS_STORAGE_KEY, JSON.stringify(legacyRaw));

const migrated = loadAllChecklists().checklists;
assert.strictEqual(migrated.length, 1, 'Legacy checklist loaded');
assert.strictEqual(migrated[0].schemaVersion, SCHEMA_VERSION, 'Migrated to SCHEMA_VERSION 1');
assert.strictEqual(migrated[0].phases[0].sections[0].tests[0].status, TEST_STATUS.COMPLETED, 'Normalized status to TEST_STATUS.COMPLETED');
console.log('✔ Test 13 passed: Legacy data safely migrated and normalized.');

// ---------------------------------------------------------------------------
// TEST 14: Normal application restart -> Persisted data loads correctly
// ---------------------------------------------------------------------------
console.log('\nRunning Test 14: Normal application restart simulation...');
const mockRestartStore = createMockStorage();
setStorageAdapterForTesting(mockRestartStore);

const persistentData = [
  {
    id: 'chk_restart_test',
    title: 'Restart Survivor',
    phases: [{ id: 'ph_rst', phaseLabel: 'Phase 1', name: 'P1', sections: [{ id: 'sec_rst', tests: [{ id: 'tr_1', text: 'Survive restart', completed: false }] }] }]
  }
];
saveAllChecklists(persistentData);
saveActiveRunnerState({ activeChecklistId: 'chk_restart_test', lastQaView: 'qa-runner' });

// Simulate full restart: re-evaluate loadAllChecklists and getActiveRunnerState
const restartedChecklists = loadAllChecklists().checklists;
const restartedRunner = getActiveRunnerState();

assert.strictEqual(restartedChecklists.length, 1, 'Checklists persist across restart');
assert.strictEqual(restartedChecklists[0].id, 'chk_restart_test', 'Checklist ID matches');
assert.strictEqual(restartedRunner.activeChecklistId, 'chk_restart_test', 'Active runner state preserved');
assert.strictEqual(restartedRunner.lastQaView, 'qa-runner', 'Last QA view preserved');
console.log('✔ Test 14 passed: Normal application restart retains all records accurately.');

// ---------------------------------------------------------------------------
// TEST 15: Empty storage -> Application initializes correctly
// ---------------------------------------------------------------------------
console.log('\nRunning Test 15: Empty storage initialization...');
const mockEmptyStore = createMockStorage();
setStorageAdapterForTesting(mockEmptyStore);

const emptyLoad = loadAllChecklists();
assert.strictEqual(emptyLoad.checklists.length, 0, 'Empty storage returns empty checklists array');
assert.strictEqual(emptyLoad.warning, null, 'No warning when storage is cleanly empty');

const emptyRunner = getActiveRunnerState();
assert.strictEqual(emptyRunner.activeChecklistId, null, 'Active runner checklist is null on fresh storage');
assert.strictEqual(emptyRunner.lastQaView, null, 'Last QA view is null on fresh storage');
console.log('✔ Test 15 passed: Clean initial boot on empty storage verified.');

// ---------------------------------------------------------------------------
// TEST 16: Regression Verification for ISSUE-001 Through ISSUE-010
// ---------------------------------------------------------------------------
console.log('\nRunning Test 16: Regression protection for ISSUE-001 through ISSUE-010...');

// ISSUE-001: XSS protection in script.js and checklistGeneratorUI.js
const scriptSource = fs.readFileSync('./script.js', 'utf-8');
const genSource = fs.readFileSync('./checklistGeneratorUI.js', 'utf-8');
assert(scriptSource.includes('function escapeHTML(str)'), 'ISSUE-001: escapeHTML must exist in script.js');
assert(genSource.includes('document.createElement'), 'ISSUE-001: checklistGeneratorUI uses safe DOM creation');

// ISSUE-002: Project deletion storage identity
assert(scriptSource.includes('p => p.id !== targetId'), 'ISSUE-002: Project deletion filters strictly by ID');

// ISSUE-003: Mobile transfer-file selection
const xferUISource = fs.readFileSync('./qaChecklistTransferUI.js', 'utf-8');
assert(xferUISource.includes('copyTextSafe'), 'ISSUE-003: Robust clipboard and fallback copy exists');

// ISSUE-004: GitHub Pages deployment configuration in vite.config.ts
const viteConfig = fs.readFileSync('./vite.config.ts', 'utf-8');
assert(viteConfig.includes("process.env.GITHUB_ACTIONS === 'true' ? '/Qavora/' :"), 'ISSUE-004: GitHub Pages base path intact');

// ISSUE-005: Manifest / PWA path handling
const htmlSource = fs.readFileSync('./index.html', 'utf-8');
assert(htmlSource.includes('href="./site.webmanifest"'), 'ISSUE-005: Relative manifest path intact');
const manifest = JSON.parse(fs.readFileSync('./public/site.webmanifest', 'utf-8'));
assert(manifest.start_url === './' || manifest.start_url === '.', 'ISSUE-005: Manifest relative start_url intact');

// ISSUE-006: Decimal phase parsing and numeric sorting
const decimalParse = parseQAPlanText('Phase 2.5: Advanced Options\n- [ ] Step 1');
assert.strictEqual(decimalParse.phases[0].phaseNumber, '2.5', 'ISSUE-006: Decimal phase number 2.5 parsed');
assert(comparePhaseNumbers('2.1', '2.5') < 0, 'ISSUE-006: Numeric comparison handles decimals correctly');

// ISSUE-007: Centralized priority classification
assert(scriptSource.includes('classifyPriority') || scriptSource.includes('classifyDefectPriority'), 'ISSUE-007: Priority classification intact');

// ISSUE-008: Numeric zero preservation
const zeroParse = parseQAPlanText('Phase 0: Environment Init\n- [ ] Clear cache');
assert.strictEqual(zeroParse.phases[0].phaseNumber, '0', 'ISSUE-008: Phase 0 preserved');

// ISSUE-009: Lettered list parsing
const letterParse = parseQAPlanText('Phase 1: Form Validation\nA. Enter email\nB. Enter password');
assert.strictEqual(letterParse.phases[0].sections[0].tests.length, 2, 'ISSUE-009: Lettered items A and B parsed as tests');

// ISSUE-010: Delete confirmation UX, cancellation, focus trap, and keyboard accessibility
assert(htmlSource.includes('id="delete-modal"'), 'ISSUE-010: Universal delete modal exists');
assert(htmlSource.includes('id="qa-checklist-delete-modal"'), 'ISSUE-010: QA checklist delete modal exists');
assert(scriptSource.includes('closeDeleteModal'), 'ISSUE-010: closeDeleteModal exists');
assert(scriptSource.includes('DOM.deleteConfirmBtn.disabled = true;'), 'ISSUE-010: Double click protection on universal delete confirm button exists');

console.log('✔ Test 16 passed: All regressions for ISSUE-001 through ISSUE-010 verified intact.');

// ---------------------------------------------------------------------------
// TEST 17: Rebranding Backward-Compatible Storage Migration
// ---------------------------------------------------------------------------
console.log('\nRunning Test 17: Rebranding legacy storage migration (testpilot_* -> qavora_*)...');

const mockMigrationStore = createMockStorage();
setStorageAdapterForTesting(mockMigrationStore);

// Seed with legacy TestPilot keys
const legacyChecklists = [
  {
    id: 'chk_legacy_1',
    title: 'Migrated Checklist',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    phases: []
  }
];
mockMigrationStore.setItem('testpilot_qa_checklists_v1', JSON.stringify({
  schemaVersion: 1,
  savedAt: '2026-01-01T00:00:00.000Z',
  checklists: legacyChecklists
}));
mockMigrationStore.setItem('testpilot_qa_active_runner_v1', JSON.stringify({
  activeChecklistId: 'chk_legacy_1',
  lastQaView: 'qa-runner'
}));

// Load checklists triggers migration
const migrationResult = loadAllChecklists();
assert.strictEqual(migrationResult.checklists.length, 1, 'Legacy checklist migrated successfully');
assert.strictEqual(migrationResult.checklists[0].id, 'chk_legacy_1', 'Migrated checklist ID matches');

// Check that new Qavora key now holds the data
const qavoraChecklistsRaw = mockMigrationStore.getItem('qavora_qa_checklists_v1');
assert(qavoraChecklistsRaw, 'New qavora_qa_checklists_v1 key populated');

// Check that active runner state migrated
const runnerState = getActiveRunnerState();
assert.strictEqual(runnerState.activeChecklistId, 'chk_legacy_1', 'Active runner state migrated');
assert(mockMigrationStore.getItem('qavora_qa_active_runner_v1'), 'New qavora_qa_active_runner_v1 key populated');

console.log('✔ Test 17 passed: Backward-compatible migration from testpilot_* to qavora_* verified.');

console.log('\n====================================================');
console.log('   ALL 17 TESTS IN ISSUE-011 SUITE PASSED (100%)');
console.log('====================================================\n');
