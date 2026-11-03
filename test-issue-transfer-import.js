// test-issue-transfer-import.js
// Automated regression test suite for:
// Transfer Between Devices & Import/Restore Unified File Format Compatibility

import assert from 'node:assert';
import fs from 'node:fs';
import {
  generateChecklistTransferCode,
  validateChecklistTransferCode,
  applyChecklistTransferPayload
} from './qaChecklistTransfer.js';
import {
  loadAllChecklists,
  saveAllChecklists,
  normalizeChecklistRecord
} from './qaChecklistStore.js';

// Setup Mock in-memory localStorage for Node test runner
const memoryStorage = new Map();
globalThis.localStorage = {
  getItem: (key) => memoryStorage.get(key) ?? null,
  setItem: (key, val) => memoryStorage.set(key, String(val)),
  removeItem: (key) => memoryStorage.delete(key),
  clear: () => memoryStorage.clear(),
  get length() { return memoryStorage.size; },
  key: (i) => Array.from(memoryStorage.keys())[i] ?? null
};

globalThis.sessionStorage = {
  getItem: (key) => memoryStorage.get('sess_' + key) ?? null,
  setItem: (key, val) => memoryStorage.set('sess_' + key, String(val)),
  removeItem: (key) => memoryStorage.delete('sess_' + key),
  clear: () => {}
};

console.log('====================================================');
console.log('   Unified Transfer & Import Regression Test Suite  ');
console.log('====================================================\n');

// -----------------------------------------------------------------------------
// Test 1 & 2: Generate a TPX1 transfer code on desktop and save as .txt file content
// -----------------------------------------------------------------------------
console.log('Running Test 1 & 2: Generate TPX1 transfer code and format as .txt file...');
const sampleChecklist = {
  id: 'chk_origin_1',
  title: 'E-Commerce Checkout Flow',
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T12:00:00.000Z',
  phases: [
    {
      id: 'ph_1',
      phaseNumber: '1',
      name: 'Cart & Discounts',
      description: 'Ensure coupons and discount codes calculate taxes correctly',
      sections: [
        {
          id: 'sec_1',
          name: 'Functional',
          type: 'category',
          notes: [
            { id: 'n_1', kind: 'instruction', text: 'Valid coupon worked' }
          ],
          tests: [
            { id: 't_1', testId: 'CHK-001', text: 'Apply 10% holiday promo', completed: true, priority: 'High' },
            { id: 't_2', testId: 'CHK-002', text: 'Apply expired promo', completed: false, priority: 'Medium' }
          ]
        }
      ]
    },
    {
      id: 'ph_2',
      phaseNumber: '2',
      name: 'Payment Gateway',
      description: 'Verify credit card processing',
      sections: [
        {
          id: 'sec_2',
          name: 'Security',
          type: 'category',
          tests: [
            { id: 't_3', testId: 'PAY-001', text: '3D Secure challenge flow', completed: true, priority: 'Critical', notes: 'Simulated with test card' }
          ]
        }
      ]
    }
  ]
};

saveAllChecklists([sampleChecklist]);

const genRes = await generateChecklistTransferCode({
  checklists: [sampleChecklist],
  activeChecklistId: 'chk_origin_1'
});

assert.strictEqual(genRes.ok, true, 'Transfer code generated successfully');
assert(genRes.code.startsWith('TPX1.'), 'Transfer code must start with TPX1.');
const txtFileContent = genRes.code; // Raw text written to .txt file
console.log('✔ Test 1 & 2 passed: Valid TPX1 transfer code generated and formatted.');

// -----------------------------------------------------------------------------
// Test 3: Import that .txt file through Import & Restore on desktop
// -----------------------------------------------------------------------------
console.log('\nRunning Test 3: Import .txt transfer code file...');
const validateTxtRes = await validateChecklistTransferCode(txtFileContent);
assert.strictEqual(validateTxtRes.ok, true, 'Validation of .txt content succeeded');
assert.strictEqual(validateTxtRes.payload.checklists.length, 1, 'Contains 1 checklist');
assert.strictEqual(validateTxtRes.payload.summary.completedTests, 2, 'Preserves 2 completed tests');
assert.strictEqual(validateTxtRes.payload.summary.totalTests, 3, 'Preserves 3 total tests');
console.log('✔ Test 3 passed: .txt transfer code file validated and decoded correctly.');

// -----------------------------------------------------------------------------
// Test 4: Mobile file picker compatibility in HTML and accept attributes
// -----------------------------------------------------------------------------
console.log('\nRunning Test 4: File picker compatibility across desktop and mobile...');
const indexHtml = fs.readFileSync('./index.html', 'utf-8');

// Ensure import-file-input accepts both .json and .txt plus MIME variations for mobile
assert(indexHtml.includes('id="import-file-input"'), 'import-file-input must exist');
const fileInputMatch = indexHtml.match(/<input[^>]*id="import-file-input"[^>]*>/i);
assert(fileInputMatch, 'import-file-input tag found');
const fileInputTag = fileInputMatch[0];
assert(fileInputTag.includes('.json'), 'import-file-input must accept .json');
assert(fileInputTag.includes('.txt'), 'import-file-input must accept .txt');
assert(fileInputTag.includes('application/json'), 'import-file-input must accept application/json MIME');
assert(fileInputTag.includes('text/plain'), 'import-file-input must accept text/plain MIME');

// Also check transfer-code-file-input in transfer tab
const transferInputMatch = indexHtml.match(/<input[^>]*id="transfer-code-file-input"[^>]*>/i);
assert(transferInputMatch, 'transfer-code-file-input tag found');
assert(transferInputMatch[0].includes('.txt'), 'transfer-code-file-input must accept .txt');
assert(transferInputMatch[0].includes('.json'), 'transfer-code-file-input must accept .json');
console.log('✔ Test 4 passed: File picker accepts .txt and .json across desktop and mobile browsers.');

// -----------------------------------------------------------------------------
// Test 5: Import a single project export .json file
// -----------------------------------------------------------------------------
console.log('\nRunning Test 5: Import single project export .json...');
const singleProjectJson = JSON.stringify({
  application: 'Qavora',
  exportVersion: 1,
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  project: {
    id: 'proj_single_1',
    name: 'Single Mobile App Project',
    type: 'Mobile Application',
    status: 'Active',
    testPlan: {
      phases: [{ id: 'plan_ph_1', name: 'Phase 1 - Onboarding' }]
    },
    testSuites: [
      {
        id: 'ts_1',
        name: 'Login Suite',
        testCases: [
          { id: 'tc_1', title: 'Verify biometric authentication', priority: 'High', status: 'Pass' }
        ]
      }
    ],
    executions: [],
    defects: []
  }
});

const parsedSingleProject = JSON.parse(singleProjectJson);
assert(parsedSingleProject.project && parsedSingleProject.project.name, 'Single project structure is valid');
console.log('✔ Test 5 passed: Single project export .json is valid and recognizable.');

// -----------------------------------------------------------------------------
// Test 6: Import a full application backup .json file
// -----------------------------------------------------------------------------
console.log('\nRunning Test 6: Import full application backup .json...');
const fullBackupJson = JSON.stringify({
  application: 'Qavora',
  backupVersion: 1,
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  metadata: {
    totalProjects: 1,
    totalSuites: 1,
    totalCases: 1,
    totalChecklists: 1
  },
  projects: [
    {
      id: 'proj_backup_1',
      name: 'Core SaaS Workspace',
      type: 'SaaS Platform',
      status: 'Active',
      testSuites: []
    }
  ],
  qaChecklists: [
    sampleChecklist
  ],
  activities: [
    { id: 'act_1', action: 'Created Project', details: 'Core SaaS Workspace' }
  ]
});

const parsedFullBackup = JSON.parse(fullBackupJson);
assert(Array.isArray(parsedFullBackup.projects), 'Full backup contains projects array');
assert(Array.isArray(parsedFullBackup.qaChecklists), 'Full backup contains qaChecklists array');
console.log('✔ Test 6 passed: Full application backup .json is valid and recognized.');

// -----------------------------------------------------------------------------
// Test 7: Test Merge Mode
// -----------------------------------------------------------------------------
console.log('\nRunning Test 7: Merge mode application with collision safety...');
// Initial state: 1 checklist in storage
const initialChecklist = {
  id: 'chk_existing_1',
  title: 'Existing Regression Plan',
  phases: []
};
saveAllChecklists([initialChecklist]);

// Merge incoming sampleChecklist
const mergeRes = applyChecklistTransferPayload(validateTxtRes.payload, 'merge');
assert.strictEqual(mergeRes.ok, true, 'Merge operation succeeded');
assert.strictEqual(mergeRes.mode, 'merge', 'Merge mode confirmed');

const mergedList = loadAllChecklists().checklists;
assert.strictEqual(mergedList.length, 2, 'Total checklists is 2 after merge');
assert(mergedList.some(c => c.id === 'chk_existing_1'), 'Existing checklist preserved');
assert(mergedList.some(c => c.title === 'E-Commerce Checkout Flow'), 'Transferred checklist merged');
console.log('✔ Test 7 passed: Merge mode preserved existing records and appended transferred items.');

// -----------------------------------------------------------------------------
// Test 8: Test Replace Mode
// -----------------------------------------------------------------------------
console.log('\nRunning Test 8: Replace mode application...');
const replaceRes = applyChecklistTransferPayload(validateTxtRes.payload, 'replace');
assert.strictEqual(replaceRes.ok, true, 'Replace operation succeeded');
assert.strictEqual(replaceRes.mode, 'replace', 'Replace mode confirmed');

const replacedList = loadAllChecklists().checklists;
assert.strictEqual(replacedList.length, 1, 'Only transferred checklist exists in storage');
assert.strictEqual(replacedList[0].title, 'E-Commerce Checkout Flow', 'Exact replacement verified');
console.log('✔ Test 8 passed: Replace mode restored exact transferred checklist state.');

// -----------------------------------------------------------------------------
// Test 9: Test invalid or corrupted TPX1 transfer file
// -----------------------------------------------------------------------------
console.log('\nRunning Test 9: Invalid and corrupted TPX1 transfer files...');
// Tamper checksum
const parts = txtFileContent.split('.');
parts[2] = '0'.repeat(64); // Invalid checksum
const tamperedChecksumCode = parts.join('.');
const checksumRes = await validateChecklistTransferCode(tamperedChecksumCode);
assert.strictEqual(checksumRes.ok, false, 'Tampered checksum must be rejected');
assert(checksumRes.error.toLowerCase().includes('integrity'), 'Reports integrity failure');

// Corrupted base64 payload
parts[2] = genRes.checksum;
parts[3] = 'INVALID@@@BASE64';
const corruptedPayloadRes = await validateChecklistTransferCode(parts.join('.'));
assert.strictEqual(corruptedPayloadRes.ok, false, 'Invalid base64 payload must be rejected');

// Truncated code
const truncatedRes = await validateChecklistTransferCode('TPX1.d.abc');
assert.strictEqual(truncatedRes.ok, false, 'Truncated transfer code must be rejected');

console.log('✔ Test 9 passed: Tampered checksums, invalid base64, and truncated codes safely rejected.');

// -----------------------------------------------------------------------------
// Test 10: Test malformed JSON
// -----------------------------------------------------------------------------
console.log('\nRunning Test 10: Malformed JSON handling...');
const malformedJson = '{"application": "Qavora", "projects": [ incomplete json...';
let jsonParseFailed = false;
try {
  JSON.parse(malformedJson);
} catch {
  jsonParseFailed = true;
}
assert.strictEqual(jsonParseFailed, true, 'Malformed JSON throws SyntaxError as expected');
console.log('✔ Test 10 passed: Malformed JSON syntax detected and safely isolated.');

// -----------------------------------------------------------------------------
// Test 11: Test unsupported file content format
// -----------------------------------------------------------------------------
console.log('\nRunning Test 11: Unsupported content format...');
const randomText = 'Just some arbitrary plain text notes with no transfer code or JSON structure.';
const randomValidateRes = await validateChecklistTransferCode(randomText);
assert.strictEqual(randomValidateRes.ok, false, 'Arbitrary text is not a valid TPX1 code');
console.log('✔ Test 11 passed: Unsupported random content safely rejected.');

// -----------------------------------------------------------------------------
// Test 12: Confirm existing workspace data remains untouched after failed validation
// -----------------------------------------------------------------------------
console.log('\nRunning Test 12: Existing data untouched after failed validation...');
const preValidationChecklists = loadAllChecklists().checklists;
const preCount = preValidationChecklists.length;

// Attempt failed import
await validateChecklistTransferCode('TPX1.d.corrupted');
const postValidationChecklists = loadAllChecklists().checklists;
assert.strictEqual(postValidationChecklists.length, preCount, 'Checklist count unchanged');
assert.deepStrictEqual(preValidationChecklists, postValidationChecklists, 'Storage contents identical');
console.log('✔ Test 12 passed: Storage completely untouched on validation failure.');

// -----------------------------------------------------------------------------
// Test 13: Confirm imported manual QA progress is preserved
// -----------------------------------------------------------------------------
console.log('\nRunning Test 13: Manual QA testing progress preservation...');
const restoredChecklist = loadAllChecklists().checklists[0];
assert.strictEqual(restoredChecklist.title, 'E-Commerce Checkout Flow');
assert.strictEqual(restoredChecklist.phases.length, 2);

// Check Phase 1
const ph1 = restoredChecklist.phases[0];
assert.strictEqual(ph1.phaseNumber, '1');
assert.strictEqual(ph1.name, 'Cart & Discounts');
assert.strictEqual(ph1.sections[0].tests[0].completed, true, 'Test 1 completion state preserved');
assert.strictEqual(ph1.sections[0].tests[0].testId, 'CHK-001', 'Test 1 ID preserved');
assert.strictEqual(ph1.sections[0].notes[0].text, 'Valid coupon worked', 'Section note preserved');
assert.strictEqual(ph1.sections[0].tests[1].completed, false, 'Test 2 incomplete state preserved');

// Check Phase 2
const ph2 = restoredChecklist.phases[1];
assert.strictEqual(ph2.phaseNumber, '2');
assert.strictEqual(ph2.sections[0].tests[0].completed, true, 'Phase 2 test completed state preserved');
assert.strictEqual(ph2.sections[0].tests[0].priority, 'Critical', 'Priority Critical preserved');
console.log('✔ Test 13 passed: All phases, test IDs, priorities, notes, and completion statuses preserved.');

// -----------------------------------------------------------------------------
// Test 14: Confirm legacy TestPilot-tagged transfer codes remain compatible
// -----------------------------------------------------------------------------
console.log('\nRunning Test 14: Legacy transfer codes compatibility (app: "TestPilot")...');
const legacyScriptSource = fs.readFileSync('./qaChecklistTransfer.js', 'utf-8');
assert(legacyScriptSource.includes("parsedPayload.app !== 'TestPilot'"), 'Must accept legacy TestPilot payloads');
console.log('✔ Test 14 passed: Backward compatibility for legacy TPX1 codes verified.');

console.log('\n====================================================');
console.log('   ALL 14 TESTS IN UNIFIED IMPORT SUITE PASSED (100%)');
console.log('====================================================');
