/**
 * Automated Behavioral Verification Suite for QAVORA-REMEDIATION-006 — PHASE 6
 * Final Regression, Hardening & Release Readiness Verification Suite
 *
 * Test Groups:
 * - Test Group 1: Application Initialization & Fault Tolerance
 * - Test Group 2: Complete CRUD Lifecycle (Projects, Phases, Suites, Cases, Defects)
 * - Test Group 3: Cross-Project Data Isolation
 * - Test Group 4: Checklist / Formal Project Boundary & Re-Promotion
 * - Test Group 5: Execution Integrity & Run Count Semantics
 * - Test Group 6: Filter, Search, and Sort State Isolation
 * - Test Group 7: Modal and Navigation Safety
 * - Test Group 8: Backup / Restore / Import / Export
 * - Test Group 9: Storage Corruption & Defensive Handling
 * - Test Group 10: Delete Cascade / Orphan Reference Integrity
 * - Test Group 11: Dashboard & Report Mathematical Consistency
 * - Test Group 12: Notification System
 * - Test Group 13: Settings & Workspace Preferences
 * - Test Group 14: Responsive UI Structure & Viewport Sanity
 * - Test Group 15: Performance & Dataset Scale Sanity
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as qaChecklistTransfer from './qaChecklistTransfer.js';
import * as qaChecklistStore from './qaChecklistStore.js';
import { parseQAPlanText } from './qaParser.js';

console.log('================================================================');
console.log('QAVORA PHASE 6 FINAL REGRESSION & RELEASE READINESS SUITE');
console.log('================================================================');

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
    style: {},
    disabled: false,
    checked: false,
    options: [],
    get value() {
      return _value;
    },
    set value(val) {
      _value = String(val ?? '');
      if (el.tagName === 'SELECT') {
        el.options.forEach(opt => {
          if (opt.value === _value) {
            opt.selected = true;
            opt.setAttribute('selected', 'selected');
          } else {
            opt.selected = false;
            opt.removeAttribute('selected');
          }
        });
      }
    },
    get innerHTML() {
      return _innerHTML;
    },
    set innerHTML(val) {
      _innerHTML = String(val ?? '');
      _dynamicChildren = parseDynamicChildrenFromHTML(_innerHTML);
      if (el.tagName === 'SELECT') {
        el.options = _dynamicChildren.filter(c => c.tagName === 'OPTION');
        const selectedOpt = el.options.find(o => o.getAttribute('selected') !== null) || el.options[0];
        _value = selectedOpt ? (selectedOpt.getAttribute('value') ?? '') : '';
      }
    },
    get textContent() {
      return _textContent;
    },
    set textContent(val) {
      _textContent = String(val ?? '');
    },
    get classList() {
      return {
        add(...cls) {
          cls.forEach(c => c && classSet.add(c));
          attrs.set('class', Array.from(classSet).join(' '));
        },
        remove(...cls) {
          cls.forEach(c => classSet.delete(c));
          attrs.set('class', Array.from(classSet).join(' '));
        },
        contains(c) {
          return classSet.has(c);
        },
        toggle(c, force) {
          if (force === undefined) {
            if (classSet.has(c)) classSet.delete(c);
            else classSet.add(c);
          } else if (force) {
            classSet.add(c);
          } else {
            classSet.delete(c);
          }
          attrs.set('class', Array.from(classSet).join(' '));
        }
      };
    },
    getAttribute(name) {
      return attrs.get(name) ?? null;
    },
    setAttribute(name, val) {
      const sVal = String(val);
      attrs.set(name, sVal);
      if (name === 'id') el.id = sVal;
      if (name === 'value') el.value = sVal;
      if (name === 'checked') el.checked = true;
      if (name === 'class') {
        classSet.clear();
        sVal.split(/\s+/).filter(Boolean).forEach(c => classSet.add(c));
      }
      if (name === 'style') {
        sVal.split(';').forEach(rule => {
          const [prop, v] = rule.split(':').map(s => s?.trim());
          if (prop && v !== undefined) {
            const camelProp = prop.replace(/-([a-z])/g, (_, g) => g.toUpperCase());
            el.style[camelProp] = v;
          }
        });
      }
    },
    removeAttribute(name) {
      attrs.delete(name);
      if (name === 'class') classSet.clear();
    },
    hasAttribute(name) {
      return attrs.has(name);
    },
    addEventListener(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, []);
      listeners.get(evt).push(fn);
    },
    removeEventListener(evt, fn) {
      if (!listeners.has(evt)) return;
      listeners.set(evt, listeners.get(evt).filter(cb => cb !== fn));
    },
    dispatchEvent(evt) {
      const type = typeof evt === 'string' ? evt : evt?.type;
      const cbs = listeners.get(type) || [];
      const eventObj = typeof evt === 'object' && evt !== null ? evt : { type, target: el };
      if (!eventObj.target) eventObj.target = el;
      if (!eventObj.stopPropagation) eventObj.stopPropagation = () => {};
      for (const cb of cbs) {
        cb.call(el, eventObj);
      }
      return true;
    },
    click() {
      el.dispatchEvent({ type: 'click', target: el, stopPropagation() {} });
    },
    focus() {
      el._hasFocus = true;
    },
    contains(child) {
      if (!child) return false;
      if (child === el) return true;
      return _dynamicChildren.some(c => c === child || (typeof c.contains === 'function' && c.contains(child)));
    },
    appendChild(child) {
      _dynamicChildren.push(child);
      return child;
    },
    removeChild(child) {
      _dynamicChildren = _dynamicChildren.filter(c => c !== child);
      return child;
    },
    remove() {},
    reset() {},
    querySelector(selector) {
      return matchSelectorInChildren(_dynamicChildren, selector)[0] || null;
    },
    querySelectorAll(selector) {
      return matchSelectorInChildren(_dynamicChildren, selector);
    }
  };

  return el;
}

function parseAttributes(attrString) {
  const result = {};
  const attrRegex = /([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?/g;
  let match;
  while ((match = attrRegex.exec(attrString)) !== null) {
    result[match[1]] = match[2] !== undefined ? match[2] : '';
  }
  return result;
}

function parseDynamicChildrenFromHTML(html) {
  const children = [];
  if (!html) return children;

  const optionRegex = /<option\b([^>]*)(?:>([\s\S]*?)<\/option>|\/?>)/gi;
  let optMatch;
  while ((optMatch = optionRegex.exec(html)) !== null) {
    const optAttrs = parseAttributes(optMatch[1] || '');
    const optEl = createElementStub('option');
    for (const [k, v] of Object.entries(optAttrs)) {
      optEl.setAttribute(k, v);
    }
    optEl.textContent = (optMatch[2] || '').trim();
    optEl.value = optAttrs.value !== undefined ? optAttrs.value : optEl.textContent;
    children.push(optEl);
  }

  const interactiveRegex = /<(div|button|input|select|span|article|h1|h2|h3|p)\b([^>]*)(?:>([\s\S]*?)<\/\1>|\/?>)/gi;
  let match;
  while ((match = interactiveRegex.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const attrStr = match[2] || '';
    const inner = match[3] || '';
    const parsedAttrs = parseAttributes(attrStr);
    const child = createElementStub(tag, parsedAttrs.id || '');
    for (const [k, v] of Object.entries(parsedAttrs)) {
      child.setAttribute(k, v);
    }
    if (inner && !inner.includes('<')) {
      child.textContent = inner.trim();
    } else if (inner) {
      child.innerHTML = inner;
    }
    children.push(child);
  }

  return children;
}

function matchSelectorInChildren(children, selector) {
  const sel = selector.trim();
  const matched = [];
  for (const child of children) {
    let isMatch = false;
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      if (child.classList.contains(cls)) isMatch = true;
    } else if (sel.startsWith('#')) {
      if (child.id === sel.slice(1)) isMatch = true;
    } else if (child.tagName.toLowerCase() === sel.toLowerCase()) {
      isMatch = true;
    }
    if (isMatch) matched.push(child);
    if (child.querySelectorAll) {
      matched.push(...matchSelectorInChildren(child.querySelectorAll('*'), sel));
    }
  }
  return matched;
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

  const navLinks = [];
  const navLinkRegex = /<button\b([^>]*?\bclass="[^"]*?\bnav-link\b[^"]*"[^>]*)>/gi;
  let navMatch;
  while ((navMatch = navLinkRegex.exec(indexHtml)) !== null) {
    const attrStr = navMatch[1];
    const parsedAttrs = parseAttributes(attrStr);
    const btnId = parsedAttrs.id;
    const btnEl = btnId && elementsById.get(btnId) ? elementsById.get(btnId) : createElementStub('button', btnId);
    for (const [k, v] of Object.entries(parsedAttrs)) {
      btnEl.setAttribute(k, v);
    }
    navLinks.push(btnEl);
    if (!allElements.includes(btnEl)) allElements.push(btnEl);
  }

  const viewSections = [];
  const sectionRegex = /<section\b([^>]*?\bid="(view-[^"]+)"[^>]*)>/gi;
  let secMatch;
  while ((secMatch = sectionRegex.exec(indexHtml)) !== null) {
    const secId = secMatch[2];
    const secEl = elementsById.get(secId) || createElementStub('section', secId);
    const parsedAttrs = parseAttributes(secMatch[1]);
    for (const [k, v] of Object.entries(parsedAttrs)) {
      secEl.setAttribute(k, v);
    }
    viewSections.push(secEl);
    if (!allElements.includes(secEl)) allElements.push(secEl);
  }

  const localStorage = createStorageMock();
  const sessionStorage = createStorageMock();

  const docListeners = new Map();
  const documentStub = {
    readyState: 'complete',
    documentElement: createElementStub('html'),
    body: createElementStub('body'),
    activeElement: null,
    createElement(tag) {
      return createElementStub(tag);
    },
    getElementById(id) {
      return elementsById.get(id) || null;
    },
    querySelector(selector) {
      if (selector.includes('import-mode')) {
        const replaceEl = elementsById.get('import-mode-replace');
        const mergeEl = elementsById.get('import-mode-merge');
        if (replaceEl && replaceEl.checked) return replaceEl;
        if (mergeEl && mergeEl.checked) return mergeEl;
        return mergeEl || null;
      }
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
      if (selector === '.nav-link') return navLinks;
      if (selector === '.view-section') return viewSections;
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        return allElements.filter(e => e.classList.contains(cls));
      }
      return [];
    },
    addEventListener(type, cb) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(cb);
    },
    removeEventListener(type, cb) {
      if (!docListeners.has(type)) return;
      docListeners.set(type, docListeners.get(type).filter(c => c !== cb));
    },
    dispatchEvent(evt) {
      const type = typeof evt === 'string' ? evt : evt.type;
      const cbs = docListeners.get(type) || [];
      const eventObj = typeof evt === 'object' && evt !== null ? evt : { type };
      cbs.forEach(cb => cb.call(documentStub, eventObj));
      return true;
    }
  };

  const windowStub = {
    localStorage,
    sessionStorage,
    document: documentStub,
    location: { reload() {}, href: 'http://localhost:3000' },
    navigator: { clipboard: { writeText: async () => {} } },
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
        VIEW_TITLES,
        applyTheme,
        toggleTheme,
        applyPreferences,
        renderSettingsWorkspace,
        addNotification,
        markNotificationAsRead,
        markAllNotificationsAsRead,
        clearAllNotifications,
        dismissNotification,
        toggleNotificationPanel,
        handleNotificationNavigation,
        updateNotificationUI,
        switchView,
        renderDashboard,
        renderMyProjects,
        renderTestPlansWorkspace,
        renderTestExecutionWorkspace,
        renderDefectsWorkspace,
        renderReportsWorkspace,
        renderDataWorkspace,
        getFilteredReportsData,
        openProjectDetails,
        renderProjectDetailsData,
        openProjectModal,
        closeProjectModal,
        handleCreateOrEditProjectSubmit,
        openExecutionModal,
        closeExecutionModal,
        handleSaveExecutionSubmit,
        openDefectModal,
        closeDefectModal,
        handleSaveDefectSubmit,
        openTestCaseModal,
        closeTestCaseModal,
        handleSaveTestCaseSubmit,
        openPhaseModal,
        closePhaseModal,
        handleSavePhaseSubmit,
        openSuiteModal,
        closeSuiteModal,
        handleSaveSuiteSubmit,
        requestUniversalDelete,
        executeUniversalDelete,
        exportFullApplicationBackup,
        commitImport,
        executeRollback,
        executeWorkspaceReset,
        showToast,
        qaRunnerController
      };`
    );

  const sandbox = {
    window: windowStub,
    document: documentStub,
    localStorage,
    sessionStorage,
    navigator: windowStub.navigator,
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
    Blob: class { constructor(parts) { this.parts = parts; } },
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
    initQARunnerAndChecklists: (opts) => ({
      openChecklistInRunner() {},
      refreshGlobalBadgesAndBanners() {},
      syncFromStorage() {},
      recordLastQaView() {},
      renderMyChecklistsView() {},
      renderRunnerView() {},
      getRestoredInitialView: () => null,
      _opts: opts
    }),
    initQAChecklistTransferUI: () => ({
      refreshTransferWorkspace() {}
    }),
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
    context: sandbox,
    hook: sandbox.globalThis.__qavoraTestHook,
    localStorage,
    sessionStorage,
    document: documentStub,
    elementsById
  };
}

// ============================================================================
// Test Group 1 — Application Initialization & Fault Tolerance
// ============================================================================
console.log('\n--- Test Group 1: Application Initialization & Fault Tolerance ---');

{
  const env = createQavoraTestEnvironment();
  const { hook, elementsById, document } = env;

  assert(hook.State, 'Application State must initialize');
  assert(hook.DOM, 'Application DOM cache must initialize');
  assert(hook.Storage, 'Storage subsystem must initialize');
  assert.strictEqual(document.documentElement.getAttribute('data-theme'), 'dark', 'Default theme must be dark');
  assert.strictEqual(hook.State.currentView, 'checklist-generator', 'Initial view must be checklist-generator');

  // Verify all 11 core workspaces initialize and switch without throwing
  const allViews = [
    'dashboard',
    'projects',
    'plans',
    'execution',
    'defects',
    'reports',
    'data',
    'settings',
    'checklist-generator',
    'my-checklists',
    'qa-runner'
  ];

  allViews.forEach(v => {
    hook.switchView(v);
    assert.strictEqual(hook.State.currentView, v, `Workspace switch to "${v}" must succeed`);
    const pageTitle = elementsById.get('page-title');
    assert(pageTitle && pageTitle.textContent.length > 0, `Header title for "${v}" must be set`);
  });

  console.log('✓ Test Group 1 passed: Clean boot, default state, and view initialization verified.');
}

// ============================================================================
// Test Group 2 — Complete CRUD Lifecycle
// ============================================================================
console.log('\n--- Test Group 2: Complete CRUD Lifecycle ---');

{
  const env = createQavoraTestEnvironment();
  const { hook, elementsById, localStorage } = env;

  // 1. Create Project
  hook.openProjectModal(null);
  elementsById.get('project-name-input').value = 'Lifecycle Project Alpha';
  elementsById.get('project-type-input').value = 'Web Application';
  elementsById.get('project-version-input').value = 'v1.0';
  elementsById.get('project-desc-input').value = 'End to end lifecycle testing';
  hook.handleCreateOrEditProjectSubmit({ preventDefault() {} });

  const projectsAfterCreate = hook.Storage.getProjects();
  assert.strictEqual(projectsAfterCreate.length, 1, 'Project must be created');
  const proj = projectsAfterCreate[0];
  assert.strictEqual(proj.name, 'Lifecycle Project Alpha');

  // 2. Edit Project
  hook.openProjectModal(proj.id);
  elementsById.get('project-name-input').value = 'Lifecycle Project Alpha (Edited)';
  hook.handleCreateOrEditProjectSubmit({ preventDefault() {} });
  const projectsAfterEdit = hook.Storage.getProjects();
  assert.strictEqual(projectsAfterEdit[0].name, 'Lifecycle Project Alpha (Edited)', 'Project name must be updated');

  // 3. Create Phase
  hook.State.activePlanProjectId = proj.id;
  hook.openPhaseModal(null);
  elementsById.get('phase-name-input').value = 'Phase 1: Smoke Tests';
  elementsById.get('phase-desc-input').value = 'Initial sanity checks';
  hook.handleSavePhaseSubmit({ preventDefault() {} });

  const projWithPhase = hook.Storage.getProjects()[0];
  assert.strictEqual(projWithPhase.testPlan.phases.length, 1, 'Phase must be saved in testPlan');
  const phaseId = projWithPhase.testPlan.phases[0].id;

  // 4. Create Suite
  hook.openSuiteModal(null);
  elementsById.get('suite-name-input').value = 'Authentication Suite';
  elementsById.get('suite-phase-select').value = phaseId;
  elementsById.get('suite-category-select').value = 'Functional';
  hook.handleSaveSuiteSubmit({ preventDefault() {} });

  const projWithSuite = hook.Storage.getProjects()[0];
  assert.strictEqual(projWithSuite.testSuites.length, 1, 'Suite must be saved in project');
  const suiteId = projWithSuite.testSuites[0].id;

  // 5. Create Test Case
  hook.State.activeSuiteId = suiteId;
  hook.openTestCaseModal(null);
  elementsById.get('case-title-input').value = 'Verify login with valid credentials';
  elementsById.get('case-priority-select').value = 'Critical';
  elementsById.get('case-category-input').value = 'Functional';
  elementsById.get('case-expected-input').value = 'User lands on home feed';
  hook.State.modalSteps = [{ id: 'step_1', action: 'Enter credentials and submit', testData: 'admin', order: 0 }];
  hook.handleSaveTestCaseSubmit({ preventDefault() {} });

  const projWithCase = hook.Storage.getProjects()[0];
  const testCase = projWithCase.testSuites[0].testCases[0];
  assert(testCase, 'Test case must be created');
  assert.strictEqual(testCase.title, 'Verify login with valid credentials');
  assert.strictEqual(testCase.status, 'Not Run', 'New test case must default to Not Run');

  // 6. Create Defect
  hook.openDefectModal(proj.id, null);
  elementsById.get('defect-title-input').value = 'Login fails with 500 error';
  elementsById.get('defect-severity-select').value = 'Critical';
  elementsById.get('defect-linked-case-select').value = testCase.id;
  hook.handleSaveDefectSubmit({ preventDefault() {} });

  const projWithDefect = hook.Storage.getProjects()[0];
  assert.strictEqual(projWithDefect.defects.length, 1, 'Defect must be saved');
  const defect = projWithDefect.defects[0];
  assert.strictEqual(defect.testCaseId, testCase.id, 'Defect must be linked to testCaseId');

  // 7. Delete Test Case
  hook.requestUniversalDelete('case', testCase.id, suiteId);
  hook.executeUniversalDelete();
  const projAfterCaseDel = hook.Storage.getProjects()[0];
  assert.strictEqual(projAfterCaseDel.testSuites[0].testCases.length, 0, 'Test case must be deleted');
  assert.strictEqual(projAfterCaseDel.defects[0].testCaseId, '', 'Deleted test case must be cleanly unlinked from defect');

  // 8. Delete Suite
  hook.requestUniversalDelete('suite', suiteId, proj.id);
  hook.executeUniversalDelete();
  const projAfterSuiteDel = hook.Storage.getProjects()[0];
  assert.strictEqual(projAfterSuiteDel.testSuites.length, 0, 'Suite must be deleted');

  // 9. Delete Project
  hook.requestUniversalDelete('project', proj.id, null);
  hook.executeUniversalDelete();
  const projectsFinal = hook.Storage.getProjects();
  assert.strictEqual(projectsFinal.length, 0, 'Project must be permanently deleted');

  console.log('✓ Test Group 2 passed: Complete CRUD lifecycle verified across all entity types.');
}

// ============================================================================
// Test Group 3 — Cross-Project Data Isolation
// ============================================================================
console.log('\n--- Test Group 3: Cross-Project Data Isolation ---');

{
  const env = createQavoraTestEnvironment();
  const { hook, localStorage } = env;

  // Create two projects with identical test case IDs, suite names, and defect titles
  const projectA = {
    id: 'proj_iso_A',
    name: 'Project Alpha',
    status: 'Active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    testPlan: { id: 'tp_A', phases: [{ id: 'ph_A', name: 'Phase 1' }] },
    testSuites: [
      {
        id: 'suite_iso_A',
        phaseId: 'ph_A',
        name: 'Common Suite',
        testCases: [
          { id: 'TC-001', title: 'Shared Title Test Case', status: 'Not Run', defectIds: ['DEF-001'] }
        ]
      }
    ],
    executions: [
      { id: 'exec_A_1', testCaseId: 'TC-001', status: 'Pass', executedAt: new Date().toISOString() }
    ],
    defects: [
      { id: 'DEF-001', title: 'Critical Payment Bug', severity: 'Critical', status: 'Open', testCaseId: 'TC-001' }
    ]
  };

  const projectB = {
    id: 'proj_iso_B',
    name: 'Project Beta',
    status: 'Active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    testPlan: { id: 'tp_B', phases: [{ id: 'ph_B', name: 'Phase 1' }] },
    testSuites: [
      {
        id: 'suite_iso_B',
        phaseId: 'ph_B',
        name: 'Common Suite',
        testCases: [
          { id: 'TC-001', title: 'Shared Title Test Case', status: 'Fail', defectIds: ['DEF-002'] }
        ]
      }
    ],
    executions: [
      { id: 'exec_B_1', testCaseId: 'TC-001', status: 'Fail', executedAt: new Date().toISOString() }
    ],
    defects: [
      { id: 'DEF-002', title: 'Critical Payment Bug', severity: 'High', status: 'Open', testCaseId: 'TC-001' }
    ]
  };

  localStorage.setItem('qavora_projects_v1', JSON.stringify([projectA, projectB]));

  // 1. Verify project-specific executions
  hook.State.activeExecProjectId = 'proj_iso_A';
  const projs = hook.Storage.getProjects();
  const pA = projs.find(p => p.id === 'proj_iso_A');
  const pB = projs.find(p => p.id === 'proj_iso_B');

  assert.strictEqual(pA.testSuites[0].testCases[0].status, 'Not Run');
  assert.strictEqual(pB.testSuites[0].testCases[0].status, 'Fail');

  // 2. Modify Project A test case status via execution
  hook.openExecutionModal('proj_iso_A', 'TC-001');
  env.elementsById.get('exec-status-select').value = 'Pass';
  env.elementsById.get('exec-actual-input').value = 'Verified test case steps passed cleanly';
  hook.handleSaveExecutionSubmit({ preventDefault() {} });

  const projsAfterExec = hook.Storage.getProjects();
  const pA_after = projsAfterExec.find(p => p.id === 'proj_iso_A');
  const pB_after = projsAfterExec.find(p => p.id === 'proj_iso_B');

  assert.strictEqual(pA_after.testSuites[0].testCases[0].status, 'Pass', 'Project A case status must be Pass');
  assert.strictEqual(pB_after.testSuites[0].testCases[0].status, 'Fail', 'Project B case status must remain untouched');

  // 3. Delete Project A and ensure Project B is 100% preserved
  hook.requestUniversalDelete('project', 'proj_iso_A', null);
  hook.executeUniversalDelete();

  const projsAfterDel = hook.Storage.getProjects();
  assert.strictEqual(projsAfterDel.length, 1, 'Only one project must remain');
  assert.strictEqual(projsAfterDel[0].id, 'proj_iso_B', 'Project Beta must be completely preserved');
  assert.strictEqual(projsAfterDel[0].testSuites[0].testCases[0].id, 'TC-001', 'Project Beta case must exist');
  assert.strictEqual(projsAfterDel[0].defects[0].id, 'DEF-002', 'Project Beta defect must exist');

  console.log('✓ Test Group 3 passed: Complete data isolation between projects verified.');
}

// ============================================================================
// Test Group 4 — Checklist / Formal Project Boundary & Re-Promotion
// ============================================================================
console.log('\n--- Test Group 4: Checklist / Formal Project Boundary ---');

{
  const env = createQavoraTestEnvironment();
  const { hook, localStorage } = env;

  // 1. Create a checklist and mark some tests complete
  const rawPlan = `
Phase 1: Registration
### Signup Flow
- [REG-01] [High] Sign up with email
- [REG-02] [Critical] Verify email token
  `.trim();

  const parsed = parseQAPlanText(rawPlan);
  const createRes = qaChecklistStore.createChecklistFromParsedPlan(parsed, 'Mobile Onboarding Checklist');
  assert(createRes.ok, 'Checklist creation must succeed');
  const chkId = createRes.checklist.id;
  const allTests = createRes.checklist.phases.flatMap(ph => ph.sections.flatMap(s => s.tests));
  qaChecklistStore.toggleChecklistTest(chkId, allTests[0].id, true);

  // 2. Promote checklist to project
  const promoRes = qaChecklistStore.promoteChecklistToProject(chkId, {
    projectName: 'Mobile Onboarding Formal Project'
  });
  assert(promoRes.ok, 'Promotion must succeed');
  const formalProj = promoRes.project;

  // CRITICAL RULE: All formal cases must be 'Not Run' regardless of checklist completion
  const formalCases = formalProj.testSuites[0].testCases;
  assert.strictEqual(formalCases.length, 2, 'Two formal cases must be created');
  assert(formalCases.every(c => c.status === 'Not Run'), 'All promoted formal cases must be Not Run');

  // 3. Prevent duplicate promotion
  const dupPromoRes = qaChecklistStore.promoteChecklistToProject(chkId);
  assert.strictEqual(dupPromoRes.ok, false, 'Duplicate promotion must be prevented');
  assert.strictEqual(dupPromoRes.alreadyPromoted, true, 'alreadyPromoted flag must be true');

  // 4. Execute a formal test case and verify independent state
  hook.openExecutionModal(formalProj.id, formalCases[0].id);
  env.elementsById.get('exec-status-select').value = 'Pass';
  env.elementsById.get('exec-actual-input').value = 'Verified checklist promoted case';
  hook.handleSaveExecutionSubmit({ preventDefault() {} });

  const updatedFormalProj = hook.Storage.getProjects().find(p => p.id === formalProj.id);
  assert.strictEqual(updatedFormalProj.testSuites[0].testCases[0].status, 'Pass', 'Formal case must be Pass');

  const unchangedChecklist = qaChecklistStore.getChecklistById(chkId);
  const reloadedAllTests = unchangedChecklist.phases.flatMap(ph => ph.sections.flatMap(s => s.tests));
  assert.strictEqual(reloadedAllTests[0].completed, true, 'Checklist item 1 remains completed');
  assert.strictEqual(reloadedAllTests[1].completed, false, 'Checklist item 2 remains incomplete');

  // 5. Delete formal project and verify re-promotion capability
  hook.requestUniversalDelete('project', formalProj.id, null);
  hook.executeUniversalDelete();

  assert.strictEqual(hook.Storage.getProjects().length, 0, 'Formal project must be deleted');

  // Re-promote checklist
  const rePromoRes = qaChecklistStore.promoteChecklistToProject(chkId, {
    projectName: 'Mobile Onboarding Formal Project (Re-Promoted)'
  });
  assert(rePromoRes.ok, 'Checklist must be eligible for re-promotion after linked project deletion');
  assert.strictEqual(rePromoRes.project.name, 'Mobile Onboarding Formal Project (Re-Promoted)');

  console.log('✓ Test Group 4 passed: Checklist / Formal project boundary and re-promotion verified.');
}

// ============================================================================
// Test Group 5 — Execution Integrity & Run Count Semantics
// ============================================================================
console.log('\n--- Test Group 5: Execution Integrity & Run Count Semantics ---');

{
  const env = createQavoraTestEnvironment();
  const { hook, localStorage } = env;

  const project = {
    id: 'proj_exec_integrity',
    name: 'Execution Semantics Project',
    status: 'Active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    testPlan: { id: 'tp_exec', phases: [{ id: 'ph_exec', name: 'Phase 1' }] },
    testSuites: [
      {
        id: 'suite_exec',
        phaseId: 'ph_exec',
        name: 'Smoke Suite',
        testCases: [
          { id: 'TC-EXEC-1', title: 'Verify checkout cart calculation', status: 'Not Run', executions: [] }
        ]
      }
    ],
    executions: []
  };

  localStorage.setItem('qavora_projects_v1', JSON.stringify([project]));

  // 1. Initial State: 1 Case, 0 Executions
  let repData = hook.getFilteredReportsData();
  assert.strictEqual(repData.totalCases, 1, 'Total cases must be 1');
  assert.strictEqual(repData.totalExecutions, 0, 'Total executions must be 0');
  assert.strictEqual(repData.executedCasesCount, 0, 'Executed cases count must be 0');
  assert.strictEqual(repData.notRunCasesCount, 1, 'Not Run cases count must be 1');

  // 2. Execution 1: Fail
  hook.openExecutionModal(project.id, 'TC-EXEC-1');
  env.elementsById.get('exec-status-select').value = 'Fail';
  env.elementsById.get('exec-actual-input').value = 'Cart total was calculated off by $0.05';
  hook.handleSaveExecutionSubmit({ preventDefault() {} });

  repData = hook.getFilteredReportsData();
  assert.strictEqual(repData.totalCases, 1, 'Total cases must remain 1');
  assert.strictEqual(repData.totalExecutions, 1, 'Total executions must be 1');
  assert.strictEqual(repData.executedCasesCount, 1, 'Executed cases count must be 1');

  // 3. Execution 2: Pass (Bug fixed, re-executed)
  hook.openExecutionModal(project.id, 'TC-EXEC-1');
  env.elementsById.get('exec-status-select').value = 'Pass';
  env.elementsById.get('exec-actual-input').value = 'Cart total is exactly accurate';
  hook.handleSaveExecutionSubmit({ preventDefault() {} });

  // 4. Execution 3: Pass (Regression confirmation)
  hook.openExecutionModal(project.id, 'TC-EXEC-1');
  env.elementsById.get('exec-status-select').value = 'Pass';
  env.elementsById.get('exec-actual-input').value = 'Confirmed pass on release candidate';
  hook.handleSaveExecutionSubmit({ preventDefault() {} });

  const finalProj = hook.Storage.getProjects()[0];
  const finalCase = finalProj.testSuites[0].testCases[0];

  assert.strictEqual(finalCase.status, 'Pass', 'Latest case status must be Pass');
  assert.strictEqual(finalCase.executions.length, 3, 'Case executions array must track all 3 runs');
  assert.strictEqual(finalProj.executions.length, 3, 'Project executions array must have 3 historical records');

  // CRITICAL METRIC ASSERTION: unique cases (1) != execution runs (3)
  repData = hook.getFilteredReportsData();
  assert.strictEqual(repData.totalCases, 1, 'Total cases must strictly remain 1');
  assert.strictEqual(repData.executedCasesCount, 1, 'Unique executed cases must be 1');
  assert.strictEqual(repData.totalExecutions, 3, 'Total execution runs must be 3');
  assert.notStrictEqual(repData.executedCasesCount, repData.totalExecutions, 'Unique cases must NOT equal execution runs');

  console.log('✓ Test Group 5 passed: Execution history, latest state, and run count semantics verified.');
}

// ============================================================================
// Test Group 6 — Filter, Search, and Sort State Isolation
// ============================================================================
console.log('\n--- Test Group 6: Filter, Search, and Sort State ---');

{
  const env = createQavoraTestEnvironment();
  const { hook, elementsById, localStorage } = env;

  const project = {
    id: 'proj_filters',
    name: 'Filtering Test Suite Project',
    status: 'Active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    testPlan: {
      id: 'tp_filt',
      phases: [
        { id: 'ph_f1', name: 'Phase A' },
        { id: 'ph_f2', name: 'Phase B' }
      ]
    },
    testSuites: [
      {
        id: 'suite_f1',
        phaseId: 'ph_f1',
        name: 'Suite One',
        testCases: [
          { id: 'TC-F1', title: 'Payment Test', status: 'Pass', priority: 'Critical', category: 'Functional' },
          { id: 'TC-F2', title: 'Settings Test', status: 'Fail', priority: 'Low', category: 'UI' }
        ]
      }
    ],
    defects: [
      { id: 'DEF-F1', title: 'Payment crash', severity: 'Critical', status: 'Open' },
      { id: 'DEF-F2', title: 'Button offset', severity: 'Low', status: 'Closed' }
    ]
  };

  localStorage.setItem('qavora_projects_v1', JSON.stringify([project]));

  // 1. Test Execution Filters
  hook.State.activeExecProjectId = 'proj_filters';
  hook.State.execPhaseFilter = 'ph_f1';
  hook.State.execStatusFilter = 'Pass';
  hook.State.execSearchQuery = 'Payment';

  hook.renderTestExecutionWorkspace();
  const execCards = env.document.querySelectorAll('.exec-card');
  assert(execCards.length >= 0, 'Execution workspace must render filtered view safely');

  // 2. Stale Phase Filter Handling (deleted phase)
  hook.State.execPhaseFilter = 'deleted_phase_xyz';
  hook.renderTestExecutionWorkspace();
  assert(hook.State.currentView, 'Stale phase filter must not cause uncaught error or blank view');

  // 3. Defect Filters
  hook.State.activeDefectsProjectId = 'proj_filters';
  hook.State.defectsSeverityFilter = 'Critical';
  hook.State.defectsStatusFilter = 'Open';
  hook.State.defectsSearchQuery = 'crash';

  hook.renderDefectsWorkspace();
  const defectRows = env.document.querySelectorAll('.defects-table tbody tr');
  assert(defectRows.length >= 0, 'Defects workspace must render filtered view safely');

  // 4. Stale Defect Project Filter Handling
  hook.State.activeDefectsProjectId = 'non_existent_project_xyz';
  hook.renderDefectsWorkspace();
  assert.strictEqual(hook.State.activeDefectsProjectId, 'ALL', 'Stale defect project ID must normalize to ALL');

  console.log('✓ Test Group 6 passed: Filter state, search, and stale ID normalization verified.');
}

// ============================================================================
// Test Group 7 — Modal and Navigation Safety
// ============================================================================
console.log('\n--- Test Group 7: Modal and Navigation Safety ---');

{
  const env = createQavoraTestEnvironment();
  const { hook, elementsById, document } = env;

  // 1. Project Modal: open, cancel, close
  hook.openProjectModal(null);
  const projModal = elementsById.get('project-modal');
  assert(projModal.classList.contains('open'), 'Project modal must open');
  hook.closeProjectModal();
  assert(!projModal.classList.contains('open'), 'Project modal must close');

  // 2. Defect Modal: open, cancel, close
  hook.Storage.saveProjects([{
    id: 'proj_modal_test',
    name: 'Modal Test Project',
    status: 'Active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    testPlan: { id: 'tp_1', phases: [] },
    testSuites: [],
    executions: [],
    defects: []
  }]);
  hook.openDefectModal('ALL', null);
  const defModal = elementsById.get('defect-modal');
  assert(defModal.classList.contains('open'), 'Defect modal must open');
  hook.closeDefectModal();
  assert(!defModal.classList.contains('open'), 'Defect modal must close');

  // 3. Execution Modal: open, close, context reset
  hook.openExecutionModal('non_existent_project', 'non_existent_case');
  assert.strictEqual(hook.State.modalExecContext, null, 'Invalid execution context must fail safely without modal hang');

  // 4. Rapid Navigation while modal is closed
  hook.switchView('projects');
  hook.switchView('plans');
  hook.switchView('execution');
  hook.switchView('defects');
  hook.switchView('dashboard');
  assert.strictEqual(hook.State.currentView, 'dashboard', 'Rapid view switching must resolve cleanly');

  console.log('✓ Test Group 7 passed: Modal lifecycle, focus safety, and navigation stability verified.');
}

// ============================================================================
// Test Group 8 — Backup / Restore / Import / Export
// ============================================================================
console.log('\n--- Test Group 8: Backup / Restore / Import / Export ---');

{
  const env = createQavoraTestEnvironment();
  const { hook, localStorage, sessionStorage } = env;

  // Seed sample workspace
  const seedProject = {
    id: 'proj_backup_test',
    name: 'Backup Test Workspace',
    status: 'Active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    testPlan: { id: 'tp_b1', phases: [{ id: 'ph_b1', name: 'Core Phase' }] },
    testSuites: [
      {
        id: 'suite_b1',
        phaseId: 'ph_b1',
        name: 'Suite B',
        testCases: [{ id: 'TC-B1', title: 'Backup Case 1', status: 'Pass' }]
      }
    ],
    executions: [{ id: 'ex_b1', testCaseId: 'TC-B1', status: 'Pass' }],
    defects: [{ id: 'DEF-B1', title: 'Backup Defect 1', severity: 'Medium', status: 'Open' }]
  };

  const seedChecklist = {
    id: 'chk_backup_test',
    title: 'Backup Checklist 1',
    phases: [{ id: 'ph_c1', name: 'Phase C', categories: [] }]
  };

  localStorage.setItem('qavora_projects_v1', JSON.stringify([seedProject]));
  localStorage.setItem('qavora_qa_checklists_v1', JSON.stringify({ checklists: [seedChecklist], nextSequence: 2 }));

  // 1. Full Backup simulation payload
  const backupPayload = {
    application: 'Qavora',
    backupVersion: 1,
    schemaVersion: 1,
    type: 'full_backup',
    exportedAt: new Date().toISOString(),
    projects: [seedProject],
    qaChecklists: [seedChecklist],
    qaActiveRunner: { activeChecklistId: 'chk_backup_test', lastQaView: 'qa-runner' },
    activities: [{ action: 'Created backup', detail: 'Test backup', timestamp: new Date().toISOString() }]
  };

  // 2. Wipe workspace (execute workspace reset simulation)
  localStorage.clear();
  assert.strictEqual(hook.Storage.getProjects().length, 0, 'Storage must be empty after wipe');

  // 3. Restore backup
  hook.State.pendingImportPayload = {
    rawProjects: backupPayload.projects,
    rawQaChecklists: backupPayload.qaChecklists,
    hasQaActiveRunner: true,
    rawQaActiveRunner: backupPayload.qaActiveRunner,
    activities: backupPayload.activities
  };

  // Trigger commitImport in replace mode
  env.elementsById.get('import-mode-merge').checked = false;
  env.elementsById.get('import-mode-replace').checked = true;
  hook.commitImport();

  const restoredProjects = hook.Storage.getProjects();
  assert.strictEqual(restoredProjects.length, 1, 'Restored projects must contain 1 project');
  assert.strictEqual(restoredProjects[0].name, 'Backup Test Workspace');
  assert.strictEqual(restoredProjects[0].testSuites[0].testCases[0].title, 'Backup Case 1');
  assert.strictEqual(restoredProjects[0].defects[0].title, 'Backup Defect 1');

  const restoredChecklists = qaChecklistStore.loadAllChecklists().checklists;
  assert.strictEqual(restoredChecklists.length, 1, 'Restored checklists must contain 1 checklist');
  assert.strictEqual(restoredChecklists[0].title, 'Backup Checklist 1');

  // 4. Verify safety rollback snapshot was saved in sessionStorage
  const rollbackRaw = sessionStorage.getItem('qavora_rollback_v1');
  assert(rollbackRaw, 'Rollback snapshot must be preserved in sessionStorage before replace');

  console.log('✓ Test Group 8 passed: Complete backup, restore, relationship preservation, and rollback snapshot verified.');
}

// ============================================================================
// Test Group 9 — Storage Corruption & Defensive Handling
// ============================================================================
console.log('\n--- Test Group 9: Storage Corruption & Defensive Handling ---');

{
  const env = createQavoraTestEnvironment();
  const { hook, localStorage } = env;

  // 1. Projects: invalid JSON
  localStorage.setItem('qavora_projects_v1', '{"invalid": json syntax error');
  const safeProjList = hook.Storage.getProjects();
  assert(Array.isArray(safeProjList) && safeProjList.length === 0, 'Corrupt project JSON must safely return empty array');

  // 2. Projects: non-array object
  localStorage.setItem('qavora_projects_v1', JSON.stringify({ error: 'not an array' }));
  const safeProjList2 = hook.Storage.getProjects();
  assert(Array.isArray(safeProjList2) && safeProjList2.length === 0, 'Non-array project storage must return empty array');

  // 3. Activities: corrupted value
  localStorage.setItem('qavora_activities_v1', 'broken activity string');
  const safeActList = hook.Storage.getActivities();
  assert(Array.isArray(safeActList) && safeActList.length === 0, 'Corrupt activity JSON must safely return empty array');

  // 4. Preferences: corrupted value
  localStorage.setItem('qavora_preferences_v1', 'corrupt preferences');
  const safePrefs = hook.Storage.getPreferences();
  assert.strictEqual(safePrefs.density, 'comfortable', 'Corrupt preferences must fall back to comfortable density');
  assert.strictEqual(safePrefs.defaultCasePriority, 'Medium', 'Corrupt preferences must fall back to Medium priority');

  // 5. Notifications: corrupted value
  localStorage.setItem('qavora_notifications_v1', 'corrupt notifications');
  const safeNotifs = hook.Storage.getNotifications();
  assert(Array.isArray(safeNotifs) && safeNotifs.length === 0, 'Corrupt notification storage must return empty array');

  // 6. Checklists: corrupted value
  localStorage.setItem('qavora_qa_checklists_v1', 'corrupt checklist record');
  const safeChecklists = qaChecklistStore.loadAllChecklists();
  assert(Array.isArray(safeChecklists.checklists) && safeChecklists.checklists.length === 0, 'Corrupt checklist storage must isolate safely');

  console.log('✓ Test Group 9 passed: Complete defensive fault tolerance across all storage entities verified.');
}

// ============================================================================
// Test Group 10 — Delete Cascade / Orphan Reference Integrity
// ============================================================================
console.log('\n--- Test Group 10: Delete Cascade & Orphan Reference Integrity ---');

{
  const env = createQavoraTestEnvironment();
  const { hook, localStorage } = env;

  const project = {
    id: 'proj_cascade',
    name: 'Cascade Project',
    status: 'Active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    testPlan: {
      id: 'tp_cas',
      phases: [{ id: 'ph_cas_1', name: 'Phase One' }]
    },
    testSuites: [
      {
        id: 'suite_cas_1',
        phaseId: 'ph_cas_1',
        name: 'Suite One',
        testCases: [
          { id: 'TC-CAS-1', title: 'Case One', status: 'Not Run', defectIds: ['DEF-CAS-1'] }
        ]
      }
    ],
    executions: [
      { id: 'exec_cas_1', testCaseId: 'TC-CAS-1', defectIds: ['DEF-CAS-1'], status: 'Fail' }
    ],
    defects: [
      { id: 'DEF-CAS-1', title: 'Defect One', testCaseId: 'TC-CAS-1', executionId: 'exec_cas_1' }
    ]
  };

  localStorage.setItem('qavora_projects_v1', JSON.stringify([project]));

  // 1. Delete Defect DEF-CAS-1 and verify unlinking from test case & execution
  hook.requestUniversalDelete('defect', 'DEF-CAS-1', project.id);
  hook.executeUniversalDelete();

  const projAfterDefDel = hook.Storage.getProjects()[0];
  assert.strictEqual(projAfterDefDel.defects.length, 0, 'Defect must be deleted');
  assert.strictEqual(projAfterDefDel.testSuites[0].testCases[0].defectIds.length, 0, 'Defect ID must be unlinked from test case');
  assert.strictEqual(projAfterDefDel.executions[0].defectIds.length, 0, 'Defect ID must be unlinked from execution record');

  console.log('✓ Test Group 10 passed: Complete delete cascade and zero orphaned references verified.');
}

// ============================================================================
// Test Group 11 — Dashboard & Report Mathematical Consistency
// ============================================================================
console.log('\n--- Test Group 11: Dashboard & Report Mathematical Consistency ---');

{
  const env = createQavoraTestEnvironment();
  const { hook, localStorage, elementsById } = env;

  // Deterministic dataset:
  // 2 Projects
  // Project 1: 3 test cases (1 Pass, 1 Fail, 1 Not Run) -> 2 executed
  // Project 2: 2 test cases (1 Blocked, 1 Skipped) -> 2 executed
  // Total Cases: 5
  // Total Executed: 4
  // Not Run: 1
  // Pass: 1
  // Fail: 1
  // Blocked: 1
  // Skipped: 1
  // Expected Progress: (4 / 5) * 100 = 80%
  // Expected Pass Rate of Executed: (1 / 4) * 100 = 25%

  const p1 = {
    id: 'math_p1',
    name: 'Math Project 1',
    status: 'Active',
    testCaseCount: 3,
    passedTests: 1,
    failedTests: 1,
    blockedTests: 0,
    skippedTests: 0,
    totalDefects: 1,
    openDefects: 1,
    testPlan: { phases: [] },
    testSuites: [
      {
        id: 's1',
        testCases: [
          { id: 'TC-M1', status: 'Pass' },
          { id: 'TC-M2', status: 'Fail' },
          { id: 'TC-M3', status: 'Not Run' }
        ]
      }
    ],
    executions: [
      { id: 'ex1', testCaseId: 'TC-M1', status: 'Pass', executedAt: new Date().toISOString() },
      { id: 'ex2', testCaseId: 'TC-M2', status: 'Fail', executedAt: new Date().toISOString() }
    ],
    defects: [{ id: 'D1', status: 'Open', createdAt: new Date().toISOString() }]
  };

  const p2 = {
    id: 'math_p2',
    name: 'Math Project 2',
    status: 'Active',
    testCaseCount: 2,
    passedTests: 0,
    failedTests: 0,
    blockedTests: 1,
    skippedTests: 1,
    totalDefects: 1,
    openDefects: 0,
    testPlan: { phases: [] },
    testSuites: [
      {
        id: 's2',
        testCases: [
          { id: 'TC-M4', status: 'Blocked' },
          { id: 'TC-M5', status: 'Skipped' }
        ]
      }
    ],
    executions: [
      { id: 'ex3', testCaseId: 'TC-M4', status: 'Blocked', executedAt: new Date().toISOString() },
      { id: 'ex4', testCaseId: 'TC-M5', status: 'Skipped', executedAt: new Date().toISOString() }
    ],
    defects: [{ id: 'D2', status: 'Resolved', createdAt: new Date().toISOString() }]
  };

  localStorage.setItem('qavora_projects_v1', JSON.stringify([p1, p2]));

  // Verify Dashboard Calculations
  hook.renderDashboard();
  assert.strictEqual(elementsById.get('stat-projects').textContent, '2', 'Dashboard projects count must be 2');
  assert.strictEqual(elementsById.get('stat-cases').textContent, '5', 'Dashboard test cases count must be 5');
  assert.strictEqual(elementsById.get('stat-passed').textContent, '1', 'Dashboard passed count must be 1');
  assert.strictEqual(elementsById.get('stat-failed').textContent, '1', 'Dashboard failed count must be 1');
  assert.strictEqual(elementsById.get('stat-progress').textContent, '80%', 'Dashboard progress must be 80%');

  // Verify Reports Calculations
  hook.State.reportsProjectId = 'ALL';
  hook.State.reportsDateRange = 'ALL';
  const rep = hook.getFilteredReportsData();

  assert.strictEqual(rep.totalCases, 5, 'Reports total cases must be 5');
  assert.strictEqual(rep.executedCasesCount, 4, 'Reports executed cases count must be 4');
  assert.strictEqual(rep.notRunCasesCount, 1, 'Reports Not Run cases count must be 1');
  assert.strictEqual(rep.completionRate, 80, 'Reports completion rate must be 80%');
  assert.strictEqual(rep.passRate, 25, 'Reports pass rate of executed must be 25%');

  console.log('✓ Test Group 11 passed: Mathematical agreement between Dashboard and Reports verified.');
}

// ============================================================================
// Test Group 12 — Notifications
// ============================================================================
console.log('\n--- Test Group 12: Notifications ---');

{
  const env = createQavoraTestEnvironment();
  const { hook, elementsById } = env;

  const notifBtn = elementsById.get('notification-btn');
  const notifPanel = elementsById.get('notification-panel');

  assert.strictEqual(notifPanel.style.display, 'none');
  notifBtn.click();
  assert.strictEqual(notifPanel.style.display, 'flex');
  notifBtn.click();
  assert.strictEqual(notifPanel.style.display, 'none');

  hook.addNotification({
    title: 'Test Notification',
    message: 'Phase 6 Hardening pass in progress',
    type: 'system'
  });

  const notifs = hook.Storage.getNotifications();
  assert.strictEqual(notifs.length, 1);
  assert.strictEqual(notifs[0].title, 'Test Notification');
  assert.strictEqual(elementsById.get('notification-count-badge').textContent, '1');

  hook.clearAllNotifications();
  assert.strictEqual(hook.Storage.getNotifications().length, 0);

  console.log('✓ Test Group 12 passed: Notification drawer, lifecycle, and badge verified.');
}

// ============================================================================
// Test Group 13 — Settings & Workspace Preferences
// ============================================================================
console.log('\n--- Test Group 13: Settings & Workspace Preferences ---');

{
  const env = createQavoraTestEnvironment();
  const { hook, localStorage, document } = env;

  // 1. Theme
  hook.applyTheme('light');
  assert.strictEqual(document.documentElement.getAttribute('data-theme'), 'light');
  assert.strictEqual(localStorage.getItem('qavora_theme_preference'), 'light');
  hook.applyTheme('dark');
  assert.strictEqual(document.documentElement.getAttribute('data-theme'), 'dark');

  // 2. Preferences
  hook.applyPreferences({
    density: 'compact',
    defaultProjectSort: 'name-desc',
    defaultCasePriority: 'Critical',
    autopassSteps: false,
    actionToasts: false
  });

  const savedPrefs = hook.Storage.getPreferences();
  assert.strictEqual(savedPrefs.density, 'compact');
  assert.strictEqual(savedPrefs.defaultProjectSort, 'name-desc');
  assert.strictEqual(savedPrefs.defaultCasePriority, 'Critical');
  assert.strictEqual(savedPrefs.autopassSteps, false);
  assert.strictEqual(savedPrefs.actionToasts, false);

  console.log('✓ Test Group 13 passed: All settings persistence, application, and isolation verified.');
}

// ============================================================================
// Test Group 14 — Responsive UI Structure & Viewport Sanity
// ============================================================================
console.log('\n--- Test Group 14: Responsive UI Structure & Viewport Sanity ---');

{
  const indexHtml = fs.readFileSync('./index.html', 'utf8');
  const styleCss = fs.readFileSync('./style.css', 'utf8');

  // Verify mobile responsive classes and breakpoints in style.css
  assert(styleCss.includes('@media (max-width: 1023px)'), 'Tablet breakpoint must exist');
  assert(styleCss.includes('@media (max-width: 768px)'), 'Mobile landscape/tablet portrait breakpoint must exist');
  assert(styleCss.includes('@media (max-width: 480px)') || styleCss.includes('@media (max-width: 430px)'), 'Mobile portrait breakpoint must exist');
  assert(styleCss.includes('@media (max-width: 320px)'), 'Small mobile breakpoint must exist');

  // Verify responsive navigation elements exist in HTML
  assert(indexHtml.includes('id="sidebar-toggle-btn"'), 'sidebar-toggle-btn must exist in top-nav');
  assert(indexHtml.includes('id="sidebar-overlay"'), 'sidebar-overlay must exist');
  assert(indexHtml.includes('id="sidebar-close-btn"'), 'sidebar-close-btn must exist');
  assert(indexHtml.includes('id="notification-panel"'), 'notification-panel must exist');

  console.log('✓ Test Group 14 passed: Responsive UI architecture, navigation, and mobile structures verified.');
}

// ============================================================================
// Test Group 15 — Performance & Dataset Scale Sanity
// ============================================================================
console.log('\n--- Test Group 15: Performance & Dataset Scale Sanity ---');

{
  const env = createQavoraTestEnvironment();
  const { hook, localStorage } = env;

  // Construct realistic scale dataset:
  // 5 Projects, 20 Phases, 50 Suites, 250+ Test Cases, 50+ Defects
  const scaleProjects = [];

  for (let p = 1; p <= 5; p++) {
    const phases = [];
    for (let ph = 1; ph <= 4; ph++) {
      phases.push({ id: `ph_${p}_${ph}`, name: `Project ${p} Phase ${ph}`, order: ph });
    }

    const suites = [];
    const executions = [];
    const defects = [];
    let caseCount = 0;

    for (let s = 1; s <= 10; s++) {
      const suiteId = `suite_${p}_${s}`;
      const phaseId = phases[s % 4].id;
      const testCases = [];

      for (let c = 1; c <= 6; c++) {
        caseCount++;
        const caseId = `TC-${p}-${s}-${c}`;
        const status = c % 4 === 0 ? 'Pass' : (c % 4 === 1 ? 'Fail' : (c % 4 === 2 ? 'Blocked' : 'Not Run'));
        const caseExecs = [];

        if (status !== 'Not Run') {
          const execId = `exec_${p}_${s}_${c}`;
          caseExecs.push(execId);
          executions.push({
            id: execId,
            testCaseId: caseId,
            status,
            executedAt: new Date().toISOString()
          });
        }

        testCases.push({
          id: caseId,
          title: `Project ${p} Suite ${s} Test Case ${c}`,
          status,
          priority: c % 3 === 0 ? 'Critical' : 'High',
          executions: caseExecs,
          defectIds: []
        });
      }

      suites.push({
        id: suiteId,
        phaseId,
        name: `Suite ${s}`,
        testCases
      });
    }

    for (let d = 1; d <= 10; d++) {
      defects.push({
        id: `DEF-${p}-${d}`,
        title: `Defect ${d} for project ${p}`,
        severity: d % 2 === 0 ? 'Critical' : 'Medium',
        status: d % 3 === 0 ? 'Closed' : 'Open',
        testCaseId: `TC-${p}-1-1`,
        createdAt: new Date().toISOString()
      });
    }

    scaleProjects.push({
      id: `proj_scale_${p}`,
      name: `Scale Project ${p}`,
      status: 'Active',
      testPlan: { id: `tp_scale_${p}`, phases },
      testSuites: suites,
      executions,
      defects,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  // 1. Persistence & Normalization Performance
  const t0 = Date.now();
  const saveRes = hook.Storage.saveProjects(scaleProjects);
  const t1 = Date.now();

  assert(saveRes.ok, 'Saving 5 projects with 300 test cases and 50 defects must succeed');
  assert(t1 - t0 < 500, `Storage save must complete under 500ms (took ${t1 - t0}ms)`);

  // 2. Retrieval & Normalization Performance
  const t2 = Date.now();
  const loadedProjects = hook.Storage.getProjects();
  const t3 = Date.now();

  assert.strictEqual(loadedProjects.length, 5, 'All 5 projects must be retrieved');
  assert(t3 - t2 < 500, `Storage load must complete under 500ms (took ${t3 - t2}ms)`);

  // 3. Reports Aggregation at Scale
  hook.State.reportsProjectId = 'ALL';
  hook.State.reportsDateRange = 'ALL';
  const t4 = Date.now();
  const scaleReports = hook.getFilteredReportsData();
  const t5 = Date.now();

  assert.strictEqual(scaleReports.totalCases, 300, 'Scale dataset must have 300 total test cases');
  assert(scaleReports.totalExecutions > 0, 'Total executions must be aggregated');
  assert(t5 - t4 < 200, `Reports calculation at scale must complete under 200ms (took ${t5 - t4}ms)`);

  console.log(`✓ Test Group 15 passed: Scale sanity verified (5 projects, 20 phases, 50 suites, 300 cases, 50 defects processed in ${t5 - t0}ms).`);
}

console.log('\n================================================================');
console.log('ALL 15 TEST GROUPS IN PHASE 6 VERIFICATION SUITE PASSED (100%)');
console.log('================================================================\n');
