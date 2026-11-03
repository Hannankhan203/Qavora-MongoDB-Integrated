/**
 * Automated Behavioral Verification Suite for QAVORA-REMEDIATION-002 — PHASE 2
 * Covers:
 * - QAV-ISS-002: Execution Modal — Pass All Steps / Reset Steps crash fix,
 *                step status model ('completed' / 'untested' / 'failed'),
 *                empty step arrays, null/closed modal context guards,
 *                individual step interactions, and formal execution save workflow.
 * - QAV-ISS-003: Test Execution — Phase, Suite, Status, Priority, and Category filters
 *                (individual, dependent phase->suite, 5-filter combined + search,
 *                reset filters, dropdown-to-State synchronization, and empty state).
 * - QAV-ISS-008: Suite Cases Explorer — Priority & Category filter reset fix
 *                (DOM.caseFilterPriority / DOM.caseFilterCategory synchronization,
 *                individual & combined filtering, and Reset Filters button behavior).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as checklistGeneratorUI from './checklistGeneratorUI.js';
import * as qaRunnerUI from './qaRunnerUI.js';
import * as qaChecklistTransferUI from './qaChecklistTransferUI.js';
import * as qaChecklistTransfer from './qaChecklistTransfer.js';
import * as qaChecklistStore from './qaChecklistStore.js';

// ============================================================================
// Lightweight DOM + Browser Harness for Executing script.js Behavioral Flows
// ============================================================================

function createStorageMock() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
    clear() {
      map.clear();
    }
  };
}

function createElementStub(tagName = 'div', id = '') {
  const listeners = new Map();
  const attrs = new Map();
  if (id) attrs.set('id', id);
  const classSet = new Set();
  let _innerHTML = '';
  let _textContent = '';
  let _value = '';
  let _dynamicChildren = [];

  const el = {
    tagName: tagName.toUpperCase(),
    id,
    dataset: {},
    style: {
      display: '',
      width: '',
      backgroundColor: '',
      borderColor: ''
    },
    disabled: false,
    checked: false,
    files: [],
    classList: {
      add(...tokens) {
        tokens.forEach(t => t && classSet.add(t));
      },
      remove(...tokens) {
        tokens.forEach(t => classSet.delete(t));
      },
      toggle(token, force) {
        if (force === undefined) {
          if (classSet.has(token)) {
            classSet.delete(token);
            return false;
          }
          classSet.add(token);
          return true;
        }
        if (force) classSet.add(token);
        else classSet.delete(token);
        return Boolean(force);
      },
      contains(token) {
        return classSet.has(token);
      }
    },
    get className() {
      return Array.from(classSet).join(' ');
    },
    set className(val) {
      classSet.clear();
      String(val || '')
        .split(/\s+/)
        .filter(Boolean)
        .forEach(c => classSet.add(c));
    },
    get value() {
      return _value;
    },
    set value(val) {
      _value = val !== undefined && val !== null ? String(val) : '';
    },
    get textContent() {
      return _textContent;
    },
    set textContent(val) {
      _textContent = val !== undefined && val !== null ? String(val) : '';
      _innerHTML = _textContent;
    },
    get innerHTML() {
      return _innerHTML;
    },
    set innerHTML(val) {
      _innerHTML = val !== undefined && val !== null ? String(val) : '';
      _textContent = _innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      _dynamicChildren = parseDynamicChildrenFromHTML(_innerHTML);
      // If this is a <select>, default value to first option if current value is empty
      if (el.tagName === 'SELECT') {
        const opts = _dynamicChildren.filter(c => c.tagName === 'OPTION');
        if (opts.length > 0 && !_value) {
          _value = opts[0].getAttribute('value') ?? '';
        }
      }
    },
    get options() {
      return _dynamicChildren.filter(c => c.tagName === 'OPTION');
    },
    setAttribute(name, val) {
      const strVal = String(val);
      attrs.set(name, strVal);
      if (name === 'id') el.id = strVal;
      if (name === 'class') el.className = strVal;
      if (name === 'value') el.value = strVal;
      if (name.startsWith('data-')) {
        const camel = name
          .slice(5)
          .replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        el.dataset[camel] = strVal;
      }
    },
    getAttribute(name) {
      if (name === 'id') return el.id || null;
      if (name === 'class') return el.className || null;
      return attrs.has(name) ? attrs.get(name) : null;
    },
    removeAttribute(name) {
      attrs.delete(name);
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(evt) {
      const eventObj = {
        type: evt.type,
        target: evt.target || el,
        currentTarget: el,
        preventDefault() {},
        stopPropagation() {},
        ...evt
      };
      const handlers = listeners.get(eventObj.type) || [];
      for (const h of handlers) {
        h.call(el, eventObj);
      }
      if (eventObj.type === 'click' && typeof el.onclick === 'function') {
        el.onclick.call(el, eventObj);
      }
    },
    click() {
      el.dispatchEvent({ type: 'click', target: el });
    },
    focus() {},
    reset() {
      _value = '';
    },
    scrollIntoView() {},
    closest(selector) {
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        if (el.classList.contains(cls)) return el;
      }
      return null;
    },
    querySelectorAll(selector) {
      return matchSelectorInChildren(_dynamicChildren, selector);
    },
    querySelector(selector) {
      const matches = matchSelectorInChildren(_dynamicChildren, selector);
      return matches[0] || null;
    },
    appendChild(child) {
      _dynamicChildren.push(child);
      return child;
    }
  };

  return el;
}

function parseAttributes(attrString) {
  const result = {};
  const attrRegex = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = attrRegex.exec(attrString)) !== null) {
    result[m[1]] = m[2];
  }
  return result;
}

function parseDynamicChildrenFromHTML(html) {
  const children = [];
  if (!html) return children;

  // Parse <option>, <button>, <input>, <tr>, <div> with classes or data attributes
  const tagRegex = /<(option|button|input|tr|div)\b([^>]*)>([\s\S]*?)<\/\1>|<(input)\b([^>]*)\/?>/gi;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const tag = (match[1] || match[4] || 'div').toLowerCase();
    const attrStr = match[2] || match[5] || '';
    const inner = match[3] || '';
    const parsedAttrs = parseAttributes(attrStr);
    const child = createElementStub(tag, parsedAttrs.id || '');
    for (const [k, v] of Object.entries(parsedAttrs)) {
      child.setAttribute(k, v);
    }
    if (inner && tag === 'option') {
      child.textContent = inner.replace(/<[^>]+>/g, '').trim();
    } else if (inner && tag !== 'input') {
      // Do not recurse infinitely, just preserve text and parse nested buttons/inputs if container
      child.textContent = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    children.push(child);
  }

  // Also scan specifically for nested buttons/inputs inside cards/rows/divs that regex above might have consumed inside outer <div> or <tr>
  const nestedInteractiveRegex = /<(button|input)\b([^>]*)(?:>([\s\S]*?)<\/\1>|\/?>)/gi;
  let nestedMatch;
  while ((nestedMatch = nestedInteractiveRegex.exec(html)) !== null) {
    const tag = nestedMatch[1].toLowerCase();
    const attrStr = nestedMatch[2] || '';
    const parsedAttrs = parseAttributes(attrStr);
    // Avoid duplicating if already added with same attributes
    const alreadyExists = children.some(
      c =>
        c.tagName.toLowerCase() === tag &&
        c.getAttribute('class') === (parsedAttrs.class || null) &&
        c.getAttribute('data-step-index') === (parsedAttrs['data-step-index'] || null) &&
        c.getAttribute('data-case-id') === (parsedAttrs['data-case-id'] || null)
    );
    if (!alreadyExists) {
      const child = createElementStub(tag, parsedAttrs.id || '');
      for (const [k, v] of Object.entries(parsedAttrs)) {
        child.setAttribute(k, v);
      }
      children.push(child);
    }
  }

  return children;
}

function matchSelectorInChildren(children, selector) {
  const sel = selector.trim();
  return children.filter(child => {
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return child.classList.contains(cls);
    }
    if (sel.startsWith('#')) {
      return child.id === sel.slice(1);
    }
    return child.tagName.toLowerCase() === sel.toLowerCase();
  });
}

function createQavoraTestEnvironment() {
  const indexHtml = fs.readFileSync('./index.html', 'utf8');
  const scriptSource = fs.readFileSync('./script.js', 'utf8');

  const elementsById = new Map();
  const allElements = [];

  // Extract all elements with id="..." from index.html
  const idTagRegex = /<([a-zA-Z0-9-]+)\b([^>]*?\bid="([^"]+)"[^>]*)>/g;
  let match;
  while ((match = idTagRegex.exec(indexHtml)) !== null) {
    const tagName = match[1];
    const attrStr = match[2];
    const id = match[3];
    const el = createElementStub(tagName, id);
    const attrs = parseAttributes(attrStr);
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
    elementsById.set(id, el);
    allElements.push(el);
  }

  // Populate initial <option> values for static <select> elements in index.html
  const selectBlockRegex = /<select\b[^>]*?\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi;
  let selMatch;
  while ((selMatch = selectBlockRegex.exec(indexHtml)) !== null) {
    const selId = selMatch[1];
    const selInner = selMatch[2];
    const selEl = elementsById.get(selId);
    if (selEl) {
      selEl.innerHTML = selInner;
      const selectedOpt = selEl.options.find(o => o.getAttribute('selected') !== null) || selEl.options[0];
      if (selectedOpt) {
        selEl.value = selectedOpt.getAttribute('value') ?? '';
      }
    }
  }

  const localStorage = createStorageMock();
  const sessionStorage = createStorageMock();

  const documentStub = {
    readyState: 'complete',
    documentElement: createElementStub('html'),
    body: createElementStub('body'),
    getElementById(id) {
      return elementsById.get(id) || null;
    },
    querySelector(selector) {
      if (selector.startsWith('#')) {
        return elementsById.get(selector.slice(1)) || null;
      }
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        return allElements.find(e => e.classList.contains(cls)) || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        return allElements.filter(e => e.classList.contains(cls));
      }
      return [];
    },
    createElement(tag) {
      return createElementStub(tag);
    },
    addEventListener() {}
  };

  const windowStub = {
    localStorage,
    sessionStorage,
    document: documentStub,
    location: { href: 'http://localhost:3000/', reload() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    URL: {
      createObjectURL: () => 'blob:mock',
      revokeObjectURL: () => {}
    },
    Blob: class MockBlob {
      constructor(parts, opts) {
        this.parts = parts;
        this.opts = opts;
      }
    },
    addEventListener() {},
    scrollTo() {},
    setTimeout,
    clearTimeout
  };

  // Transform top-level ES module imports in script.js so it can run inside node:vm
  // and expose internal controller functions/State/DOM via __qavoraTestHook
  const transformedScript = scriptSource
    .replace(/import\s+\{[\s\S]*?\}\s+from\s+['"]\.\/checklistGeneratorUI\.js['"];?/, '')
    .replace(/import\s+\{[\s\S]*?\}\s+from\s+['"]\.\/qaRunnerUI\.js['"];?/, '')
    .replace(/import\s+\{[\s\S]*?\}\s+from\s+['"]\.\/qaChecklistTransferUI\.js['"];?/, '')
    .replace(/import\s+\{[\s\S]*?\}\s+from\s+['"]\.\/qaChecklistTransfer\.js['"];?/, '')
    .replace(/import\s+\{[\s\S]*?\}\s+from\s+['"]\.\/qaChecklistStore\.js['"];?/, '')
    .replace(
      /if\s*\(\s*document\.readyState\s*===\s*['"]loading['"]\s*\)\s*\{[\s\S]*?\}\s*else\s*\{\s*init\(\);\s*\}/,
      `init();
      globalThis.__qavoraTestHook = {
        State,
        DOM,
        Storage,
        openExecutionModal,
        closeExecutionModal,
        renderExecutionStepsList,
        handleExecStatusChange,
        handleSaveExecutionSubmit,
        renderTestExecutionWorkspace,
        resetExecFilters,
        renderSuiteCasesExplorer,
        openSuiteCasesView,
        resetCaseFilters,
        switchView
      };`
    );

  const sandbox = {
    window: windowStub,
    document: documentStub,
    localStorage,
    sessionStorage,
    navigator: windowStub.navigator,
    URL: windowStub.URL,
    Blob: windowStub.Blob,
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
    // Injected module exports
    initChecklistGenerator: () => ({}),
    initQARunnerAndChecklists: () => ({
      openChecklistInRunner() {},
      refreshGlobalBadgesAndBanners() {},
      syncFromStorage() {},
      getRestoredInitialView: () => null
    }),
    initQAChecklistTransferUI: () => ({}),
    ...qaChecklistTransfer,
    ...qaChecklistStore
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(transformedScript, sandbox, { filename: 'script.js' });

  return {
    hook: sandbox.__qavoraTestHook,
    elementsById,
    localStorage,
    sessionStorage
  };
}

function createSampleProjectFixture() {
  return {
    id: 'proj_phase2_test',
    name: 'Phase 2 Verification Project',
    type: 'Web App',
    description: 'Comprehensive fixture for Phase 2 execution modal, execution filters, and suite cases explorer',
    status: 'Active',
    version: '2.4.0',
    createdAt: '2025-02-01T10:00:00.000Z',
    updatedAt: '2025-02-01T10:00:00.000Z',
    testPlan: {
      objective: 'Verify Phase 2 remediations',
      scope: 'Execution runner and filters',
      environment: 'Staging',
      entryCriteria: 'Build deployed',
      exitCriteria: 'All critical tests passed',
      phases: [
        {
          id: 'ph_1',
          phaseNumber: 1,
          name: 'Phase 1: Authentication & Security',
          description: 'Auth and security verification',
          order: 1,
          status: 'In Progress'
        },
        {
          id: 'ph_2',
          phaseNumber: 2,
          name: 'Phase 2: Checkout & API',
          description: 'Checkout and API verification',
          order: 2,
          status: 'Planned'
        }
      ]
    },
    testSuites: [
      {
        id: 'suite_auth',
        phaseId: 'ph_1',
        name: 'Authentication Suite',
        module: 'Auth',
        description: 'Login and MFA tests',
        priority: 'Critical',
        createdAt: '2025-02-01T10:00:00.000Z',
        updatedAt: '2025-02-01T10:00:00.000Z',
        testCases: [
          {
            id: 'TC-101',
            title: 'Verify valid user login with MFA',
            description: 'Standard MFA login flow',
            module: 'Auth',
            category: 'Functional',
            priority: 'Critical',
            preconditions: 'User has MFA enabled',
            steps: [
              { id: 'st_1', stepNumber: 1, action: 'Enter valid email and password', testData: 'qa@example.com' },
              { id: 'st_2', stepNumber: 2, action: 'Submit login form', testData: '' },
              { id: 'st_3', stepNumber: 3, action: 'Enter 6-digit TOTP code', testData: '123456' }
            ],
            expectedResult: 'User is authenticated and redirected to dashboard',
            status: 'Pass',
            executions: ['exec_initial_1'],
            defectIds: [],
            lastExecutedAt: '2025-02-02T10:00:00.000Z',
            lastExecutionId: 'exec_initial_1'
          },
          {
            id: 'TC-102',
            title: 'Verify SQL injection protection on login',
            description: 'Attempt SQL injection payload',
            module: 'Auth',
            category: 'Security',
            priority: 'High',
            preconditions: 'Login page accessible',
            steps: [
              { id: 'st_201', stepNumber: 1, action: 'Input SQL payload in email field', testData: "' OR 1=1 --" },
              { id: 'st_202', stepNumber: 2, action: 'Click Sign In', testData: '' }
            ],
            expectedResult: 'Input rejected safely with generic validation error',
            status: 'Fail',
            executions: [],
            defectIds: [],
            lastExecutedAt: '2025-02-02T11:00:00.000Z',
            lastExecutionId: null
          },
          {
            id: 'TC-103',
            title: 'Verify password reset rate limiting',
            description: 'Step-less test case for empty step array verification',
            module: 'Auth',
            category: 'Performance',
            priority: 'Medium',
            preconditions: 'Rate limiter active',
            steps: [],
            expectedResult: 'HTTP 429 returned after 5 rapid requests',
            status: 'Blocked',
            executions: [],
            defectIds: [],
            lastExecutedAt: null,
            lastExecutionId: null
          }
        ]
      },
      {
        id: 'suite_checkout',
        phaseId: 'ph_2',
        name: 'Checkout & Payments Suite',
        module: 'Checkout',
        description: 'Cart, checkout, and webhook tests',
        priority: 'High',
        createdAt: '2025-02-01T10:00:00.000Z',
        updatedAt: '2025-02-01T10:00:00.000Z',
        testCases: [
          {
            id: 'TC-201',
            title: 'Verify mobile checkout button alignment',
            description: 'Responsive layout check',
            module: 'Checkout',
            category: 'UI/UX',
            priority: 'Low',
            preconditions: 'Cart has 1 item',
            steps: [
              { id: 'st_301', stepNumber: 1, action: 'Open cart drawer on 375px viewport', testData: 'iPhone SE' }
            ],
            expectedResult: 'Checkout button remains sticky and full-width',
            status: 'Skipped',
            executions: [],
            defectIds: [],
            lastExecutedAt: null,
            lastExecutionId: null
          },
          {
            id: 'TC-202',
            title: 'Verify Stripe payment intent creation API',
            description: 'POST /api/payment-intents validation',
            module: 'Checkout',
            category: 'API',
            priority: 'Critical',
            preconditions: 'Valid session token',
            steps: [
              { id: 'st_401', stepNumber: 1, action: 'Send POST request to /api/payment-intents', testData: '{"amount": 4999}' },
              { id: 'st_402', stepNumber: 2, action: 'Inspect response status and client_secret', testData: '' }
            ],
            expectedResult: 'Returns HTTP 200 with valid client_secret',
            status: 'Not Run',
            executions: [],
            defectIds: [],
            lastExecutedAt: null,
            lastExecutionId: null
          }
        ]
      }
    ],
    executions: [],
    defects: []
  };
}

console.log('=== QAVORA PHASE 2 REMEDIATION VERIFICATION SUITE ===\n');

// ============================================================================
// TEST GROUP 1 — Execution Modal Steps (QAV-ISS-002)
// ============================================================================
console.log('Test Group 1: Execution Modal Steps (QAV-ISS-002)...');
{
  const { hook } = createQavoraTestEnvironment();
  const {
    State,
    DOM,
    Storage,
    openExecutionModal,
    closeExecutionModal,
    handleSaveExecutionSubmit
  } = hook;

  const sampleProject = createSampleProjectFixture();
  Storage.saveProjects([sampleProject]);

  // 1A. Guard behavior when no modal context is open (missing/closed modal context)
  State.modalExecContext = null;
  assert.doesNotThrow(() => {
    DOM.btnPassAllSteps.click();
    DOM.btnResetAllSteps.click();
  }, 'Clicking Pass All Steps or Reset Steps when modalExecContext is null must not throw');

  // 1B. Open Execution Modal for a test case with 3 steps (TC-101)
  openExecutionModal('proj_phase2_test', 'TC-101');
  assert.ok(State.modalExecContext, 'State.modalExecContext must be initialized when modal opens');
  assert.equal(State.modalExecContext.caseId, 'TC-101');
  assert.equal(State.modalExecContext.steps.length, 3, 'TC-101 should have 3 steps in modalExecContext');
  assert.ok(
    State.modalExecContext.steps.every(st => st.status === 'untested'),
    'All steps must start as "untested"'
  );
  assert.equal(
    DOM.execStepProgressText.textContent,
    '0 of 3 steps completed (0% progress)',
    'Initial step progress text must show 0 of 3 steps completed (0% progress)'
  );
  assert.equal(DOM.execIncompleteWarning.style.display, 'flex', 'Incomplete steps warning should be visible initially');

  // 1C. Click "Pass All Steps" (#btn-pass-all-steps)
  assert.doesNotThrow(() => {
    DOM.btnPassAllSteps.click();
  }, 'Clicking Pass All Steps must not throw a TypeError');

  assert.equal(
    State.modalExecContext.steps.every(st => st.status === 'completed'),
    true,
    'Pass All Steps must mark every step status as "completed" (never "Pass")'
  );
  assert.equal(
    DOM.execStepProgressText.textContent,
    '3 of 3 steps completed (100% progress)',
    'Step progress text must immediately update to 3 of 3 steps completed (100% progress)'
  );
  assert.equal(DOM.execStepsProgressBar.style.width, '100%', 'Progress bar width must be 100%');
  assert.equal(DOM.execIncompleteWarning.style.display, 'none', 'Incomplete warning must hide when all steps are completed');
  assert.ok(
    DOM.execStepsContainer.innerHTML.includes('step-passed'),
    'Rendered step cards must receive the step-passed class'
  );
  // Verify formal test case outcome dropdown and stored test case status were NOT automatically set to Pass before submission
  assert.notEqual(
    DOM.execStatusSelect.value,
    'Pass',
    'Pass All Steps must NOT automatically select Pass in the formal Execution Status dropdown'
  );
  const storedBeforeSubmit = Storage.getProjects()[0].testSuites[0].testCases.find(c => c.id === 'TC-101');
  assert.equal(storedBeforeSubmit.executions.length, 1, 'No new formal execution should be saved until form submission');

  // 1D. Click "Reset Steps" (#btn-reset-all-steps)
  assert.doesNotThrow(() => {
    DOM.btnResetAllSteps.click();
  }, 'Clicking Reset Steps must not throw a TypeError');

  assert.equal(
    State.modalExecContext.steps.every(st => st.status === 'untested'),
    true,
    'Reset Steps must mark every step status as "untested" (never "Not Run")'
  );
  assert.equal(
    DOM.execStepProgressText.textContent,
    '0 of 3 steps completed (0% progress)',
    'Step progress text must reset to 0 of 3 steps completed (0% progress)'
  );
  assert.equal(DOM.execStepsProgressBar.style.width, '0%', 'Progress bar width must reset to 0%');
  assert.equal(DOM.execIncompleteWarning.style.display, 'flex', 'Incomplete warning must reappear after reset');

  // 1E. Verify individual step interactions (Pass, Fail, Reset, Note input) still work
  const passBtns = DOM.execStepsContainer.querySelectorAll('.btn-pass');
  assert.equal(passBtns.length, 3, 'Should render 3 individual step Pass buttons');
  passBtns[0].click();
  assert.equal(State.modalExecContext.steps[0].status, 'completed', 'Individual Pass button must mark step 0 as completed');

  const failBtns = DOM.execStepsContainer.querySelectorAll('.btn-fail');
  failBtns[1].click();
  assert.equal(State.modalExecContext.steps[1].status, 'failed', 'Individual Fail button must mark step 1 as failed');
  assert.equal(DOM.execStatusSelect.value, 'Fail', 'Individual step Fail should suggest Fail in status select');

  const resetBtns = DOM.execStepsContainer.querySelectorAll('.btn-reset');
  resetBtns[1].click();
  assert.equal(State.modalExecContext.steps[1].status, 'untested', 'Individual Reset button must reset step 1 to untested');

  const noteInputs = DOM.execStepsContainer.querySelectorAll('.exec-step-note-input');
  noteInputs[0].value = 'Verified TOTP token accepted';
  noteInputs[0].dispatchEvent({ type: 'input', target: noteInputs[0] });
  assert.equal(
    State.modalExecContext.steps[0].note,
    'Verified TOTP token accepted',
    'Step note input must update modalExecContext.steps[0].note'
  );

  // 1F. Complete and save formal execution after Pass All Steps
  DOM.btnPassAllSteps.click();
  DOM.execStatusSelect.value = 'Pass';
  DOM.execActualInput.value = 'All 3 MFA login steps executed and verified.';
  DOM.execTesterInput.value = 'QA Lead';
  handleSaveExecutionSubmit({ preventDefault() {} });

  const updatedProject = Storage.getProjects()[0];
  assert.equal(updatedProject.executions.length, 1, 'Submitting execution form must persist 1 execution record');
  const savedExec = updatedProject.executions[0];
  assert.equal(savedExec.testCaseId, 'TC-101');
  assert.equal(savedExec.status, 'Pass');
  assert.equal(savedExec.stepResults.length, 3, 'Saved execution must record all 3 stepResults');
  assert.ok(
    savedExec.stepResults.every(sr => sr.status === 'completed'),
    'Saved execution stepResults must all have status "completed"'
  );
  assert.equal(savedExec.stepResults[0].note, 'Verified TOTP token accepted', 'Saved step note must be preserved');
  assert.equal(State.modalExecContext, null, 'Closing execution modal after save must clear State.modalExecContext');

  // 1G. Test Case with empty step array (TC-103 has steps: [])
  openExecutionModal('proj_phase2_test', 'TC-103');
  assert.ok(State.modalExecContext, 'Modal context must exist for step-less test case TC-103');
  assert.deepEqual(State.modalExecContext.steps, [], 'TC-103 steps array should be empty');
  assert.doesNotThrow(() => {
    DOM.btnPassAllSteps.click();
    DOM.btnResetAllSteps.click();
  }, 'Clicking Pass All Steps and Reset Steps on a test case with 0 steps must not throw');
  assert.equal(
    DOM.execStepProgressText.textContent,
    'No explicit steps defined. Verify expected result.',
    'Empty steps progress message must remain intact'
  );
  closeExecutionModal();

  console.log('   ✓ Passed: QAV-ISS-002 verified (Pass All Steps, Reset Steps, individual steps, empty steps, null context guards, and execution save).');
}

// ============================================================================
// TEST GROUP 2 — Test Execution Filters (QAV-ISS-003)
// ============================================================================
console.log('Test Group 2: Test Execution Filters (QAV-ISS-003)...');
{
  const { hook } = createQavoraTestEnvironment();
  const { State, DOM, Storage, switchView } = hook;

  const sampleProject = createSampleProjectFixture();
  Storage.saveProjects([sampleProject]);

  // Navigate to Test Execution workspace
  switchView('execution', 'proj_phase2_test');
  assert.equal(State.activeExecProjectId, 'proj_phase2_test');
  assert.equal(
    DOM.execMetaCount.textContent,
    'Showing all 5 test cases in project',
    'Unfiltered workspace must show all 5 test cases'
  );

  // 2A. Phase Filter (#exec-filter-phase)
  DOM.execFilterPhase.value = 'ph_1';
  DOM.execFilterPhase.dispatchEvent({ type: 'change', target: DOM.execFilterPhase });
  assert.equal(State.execPhaseFilter, 'ph_1', 'Changing #exec-filter-phase must update State.execPhaseFilter');
  assert.equal(
    DOM.execMetaCount.textContent,
    'Showing 3 of 5 test cases (filtered)',
    'Phase 1 filter must narrow results to 3 test cases (TC-101, TC-102, TC-103)'
  );
  assert.ok(DOM.execTableContainer.innerHTML.includes('TC-101'));
  assert.ok(!DOM.execTableContainer.innerHTML.includes('TC-201'));

  // Verify dependent Suite dropdown options when Phase 1 is selected
  const phase1SuiteOptionValues = DOM.execFilterSuite.options.map(o => o.getAttribute('value'));
  assert.deepEqual(
    phase1SuiteOptionValues,
    ['ALL', 'suite_auth'],
    'When Phase 1 is selected, Suite filter dropdown must only offer ALL and suite_auth'
  );

  // Select suite_auth while in Phase 1, then switch Phase filter to Phase 2 -> Suite filter must auto-reset to ALL
  DOM.execFilterSuite.value = 'suite_auth';
  DOM.execFilterSuite.dispatchEvent({ type: 'change', target: DOM.execFilterSuite });
  assert.equal(State.execSuiteFilter, 'suite_auth');
  assert.equal(DOM.execMetaCount.textContent, 'Showing 3 of 5 test cases (filtered)');

  DOM.execFilterPhase.value = 'ph_2';
  DOM.execFilterPhase.dispatchEvent({ type: 'change', target: DOM.execFilterPhase });
  assert.equal(State.execPhaseFilter, 'ph_2');
  assert.equal(
    State.execSuiteFilter,
    'ALL',
    'Switching Phase to ph_2 must reset incompatible State.execSuiteFilter (suite_auth) to ALL'
  );
  assert.equal(DOM.execFilterSuite.value, 'ALL', 'Suite select DOM value must also synchronize to ALL');
  assert.equal(
    DOM.execMetaCount.textContent,
    'Showing 2 of 5 test cases (filtered)',
    'Phase 2 filter must show 2 test cases (TC-201, TC-202)'
  );

  // Reset Phase back to ALL
  DOM.execFilterPhase.value = 'ALL';
  DOM.execFilterPhase.dispatchEvent({ type: 'change', target: DOM.execFilterPhase });
  assert.equal(DOM.execMetaCount.textContent, 'Showing all 5 test cases in project');

  // 2B. Suite Filter (#exec-filter-suite)
  DOM.execFilterSuite.value = 'suite_checkout';
  DOM.execFilterSuite.dispatchEvent({ type: 'change', target: DOM.execFilterSuite });
  assert.equal(State.execSuiteFilter, 'suite_checkout', 'Changing #exec-filter-suite must update State.execSuiteFilter');
  assert.equal(
    DOM.execMetaCount.textContent,
    'Showing 2 of 5 test cases (filtered)',
    'suite_checkout filter must show 2 test cases'
  );
  DOM.execFilterSuite.value = 'ALL';
  DOM.execFilterSuite.dispatchEvent({ type: 'change', target: DOM.execFilterSuite });

  // 2C. Status Filter (#exec-filter-status) across Pass, Fail, Blocked, Skipped, Not Run
  const expectedByStatus = [
    ['Pass', 'TC-101'],
    ['Fail', 'TC-102'],
    ['Blocked', 'TC-103'],
    ['Skipped', 'TC-201'],
    ['Not Run', 'TC-202']
  ];
  for (const [statusVal, expectedCaseId] of expectedByStatus) {
    DOM.execFilterStatus.value = statusVal;
    DOM.execFilterStatus.dispatchEvent({ type: 'change', target: DOM.execFilterStatus });
    assert.equal(State.execStatusFilter, statusVal, `State.execStatusFilter must equal "${statusVal}"`);
    assert.equal(
      DOM.execMetaCount.textContent,
      'Showing 1 of 5 test cases (filtered)',
      `Status filter "${statusVal}" must match exactly 1 case`
    );
    assert.ok(
      DOM.execTableContainer.innerHTML.includes(expectedCaseId),
      `Status filter "${statusVal}" must render ${expectedCaseId}`
    );
  }
  DOM.execFilterStatus.value = 'ALL';
  DOM.execFilterStatus.dispatchEvent({ type: 'change', target: DOM.execFilterStatus });

  // 2D. Priority Filter (#exec-filter-priority) across Critical, High, Medium, Low
  const expectedCountByPriority = [
    ['Critical', '2'], // TC-101, TC-202
    ['High', '1'],     // TC-102
    ['Medium', '1'],   // TC-103
    ['Low', '1']       // TC-201
  ];
  for (const [prioVal, expectedCount] of expectedCountByPriority) {
    DOM.execFilterPriority.value = prioVal;
    DOM.execFilterPriority.dispatchEvent({ type: 'change', target: DOM.execFilterPriority });
    assert.equal(State.execPriorityFilter, prioVal, `State.execPriorityFilter must equal "${prioVal}"`);
    assert.equal(
      DOM.execMetaCount.textContent,
      `Showing ${expectedCount} of 5 test cases (filtered)`,
      `Priority filter "${prioVal}" must match ${expectedCount} case(s)`
    );
  }
  DOM.execFilterPriority.value = 'ALL';
  DOM.execFilterPriority.dispatchEvent({ type: 'change', target: DOM.execFilterPriority });

  // 2E. Category Filter (#exec-filter-category)
  const expectedCaseByCategory = [
    ['Functional', 'TC-101'],
    ['Security', 'TC-102'],
    ['Performance', 'TC-103'],
    ['UI/UX', 'TC-201'],
    ['API', 'TC-202']
  ];
  for (const [catVal, expectedCaseId] of expectedCaseByCategory) {
    DOM.execFilterCategory.value = catVal;
    DOM.execFilterCategory.dispatchEvent({ type: 'change', target: DOM.execFilterCategory });
    assert.equal(State.execCategoryFilter, catVal, `State.execCategoryFilter must equal "${catVal}"`);
    assert.equal(
      DOM.execMetaCount.textContent,
      'Showing 1 of 5 test cases (filtered)',
      `Category filter "${catVal}" must match 1 case`
    );
    assert.ok(DOM.execTableContainer.innerHTML.includes(expectedCaseId));
  }

  // 2F. Combined Filtering across ALL FIVE filters simultaneously (+ search)
  DOM.execFilterPhase.value = 'ph_2';
  DOM.execFilterPhase.dispatchEvent({ type: 'change', target: DOM.execFilterPhase });
  DOM.execFilterSuite.value = 'suite_checkout';
  DOM.execFilterSuite.dispatchEvent({ type: 'change', target: DOM.execFilterSuite });
  DOM.execFilterStatus.value = 'Not Run';
  DOM.execFilterStatus.dispatchEvent({ type: 'change', target: DOM.execFilterStatus });
  DOM.execFilterPriority.value = 'Critical';
  DOM.execFilterPriority.dispatchEvent({ type: 'change', target: DOM.execFilterPriority });
  DOM.execFilterCategory.value = 'API';
  DOM.execFilterCategory.dispatchEvent({ type: 'change', target: DOM.execFilterCategory });
  DOM.execSearchInput.value = 'Stripe';
  DOM.execSearchInput.dispatchEvent({ type: 'input', target: DOM.execSearchInput });

  assert.equal(
    DOM.execMetaCount.textContent,
    'Showing 1 of 5 test cases (filtered)',
    'Combined 5-filter + search query must match TC-202'
  );
  assert.ok(DOM.execTableContainer.innerHTML.includes('TC-202'));

  // 2G. Empty State when combined filters match 0 cases
  DOM.execFilterPriority.value = 'Low'; // TC-202 is Critical, so 0 matches
  DOM.execFilterPriority.dispatchEvent({ type: 'change', target: DOM.execFilterPriority });
  assert.equal(
    DOM.execMetaCount.textContent,
    'Showing 0 of 5 test cases (filtered)',
    'Conflicting combined filters must result in 0 matches'
  );
  assert.ok(
    DOM.execTableContainer.innerHTML.includes('No test cases match active filters'),
    'Zero matches must render the empty-state message with Reset All Filters button'
  );

  // 2H. Reset Filters button (#exec-clear-filters-btn) restores all 5 filters + search + sort and syncs DOM
  DOM.execClearFiltersBtn.click();
  assert.equal(State.execPhaseFilter, 'ALL');
  assert.equal(State.execSuiteFilter, 'ALL');
  assert.equal(State.execStatusFilter, 'ALL');
  assert.equal(State.execPriorityFilter, 'ALL');
  assert.equal(State.execCategoryFilter, 'ALL');
  assert.equal(State.execSearchQuery, '');
  assert.equal(DOM.execFilterPhase.value, 'ALL');
  assert.equal(DOM.execFilterSuite.value, 'ALL');
  assert.equal(DOM.execFilterStatus.value, 'ALL');
  assert.equal(DOM.execFilterPriority.value, 'ALL');
  assert.equal(DOM.execFilterCategory.value, 'ALL');
  assert.equal(DOM.execSearchInput.value, '');
  assert.equal(
    DOM.execMetaCount.textContent,
    'Showing all 5 test cases in project',
    'After Reset Filters, all 5 test cases must be displayed'
  );

  console.log('   ✓ Passed: QAV-ISS-003 verified (Phase, Suite, Status, Priority, Category individual/combined filters, dependent suites, empty state, and Reset Filters).');
}

// ============================================================================
// TEST GROUP 3 — Suite Cases Explorer Filters (QAV-ISS-008)
// ============================================================================
console.log('Test Group 3: Suite Cases Explorer Filters (QAV-ISS-008)...');
{
  const { hook } = createQavoraTestEnvironment();
  const { State, DOM, Storage, openSuiteCasesView, resetCaseFilters } = hook;

  const sampleProject = createSampleProjectFixture();
  Storage.saveProjects([sampleProject]);

  // Open Suite Cases Explorer for suite_auth (3 cases: TC-101 Critical/Functional, TC-102 High/Security, TC-103 Medium/Performance)
  openSuiteCasesView('proj_phase2_test', 'suite_auth');

  assert.equal(
    DOM.casesMetaCount.textContent,
    'Showing all 3 test cases',
    'Suite Cases Explorer should initially display all 3 cases in suite_auth'
  );
  assert.equal(DOM.caseFilterPriority.value, 'ALL');
  assert.equal(DOM.caseFilterCategory.value, 'ALL');

  // 3A. Filter by Priority (#case-filter-priority)
  DOM.caseFilterPriority.value = 'Critical';
  DOM.caseFilterPriority.dispatchEvent({ type: 'change', target: DOM.caseFilterPriority });
  assert.equal(State.casePriorityFilter, 'Critical', 'Changing #case-filter-priority must update State.casePriorityFilter');
  assert.equal(
    DOM.casesMetaCount.textContent,
    'Showing 1 of 3 test cases (filtered)',
    'Priority=Critical in suite_auth must show 1 case (TC-101)'
  );
  assert.ok(DOM.casesTableContainer.innerHTML.includes('TC-101'));

  // 3B. Filter by Category (#case-filter-category)
  DOM.caseFilterPriority.value = 'ALL';
  DOM.caseFilterPriority.dispatchEvent({ type: 'change', target: DOM.caseFilterPriority });
  DOM.caseFilterCategory.value = 'Security';
  DOM.caseFilterCategory.dispatchEvent({ type: 'change', target: DOM.caseFilterCategory });
  assert.equal(State.caseCategoryFilter, 'Security', 'Changing #case-filter-category must update State.caseCategoryFilter');
  assert.equal(
    DOM.casesMetaCount.textContent,
    'Showing 1 of 3 test cases (filtered)',
    'Category=Security in suite_auth must show 1 case (TC-102)'
  );
  assert.ok(DOM.casesTableContainer.innerHTML.includes('TC-102'));

  // 3C. Combined Priority + Category filtering in Suite Cases Explorer
  DOM.caseFilterPriority.value = 'High';
  DOM.caseFilterPriority.dispatchEvent({ type: 'change', target: DOM.caseFilterPriority });
  assert.equal(
    DOM.casesMetaCount.textContent,
    'Showing 1 of 3 test cases (filtered)',
    'Priority=High + Category=Security must match TC-102'
  );

  // Set a non-matching combination so empty state renders
  DOM.caseFilterPriority.value = 'Low';
  DOM.caseFilterPriority.dispatchEvent({ type: 'change', target: DOM.caseFilterPriority });
  assert.equal(
    DOM.casesMetaCount.textContent,
    'Showing 0 of 3 test cases (filtered)',
    'Priority=Low + Category=Security must match 0 cases'
  );
  assert.ok(DOM.casesTableContainer.innerHTML.includes('No matching test cases'));

  // 3D. Click Reset Filters (#case-clear-filters-btn) and verify BOTH State and DOM dropdown values reset to 'ALL'
  DOM.caseClearFiltersBtn.click();
  assert.equal(State.casePriorityFilter, 'ALL', 'State.casePriorityFilter must reset to ALL');
  assert.equal(State.caseCategoryFilter, 'ALL', 'State.caseCategoryFilter must reset to ALL');
  assert.equal(
    DOM.caseFilterPriority.value,
    'ALL',
    '#case-filter-priority dropdown value must visually reset to ALL (QAV-ISS-008 fix)'
  );
  assert.equal(
    DOM.caseFilterCategory.value,
    'ALL',
    '#case-filter-category dropdown value must visually reset to ALL (QAV-ISS-008 fix)'
  );
  assert.equal(
    DOM.casesMetaCount.textContent,
    'Showing all 3 test cases',
    'All 3 suite test cases must be rendered after Reset Filters'
  );

  // 3E. Also verify direct programmatic call to resetCaseFilters() when dropdowns have non-ALL values
  DOM.caseFilterPriority.value = 'Medium';
  State.casePriorityFilter = 'Medium';
  DOM.caseFilterCategory.value = 'Performance';
  State.caseCategoryFilter = 'Performance';
  resetCaseFilters();
  assert.equal(DOM.caseFilterPriority.value, 'ALL');
  assert.equal(DOM.caseFilterCategory.value, 'ALL');
  assert.equal(State.casePriorityFilter, 'ALL');
  assert.equal(State.caseCategoryFilter, 'ALL');

  console.log('   ✓ Passed: QAV-ISS-008 verified (Priority & Category filtering, DOM dropdown synchronization, and Reset Filters visual + state reset).');
}

console.log('\nALL PHASE 2 REMEDIATION TESTS PASSED SUCCESSFULLY!');
