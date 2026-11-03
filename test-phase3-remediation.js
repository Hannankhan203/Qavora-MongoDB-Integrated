/**
 * Automated Behavioral Verification Suite for QAVORA-REMEDIATION-003 — PHASE 3
 * Covers:
 * - QAV-ISS-004: Defect Filters, Search & Sorting (Project, Severity, Status, Search,
 *                combined filters, sorting without source array mutation, Reset Filters,
 *                UI-to-State synchronization, and empty-state rendering).
 * - QAV-ISS-005: Linked Test Case Navigation (Defects table badge and Defect View modal
 *                badge resolve exact (projectId, suiteId, caseId) and open Test Case
 *                inspection modal; deleted/missing linked test cases fail gracefully).
 * - QAV-ISS-006: Cross-Project Defect Editing & Stale Defect Link Cleanup (edit in original
 *                project, move across projects without duplication, unlink/relink removes
 *                stale defectId from old testCase.defectIds while preserving other defectIds,
 *                delete defect cleans up defectIds, and atomic rollback on storage failure).
 * - QAV-ISS-007: Defect Creation with ALL Project Scope (opening Create Defect from ALL
 *                scope selects a valid real project, populates Linked Test Case dropdown,
 *                updates dropdown on project change, handles 0-case projects, and rejects
 *                invalid/ALL project or mismatched test case combinations).
 * - Regression:  Phase 1 (Checklist Promotion & Backup/Footprint/Runner State) and
 *                Phase 2 (Execution Modal Steps, Execution Filters, Suite Cases Filters).
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
  let failNextSetItem = false;
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      if (failNextSetItem) {
        failNextSetItem = false;
        const err = new Error('Simulated QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
    clear() {
      map.clear();
    },
    __failNextWrite() {
      failNextSetItem = true;
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
      if (name.startsWith('data-')) {
        const camel = name
          .slice(5)
          .replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        delete el.dataset[camel];
      }
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

  const tagRegex = /<(option|button|input|select|tr|div)\b([^>]*)>([\s\S]*?)<\/\1>|<(input)\b([^>]*)\/?>/gi;
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
      child.textContent = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    children.push(child);
  }

  const nestedInteractiveRegex = /<(button|input|select|span)\b([^>]*)(?:>([\s\S]*?)<\/\1>|\/?>)/gi;
  let nestedMatch;
  while ((nestedMatch = nestedInteractiveRegex.exec(html)) !== null) {
    const tag = nestedMatch[1].toLowerCase();
    const attrStr = nestedMatch[2] || '';
    const parsedAttrs = parseAttributes(attrStr);
    const alreadyExists = children.some(
      c =>
        c.tagName.toLowerCase() === tag &&
        c.getAttribute('class') === (parsedAttrs.class || null) &&
        c.getAttribute('data-step-index') === (parsedAttrs['data-step-index'] || null) &&
        c.getAttribute('data-case-id') === (parsedAttrs['data-case-id'] || null) &&
        c.getAttribute('data-defect-id') === (parsedAttrs['data-defect-id'] || null) &&
        c.getAttribute('data-project-id') === (parsedAttrs['data-project-id'] || null)
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
        renderDefectsWorkspace,
        resetDefectFilters,
        openDefectModal,
        closeDefectModal,
        updateDefectModalCasesDropdown,
        handleSaveDefectSubmit,
        openDefectViewModal,
        closeDefectViewModal,
        updateDefectQuickStatus,
        openTestCaseViewModal,
        closeTestCaseViewModal,
        resolveProjectCaseContext,
        requestUniversalDelete,
        executeUniversalDelete,
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
    TypeError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
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
  qaChecklistStore.setStorageAdapterForTesting(localStorage);
  globalThis.localStorage = localStorage;
  globalThis.sessionStorage = sessionStorage;
  globalThis.window = windowStub;

  vm.createContext(sandbox);
  vm.runInContext(transformedScript, sandbox, { filename: 'script.js' });

  return {
    hook: sandbox.__qavoraTestHook,
    document: documentStub,
    localStorage,
    elementsById
  };
}

// ============================================================================
// Deterministic Test Fixtures for Phase 3 Verification
// ============================================================================

function seedPhase3Projects(Storage) {
  const projects = [
    {
      id: 'PRJ-ALPHA',
      name: 'Alpha Banking Portal',
      type: 'Web Application',
      version: 'v3.1.0',
      status: 'Active',
      description: 'Core retail banking web portal',
      createdAt: '2025-02-01T08:00:00.000Z',
      updatedAt: '2025-02-10T10:00:00.000Z',
      testPlan: {
        id: 'PLAN-ALPHA',
        name: 'Alpha Master Test Plan',
        objective: 'Verify banking security and wire transfers',
        scope: 'Auth and SWIFT modules',
        phases: [
          { id: 'PH-A1', phaseNumber: '1', name: 'Phase 1: Authentication', order: 1 },
          { id: 'PH-A2', phaseNumber: '2', name: 'Phase 2: Wire Transfers', order: 2 }
        ]
      },
      testSuites: [
        {
          id: 'SUI-A1',
          phaseId: 'PH-A1',
          name: 'Suite A1: Login & MFA',
          category: 'Security',
          description: 'MFA and login security verification',
          createdAt: '2025-02-01T09:00:00.000Z',
          testCases: [
            {
              id: 'TC-A101',
              title: 'Verify MFA OTP Challenge Enforcement',
              category: 'Security',
              priority: 'Critical',
              preconditions: 'User has MFA enabled',
              expectedResult: 'OTP challenge prompt blocks unverified session',
              status: 'Fail',
              lastExecutedAt: '2025-02-10T09:00:00.000Z',
              defectIds: ['DEF-101', 'DEF-102'],
              steps: [
                { id: 'ST-A1', order: 0, action: 'Sign in with valid credentials', testData: 'user@alpha.bank' },
                { id: 'ST-A2', order: 1, action: 'Refresh session cookie', testData: '' }
              ]
            },
            {
              id: 'TC-A102',
              title: 'Verify Password Reset Token Expiry',
              category: 'Functional',
              priority: 'High',
              preconditions: 'Expired password reset link',
              expectedResult: 'Reset link rejected with expiry banner',
              status: 'Pass',
              lastExecutedAt: '2025-02-10T09:30:00.000Z',
              defectIds: [],
              steps: [
                { id: 'ST-A3', order: 0, action: 'Open expired reset link', testData: '' }
              ]
            }
          ]
        },
        {
          id: 'SUI-A2',
          phaseId: 'PH-A2',
          name: 'Suite A2: SWIFT Transfers',
          category: 'Functional',
          description: 'International wire transfer validation',
          createdAt: '2025-02-02T09:00:00.000Z',
          testCases: [
            {
              id: 'TC-A201',
              title: 'Verify IBAN Checksum Validation',
              category: 'Functional',
              priority: 'Medium',
              preconditions: 'Transfer form open',
              expectedResult: 'Invalid IBAN flagged inline',
              status: 'Blocked',
              lastExecutedAt: '2025-02-10T10:00:00.000Z',
              defectIds: ['DEF-103'],
              steps: []
            }
          ]
        }
      ],
      defects: [
        {
          id: 'DEF-101',
          title: 'MFA OTP bypassed when refreshing token mid-challenge',
          description: 'Session token refresh endpoint bypasses MFA check',
          severity: 'Critical',
          priority: 'Critical',
          status: 'Open',
          testCaseId: 'TC-A101',
          stepsToReproduce: '1. Login\n2. Refresh token endpoint',
          expectedResult: 'Session remains locked until OTP verified',
          actualResult: 'Full session token issued without OTP',
          createdAt: '2025-02-10T08:00:00.000Z',
          updatedAt: '2025-02-10T08:00:00.000Z'
        },
        {
          id: 'DEF-102',
          title: 'MFA SMS resend countdown timer drifts on tab blur',
          description: 'setInterval pauses in background tab',
          severity: 'Low',
          priority: 'Low',
          status: 'Resolved',
          testCaseId: 'TC-A101',
          stepsToReproduce: '1. Trigger SMS OTP\n2. Switch browser tabs',
          expectedResult: 'Countdown uses wall-clock delta',
          actualResult: 'setInterval pauses in background tab',
          createdAt: '2025-02-08T12:00:00.000Z',
          updatedAt: '2025-02-09T12:00:00.000Z'
        },
        {
          id: 'DEF-103',
          title: 'IBAN validation rejects valid DE89 country prefix',
          description: 'German IBAN rejected on wire transfer screen',
          severity: 'High',
          priority: 'High',
          status: 'In Progress',
          testCaseId: 'TC-A201',
          stepsToReproduce: 'Enter valid German IBAN',
          expectedResult: 'IBAN accepted',
          actualResult: 'Regex rejects DE prefix',
          createdAt: '2025-02-09T15:30:00.000Z',
          updatedAt: '2025-02-09T16:00:00.000Z'
        }
      ],
      executions: []
    },
    {
      id: 'PRJ-BETA',
      name: 'Beta Mobile Wallet',
      type: 'Mobile Application',
      version: 'v1.4.0',
      status: 'Active',
      description: 'Companion mobile wallet app',
      createdAt: '2025-02-05T08:00:00.000Z',
      updatedAt: '2025-02-11T10:00:00.000Z',
      testPlan: {
        id: 'PLAN-BETA',
        name: 'Beta Biometrics Test Plan',
        phases: [
          { id: 'PH-B1', phaseNumber: '1', name: 'Phase 1: Biometrics', order: 1 }
        ]
      },
      testSuites: [
        {
          id: 'SUI-B1',
          phaseId: 'PH-B1',
          name: 'Suite B1: FaceID Unlock',
          category: 'UI/UX',
          description: 'Biometric wallet unlock flow',
          createdAt: '2025-02-05T09:00:00.000Z',
          testCases: [
            {
              id: 'TC-B101',
              title: 'Verify FaceID Fallback to Passcode After 3 Failures',
              category: 'UI/UX',
              priority: 'High',
              preconditions: 'FaceID enrolled on device',
              expectedResult: 'Passcode pad appears immediately after 3 failed scans',
              status: 'Fail',
              lastExecutedAt: '2025-02-11T09:00:00.000Z',
              defectIds: ['DEF-201'],
              steps: [
                { id: 'ST-B1', order: 0, action: 'Fail FaceID scan 3 times', testData: '' }
              ]
            },
            {
              id: 'TC-B102',
              title: 'Verify Biometric Token Keychain Rotation',
              category: 'Security',
              priority: 'Critical',
              preconditions: 'Active wallet token in keychain',
              expectedResult: 'Keychain entry rotated cleanly',
              status: 'Pass',
              lastExecutedAt: '2025-02-11T10:00:00.000Z',
              defectIds: [],
              steps: []
            }
          ]
        }
      ],
      defects: [
        {
          id: 'DEF-201',
          title: 'FaceID fallback passcode sheet freezes on iOS 17',
          description: 'UI thread stalls on sheet presentation',
          severity: 'Medium',
          priority: 'Medium',
          status: 'Reopened',
          testCaseId: 'TC-B101',
          stepsToReproduce: 'Fail biometric check 3 times',
          expectedResult: 'Passcode modal animates in smoothly',
          actualResult: 'UI thread stalls on sheet presentation',
          createdAt: '2025-02-11T11:00:00.000Z',
          updatedAt: '2025-02-11T11:30:00.000Z'
        },
        {
          id: 'DEF-202',
          title: 'Stale test case reference defect for deleted test case',
          description: 'Legacy defect linked to removed test case',
          severity: 'Low',
          priority: 'Low',
          status: 'Closed',
          testCaseId: 'TC-DELETED-999',
          stepsToReproduce: 'Legacy defect linked to removed test case',
          expectedResult: 'Should not crash when clicked',
          actualResult: 'Test case was deleted in earlier sprint',
          createdAt: '2025-02-01T10:00:00.000Z',
          updatedAt: '2025-02-02T10:00:00.000Z'
        }
      ],
      executions: []
    },
    {
      id: 'PRJ-EMPTY',
      name: 'Gamma Empty Sandbox',
      type: 'Other',
      version: 'v0.1.0',
      status: 'Active',
      description: 'Project with zero test cases',
      createdAt: '2025-02-12T08:00:00.000Z',
      updatedAt: '2025-02-12T08:00:00.000Z',
      testPlan: {
        id: 'PLAN-EMPTY',
        name: 'Empty Plan',
        phases: []
      },
      testSuites: [],
      defects: [],
      executions: []
    }
  ];

  Storage.saveProjects(projects);
  return projects;
}

function getRenderedDefectIds(DOM) {
  const viewBtns = DOM.defectsTableContainer.querySelectorAll('.btn-view-defect');
  return viewBtns.map(btn => btn.getAttribute('data-defect-id'));
}

console.log('================================================================');
console.log('QAVORA PHASE 3 REMEDIATION — BEHAVIORAL VERIFICATION SUITE');
console.log('================================================================\n');

// ============================================================================
// TEST GROUP 1 — QAV-ISS-004: Defect Filters, Search & Sorting
// ============================================================================
console.log('--- Test Group 1: QAV-ISS-004 (Defect Filters, Search & Sorting) ---');
{
  const { hook } = createQavoraTestEnvironment();
  const { State, DOM, Storage, renderDefectsWorkspace, resetDefectFilters, switchView } = hook;

  seedPhase3Projects(Storage);
  switchView('defects');

  // 1. Default ALL projects view shows all 5 defects sorted by newest
  assert.equal(State.activeDefectsProjectId, 'ALL');
  assert.deepEqual(
    getRenderedDefectIds(DOM),
    ['DEF-201', 'DEF-101', 'DEF-103', 'DEF-102', 'DEF-202'],
    'Default view should display all 5 defects ordered by newest createdAt'
  );
  assert.equal(DOM.defectsMetaCount.textContent, 'Showing all 5 defects');

  // 2. Project filter: specific project vs ALL
  DOM.defectsProjectSelect.value = 'PRJ-ALPHA';
  DOM.defectsProjectSelect.dispatchEvent({ type: 'change', target: DOM.defectsProjectSelect });
  assert.equal(State.activeDefectsProjectId, 'PRJ-ALPHA');
  assert.deepEqual(getRenderedDefectIds(DOM), ['DEF-101', 'DEF-103', 'DEF-102']);
  assert.equal(DOM.defectsMetaCount.textContent, 'Showing all 3 defects');

  DOM.defectsProjectSelect.value = 'PRJ-BETA';
  DOM.defectsProjectSelect.dispatchEvent({ type: 'change', target: DOM.defectsProjectSelect });
  assert.equal(State.activeDefectsProjectId, 'PRJ-BETA');
  assert.deepEqual(getRenderedDefectIds(DOM), ['DEF-201', 'DEF-202']);

  DOM.defectsProjectSelect.value = 'ALL';
  DOM.defectsProjectSelect.dispatchEvent({ type: 'change', target: DOM.defectsProjectSelect });
  assert.equal(State.activeDefectsProjectId, 'ALL');
  assert.equal(getRenderedDefectIds(DOM).length, 5);

  // 3. Severity filter via event listener (verifies State.defectSeverityFilter is updated)
  for (const [sev, expectedIds] of [
    ['Critical', ['DEF-101']],
    ['High', ['DEF-103']],
    ['Medium', ['DEF-201']],
    ['Low', ['DEF-102', 'DEF-202']]
  ]) {
    DOM.defectsFilterSeverity.value = sev;
    DOM.defectsFilterSeverity.dispatchEvent({ type: 'change', target: DOM.defectsFilterSeverity });
    assert.equal(State.defectSeverityFilter, sev, `Severity filter should update State.defectSeverityFilter to ${sev}`);
    assert.deepEqual(getRenderedDefectIds(DOM), expectedIds, `Severity=${sev} should render matching defects`);
  }

  // Reset severity back to ALL
  DOM.defectsFilterSeverity.value = 'ALL';
  DOM.defectsFilterSeverity.dispatchEvent({ type: 'change', target: DOM.defectsFilterSeverity });
  assert.equal(getRenderedDefectIds(DOM).length, 5);

  // 4. Status filter via event listener (verifies State.defectStatusFilter is updated)
  for (const [status, expectedIds] of [
    ['Open', ['DEF-101']],
    ['In Progress', ['DEF-103']],
    ['Resolved', ['DEF-102']],
    ['Closed', ['DEF-202']],
    ['Reopened', ['DEF-201']]
  ]) {
    DOM.defectsFilterStatus.value = status;
    DOM.defectsFilterStatus.dispatchEvent({ type: 'change', target: DOM.defectsFilterStatus });
    assert.equal(State.defectStatusFilter, status, `Status filter should update State.defectStatusFilter to ${status}`);
    assert.deepEqual(getRenderedDefectIds(DOM), expectedIds, `Status=${status} should render matching defects`);
  }

  DOM.defectsFilterStatus.value = 'ALL';
  DOM.defectsFilterStatus.dispatchEvent({ type: 'change', target: DOM.defectsFilterStatus });

  // 5. Search input (by Defect ID, title, and description) + clear button
  DOM.defectsSearchInput.value = 'DEF-103';
  DOM.defectsSearchInput.dispatchEvent({ type: 'input', target: DOM.defectsSearchInput });
  assert.equal(State.defectSearchQuery, 'DEF-103');
  assert.deepEqual(getRenderedDefectIds(DOM), ['DEF-103']);
  assert.equal(DOM.defectsSearchClearBtn.style.display, 'inline-flex');

  // Search by title substring
  DOM.defectsSearchInput.value = 'passcode sheet freezes';
  DOM.defectsSearchInput.dispatchEvent({ type: 'input', target: DOM.defectsSearchInput });
  assert.deepEqual(getRenderedDefectIds(DOM), ['DEF-201']);

  // Search by description
  DOM.defectsSearchInput.value = 'setInterval pauses in background tab';
  DOM.defectsSearchInput.dispatchEvent({ type: 'input', target: DOM.defectsSearchInput });
  assert.deepEqual(getRenderedDefectIds(DOM), ['DEF-102']);

  // Search clear button
  DOM.defectsSearchClearBtn.click();
  assert.equal(State.defectSearchQuery, '');
  assert.equal(DOM.defectsSearchInput.value, '');
  assert.equal(DOM.defectsSearchClearBtn.style.display, 'none');
  assert.equal(getRenderedDefectIds(DOM).length, 5);

  // 6. Combined Project + Severity + Status + Search filtering
  DOM.defectsProjectSelect.value = 'PRJ-ALPHA';
  DOM.defectsProjectSelect.dispatchEvent({ type: 'change', target: DOM.defectsProjectSelect });
  DOM.defectsFilterSeverity.value = 'High';
  DOM.defectsFilterSeverity.dispatchEvent({ type: 'change', target: DOM.defectsFilterSeverity });
  DOM.defectsFilterStatus.value = 'In Progress';
  DOM.defectsFilterStatus.dispatchEvent({ type: 'change', target: DOM.defectsFilterStatus });
  DOM.defectsSearchInput.value = 'German IBAN';
  DOM.defectsSearchInput.dispatchEvent({ type: 'input', target: DOM.defectsSearchInput });

  assert.deepEqual(getRenderedDefectIds(DOM), ['DEF-103']);
  assert.equal(DOM.defectsMetaCount.textContent, 'Showing 1 of 3 defects (filtered)');

  // 7. Empty-state rendering when no defects match active filters
  DOM.defectsSearchInput.value = 'non-existent-defect-xyz-999';
  DOM.defectsSearchInput.dispatchEvent({ type: 'input', target: DOM.defectsSearchInput });
  assert.deepEqual(getRenderedDefectIds(DOM), []);
  assert.ok(
    DOM.defectsTableContainer.innerHTML.includes('No defects match filter parameters'),
    'Empty state should render No defects match filter parameters when filters exclude all records'
  );

  // 8. Reset Filters button restores default filter/search/sort state and synchronizes UI controls
  DOM.defectsSortBy.value = 'oldest';
  DOM.defectsSortBy.dispatchEvent({ type: 'change', target: DOM.defectsSortBy });
  assert.equal(State.defectSortBy, 'oldest');

  DOM.defectsClearFiltersBtn.click();
  assert.equal(State.defectSeverityFilter, 'ALL');
  assert.equal(State.defectStatusFilter, 'ALL');
  assert.equal(State.defectSearchQuery, '');
  assert.equal(State.defectSortBy, 'newest');
  assert.equal(DOM.defectsFilterSeverity.value, 'ALL');
  assert.equal(DOM.defectsFilterStatus.value, 'ALL');
  assert.equal(DOM.defectsSearchInput.value, '');
  assert.equal(DOM.defectsSortBy.value, 'newest');
  assert.deepEqual(getRenderedDefectIds(DOM), ['DEF-101', 'DEF-103', 'DEF-102']);

  // 9. Sorting verification across all 5 defects (newest, oldest, severity-desc, id-desc) without mutating stored arrays
  DOM.defectsProjectSelect.value = 'ALL';
  DOM.defectsProjectSelect.dispatchEvent({ type: 'change', target: DOM.defectsProjectSelect });

  const originalAlphaOrder = Storage.getProjects().find(p => p.id === 'PRJ-ALPHA').defects.map(d => d.id);

  DOM.defectsSortBy.value = 'oldest';
  DOM.defectsSortBy.dispatchEvent({ type: 'change', target: DOM.defectsSortBy });
  assert.deepEqual(
    getRenderedDefectIds(DOM),
    ['DEF-202', 'DEF-102', 'DEF-103', 'DEF-101', 'DEF-201'],
    'Sort by oldest should order defects ascending by createdAt'
  );

  DOM.defectsSortBy.value = 'severity-desc';
  DOM.defectsSortBy.dispatchEvent({ type: 'change', target: DOM.defectsSortBy });
  assert.deepEqual(
    getRenderedDefectIds(DOM),
    ['DEF-101', 'DEF-103', 'DEF-201', 'DEF-102', 'DEF-202'],
    'Sort by severity-desc should order Critical -> High -> Medium -> Low'
  );

  DOM.defectsSortBy.value = 'id-desc';
  DOM.defectsSortBy.dispatchEvent({ type: 'change', target: DOM.defectsSortBy });
  assert.deepEqual(
    getRenderedDefectIds(DOM),
    ['DEF-202', 'DEF-201', 'DEF-103', 'DEF-102', 'DEF-101'],
    'Sort by id-desc should order defect IDs descending'
  );

  const afterSortAlphaOrder = Storage.getProjects().find(p => p.id === 'PRJ-ALPHA').defects.map(d => d.id);
  assert.deepEqual(afterSortAlphaOrder, originalAlphaOrder, 'Sorting must not mutate underlying stored defect arrays');

  resetDefectFilters();
  renderDefectsWorkspace();
  console.log('✓ Test Group 1 passed (all QAV-ISS-004 assertions verified)\n');
}

// ============================================================================
// TEST GROUP 2 — QAV-ISS-005: Linked Test Case Navigation
// ============================================================================
console.log('--- Test Group 2: QAV-ISS-005 (Linked Test Case Navigation) ---');
{
  const { hook } = createQavoraTestEnvironment();
  const {
    DOM,
    Storage,
    switchView,
    openDefectViewModal,
    closeTestCaseViewModal,
    openTestCaseViewModal
  } = hook;

  seedPhase3Projects(Storage);
  switchView('defects');

  // 1. Clicking linked Test Case badge in the Defects table (`.btn-inspect-linked-test`)
  const inspectButtons = DOM.defectsTableContainer.querySelectorAll('.btn-inspect-linked-test');
  const tcA201Btn = inspectButtons.find(
    btn => btn.getAttribute('data-case-id') === 'TC-A201' && btn.getAttribute('data-project-id') === 'PRJ-ALPHA'
  );
  assert.ok(tcA201Btn, 'Linked Test Case badge for TC-A201 should be rendered with data-project-id and data-case-id');
  assert.equal(tcA201Btn.getAttribute('data-suite-id'), 'SUI-A2', 'Linked Test Case badge should include resolved data-suite-id');

  tcA201Btn.click();
  assert.equal(
    DOM.testcaseViewModal.classList.contains('open'),
    true,
    'Clicking linked Test Case badge in Defects table must open #testcase-view-modal'
  );
  assert.equal(DOM.viewCaseId.textContent, 'TC-A201');
  assert.equal(DOM.viewCaseTitle.textContent, 'Verify IBAN Checksum Validation');
  assert.equal(DOM.testcaseViewModal.getAttribute('data-project-id'), 'PRJ-ALPHA');
  assert.equal(DOM.testcaseViewModal.getAttribute('data-suite-id'), 'SUI-A2');
  assert.equal(DOM.testcaseViewModal.getAttribute('data-case-id'), 'TC-A201');

  closeTestCaseViewModal();
  assert.equal(DOM.testcaseViewModal.classList.contains('open'), false);

  // 2. Clicking linked Test Case badge inside Defect View modal (`#view-defect-linked-case`)
  openDefectViewModal('PRJ-BETA', 'DEF-201');
  assert.equal(DOM.defectViewModal.classList.contains('open'), true);
  assert.equal(DOM.viewDefectLinkedCase.textContent, 'TC-B101');

  DOM.viewDefectLinkedCase.click();

  assert.equal(DOM.defectViewModal.classList.contains('open'), false, 'Defect View modal should close when transitioning to Test Case modal');
  assert.equal(DOM.testcaseViewModal.classList.contains('open'), true, 'Test Case modal should open from Defect View modal');
  assert.equal(DOM.viewCaseId.textContent, 'TC-B101');
  assert.equal(DOM.viewCaseTitle.textContent, 'Verify FaceID Fallback to Passcode After 3 Failures');
  assert.equal(DOM.testcaseViewModal.getAttribute('data-project-id'), 'PRJ-BETA');
  assert.equal(DOM.testcaseViewModal.getAttribute('data-suite-id'), 'SUI-B1');
  assert.equal(DOM.testcaseViewModal.getAttribute('data-case-id'), 'TC-B101');
  closeTestCaseViewModal();

  // 3. Backward-compatible 2-argument call `openTestCaseViewModal(projectId, caseId)` resolves suite automatically
  const openedWithTwoArgs = openTestCaseViewModal('PRJ-ALPHA', 'TC-A101');
  assert.equal(openedWithTwoArgs, true);
  assert.equal(DOM.testcaseViewModal.classList.contains('open'), true);
  assert.equal(DOM.viewCaseId.textContent, 'TC-A101');
  assert.equal(DOM.testcaseViewModal.getAttribute('data-suite-id'), 'SUI-A1');
  closeTestCaseViewModal();

  // 4. Missing/deleted linked Test Case (`DEF-202` references `TC-DELETED-999`)
  openDefectViewModal('PRJ-BETA', 'DEF-202');
  assert.ok(
    DOM.viewDefectLinkedCase.textContent.includes('TC-DELETED-999') &&
      DOM.viewDefectLinkedCase.textContent.includes('Unavailable'),
    'Defect View modal should indicate when a linked Test Case is unavailable/deleted'
  );
  const missingResult = openTestCaseViewModal('PRJ-BETA', null, 'TC-DELETED-999');
  assert.equal(missingResult, false, 'openTestCaseViewModal must return false for deleted/missing Test Case');
  assert.equal(
    DOM.testcaseViewModal.classList.contains('open'),
    false,
    'Test Case modal must remain closed and never open an unrelated Test Case'
  );

  console.log('✓ Test Group 2 passed (all QAV-ISS-005 assertions verified)\n');
}

// ============================================================================
// TEST GROUP 3 — QAV-ISS-006: Cross-Project Defect Editing & Stale Defect Links
// ============================================================================
console.log('--- Test Group 3: QAV-ISS-006 (Cross-Project Defect Editing & Stale Defect Links) ---');
{
  const { hook, localStorage } = createQavoraTestEnvironment();
  const {
    State,
    DOM,
    Storage,
    switchView,
    openDefectModal,
    handleSaveDefectSubmit,
    requestUniversalDelete,
    executeUniversalDelete
  } = hook;

  seedPhase3Projects(Storage);
  switchView('defects');

  // 1. Edit a defect within its original project and relink from TC-A101 to TC-A102
  // Note: TC-A101 starts with defectIds: ['DEF-101', 'DEF-102']
  openDefectModal('PRJ-ALPHA', 'DEF-101');
  assert.equal(DOM.defectIdInput.value, 'DEF-101');
  assert.equal(DOM.defectProjectIdInput.value, 'PRJ-ALPHA');
  assert.equal(DOM.defectProjectSelectField.value, 'PRJ-ALPHA');
  assert.equal(DOM.defectLinkedCaseSelect.value, 'TC-A101');

  DOM.defectTitleInput.value = 'MFA OTP bypassed on token refresh (Updated)';
  DOM.defectLinkedCaseSelect.value = 'TC-A102';
  handleSaveDefectSubmit({ preventDefault() {} });

  let projects = Storage.getProjects();
  let alpha = projects.find(p => p.id === 'PRJ-ALPHA');
  let tcA101 = alpha.testSuites[0].testCases.find(tc => tc.id === 'TC-A101');
  let tcA102 = alpha.testSuites[0].testCases.find(tc => tc.id === 'TC-A102');
  let def101 = alpha.defects.find(d => d.id === 'DEF-101');

  assert.equal(def101.title, 'MFA OTP bypassed on token refresh (Updated)');
  assert.equal(def101.testCaseId, 'TC-A102');
  assert.deepEqual(
    tcA101.defectIds,
    ['DEF-102'],
    'Relinking DEF-101 to TC-A102 must remove DEF-101 from TC-A101 while preserving unrelated DEF-102'
  );
  assert.deepEqual(
    tcA102.defectIds,
    ['DEF-101'],
    'Relinking DEF-101 to TC-A102 must add DEF-101 to TC-A102.defectIds'
  );

  // 2. Unlink a defect (change Linked Test Case to None / '')
  openDefectModal('PRJ-ALPHA', 'DEF-102');
  assert.equal(DOM.defectLinkedCaseSelect.value, 'TC-A101');
  DOM.defectLinkedCaseSelect.value = '';
  handleSaveDefectSubmit({ preventDefault() {} });

  projects = Storage.getProjects();
  alpha = projects.find(p => p.id === 'PRJ-ALPHA');
  tcA101 = alpha.testSuites[0].testCases.find(tc => tc.id === 'TC-A101');
  const def102 = alpha.defects.find(d => d.id === 'DEF-102');
  assert.equal(def102.testCaseId, '');
  assert.deepEqual(tcA101.defectIds, [], 'Unlinking DEF-102 must remove DEF-102 from TC-A101.defectIds');

  // 3. Cross-project defect edit & move: Move DEF-101 from PRJ-ALPHA (linked to TC-A102) to PRJ-BETA (linked to TC-B102)
  // Even when opened with 'ALL' project scope, openDefectModal must locate DEF-101 in PRJ-ALPHA
  State.activeDefectsProjectId = 'ALL';
  openDefectModal('ALL', 'DEF-101');
  assert.equal(DOM.defectProjectIdInput.value, 'PRJ-ALPHA', 'Original project ID must be resolved to PRJ-ALPHA even when opened from ALL');
  assert.equal(DOM.defectProjectSelectField.value, 'PRJ-ALPHA');

  // Switch target project in modal to PRJ-BETA
  DOM.defectProjectSelectField.value = 'PRJ-BETA';
  DOM.defectProjectSelectField.dispatchEvent({ type: 'change', target: DOM.defectProjectSelectField });

  const betaCaseOptionValues = DOM.defectLinkedCaseSelect.options.map(o => o.getAttribute('value'));
  assert.deepEqual(
    betaCaseOptionValues,
    ['', 'TC-B101', 'TC-B102'],
    'Switching project in Defect modal must repopulate Linked Test Case dropdown with PRJ-BETA test cases'
  );

  DOM.defectLinkedCaseSelect.value = 'TC-B102';
  DOM.defectStatusSelect.value = 'In Progress';
  handleSaveDefectSubmit({ preventDefault() {} });

  projects = Storage.getProjects();
  alpha = projects.find(p => p.id === 'PRJ-ALPHA');
  let beta = projects.find(p => p.id === 'PRJ-BETA');
  tcA102 = alpha.testSuites[0].testCases.find(tc => tc.id === 'TC-A102');
  const tcB102 = beta.testSuites[0].testCases.find(tc => tc.id === 'TC-B102');

  assert.equal(
    alpha.defects.some(d => d.id === 'DEF-101'),
    false,
    'Moved defect DEF-101 must be removed from source project PRJ-ALPHA (no duplicates)'
  );
  const movedDef101 = beta.defects.find(d => d.id === 'DEF-101');
  assert.ok(movedDef101, 'Moved defect DEF-101 must exist in target project PRJ-BETA');
  assert.equal(movedDef101.testCaseId, 'TC-B102');
  assert.equal(movedDef101.status, 'In Progress');
  assert.deepEqual(tcA102.defectIds, [], 'Moving DEF-101 away from PRJ-ALPHA must remove DEF-101 from old TC-A102.defectIds');
  assert.deepEqual(tcB102.defectIds, ['DEF-101'], 'Moving DEF-101 to PRJ-BETA must add DEF-101 to new TC-B102.defectIds');

  // 4. Atomic rollback on Storage failure during multi-record update
  const snapshotBeforeFail = JSON.stringify(Storage.getProjects());
  openDefectModal('PRJ-BETA', 'DEF-101');
  DOM.defectProjectSelectField.value = 'PRJ-ALPHA';
  DOM.defectProjectSelectField.dispatchEvent({ type: 'change', target: DOM.defectProjectSelectField });
  DOM.defectLinkedCaseSelect.value = 'TC-A101';
  DOM.defectTitleInput.value = 'Should Roll Back On Quota Error';

  localStorage.__failNextWrite();
  handleSaveDefectSubmit({ preventDefault() {} });

  assert.equal(
    JSON.stringify(Storage.getProjects()),
    snapshotBeforeFail,
    'Failed Storage.saveProjects() must atomically roll back all in-memory and stored project/defect/testCase mutations'
  );

  // 5. Deleting a defect cleans up defectIds across projects
  requestUniversalDelete('defect', 'DEF-101', 'PRJ-BETA');
  executeUniversalDelete();

  projects = Storage.getProjects();
  beta = projects.find(p => p.id === 'PRJ-BETA');
  assert.equal(beta.defects.some(d => d.id === 'DEF-101'), false, 'Deleted defect should be removed from project.defects');
  assert.deepEqual(
    beta.testSuites[0].testCases.find(tc => tc.id === 'TC-B102').defectIds,
    [],
    'Deleting defect DEF-101 must clean up DEF-101 from TC-B102.defectIds'
  );

  console.log('✓ Test Group 3 passed (all QAV-ISS-006 assertions verified)\n');
}

// ============================================================================
// TEST GROUP 4 — QAV-ISS-007: Defect Creation with ALL Project Scope
// ============================================================================
console.log('--- Test Group 4: QAV-ISS-007 (Defect Creation with ALL Project Scope) ---');
{
  const { hook } = createQavoraTestEnvironment();
  const {
    State,
    DOM,
    Storage,
    switchView,
    openDefectModal,
    handleSaveDefectSubmit
  } = hook;

  seedPhase3Projects(Storage);
  switchView('defects');

  // 1. Ensure Defects workspace is in 'ALL' scope and click Create Defect (`#btn-create-defect`)
  State.activeDefectsProjectId = 'ALL';
  DOM.btnCreateDefect.click();

  assert.equal(DOM.defectModal.classList.contains('open'), true, 'Create Defect modal should open');
  assert.notEqual(DOM.defectProjectSelectField.value, 'ALL', 'Project select field must never be set to ALL');
  assert.equal(
    DOM.defectProjectSelectField.value,
    'PRJ-ALPHA',
    'When opened from ALL scope, Project select field must default to first valid project (PRJ-ALPHA)'
  );
  assert.equal(DOM.defectProjectIdInput.value, 'PRJ-ALPHA', 'Hidden project ID input must also hold valid real project ID');

  const projectOptions = DOM.defectProjectSelectField.options.map(o => o.getAttribute('value'));
  assert.equal(projectOptions.includes('ALL'), false, 'Defect modal Project select must only list real projects, never ALL');
  assert.deepEqual(projectOptions, ['PRJ-ALPHA', 'PRJ-BETA', 'PRJ-EMPTY']);

  // 2. Verify Linked Test Case dropdown is populated with PRJ-ALPHA's test cases
  const initialCaseOptions = DOM.defectLinkedCaseSelect.options.map(o => o.getAttribute('value'));
  assert.deepEqual(
    initialCaseOptions,
    ['', 'TC-A101', 'TC-A102', 'TC-A201'],
    'Linked Test Case dropdown must be populated with test cases from selected project (PRJ-ALPHA)'
  );

  // 3. Changing Project inside modal updates Linked Test Case dropdown immediately
  DOM.defectProjectSelectField.value = 'PRJ-BETA';
  DOM.defectProjectSelectField.dispatchEvent({ type: 'change', target: DOM.defectProjectSelectField });
  assert.deepEqual(
    DOM.defectLinkedCaseSelect.options.map(o => o.getAttribute('value')),
    ['', 'TC-B101', 'TC-B102'],
    'Switching project to PRJ-BETA must update Linked Test Case options to PRJ-BETA test cases'
  );

  // 4. Switching to a project with 0 test cases (`PRJ-EMPTY`) handles empty state cleanly
  DOM.defectProjectSelectField.value = 'PRJ-EMPTY';
  DOM.defectProjectSelectField.dispatchEvent({ type: 'change', target: DOM.defectProjectSelectField });
  assert.deepEqual(
    DOM.defectLinkedCaseSelect.options.map(o => o.getAttribute('value')),
    [''],
    'Project with 0 test cases should have only the default None option'
  );

  // 5. Saving a new defect without a linked test case from ALL scope
  DOM.defectTitleInput.value = 'Sandbox environment config warning on boot';
  DOM.defectSeveritySelect.value = 'Low';
  DOM.defectStatusSelect.value = 'Open';
  handleSaveDefectSubmit({ preventDefault() {} });

  let projects = Storage.getProjects();
  const emptyProj = projects.find(p => p.id === 'PRJ-EMPTY');
  assert.equal(emptyProj.defects.length, 1, 'New unlinked defect should be saved under PRJ-EMPTY');
  assert.equal(emptyProj.defects[0].testCaseId, '');

  // 6. Opening Create Defect from ALL scope, selecting PRJ-BETA + TC-B102, and saving
  State.activeDefectsProjectId = 'ALL';
  openDefectModal('ALL', null);
  DOM.defectProjectSelectField.value = 'PRJ-BETA';
  DOM.defectProjectSelectField.dispatchEvent({ type: 'change', target: DOM.defectProjectSelectField });
  DOM.defectLinkedCaseSelect.value = 'TC-B102';
  DOM.defectTitleInput.value = 'Keychain token rotation fails when device is locked';
  DOM.defectSeveritySelect.value = 'Critical';
  DOM.defectStatusSelect.value = 'Open';
  handleSaveDefectSubmit({ preventDefault() {} });

  projects = Storage.getProjects();
  const beta = projects.find(p => p.id === 'PRJ-BETA');
  const createdLinkedDefect = beta.defects.find(d => d.title === 'Keychain token rotation fails when device is locked');
  assert.ok(createdLinkedDefect, 'New linked defect should be created in PRJ-BETA');
  assert.equal(createdLinkedDefect.testCaseId, 'TC-B102');
  const tcB102 = beta.testSuites[0].testCases.find(tc => tc.id === 'TC-B102');
  assert.ok(
    tcB102.defectIds.includes(createdLinkedDefect.id),
    'Linked test case TC-B102 must contain the new defect ID in its defectIds array'
  );

  // 7. Validation guards: reject 'ALL' as targetProjectId and reject mismatched linkedCaseId from another project
  const countBeforeInvalid = Storage.getProjects().reduce((acc, p) => acc + p.defects.length, 0);
  openDefectModal('PRJ-ALPHA', null);
  DOM.defectTitleInput.value = 'Invalid ALL Project Defect';
  DOM.defectProjectSelectField.value = 'ALL';
  handleSaveDefectSubmit({ preventDefault() {} });

  const countAfterInvalidProject = Storage.getProjects().reduce((acc, p) => acc + p.defects.length, 0);
  assert.equal(countAfterInvalidProject, countBeforeInvalid, 'handleSaveDefectSubmit must reject ALL as targetProjectId');
  assert.equal(
    Storage.getProjects().some(p => p.id === 'ALL'),
    false,
    'ALL must never be persisted as a project ID'
  );

  // Reject linked test case that belongs to PRJ-BETA when saving to PRJ-ALPHA
  openDefectModal('PRJ-ALPHA', null);
  DOM.defectTitleInput.value = 'Cross-Project Mismatched Case Defect';
  DOM.defectProjectSelectField.value = 'PRJ-ALPHA';
  DOM.defectLinkedCaseSelect.value = 'TC-B101'; // Belongs to PRJ-BETA, not PRJ-ALPHA
  handleSaveDefectSubmit({ preventDefault() {} });

  const countAfterMismatchedCase = Storage.getProjects().reduce((acc, p) => acc + p.defects.length, 0);
  assert.equal(
    countAfterMismatchedCase,
    countBeforeInvalid,
    'handleSaveDefectSubmit must reject a linkedCaseId that does not belong to targetProject'
  );

  console.log('✓ Test Group 4 passed (all QAV-ISS-007 assertions verified)\n');
}

// ============================================================================
// TEST GROUP 5 — Phase 1 & Phase 2 Regression Verification
// ============================================================================
console.log('--- Test Group 5: Phase 1 & Phase 2 Regression Verification ---');
{
  const { hook } = createQavoraTestEnvironment();
  const {
    State,
    DOM,
    Storage,
    openExecutionModal,
    resetExecFilters,
    openSuiteCasesView,
    resetCaseFilters,
    switchView
  } = hook;

  seedPhase3Projects(Storage);

  // Phase 2 Regression A: Execution Modal Pass All Steps & Reset Steps
  openExecutionModal('PRJ-ALPHA', 'TC-A101');
  assert.ok(State.modalExecContext);
  DOM.btnPassAllSteps.click();
  assert.ok(State.modalExecContext.steps.every(s => s.status === 'completed'));
  DOM.btnResetAllSteps.click();
  assert.ok(State.modalExecContext.steps.every(s => s.status === 'untested'));

  // Phase 2 Regression B: Test Execution Filters & Reset
  switchView('execution');
  DOM.execProjectSelect.value = 'PRJ-ALPHA';
  DOM.execProjectSelect.dispatchEvent({ type: 'change', target: DOM.execProjectSelect });
  DOM.execFilterStatus.value = 'Fail';
  DOM.execFilterStatus.dispatchEvent({ type: 'change', target: DOM.execFilterStatus });
  assert.equal(State.execStatusFilter, 'Fail');
  assert.equal(DOM.execMetaCount.textContent, 'Showing 1 of 3 test cases (filtered)');
  resetExecFilters();
  assert.equal(State.execStatusFilter, 'ALL');
  assert.equal(DOM.execMetaCount.textContent, 'Showing all 3 test cases in project');

  // Phase 2 Regression C: Suite Cases Explorer Priority/Category Filter Reset
  openSuiteCasesView('PRJ-ALPHA', 'SUI-A1');
  DOM.caseFilterPriority.value = 'Critical';
  DOM.caseFilterPriority.dispatchEvent({ type: 'change', target: DOM.caseFilterPriority });
  assert.equal(State.casePriorityFilter, 'Critical');
  resetCaseFilters();
  assert.equal(DOM.caseFilterPriority.value, 'ALL');
  assert.equal(DOM.caseFilterCategory.value, 'ALL');

  // Phase 1 Regression: Storage Footprint Calculation & Checklist Promotion API
  const footprint = qaChecklistStore.calculateQavoraStorageFootprint();
  assert.ok(typeof footprint.totalBytes === 'number' && footprint.totalBytes > 0);
  assert.ok(
    'qavora_projects_v1' in footprint.keyBytes &&
      'qavora_qa_checklists_v1' in footprint.keyBytes &&
      'qavora_qa_active_runner_v1' in footprint.keyBytes
  );

  console.log('✓ Test Group 5 passed (Phase 1 & Phase 2 regressions verified)\n');
}

console.log('================================================================');
console.log('ALL PHASE 3 REMEDIATION VERIFICATION GROUPS PASSED (100%)');
console.log('================================================================');
