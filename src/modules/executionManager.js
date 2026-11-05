/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Test Execution & Results Module (Phase 5)
 */

import { generateStableId } from '../../qaChecklistStore.js';
import { getProjects, getActiveProject, setActiveProjectId } from './state.js';
import { saveProjectData, updateSidebarProjectCounters } from './projectManager.js';
import { escapeHtml, formatDate } from './utils.js';
import { showToast, navigateTo } from './uiRenderer.js';
import { renderDashboard } from './dashboardManager.js';

let _activeExecutingCase = null;
let _activeExecutingProjectId = null;
let _stepStatuses = {}; // { [stepIndex]: 'Passed' | 'Failed' | 'Not Run' }
let _isSubmittingExecution = false;
let _listenersBound = false;

// Filter state for execution workspace
const _filterState = {
  search: '',
  phase: 'ALL',
  suite: 'ALL',
  status: 'ALL',
  priority: 'ALL',
  category: 'ALL',
  sort: 'id-asc'
};

export function getExecutionFilterState() {
  return _filterState;
}

/**
 * Saves or updates an execution record for the active project.
 */
export async function saveExecutionResult(executionData, projectId = null) {
  const projects = getProjects();
  const targetId = projectId || executionData.projectId || (getActiveProject()?.id);
  const project = projects.find((p) => p.id === targetId);

  if (!project) return { ok: false, error: 'No active project selected.' };

  const executions = Array.isArray(project.executions) ? [...project.executions] : [];
  const idx = executions.findIndex((e) => e.id === executionData.id);
  const record = {
    id: executionData.id || generateStableId('exec'),
    executedAt: new Date().toISOString(),
    ...executionData
  };

  if (idx >= 0) {
    executions[idx] = { ...executions[idx], ...record };
  } else {
    executions.unshift(record);
  }

  // Update test case status inside suites as well
  let updatedSuites = project.testSuites;
  const caseId = record.caseId || record.testCaseId;
  if (caseId && Array.isArray(project.testSuites)) {
    const rawStatus = (record.status || 'Not Run').toLowerCase();
    const normalizedStatus =
      rawStatus === 'pass' || rawStatus === 'passed'
        ? 'Passed'
        : rawStatus === 'fail' || rawStatus === 'failed'
        ? 'Failed'
        : rawStatus === 'blocked'
        ? 'Blocked'
        : rawStatus === 'skipped'
        ? 'Skipped'
        : 'Not Run';

    updatedSuites = project.testSuites.map((s) => {
      if (!Array.isArray(s.cases)) return s;
      const caseExists = s.cases.some((c) => c.id === caseId);
      if (!caseExists) return s;
      const updatedCases = s.cases.map((c) => {
        if (c.id === caseId) {
          return {
            ...c,
            status: normalizedStatus,
            lastExecution: {
              status: record.status,
              actualResult: record.actualResult,
              executedAt: record.executedAt,
              tester: record.tester
            }
          };
        }
        return c;
      });
      return { ...s, cases: updatedCases };
    });
  }

  return saveProjectData(project.id, {
    executions,
    testSuites: updatedSuites
  });
}

/**
 * Main render function for #view-execution workspace.
 */
export function renderExecutionWorkspace() {
  if (typeof document === 'undefined') return;

  const projects = getProjects();
  const currentProject = getActiveProject();

  const noProjectsView = document.getElementById('exec-no-projects-view');
  const mainContent = document.getElementById('exec-main-content');
  const projectSelect = document.getElementById('exec-project-select');

  if (projects.length === 0) {
    if (noProjectsView) noProjectsView.style.display = 'block';
    if (mainContent) mainContent.style.display = 'none';
    return;
  }

  if (noProjectsView) noProjectsView.style.display = 'none';
  if (mainContent) mainContent.style.display = 'block';

  // 1. Populate Project Selector
  if (projectSelect) {
    projectSelect.innerHTML = projects
      .map(
        (p) =>
          `<option value="${escapeHtml(p.id)}" ${p.id === currentProject?.id ? 'selected' : ''}>${escapeHtml(
            p.name || 'Untitled Project'
          )} (${p.type || 'Web'})</option>`
      )
      .join('');
  }

  if (!currentProject) return;

  // 2. Gather all test cases across suites
  const suites = Array.isArray(currentProject.testSuites) ? currentProject.testSuites : [];
  const phases = Array.isArray(currentProject.testPlan?.phases) ? currentProject.testPlan.phases : [];

  const phaseMap = new Map();
  phases.forEach((ph) => phaseMap.set(ph.id, ph.name));

  const allCases = [];
  const categoriesSet = new Set();

  suites.forEach((suite) => {
    const phaseName = suite.phaseId && phaseMap.has(suite.phaseId) ? phaseMap.get(suite.phaseId) : 'General';
    if (Array.isArray(suite.cases)) {
      suite.cases.forEach((tc) => {
        if (tc.category) categoriesSet.add(tc.category);
        allCases.push({
          ...tc,
          suiteId: suite.id,
          suiteName: suite.name || 'Untitled Suite',
          phaseId: suite.phaseId || null,
          phaseName
        });
      });
    }
  });

  // 3. Compute KPI Statistics
  let passedCount = 0;
  let failedCount = 0;
  let blockedCount = 0;
  let skippedCount = 0;
  let notRunCount = 0;

  allCases.forEach((c) => {
    const st = (c.status || '').toLowerCase();
    if (st === 'passed' || st === 'pass') passedCount++;
    else if (st === 'failed' || st === 'fail') failedCount++;
    else if (st === 'blocked') blockedCount++;
    else if (st === 'skipped') skippedCount++;
    else notRunCount++;
  });

  const totalCases = allCases.length;
  const executedCount = passedCount + failedCount + blockedCount + skippedCount;
  const completionRate = totalCases > 0 ? Math.min(100, Math.round((executedCount / totalCases) * 100)) : 0;
  const passRate = executedCount > 0 ? Math.round((passedCount / executedCount) * 100) : 0;

  const statTotal = document.getElementById('exec-stat-total');
  const statNotRun = document.getElementById('exec-stat-notrun');
  const statPassed = document.getElementById('exec-stat-passed');
  const statFailed = document.getElementById('exec-stat-failed');
  const statBlocked = document.getElementById('exec-stat-blocked');
  const statSkipped = document.getElementById('exec-stat-skipped');
  const statCompletion = document.getElementById('exec-stat-completion');
  const statCompletionBar = document.getElementById('exec-stat-completion-bar');
  const statPassRate = document.getElementById('exec-stat-passrate');

  if (statTotal) statTotal.textContent = String(totalCases);
  if (statNotRun) statNotRun.textContent = String(notRunCount);
  if (statPassed) statPassed.textContent = String(passedCount);
  if (statFailed) statFailed.textContent = String(failedCount);
  if (statBlocked) statBlocked.textContent = String(blockedCount);
  if (statSkipped) statSkipped.textContent = String(skippedCount);
  if (statCompletion) statCompletion.textContent = `${completionRate}%`;
  if (statCompletionBar) statCompletionBar.style.width = `${completionRate}%`;
  if (statPassRate) statPassRate.textContent = `${passRate}%`;

  // 4. Populate Dropdown Filters (preserving selection)
  const filterPhaseEl = document.getElementById('exec-filter-phase');
  const filterSuiteEl = document.getElementById('exec-filter-suite');
  const filterCategoryEl = document.getElementById('exec-filter-category');

  if (filterPhaseEl) {
    const currentVal = _filterState.phase;
    filterPhaseEl.innerHTML =
      '<option value="ALL">All Phases</option>' +
      phases.map((ph) => `<option value="${escapeHtml(ph.id)}" ${ph.id === currentVal ? 'selected' : ''}>${escapeHtml(ph.name)}</option>`).join('');
  }

  if (filterSuiteEl) {
    const currentVal = _filterState.suite;
    filterSuiteEl.innerHTML =
      '<option value="ALL">All Suites</option>' +
      suites.map((s) => `<option value="${escapeHtml(s.id)}" ${s.id === currentVal ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
  }

  if (filterCategoryEl) {
    const currentVal = _filterState.category;
    filterCategoryEl.innerHTML =
      '<option value="ALL">All Categories</option>' +
      Array.from(categoriesSet)
        .sort()
        .map((cat) => `<option value="${escapeHtml(cat)}" ${cat === currentVal ? 'selected' : ''}>${escapeHtml(cat)}</option>`)
        .join('');
  }

  // 5. Filter Cases
  const query = (_filterState.search || '').trim().toLowerCase();
  let filtered = allCases.filter((c) => {
    // Search query
    if (query) {
      const matchId = (c.testCaseId || c.id || '').toLowerCase().includes(query);
      const matchTitle = (c.title || '').toLowerCase().includes(query);
      const matchDesc = (c.description || '').toLowerCase().includes(query);
      const matchExpected = (c.expectedResult || '').toLowerCase().includes(query);
      if (!matchId && !matchTitle && !matchDesc && !matchExpected) return false;
    }

    // Phase filter
    if (_filterState.phase !== 'ALL' && c.phaseId !== _filterState.phase) {
      return false;
    }

    // Suite filter
    if (_filterState.suite !== 'ALL' && c.suiteId !== _filterState.suite) {
      return false;
    }

    // Status filter
    if (_filterState.status !== 'ALL') {
      const targetStatus = _filterState.status.toLowerCase();
      const currentStatus = (c.status || 'not run').toLowerCase();
      if (targetStatus === 'pass' && currentStatus !== 'passed' && currentStatus !== 'pass') return false;
      if (targetStatus === 'fail' && currentStatus !== 'failed' && currentStatus !== 'fail') return false;
      if (targetStatus === 'not run' && currentStatus !== 'not run' && currentStatus !== '') return false;
      if (targetStatus === 'blocked' && currentStatus !== 'blocked') return false;
      if (targetStatus === 'skipped' && currentStatus !== 'skipped') return false;
    }

    // Priority filter
    if (_filterState.priority !== 'ALL') {
      if ((c.priority || 'Medium').toLowerCase() !== _filterState.priority.toLowerCase()) {
        return false;
      }
    }

    // Category filter
    if (_filterState.category !== 'ALL') {
      if (c.category !== _filterState.category) {
        return false;
      }
    }

    return true;
  });

  // 6. Sort Cases
  const PRIORITY_WEIGHT = { Critical: 4, High: 3, Medium: 2, Low: 1 };
  filtered.sort((a, b) => {
    switch (_filterState.sort) {
      case 'id-desc':
        return (b.testCaseId || b.id || '').localeCompare(a.testCaseId || a.id || '');
      case 'priority-desc':
        return (PRIORITY_WEIGHT[b.priority || 'Medium'] || 2) - (PRIORITY_WEIGHT[a.priority || 'Medium'] || 2);
      case 'newest':
        return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
      case 'oldest':
        return new Date(a.updatedAt || a.createdAt || 0).getTime() - new Date(b.updatedAt || b.createdAt || 0).getTime();
      case 'title-asc':
        return (a.title || '').localeCompare(b.title || '');
      case 'id-asc':
      default:
        return (a.testCaseId || a.id || '').localeCompare(b.testCaseId || b.id || '');
    }
  });

  // 7. Update Meta Count & Clear Filter Button
  const metaCountEl = document.getElementById('exec-meta-count');
  if (metaCountEl) {
    metaCountEl.textContent = `Showing ${filtered.length} of ${allCases.length} test case${allCases.length === 1 ? '' : 's'}`;
  }

  const clearFiltersBtn = document.getElementById('exec-clear-filters-btn');
  const isFiltered =
    Boolean(_filterState.search) ||
    _filterState.phase !== 'ALL' ||
    _filterState.suite !== 'ALL' ||
    _filterState.status !== 'ALL' ||
    _filterState.priority !== 'ALL' ||
    _filterState.category !== 'ALL';

  if (clearFiltersBtn) {
    clearFiltersBtn.style.display = isFiltered ? 'inline-flex' : 'none';
  }

  const clearSearchBtn = document.getElementById('exec-search-clear-btn');
  if (clearSearchBtn) {
    clearSearchBtn.style.display = _filterState.search ? 'inline-flex' : 'none';
  }

  // 8. Render Table Content
  const tableContainer = document.getElementById('exec-table-container');
  if (!tableContainer) return;

  if (allCases.length === 0) {
    tableContainer.innerHTML = `
      <div class="empty-state" style="padding: 48px 16px;">
        <div class="empty-state-icon" style="width: 44px; height: 44px; margin-bottom: 12px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
        </div>
        <h4 class="empty-state-title" style="font-size: 1rem;">No Test Cases in This Project</h4>
        <p class="empty-state-desc" style="font-size: 0.85rem; max-width: 420px; margin-bottom: 16px;">
          Define test suites and test cases in the Test Plan workspace to begin manual testing and recording execution runs.
        </p>
        <button type="button" class="btn btn-primary btn-sm" id="exec-goto-plans-cta">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
          <span>Go to Test Plans</span>
        </button>
      </div>`;
    return;
  }

  if (filtered.length === 0) {
    tableContainer.innerHTML = `
      <div class="empty-state" style="padding: 40px 16px;">
        <h4 class="empty-state-title" style="font-size: 0.95rem;">No Test Cases Match Selected Filters</h4>
        <p class="empty-state-desc" style="font-size: 0.8rem; margin-bottom: 12px;">
          Try adjusting your search query, status, or phase filters.
        </p>
        <button type="button" class="btn btn-secondary btn-xs" id="exec-reset-empty-filters-btn">
          <span>Reset Filters</span>
        </button>
      </div>`;
    return;
  }

  const tableHtml = `
    <table class="cases-table">
      <thead>
        <tr>
          <th style="width: 110px;">Test ID</th>
          <th>Test Case Title</th>
          <th style="width: 150px;">Suite / Phase</th>
          <th style="width: 100px;">Priority</th>
          <th style="width: 110px;">Status</th>
          <th>Last Verification Outcome</th>
          <th style="width: 220px; text-align: right;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${filtered
          .map((tc) => {
            const displayId = tc.testCaseId || tc.id;
            const priorityClass = `p-${(tc.priority || 'medium').toLowerCase()}`;
            const rawStatus = (tc.status || 'not run').toLowerCase();
            const statusClass =
              rawStatus === 'passed' || rawStatus === 'pass'
                ? 'status-pass'
                : rawStatus === 'failed' || rawStatus === 'fail'
                ? 'status-fail'
                : rawStatus === 'blocked'
                ? 'status-blocked'
                : rawStatus === 'skipped'
                ? 'status-skipped'
                : 'status-notrun';

            const statusLabel =
              rawStatus === 'passed' || rawStatus === 'pass'
                ? 'Passed'
                : rawStatus === 'failed' || rawStatus === 'fail'
                ? 'Failed'
                : rawStatus === 'blocked'
                ? 'Blocked'
                : rawStatus === 'skipped'
                ? 'Skipped'
                : 'Not Run';

            const lastExec = tc.lastExecution;
            let lastExecHtml = '<span style="color: var(--text-muted); font-size: 0.75rem;">Not executed yet</span>';
            if (lastExec) {
              lastExecHtml = `
                <div style="font-size: 0.75rem; line-height: 1.35;">
                  <span style="font-weight: 500; color: var(--text-primary);">${escapeHtml(lastExec.actualResult || 'Executed')}</span>
                  <div style="color: var(--text-muted); font-size: 0.7rem; margin-top: 2px;">
                    ${formatDate(lastExec.executedAt)}${lastExec.tester ? ` · ${escapeHtml(lastExec.tester)}` : ''}
                  </div>
                </div>`;
            }

            return `
              <tr data-case-id="${escapeHtml(tc.id)}" data-project-id="${escapeHtml(currentProject.id)}">
                <td>
                  <span class="case-id-tag" title="Click to inspect test case">${escapeHtml(displayId)}</span>
                </td>
                <td>
                  <div style="display: flex; flex-direction: column; gap: 2px;">
                    <strong style="color: var(--text-primary); font-size: 0.85rem;">${escapeHtml(tc.title || 'Untitled Test')}</strong>
                    ${tc.expectedResult ? `<span style="font-size: 0.72rem; color: var(--text-muted); display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;">Exp: ${escapeHtml(tc.expectedResult)}</span>` : ''}
                  </div>
                </td>
                <td>
                  <div style="display: flex; flex-direction: column; gap: 2px;">
                    <span style="font-size: 0.78rem; font-weight: 500;">${escapeHtml(tc.suiteName)}</span>
                    <span style="font-size: 0.68rem; color: var(--text-muted);">${escapeHtml(tc.phaseName)}</span>
                  </div>
                </td>
                <td>
                  <span class="priority-badge ${priorityClass}">${escapeHtml(tc.priority || 'Medium')}</span>
                </td>
                <td>
                  <span class="status-badge ${statusClass}">${statusLabel}</span>
                </td>
                <td>
                  ${lastExecHtml}
                </td>
                <td style="text-align: right;">
                  <div style="display: inline-flex; align-items: center; gap: 4px;">
                    <button type="button" class="btn btn-primary btn-xs" data-action="open-execution-modal" data-case-id="${escapeHtml(tc.id)}" title="Record execution result">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                      </svg>
                      <span>Execute</span>
                    </button>
                    <button type="button" class="btn btn-ghost btn-xs" data-action="view-execution-history" data-case-id="${escapeHtml(tc.id)}" title="View past execution runs">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                      </svg>
                    </button>
                    <button type="button" class="btn btn-ghost btn-xs text-green" data-action="quick-pass-case" data-case-id="${escapeHtml(tc.id)}" title="Quick Pass">
                      ✓
                    </button>
                    <button type="button" class="btn btn-ghost btn-xs text-red" data-action="quick-fail-case" data-case-id="${escapeHtml(tc.id)}" title="Quick Fail">
                      ✕
                    </button>
                  </div>
                </td>
              </tr>`;
          })
          .join('')}
      </tbody>
    </table>`;

  tableContainer.innerHTML = tableHtml;
}

/**
 * Opens #execution-modal to execute a test case.
 */
export function openExecutionModal(testCase, projectId = null) {
  if (typeof document === 'undefined' || !testCase) return;

  const targetProject = projectId
    ? getProjects().find((p) => p.id === projectId)
    : getActiveProject();

  _activeExecutingCase = testCase;
  _activeExecutingProjectId = targetProject?.id || null;
  _stepStatuses = {};

  const modal = document.getElementById('execution-modal');
  const caseIdInput = document.getElementById('exec-case-id-input');
  const projIdInput = document.getElementById('exec-project-id-input');
  const modalCaseId = document.getElementById('exec-modal-case-id');
  const modalPriority = document.getElementById('exec-modal-priority');
  const modalCategory = document.getElementById('exec-modal-category');
  const modalTitle = document.getElementById('exec-modal-title');
  const preconditionsEl = document.getElementById('exec-case-preconditions');
  const descEl = document.getElementById('exec-case-desc');
  const expectedEl = document.getElementById('exec-expected-result');
  const errorAlert = document.getElementById('exec-error-alert');
  const warnAlert = document.getElementById('exec-incomplete-warning');

  if (caseIdInput) caseIdInput.value = testCase.id;
  if (projIdInput) projIdInput.value = targetProject?.id || '';

  const displayId = testCase.testCaseId || testCase.id;
  if (modalCaseId) modalCaseId.textContent = displayId;
  if (modalPriority) {
    modalPriority.textContent = testCase.priority || 'Medium';
    modalPriority.className = `priority-badge p-${(testCase.priority || 'medium').toLowerCase()}`;
  }
  if (modalCategory) {
    modalCategory.textContent = testCase.category || 'Functional';
  }
  if (modalTitle) {
    modalTitle.textContent = testCase.title || 'Execute Test Case';
  }
  if (preconditionsEl) {
    preconditionsEl.textContent = testCase.preconditions || 'No preconditions specified.';
  }
  if (descEl) {
    descEl.textContent = testCase.description || 'No description provided.';
  }
  if (expectedEl) {
    expectedEl.textContent = testCase.expectedResult || 'Expected behavior matches specifications.';
  }

  if (errorAlert) errorAlert.style.display = 'none';
  if (warnAlert) warnAlert.style.display = 'none';

  // Render Step-by-Step interactive verification
  renderStepVerificationList(testCase.steps);

  // Form Fields
  const statusSelect = document.getElementById('exec-status-select');
  const actualInput = document.getElementById('exec-actual-input');
  const notesInput = document.getElementById('exec-notes-input');
  const defectSection = document.getElementById('exec-defect-section');
  const defectTitleInput = document.getElementById('exec-defect-title');
  const defectStepsInput = document.getElementById('exec-defect-steps');

  if (statusSelect) {
    statusSelect.value = 'Pass';
  }
  if (actualInput) {
    actualInput.value = testCase.expectedResult ? `Verified: ${testCase.expectedResult}` : 'Observed behavior matches expected result.';
  }
  if (notesInput) {
    notesInput.value = '';
  }

  if (defectSection) {
    defectSection.style.display = 'none';
  }
  if (defectTitleInput) {
    defectTitleInput.value = `[${displayId}] ${testCase.title} - Verification Failed`;
  }
  if (defectStepsInput) {
    if (Array.isArray(testCase.steps) && testCase.steps.length > 0) {
      defectStepsInput.value = testCase.steps
        .map((s, idx) => `${idx + 1}. ${s.action || s.step || ''}${s.expectedResult ? ` (Expected: ${s.expectedResult})` : ''}`)
        .join('\n');
    } else {
      defectStepsInput.value = `1. Execute ${displayId}\n2. Verify observed outcome against expected result`;
    }
  }

  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function renderStepVerificationList(steps) {
  const container = document.getElementById('exec-steps-container');
  const progressText = document.getElementById('exec-step-progress-text');
  const progressBar = document.getElementById('exec-steps-progress-bar');
  if (!container) return;

  const stepList = Array.isArray(steps) ? steps : [];
  if (stepList.length === 0) {
    container.innerHTML = `
      <div style="padding: 10px; font-size: 0.8rem; color: var(--text-muted); background: var(--bg-surface-2); border-radius: 6px;">
        No discrete verification steps recorded for this test case. Verify overall behavior against expected result.
      </div>`;
    if (progressText) progressText.textContent = '1 checklist check';
    if (progressBar) progressBar.style.width = '100%';
    return;
  }

  container.innerHTML = stepList
    .map((s, idx) => {
      const status = _stepStatuses[idx] || 'Not Run';
      const passActive = status === 'Passed' ? 'active' : '';
      const failActive = status === 'Failed' ? 'active' : '';

      return `
        <div class="exec-step-item" data-step-idx="${idx}" style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 10px; border-bottom: 1px solid var(--border-color); background: ${status === 'Passed' ? 'rgba(34, 197, 94, 0.04)' : status === 'Failed' ? 'rgba(239, 68, 68, 0.05)' : 'transparent'};">
          <div style="display: flex; gap: 8px; align-items: flex-start; flex: 1;">
            <span class="step-num-badge" style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: var(--bg-surface-2); font-weight: 600;">${idx + 1}</span>
            <div style="font-size: 0.82rem; line-height: 1.4;">
              <p style="margin: 0; color: var(--text-primary); font-weight: 500;">${escapeHtml(s.action || s.step || 'Verify test step')}</p>
              ${s.expectedResult ? `<p style="margin: 2px 0 0; color: var(--text-muted); font-size: 0.74rem;"><strong>Expected:</strong> ${escapeHtml(s.expectedResult)}</p>` : ''}
            </div>
          </div>
          <div style="display: flex; gap: 6px; flex-shrink: 0;">
            <button type="button" class="btn btn-ghost btn-xs step-pass-btn ${passActive}" data-step-idx="${idx}" data-step-action="pass" style="font-size: 0.72rem; ${passActive ? 'background: var(--color-green); color: white;' : ''}">
              ✓ Pass
            </button>
            <button type="button" class="btn btn-ghost btn-xs step-fail-btn ${failActive}" data-step-idx="${idx}" data-step-action="fail" style="font-size: 0.72rem; ${failActive ? 'background: var(--color-red); color: white;' : ''}">
              ✕ Fail
            </button>
          </div>
        </div>`;
    })
    .join('');

  updateStepProgress();
}

function updateStepProgress() {
  const steps = Array.isArray(_activeExecutingCase?.steps) ? _activeExecutingCase.steps : [];
  if (steps.length === 0) return;

  let passed = 0;
  let failed = 0;
  steps.forEach((_, idx) => {
    if (_stepStatuses[idx] === 'Passed') passed++;
    else if (_stepStatuses[idx] === 'Failed') failed++;
  });

  const completed = passed + failed;
  const pct = Math.round((completed / steps.length) * 100);

  const progressText = document.getElementById('exec-step-progress-text');
  const progressBar = document.getElementById('exec-steps-progress-bar');
  if (progressText) progressText.textContent = `${completed} of ${steps.length} steps checked (${pct}%)`;
  if (progressBar) progressBar.style.width = `${pct}%`;

  const statusSelect = document.getElementById('exec-status-select');
  const defectSection = document.getElementById('exec-defect-section');

  if (failed > 0 && statusSelect) {
    statusSelect.value = 'Fail';
    if (defectSection) defectSection.style.display = 'block';
  } else if (passed === steps.length && statusSelect) {
    statusSelect.value = 'Pass';
    if (defectSection) defectSection.style.display = 'none';
  }
}

export function closeExecutionModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('execution-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
  _activeExecutingCase = null;
  _activeExecutingProjectId = null;
  _stepStatuses = {};
}

/**
 * Quick status recorder directly from table action buttons.
 */
export async function quickRecordOutcome(caseId, status, projectId = null) {
  const projects = getProjects();
  const currentProject = projectId ? projects.find((p) => p.id === projectId) : getActiveProject();
  if (!currentProject) {
    showToast('No active project found.', 'error');
    return;
  }

  let foundCase = null;
  let foundSuiteId = null;

  if (Array.isArray(currentProject.testSuites)) {
    for (const s of currentProject.testSuites) {
      if (Array.isArray(s.cases)) {
        const c = s.cases.find((item) => item.id === caseId);
        if (c) {
          foundCase = c;
          foundSuiteId = s.id;
          break;
        }
      }
    }
  }

  if (!foundCase) {
    showToast('Test case not found in project suites.', 'error');
    return;
  }

  const execPayload = {
    caseId: foundCase.id,
    testCaseId: foundCase.id,
    caseTitle: foundCase.title,
    suiteId: foundSuiteId,
    status: status, // 'Pass' | 'Fail' | 'Blocked' | 'Skipped'
    actualResult:
      status === 'Pass'
        ? `Quick Pass: Verified against expected result "${foundCase.expectedResult || 'matches spec'}".`
        : `Quick ${status}: Recorded without detailed notes.`,
    executedAt: new Date().toISOString()
  };

  const res = await saveExecutionResult(execPayload, currentProject.id);
  if (res.ok) {
    updateSidebarProjectCounters();
    renderExecutionWorkspace();
    renderDashboard();
    showToast(`Recorded outcome ${status} for ${foundCase.testCaseId || foundCase.id}.`, 'success');
  } else {
    showToast(res.error || 'Failed to record execution.', 'error');
  }
}

/**
 * Opens #execution-history-modal to inspect previous runs.
 */
export function openExecutionHistoryModal(testCase, projectId = null) {
  if (typeof document === 'undefined' || !testCase) return;

  const targetProject = projectId
    ? getProjects().find((p) => p.id === projectId)
    : getActiveProject();

  const modal = document.getElementById('execution-history-modal');
  const caseIdEl = document.getElementById('history-modal-case-id');
  const titleEl = document.getElementById('history-modal-title');
  const caseTitleEl = document.getElementById('history-modal-case-title');
  const totalRunsEl = document.getElementById('history-modal-total-runs');
  const runsContainer = document.getElementById('history-runs-container');

  const displayId = testCase.testCaseId || testCase.id;
  if (caseIdEl) caseIdEl.textContent = displayId;
  if (caseTitleEl) caseTitleEl.textContent = testCase.title || 'Untitled Test';

  const executions = Array.isArray(targetProject?.executions) ? targetProject.executions : [];
  const runs = executions.filter(
    (e) => String(e.caseId || e.testCaseId) === String(testCase.id)
  );

  if (totalRunsEl) {
    totalRunsEl.textContent = `${runs.length} run${runs.length === 1 ? '' : 's'}`;
  }

  if (runsContainer) {
    if (runs.length === 0) {
      runsContainer.innerHTML = `
        <div class="empty-state" style="padding: 28px 16px;">
          <h4 class="empty-state-title" style="font-size: 0.95rem;">No Execution Runs Yet</h4>
          <p class="empty-state-desc" style="font-size: 0.8rem; margin-bottom: 0;">
            This test case has not been executed yet. Click "Execute Again" to record its first verification run.
          </p>
        </div>`;
    } else {
      runsContainer.innerHTML = runs
        .map((r, idx) => {
          const rawStatus = (r.status || 'not run').toLowerCase();
          const statusClass =
            rawStatus === 'passed' || rawStatus === 'pass'
              ? 'status-pass'
              : rawStatus === 'failed' || rawStatus === 'fail'
              ? 'status-fail'
              : rawStatus === 'blocked'
              ? 'status-blocked'
              : rawStatus === 'skipped'
              ? 'status-skipped'
              : 'status-notrun';

          const runNum = runs.length - idx;

          return `
            <div class="history-run-card" style="padding: 12px; margin-bottom: 8px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-surface-2);">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-weight: 700; font-size: 0.82rem; color: var(--text-primary);">Run #${runNum}</span>
                  <span class="status-badge ${statusClass}">${escapeHtml(r.status || 'Pass')}</span>
                </div>
                <span style="font-size: 0.72rem; color: var(--text-muted);">${formatDate(r.executedAt)}</span>
              </div>
              <div style="font-size: 0.8rem; color: var(--text-primary); margin-bottom: 4px;">
                <strong>Actual Result:</strong> ${escapeHtml(r.actualResult || 'No actual result notes.')}
              </div>
              ${r.notes ? `<div style="font-size: 0.76rem; color: var(--text-muted); margin-bottom: 4px;"><strong>Notes:</strong> ${escapeHtml(r.notes)}</div>` : ''}
              <div style="display: flex; gap: 12px; flex-wrap: wrap; font-size: 0.72rem; color: var(--text-muted); margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 4px;">
                ${r.tester ? `<span>Tester: <strong>${escapeHtml(r.tester)}</strong></span>` : ''}
                ${r.environment ? `<span>Env: <strong>${escapeHtml(r.environment)}</strong></span>` : ''}
                ${r.device ? `<span>Device: <strong>${escapeHtml(r.device)}</strong></span>` : ''}
                ${r.buildVersion ? `<span>Build: <strong>${escapeHtml(r.buildVersion)}</strong></span>` : ''}
              </div>
            </div>`;
        })
        .join('');
    }
  }

  // Bind Execute Again button
  const execAgainBtn = document.getElementById('history-execute-again-btn');
  if (execAgainBtn) {
    execAgainBtn.onclick = () => {
      closeExecutionHistoryModal();
      openExecutionModal(testCase, targetProject?.id);
    };
  }

  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
}

export function closeExecutionHistoryModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('execution-history-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}

/**
 * Initializes all event listeners for the Test Execution workspace.
 */
export function initExecutionEventListeners() {
  if (typeof document === 'undefined' || _listenersBound) return;
  _listenersBound = true;

  // 1. Project Selector in #view-execution
  const projectSelect = document.getElementById('exec-project-select');
  projectSelect?.addEventListener('change', (e) => {
    const newId = e.target.value;
    if (newId) {
      setActiveProjectId(newId);
      // Reset suite and phase filters for new project
      _filterState.phase = 'ALL';
      _filterState.suite = 'ALL';
      renderExecutionWorkspace();
    }
  });

  // 2. Navigation buttons
  document.getElementById('exec-jump-defects-btn')?.addEventListener('click', () => {
    const cur = getActiveProject();
    if (cur) {
      navigateTo(`/defects?id=${encodeURIComponent(cur.id)}`);
    } else {
      navigateTo('/defects');
    }
  });

  document.getElementById('exec-jump-plans-btn')?.addEventListener('click', () => {
    const cur = getActiveProject();
    if (cur) {
      navigateTo(`/plans?id=${encodeURIComponent(cur.id)}`);
    } else {
      navigateTo('/plans');
    }
  });

  // 3. Search and Filters Toolbar
  const searchInput = document.getElementById('exec-search-input');
  const clearSearchBtn = document.getElementById('exec-search-clear-btn');
  const filterPhase = document.getElementById('exec-filter-phase');
  const filterSuite = document.getElementById('exec-filter-suite');
  const filterStatus = document.getElementById('exec-filter-status');
  const filterPriority = document.getElementById('exec-filter-priority');
  const filterCategory = document.getElementById('exec-filter-category');
  const sortBy = document.getElementById('exec-sort-by');
  const clearFiltersBtn = document.getElementById('exec-clear-filters-btn');

  searchInput?.addEventListener('input', () => {
    _filterState.search = searchInput.value;
    renderExecutionWorkspace();
  });

  clearSearchBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    _filterState.search = '';
    renderExecutionWorkspace();
  });

  filterPhase?.addEventListener('change', () => {
    _filterState.phase = filterPhase.value;
    renderExecutionWorkspace();
  });

  filterSuite?.addEventListener('change', () => {
    _filterState.suite = filterSuite.value;
    renderExecutionWorkspace();
  });

  filterStatus?.addEventListener('change', () => {
    _filterState.status = filterStatus.value;
    renderExecutionWorkspace();
  });

  filterPriority?.addEventListener('change', () => {
    _filterState.priority = filterPriority.value;
    renderExecutionWorkspace();
  });

  filterCategory?.addEventListener('change', () => {
    _filterState.category = filterCategory.value;
    renderExecutionWorkspace();
  });

  sortBy?.addEventListener('change', () => {
    _filterState.sort = sortBy.value;
    renderExecutionWorkspace();
  });

  const resetAllFilters = () => {
    _filterState.search = '';
    _filterState.phase = 'ALL';
    _filterState.suite = 'ALL';
    _filterState.status = 'ALL';
    _filterState.priority = 'ALL';
    _filterState.category = 'ALL';
    _filterState.sort = 'id-asc';

    if (searchInput) searchInput.value = '';
    if (filterPhase) filterPhase.value = 'ALL';
    if (filterSuite) filterSuite.value = 'ALL';
    if (filterStatus) filterStatus.value = 'ALL';
    if (filterPriority) filterPriority.value = 'ALL';
    if (filterCategory) filterCategory.value = 'ALL';
    if (sortBy) sortBy.value = 'id-asc';

    renderExecutionWorkspace();
  };

  clearFiltersBtn?.addEventListener('click', resetAllFilters);

  // 4. Execution Table Delegation (Execute, History, Quick Pass, Quick Fail, Reset Empty)
  const tableContainer = document.getElementById('exec-table-container');
  tableContainer?.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    // Reset filters from empty state
    if (target.closest('#exec-reset-empty-filters-btn')) {
      resetAllFilters();
      return;
    }

    // Go to plans from empty project state
    if (target.closest('#exec-goto-plans-cta')) {
      navigateTo('/plans');
      return;
    }

    const row = target.closest('tr[data-case-id]');
    if (!row) return;

    const caseId = row.getAttribute('data-case-id');
    const projectId = row.getAttribute('data-project-id');
    const curProject = getProjects().find((p) => p.id === projectId) || getActiveProject();

    let targetCase = null;
    if (curProject && Array.isArray(curProject.testSuites)) {
      for (const s of curProject.testSuites) {
        if (Array.isArray(s.cases)) {
          const match = s.cases.find((c) => c.id === caseId);
          if (match) {
            targetCase = { ...match, suiteId: s.id, suiteName: s.name };
            break;
          }
        }
      }
    }

    if (!targetCase) return;

    // A. Open Execution Modal
    const execBtn = target.closest('[data-action="open-execution-modal"]');
    if (execBtn) {
      e.stopPropagation();
      openExecutionModal(targetCase, curProject.id);
      return;
    }

    // B. View Execution History
    const historyBtn = target.closest('[data-action="view-execution-history"]');
    if (historyBtn) {
      e.stopPropagation();
      openExecutionHistoryModal(targetCase, curProject.id);
      return;
    }

    // C. Quick Pass
    const quickPassBtn = target.closest('[data-action="quick-pass-case"]');
    if (quickPassBtn) {
      e.stopPropagation();
      quickRecordOutcome(caseId, 'Pass', curProject.id);
      return;
    }

    // D. Quick Fail
    const quickFailBtn = target.closest('[data-action="quick-fail-case"]');
    if (quickFailBtn) {
      e.stopPropagation();
      quickRecordOutcome(caseId, 'Fail', curProject.id);
      return;
    }
  });

  // 5. Execution Modal Elements & Interactive Step Buttons
  const execModal = document.getElementById('execution-modal');
  const execCloseBtn = document.getElementById('exec-modal-close');
  const execCancelBtn = document.getElementById('exec-modal-cancel');
  const execForm = document.getElementById('execution-form');
  const execStatusSelect = document.getElementById('exec-status-select');
  const defectSection = document.getElementById('exec-defect-section');

  execCloseBtn?.addEventListener('click', closeExecutionModal);
  execCancelBtn?.addEventListener('click', closeExecutionModal);
  execModal?.addEventListener('click', (e) => {
    if (e.target === execModal) closeExecutionModal();
  });

  // Step button actions inside modal
  const stepsContainer = document.getElementById('exec-steps-container');
  stepsContainer?.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const passBtn = target.closest('[data-step-action="pass"]');
    if (passBtn) {
      const idx = Number(passBtn.getAttribute('data-step-idx'));
      _stepStatuses[idx] = _stepStatuses[idx] === 'Passed' ? 'Not Run' : 'Passed';
      renderStepVerificationList(_activeExecutingCase?.steps);
      return;
    }

    const failBtn = target.closest('[data-step-action="fail"]');
    if (failBtn) {
      const idx = Number(failBtn.getAttribute('data-step-idx'));
      _stepStatuses[idx] = _stepStatuses[idx] === 'Failed' ? 'Not Run' : 'Failed';
      renderStepVerificationList(_activeExecutingCase?.steps);
      return;
    }
  });

  document.getElementById('btn-pass-all-steps')?.addEventListener('click', () => {
    const steps = Array.isArray(_activeExecutingCase?.steps) ? _activeExecutingCase.steps : [];
    steps.forEach((_, idx) => {
      _stepStatuses[idx] = 'Passed';
    });
    renderStepVerificationList(steps);
  });

  document.getElementById('btn-reset-all-steps')?.addEventListener('click', () => {
    _stepStatuses = {};
    renderStepVerificationList(_activeExecutingCase?.steps);
  });

  // Status select toggle defect section
  execStatusSelect?.addEventListener('change', () => {
    const val = execStatusSelect.value;
    if (defectSection) {
      defectSection.style.display = val === 'Fail' ? 'block' : 'none';
    }
  });

  // 6. Form Submission: Save Execution & optional Defect
  execForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (_isSubmittingExecution || !_activeExecutingCase) return;

    const statusVal = execStatusSelect?.value;
    const actualInput = document.getElementById('exec-actual-input');
    const notesInput = document.getElementById('exec-notes-input');
    const testerInput = document.getElementById('exec-tester-input');
    const envInput = document.getElementById('exec-env-input');
    const deviceInput = document.getElementById('exec-device-input');
    const buildInput = document.getElementById('exec-build-input');
    const errorAlert = document.getElementById('exec-error-alert');
    const submitBtn = document.getElementById('exec-submit-btn');

    if (!statusVal) {
      if (errorAlert) {
        errorAlert.style.display = 'flex';
        const errText = document.getElementById('exec-error-text');
        if (errText) errText.textContent = 'Please select an execution outcome status.';
      }
      return;
    }

    const actualResult = actualInput?.value?.trim() || '';
    if (!actualResult && (statusVal === 'Pass' || statusVal === 'Fail')) {
      if (errorAlert) {
        errorAlert.style.display = 'flex';
        const errText = document.getElementById('exec-error-text');
        if (errText) errText.textContent = 'Actual result / observed behavior is required.';
      }
      actualInput?.focus();
      return;
    }

    _isSubmittingExecution = true;
    if (submitBtn) submitBtn.disabled = true;

    try {
      const curProject = getProjects().find((p) => p.id === _activeExecutingProjectId) || getActiveProject();
      if (!curProject) {
        showToast('Active project not found.', 'error');
        return;
      }

      const execRecord = {
        id: generateStableId('exec'),
        caseId: _activeExecutingCase.id,
        testCaseId: _activeExecutingCase.id,
        caseTitle: _activeExecutingCase.title,
        suiteId: _activeExecutingCase.suiteId,
        status: statusVal,
        actualResult: actualResult || `Status recorded as ${statusVal}.`,
        notes: notesInput?.value?.trim() || '',
        tester: testerInput?.value?.trim() || '',
        environment: envInput?.value?.trim() || '',
        device: deviceInput?.value?.trim() || '',
        buildVersion: buildInput?.value?.trim() || '',
        executedAt: new Date().toISOString()
      };

      // Check if we should log defect on failure
      const logDefectToggle = document.getElementById('exec-log-defect-toggle');
      let defects = Array.isArray(curProject.defects) ? [...curProject.defects] : [];

      if (statusVal === 'Fail' && logDefectToggle?.checked) {
        const defTitle = document.getElementById('exec-defect-title')?.value?.trim();
        const defSeverity = document.getElementById('exec-defect-severity')?.value || 'High';
        const defUrl = document.getElementById('exec-defect-url')?.value?.trim() || '';
        const defSteps = document.getElementById('exec-defect-steps')?.value?.trim() || '';

        const displayId = _activeExecutingCase.testCaseId || _activeExecutingCase.id;
        const defectCount = defects.length + 1;
        const defectDisplayId = `DEF-${String(defectCount).padStart(3, '0')}`;

        const newDefect = {
          id: generateStableId('def'),
          defectId: defectDisplayId,
          title: defTitle || `[${displayId}] ${_activeExecutingCase.title} - Verification Failed`,
          severity: defSeverity,
          status: 'Open',
          linkedTestCaseId: _activeExecutingCase.id,
          linkedCaseTitle: _activeExecutingCase.title,
          steps: defSteps,
          expectedResult: _activeExecutingCase.expectedResult || '',
          actualResult: actualResult,
          description: notesInput?.value?.trim() || '',
          externalUrl: defUrl,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        defects = [newDefect, ...defects];
      }

      // Update executions array
      const executions = Array.isArray(curProject.executions) ? [execRecord, ...curProject.executions] : [execRecord];

      // Update test case status in suites
      const updatedSuites = Array.isArray(curProject.testSuites)
        ? curProject.testSuites.map((s) => {
            if (!Array.isArray(s.cases)) return s;
            const updatedCases = s.cases.map((c) => {
              if (c.id === _activeExecutingCase.id) {
                return {
                  ...c,
                  status: statusVal === 'Pass' ? 'Passed' : statusVal === 'Fail' ? 'Failed' : statusVal,
                  lastExecution: {
                    status: statusVal,
                    actualResult,
                    executedAt: execRecord.executedAt,
                    tester: execRecord.tester
                  }
                };
              }
              return c;
            });
            return { ...s, cases: updatedCases };
          })
        : [];

      const saveRes = await saveProjectData(curProject.id, {
        executions,
        defects,
        testSuites: updatedSuites
      });

      if (saveRes.ok) {
        updateSidebarProjectCounters();
        renderExecutionWorkspace();
        renderDashboard();
        showToast('Execution result recorded successfully.', 'success');
        closeExecutionModal();
      } else {
        showToast(saveRes.error || 'Failed to save execution record.', 'error');
      }
    } catch {
      showToast('An unexpected error occurred while saving execution.', 'error');
    } finally {
      _isSubmittingExecution = false;
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // 7. Execution History Modal Close
  const historyModal = document.getElementById('execution-history-modal');
  const historyCloseBtn = document.getElementById('history-modal-close');
  const historyCloseModalBtn = document.getElementById('history-modal-close-btn');

  historyCloseBtn?.addEventListener('click', closeExecutionHistoryModal);
  historyCloseModalBtn?.addEventListener('click', closeExecutionHistoryModal);
  historyModal?.addEventListener('click', (e) => {
    if (e.target === historyModal) closeExecutionHistoryModal();
  });
}
