/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Test Plans, Phases, Suites & Test Cases Module (CQ-003)
 */

import { generateStableId } from '../../qaChecklistStore.js';
import {
  getProjects,
  getActiveProjectId,
  setActiveProjectId,
  getActiveProject,
  setPendingDelete
} from './state.js';
import {
  saveProjectData,
  getIsLoadingProjects,
  getProjectLoadError
} from './projectManager.js';
import { escapeHtml, formatDate } from './utils.js';

let _activeSuiteId = null;
let _currentViewingCase = null;
let _currentViewingSuite = null;

export function getActiveSuiteId() {
  return _activeSuiteId;
}

export function setActiveSuiteId(suiteId) {
  _activeSuiteId = suiteId || null;
}

export function getCurrentViewingCase() {
  return _currentViewingCase;
}

export function getCurrentViewingSuite() {
  return _currentViewingSuite;
}

/* ==========================================================================
   1. ACTIVE PROJECTS DROPDOWN & TEST PLAN RETRIEVAL
   ========================================================================== */

/**
 * Populates the #plans-project-select dropdown with authenticated user's projects.
 * Accurately represents Loading, Error, Empty, and Populated states.
 */
export function populateProjectsDropdown() {
  if (typeof document === 'undefined') return;
  const selectEl = document.getElementById('plans-project-select');
  if (!selectEl) return;

  const isLoading = getIsLoadingProjects();
  const loadError = getProjectLoadError();
  const projects = getProjects();
  const currentActiveId = getActiveProjectId();

  // 1. Loading State
  if (isLoading) {
    selectEl.innerHTML = '<option value="" disabled selected>Loading projects...</option>';
    selectEl.disabled = true;
    return;
  }

  // 2. Error State
  if (loadError) {
    selectEl.innerHTML = '<option value="" disabled selected>Error loading projects</option>';
    selectEl.disabled = true;
    return;
  }

  // 3. Empty State (0 projects exist)
  if (projects.length === 0) {
    selectEl.innerHTML = '<option value="" disabled selected>No projects available</option>';
    selectEl.disabled = true;
    return;
  }

  // 4. Populated State
  selectEl.disabled = false;
  let targetSelectedId = currentActiveId;
  const exists = projects.some((p) => p.id === targetSelectedId);
  if (!exists) {
    targetSelectedId = projects[0].id;
    setActiveProjectId(targetSelectedId);
  }

  selectEl.innerHTML = projects
    .map((p) => {
      const isSelected = p.id === targetSelectedId ? 'selected' : '';
      const projType = p.type ? ` (${escapeHtml(p.type)})` : '';
      return `<option value="${escapeHtml(p.id)}" ${isSelected}>${escapeHtml(p.name || 'Untitled Project')}${projType}</option>`;
    })
    .join('');
}

/**
 * Ensures a project has a well-formed testPlan object.
 */
function ensureProjectTestPlan(project) {
  if (!project) return null;
  const now = new Date().toISOString();
  if (!project.testPlan || typeof project.testPlan !== 'object') {
    project.testPlan = {
      id: `plan_${project.id}`,
      name: `${project.name || 'Project'} Master Test Plan`,
      description: '',
      objective: '',
      scope: '',
      notes: '',
      createdAt: project.createdAt || now,
      updatedAt: project.updatedAt || now,
      phases: []
    };
  }
  if (!Array.isArray(project.testPlan.phases)) {
    project.testPlan.phases = [];
  }
  if (!Array.isArray(project.testSuites)) {
    project.testSuites = [];
  }
  return project;
}

/**
 * Main render function for the Test Plan workspace view (#view-plans).
 */
export function renderTestPlanWorkspace() {
  if (typeof document === 'undefined') return;

  const noProjectsView = document.getElementById('plans-no-projects-view');
  const phasesSubview = document.getElementById('plans-phases-subview');
  const casesSubview = document.getElementById('plans-cases-subview');
  const editPlanBtn = document.getElementById('plans-edit-plan-btn');
  const addPhaseBtn = document.getElementById('plans-add-phase-btn');

  populateProjectsDropdown();

  const projects = getProjects();
  if (projects.length === 0) {
    if (noProjectsView) noProjectsView.style.display = 'block';
    if (phasesSubview) phasesSubview.style.display = 'none';
    if (casesSubview) casesSubview.style.display = 'none';
    if (editPlanBtn) editPlanBtn.disabled = true;
    if (addPhaseBtn) addPhaseBtn.disabled = true;
    return;
  }

  if (noProjectsView) noProjectsView.style.display = 'none';
  if (editPlanBtn) editPlanBtn.disabled = false;
  if (addPhaseBtn) addPhaseBtn.disabled = false;

  const project = ensureProjectTestPlan(getActiveProject());
  if (!project) return;

  // If a suite is active, render the Suite Explorer subview
  if (_activeSuiteId) {
    const suite = project.testSuites.find((s) => s.id === _activeSuiteId);
    if (suite) {
      if (phasesSubview) phasesSubview.style.display = 'none';
      if (casesSubview) casesSubview.style.display = 'block';
      renderSuiteExplorer(_activeSuiteId);
      return;
    }
    // If suite was deleted, fall back to phases subview
    _activeSuiteId = null;
  }

  if (casesSubview) casesSubview.style.display = 'none';
  if (phasesSubview) phasesSubview.style.display = 'block';

  // 1. Render Test Plan Overview Banner
  const plan = project.testPlan;
  const planNameEl = document.getElementById('plan-name');
  const planCreatedEl = document.getElementById('plan-created-date');
  const planUpdatedEl = document.getElementById('plan-updated-date');
  const planObjectiveEl = document.getElementById('plan-objective');
  const planScopeEl = document.getElementById('plan-scope');
  const planDescEl = document.getElementById('plan-desc');

  if (planNameEl) planNameEl.textContent = plan.name || `${project.name} Master Test Plan`;
  if (planCreatedEl) planCreatedEl.textContent = `Created ${formatDate(plan.createdAt || project.createdAt)}`;
  if (planUpdatedEl) planUpdatedEl.textContent = `Updated ${formatDate(plan.updatedAt || project.updatedAt)}`;
  if (planObjectiveEl) {
    planObjectiveEl.textContent = plan.objective || 'Not defined yet. Click "Edit Test Plan" to document goals.';
  }
  if (planScopeEl) {
    planScopeEl.textContent = plan.scope || 'Not defined yet.';
  }
  if (planDescEl) {
    planDescEl.textContent = plan.description || 'No general description provided.';
  }

  // 2. Render Metrics Summary Bar
  const phases = plan.phases || [];
  const suites = project.testSuites || [];

  let totalCases = 0;
  let critCount = 0;
  let highCount = 0;
  let medCount = 0;
  let lowCount = 0;

  suites.forEach((s) => {
    const cases = Array.isArray(s.cases) ? s.cases : [];
    totalCases += cases.length;
    cases.forEach((c) => {
      const p = (c.priority || 'Medium').toLowerCase();
      if (p === 'critical') critCount++;
      else if (p === 'high') highCount++;
      else if (p === 'medium') medCount++;
      else if (p === 'low') lowCount++;
    });
  });

  const statPhases = document.getElementById('plan-stat-phases');
  const statSuites = document.getElementById('plan-stat-suites');
  const statCases = document.getElementById('plan-stat-cases');
  const statCrit = document.getElementById('plan-stat-crit');
  const statHigh = document.getElementById('plan-stat-high');
  const statMed = document.getElementById('plan-stat-med');
  const statLow = document.getElementById('plan-stat-low');
  const counterBadge = document.getElementById('phases-counter-badge');

  if (statPhases) statPhases.textContent = String(phases.length);
  if (statSuites) statSuites.textContent = String(suites.length);
  if (statCases) statCases.textContent = String(totalCases);
  if (statCrit) statCrit.textContent = String(critCount);
  if (statHigh) statHigh.textContent = String(highCount);
  if (statMed) statMed.textContent = String(medCount);
  if (statLow) statLow.textContent = String(lowCount);
  if (counterBadge) counterBadge.textContent = `${phases.length} phase${phases.length === 1 ? '' : 's'}`;

  // 3. Render Dynamic Phases & Suites Container
  renderPhasesContainer(project);
}

/**
 * Renders all Phase cards and nested Suite cards inside #phases-container.
 */
function renderPhasesContainer(project) {
  const container = document.getElementById('phases-container');
  if (!container) return;

  const phases = Array.isArray(project.testPlan?.phases) ? [...project.testPlan.phases] : [];
  phases.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

  if (phases.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 48px 16px; border: 1px dashed var(--border-subtle); border-radius: var(--radius-md);">
        <div class="empty-state-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
            <polyline points="2 17 12 22 22 17"></polyline>
            <polyline points="2 12 12 17 22 12"></polyline>
          </svg>
        </div>
        <h3 class="empty-state-title">No Testing Phases Defined</h3>
        <p class="empty-state-desc">Structure your test coverage by adding testing phases (e.g. Smoke Testing, Core Functional, Regression, Release Gate).</p>
        <button type="button" class="btn btn-primary btn-sm btn-empty-add-phase" style="margin-top: 6px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Add First Phase</span>
        </button>
      </div>`;
    return;
  }

  const allSuites = Array.isArray(project.testSuites) ? project.testSuites : [];

  container.innerHTML = phases
    .map((phase, idx) => {
      const phaseSuites = allSuites.filter((s) => s.phaseId === phase.id);
      let phaseCasesCount = 0;
      phaseSuites.forEach((s) => {
        phaseCasesCount += Array.isArray(s.cases) ? s.cases.length : 0;
      });

      const suitesHtml =
        phaseSuites.length === 0
          ? `
            <div class="empty-state" style="grid-column: 1 / -1; padding: 24px 12px; background: transparent; border: 1px dashed var(--border-subtle);">
              <p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 8px;">No test suites in this phase yet.</p>
              <button type="button" class="btn btn-secondary btn-xs btn-phase-add-suite" data-phase-id="${escapeHtml(phase.id)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                <span>Create First Suite</span>
              </button>
            </div>`
          : phaseSuites
              .map((suite) => {
                const caseCount = Array.isArray(suite.cases) ? suite.cases.length : 0;
                const tags = Array.isArray(suite.tags) ? suite.tags : [];
                const tagsHtml = tags
                  .slice(0, 3)
                  .map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`)
                  .join('');

                return `
                  <div class="suite-card" data-suite-id="${escapeHtml(suite.id)}" role="button" tabindex="0">
                    <div class="suite-card-top">
                      <div style="flex: 1; min-width: 0;">
                        <span class="project-badge badge-web" style="font-size:0.68rem; margin-bottom: 4px; display: inline-block;">${escapeHtml(suite.category || 'Functional')}</span>
                        <h5 class="suite-card-title" data-suite-id="${escapeHtml(suite.id)}">${escapeHtml(suite.name)}</h5>
                      </div>
                      <span class="phase-counter-pill" style="font-size: 0.7rem; flex-shrink: 0;">${caseCount} case${caseCount === 1 ? '' : 's'}</span>
                    </div>
                    <p class="suite-card-desc">${escapeHtml(suite.description || 'No description provided')}</p>
                    <div class="suite-card-meta">
                      <div class="tags-group">
                        ${tagsHtml}
                      </div>
                      <div class="suite-card-actions" style="display:flex; gap:4px; align-items: center;">
                        <button type="button" class="btn btn-secondary btn-xs btn-suite-open" data-suite-id="${escapeHtml(suite.id)}">
                          <span>Open</span>
                        </button>
                        <button type="button" class="btn btn-ghost btn-xs btn-suite-edit" data-suite-id="${escapeHtml(suite.id)}" title="Edit Suite">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                          </svg>
                        </button>
                        <button type="button" class="btn btn-ghost btn-xs btn-suite-delete btn-danger-outline" data-suite-id="${escapeHtml(suite.id)}" title="Delete Suite">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>`;
              })
              .join('');

      return `
        <div class="phase-card" data-phase-id="${escapeHtml(phase.id)}">
          <div class="phase-header">
            <div class="phase-header-left">
              <span class="phase-order-badge">${idx + 1}</span>
              <div class="phase-title-group">
                <h4 class="phase-title">${escapeHtml(phase.name)}</h4>
                <span class="phase-desc">${escapeHtml(phase.description || 'No phase description')}</span>
              </div>
            </div>
            <div class="phase-header-right">
              <span class="phase-counter-pill">${phaseSuites.length} suites · ${phaseCasesCount} cases</span>
              <button type="button" class="btn btn-secondary btn-xs btn-phase-add-suite" data-phase-id="${escapeHtml(phase.id)}" title="Add suite to this phase">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                <span>Add Suite</span>
              </button>
              <button type="button" class="btn btn-ghost btn-xs btn-phase-edit" data-phase-id="${escapeHtml(phase.id)}" title="Edit Phase">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
              <button type="button" class="btn btn-ghost btn-xs btn-phase-delete btn-danger-outline" data-phase-id="${escapeHtml(phase.id)}" title="Delete Phase">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>
          <div class="phase-body">
            <div class="suites-grid">
              ${suitesHtml}
            </div>
          </div>
        </div>`;
    })
    .join('');
}

/* ==========================================================================
   2. SUITE TEST CASES EXPLORER (SUB-VIEW B)
   ========================================================================== */

export function openSuiteExplorer(suiteId) {
  _activeSuiteId = suiteId;
  const phasesSubview = document.getElementById('plans-phases-subview');
  const casesSubview = document.getElementById('plans-cases-subview');
  if (phasesSubview) phasesSubview.style.display = 'none';
  if (casesSubview) casesSubview.style.display = 'block';

  // Reset search and filters
  const searchInput = document.getElementById('case-search-input');
  const prioritySelect = document.getElementById('case-filter-priority');
  const categorySelect = document.getElementById('case-filter-category');
  const sortSelect = document.getElementById('case-sort-by');
  if (searchInput) searchInput.value = '';
  if (prioritySelect) prioritySelect.value = 'ALL';
  if (categorySelect) categorySelect.value = 'ALL';
  if (sortSelect) sortSelect.value = 'newest';

  renderSuiteExplorer(suiteId);
}

export function closeSuiteExplorer() {
  _activeSuiteId = null;
  const phasesSubview = document.getElementById('plans-phases-subview');
  const casesSubview = document.getElementById('plans-cases-subview');
  if (casesSubview) casesSubview.style.display = 'none';
  if (phasesSubview) phasesSubview.style.display = 'block';
  renderTestPlanWorkspace();
}

export function renderSuiteExplorer(suiteId) {
  if (typeof document === 'undefined') return;

  const project = ensureProjectTestPlan(getActiveProject());
  if (!project) return;

  const suite = project.testSuites?.find((s) => s.id === suiteId);
  if (!suite) {
    closeSuiteExplorer();
    return;
  }

  const phase = project.testPlan?.phases?.find((p) => p.id === suite.phaseId);

  // 1. Breadcrumbs
  const crumbPhase = document.getElementById('cases-crumb-phase');
  const crumbSuite = document.getElementById('cases-crumb-suite');
  if (crumbPhase) crumbPhase.textContent = phase ? phase.name : 'Phase';
  if (crumbSuite) crumbSuite.textContent = suite.name;

  // 2. Header Card
  const titleEl = document.getElementById('suite-view-title');
  const catEl = document.getElementById('suite-view-category');
  const tagsEl = document.getElementById('suite-view-tags');
  const descEl = document.getElementById('suite-view-desc');

  if (titleEl) titleEl.textContent = suite.name;
  if (catEl) catEl.textContent = suite.category || 'Functional';
  if (descEl) descEl.textContent = suite.description || 'No description provided.';
  if (tagsEl) {
    const tags = Array.isArray(suite.tags) ? suite.tags : [];
    tagsEl.innerHTML = tags.map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('');
  }

  // 3. Category Filter options
  const catSelect = document.getElementById('case-filter-category');
  if (catSelect) {
    const cases = Array.isArray(suite.cases) ? suite.cases : [];
    const uniqueCats = Array.from(new Set(cases.map((c) => c.category).filter(Boolean)));
    const currentVal = catSelect.value || 'ALL';
    catSelect.innerHTML =
      '<option value="ALL">All Categories</option>' +
      uniqueCats.map((c) => `<option value="${escapeHtml(c)}" ${c === currentVal ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
  }

  // 4. Render Table
  renderTestCasesTable(suite);
}

export function renderTestCasesTable(suiteParam = null) {
  if (typeof document === 'undefined') return;

  const project = ensureProjectTestPlan(getActiveProject());
  if (!project) return;

  const suiteId = _activeSuiteId;
  const suite = suiteParam || project.testSuites?.find((s) => s.id === suiteId);
  if (!suite) return;

  const allCases = Array.isArray(suite.cases) ? suite.cases : [];

  const searchInput = document.getElementById('case-search-input');
  const prioritySelect = document.getElementById('case-filter-priority');
  const categorySelect = document.getElementById('case-filter-category');
  const sortSelect = document.getElementById('case-sort-by');
  const clearSearchBtn = document.getElementById('case-search-clear-btn');
  const clearFiltersBtn = document.getElementById('case-clear-filters-btn');
  const metaCountEl = document.getElementById('cases-meta-count');
  const container = document.getElementById('cases-table-container');

  const query = searchInput?.value?.trim().toLowerCase() || '';
  const priorityFilter = prioritySelect?.value || 'ALL';
  const categoryFilter = categorySelect?.value || 'ALL';
  const sortBy = sortSelect?.value || 'newest';

  if (clearSearchBtn) {
    clearSearchBtn.style.display = query ? 'flex' : 'none';
  }

  const isFiltered = query || priorityFilter !== 'ALL' || categoryFilter !== 'ALL';
  if (clearFiltersBtn) {
    clearFiltersBtn.style.display = isFiltered ? 'inline-flex' : 'none';
  }

  let filtered = allCases.filter((c) => {
    if (priorityFilter !== 'ALL' && (c.priority || 'Medium') !== priorityFilter) {
      return false;
    }
    if (categoryFilter !== 'ALL' && (c.category || '') !== categoryFilter) {
      return false;
    }
    if (query) {
      const title = (c.title || '').toLowerCase();
      const caseCode = (c.testCaseId || c.id || '').toLowerCase();
      const desc = (c.description || '').toLowerCase();
      const tags = (Array.isArray(c.tags) ? c.tags.join(' ') : '').toLowerCase();
      if (!title.includes(query) && !caseCode.includes(query) && !desc.includes(query) && !tags.includes(query)) {
        return false;
      }
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (sortBy === 'newest') {
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    }
    if (sortBy === 'oldest') {
      return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    }
    if (sortBy === 'title-asc') {
      return (a.title || '').localeCompare(b.title || '');
    }
    if (sortBy === 'priority-desc') {
      const rank = { Critical: 4, High: 3, Medium: 2, Low: 1 };
      return (rank[b.priority] || 0) - (rank[a.priority] || 0);
    }
    return 0;
  });

  if (metaCountEl) {
    metaCountEl.textContent =
      filtered.length === allCases.length
        ? `Showing ${allCases.length} test case${allCases.length === 1 ? '' : 's'}`
        : `Showing ${filtered.length} of ${allCases.length} test cases`;
  }

  if (!container) return;

  if (allCases.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 48px 16px;">
        <div class="empty-state-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 11 12 14 22 4"></polyline>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
          </svg>
        </div>
        <h3 class="empty-state-title">No Test Cases Yet</h3>
        <p class="empty-state-desc">This suite does not contain any test cases yet. Click "Add Test Case" to document manual test steps.</p>
        <button type="button" class="btn btn-primary btn-sm btn-empty-add-case" style="margin-top: 8px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Add First Test Case</span>
        </button>
      </div>`;
    return;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 36px 16px;">
        <h3 class="empty-state-title">No Matching Test Cases</h3>
        <p class="empty-state-desc">No test cases match your search or filter criteria.</p>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-reset-case-filters" style="margin-top: 6px;">
          <span>Reset Filters</span>
        </button>
      </div>`;
    return;
  }

  const rowsHtml = filtered
    .map((tc) => {
      const pClass = `p-${(tc.priority || 'medium').toLowerCase()}`;
      const statusClass = `status-${(tc.status || 'not run').toLowerCase().replace(/\s+/g, '-')}`;
      const stepsCount = Array.isArray(tc.steps) ? tc.steps.length : 0;
      const displayId = tc.testCaseId || tc.id;

      return `
        <tr data-case-id="${escapeHtml(tc.id)}">
          <td>
            <span class="case-id-tag" data-action="view-case" data-case-id="${escapeHtml(tc.id)}" role="button" tabindex="0" title="Click to inspect test case">${escapeHtml(displayId)}</span>
          </td>
          <td>
            <span class="case-title-cell" data-action="view-case" data-case-id="${escapeHtml(tc.id)}" role="button" tabindex="0">${escapeHtml(tc.title)}</span>
          </td>
          <td>
            <span class="priority-badge ${pClass}">${escapeHtml(tc.priority || 'Medium')}</span>
          </td>
          <td>
            <span class="project-badge badge-web" style="font-size: 0.72rem;">${escapeHtml(tc.category || 'Functional')}</span>
          </td>
          <td>
            <span style="font-size: 0.78rem; color: var(--text-muted);">${stepsCount} step${stepsCount === 1 ? '' : 's'}</span>
          </td>
          <td>
            <span class="status-badge ${statusClass}">${escapeHtml(tc.status || 'Not Run')}</span>
          </td>
          <td style="text-align: right;">
            <div class="case-actions-cell" style="justify-content: flex-end;">
              <button type="button" class="btn btn-ghost btn-xs btn-case-view" data-action="view-case" data-case-id="${escapeHtml(tc.id)}" title="Inspect Case">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
              <button type="button" class="btn btn-ghost btn-xs btn-case-edit" data-action="edit-case" data-case-id="${escapeHtml(tc.id)}" title="Edit Case">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
              <button type="button" class="btn btn-ghost btn-xs btn-case-duplicate" data-action="duplicate-case" data-case-id="${escapeHtml(tc.id)}" title="Duplicate Case">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
              <button type="button" class="btn btn-ghost btn-xs btn-case-delete btn-danger-outline" data-action="delete-case" data-case-id="${escapeHtml(tc.id)}" title="Delete Case">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </td>
        </tr>`;
    })
    .join('');

  container.innerHTML = `
    <table class="cases-table">
      <thead>
        <tr>
          <th style="width: 100px;">Case ID</th>
          <th>Title</th>
          <th style="width: 110px;">Priority</th>
          <th style="width: 120px;">Category</th>
          <th style="width: 80px;">Steps</th>
          <th style="width: 100px;">Status</th>
          <th style="width: 140px; text-align: right;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>`;
}

/* ==========================================================================
   3. TEST PLAN CRUD
   ========================================================================== */

export async function saveTestPlan(testPlanData) {
  const project = ensureProjectTestPlan(getActiveProject());
  if (!project) return { ok: false, error: 'No active project selected.' };

  const currentPlan = project.testPlan || {};
  const updatedPlan = {
    ...currentPlan,
    ...testPlanData,
    updatedAt: new Date().toISOString()
  };

  return saveProjectData(project.id, { testPlan: updatedPlan });
}

export function openTestPlanModal() {
  if (typeof document === 'undefined') return;
  const project = ensureProjectTestPlan(getActiveProject());
  if (!project) return;

  const modal = document.getElementById('testplan-modal');
  const nameInput = document.getElementById('plan-name-input');
  const objInput = document.getElementById('plan-objective-input');
  const scopeInput = document.getElementById('plan-scope-input');
  const descInput = document.getElementById('plan-desc-input');

  const plan = project.testPlan || {};
  if (nameInput) nameInput.value = plan.name || `${project.name} Master Test Plan`;
  if (objInput) objInput.value = plan.objective || '';
  if (scopeInput) scopeInput.value = plan.scope || '';
  if (descInput) descInput.value = plan.description || '';

  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
}

export function closeTestPlanModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('testplan-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}

/* ==========================================================================
   4. PHASES CRUD & MODAL
   ========================================================================== */

export async function addPhase(phaseData) {
  const project = ensureProjectTestPlan(getActiveProject());
  if (!project) return { ok: false, error: 'No active project selected.' };

  const phases = Array.isArray(project.testPlan.phases) ? [...project.testPlan.phases] : [];
  const now = new Date().toISOString();
  const newPhase = {
    id: 'ph_' + generateStableId('p'),
    name: phaseData.name?.trim() || 'New Testing Phase',
    description: phaseData.description?.trim() || '',
    order: phases.length + 1,
    status: 'Active',
    createdAt: now,
    updatedAt: now
  };
  phases.push(newPhase);

  const updatedPlan = {
    ...project.testPlan,
    phases,
    updatedAt: now
  };

  return saveProjectData(project.id, { testPlan: updatedPlan });
}

export async function updatePhase(phaseId, phaseData) {
  const project = ensureProjectTestPlan(getActiveProject());
  if (!project) return { ok: false, error: 'No active project selected.' };

  const phases = Array.isArray(project.testPlan.phases) ? [...project.testPlan.phases] : [];
  const idx = phases.findIndex((p) => p.id === phaseId);
  if (idx < 0) return { ok: false, error: 'Phase not found.' };

  const now = new Date().toISOString();
  phases[idx] = {
    ...phases[idx],
    name: phaseData.name !== undefined ? phaseData.name.trim() : phases[idx].name,
    description: phaseData.description !== undefined ? phaseData.description.trim() : phases[idx].description,
    updatedAt: now
  };

  const updatedPlan = {
    ...project.testPlan,
    phases,
    updatedAt: now
  };

  return saveProjectData(project.id, { testPlan: updatedPlan });
}

export async function deletePhase(phaseId) {
  const project = ensureProjectTestPlan(getActiveProject());
  if (!project) return { ok: false, error: 'No active project selected.' };

  const phases = (project.testPlan.phases || []).filter((p) => p.id !== phaseId);
  // Also clean up or reassign suites associated with this phase
  const suites = (project.testSuites || []).filter((s) => s.phaseId !== phaseId);

  const updatedPlan = {
    ...project.testPlan,
    phases,
    updatedAt: new Date().toISOString()
  };

  return saveProjectData(project.id, { testPlan: updatedPlan, testSuites: suites });
}

export function openPhaseModal(phaseToEdit = null) {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('phase-modal');
  const titleEl = document.getElementById('phase-modal-title');
  const submitTextEl = document.getElementById('phase-modal-submit-text');
  const idInput = document.getElementById('phase-id-input');
  const nameInput = document.getElementById('phase-name-input');
  const descInput = document.getElementById('phase-desc-input');
  const errAlert = document.getElementById('phase-error-alert');

  if (errAlert) errAlert.style.display = 'none';

  if (phaseToEdit) {
    if (titleEl) titleEl.textContent = 'Edit Testing Phase';
    if (submitTextEl) submitTextEl.textContent = 'Save Changes';
    if (idInput) idInput.value = phaseToEdit.id || '';
    if (nameInput) nameInput.value = phaseToEdit.name || '';
    if (descInput) descInput.value = phaseToEdit.description || '';
  } else {
    if (titleEl) titleEl.textContent = 'Add Testing Phase';
    if (submitTextEl) submitTextEl.textContent = 'Add Phase';
    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
  }

  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
}

export function closePhaseModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('phase-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}

/* ==========================================================================
   5. TEST SUITES CRUD & MODAL
   ========================================================================== */

export async function saveTestSuite(suiteData) {
  const project = ensureProjectTestPlan(getActiveProject());
  if (!project) return { ok: false, error: 'No active project selected.' };

  const suites = Array.isArray(project.testSuites) ? [...project.testSuites] : [];
  const now = new Date().toISOString();
  const existingIdx = suites.findIndex((s) => s.id === suiteData.id);

  if (existingIdx >= 0) {
    suites[existingIdx] = {
      ...suites[existingIdx],
      ...suiteData,
      updatedAt: now
    };
  } else {
    suites.push({
      id: suiteData.id || ('ts_' + generateStableId('s')),
      phaseId: suiteData.phaseId,
      name: suiteData.name?.trim() || 'New Test Suite',
      category: suiteData.category || 'Functional',
      tags: Array.isArray(suiteData.tags) ? suiteData.tags : [],
      description: suiteData.description?.trim() || '',
      cases: [],
      createdAt: now,
      updatedAt: now
    });
  }

  return saveProjectData(project.id, { testSuites: suites });
}

export async function deleteTestSuite(suiteId) {
  const project = ensureProjectTestPlan(getActiveProject());
  if (!project) return { ok: false, error: 'No active project selected.' };

  const suites = (project.testSuites || []).filter((s) => s.id !== suiteId);
  return saveProjectData(project.id, { testSuites: suites });
}

export function openSuiteModal(suiteToEdit = null, defaultPhaseId = null) {
  if (typeof document === 'undefined') return;
  const project = ensureProjectTestPlan(getActiveProject());
  if (!project) return;

  const modal = document.getElementById('suite-modal');
  const titleEl = document.getElementById('suite-modal-title');
  const submitTextEl = document.getElementById('suite-modal-submit-text');
  const idInput = document.getElementById('suite-id-input');
  const phaseSelect = document.getElementById('suite-phase-select');
  const nameInput = document.getElementById('suite-name-input');
  const catSelect = document.getElementById('suite-category-select');
  const customCatGroup = document.getElementById('suite-custom-cat-group');
  const customCatInput = document.getElementById('suite-custom-cat-input');
  const tagsInput = document.getElementById('suite-tags-input');
  const descInput = document.getElementById('suite-desc-input');
  const errAlert = document.getElementById('suite-error-alert');

  if (errAlert) errAlert.style.display = 'none';

  // Populate phase select
  const phases = project.testPlan?.phases || [];
  if (phaseSelect) {
    if (phases.length === 0) {
      phaseSelect.innerHTML = '<option value="" disabled selected>No phases available — add a phase first</option>';
    } else {
      phaseSelect.innerHTML = phases
        .map((ph) => `<option value="${escapeHtml(ph.id)}">${escapeHtml(ph.name)}</option>`)
        .join('');
    }
  }

  const standardCategories = [
    'Functional',
    'UI/UX',
    'Security',
    'Performance',
    'Compatibility',
    'Integration',
    'Regression',
    'Accessibility'
  ];

  if (suiteToEdit) {
    if (titleEl) titleEl.textContent = 'Edit Test Suite';
    if (submitTextEl) submitTextEl.textContent = 'Save Changes';
    if (idInput) idInput.value = suiteToEdit.id || '';
    if (phaseSelect) phaseSelect.value = suiteToEdit.phaseId || (phases[0]?.id || '');
    if (nameInput) nameInput.value = suiteToEdit.name || '';
    if (descInput) descInput.value = suiteToEdit.description || '';
    if (tagsInput) tagsInput.value = Array.isArray(suiteToEdit.tags) ? suiteToEdit.tags.join(', ') : '';

    const cat = suiteToEdit.category || 'Functional';
    if (standardCategories.includes(cat)) {
      if (catSelect) catSelect.value = cat;
      if (customCatGroup) customCatGroup.style.display = 'none';
      if (customCatInput) customCatInput.value = '';
    } else {
      if (catSelect) catSelect.value = 'CUSTOM';
      if (customCatGroup) customCatGroup.style.display = 'block';
      if (customCatInput) customCatInput.value = cat;
    }
  } else {
    if (titleEl) titleEl.textContent = 'Add Test Suite';
    if (submitTextEl) submitTextEl.textContent = 'Add Test Suite';
    if (idInput) idInput.value = '';
    if (phaseSelect) phaseSelect.value = defaultPhaseId || (phases[0]?.id || '');
    if (nameInput) nameInput.value = '';
    if (catSelect) catSelect.value = 'Functional';
    if (customCatGroup) customCatGroup.style.display = 'none';
    if (customCatInput) customCatInput.value = '';
    if (tagsInput) tagsInput.value = '';
    if (descInput) descInput.value = '';
  }

  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
}

export function closeSuiteModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('suite-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}

/* ==========================================================================
   6. TEST CASES CRUD & MODAL
   ========================================================================== */

/**
 * Derives a human-friendly consecutive case code (e.g. TC-001) for a new test case.
 */
function deriveNextCaseCode(project) {
  let count = 0;
  if (Array.isArray(project.testSuites)) {
    project.testSuites.forEach((s) => {
      if (Array.isArray(s.cases)) count += s.cases.length;
    });
  }
  return `TC-${String(count + 1).padStart(3, '0')}`;
}

export async function saveTestCase(suiteId, testCaseData) {
  const project = ensureProjectTestPlan(getActiveProject());
  if (!project) return { ok: false, error: 'No active project selected.' };

  const suites = Array.isArray(project.testSuites) ? [...project.testSuites] : [];
  const suiteIdx = suites.findIndex((s) => s.id === suiteId);
  if (suiteIdx < 0) return { ok: false, error: 'Test suite not found.' };

  const now = new Date().toISOString();
  const cases = Array.isArray(suites[suiteIdx].cases) ? [...suites[suiteIdx].cases] : [];
  const caseIdx = cases.findIndex((c) => c.id === testCaseData.id);

  if (caseIdx >= 0) {
    cases[caseIdx] = {
      ...cases[caseIdx],
      ...testCaseData,
      updatedAt: now
    };
  } else {
    cases.push({
      id: testCaseData.id || ('tc_' + generateStableId('c')),
      testCaseId: testCaseData.testCaseId || deriveNextCaseCode(project),
      suiteId,
      status: testCaseData.status || 'Not Run',
      createdAt: now,
      updatedAt: now,
      ...testCaseData
    });
  }

  suites[suiteIdx] = { ...suites[suiteIdx], cases, updatedAt: now };
  return saveProjectData(project.id, { testSuites: suites });
}

export async function deleteTestCase(suiteId, caseId) {
  const project = ensureProjectTestPlan(getActiveProject());
  if (!project) return { ok: false, error: 'No active project selected.' };

  const suites = Array.isArray(project.testSuites) ? [...project.testSuites] : [];
  const suiteIdx = suites.findIndex((s) => s.id === suiteId);
  if (suiteIdx < 0) return { ok: false, error: 'Test suite not found.' };

  const cases = (suites[suiteIdx].cases || []).filter((c) => c.id !== caseId);
  suites[suiteIdx] = { ...suites[suiteIdx], cases, updatedAt: new Date().toISOString() };

  return saveProjectData(project.id, { testSuites: suites });
}

export async function duplicateTestCase(suiteId, caseId) {
  const project = ensureProjectTestPlan(getActiveProject());
  if (!project) return { ok: false, error: 'No active project selected.' };

  const suites = Array.isArray(project.testSuites) ? [...project.testSuites] : [];
  const suiteIdx = suites.findIndex((s) => s.id === suiteId);
  if (suiteIdx < 0) return { ok: false, error: 'Test suite not found.' };

  const cases = Array.isArray(suites[suiteIdx].cases) ? [...suites[suiteIdx].cases] : [];
  const source = cases.find((c) => c.id === caseId);
  if (!source) return { ok: false, error: 'Test case not found.' };

  const now = new Date().toISOString();
  const copy = {
    ...source,
    id: 'tc_' + generateStableId('c'),
    testCaseId: deriveNextCaseCode(project),
    title: `${source.title || 'Test Case'} (Copy)`,
    status: 'Not Run',
    createdAt: now,
    updatedAt: now
  };
  cases.push(copy);
  suites[suiteIdx] = { ...suites[suiteIdx], cases, updatedAt: now };

  return saveProjectData(project.id, { testSuites: suites });
}

/* ==========================================================================
   7. DYNAMIC STEPS BUILDER
   ========================================================================== */

function createStepRowHtml(index, action = '', testData = '') {
  return `
    <div class="step-row" data-step-index="${index}">
      <span class="step-num-bubble">${index + 1}</span>
      <div class="step-inputs-group">
        <input
          type="text"
          class="form-control step-action-input"
          placeholder="Action instruction (e.g. Click Login button, Enter email...)"
          value="${escapeHtml(action)}"
          required
        />
        <input
          type="text"
          class="form-control step-data-input"
          placeholder="Test data (optional, e.g. valid credentials, test@example.com)"
          value="${escapeHtml(testData)}"
        />
      </div>
      <div class="step-actions-group">
        <button type="button" class="btn btn-ghost btn-xs step-tool-btn step-btn-up" title="Move step up">▲</button>
        <button type="button" class="btn btn-ghost btn-xs step-tool-btn step-btn-down" title="Move step down">▼</button>
        <button type="button" class="btn btn-ghost btn-xs step-tool-btn step-btn-remove" title="Remove step">✕</button>
      </div>
    </div>`;
}

export function renumberStepRows() {
  if (typeof document === 'undefined') return;
  const list = document.getElementById('tc-steps-list');
  if (!list) return;

  const rows = list.querySelectorAll('.step-row');
  rows.forEach((row, i) => {
    row.setAttribute('data-step-index', String(i));
    const bubble = row.querySelector('.step-num-bubble');
    if (bubble) bubble.textContent = String(i + 1);
  });
}

export function addStepRow(action = '', testData = '') {
  if (typeof document === 'undefined') return;
  const list = document.getElementById('tc-steps-list');
  if (!list) return;

  const index = list.querySelectorAll('.step-row').length;
  const div = document.createElement('div');
  div.innerHTML = createStepRowHtml(index, action, testData).trim();
  const stepRow = div.firstElementChild;
  if (stepRow) list.appendChild(stepRow);
  renumberStepRows();
}

export function collectStepsFromBuilder() {
  if (typeof document === 'undefined') return [];
  const list = document.getElementById('tc-steps-list');
  if (!list) return [];

  const rows = list.querySelectorAll('.step-row');
  const steps = [];
  rows.forEach((row, i) => {
    const actionInput = row.querySelector('.step-action-input');
    const dataInput = row.querySelector('.step-data-input');
    const action = actionInput ? actionInput.value.trim() : '';
    const testData = dataInput ? dataInput.value.trim() : '';
    if (action || testData) {
      steps.push({
        stepNumber: i + 1,
        action: action || `Step ${i + 1}`,
        testData
      });
    }
  });
  return steps;
}

export function openTestCaseModal(caseToEdit = null, suiteId = null) {
  if (typeof document === 'undefined') return;
  const targetSuiteId = suiteId || _activeSuiteId;
  if (!targetSuiteId) return;

  const modal = document.getElementById('testcase-modal');
  const titleEl = document.getElementById('case-modal-title');
  const submitTextEl = document.getElementById('case-modal-submit-text');
  const idInput = document.getElementById('case-id-input');
  const suiteIdInput = document.getElementById('case-suite-id-input');
  const caseTitleInput = document.getElementById('case-title-input');
  const prioritySelect = document.getElementById('case-priority-select');
  const categoryInput = document.getElementById('case-category-input');
  const tagsInput = document.getElementById('case-tags-input');
  const descInput = document.getElementById('case-desc-input');
  const precondInput = document.getElementById('case-preconditions-input');
  const expectedInput = document.getElementById('case-expected-input');
  const stepsList = document.getElementById('tc-steps-list');
  const errAlert = document.getElementById('case-error-alert');

  if (errAlert) errAlert.style.display = 'none';
  if (suiteIdInput) suiteIdInput.value = targetSuiteId;
  if (stepsList) stepsList.innerHTML = '';

  if (caseToEdit) {
    if (titleEl) titleEl.textContent = 'Edit Test Case';
    if (submitTextEl) submitTextEl.textContent = 'Save Changes';
    if (idInput) idInput.value = caseToEdit.id || '';
    if (caseTitleInput) caseTitleInput.value = caseToEdit.title || '';
    if (prioritySelect) prioritySelect.value = caseToEdit.priority || 'High';
    if (categoryInput) categoryInput.value = caseToEdit.category || 'Functional';
    if (tagsInput) tagsInput.value = Array.isArray(caseToEdit.tags) ? caseToEdit.tags.join(', ') : '';
    if (descInput) descInput.value = caseToEdit.description || '';
    if (precondInput) precondInput.value = caseToEdit.preconditions || '';
    if (expectedInput) expectedInput.value = caseToEdit.expectedResult || '';

    const steps = Array.isArray(caseToEdit.steps) ? caseToEdit.steps : [];
    if (steps.length > 0) {
      steps.forEach((s) => {
        const action = typeof s === 'string' ? s : s.action || '';
        const testData = typeof s === 'string' ? '' : s.testData || '';
        addStepRow(action, testData);
      });
    } else {
      addStepRow('', '');
    }
  } else {
    if (titleEl) titleEl.textContent = 'Create Test Case';
    if (submitTextEl) submitTextEl.textContent = 'Save Test Case';
    if (idInput) idInput.value = '';
    if (caseTitleInput) caseTitleInput.value = '';
    if (prioritySelect) prioritySelect.value = 'High';
    if (categoryInput) categoryInput.value = 'Functional';
    if (tagsInput) tagsInput.value = '';
    if (descInput) descInput.value = '';
    if (precondInput) precondInput.value = '';
    if (expectedInput) expectedInput.value = '';

    addStepRow('', '');
  }

  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
}

export function closeTestCaseModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('testcase-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}

/* ==========================================================================
   8. TEST CASE INSPECTION MODAL (#testcase-view-modal)
   ========================================================================== */

export function openTestCaseViewModal(testCase, suite) {
  if (typeof document === 'undefined' || !testCase) return;
  _currentViewingCase = testCase;
  _currentViewingSuite = suite;

  const modal = document.getElementById('testcase-view-modal');
  const idEl = document.getElementById('view-case-id');
  const titleEl = document.getElementById('view-case-title');
  const priorityEl = document.getElementById('view-case-priority');
  const catEl = document.getElementById('view-case-category');
  const tagsEl = document.getElementById('view-case-tags');
  const descEl = document.getElementById('view-case-desc');
  const precondEl = document.getElementById('view-case-preconditions');
  const stepsContainer = document.getElementById('view-case-steps-container');
  const expectedEl = document.getElementById('view-case-expected');
  const createdEl = document.getElementById('view-case-created');
  const updatedEl = document.getElementById('view-case-updated');

  const p = testCase.priority || 'Medium';
  if (idEl) idEl.textContent = testCase.testCaseId || testCase.id;
  if (titleEl) titleEl.textContent = testCase.title || 'Untitled Test Case';

  if (priorityEl) {
    priorityEl.textContent = p;
    priorityEl.className = `priority-badge p-${p.toLowerCase()}`;
  }

  if (catEl) catEl.textContent = testCase.category || 'Functional';

  if (tagsEl) {
    const tags = Array.isArray(testCase.tags) ? testCase.tags : [];
    tagsEl.innerHTML = tags.map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('');
  }

  if (descEl) descEl.textContent = testCase.description || 'No description provided.';
  if (precondEl) precondEl.textContent = testCase.preconditions || 'No preconditions specified.';

  if (stepsContainer) {
    const steps = Array.isArray(testCase.steps) ? testCase.steps : [];
    if (steps.length === 0) {
      stepsContainer.innerHTML = '<p class="case-detail-text" style="color: var(--text-muted); font-style: italic;">No test steps documented for this case.</p>';
    } else {
      stepsContainer.innerHTML = `
        <table class="cases-table view-steps-table" style="font-size: 0.8rem; margin-top: 4px;">
          <thead>
            <tr>
              <th style="width: 45px;">#</th>
              <th>Action Instruction</th>
              <th style="width: 180px;">Test Data</th>
            </tr>
          </thead>
          <tbody>
            ${steps
              .map((s, idx) => {
                const action = typeof s === 'string' ? s : s.action || `Step ${idx + 1}`;
                const testData = typeof s === 'string' ? '—' : s.testData || '—';
                const num = typeof s === 'object' && s.stepNumber ? s.stepNumber : idx + 1;
                return `
                  <tr>
                    <td style="font-weight: 700; color: var(--accent-primary);">${num}</td>
                    <td>${escapeHtml(action)}</td>
                    <td style="color: var(--text-secondary);">${escapeHtml(testData)}</td>
                  </tr>`;
              })
              .join('')}
          </tbody>
        </table>`;
    }
  }

  if (expectedEl) expectedEl.textContent = testCase.expectedResult || 'No expected result specified.';
  if (createdEl) createdEl.textContent = `Created ${formatDate(testCase.createdAt)}`;
  if (updatedEl) updatedEl.textContent = `Updated ${formatDate(testCase.updatedAt)}`;

  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
}

export function closeTestCaseViewModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('testcase-view-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}

/* ==========================================================================
   9. UNIVERSAL CONFIRMATION DIALOG FOR PHASES, SUITES & CASES
   ========================================================================== */

export function openDeleteConfirmModal({ type, target, warning, onConfirm }) {
  if (typeof document === 'undefined') return;

  setPendingDelete({ type, target, onConfirm });

  const modal = document.getElementById('delete-modal');
  const titleEl = document.getElementById('delete-dialog-title');
  const targetNameEl = document.getElementById('delete-project-name');
  const warningEl = document.getElementById('delete-warning-msg');

  if (titleEl) {
    if (type === 'phase') titleEl.textContent = 'Delete Testing Phase';
    else if (type === 'suite') titleEl.textContent = 'Delete Test Suite';
    else if (type === 'case') titleEl.textContent = 'Delete Test Case';
    else titleEl.textContent = 'Confirm Deletion';
  }

  if (targetNameEl) targetNameEl.textContent = target ? `"${target}"` : '';
  if (warningEl && warning) warningEl.textContent = warning;

  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
}
