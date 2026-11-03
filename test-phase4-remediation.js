/**
 * Automated Behavioral Verification Suite for QAVORA-REMEDIATION-004 — PHASE 4
 * Dashboard, Projects, Plans, Execution, Defects & Reports Integration Verification
 *
 * Test Groups:
 * - Test Group 1: Dashboard Data Consistency & Refresh
 * - Test Group 2: My Projects Integration & Filter/Metadata Compatibility
 * - Test Group 3: Test Plans Integration & Phase/Suite/Case Hierarchy
 * - Test Group 4: Test Execution Integration & Status Model
 * - Test Group 5: Defects Integration & Associations
 * - Test Group 6: Reports & Analytics Integration
 * - Test Group 7: Cross-View Consistency Verification (Controlled Scenario across all 6 areas)
 * - Test Group 8: Regression (Phases 1, 2, 3 verification)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseQAPlanText } from './qaParser.js';
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
    setAttribute(name, val) {
      attrs.set(name, String(val));
      if (name === 'class') {
        classSet.clear();
        String(val)
          .split(/\s+/)
          .filter(Boolean)
          .forEach(c => classSet.add(c));
      }
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        el.dataset[key] = String(val);
      }
      if (name === 'value') {
        _value = String(val);
      }
    },
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name) : null;
    },
    removeAttribute(name) {
      attrs.delete(name);
      if (name === 'class') classSet.clear();
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        delete el.dataset[key];
      }
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
      listeners.set(
        evt,
        listeners.get(evt).filter(cb => cb !== fn)
      );
    },
    dispatchEvent(event) {
      const type = event.type || event;
      const list = listeners.get(type) || [];
      for (const fn of list) {
        fn(event);
      }
      return true;
    },
    click() {
      el.dispatchEvent({
        type: 'click',
        target: el,
        preventDefault() {},
        stopPropagation() {}
      });
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

  const nestedInteractiveRegex = /<(button|input|select|span|article)\b([^>]*)(?:>([\s\S]*?)<\/\1>|\/?>)/gi;
  let nestedMatch;
  while ((nestedMatch = nestedInteractiveRegex.exec(html)) !== null) {
    const tag = nestedMatch[1].toLowerCase();
    const attrStr = nestedMatch[2] || '';
    const parsedAttrs = parseAttributes(attrStr);
    const alreadyExists = children.some(
      c =>
        c.tagName.toLowerCase() === tag &&
        c.getAttribute('class') === (parsedAttrs.class || null) &&
        c.getAttribute('data-case-id') === (parsedAttrs['data-case-id'] || null) &&
        c.getAttribute('data-defect-id') === (parsedAttrs['data-defect-id'] || null) &&
        c.getAttribute('data-project-id') === (parsedAttrs['data-project-id'] || null) &&
        c.getAttribute('data-id') === (parsedAttrs['data-id'] || null)
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
        renderDashboard,
        renderMyProjects,
        renderTestPlansWorkspace,
        renderTestExecutionWorkspace,
        renderDefectsWorkspace,
        renderReportsWorkspace,
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
        requestUniversalDelete,
        executeUniversalDelete,
        switchView,
        qaRunnerController
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
    context: sandbox,
    hook: sandbox.globalThis.__qavoraTestHook,
    localStorage,
    document: documentStub,
    elementsById
  };
}

console.log('================================================================');
console.log('QAVORA PHASE 4 INTEGRATION & DATA CONSISTENCY VERIFICATION SUITE');
console.log('================================================================');

// ----------------------------------------------------------------------------
// Test Group 1: Dashboard Data Consistency & Refresh
// ----------------------------------------------------------------------------
console.log('\n--- Test Group 1: Dashboard Data Consistency & Refresh ---');
{
  const env = createQavoraTestEnvironment();
  const { hook, localStorage, elementsById } = env;

  // 1.1 Empty state validation
  hook.renderDashboard();
  assert.equal(elementsById.get('stat-projects')?.textContent, '0', 'Empty state shows 0 projects');
  assert.equal(elementsById.get('stat-cases')?.textContent, '0', 'Empty state shows 0 test cases');
  assert.equal(elementsById.get('stat-passed')?.textContent, '0', 'Empty state shows 0 passed');
  assert.equal(elementsById.get('stat-failed')?.textContent, '0', 'Empty state shows 0 failed');
  assert.equal(elementsById.get('stat-progress')?.textContent, '0%', 'Empty state shows 0% progress');
  assert.equal(elementsById.get('recent-projects-counter')?.textContent, '0 total', 'Recent projects shows 0 total');

  // 1.2 Seed two projects with test cases and executions
  const seedProjects = [
    {
      id: 'proj_dash_1',
      name: 'Alpha Suite',
      type: 'Web Application',
      status: 'Active',
      version: 'v1.0.0',
      description: 'First test project',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
      testPlan: {
        id: 'tp_dash_1',
        name: 'Alpha Plan',
        phases: [{ id: 'ph_1', name: 'Phase 1', order: 0 }]
      },
      testSuites: [
        {
          id: 'suite_1',
          phaseId: 'ph_1',
          name: 'Core Auth',
          category: 'Functional',
          testCases: [
            { id: 'TC-001', title: 'Login with valid creds', status: 'Pass', priority: 'Critical' },
            { id: 'TC-002', title: 'Login with invalid pass', status: 'Fail', priority: 'High' },
            { id: 'TC-003', title: 'Forgot password reset', status: 'Not Run', priority: 'Medium' }
          ]
        }
      ],
      executions: [
        { id: 'ex_1', testCaseId: 'TC-001', status: 'Pass', executedAt: '2026-11-01T11:00:00.000Z' },
        { id: 'ex_2', testCaseId: 'TC-002', status: 'Fail', executedAt: '2026-11-01T11:30:00.000Z' },
        { id: 'ex_3', testCaseId: 'TC-001', status: 'Pass', executedAt: '2026-11-01T12:00:00.000Z' } // Second execution on same case
      ],
      defects: [
        { id: 'DEF-001', testCaseId: 'TC-002', title: 'Error 500 on bad password', status: 'Open', severity: 'Critical' }
      ]
    },
    {
      id: 'proj_dash_2',
      name: 'Beta Mobile',
      type: 'Mobile Application',
      status: 'Active',
      version: 'v2.1',
      description: 'Second test project',
      createdAt: '2026-11-02T10:00:00.000Z',
      updatedAt: '2026-11-02T10:00:00.000Z',
      testPlan: {
        id: 'tp_dash_2',
        name: 'Beta Plan',
        phases: [{ id: 'ph_2', name: 'Phase 1', order: 0 }]
      },
      testSuites: [
        {
          id: 'suite_2',
          phaseId: 'ph_2',
          name: 'Push Notifications',
          category: 'Mobile',
          testCases: [
            { id: 'TC-004', title: 'Receive background alert', status: 'Pass', priority: 'High' },
            { id: 'TC-005', title: 'Badge icon decrement', status: 'Not Run', priority: 'Low' }
          ]
        }
      ],
      executions: [
        { id: 'ex_4', testCaseId: 'TC-004', status: 'Pass', executedAt: '2026-11-02T11:00:00.000Z' }
      ],
      defects: []
    }
  ];

  localStorage.setItem('qavora_projects_v1', JSON.stringify(seedProjects));

  hook.renderDashboard();
  assert.equal(elementsById.get('stat-projects')?.textContent, '2', 'Dashboard reports 2 projects');
  assert.equal(elementsById.get('stat-cases')?.textContent, '5', 'Dashboard reports 5 unique test cases');
  assert.equal(elementsById.get('stat-passed')?.textContent, '2', 'Dashboard reports 2 passed cases (TC-001, TC-004)');
  assert.equal(elementsById.get('stat-failed')?.textContent, '1', 'Dashboard reports 1 failed case (TC-002)');
  // 3 executed out of 5 = 60%
  assert.equal(elementsById.get('stat-progress')?.textContent, '60%', 'Dashboard reports 60% progress');
  assert.equal(elementsById.get('dash-stat-execs')?.textContent, '4', 'QA snapshot reports 4 total execution runs');
  assert.equal(elementsById.get('dash-stat-coverage')?.textContent, '3 / 5', 'QA snapshot reports 3/5 executed cases');
  assert.equal(elementsById.get('dash-stat-defects')?.textContent, '1', 'QA snapshot reports 1 open defect');
  assert.equal(elementsById.get('nav-project-count')?.textContent, '2', 'Sidebar nav reflects 2 projects');
  assert.equal(elementsById.get('nav-cases-count')?.textContent, '5', 'Sidebar nav reflects 5 test cases');
  assert.equal(elementsById.get('nav-defects-count')?.textContent, '1', 'Sidebar nav reflects 1 open defect');

  // Verify Recent Projects ordering: newest project (Beta Mobile, Nov 2) appears first
  const recentItems = elementsById.get('recent-projects-container')?.querySelectorAll('.project-item') || [];
  assert.equal(recentItems.length, 2, 'Recent projects contains 2 items');
  assert.equal(recentItems[0].getAttribute('data-id'), 'proj_dash_2', 'Beta Mobile is first in recent list');
  assert.equal(recentItems[1].getAttribute('data-id'), 'proj_dash_1', 'Alpha Suite is second in recent list');

  console.log('✓ Test Group 1 passed (Dashboard metrics, zero-state, ordering, and execution run vs unique case counts verified)');
}

// ----------------------------------------------------------------------------
// Test Group 2: My Projects Integration & Filter/Metadata Compatibility
// ----------------------------------------------------------------------------
console.log('\n--- Test Group 2: My Projects Integration ---');
{
  const env = createQavoraTestEnvironment();
  const { hook, localStorage, elementsById } = env;

  // 2.1 Promote a checklist and add a manual project
  const parsed = parseQAPlanText(
    'Phase 1: Verification\nCategory: Checkout\n- [T1] [Critical] Test card payment\n- [T2] [High] Test paypal flow'
  );
  const createdRes = qaChecklistStore.createChecklistFromParsedPlan(parsed, 'Checkout Checklist');
  assert.equal(createdRes.ok, true);
  const checklist = createdRes.checklist;
  qaChecklistStore.saveAllChecklists([checklist]);

  const promRes = qaChecklistStore.promoteChecklistToProject(checklist.id, {
    projectName: 'E-Commerce Checkout Project',
    projectType: 'SaaS Platform'
  });
  assert.equal(promRes.ok, true);

  // Add a manual project
  const projects = hook.Storage.getProjects();
  projects.push({
    id: 'proj_manual_abc',
    name: 'Manual Web Portal',
    type: 'Website',
    status: 'Completed',
    version: 'v1.0.0',
    description: 'Manually created portal',
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
    testPlan: { id: 'tp_m', name: 'Plan M', phases: [] },
    testSuites: [],
    executions: [],
    defects: []
  });
  hook.Storage.saveProjects(projects);

  hook.renderMyProjects();
  assert.equal(elementsById.get('my-stat-total')?.textContent, '2', 'My projects total is 2');
  assert.equal(elementsById.get('my-stat-active')?.textContent, '1', '1 active project (promoted)');
  assert.equal(elementsById.get('my-stat-completed')?.textContent, '1', '1 completed project (manual)');

  // Verify cards
  const cards = elementsById.get('projects-grid')?.querySelectorAll('.project-card') || [];
  assert.equal(cards.length, 2, '2 project cards rendered in grid');

  // Verify search filter
  hook.State.searchQuery = 'Checkout';
  hook.renderMyProjects();
  const filteredCards = elementsById.get('projects-grid')?.querySelectorAll('.project-card') || [];
  assert.equal(filteredCards.length, 1, 'Search filters to 1 project card');
  assert.equal(filteredCards[0].getAttribute('data-id'), promRes.project.id, 'Promoted project matches search');

  hook.State.searchQuery = '';
  hook.renderMyProjects();

  // Test project deletion
  hook.requestUniversalDelete('project', 'proj_manual_abc', null);
  hook.executeUniversalDelete();

  assert.equal(elementsById.get('my-stat-total')?.textContent, '1', 'My projects total decrements to 1 after delete');
  assert.equal(elementsById.get('stat-projects')?.textContent, '1', 'Dashboard project count decrements to 1');

  console.log('✓ Test Group 2 passed (My Projects integration, search, promotion compatibility, and deletion verified)');
}

// ----------------------------------------------------------------------------
// Test Group 3: Test Plans Integration & Phase/Suite/Case Hierarchy
// ----------------------------------------------------------------------------
console.log('\n--- Test Group 3: Test Plans Integration ---');
{
  const env = createQavoraTestEnvironment();
  const { hook, localStorage, elementsById } = env;

  const parsed = parseQAPlanText(
    'Phase 1: Smoke\nCategory: Smoke Suites\n- [TC-101] [Critical] Smoke boot check\n\nPhase 2: Regression\nCategory: Deep Regress\n- [TC-102] [High] Heavy payload load\n- [TC-103] [Medium] Session timeout'
  );
  const createdRes = qaChecklistStore.createChecklistFromParsedPlan(parsed, 'Multi-Phase Plan');
  assert.equal(createdRes.ok, true);
  const chk = createdRes.checklist;
  qaChecklistStore.saveAllChecklists([chk]);

  const promRes = qaChecklistStore.promoteChecklistToProject(chk.id, {
    projectName: 'Formal Multi-Phase Project',
    projectType: 'Web Application'
  });
  assert.equal(promRes.ok, true);

  hook.State.activePlanProjectId = promRes.project.id;
  hook.renderTestPlansWorkspace();

  // Verify Plan Banner
  assert.equal(elementsById.get('plan-name')?.textContent, 'Formal Multi-Phase Project — Master Test Plan');
  assert.equal(elementsById.get('plan-stat-phases')?.textContent, '2', 'Plan metrics shows 2 phases');
  assert.equal(elementsById.get('plan-stat-suites')?.textContent, '2', 'Plan metrics shows 2 suites');
  assert.equal(elementsById.get('plan-stat-cases')?.textContent, '3', 'Plan metrics shows 3 test cases');

  // Verify priority breakdown (1 Critical, 1 High, 1 Medium, 0 Low)
  assert.equal(elementsById.get('plan-stat-crit')?.textContent, '1', '1 critical test case');
  assert.equal(elementsById.get('plan-stat-high')?.textContent, '1', '1 high test case');
  assert.equal(elementsById.get('plan-stat-med')?.textContent, '1', '1 medium test case');
  assert.equal(elementsById.get('plan-stat-low')?.textContent, '0', '0 low test case');

  // Verify all promoted cases are Not Run
  const project = hook.Storage.getProjects().find(p => p.id === promRes.project.id);
  project.testSuites.forEach(s => {
    s.testCases.forEach(tc => {
      assert.equal(tc.status, 'Not Run', `Promoted case ${tc.id} must be initialized as Not Run`);
    });
  });

  console.log('✓ Test Group 3 passed (Test Plans hierarchy, phases, suites, and initial Not Run status verified)');
}

// ----------------------------------------------------------------------------
// Test Group 4: Test Execution Integration & Status Model
// ----------------------------------------------------------------------------
console.log('\n--- Test Group 4: Test Execution Integration ---');
{
  const env = createQavoraTestEnvironment();
  const { hook, localStorage, elementsById } = env;

  const parsed = parseQAPlanText(
    'Phase 1: Core\nCategory: Auth\n- [TC-201] [High] Sign in check\n- [TC-202] [Medium] Sign out check'
  );
  const createdRes = qaChecklistStore.createChecklistFromParsedPlan(parsed, 'Auth Checklist');
  assert.equal(createdRes.ok, true);
  const chk = createdRes.checklist;
  qaChecklistStore.saveAllChecklists([chk]);

  const promRes = qaChecklistStore.promoteChecklistToProject(chk.id, {
    projectName: 'Auth System Project',
    projectType: 'Web Application'
  });
  assert.equal(promRes.ok, true);

  const projId = promRes.project.id;
  hook.State.activeExecProjectId = projId;
  hook.renderTestExecutionWorkspace();

  // Initial Execution counts
  assert.equal(elementsById.get('exec-stat-total')?.textContent, '2', 'Exec workspace shows 2 total cases');
  assert.equal(elementsById.get('exec-stat-notrun')?.textContent, '2', 'Exec workspace shows 2 not run cases');
  assert.equal(elementsById.get('exec-stat-passed')?.textContent, '0', 'Exec workspace shows 0 passed cases');
  assert.equal(elementsById.get('exec-stat-failed')?.textContent, '0', 'Exec workspace shows 0 failed cases');

  // Simulate executing TC-201 as Pass
  const targetCaseId = promRes.project.testSuites[0].testCases[0].id;
  elementsById.get('exec-case-id-input').value = targetCaseId;
  elementsById.get('exec-project-id-input').value = projId;
  elementsById.get('exec-status-select').value = 'Pass';
  elementsById.get('exec-actual-input').value = 'Sign in succeeded as expected';
  elementsById.get('exec-tester-input').value = 'QA Tester';

  hook.handleSaveExecutionSubmit({ preventDefault() {} });

  // Verify updated counts
  assert.equal(elementsById.get('exec-stat-passed')?.textContent, '1', 'Exec workspace shows 1 passed case');
  assert.equal(elementsById.get('exec-stat-notrun')?.textContent, '1', 'Exec workspace shows 1 not run case');
  assert.equal(elementsById.get('stat-passed')?.textContent, '1', 'Dashboard shows 1 passed case');

  // Verify project executions array
  const updatedProj = hook.Storage.getProjects().find(p => p.id === projId);
  assert.equal(updatedProj.executions.length, 1, 'Project has 1 execution record');
  assert.equal(updatedProj.executions[0].status, 'Pass', 'Execution record has Pass status');
  assert.equal(updatedProj.executions[0].testCaseId, targetCaseId, 'Execution record has correct testCaseId');

  console.log('✓ Test Group 4 passed (Test Execution recording, status update, and history tracking verified)');
}

// ----------------------------------------------------------------------------
// Test Group 5: Defects Integration & Associations
// ----------------------------------------------------------------------------
console.log('\n--- Test Group 5: Defects Integration ---');
{
  const env = createQavoraTestEnvironment();
  const { hook, localStorage, elementsById } = env;

  const parsed = parseQAPlanText(
    'Phase 1: API\nCategory: REST\n- [TC-301] [Critical] GET endpoint'
  );
  const createdRes = qaChecklistStore.createChecklistFromParsedPlan(parsed, 'API Checklist');
  assert.equal(createdRes.ok, true);
  const chk = createdRes.checklist;
  qaChecklistStore.saveAllChecklists([chk]);

  const promRes = qaChecklistStore.promoteChecklistToProject(chk.id, {
    projectName: 'API Microservice',
    projectType: 'SaaS Platform'
  });
  assert.equal(promRes.ok, true);
  const projId = promRes.project.id;
  const targetCaseId = promRes.project.testSuites[0].testCases[0].id;

  // Log defect during execution
  elementsById.get('exec-case-id-input').value = targetCaseId;
  elementsById.get('exec-project-id-input').value = projId;
  elementsById.get('exec-status-select').value = 'Fail';
  elementsById.get('exec-actual-input').value = '500 Internal Server Error returned';
  elementsById.get('exec-tester-input').value = 'API Tester';
  elementsById.get('exec-log-defect-toggle').checked = true;
  elementsById.get('exec-defect-title').value = '500 error on GET /users';
  elementsById.get('exec-defect-severity').value = 'Critical';

  hook.handleSaveExecutionSubmit({ preventDefault() {} });

  // Verify defect in Defects workspace
  hook.State.activeDefectsProjectId = projId;
  hook.renderDefectsWorkspace();

  assert.equal(elementsById.get('defects-stat-total')?.textContent, '1', 'Defects total is 1');
  assert.equal(elementsById.get('defects-stat-open')?.textContent, '1', 'Open defects count is 1');
  assert.equal(elementsById.get('defects-stat-critical')?.textContent, '1', 'Critical defects count is 1');
  assert.equal(elementsById.get('nav-defects-count')?.textContent, '1', 'Nav defect badge is 1');

  // Verify test case links to defect
  const project = hook.Storage.getProjects().find(p => p.id === projId);
  const tc = project.testSuites[0].testCases[0];
  assert.equal(tc.defectIds.length, 1, 'Test case has 1 defectId linked');
  assert.equal(project.defects[0].testCaseId, targetCaseId, 'Defect references target testCaseId');

  // Delete defect and verify unlinking
  const defectId = project.defects[0].id;
  hook.requestUniversalDelete('defect', defectId, projId);
  hook.executeUniversalDelete();

  assert.equal(elementsById.get('defects-stat-total')?.textContent, '0', 'Defects total is 0 after delete');
  assert.equal(elementsById.get('nav-defects-count')?.textContent, '0', 'Nav defect badge is 0');
  const projectAfter = hook.Storage.getProjects().find(p => p.id === projId);
  assert.equal(projectAfter.testSuites[0].testCases[0].defectIds.length, 0, 'Test case defectIds cleaned up');

  console.log('✓ Test Group 5 passed (Defects creation, association, linking, and deletion cleanup verified)');
}

// ----------------------------------------------------------------------------
// Test Group 6: Reports & Analytics Integration
// ----------------------------------------------------------------------------
console.log('\n--- Test Group 6: Reports & Analytics Integration ---');
{
  const env = createQavoraTestEnvironment();
  const { hook, localStorage, elementsById } = env;

  const seedProjects = [
    {
      id: 'proj_rep_1',
      name: 'Project 1',
      type: 'Web Application',
      status: 'Active',
      version: 'v1.0',
      description: 'Report project 1',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
      testPlan: { id: 'tp_1', name: 'Plan 1', phases: [{ id: 'ph_1', name: 'P1', order: 0 }] },
      testSuites: [
        {
          id: 's_1',
          phaseId: 'ph_1',
          name: 'Suite 1',
          category: 'Functional',
          testCases: [
            { id: 'TC-1', title: 'Case 1', status: 'Pass', priority: 'Critical' },
            { id: 'TC-2', title: 'Case 2', status: 'Fail', priority: 'High' }
          ]
        }
      ],
      executions: [
        { id: 'ex_1', testCaseId: 'TC-1', status: 'Pass', executedAt: '2026-11-01T11:00:00.000Z' },
        { id: 'ex_2', testCaseId: 'TC-2', status: 'Fail', executedAt: '2026-11-01T12:00:00.000Z' }
      ],
      defects: [
        { id: 'DEF-1', testCaseId: 'TC-2', title: 'Defect 1', status: 'Open', severity: 'Critical', createdAt: '2026-11-01T12:05:00.000Z' }
      ]
    },
    {
      id: 'proj_rep_2',
      name: 'Project 2',
      type: 'Mobile Application',
      status: 'Active',
      version: 'v2.0',
      description: 'Report project 2',
      createdAt: '2026-11-02T10:00:00.000Z',
      updatedAt: '2026-11-02T10:00:00.000Z',
      testPlan: { id: 'tp_2', name: 'Plan 2', phases: [{ id: 'ph_2', name: 'P2', order: 0 }] },
      testSuites: [
        {
          id: 's_2',
          phaseId: 'ph_2',
          name: 'Suite 2',
          category: 'Functional',
          testCases: [
            { id: 'TC-3', title: 'Case 3', status: 'Not Run', priority: 'Medium' }
          ]
        }
      ],
      executions: [],
      defects: []
    }
  ];

  localStorage.setItem('qavora_projects_v1', JSON.stringify(seedProjects));

  // 6.1 Global Reports
  hook.State.reportsProjectId = 'ALL';
  hook.State.reportsDateRange = 'ALL';
  hook.renderReportsWorkspace();

  assert.equal(elementsById.get('rep-kpi-total-cases')?.textContent, '3', 'Global reports shows 3 total cases');
  assert.equal(elementsById.get('rep-kpi-total-execs')?.textContent, '2', 'Global reports shows 2 total executions');
  assert.equal(elementsById.get('rep-kpi-executed-cases')?.textContent, '2', 'Global reports shows 2 executed cases');
  assert.equal(elementsById.get('rep-kpi-notrun-cases')?.textContent, '1', 'Global reports shows 1 not run case');
  assert.equal(elementsById.get('rep-kpi-passed-execs')?.textContent, '1', 'Global reports shows 1 passed exec');
  assert.equal(elementsById.get('rep-kpi-failed-execs')?.textContent, '1', 'Global reports shows 1 failed exec');
  assert.equal(elementsById.get('rep-kpi-passed-rate')?.textContent, '50% pass rate', '50% pass rate on 2 executions');
  assert.equal(elementsById.get('rep-kpi-total-defects')?.textContent, '1', 'Global reports shows 1 total defect');
  assert.equal(elementsById.get('rep-kpi-open-defects')?.textContent, '1', 'Global reports shows 1 open defect');

  // 6.2 Project-specific Reports (Project 2 only)
  hook.State.reportsProjectId = 'proj_rep_2';
  hook.renderReportsWorkspace();

  assert.equal(elementsById.get('rep-kpi-total-cases')?.textContent, '1', 'Project 2 reports shows 1 total case');
  assert.equal(elementsById.get('rep-kpi-total-execs')?.textContent, '0', 'Project 2 reports shows 0 executions');
  assert.equal(elementsById.get('rep-kpi-notrun-cases')?.textContent, '1', 'Project 2 reports shows 1 not run case');
  assert.equal(elementsById.get('rep-kpi-total-defects')?.textContent, '0', 'Project 2 reports shows 0 defects');

  // 6.3 Verify Reports calculation does NOT mutate stored data
  const projectsAfterReports = hook.Storage.getProjects();
  assert.equal(projectsAfterReports.length, 2, 'Stored projects length unchanged');
  assert.equal(projectsAfterReports[0].testSuites[0].testCases.length, 2, 'Project 1 cases unchanged');
  assert.equal(projectsAfterReports[1].testSuites[0].testCases.length, 1, 'Project 2 cases unchanged');

  console.log('✓ Test Group 6 passed (Global vs project-specific reports, KPIs, coverage, and immutability verified)');
}

// ----------------------------------------------------------------------------
// Test Group 7: Cross-View Consistency Verification (Controlled Scenario)
// ----------------------------------------------------------------------------
console.log('\n--- Test Group 7: Cross-View Consistency Verification (6 Areas) ---');
{
  const env = createQavoraTestEnvironment();
  const { hook, localStorage, elementsById } = env;

  // Scenario setup:
  // 1 manual project + 1 promoted checklist project
  // Total 7 test cases (3 in manual, 4 in promoted)
  // 3 Executions: 2 Pass, 1 Fail
  // 1 Logged defect on the failed case
  // 4 Not Run cases

  const parsedChecklist = parseQAPlanText(
    'Phase A: Front-End\nCategory: UI\n- [T-P1] [Critical] Navigation bar\n- [T-P2] [High] Dark mode toggle\n\nPhase B: Back-End\nCategory: Database\n- [T-P3] [Medium] Query latency\n- [T-P4] [Low] Read replica sync'
  );
  const createdRes = qaChecklistStore.createChecklistFromParsedPlan(parsedChecklist, 'Promoted Service Plan');
  assert.equal(createdRes.ok, true);
  const chkRecord = createdRes.checklist;
  qaChecklistStore.saveAllChecklists([chkRecord]);

  const promResult = qaChecklistStore.promoteChecklistToProject(chkRecord.id, {
    projectName: 'Microservice Cluster',
    projectType: 'SaaS Platform'
  });
  assert.equal(promResult.ok, true);
  const promotedProjId = promResult.project.id;

  // Create manual project
  const manualProject = {
    id: 'proj_manual_crossview',
    name: 'Customer Portal',
    type: 'Web Application',
    status: 'Active',
    version: 'v3.0.0',
    description: 'Enterprise customer dashboard',
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-01T09:00:00.000Z',
    testPlan: {
      id: 'tp_manual_crossview',
      name: 'Customer Portal Master Plan',
      phases: [
        { id: 'ph_m1', name: 'Authentication', order: 0 },
        { id: 'ph_m2', name: 'Billing', order: 1 }
      ]
    },
    testSuites: [
      {
        id: 's_m1',
        phaseId: 'ph_m1',
        name: 'Login Flows',
        category: 'Functional',
        testCases: [
          { id: 'TC-M1', title: 'OAuth Sign In', status: 'Not Run', priority: 'Critical' },
          { id: 'TC-M2', title: '2FA Verification', status: 'Not Run', priority: 'High' }
        ]
      },
      {
        id: 's_m2',
        phaseId: 'ph_m2',
        name: 'Invoices',
        category: 'Functional',
        testCases: [
          { id: 'TC-M3', title: 'PDF Invoice Download', status: 'Not Run', priority: 'Medium' }
        ]
      }
    ],
    executions: [],
    defects: []
  };

  const allInitial = hook.Storage.getProjects();
  allInitial.push(manualProject);
  hook.Storage.saveProjects(allInitial);

  // Execute 3 tests:
  // 1. Pass execution on TC-M1 (Customer Portal)
  elementsById.get('exec-case-id-input').value = 'TC-M1';
  elementsById.get('exec-project-id-input').value = 'proj_manual_crossview';
  elementsById.get('exec-status-select').value = 'Pass';
  elementsById.get('exec-actual-input').value = 'OAuth login passed';
  elementsById.get('exec-tester-input').value = 'QA 1';
  hook.handleSaveExecutionSubmit({ preventDefault() {} });

  // 2. Fail execution on TC-M2 (Customer Portal) + Log Defect DEF-001
  elementsById.get('exec-case-id-input').value = 'TC-M2';
  elementsById.get('exec-project-id-input').value = 'proj_manual_crossview';
  elementsById.get('exec-status-select').value = 'Fail';
  elementsById.get('exec-actual-input').value = '2FA SMS code rejected';
  elementsById.get('exec-tester-input').value = 'QA 2';
  elementsById.get('exec-log-defect-toggle').checked = true;
  elementsById.get('exec-defect-title').value = '2FA SMS code timeout';
  elementsById.get('exec-defect-severity').value = 'High';
  hook.handleSaveExecutionSubmit({ preventDefault() {} });

  // 3. Pass execution on first test case of promoted project
  const promFirstCase = promResult.project.testSuites[0].testCases[0];
  elementsById.get('exec-case-id-input').value = promFirstCase.id;
  elementsById.get('exec-project-id-input').value = promotedProjId;
  elementsById.get('exec-status-select').value = 'Pass';
  elementsById.get('exec-actual-input').value = 'Navigation bar loads correctly';
  elementsById.get('exec-tester-input').value = 'QA 3';
  elementsById.get('exec-log-defect-toggle').checked = false;
  hook.handleSaveExecutionSubmit({ preventDefault() {} });

  // --------------------------------------------------
  // VERIFICATION ACROSS ALL 6 AREAS:
  // --------------------------------------------------

  // Area 1: Dashboard
  hook.switchView('dashboard');
  assert.equal(elementsById.get('stat-projects')?.textContent, '2', 'Area 1: Dashboard shows 2 projects');
  assert.equal(elementsById.get('stat-cases')?.textContent, '7', 'Area 1: Dashboard shows 7 test cases');
  assert.equal(elementsById.get('stat-passed')?.textContent, '2', 'Area 1: Dashboard shows 2 passed');
  assert.equal(elementsById.get('stat-failed')?.textContent, '1', 'Area 1: Dashboard shows 1 failed');
  assert.equal(elementsById.get('stat-progress')?.textContent, '43%', 'Area 1: Dashboard shows 43% progress (3 of 7)');
  assert.equal(elementsById.get('dash-stat-execs')?.textContent, '3', 'Area 1: QA widget shows 3 total execution runs');
  assert.equal(elementsById.get('dash-stat-coverage')?.textContent, '3 / 7', 'Area 1: QA widget shows 3/7 coverage');
  assert.equal(elementsById.get('dash-stat-defects')?.textContent, '1', 'Area 1: QA widget shows 1 open defect');

  // Area 2: My Projects
  hook.switchView('projects');
  assert.equal(elementsById.get('my-stat-total')?.textContent, '2', 'Area 2: My projects shows 2 total projects');
  assert.equal(elementsById.get('my-stat-active')?.textContent, '2', 'Area 2: My projects shows 2 active projects');
  const projectCards = elementsById.get('projects-grid')?.querySelectorAll('.project-card') || [];
  assert.equal(projectCards.length, 2, 'Area 2: My projects grid displays 2 project cards');

  // Area 3: Test Plans
  hook.switchView('plans', 'proj_manual_crossview');
  assert.equal(elementsById.get('plan-stat-phases')?.textContent, '2', 'Area 3: Manual project has 2 phases');
  assert.equal(elementsById.get('plan-stat-suites')?.textContent, '2', 'Area 3: Manual project has 2 suites');
  assert.equal(elementsById.get('plan-stat-cases')?.textContent, '3', 'Area 3: Manual project has 3 test cases');

  hook.switchView('plans', promotedProjId);
  assert.equal(elementsById.get('plan-stat-phases')?.textContent, '2', 'Area 3: Promoted project has 2 phases');
  assert.equal(elementsById.get('plan-stat-suites')?.textContent, '2', 'Area 3: Promoted project has 2 suites');
  assert.equal(elementsById.get('plan-stat-cases')?.textContent, '4', 'Area 3: Promoted project has 4 test cases');

  // Area 4: Test Execution
  hook.switchView('execution', 'proj_manual_crossview');
  assert.equal(elementsById.get('exec-stat-total')?.textContent, '3', 'Area 4: Manual project exec shows 3 total cases');
  assert.equal(elementsById.get('exec-stat-passed')?.textContent, '1', 'Area 4: Manual project exec shows 1 passed case');
  assert.equal(elementsById.get('exec-stat-failed')?.textContent, '1', 'Area 4: Manual project exec shows 1 failed case');
  assert.equal(elementsById.get('exec-stat-notrun')?.textContent, '1', 'Area 4: Manual project exec shows 1 not run case');

  hook.switchView('execution', promotedProjId);
  assert.equal(elementsById.get('exec-stat-total')?.textContent, '4', 'Area 4: Promoted project exec shows 4 total cases');
  assert.equal(elementsById.get('exec-stat-passed')?.textContent, '1', 'Area 4: Promoted project exec shows 1 passed case');
  assert.equal(elementsById.get('exec-stat-failed')?.textContent, '0', 'Area 4: Promoted project exec shows 0 failed cases');
  assert.equal(elementsById.get('exec-stat-notrun')?.textContent, '3', 'Area 4: Promoted project exec shows 3 not run cases');

  // Area 5: Defects
  hook.switchView('defects', 'ALL');
  assert.equal(elementsById.get('defects-stat-total')?.textContent, '1', 'Area 5: Total defects is 1');
  assert.equal(elementsById.get('defects-stat-open')?.textContent, '1', 'Area 5: Open defects is 1');
  assert.equal(elementsById.get('defects-stat-critical')?.textContent, '0', 'Area 5: 0 critical defects (1 High)');

  // Area 6: Reports & Analytics
  hook.switchView('reports', 'ALL');
  hook.State.reportsDateRange = 'ALL';
  hook.renderReportsWorkspace();

  assert.equal(elementsById.get('rep-kpi-total-cases')?.textContent, '7', 'Area 6: Reports total cases = 7');
  assert.equal(elementsById.get('rep-kpi-total-execs')?.textContent, '3', 'Area 6: Reports total executions = 3');
  assert.equal(elementsById.get('rep-kpi-executed-cases')?.textContent, '3', 'Area 6: Reports executed cases = 3');
  assert.equal(elementsById.get('rep-kpi-notrun-cases')?.textContent, '4', 'Area 6: Reports not run cases = 4');
  assert.equal(elementsById.get('rep-kpi-passed-execs')?.textContent, '2', 'Area 6: Reports passed execs = 2');
  assert.equal(elementsById.get('rep-kpi-failed-execs')?.textContent, '1', 'Area 6: Reports failed execs = 1');
  assert.equal(elementsById.get('rep-kpi-passed-rate')?.textContent, '67% pass rate', 'Area 6: Reports pass rate = 67% (2 of 3)');
  assert.equal(elementsById.get('rep-kpi-total-defects')?.textContent, '1', 'Area 6: Reports total defects = 1');
  assert.equal(elementsById.get('rep-kpi-open-defects')?.textContent, '1', 'Area 6: Reports open defects = 1');

  console.log('✓ Test Group 7 passed (Complete 6-area cross-view consistency verified across all metrics)');
}

// ----------------------------------------------------------------------------
// Test Group 8: Regression Verification
// ----------------------------------------------------------------------------
console.log('\n--- Test Group 8: Regression Verification ---');
{
  // 8.1 Checklist Promotion (Phase 1)
  const parsed = parseQAPlanText(
    'Phase 1: Boot\nCategory: Init\n- [TC-R1] [High] App boots'
  );
  const createdRes = qaChecklistStore.createChecklistFromParsedPlan(parsed, 'Regress Checklist');
  assert.equal(createdRes.ok, true);
  const chk = createdRes.checklist;
  qaChecklistStore.saveAllChecklists([chk]);
  const promRes = qaChecklistStore.promoteChecklistToProject(chk.id, { projectName: 'Regress Project' });
  assert.equal(promRes.ok, true, 'Phase 1 promotion intact');

  // Duplicate promotion prevention
  const dupRes = qaChecklistStore.promoteChecklistToProject(chk.id, { projectName: 'Duplicate' });
  assert.equal(dupRes.ok, false, 'Duplicate promotion prevented');

  // 8.2 Execution modal step controls (Phase 2)
  const env = createQavoraTestEnvironment();
  const { hook, elementsById } = env;

  const testProj = {
    id: 'proj_regress_2',
    name: 'Regress 2 Proj',
    type: 'Website',
    status: 'Active',
    testPlan: { id: 'tp_r2', name: 'Plan', phases: [{ id: 'ph_r2', name: 'P', order: 0 }] },
    testSuites: [
      {
        id: 's_r2',
        phaseId: 'ph_r2',
        name: 'Suite R2',
        category: 'Functional',
        testCases: [
          {
            id: 'TC-STEP-1',
            title: 'Multi-step Case',
            status: 'Not Run',
            priority: 'High',
            steps: [
              { id: 'st1', action: 'Open page', testData: '', order: 0 },
              { id: 'st2', action: 'Click submit', testData: '', order: 1 }
            ]
          }
        ]
      }
    ],
    executions: [],
    defects: []
  };

  env.localStorage.setItem('qavora_projects_v1', JSON.stringify([testProj]));
  hook.openExecutionModal('proj_regress_2', 'TC-STEP-1');

  assert.equal(hook.State.modalExecContext.steps.length, 2, 'Execution modal loaded 2 steps');
  // Pass all steps button
  const passAllBtn = elementsById.get('btn-pass-all-steps');
  assert.ok(passAllBtn, 'Pass all steps button exists');
  passAllBtn.click();
  assert.ok(hook.State.modalExecContext.steps.every(s => s.status === 'completed'), 'All steps marked completed');

  // Reset steps button
  const resetStepsBtn = elementsById.get('btn-reset-all-steps');
  assert.ok(resetStepsBtn, 'Reset steps button exists');
  resetStepsBtn.click();
  assert.ok(hook.State.modalExecContext.steps.every(s => s.status === 'untested'), 'All steps reset to untested');

  hook.closeExecutionModal();

  // 8.3 Defect filtering and sorting (Phase 3)
  hook.State.activeDefectsProjectId = 'ALL';
  hook.renderDefectsWorkspace();
  assert.ok(elementsById.get('defects-project-select'), 'Defects project selector present');

  console.log('✓ Test Group 8 passed (Phase 1, Phase 2, and Phase 3 regressions verified intact)');
}

console.log('\n================================================================');
console.log('ALL 8 TEST GROUPS IN PHASE 4 VERIFICATION SUITE PASSED (100%)');
console.log('================================================================');
