/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Defect Management Module (Phase 5)
 */

import { generateStableId } from '../../qaChecklistStore.js';
import { getProjects, getActiveProject, setActiveProjectId, setPendingDelete } from './state.js';
import { saveProjectData, updateSidebarProjectCounters } from './projectManager.js';
import { escapeHtml, formatDate } from './utils.js';
import { showToast, navigateTo } from './uiRenderer.js';
import { renderDashboard } from './dashboardManager.js';

let _activeInspectingDefect = null;
let _activeInspectingProjectId = null;
let _isSubmittingDefect = false;
let _listenersBound = false;

// Filter state for defects workspace
const _filterState = {
  search: '',
  severity: 'ALL',
  priority: 'ALL',
  status: 'ALL',
  sort: 'newest',
  projectId: 'ALL'
};

export function getDefectFilterState() {
  return _filterState;
}

/**
 * Saves or updates a defect record in the specified project.
 */
export async function saveDefect(defectData, projectId = null) {
  const projects = getProjects();
  const targetId = projectId || defectData.projectId || (getActiveProject()?.id);
  const project = projects.find((p) => p.id === targetId);

  if (!project) return { ok: false, error: 'No active project selected.' };

  const defects = Array.isArray(project.defects) ? [...project.defects] : [];
  const idx = defects.findIndex((d) => d.id === defectData.id);

  const displayId =
    defectData.defectId ||
    (idx >= 0 && defects[idx].defectId
      ? defects[idx].defectId
      : `DEF-${String(defects.length + 1).padStart(3, '0')}`);

  const record = {
    id: defectData.id || generateStableId('def'),
    defectId: displayId,
    status: defectData.status || 'Open',
    severity: defectData.severity || 'High',
    priority: defectData.priority || 'High',
    updatedAt: new Date().toISOString(),
    ...defectData
  };

  let targetDefect = null;
  let opType = 'CREATE';

  if (idx >= 0) {
    opType = 'UPDATE';
    targetDefect = { ...defects[idx], ...record };
    defects[idx] = targetDefect;
  } else {
    record.createdAt = record.createdAt || new Date().toISOString();
    targetDefect = record;
    defects.unshift(record);
  }

  const res = await saveProjectData(
    project.id,
    { defects },
    undefined,
    {
      entityType: 'defect',
      entityId: targetDefect.id,
      operationType: opType,
      delta: { defect: targetDefect }
    }
  );
  return { ...res, defect: targetDefect };
}

/**
 * Updates quick status of a single defect and saves to MongoDB.
 */
export async function updateDefectQuickStatus(defectId, newStatus, projectId = null) {
  const projects = getProjects();
  let targetProject = null;
  let targetDefectIdx = -1;

  if (projectId) {
    targetProject = projects.find((p) => p.id === projectId);
    if (targetProject && Array.isArray(targetProject.defects)) {
      targetDefectIdx = targetProject.defects.findIndex((d) => d.id === defectId);
    }
  } else {
    for (const p of projects) {
      if (Array.isArray(p.defects)) {
        const idx = p.defects.findIndex((d) => d.id === defectId);
        if (idx >= 0) {
          targetProject = p;
          targetDefectIdx = idx;
          break;
        }
      }
    }
  }

  if (!targetProject || targetDefectIdx < 0) {
    return { ok: false, error: 'Defect not found.' };
  }

  const defects = [...targetProject.defects];
  const updatedDefect = {
    ...defects[targetDefectIdx],
    status: newStatus,
    updatedAt: new Date().toISOString()
  };
  defects[targetDefectIdx] = updatedDefect;

  const res = await saveProjectData(
    targetProject.id,
    { defects },
    undefined,
    {
      entityType: 'defect',
      entityId: defectId,
      operationType: 'STATUS_CHANGE',
      delta: { defect: updatedDefect }
    }
  );
  return { ...res, defect: updatedDefect };
}

/**
 * Deletes a defect from a project and saves to MongoDB.
 */
export async function deleteDefectById(defectId, projectId) {
  const projects = getProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project || !Array.isArray(project.defects)) {
    return { ok: false, error: 'Project or defect not found.' };
  }

  const defects = project.defects.filter((d) => d.id !== defectId);
  return saveProjectData(
    project.id,
    { defects },
    undefined,
    {
      entityType: 'defect',
      entityId: defectId,
      operationType: 'DELETE',
      delta: { id: defectId, defectId }
    }
  );
}

/**
 * Main render function for #view-defects workspace.
 */
export function renderDefectsWorkspace() {
  if (typeof document === 'undefined') return;

  const projects = getProjects();
  const projectSelect = document.getElementById('defects-project-select');

  // 1. Populate Project Selector
  if (projectSelect) {
    const optionsHtml = [
      '<option value="ALL">All Projects</option>',
      ...projects.map(
        (p) => `<option value="${escapeHtml(p.id)}" ${_filterState.projectId === p.id ? 'selected' : ''}>${escapeHtml(p.name || 'Untitled Project')}</option>`
      )
    ].join('');
    projectSelect.innerHTML = optionsHtml;
  }

  // 2. Gather Defects
  const allDefectsWithProject = [];
  projects.forEach((p) => {
    if (_filterState.projectId !== 'ALL' && p.id !== _filterState.projectId) return;
    if (Array.isArray(p.defects)) {
      p.defects.forEach((d) => {
        allDefectsWithProject.push({
          ...d,
          projectId: p.id,
          projectName: p.name || 'Untitled Project'
        });
      });
    }
  });

  // 3. Compute KPI Summary Cards
  let totalDefects = 0;
  let openDefects = 0;
  let inProgressDefects = 0;
  let resolvedDefects = 0;
  let criticalDefects = 0;

  allDefectsWithProject.forEach((d) => {
    totalDefects++;
    const st = (d.status || '').toLowerCase();
    const sev = (d.severity || '').toLowerCase();

    if (st === 'open' || st === 'reopened') openDefects++;
    else if (st === 'in progress') inProgressDefects++;
    else if (st === 'resolved' || st === 'closed') resolvedDefects++;

    if (sev === 'critical') criticalDefects++;
  });

  const statTotal = document.getElementById('defects-stat-total');
  const statOpen = document.getElementById('defects-stat-open');
  const statProgress = document.getElementById('defects-stat-progress');
  const statResolved = document.getElementById('defects-stat-resolved');
  const statCritical = document.getElementById('defects-stat-critical');

  if (statTotal) statTotal.textContent = String(totalDefects);
  if (statOpen) statOpen.textContent = String(openDefects);
  if (statProgress) statProgress.textContent = String(inProgressDefects);
  if (statResolved) statResolved.textContent = String(resolvedDefects);
  if (statCritical) statCritical.textContent = String(criticalDefects);

  // 4. Filter Defects
  const query = (_filterState.search || '').trim().toLowerCase();
  let filtered = allDefectsWithProject.filter((d) => {
    // Search query
    if (query) {
      const matchId = (d.defectId || d.id || '').toLowerCase().includes(query);
      const matchTitle = (d.title || '').toLowerCase().includes(query);
      const matchDesc = (d.description || '').toLowerCase().includes(query);
      const matchSteps = (d.steps || '').toLowerCase().includes(query);
      const matchCase = (d.linkedTestCaseId || d.linkedCaseTitle || '').toLowerCase().includes(query);
      if (!matchId && !matchTitle && !matchDesc && !matchSteps && !matchCase) return false;
    }

    // Severity filter
    if (_filterState.severity !== 'ALL') {
      if ((d.severity || 'Medium').toLowerCase() !== _filterState.severity.toLowerCase()) {
        return false;
      }
    }

    // Priority filter
    if (_filterState.priority !== 'ALL') {
      if ((d.priority || 'Medium').toLowerCase() !== _filterState.priority.toLowerCase()) {
        return false;
      }
    }

    // Status filter
    if (_filterState.status !== 'ALL') {
      if ((d.status || 'Open').toLowerCase() !== _filterState.status.toLowerCase()) {
        return false;
      }
    }

    return true;
  });

  // 5. Sort Defects
  const SEVERITY_WEIGHT = { Critical: 4, High: 3, Medium: 2, Low: 1 };
  filtered.sort((a, b) => {
    switch (_filterState.sort) {
      case 'oldest':
        return new Date(a.createdAt || a.updatedAt || 0).getTime() - new Date(b.createdAt || b.updatedAt || 0).getTime();
      case 'severity-desc':
        return (SEVERITY_WEIGHT[b.severity || 'Medium'] || 2) - (SEVERITY_WEIGHT[a.severity || 'Medium'] || 2);
      case 'id-desc':
        return (b.defectId || b.id || '').localeCompare(a.defectId || a.id || '');
      case 'title-asc':
        return (a.title || '').localeCompare(b.title || '');
      case 'newest':
      default:
        return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
    }
  });

  // 6. Meta Bar & Reset Filters visibility
  const metaCount = document.getElementById('defects-meta-count');
  if (metaCount) {
    metaCount.textContent = `Showing ${filtered.length} of ${allDefectsWithProject.length} defect${allDefectsWithProject.length === 1 ? '' : 's'}`;
  }

  const clearFiltersBtn = document.getElementById('defects-clear-filters-btn');
  const isFiltered = Boolean(_filterState.search) || _filterState.severity !== 'ALL' || _filterState.priority !== 'ALL' || _filterState.status !== 'ALL';
  if (clearFiltersBtn) {
    clearFiltersBtn.style.display = isFiltered ? 'inline-flex' : 'none';
  }

  const clearSearchBtn = document.getElementById('defects-search-clear-btn');
  if (clearSearchBtn) {
    clearSearchBtn.style.display = _filterState.search ? 'inline-flex' : 'none';
  }

  // 7. Render Defects Table
  const tableContainer = document.getElementById('defects-table-container');
  if (!tableContainer) return;

  if (allDefectsWithProject.length === 0) {
    tableContainer.innerHTML = `
      <div class="empty-state" style="padding: 48px 16px;">
        <div class="empty-state-icon" style="width: 44px; height: 44px; margin-bottom: 12px; color: var(--color-green); border-color: rgba(34, 197, 94, 0.4);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        </div>
        <h4 class="empty-state-title" style="font-size: 1rem;">No Defects Recorded</h4>
        <p class="empty-state-desc" style="font-size: 0.85rem; max-width: 420px; margin-bottom: 16px;">
          All clear! When test runs fail or regressions are observed, report defects to track triage, engineering fixes, and verification.
        </p>
        <button type="button" class="btn btn-primary btn-sm" id="empty-defects-create-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Report First Defect</span>
        </button>
      </div>`;
    return;
  }

  if (filtered.length === 0) {
    tableContainer.innerHTML = `
      <div class="empty-state" style="padding: 40px 16px;">
        <h4 class="empty-state-title" style="font-size: 0.95rem;">No Defects Match Selected Filters</h4>
        <p class="empty-state-desc" style="font-size: 0.8rem; margin-bottom: 12px;">
          Try adjusting your search query, status, or severity filters.
        </p>
        <button type="button" class="btn btn-secondary btn-xs" id="defects-reset-empty-filters-btn">
          <span>Reset Filters</span>
        </button>
      </div>`;
    return;
  }

  const tableHtml = `
    <table class="cases-table">
      <thead>
        <tr>
          <th style="width: 100px;">Defect ID</th>
          <th>Defect Title</th>
          <th style="width: 130px;">Project</th>
          <th style="width: 95px;">Severity</th>
          <th style="width: 95px;">Priority</th>
          <th style="width: 110px;">Status</th>
          <th style="width: 110px;">Linked Test</th>
          <th style="width: 115px;">Last Modified</th>
          <th style="width: 150px; text-align: right;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${filtered
          .map((d) => {
            const displayId = d.defectId || (d.id.startsWith('def_') ? 'DEF-' + d.id.slice(-4).toUpperCase() : d.id);
            const severityClass = `p-${(d.severity || 'medium').toLowerCase()}`;
            const priorityClass = `p-${(d.priority || 'medium').toLowerCase()}`;
            const rawStatus = (d.status || 'Open').toLowerCase();
            const statusClass =
              rawStatus === 'resolved' || rawStatus === 'closed'
                ? 'status-resolved'
                : rawStatus === 'in progress'
                ? 'status-inprogress'
                : rawStatus === 'reopened'
                ? 'status-reopened'
                : 'status-open';

            return `
              <tr data-defect-id="${escapeHtml(d.id)}" data-project-id="${escapeHtml(d.projectId)}">
                <td>
                  <span class="case-id-tag badge-danger-soft" data-action="view-defect" data-defect-id="${escapeHtml(d.id)}" role="button" tabindex="0" title="Click to inspect defect">${escapeHtml(displayId)}</span>
                </td>
                <td>
                  <div style="display: flex; flex-direction: column; gap: 2px;">
                    <strong style="color: var(--text-primary); font-size: 0.85rem; cursor: pointer;" data-action="view-defect" data-defect-id="${escapeHtml(d.id)}">${escapeHtml(d.title || 'Untitled Defect')}</strong>
                    ${d.actualResult ? `<span style="font-size: 0.72rem; color: var(--text-muted); display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;">Issue: ${escapeHtml(d.actualResult)}</span>` : ''}
                  </div>
                </td>
                <td>
                  <span class="project-badge badge-web" style="font-size: 0.7rem;">${escapeHtml(d.projectName)}</span>
                </td>
                <td>
                  <span class="priority-badge ${severityClass}">${escapeHtml(d.severity || 'High')}</span>
                </td>
                <td>
                  <span class="priority-badge ${priorityClass}">${escapeHtml(d.priority || 'High')}</span>
                </td>
                <td>
                  <span class="status-badge ${statusClass}">${escapeHtml(d.status || 'Open')}</span>
                </td>
                <td>
                  ${d.linkedTestCaseId ? `<span class="case-id-tag" style="font-size: 0.7rem; cursor: pointer;" title="Linked to test case">${escapeHtml(d.linkedTestCaseId)}</span>` : '<span style="color: var(--text-muted); font-size: 0.72rem;">None</span>'}
                </td>
                <td>
                  <span style="font-size: 0.74rem; color: var(--text-muted);">${formatDate(d.updatedAt || d.createdAt)}</span>
                </td>
                <td style="text-align: right;">
                  <div style="display: inline-flex; align-items: center; gap: 4px;">
                    <button type="button" class="btn btn-ghost btn-xs" data-action="view-defect" data-defect-id="${escapeHtml(d.id)}" title="Inspect details & quick status">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                      </svg>
                    </button>
                    <button type="button" class="btn btn-ghost btn-xs" data-action="edit-defect" data-defect-id="${escapeHtml(d.id)}" title="Edit defect specifications">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                      </svg>
                    </button>
                    <button type="button" class="btn btn-danger-outline btn-xs" data-action="delete-defect" data-defect-id="${escapeHtml(d.id)}" title="Delete defect">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
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
 * Opens #defect-modal in create mode.
 */
export function openCreateDefectModal(initialData = {}) {
  if (typeof document === 'undefined') return;

  const modal = document.getElementById('defect-modal');
  const titleEl = document.getElementById('defect-modal-title');
  const submitText = document.getElementById('defect-modal-submit-text');
  const form = document.getElementById('defect-form');
  const idInput = document.getElementById('defect-id-input');
  const projInput = document.getElementById('defect-project-id-input');
  const errorAlert = document.getElementById('defect-error-alert');

  if (form) form.reset();
  if (idInput) idInput.value = '';
  if (projInput) projInput.value = '';
  if (errorAlert) errorAlert.style.display = 'none';

  if (titleEl) titleEl.textContent = 'Create Defect';
  if (submitText) submitText.textContent = 'Save Defect';

  // Populate projects dropdown
  const projects = getProjects();
  const projectSelect = document.getElementById('defect-project-select-field');
  const activeProj = getActiveProject();
  const selectedProjId = initialData.projectId || activeProj?.id || (projects[0]?.id || '');

  if (projectSelect) {
    projectSelect.innerHTML = projects
      .map(
        (p) =>
          `<option value="${escapeHtml(p.id)}" ${p.id === selectedProjId ? 'selected' : ''}>${escapeHtml(
            p.name || 'Untitled Project'
          )}</option>`
      )
      .join('');
  }

  // Populate linked test cases
  populateLinkedCasesDropdown(selectedProjId, initialData.linkedTestCaseId);

  // Fill initialData if provided
  if (initialData.title) {
    const titleInput = document.getElementById('defect-title-input');
    if (titleInput) titleInput.value = initialData.title;
  }
  if (initialData.severity) {
    const sevSelect = document.getElementById('defect-severity-select');
    if (sevSelect) sevSelect.value = initialData.severity;
  }
  if (initialData.priority) {
    const priSelect = document.getElementById('defect-priority-select');
    if (priSelect) priSelect.value = initialData.priority;
  }
  if (initialData.steps) {
    const stepsInput = document.getElementById('defect-steps-input');
    if (stepsInput) stepsInput.value = initialData.steps;
  }
  if (initialData.actualResult) {
    const actualInput = document.getElementById('defect-actual-input');
    if (actualInput) actualInput.value = initialData.actualResult;
  }
  if (initialData.expectedResult) {
    const expInput = document.getElementById('defect-expected-input');
    if (expInput) expInput.value = initialData.expectedResult;
  }

  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
}

/**
 * Opens #defect-modal in edit mode.
 */
export function openEditDefectModal(defect, projectId) {
  if (typeof document === 'undefined' || !defect) return;

  const modal = document.getElementById('defect-modal');
  const titleEl = document.getElementById('defect-modal-title');
  const submitText = document.getElementById('defect-modal-submit-text');
  const idInput = document.getElementById('defect-id-input');
  const projInput = document.getElementById('defect-project-id-input');
  const errorAlert = document.getElementById('defect-error-alert');

  if (errorAlert) errorAlert.style.display = 'none';
  if (titleEl) titleEl.textContent = 'Edit Defect';
  if (submitText) submitText.textContent = 'Save Changes';

  if (idInput) idInput.value = defect.id;
  if (projInput) projInput.value = projectId;

  // Populate projects dropdown
  const projects = getProjects();
  const projectSelect = document.getElementById('defect-project-select-field');
  if (projectSelect) {
    projectSelect.innerHTML = projects
      .map(
        (p) =>
          `<option value="${escapeHtml(p.id)}" ${p.id === projectId ? 'selected' : ''}>${escapeHtml(
            p.name || 'Untitled Project'
          )}</option>`
      )
      .join('');
  }

  // Populate linked test cases
  populateLinkedCasesDropdown(projectId, defect.linkedTestCaseId);

  // Fill form inputs
  const titleInput = document.getElementById('defect-title-input');
  const severitySelect = document.getElementById('defect-severity-select');
  const prioritySelect = document.getElementById('defect-priority-select');
  const statusSelect = document.getElementById('defect-status-select');
  const stepsInput = document.getElementById('defect-steps-input');
  const expectedInput = document.getElementById('defect-expected-input');
  const actualInput = document.getElementById('defect-actual-input');
  const descInput = document.getElementById('defect-desc-input');
  const urlInput = document.getElementById('defect-url-input');

  if (titleInput) titleInput.value = defect.title || '';
  if (severitySelect) severitySelect.value = defect.severity || 'High';
  if (prioritySelect) prioritySelect.value = defect.priority || 'High';
  if (statusSelect) statusSelect.value = defect.status || 'Open';
  if (stepsInput) stepsInput.value = defect.steps || '';
  if (expectedInput) expectedInput.value = defect.expectedResult || '';
  if (actualInput) actualInput.value = defect.actualResult || '';
  if (descInput) descInput.value = defect.description || '';
  if (urlInput) urlInput.value = defect.externalUrl || '';

  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function populateLinkedCasesDropdown(projectId, selectedCaseId = null) {
  const select = document.getElementById('defect-linked-case-select');
  if (!select) return;

  const project = getProjects().find((p) => p.id === projectId);
  const cases = [];

  if (project && Array.isArray(project.testSuites)) {
    project.testSuites.forEach((s) => {
      if (Array.isArray(s.cases)) {
        s.cases.forEach((c) => cases.push(c));
      }
    });
  }

  const options = [
    '<option value="">None (Independent defect)</option>',
    ...cases.map((c) => {
      const displayId = c.testCaseId || c.id;
      return `<option value="${escapeHtml(c.id)}" ${c.id === selectedCaseId ? 'selected' : ''}>[${escapeHtml(displayId)}] ${escapeHtml(c.title || 'Untitled Test')}</option>`;
    })
  ];

  select.innerHTML = options.join('');
}

export function closeDefectModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('defect-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}

/**
 * Opens #defect-view-modal to inspect a defect and quickly change status.
 */
export function openDefectViewModal(defect, projectId) {
  if (typeof document === 'undefined' || !defect) return;

  _activeInspectingDefect = defect;
  _activeInspectingProjectId = projectId;

  const modal = document.getElementById('defect-view-modal');
  const idEl = document.getElementById('view-defect-id');
  const titleEl = document.getElementById('view-defect-title');
  const severityEl = document.getElementById('view-defect-severity');
  const statusEl = document.getElementById('view-defect-status');
  const projBadge = document.getElementById('view-defect-project-badge');
  const statusSelect = document.getElementById('view-defect-status-select');
  const linkedCaseEl = document.getElementById('view-defect-linked-case');
  const stepsEl = document.getElementById('view-defect-steps');
  const expectedEl = document.getElementById('view-defect-expected');
  const actualEl = document.getElementById('view-defect-actual');
  const descEl = document.getElementById('view-defect-desc');
  const urlWrap = document.getElementById('view-defect-url-wrap');
  const urlLink = document.getElementById('view-defect-url-link');
  const urlText = document.getElementById('view-defect-url-text');
  const createdEl = document.getElementById('view-defect-created');
  const updatedEl = document.getElementById('view-defect-updated');

  const displayId = defect.defectId || (defect.id.startsWith('def_') ? 'DEF-' + defect.id.slice(-4).toUpperCase() : defect.id);
  if (idEl) idEl.textContent = displayId;
  if (titleEl) titleEl.textContent = defect.title || 'Untitled Defect';

  if (severityEl) {
    severityEl.textContent = defect.severity || 'High';
    severityEl.className = `priority-badge p-${(defect.severity || 'high').toLowerCase()}`;
  }

  const priorityEl = document.getElementById('view-defect-priority');
  if (priorityEl) {
    const p = defect.priority || 'High';
    priorityEl.textContent = `P: ${p}`;
    priorityEl.className = `priority-badge p-${p.toLowerCase()}`;
  }

  if (statusEl) {
    const rawStatus = (defect.status || 'Open').toLowerCase();
    const statusClass =
      rawStatus === 'resolved' || rawStatus === 'closed'
        ? 'status-resolved'
        : rawStatus === 'in progress'
        ? 'status-inprogress'
        : rawStatus === 'reopened'
        ? 'status-reopened'
        : 'status-open';

    statusEl.textContent = defect.status || 'Open';
    statusEl.className = `status-badge ${statusClass}`;
  }

  const project = getProjects().find((p) => p.id === projectId);
  if (projBadge) {
    projBadge.textContent = project?.name || 'Project';
  }

  if (statusSelect) {
    statusSelect.value = defect.status || 'Open';
  }

  if (linkedCaseEl) {
    if (defect.linkedTestCaseId) {
      linkedCaseEl.textContent = defect.linkedTestCaseId;
      linkedCaseEl.style.display = 'inline-block';
    } else {
      linkedCaseEl.textContent = 'None';
    }
  }

  if (stepsEl) {
    stepsEl.textContent = defect.steps || 'No reproduction steps recorded.';
  }
  if (expectedEl) {
    expectedEl.textContent = defect.expectedResult || 'Expected behavior matches specifications.';
  }
  if (actualEl) {
    actualEl.textContent = defect.actualResult || 'Observed defect behavior.';
  }
  if (descEl) {
    descEl.textContent = defect.description || 'No additional notes.';
  }

  if (urlWrap && urlLink && urlText) {
    if (defect.externalUrl) {
      urlWrap.style.display = 'block';
      urlLink.href = defect.externalUrl;
      urlText.textContent = defect.externalUrl;
    } else {
      urlWrap.style.display = 'none';
    }
  }

  if (createdEl) createdEl.textContent = `Created ${formatDate(defect.createdAt)}`;
  if (updatedEl) updatedEl.textContent = `Updated ${formatDate(defect.updatedAt || defect.createdAt)}`;

  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
}

export function closeDefectViewModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('defect-view-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
  _activeInspectingDefect = null;
  _activeInspectingProjectId = null;
}

/**
 * Opens universal delete confirmation modal for a defect.
 */
export function openDeleteDefectModal(defect, projectId) {
  if (!defect || !projectId) return;

  const displayId = defect.defectId || defect.id;
  setPendingDelete({
    title: `defect "${displayId}: ${defect.title || 'Untitled'}"`,
    onConfirm: async () => {
      const res = await deleteDefectById(defect.id, projectId);
      if (res.ok) {
        updateSidebarProjectCounters();
        renderDefectsWorkspace();
        renderDashboard();
        showToast('Defect deleted successfully.', 'success');
      } else {
        showToast(res.error || 'Failed to delete defect.', 'error');
      }
    }
  });

  const deleteModal = document.getElementById('delete-modal');
  const nameEl = document.getElementById('delete-project-name');
  if (nameEl) nameEl.textContent = `defect "${displayId}: ${defect.title || 'Untitled'}"`;
  if (deleteModal) {
    deleteModal.classList.add('open');
    deleteModal.setAttribute('aria-hidden', 'false');
  }
}

/**
 * Initializes all event listeners for the Defect Management workspace.
 */
export function initDefectEventListeners() {
  if (typeof document === 'undefined' || _listenersBound) return;
  _listenersBound = true;

  // 1. Project Selector in #view-defects
  const projectSelect = document.getElementById('defects-project-select');
  projectSelect?.addEventListener('change', (e) => {
    _filterState.projectId = e.target.value;
    renderDefectsWorkspace();
  });

  // 2. New Defect Button
  document.getElementById('btn-create-defect')?.addEventListener('click', () => {
    openCreateDefectModal();
  });

  // 3. Search and Filters Toolbar
  const searchInput = document.getElementById('defects-search-input');
  const clearSearchBtn = document.getElementById('defects-search-clear-btn');
  const filterSeverity = document.getElementById('defects-filter-severity');
  const filterPriority = document.getElementById('defects-filter-priority');
  const filterStatus = document.getElementById('defects-filter-status');
  const sortBy = document.getElementById('defects-sort-by');
  const clearFiltersBtn = document.getElementById('defects-clear-filters-btn');

  searchInput?.addEventListener('input', () => {
    _filterState.search = searchInput.value;
    renderDefectsWorkspace();
  });

  clearSearchBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    _filterState.search = '';
    renderDefectsWorkspace();
  });

  filterSeverity?.addEventListener('change', () => {
    _filterState.severity = filterSeverity.value;
    renderDefectsWorkspace();
  });

  filterPriority?.addEventListener('change', () => {
    _filterState.priority = filterPriority.value;
    renderDefectsWorkspace();
  });

  filterStatus?.addEventListener('change', () => {
    _filterState.status = filterStatus.value;
    renderDefectsWorkspace();
  });

  sortBy?.addEventListener('change', () => {
    _filterState.sort = sortBy.value;
    renderDefectsWorkspace();
  });

  const resetAllDefectFilters = () => {
    _filterState.search = '';
    _filterState.severity = 'ALL';
    _filterState.priority = 'ALL';
    _filterState.status = 'ALL';
    _filterState.sort = 'newest';

    if (searchInput) searchInput.value = '';
    if (filterSeverity) filterSeverity.value = 'ALL';
    if (filterPriority) filterPriority.value = 'ALL';
    if (filterStatus) filterStatus.value = 'ALL';
    if (sortBy) sortBy.value = 'newest';

    renderDefectsWorkspace();
  };

  clearFiltersBtn?.addEventListener('click', resetAllDefectFilters);

  // 4. Table Click Delegation (View, Edit, Delete, Empty Create)
  const tableContainer = document.getElementById('defects-table-container');
  tableContainer?.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.closest('#empty-defects-create-btn')) {
      openCreateDefectModal();
      return;
    }

    if (target.closest('#defects-reset-empty-filters-btn')) {
      resetAllDefectFilters();
      return;
    }

    const row = target.closest('tr[data-defect-id]');
    if (!row) return;

    const defectId = row.getAttribute('data-defect-id');
    const projectId = row.getAttribute('data-project-id');
    const curProject = getProjects().find((p) => p.id === projectId);
    const defect = curProject?.defects?.find((d) => d.id === defectId);

    if (!defect) return;

    // View / Inspect
    if (target.closest('[data-action="view-defect"]')) {
      e.stopPropagation();
      openDefectViewModal(defect, projectId);
      return;
    }

    // Edit
    if (target.closest('[data-action="edit-defect"]')) {
      e.stopPropagation();
      openEditDefectModal(defect, projectId);
      return;
    }

    // Delete
    if (target.closest('[data-action="delete-defect"]')) {
      e.stopPropagation();
      openDeleteDefectModal(defect, projectId);
      return;
    }
  });

  // 5. Defect Modal (Create & Edit) Handlers
  const defectModal = document.getElementById('defect-modal');
  const defectCloseBtn = document.getElementById('defect-modal-close');
  const defectCancelBtn = document.getElementById('defect-modal-cancel');
  const defectForm = document.getElementById('defect-form');
  const defectProjectSelectField = document.getElementById('defect-project-select-field');

  defectCloseBtn?.addEventListener('click', closeDefectModal);
  defectCancelBtn?.addEventListener('click', closeDefectModal);
  defectModal?.addEventListener('click', (e) => {
    if (e.target === defectModal) closeDefectModal();
  });

  // When project changes in defect modal, update linked cases
  defectProjectSelectField?.addEventListener('change', (e) => {
    populateLinkedCasesDropdown(e.target.value);
  });

  defectForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (_isSubmittingDefect) return;

    const titleInput = document.getElementById('defect-title-input');
    const projSelect = document.getElementById('defect-project-select-field');
    const idInput = document.getElementById('defect-id-input');
    const errorAlert = document.getElementById('defect-error-alert');

    const title = titleInput?.value?.trim();
    const projectId = projSelect?.value;

    if (!title || !projectId) {
      if (errorAlert) {
        errorAlert.style.display = 'flex';
        const errText = document.getElementById('defect-error-text');
        if (errText) errText.textContent = 'Please provide a defect title and project.';
      }
      return;
    }

    _isSubmittingDefect = true;
    const submitBtn = defectForm.querySelector('button[type="submit"]');
    const submitText = document.getElementById('defect-modal-submit-text');
    const originalText = submitText ? submitText.textContent : 'Save Defect';

    if (submitBtn) submitBtn.disabled = true;
    if (submitText) submitText.textContent = 'Saving Defect...';

    try {
      const linkedCaseSelect = document.getElementById('defect-linked-case-select');
      const severitySelect = document.getElementById('defect-severity-select');
      const prioritySelect = document.getElementById('defect-priority-select');
      const statusSelect = document.getElementById('defect-status-select');
      const stepsInput = document.getElementById('defect-steps-input');
      const expectedInput = document.getElementById('defect-expected-input');
      const actualInput = document.getElementById('defect-actual-input');
      const descInput = document.getElementById('defect-desc-input');
      const urlInput = document.getElementById('defect-url-input');

      const defectPayload = {
        id: idInput?.value || undefined,
        title,
        projectId,
        linkedTestCaseId: linkedCaseSelect?.value || null,
        severity: severitySelect?.value || 'High',
        priority: prioritySelect?.value || 'High',
        status: statusSelect?.value || 'Open',
        steps: stepsInput?.value?.trim() || '',
        expectedResult: expectedInput?.value?.trim() || '',
        actualResult: actualInput?.value?.trim() || '',
        description: descInput?.value?.trim() || '',
        externalUrl: urlInput?.value?.trim() || ''
      };

      const res = await saveDefect(defectPayload, projectId);
      if (res.ok) {
        updateSidebarProjectCounters();
        renderDefectsWorkspace();
        renderDashboard();
        showToast('Defect saved successfully.', 'success');
        closeDefectModal();
      } else {
        showToast(res.error || 'Failed to save defect.', 'error');
      }
    } catch {
      showToast('An unexpected error occurred while saving defect.', 'error');
    } finally {
      _isSubmittingDefect = false;
      if (submitBtn) submitBtn.disabled = false;
      if (submitText) submitText.textContent = originalText;
    }
  });

  // 6. Defect View Modal Handlers
  const viewModal = document.getElementById('defect-view-modal');
  const viewCloseBtn = document.getElementById('view-defect-close');
  const viewStatusSelect = document.getElementById('view-defect-status-select');
  const viewEditBtn = document.getElementById('view-defect-edit-btn');

  viewCloseBtn?.addEventListener('click', closeDefectViewModal);
  viewModal?.addEventListener('click', (e) => {
    if (e.target === viewModal) closeDefectViewModal();
  });

  viewStatusSelect?.addEventListener('change', async (e) => {
    if (!_activeInspectingDefect || !_activeInspectingProjectId) return;
    const newStatus = e.target.value;
    const res = await updateDefectQuickStatus(_activeInspectingDefect.id, newStatus, _activeInspectingProjectId);
    if (res.ok) {
      _activeInspectingDefect.status = newStatus;
      const statusEl = document.getElementById('view-defect-status');
      if (statusEl) {
        const rawStatus = newStatus.toLowerCase();
        const statusClass =
          rawStatus === 'resolved' || rawStatus === 'closed'
            ? 'status-resolved'
            : rawStatus === 'in progress'
            ? 'status-inprogress'
            : rawStatus === 'reopened'
            ? 'status-reopened'
            : 'status-open';

        statusEl.textContent = newStatus;
        statusEl.className = `status-badge ${statusClass}`;
      }
      updateSidebarProjectCounters();
      renderDefectsWorkspace();
      renderDashboard();
      showToast(`Defect status updated to ${newStatus}.`, 'success');
    } else {
      showToast(res.error || 'Failed to update defect status.', 'error');
    }
  });

  viewEditBtn?.addEventListener('click', () => {
    if (_activeInspectingDefect && _activeInspectingProjectId) {
      const def = { ..._activeInspectingDefect };
      const pId = _activeInspectingProjectId;
      closeDefectViewModal();
      openEditDefectModal(def, pId);
    }
  });
}
