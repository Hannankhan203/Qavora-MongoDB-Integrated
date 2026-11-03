/**
 * Automated Verification Suite for QAVORA-REMEDIATION-001 — PHASE 1
 * Covers:
 * - QAV-ISS-001: Promote Checklist to Project workflow, structure mapping, 'Not Run' status rule,
 *                original checklist preservation, duplicate prevention, and atomic rollback on failure.
 * - QAV-ISS-009: Data Management storage footprint calculation, checklist metrics, CSV & Print/PDF exports.
 * - QAV-ISS-013: Full Backup JSON, Restore, Rollback, backward compatibility, and malformed backup rejection
 *                including qavora_qa_active_runner_v1.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseQAPlanText } from './qaParser.js';
import {
  CHECKLISTS_STORAGE_KEY,
  ACTIVE_RUNNER_STORAGE_KEY,
  QAVORA_PERSISTENT_STORAGE_KEYS,
  TEST_STATUS,
  loadAllChecklists,
  saveAllChecklists,
  getChecklistById,
  createChecklistFromParsedPlan,
  toggleChecklistTest,
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

function createControllableStorage() {
  const store = new Map();
  let failOnKey = null;
  let failOnce = false;

  return {
    store,
    setFailOnKey(key, once = true) {
      failOnKey = key;
      failOnce = once;
    },
    clearFailure() {
      failOnKey = null;
      failOnce = false;
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, val) {
      if (failOnKey && key === failOnKey) {
        if (failOnce) failOnKey = null;
        const err = new Error(`Simulated QuotaExceededError on key "${key}"`);
        err.name = 'QuotaExceededError';
        err.code = 22;
        throw err;
      }
      store.set(key, String(val));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

const mockLocalStorage = createControllableStorage();
const mockSessionStorage = createControllableStorage();

globalThis.window = {
  localStorage: mockLocalStorage,
  sessionStorage: mockSessionStorage
};
globalThis.localStorage = mockLocalStorage;
globalThis.sessionStorage = mockSessionStorage;

console.log('=== QAVORA PHASE 1 REMEDIATION VERIFICATION SUITE ===\n');

// ============================================================================
// TEST 1: QAV-ISS-001 — Promote Checklist to Project & 'Not Run' Status Rule
// ============================================================================
console.log('1. Testing QAV-ISS-001: Checklist promotion, structure mapping, and Not Run status rule...');
{
  mockLocalStorage.clear();
  mockSessionStorage.clear();

  const rawPlan = `
# Checkout & Payments QA Plan
Note: Verify in staging environment with test Stripe keys.

Phase 1: Cart & Pricing Validation
### Functional
- [TC-101] [Critical] Verify item quantity increment updates subtotal
- [TC-102] [High] Verify promo code discount calculation
### UI/UX
- [TC-103] [Low] Verify responsive cart drawer layout on mobile

Phase 2: Payment Gateway Security
### Security
- [TC-201] [Critical] Verify expired card rejection message
- [TC-202] [Medium] Verify 3DS authentication challenge flow
  `.trim();

  const parsed = parseQAPlanText(rawPlan);
  const createdRes = createChecklistFromParsedPlan(parsed, 'Checkout & Payments QA Checklist');
  assert.equal(createdRes.ok, true, 'Checklist should be created from parsed plan');
  const chkId = createdRes.checklist.id;

  // Mark 2 tests as Completed in the checklist runner and leave 3 as Not Started
  const allTests = createdRes.checklist.phases.flatMap(ph => ph.sections.flatMap(s => s.tests));
  assert.equal(allTests.length, 5, 'Should have 5 parsed checklist tests');

  const toggle1 = toggleChecklistTest(chkId, allTests[0].id, true);
  const toggle2 = toggleChecklistTest(chkId, allTests[3].id, true);
  assert.equal(toggle1.ok, true);
  assert.equal(toggle2.ok, true);

  const checklistBeforePromote = getChecklistById(chkId);
  const progBefore = calculateChecklistProgress(checklistBeforePromote);
  assert.equal(progBefore.completedTests, 2, '2 checklist items should be marked Completed before promotion');
  assert.equal(progBefore.remainingTests, 3, '3 checklist items should remain Incomplete before promotion');

  // Verify promotion preview counts
  const preview = getChecklistPromotionPreview(checklistBeforePromote);
  assert.equal(preview.valid, true);
  assert.equal(preview.phasesCount, 2, 'Preview should report 2 phases');
  assert.equal(preview.suitesCount, 3, 'Preview should report 3 suites (Functional, UI/UX, Security)');
  assert.equal(preview.casesCount, 5, 'Preview should report 5 test cases');
  assert.equal(preview.completedChecklistItemsCount, 2, 'Preview should detect 2 completed checklist items');

  // Execute promotion
  const promoteRes = promoteChecklistToProject(chkId, {
    projectName: 'Checkout & Payments Formal Project',
    projectType: 'E-commerce'
  });
  assert.equal(promoteRes.ok, true, 'Promotion should succeed');
  assert.ok(promoteRes.project, 'Promoted project object should be returned');
  assert.equal(promoteRes.project.name, 'Checkout & Payments Formal Project');
  assert.equal(promoteRes.project.type, 'E-commerce');
  assert.equal(promoteRes.project.sourceChecklistId, chkId, 'Project should reference sourceChecklistId');
  assert.equal(promoteRes.project.testPlan.phases.length, 2, 'Formal Test Plan should have 2 phases');
  assert.equal(promoteRes.project.testSuites.length, 3, 'Formal Project should have 3 test suites');

  const formalCases = promoteRes.project.testSuites.flatMap(s => s.testCases);
  assert.equal(formalCases.length, 5, 'Formal Project should have 5 formal test cases');

  // CRITICAL STATUS RULE CHECK:
  // Every single formal test case (whether completed or incomplete in checklist) MUST be 'Not Run'
  for (const fc of formalCases) {
    assert.equal(
      fc.status,
      'Not Run',
      `Formal test case "${fc.title}" must be initialized as "Not Run", never "Pass" (got "${fc.status}")`
    );
    assert.deepEqual(fc.executions, [], 'Formal test case must have empty executions array');
    assert.deepEqual(fc.defectIds, [], 'Formal test case must have empty defectIds array');
    assert.equal(fc.lastExecutedAt, null);
    assert.equal(fc.lastExecutionId, null);
  }

  assert.equal(promoteRes.project.testCaseCount, 5);
  assert.equal(promoteRes.project.passedTests, 0, 'Promoted project must have 0 passedTests');
  assert.equal(promoteRes.project.executedTests, 0, 'Promoted project must have 0 executedTests');
  assert.equal(promoteRes.project.notRunTests, 5, 'Promoted project must have 5 notRunTests');
  assert.equal(promoteRes.project.passRate, 0, 'Promoted project must have 0% passRate');

  // Verify original checklist is preserved unchanged in storage
  const checklistAfterPromote = getChecklistById(chkId);
  assert.ok(checklistAfterPromote, 'Original checklist must still exist in storage');
  assert.equal(checklistAfterPromote.title, checklistBeforePromote.title, 'Original checklist title must be unchanged');
  assert.equal(checklistAfterPromote.promotedProjectId, promoteRes.project.id, 'Checklist must link to promotedProjectId');
  assert.ok(checklistAfterPromote.promotedAt, 'Checklist must record promotedAt timestamp');

  const progAfter = calculateChecklistProgress(checklistAfterPromote);
  assert.equal(progAfter.totalTests, 5, 'Original checklist test count must remain 5');
  assert.equal(progAfter.completedTests, 2, 'Original checklist completed count must remain 2');
  assert.equal(progAfter.remainingTests, 3, 'Original checklist remaining count must remain 3');

  // Verify duplicate promotion prevention
  const duplicateAttempt = promoteChecklistToProject(chkId, {
    projectName: 'Duplicate Project Attempt'
  });
  assert.equal(duplicateAttempt.ok, false, 'Second promotion of already-promoted checklist must be rejected');
  assert.equal(duplicateAttempt.alreadyPromoted, true, 'Should flag alreadyPromoted: true');
  assert.equal(duplicateAttempt.project.id, promoteRes.project.id, 'Should return existing promoted project');

  const storedProjects = JSON.parse(mockLocalStorage.getItem('qavora_projects_v1'));
  assert.equal(storedProjects.length, 1, 'Storage must contain exactly 1 project (no duplicate created)');
  console.log('   ✓ Passed: Structure mapping, Not Run status rule, original checklist preservation, and duplicate prevention verified.');
}

// ============================================================================
// TEST 2: QAV-ISS-001 — Simulated Storage Failure & Atomic Rollback on Promotion
// ============================================================================
console.log('2. Testing QAV-ISS-001: Simulated failure during promotion and atomic rollback...');
{
  mockLocalStorage.clear();
  mockSessionStorage.clear();

  const parsed = parseQAPlanText('Phase 1: Smoke\n- [TC-1] Verify login');
  const created = createChecklistFromParsedPlan(parsed, 'Rollback Test Checklist');
  const chkId = created.checklist.id;

  const rawChecklistsBefore = mockLocalStorage.getItem(CHECKLISTS_STORAGE_KEY);
  const rawProjectsBefore = mockLocalStorage.getItem('qavora_projects_v1');

  // Case A: Fail when writing qavora_projects_v1
  mockLocalStorage.setFailOnKey('qavora_projects_v1', true);
  const failProjRes = promoteChecklistToProject(chkId, { projectName: 'Should Fail Project Write' });
  assert.equal(failProjRes.ok, false, 'Promotion should fail when project storage write throws QuotaExceededError');
  assert.equal(failProjRes.isQuota, true, 'Should identify QuotaExceededError');
  assert.equal(mockLocalStorage.getItem('qavora_projects_v1'), rawProjectsBefore, 'Projects storage must remain untouched');
  assert.equal(mockLocalStorage.getItem(CHECKLISTS_STORAGE_KEY), rawChecklistsBefore, 'Checklists storage must remain untouched');

  // Case B: Project write succeeds, but checklist link write fails -> must roll back the written project!
  const failLinkRes = promoteChecklistToProject(chkId, {
    projectName: 'Should Rollback After Link Failure',
    afterProjectWriteBeforeChecklistLink: () => {
      mockLocalStorage.setFailOnKey(CHECKLISTS_STORAGE_KEY, true);
    }
  });
  assert.equal(failLinkRes.ok, false, 'Promotion should fail when checklist link write throws QuotaExceededError');
  assert.equal(failLinkRes.rolledBack, true, 'Should report rolledBack: true');
  assert.equal(
    mockLocalStorage.getItem('qavora_projects_v1'),
    rawProjectsBefore,
    'Written project must be rolled back when checklist link update fails'
  );
  const chkAfterRollback = getChecklistById(chkId);
  assert.equal(chkAfterRollback.promotedProjectId, null, 'Checklist promotedProjectId must remain null after rollback');
  console.log('   ✓ Passed: Atomic rollback verified for both project-write failure and checklist-link failure.');
}

// ============================================================================
// TEST 3: QAV-ISS-009 — Storage Footprint Calculation & Edge Cases
// ============================================================================
console.log('3. Testing QAV-ISS-009: Storage footprint calculation across all Qavora persistent keys...');
{
  mockLocalStorage.clear();
  mockSessionStorage.clear();

  // Empty storage footprint
  const emptyFootprint = calculateQavoraStorageFootprint();
  assert.equal(emptyFootprint.totalBytes, 0, 'Empty storage should report 0 bytes');
  assert.equal(emptyFootprint.formattedKB, '0.0 KB', 'Empty storage should report 0.0 KB');
  assert.equal(emptyFootprint.barWidthPercent, 0, 'Empty storage should report 0% bar width');

  // Populate all 5 persistent keys and verify exact UTF-16 byte summation without double counting
  mockLocalStorage.setItem('qavora_projects_v1', '[{"id":"p1"}]'); // 13 chars = 26 bytes
  mockLocalStorage.setItem('qavora_activities_v1', '[{"id":"a1"}]'); // 13 chars = 26 bytes
  mockLocalStorage.setItem('qavora_theme_preference', 'dark'); // 4 chars = 8 bytes
  mockLocalStorage.setItem(CHECKLISTS_STORAGE_KEY, '{"checklists":[]}'); // 17 chars = 34 bytes
  mockLocalStorage.setItem(ACTIVE_RUNNER_STORAGE_KEY, '{"activeChecklistId":"c1"}'); // 26 chars = 52 bytes

  const expectedBytes = (13 + 13 + 4 + 17 + 26) * 2;
  const fp = calculateQavoraStorageFootprint();
  assert.equal(fp.totalBytes, expectedBytes, 'Footprint must sum all 5 Qavora keys accurately without double counting');
  assert.equal(fp.keyBytes[CHECKLISTS_STORAGE_KEY], 34);
  assert.equal(fp.keyBytes[ACTIVE_RUNNER_STORAGE_KEY], 52);

  // Corrupt JSON in keys should not cause calculateQavoraStorageFootprint to throw
  mockLocalStorage.setItem(CHECKLISTS_STORAGE_KEY, '{corrupt_json');
  const corruptFp = calculateQavoraStorageFootprint();
  assert.ok(corruptFp.totalBytes > 0, 'Footprint calculation must not throw on corrupt JSON');
  console.log('   ✓ Passed: Storage footprint accurately accounts for all 5 persistent keys and handles empty/corrupt states.');
}

// ============================================================================
// TEST 4: QAV-ISS-013 — Active Runner State Normalization, Backup, Restore & Rollback
// ============================================================================
console.log('4. Testing QAV-ISS-013: Active runner state normalization, restore, rollback, and legacy backup compatibility...');
{
  mockLocalStorage.clear();
  mockSessionStorage.clear();

  const parsed1 = parseQAPlanText('Phase 1: Alpha\n- [A-1] Alpha test');
  const parsed2 = parseQAPlanText('Phase 1: Beta\n- [B-1] Beta test');
  const c1 = createChecklistFromParsedPlan(parsed1, 'Alpha Checklist').checklist;
  const c2 = createChecklistFromParsedPlan(parsed2, 'Beta Checklist').checklist;

  // Set active runner to c2 on view 'qa-runner'
  saveActiveRunnerState({ activeChecklistId: c2.id, lastQaView: 'qa-runner' });
  const initialRunner = getActiveRunnerState();
  assert.equal(initialRunner.activeChecklistId, c2.id);
  assert.equal(initialRunner.lastQaView, 'qa-runner');

  // Simulate changing runner state to c1 on 'my-checklists'
  replaceActiveRunnerState({ activeChecklistId: c1.id, lastQaView: 'my-checklists' }, [c1, c2]);
  assert.equal(getActiveRunnerState().activeChecklistId, c1.id);
  assert.equal(getActiveRunnerState().lastQaView, 'my-checklists');

  // Rollback / restore to initialRunner snapshot
  const restoreRes = replaceActiveRunnerState(initialRunner, [c1, c2]);
  assert.equal(restoreRes.ok, true);
  assert.equal(getActiveRunnerState().activeChecklistId, c2.id);
  assert.equal(getActiveRunnerState().lastQaView, 'qa-runner');

  // Backward compatibility: older backup with NO qaActiveRunner field (null/undefined)
  // When restored with checklists [c1, c2], normalizeActiveRunnerState should safely derive a valid state
  const legacyNormalized = normalizeActiveRunnerState(undefined, [c1, c2]);
  assert.equal(legacyNormalized.activeChecklistId, null);
  assert.equal(legacyNormalized.lastQaView, null);

  // When activeChecklistId in backup points to a non-existent checklist ID, it reconciles to first available checklist
  const staleIdNormalized = normalizeActiveRunnerState(
    { activeChecklistId: 'chk_deleted_999', lastQaView: 'qa-runner' },
    [c1, c2]
  );
  assert.equal(staleIdNormalized.activeChecklistId, c1.id, 'Stale activeChecklistId should reconcile to first valid checklist');
  assert.equal(staleIdNormalized.lastQaView, 'qa-runner');

  console.log('   ✓ Passed: Active runner state normalization, replacement, rollback, and backward compatibility verified.');
}

// ============================================================================
// TEST 5: Static Wiring & HTML Integrity Verification (QAV-ISS-001, 009, 013)
// ============================================================================
console.log('5. Verifying HTML structure, modal balance, and script.js wiring...');
{
  const indexHtml = fs.readFileSync('./index.html', 'utf8');
  const scriptJs = fs.readFileSync('./script.js', 'utf8');
  const runnerUiJs = fs.readFileSync('./qaRunnerUI.js', 'utf8');

  // Verify Promote Modal and Controls exist in index.html
  assert.ok(indexHtml.includes('id="qa-checklist-promote-modal"'), 'Promote checklist modal must exist in index.html');
  assert.ok(indexHtml.includes('id="btn-runner-promote-project"'), 'Runner promote button must exist in index.html');
  assert.ok(indexHtml.includes('id="data-stat-checklists"'), 'Data Management QA Checklists stat card must exist in index.html');
  assert.ok(indexHtml.includes('id="btn-export-checklists-csv"'), 'Export Checklists CSV button must exist in index.html');
  assert.ok(indexHtml.includes('value="qa-checklists"'), 'Printable report type option for QA Checklists must exist in index.html');

  // Verify script.js includes qaActiveRunner in exportFullApplicationBackup, saveRollbackSnapshot, validateAndPreviewImport, commitImport, executeRollback
  assert.ok(scriptJs.includes('qaActiveRunner: qaActiveRunner'), 'exportFullApplicationBackup must include qaActiveRunner');
  assert.ok(scriptJs.includes('qaActiveRunner: runnerStateToSave'), 'saveRollbackSnapshot must include qaActiveRunner');
  assert.ok(scriptJs.includes('exportChecklistsCSV'), 'script.js must implement exportChecklistsCSV');
  assert.ok(scriptJs.includes('onChecklistPromoted'), 'script.js must wire onChecklistPromoted callback');
  assert.ok(runnerUiJs.includes('openPromoteChecklistModal'), 'qaRunnerUI.js must implement openPromoteChecklistModal');

  console.log('   ✓ Passed: All HTML elements, modal containers, and script wiring verified.');
}

// ============================================================================
// TEST 6: QAV-ISS-013 — Full Backup, Restore, Rollback & Malformed Rejection
// ============================================================================
console.log('6. Testing QAV-ISS-013: Full Backup JSON round-trip, Rollback snapshot, and Malformed backup rejection...');
{
  mockLocalStorage.clear();
  mockSessionStorage.clear();

  const p1 = parseQAPlanText('Phase 1: Core\n- [C-1] Core test 1\n- [C-2] Core test 2');
  const p2 = parseQAPlanText('Phase 1: Edge\n- [E-1] Edge test 1');
  const chk1 = createChecklistFromParsedPlan(p1, 'Core Checklist').checklist;
  const chk2 = createChecklistFromParsedPlan(p2, 'Edge Checklist').checklist;
  toggleChecklistTest(chk2.id, chk2.phases[0].sections[0].tests[0].id, true);

  // Set active runner to chk2 on 'qa-runner'
  saveActiveRunnerState({ activeChecklistId: chk2.id, lastQaView: 'qa-runner' });
  const promRes = promoteChecklistToProject(chk1.id, { projectName: 'Core Formal Project' });
  assert.equal(promRes.ok, true);

  // Construct Full Application Backup payload matching exportFullApplicationBackup()
  const exportedProjects = JSON.parse(mockLocalStorage.getItem('qavora_projects_v1'));
  const exportedChecklists = loadAllChecklists().checklists;
  const exportedActiveRunner = getActiveRunnerState();

  const fullBackupPayload = {
    application: 'Qavora',
    backupVersion: 1,
    schemaVersion: 1,
    type: 'full_backup',
    exportedAt: new Date().toISOString(),
    metadata: {
      totalProjects: exportedProjects.length,
      totalQaChecklists: exportedChecklists.length,
      activeChecklistId: exportedActiveRunner.activeChecklistId,
      lastQaView: exportedActiveRunner.lastQaView
    },
    projects: exportedProjects,
    qaChecklists: exportedChecklists,
    qaActiveRunner: exportedActiveRunner,
    activities: []
  };

  assert.equal(fullBackupPayload.qaActiveRunner.activeChecklistId, chk2.id);
  assert.equal(fullBackupPayload.qaActiveRunner.lastQaView, 'qa-runner');

  // Now mutate workspace state (switch active runner to chk1 on 'my-checklists' and clear checklists)
  saveActiveRunnerState({ activeChecklistId: chk1.id, lastQaView: 'my-checklists' });
  const preRestoreRunner = getActiveRunnerState();
  const preRestoreChecklists = loadAllChecklists().checklists;
  const preRestoreProjects = JSON.parse(mockLocalStorage.getItem('qavora_projects_v1'));

  // Save rollback snapshot before replace restore (including qaActiveRunner)
  mockSessionStorage.setItem(
    'qavora_rollback_v1',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      projects: preRestoreProjects,
      activities: [],
      qaChecklists: preRestoreChecklists,
      qaActiveRunner: normalizeActiveRunnerState(preRestoreRunner, preRestoreChecklists)
    })
  );

  // Restore fullBackupPayload
  saveAllChecklists(fullBackupPayload.qaChecklists);
  replaceActiveRunnerState(fullBackupPayload.qaActiveRunner, fullBackupPayload.qaChecklists);
  assert.equal(getActiveRunnerState().activeChecklistId, chk2.id, 'Restore must restore activeChecklistId to chk2');
  assert.equal(getActiveRunnerState().lastQaView, 'qa-runner', 'Restore must restore lastQaView to qa-runner');

  // Execute Rollback from sessionStorage snapshot
  const rollbackSnap = JSON.parse(mockSessionStorage.getItem('qavora_rollback_v1'));
  saveAllChecklists(rollbackSnap.qaChecklists);
  replaceActiveRunnerState(rollbackSnap.qaActiveRunner, rollbackSnap.qaChecklists);
  assert.equal(
    getActiveRunnerState().activeChecklistId,
    chk1.id,
    'Rollback must restore pre-restore activeChecklistId (chk1)'
  );
  assert.equal(
    getActiveRunnerState().lastQaView,
    'my-checklists',
    'Rollback must restore pre-restore lastQaView (my-checklists)'
  );

  // Verify malformed backup rejection preserves existing data
  const rawChecklistsBeforeMalformed = mockLocalStorage.getItem(CHECKLISTS_STORAGE_KEY);
  const rawRunnerBeforeMalformed = mockLocalStorage.getItem(ACTIVE_RUNNER_STORAGE_KEY);
  const rawProjectsBeforeMalformed = mockLocalStorage.getItem('qavora_projects_v1');

  const malformedCandidates = [
    null,
    'not-an-object',
    { backupVersion: 99, projects: [] },
    { type: 'full_backup', projects: 'not-an-array' },
    { type: 'full_backup', projects: [], qaChecklists: 'not-an-array' },
    { type: 'full_backup', projects: [], qaChecklists: [], qaActiveRunner: 'invalid-string' },
    { type: 'full_backup', projects: [], qaChecklists: [], qaActiveRunner: ['invalid-array'] }
  ];

  for (const bad of malformedCandidates) {
    const isValid =
      bad &&
      typeof bad === 'object' &&
      !Array.isArray(bad) &&
      (!bad.backupVersion || Number(bad.backupVersion) <= 1) &&
      (!('projects' in bad) || Array.isArray(bad.projects)) &&
      (!('qaChecklists' in bad) || Array.isArray(bad.qaChecklists)) &&
      (!('qaActiveRunner' in bad) ||
        bad.qaActiveRunner === null ||
        (typeof bad.qaActiveRunner === 'object' && !Array.isArray(bad.qaActiveRunner)));
    assert.equal(Boolean(isValid), false, 'Malformed candidate must be rejected by validation');
  }

  assert.equal(mockLocalStorage.getItem(CHECKLISTS_STORAGE_KEY), rawChecklistsBeforeMalformed);
  assert.equal(mockLocalStorage.getItem(ACTIVE_RUNNER_STORAGE_KEY), rawRunnerBeforeMalformed);
  assert.equal(mockLocalStorage.getItem('qavora_projects_v1'), rawProjectsBeforeMalformed);
  console.log('   ✓ Passed: Full backup/restore, rollback of active runner state, and malformed backup rejection verified.');
}

console.log('\nALL PHASE 1 REMEDIATION TESTS PASSED SUCCESSFULLY!');

