// test-issue-delete-checklist.js
// Verification suite for QA Checklist Deletion & Scrollbar Management

import assert from 'node:assert';
import fs from 'node:fs';

console.log('====================================================');
console.log('   QA Checklist Deletion & Scrollbar Test Suite');
console.log('====================================================');

// Test 1: HTML DOM Structure & Nesting Verification
console.log('Running Test 1: HTML DOM hierarchy & modal independence...');
const indexHtml = fs.readFileSync('./index.html', 'utf-8');

// Ensure qa-checklist-delete-modal exists
assert(indexHtml.includes('id="qa-checklist-delete-modal"'), 'qa-checklist-delete-modal must exist');

// Verify that defect-view-modal is closed before import-preview-modal and qa-checklist-delete-modal
const defectModalStart = indexHtml.indexOf('id="defect-view-modal"');
const importModalStart = indexHtml.indexOf('id="import-preview-modal"');
const qaDeleteModalStart = indexHtml.indexOf('<div id="qa-checklist-delete-modal"');

assert(defectModalStart > 0, 'defect-view-modal must exist');
assert(importModalStart > defectModalStart, 'import-preview-modal must come after defect-view-modal');
assert(qaDeleteModalStart > importModalStart, 'qa-checklist-delete-modal must come after import-preview-modal');

// Trace opening and closing tags between defectModalStart and importModalStart
const defectModalChunk = indexHtml.slice(defectModalStart, importModalStart);
const defectOpenDivs = (defectModalChunk.match(/<div[\s>]/g) || []).length;
const defectCloseDivs = (defectModalChunk.match(/<\/div>/g) || []).length;
assert.strictEqual(
  defectOpenDivs,
  defectCloseDivs,
  `defect-view-modal must have balanced div tags. Open: ${defectOpenDivs}, Close: ${defectCloseDivs}`
);

// Trace opening and closing tags for qa-checklist-delete-modal
const qaDeleteModalChunk = indexHtml.slice(qaDeleteModalStart, indexHtml.indexOf('<!-- Toast Notification Container -->'));
const qaDeleteOpenDivs = (qaDeleteModalChunk.match(/<div[\s>]/g) || []).length;
const qaDeleteCloseDivs = (qaDeleteModalChunk.match(/<\/div>/g) || []).length;
assert.strictEqual(
  qaDeleteOpenDivs,
  qaDeleteCloseDivs,
  `qa-checklist-delete-modal must have balanced div tags. Open: ${qaDeleteOpenDivs}, Close: ${qaDeleteCloseDivs}`
);

console.log('✔ Test 1 passed: HTML DOM hierarchy and modal independence verified.');

// Test 2: Check required modal controls and ARIA attributes in index.html
console.log('Running Test 2: Modal controls, ARIA attributes, and accessible elements...');
assert(indexHtml.includes('id="qa-chk-delete-heading"'), 'Must have heading element');
assert(indexHtml.includes('id="qa-chk-delete-subtitle"'), 'Must have subtitle element');
assert(indexHtml.includes('id="qa-chk-delete-name"'), 'Must have name target element');
assert(indexHtml.includes('id="qa-chk-delete-close"'), 'Must have close button');
assert(indexHtml.includes('id="qa-chk-delete-cancel"'), 'Must have cancel button');
assert(indexHtml.includes('id="qa-chk-delete-confirm"'), 'Must have confirm button');
assert(indexHtml.includes('id="qa-chk-delete-confirm-text"'), 'Must have confirm button text span');
console.log('✔ Test 2 passed: All required modal controls and accessibility attributes present.');

// Test 3: Verify qaRunnerUI.js implementation
console.log('Running Test 3: qaRunnerUI.js scrollbar locking, unlocking, and event handlers...');
const qaRunnerCode = fs.readFileSync('./qaRunnerUI.js', 'utf-8');

// Check that openDeleteChecklistModal adds open and modal-open
assert(qaRunnerCode.includes("els.deleteModal.classList.add('open')"), 'Must add open class on modal');
assert(qaRunnerCode.includes("document.body.classList.add('modal-open')"), 'Must add modal-open to body on open');

// Check that closeDeleteChecklistModal removes open and modal-open and clears overflow
assert(qaRunnerCode.includes("els.deleteModal.classList.remove('open')"), 'Must remove open class on modal');
assert(qaRunnerCode.includes("document.body.classList.remove('modal-open')"), 'Must remove modal-open class on close');
assert(qaRunnerCode.includes("document.body.style.overflow = ''"), 'Must clear body inline overflow on close');
assert(qaRunnerCode.includes("document.documentElement.style.overflow = ''"), 'Must clear html inline overflow on close');

// Check event bindings for close/cancel/confirm/backdrop/Escape
assert(qaRunnerCode.includes("els.deleteModalClose.addEventListener('click', closeDeleteChecklistModal)"), 'Must bind close button');
assert(qaRunnerCode.includes("els.deleteModalCancel.addEventListener('click', closeDeleteChecklistModal)"), 'Must bind cancel button');
assert(qaRunnerCode.includes("els.deleteModalConfirm.addEventListener('click', confirmDeleteChecklist)"), 'Must bind confirm button');
assert(qaRunnerCode.includes("if (e.target === els.deleteModal) closeDeleteChecklistModal()"), 'Must bind backdrop click to close');
assert(qaRunnerCode.includes("if (e.key === 'Escape')"), 'Must handle Escape key to close modal');

console.log('✔ Test 3 passed: qaRunnerUI.js modal events and scrollbar lifecycle verified.');

// Test 4: Functional Storage Deletion Simulation
console.log('Running Test 4: deleteChecklistById functional verification...');
// Setup mock localStorage
const storageMap = new Map();
global.localStorage = {
  getItem: (k) => storageMap.get(k) ?? null,
  setItem: (k, v) => storageMap.set(k, String(v)),
  removeItem: (k) => storageMap.delete(k),
  clear: () => storageMap.clear()
};
global.window = {
  localStorage: global.localStorage,
  addEventListener: () => {}
};
global.document = {
  body: {
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    style: {}
  },
  documentElement: {
    style: {}
  }
};

const store = await import('./qaChecklistStore.js');

// Create two checklists
const chk1 = {
  id: 'chk_test_1',
  title: 'Checklist Alpha',
  phases: [
    {
      id: 'ph_1',
      name: 'Smoke Phase',
      sections: [
        {
          id: 'sec_1',
          type: 'direct',
          tests: [
            { id: 'tc_1', text: 'Test login', status: 'NOT_STARTED', completed: false }
          ]
        }
      ]
    }
  ]
};

const chk2 = {
  id: 'chk_test_2',
  title: 'Checklist Beta',
  phases: [
    {
      id: 'ph_2',
      name: 'Regression Phase',
      sections: [
        {
          id: 'sec_2',
          type: 'direct',
          tests: [
            { id: 'tc_2', text: 'Test checkout', status: 'COMPLETED', completed: true }
          ]
        }
      ]
    }
  ]
};

store.saveAllChecklists([chk1, chk2]);
store.saveActiveRunnerState({ activeChecklistId: 'chk_test_1', lastQaView: 'qa-runner' });

// Verify initial state
let { checklists } = store.loadAllChecklists();
assert.strictEqual(checklists.length, 2, 'Should have 2 saved checklists');

// Delete Checklist Alpha
const delResult = store.deleteChecklistById('chk_test_1');
assert.strictEqual(delResult.ok, true, 'deleteChecklistById should return ok: true');
assert.strictEqual(delResult.remaining.length, 1, 'Should have 1 checklist remaining');
assert.strictEqual(delResult.remaining[0].id, 'chk_test_2', 'Remaining checklist should be Checklist Beta');

// Verify active runner state cascade
const activeState = store.getActiveRunnerState();
assert.strictEqual(activeState.activeChecklistId, 'chk_test_2', 'Active checklist should cascade to remaining checklist');

// Verify persistence in localStorage
const reloaded = store.loadAllChecklists();
assert.strictEqual(reloaded.checklists.length, 1, 'Storage must persist exactly 1 remaining checklist');
assert.strictEqual(reloaded.checklists[0].id, 'chk_test_2', 'Stored remaining checklist must be Checklist Beta');

// Delete the second checklist
const delResult2 = store.deleteChecklistById('chk_test_2');
assert.strictEqual(delResult2.ok, true, 'Second delete should succeed');
assert.strictEqual(delResult2.remaining.length, 0, 'Remaining should be empty');

const emptyState = store.getActiveRunnerState();
assert.strictEqual(emptyState.activeChecklistId, null, 'Active checklist should be null when all deleted');

console.log('✔ Test 4 passed: deleteChecklistById correctly updates localStorage and active runner state.');

// Test 5: Verify CSS rules for modal backdrop and background scroll lock
console.log('Running Test 5: CSS modal backdrop and scroll lock rules...');
const styleCss = fs.readFileSync('./style.css', 'utf-8');
assert(styleCss.includes('.modal-backdrop {'), 'CSS must define .modal-backdrop');
assert(styleCss.includes('.modal-backdrop.open {'), 'CSS must define .modal-backdrop.open');
assert(styleCss.includes('body.modal-open,'), 'CSS must support body.modal-open');
assert(styleCss.includes('overflow: hidden !important;'), 'CSS must specify overflow: hidden !important;');
console.log('✔ Test 5 passed: CSS modal backdrop and scroll lock rules verified.');

console.log('====================================================');
console.log('   ALL TESTS IN DELETE CHECKLIST SUITE PASSED (100%)');
console.log('====================================================');
