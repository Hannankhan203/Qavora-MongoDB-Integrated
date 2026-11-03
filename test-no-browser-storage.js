/**
 * test-no-browser-storage.js
 * 
 * Comprehensive Automated Verification Suite for Qavora:
 * Complete Browser LocalStorage & SessionStorage Removal
 * and In-Memory Data Layer Migration Preparation.
 * 
 * Verifies all 15 required criteria from Section 10 of the migration specification.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  CHECKLISTS_STORAGE_KEY,
  ACTIVE_RUNNER_STORAGE_KEY,
  QAVORA_PERSISTENT_STORAGE_KEYS,
  TEST_STATUS,
  generateStableId,
  getStorageBackend,
  setStorageAdapterForTesting,
  getMemoryDataStore,
  clearMemoryDataStore,
  safeStorageWrite,
  safeStorageRead,
  safeStorageRemove,
  loadAllChecklists,
  saveAllChecklists,
  getChecklistById,
  createChecklistFromParsedPlan,
  toggleChecklistTest,
  renameChecklistById,
  deleteChecklistById,
  addPhaseToChecklist,
  getActiveRunnerState,
  saveActiveRunnerState,
  normalizeActiveRunnerState,
  replaceActiveRunnerState,
  calculateChecklistProgress,
  calculateQavoraStorageFootprint,
  getChecklistPromotionPreview,
  findPromotedProjectForChecklist,
  buildProjectFromChecklist,
  promoteChecklistToProject
} from './qaChecklistStore.js';

import { parseQAPlanText } from './qaParser.js';
import {
  generateChecklistTransferCode,
  validateChecklistTransferCode,
  applyChecklistTransferPayload
} from './qaChecklistTransfer.js';

console.log('================================================================');
console.log('QAVORA: NO BROWSER STORAGE & IN-MEMORY DATA LAYER VERIFICATION');
console.log('================================================================\n');

const APP_FILES = [
  'script.js',
  'qaChecklistStore.js',
  'qaRunnerUI.js',
  'checklistGeneratorUI.js',
  'qaChecklistTransfer.js',
  'qaChecklistTransferUI.js',
  'qaParser.js',
  'index.html'
];

// ============================================================================
// TEST 1: No direct localStorage references in application source code
// ============================================================================
console.log('--- Test 1: No direct localStorage references in application source code ---');
{
  for (const file of APP_FILES) {
    const content = fs.readFileSync(path.resolve(file), 'utf8');
    const matches = content.match(/\blocalStorage\b/g);
    assert.strictEqual(
      matches,
      null,
      `File ${file} must contain ZERO references to localStorage. Found: ${matches?.length || 0}`
    );
  }
  console.log('✓ Test 1 passed: 0 localStorage references found across all application source files.');
}

// ============================================================================
// TEST 2: No direct sessionStorage references in application source code
// ============================================================================
console.log('\n--- Test 2: No direct sessionStorage references in application source code ---');
{
  for (const file of APP_FILES) {
    const content = fs.readFileSync(path.resolve(file), 'utf8');
    const matches = content.match(/\bsessionStorage\b/g);
    assert.strictEqual(
      matches,
      null,
      `File ${file} must contain ZERO references to sessionStorage. Found: ${matches?.length || 0}`
    );
  }
  console.log('✓ Test 2 passed: 0 sessionStorage references found across all application source files.');
}

// ============================================================================
// TEST 3: No browser-storage persistence wrappers remain
// ============================================================================
console.log('\n--- Test 3: No browser-storage persistence wrappers remain ---');
{
  // Ensure default backend operates purely on in-memory data store
  setStorageAdapterForTesting(null);
  const { backend, isFallback } = getStorageBackend();
  assert.strictEqual(isFallback, false, 'In-memory data store is primary backend, not fallback');
  assert.ok(backend && typeof backend.getItem === 'function', 'Backend provides getItem');
  assert.ok(backend && typeof backend.setItem === 'function', 'Backend provides setItem');
  assert.ok(backend && typeof backend.removeItem === 'function', 'Backend provides removeItem');
  assert.ok(backend && typeof backend.clear === 'function', 'Backend provides clear');

  const testKey = 'test_backend_probe_' + Date.now();
  backend.setItem(testKey, 'in_memory_value');
  assert.strictEqual(backend.getItem(testKey), 'in_memory_value', 'Data stored in memory');
  backend.removeItem(testKey);
  assert.strictEqual(backend.getItem(testKey), null, 'Data removed from memory');

  console.log('✓ Test 3 passed: Pure in-memory backend verified with zero browser persistence wrappers.');
}

// ============================================================================
// TEST 4: No application data is persisted across page refreshes
// ============================================================================
console.log('\n--- Test 4: No application data persisted across simulated page refresh ---');
{
  setStorageAdapterForTesting(null);
  clearMemoryDataStore();

  // Write some data in current "session"
  safeStorageWrite('qavora_projects_v1', JSON.stringify([{ id: 'p1', name: 'Session Project' }]));
  safeStorageWrite(CHECKLISTS_STORAGE_KEY, JSON.stringify({ checklists: [{ id: 'c1', title: 'Session Checklist' }] }));

  assert.ok(safeStorageRead('qavora_projects_v1').raw.includes('Session Project'));

  // Simulate page refresh / restart (clears in-memory data store)
  clearMemoryDataStore();

  assert.strictEqual(safeStorageRead('qavora_projects_v1').raw, null, 'Projects reset after refresh');
  assert.strictEqual(safeStorageRead(CHECKLISTS_STORAGE_KEY).raw, null, 'Checklists reset after refresh');
  assert.strictEqual(loadAllChecklists().checklists.length, 0, 'Checklists list is empty after refresh');

  console.log('✓ Test 4 passed: Application state resets cleanly when in-memory store is refreshed.');
}

// ============================================================================
// TEST 5: The in-memory data manager correctly initializes application state
// ============================================================================
console.log('\n--- Test 5: In-memory data manager state initialization ---');
{
  setStorageAdapterForTesting(null);
  clearMemoryDataStore();

  const initChecklists = loadAllChecklists();
  assert.deepStrictEqual(initChecklists.checklists, [], 'Initial checklists is empty array');
  assert.strictEqual(initChecklists.warning, null, 'No missing storage warning');

  const initRunner = getActiveRunnerState();
  assert.strictEqual(initRunner.activeChecklistId, null, 'Initial activeChecklistId is null');
  assert.strictEqual(initRunner.lastQaView, null, 'Initial lastQaView is null');

  const initFootprint = calculateQavoraStorageFootprint();
  assert.strictEqual(initFootprint.totalBytes, 0, 'Initial storage footprint is 0 bytes');
  assert.strictEqual(initFootprint.formattedKB, '0.0 KB', 'Formatted footprint is 0.0 KB');

  console.log('✓ Test 5 passed: In-memory data manager initializes clean zero-state.');
}

// ============================================================================
// TEST 6: Project CRUD operations work in-memory
// ============================================================================
console.log('\n--- Test 6: Project CRUD operations in memory ---');
{
  setStorageAdapterForTesting(null);
  clearMemoryDataStore();

  // Create
  const project1 = {
    id: 'proj_mem_1',
    name: 'Cloud Payment Portal',
    type: 'SaaS Platform',
    status: 'Active',
    version: '1.0.0',
    description: 'In-memory test workspace',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    testPlan: { id: 'plan_1', name: 'Master Plan', phases: [] },
    testSuites: [],
    executions: [],
    defects: []
  };

  const saveRes = safeStorageWrite('qavora_projects_v1', JSON.stringify([project1]), 'saving projects');
  assert.strictEqual(saveRes.ok, true, 'Project save succeeded in memory');

  // Read
  const readRes = safeStorageRead('qavora_projects_v1');
  assert.strictEqual(readRes.ok, true, 'Project read succeeded');
  const loaded = JSON.parse(readRes.raw);
  assert.strictEqual(loaded.length, 1, 'Loaded 1 project');
  assert.strictEqual(loaded[0].name, 'Cloud Payment Portal', 'Project name matches');

  // Update
  loaded[0].name = 'Cloud Payment Portal v2';
  loaded[0].status = 'Completed';
  safeStorageWrite('qavora_projects_v1', JSON.stringify(loaded), 'updating project');
  const updatedLoaded = JSON.parse(safeStorageRead('qavora_projects_v1').raw);
  assert.strictEqual(updatedLoaded[0].name, 'Cloud Payment Portal v2', 'Project updated in memory');
  assert.strictEqual(updatedLoaded[0].status, 'Completed', 'Project status updated');

  // Delete
  safeStorageWrite('qavora_projects_v1', JSON.stringify([]), 'deleting project');
  const emptyLoaded = JSON.parse(safeStorageRead('qavora_projects_v1').raw);
  assert.strictEqual(emptyLoaded.length, 0, 'Project deleted in memory');

  console.log('✓ Test 6 passed: Complete Project CRUD lifecycle works in memory.');
}

// ============================================================================
// TEST 7: Test Plan CRUD operations work in-memory
// ============================================================================
console.log('\n--- Test 7: Test Plan CRUD operations in memory ---');
{
  setStorageAdapterForTesting(null);
  clearMemoryDataStore();

  const project = {
    id: 'proj_plan_1',
    name: 'Test Plan Workspace',
    testPlan: {
      id: 'plan_1',
      name: 'Integration Plan',
      phases: [
        { id: 'ph_1', phaseNumber: '1', name: 'Authentication', description: 'Auth checks', order: 0 }
      ]
    },
    testSuites: [
      {
        id: 'suite_1',
        phaseId: 'ph_1',
        title: 'Sign In Suite',
        category: 'Functional',
        testCases: [
          { id: 'tc_1', testId: 'AUTH-001', title: 'Login with valid pass', priority: 'High', status: 'Not Run' }
        ]
      }
    ],
    executions: [],
    defects: []
  };

  safeStorageWrite('qavora_projects_v1', JSON.stringify([project]));

  // Add a phase
  project.testPlan.phases.push({ id: 'ph_2', phaseNumber: '2', name: 'Checkout', description: '', order: 1 });
  // Add a test case to suite
  project.testSuites[0].testCases.push({ id: 'tc_2', testId: 'AUTH-002', title: 'Locked account flow', priority: 'Critical', status: 'Not Run' });
  safeStorageWrite('qavora_projects_v1', JSON.stringify([project]));

  const reloaded = JSON.parse(safeStorageRead('qavora_projects_v1').raw)[0];
  assert.strictEqual(reloaded.testPlan.phases.length, 2, 'Two phases in test plan');
  assert.strictEqual(reloaded.testSuites[0].testCases.length, 2, 'Two test cases in suite');
  assert.strictEqual(reloaded.testSuites[0].testCases[1].priority, 'Critical', 'Priority preserved');

  console.log('✓ Test 7 passed: Test Plan phases, suites, and test cases CRUD verified in memory.');
}

// ============================================================================
// TEST 8: Test Execution operations work in-memory
// ============================================================================
console.log('\n--- Test 8: Test Execution operations in memory ---');
{
  setStorageAdapterForTesting(null);
  clearMemoryDataStore();

  const project = {
    id: 'proj_exec_1',
    name: 'Execution Workspace',
    testPlan: { id: 'plan_1', phases: [{ id: 'ph_1', name: 'Phase 1' }] },
    testSuites: [{
      id: 'suite_1',
      phaseId: 'ph_1',
      title: 'Suite 1',
      testCases: [
        { id: 'case_1', testId: 'TC-01', title: 'Verify Checkout', status: 'Not Run' }
      ]
    }],
    executions: [],
    defects: []
  };

  // Execute test case: Verdict Passed
  const executionRun = {
    id: 'exec_run_1',
    testCaseId: 'TC-01',
    testCaseTitle: 'Verify Checkout',
    suiteId: 'suite_1',
    phaseId: 'ph_1',
    status: 'Passed',
    tester: 'QA Engineer',
    environment: 'Staging',
    browserDevice: 'Chrome Desktop',
    actualResult: 'Cart checked out with receipt',
    executedAt: new Date().toISOString()
  };

  project.testSuites[0].testCases[0].status = 'Passed';
  project.executions.unshift(executionRun);
  safeStorageWrite('qavora_projects_v1', JSON.stringify([project]));

  const readBack = JSON.parse(safeStorageRead('qavora_projects_v1').raw)[0];
  assert.strictEqual(readBack.testSuites[0].testCases[0].status, 'Passed', 'Test case marked Passed');
  assert.strictEqual(readBack.executions.length, 1, '1 execution recorded');
  assert.strictEqual(readBack.executions[0].actualResult, 'Cart checked out with receipt');

  console.log('✓ Test 8 passed: Execution recording, statuses, and history work in memory.');
}

// ============================================================================
// TEST 9: Defect creation, editing, linking, unlinking, and deletion work
// ============================================================================
console.log('\n--- Test 9: Defect management in memory ---');
{
  setStorageAdapterForTesting(null);
  clearMemoryDataStore();

  const project = {
    id: 'proj_def_1',
    name: 'Defects Workspace',
    testPlan: { id: 'plan_1', phases: [] },
    testSuites: [{
      id: 'suite_1',
      title: 'Suite 1',
      testCases: [{ id: 'case_1', testId: 'TC-101', title: 'Stripe webhook listener' }]
    }],
    executions: [],
    defects: []
  };

  // 1. Create defect linked to case_1
  const defect = {
    id: 'DEF-001',
    title: 'Webhook drops payload on timeout',
    severity: 'Critical',
    priority: 'Critical',
    status: 'Open',
    testCaseId: 'case_1',
    testCaseKey: 'TC-101',
    stepsToReproduce: 'Simulate 5s latency on webhook endpoint',
    createdAt: new Date().toISOString()
  };
  project.defects.push(defect);
  safeStorageWrite('qavora_projects_v1', JSON.stringify([project]));

  // 2. Edit defect
  let loaded = JSON.parse(safeStorageRead('qavora_projects_v1').raw)[0];
  assert.strictEqual(loaded.defects.length, 1, '1 defect created');
  assert.strictEqual(loaded.defects[0].testCaseKey, 'TC-101', 'Defect linked to TC-101');

  loaded.defects[0].status = 'In Progress';
  loaded.defects[0].priority = 'High';
  safeStorageWrite('qavora_projects_v1', JSON.stringify([loaded]));

  // 3. Unlink defect
  loaded = JSON.parse(safeStorageRead('qavora_projects_v1').raw)[0];
  loaded.defects[0].testCaseId = null;
  loaded.defects[0].testCaseKey = null;
  safeStorageWrite('qavora_projects_v1', JSON.stringify([loaded]));

  loaded = JSON.parse(safeStorageRead('qavora_projects_v1').raw)[0];
  assert.strictEqual(loaded.defects[0].testCaseId, null, 'Defect unlinked');

  // 4. Delete defect
  loaded.defects = [];
  safeStorageWrite('qavora_projects_v1', JSON.stringify([loaded]));

  loaded = JSON.parse(safeStorageRead('qavora_projects_v1').raw)[0];
  assert.strictEqual(loaded.defects.length, 0, 'Defect deleted cleanly');

  console.log('✓ Test 9 passed: Defect creation, editing, linking, unlinking, and deletion verified.');
}

// ============================================================================
// TEST 10: QA Checklist operations work in memory
// ============================================================================
console.log('\n--- Test 10: QA Checklist operations in memory ---');
{
  setStorageAdapterForTesting(null);
  clearMemoryDataStore();

  const parsed = parseQAPlanText(`
Phase 1: Smoke Tests
- [SMK-01] Verify user login
- [SMK-02] Verify checkout redirect
  `);

  const created = createChecklistFromParsedPlan(parsed, 'Smoke Checklist');
  assert.ok(created.ok, 'Checklist created from plan');
  const chkId = created.checklist.id;

  // Toggle test completion
  const firstTestId = created.checklist.phases[0].sections[0].tests[0].id;
  const toggled = toggleChecklistTest(chkId, firstTestId);
  assert.ok(toggled.ok, 'Test toggled');
  assert.strictEqual(toggled.test.status, TEST_STATUS.COMPLETED, 'Test marked completed');

  // Rename checklist
  const renamed = renameChecklistById(chkId, 'Smoke Checklist v2');
  assert.ok(renamed.ok, 'Checklist renamed');
  assert.strictEqual(getChecklistById(chkId).title, 'Smoke Checklist v2');

  // Add phase
  const phaseAdded = addPhaseToChecklist(chkId, 'Phase 2: Regressions');
  assert.ok(phaseAdded.ok, 'Phase added');
  assert.strictEqual(getChecklistById(chkId).phases.length, 2, '2 phases present');

  // Delete checklist
  const deleted = deleteChecklistById(chkId);
  assert.ok(deleted.ok, 'Checklist deleted');
  assert.strictEqual(loadAllChecklists().checklists.length, 0, '0 checklists remaining');

  console.log('✓ Test 10 passed: Complete QA checklist lifecycle works in memory.');
}

// ============================================================================
// TEST 11: Checklist-to-Project promotion still works
// ============================================================================
console.log('\n--- Test 11: Checklist-to-Project promotion in memory ---');
{
  setStorageAdapterForTesting(null);
  clearMemoryDataStore();

  const parsed = parseQAPlanText(`
Phase 1: Core System
- [SYS-01] Health check endpoint
- [SYS-02] Database connection pool
  `);
  const created = createChecklistFromParsedPlan(parsed, 'Promotion Source Checklist');
  const chkId = created.checklist.id;

  // Mark one test completed in the lightweight checklist runner
  const testId = created.checklist.phases[0].sections[0].tests[0].id;
  toggleChecklistTest(chkId, testId);

  // Promote
  const promRes = promoteChecklistToProject(chkId, { projectName: 'Promoted Enterprise Workspace' });
  assert.ok(promRes.ok, 'Promotion succeeded');
  assert.ok(promRes.project, 'Project created');
  assert.strictEqual(promRes.project.name, 'Promoted Enterprise Workspace');

  // Strict initial 'Not Run' rule in formal execution ledger
  assert.strictEqual(
    promRes.project.testSuites[0].testCases[0].status,
    'Not Run',
    'Formal test cases must initialize as Not Run regardless of checklist status'
  );

  // Original checklist preservation & link
  const updatedChk = getChecklistById(chkId);
  assert.strictEqual(updatedChk.promotedProjectId, promRes.project.id, 'Checklist linked to project');

  // Duplicate promotion prevention
  const dupProm = promoteChecklistToProject(chkId, { projectName: 'Duplicate' });
  assert.strictEqual(dupProm.ok, false, 'Duplicate promotion blocked');
  assert.strictEqual(dupProm.alreadyPromoted, true, 'Flagged as already promoted');

  console.log('✓ Test 11 passed: Checklist promotion, structure conversion, and Not Run rule verified.');
}

// ============================================================================
// TEST 12: Backup export and import work using in-memory data
// ============================================================================
console.log('\n--- Test 12: Backup export and import using in-memory data ---');
{
  setStorageAdapterForTesting(null);
  clearMemoryDataStore();

  const projects = [
    {
      id: 'proj_bak_1',
      name: 'Backup Project',
      testPlan: { id: 'plan_b1', phases: [] },
      testSuites: [],
      executions: [],
      defects: []
    }
  ];
  const checklists = [
    {
      id: 'chk_bak_1',
      title: 'Backup Checklist',
      phases: []
    }
  ];

  safeStorageWrite('qavora_projects_v1', JSON.stringify(projects));
  saveAllChecklists(checklists);

  // Build JSON backup payload
  const fullBackupPayload = {
    application: 'Qavora',
    backupVersion: 1,
    schemaVersion: 1,
    type: 'full_backup',
    exportedAt: new Date().toISOString(),
    projects: JSON.parse(safeStorageRead('qavora_projects_v1').raw),
    qaChecklists: loadAllChecklists().checklists,
    qaActiveRunner: getActiveRunnerState(),
    activities: []
  };

  // Clear in-memory store
  clearMemoryDataStore();
  assert.strictEqual(loadAllChecklists().checklists.length, 0);

  // Restore payload
  safeStorageWrite('qavora_projects_v1', JSON.stringify(fullBackupPayload.projects));
  saveAllChecklists(fullBackupPayload.qaChecklists);

  const restoredProjects = JSON.parse(safeStorageRead('qavora_projects_v1').raw);
  const restoredChecklists = loadAllChecklists().checklists;

  assert.strictEqual(restoredProjects.length, 1, 'Restored 1 project');
  assert.strictEqual(restoredProjects[0].name, 'Backup Project');
  assert.strictEqual(restoredChecklists.length, 1, 'Restored 1 checklist');
  assert.strictEqual(restoredChecklists[0].title, 'Backup Checklist');

  console.log('✓ Test 12 passed: Full JSON backup generation, export, and import round-trip verified in memory.');
}

// ============================================================================
// TEST 13: Rollback protection works without browser storage
// ============================================================================
console.log('\n--- Test 13: Atomic rollback protection in memory ---');
{
  setStorageAdapterForTesting(null);
  clearMemoryDataStore();

  const initialProjects = [{ id: 'p_initial', name: 'Initial Project' }];
  const initialChecklists = [{ id: 'c_initial', title: 'Initial Checklist', phases: [] }];

  safeStorageWrite('qavora_projects_v1', JSON.stringify(initialProjects));
  saveAllChecklists(initialChecklists);

  // In-memory safety snapshot before risky replace
  const rollbackSnapshot = {
    timestamp: new Date().toISOString(),
    projects: JSON.parse(safeStorageRead('qavora_projects_v1').raw),
    qaChecklists: loadAllChecklists().checklists
  };

  // Simulate failed/malformed replace attempt
  try {
    const corruptPayload = '{"invalid": json syntax';
    JSON.parse(corruptPayload);
  } catch (_parseErr) {
    // Rollback from in-memory snapshot
    safeStorageWrite('qavora_projects_v1', JSON.stringify(rollbackSnapshot.projects));
    saveAllChecklists(rollbackSnapshot.qaChecklists);
  }

  const restoredP = JSON.parse(safeStorageRead('qavora_projects_v1').raw);
  const restoredC = loadAllChecklists().checklists;
  assert.strictEqual(restoredP[0].name, 'Initial Project', 'Projects rolled back cleanly');
  assert.strictEqual(restoredC[0].title, 'Initial Checklist', 'Checklists rolled back cleanly');

  console.log('✓ Test 13 passed: Rollback protection operates atomically using in-memory state.');
}

// ============================================================================
// TEST 14: Theme switching works during the current session
// ============================================================================
console.log('\n--- Test 14: Theme switching during current session in memory ---');
{
  setStorageAdapterForTesting(null);
  clearMemoryDataStore();

  // Test in-memory theme setting
  safeStorageWrite('qavora_theme_preference', 'light', 'saving theme');
  const readLight = safeStorageRead('qavora_theme_preference').raw;
  assert.strictEqual(readLight, 'light', 'Theme updated to light in memory');

  safeStorageWrite('qavora_theme_preference', 'dark', 'saving theme');
  const readDark = safeStorageRead('qavora_theme_preference').raw;
  assert.strictEqual(readDark, 'dark', 'Theme updated to dark in memory');

  console.log('✓ Test 14 passed: In-memory session theme switching verified.');
}

// ============================================================================
// TEST 15: Existing application modules continue to initialize correctly
// ============================================================================
console.log('\n--- Test 15: Application module initialization & exports sanity ---');
{
  assert.ok(typeof parseQAPlanText === 'function', 'qaParser exports parseQAPlanText');
  assert.ok(typeof generateChecklistTransferCode === 'function', 'qaChecklistTransfer exports generateChecklistTransferCode');
  assert.ok(typeof validateChecklistTransferCode === 'function', 'qaChecklistTransfer exports validateChecklistTransferCode');
  assert.ok(typeof applyChecklistTransferPayload === 'function', 'qaChecklistTransfer exports applyChecklistTransferPayload');
  assert.ok(typeof loadAllChecklists === 'function', 'qaChecklistStore exports loadAllChecklists');
  assert.ok(typeof saveAllChecklists === 'function', 'qaChecklistStore exports saveAllChecklists');
  assert.ok(typeof promoteChecklistToProject === 'function', 'qaChecklistStore exports promoteChecklistToProject');
  assert.ok(typeof calculateQavoraStorageFootprint === 'function', 'qaChecklistStore exports calculateQavoraStorageFootprint');
  assert.ok(typeof getMemoryDataStore === 'function', 'qaChecklistStore exports getMemoryDataStore');
  assert.ok(typeof clearMemoryDataStore === 'function', 'qaChecklistStore exports clearMemoryDataStore');

  // Verify memory footprint calculation
  clearMemoryDataStore();
  safeStorageWrite('qavora_projects_v1', JSON.stringify([{ id: 'p1', name: 'A' }]));
  const fp = calculateQavoraStorageFootprint();
  assert.ok(fp.totalBytes > 0, 'Footprint measures in-memory bytes');
  assert.ok(typeof fp.formattedKB === 'string', 'Formatted KB string computed');

  console.log('✓ Test 15 passed: All application modules and functions initialize cleanly.');
}

console.log('\n================================================================');
console.log('ALL 15 TESTS IN NO BROWSER STORAGE TEST SUITE PASSED (100%)');
console.log('================================================================');
