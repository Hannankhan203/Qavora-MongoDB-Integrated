/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Project Management Module (CQ-003)
 */

import { apiJson } from './apiClient.js';
import {
  getProjects,
  setProjects,
  getActiveProjectId,
  setActiveProjectId,
  getActiveProject
} from './state.js';
import { escapeHtml, formatDate } from './utils.js';
import { populateProjectsDropdown } from './testPlanManager.js';
import { renderDashboard } from './dashboardManager.js';

let _isLoadingProjects = false;
let _hasLoadedProjects = false;
let _projectLoadError = null;
let _pendingDeleteProject = null;

export function getIsLoadingProjects() {
  return _isLoadingProjects;
}

export function getHasLoadedProjects() {
  return _hasLoadedProjects;
}

export function getProjectLoadError() {
  return _projectLoadError;
}

export function getPendingDeleteProject() {
  return _pendingDeleteProject;
}

export async function loadProjectsFromBackend() {
  _isLoadingProjects = true;
  _projectLoadError = null;
  renderProjectsGrid();
  populateProjectsDropdown();

  const res = await apiJson('/api/projects');
  _isLoadingProjects = false;
  _hasLoadedProjects = true;

  if (res.ok && Array.isArray(res.data)) {
    setProjects(res.data);
    if (!getActiveProjectId() && res.data.length > 0) {
      setActiveProjectId(res.data[0].id);
    }
    updateSidebarProjectCounters();
    renderProjectsGrid();
    populateProjectsDropdown();
    renderDashboard();
    renderProjectDetails();
    return { ok: true, projects: res.data };
  }

  _projectLoadError = res.data?.error || 'Failed to load projects from server.';
  renderProjectsGrid();
  populateProjectsDropdown();
  renderDashboard();
  renderProjectDetails();
  return { ok: false, status: res.status, error: _projectLoadError };
}

export async function createProject(payload) {
  const res = await apiJson('/api/projects', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  if (res.ok && res.data) {
    const current = getProjects();
    setProjects([res.data, ...current]);
    setActiveProjectId(res.data.id);
    updateSidebarProjectCounters();
    renderDashboard();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('qavora:storage-invalidate'));
    }
    return { ok: true, project: res.data };
  }
  return { ok: false, status: res.status, error: res.data?.error || 'Failed to create project.' };
}

export function addPromotedProjectToState(project) {
  if (!project || !project.id) return;
  const current = getProjects();
  const exists = current.some((p) => p.id === project.id);
  const updated = exists
    ? current.map((p) => (p.id === project.id ? { ...p, ...project } : p))
    : [project, ...current];
  setProjects(updated);
  setActiveProjectId(project.id);
  updateSidebarProjectCounters();
  renderProjectsGrid();
  populateProjectsDropdown();
  renderDashboard();
  renderProjectDetails(project.id);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('qavora:storage-invalidate'));
  }
}

export async function updateProjectMetadata(projectId, payload) {
  const res = await apiJson(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
  if (res.ok && res.data) {
    const updated = getProjects().map((p) => (p.id === projectId ? { ...p, ...res.data } : p));
    setProjects(updated);
    updateSidebarProjectCounters();
    renderDashboard();
    return { ok: true, project: res.data };
  }
  return { ok: false, status: res.status, error: res.data?.error || 'Failed to update project.' };
}

export async function saveProjectData(projectId, dataPayload, expectedUpdatedAt) {
  const payload = { ...dataPayload };
  if (expectedUpdatedAt !== undefined && payload.expectedUpdatedAt === undefined) {
    payload.expectedUpdatedAt = expectedUpdatedAt;
  }
  const res = await apiJson(`/api/projects/${encodeURIComponent(projectId)}/data`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
  if (res.ok && res.data) {
    const updated = getProjects().map((p) => (p.id === projectId ? res.data : p));
    setProjects(updated);
    updateSidebarProjectCounters();
    renderDashboard();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('qavora:storage-invalidate'));
    }
    return { ok: true, project: res.data };
  }
  return { ok: false, status: res.status, error: res.data?.error || 'Failed to save project data.', data: res.data };
}

export async function deleteProjectById(projectId) {
  const res = await apiJson(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE'
  });
  if (res.ok) {
    const remaining = getProjects().filter((p) => p.id !== projectId);
    setProjects(remaining);
    if (getActiveProjectId() === projectId) {
      setActiveProjectId(remaining[0]?.id || null);
    }
    updateSidebarProjectCounters();
    renderDashboard();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('qavora:storage-invalidate'));
    }
    return { ok: true };
  }
  return { ok: false, status: res.status, error: res.data?.error || 'Failed to delete project.' };
}

export function updateSidebarProjectCounters() {
  if (typeof document === 'undefined') return;
  const projects = getProjects();
  const countEl = document.getElementById('sidebar-projects-count');
  if (countEl) {
    countEl.textContent = String(projects.length);
  }

  const navProjEl = document.getElementById('nav-project-count');
  if (navProjEl) {
    navProjEl.textContent = String(projects.length);
  }

  let totalCases = 0;
  let activeDefects = 0;
  projects.forEach((p) => {
    if (Array.isArray(p.testSuites)) {
      p.testSuites.forEach((s) => {
        totalCases += Array.isArray(s.cases) ? s.cases.length : 0;
      });
    }
    if (Array.isArray(p.defects)) {
      p.defects.forEach((d) => {
        if (d.status !== 'Resolved' && d.status !== 'Closed') {
          activeDefects++;
        }
      });
    }
  });

  const navCasesEl = document.getElementById('nav-cases-count');
  if (navCasesEl) {
    navCasesEl.textContent = String(totalCases);
  }

  const navDefectsEl = document.getElementById('nav-defects-count');
  if (navDefectsEl) {
    navDefectsEl.textContent = String(activeDefects);
  }

  const totalEl = document.getElementById('my-stat-total');
  if (totalEl) totalEl.textContent = String(projects.length);

  const activeEl = document.getElementById('my-stat-active');
  if (activeEl) {
    activeEl.textContent = String(projects.filter((p) => (p.status || 'Active') === 'Active').length);
  }

  const completedEl = document.getElementById('my-stat-completed');
  if (completedEl) {
    completedEl.textContent = String(projects.filter((p) => p.status === 'Completed').length);
  }

  const archivedEl = document.getElementById('my-stat-archived');
  if (archivedEl) {
    archivedEl.textContent = String(projects.filter((p) => p.status === 'Archived').length);
  }
}

export function openCreateProjectModal() {
  if (typeof document === 'undefined') return;
  resetProjectModal();
  const projectModal = document.getElementById('project-modal');
  if (projectModal) {
    projectModal.classList.add('open');
    projectModal.setAttribute('aria-hidden', 'false');
  }
}

export function openEditProjectModal(project) {
  if (typeof document === 'undefined' || !project) return;
  const projectModal = document.getElementById('project-modal');
  const idInput = document.getElementById('project-id-input');
  const nameInput = document.getElementById('project-name-input');
  const typeInput = document.getElementById('project-type-input');
  const statusInput = document.getElementById('project-status-input');
  const versionInput = document.getElementById('project-version-input');
  const descInput = document.getElementById('project-desc-input');
  const modalTitle = document.getElementById('modal-title');
  const modalSubtitle = document.getElementById('modal-subtitle');
  const submitBtnText = document.getElementById('modal-submit-btn-text');
  const errAlert = document.getElementById('modal-error-alert');

  if (errAlert) errAlert.style.display = 'none';
  if (idInput) idInput.value = project.id || '';
  if (nameInput) nameInput.value = project.name || '';
  if (typeInput) typeInput.value = project.type || 'Web Application';
  if (statusInput) statusInput.value = project.status || 'Active';
  if (versionInput) versionInput.value = project.version || '';
  if (descInput) descInput.value = project.description || '';

  if (modalTitle) modalTitle.textContent = 'Edit Project';
  if (modalSubtitle) modalSubtitle.textContent = 'Update testing workspace and project properties';
  if (submitBtnText) submitBtnText.textContent = 'Save Changes';

  if (projectModal) {
    projectModal.classList.add('open');
    projectModal.setAttribute('aria-hidden', 'false');
  }
}

export function resetProjectModal() {
  if (typeof document === 'undefined') return;
  const projectForm = document.getElementById('create-project-form');
  const idInput = document.getElementById('project-id-input');
  const modalTitle = document.getElementById('modal-title');
  const modalSubtitle = document.getElementById('modal-subtitle');
  const submitBtnText = document.getElementById('modal-submit-btn-text');
  const errAlert = document.getElementById('modal-error-alert');

  if (projectForm) projectForm.reset();
  if (idInput) idInput.value = '';
  if (modalTitle) modalTitle.textContent = 'Create New Project';
  if (modalSubtitle) modalSubtitle.textContent = 'Configure testing workspace and project properties';
  if (submitBtnText) submitBtnText.textContent = 'Create Project';
  if (errAlert) errAlert.style.display = 'none';
}

export function closeProjectModal() {
  if (typeof document === 'undefined') return;
  const projectModal = document.getElementById('project-modal');
  if (projectModal) {
    projectModal.classList.remove('open');
    projectModal.setAttribute('aria-hidden', 'true');
  }
  resetProjectModal();
}

export function openDeleteProjectModal(project) {
  if (typeof document === 'undefined' || !project) return;
  _pendingDeleteProject = project;

  const deleteModal = document.getElementById('delete-modal');
  const nameEl = document.getElementById('delete-project-name');
  if (nameEl) nameEl.textContent = `"${project.name || 'Untitled Project'}"`;

  if (deleteModal) {
    deleteModal.classList.add('open');
    deleteModal.setAttribute('aria-hidden', 'false');
  }
}

export function closeDeleteModal() {
  if (typeof document === 'undefined') return;
  const deleteModal = document.getElementById('delete-modal');
  if (deleteModal) {
    deleteModal.classList.remove('open');
    deleteModal.setAttribute('aria-hidden', 'true');
  }
  _pendingDeleteProject = null;
}

export function getVisibleProjects() {
  const all = getProjects();
  if (typeof document === 'undefined') return all;

  const searchInput = document.getElementById('project-search-input');
  const typeSelect = document.getElementById('project-filter-type');
  const statusSelect = document.getElementById('project-filter-status');
  const sortSelect = document.getElementById('project-sort-by');
  const clearSearchBtn = document.getElementById('search-clear-btn');
  const clearFiltersBtn = document.getElementById('projects-clear-filters-btn');

  const query = searchInput?.value?.trim().toLowerCase() || '';
  const typeFilter = typeSelect?.value || 'ALL';
  const statusFilter = statusSelect?.value || 'ALL';
  const sortBy = sortSelect?.value || 'newest';

  if (clearSearchBtn) {
    clearSearchBtn.style.display = query ? 'flex' : 'none';
  }

  const isFiltered = query || typeFilter !== 'ALL' || statusFilter !== 'ALL';
  if (clearFiltersBtn) {
    clearFiltersBtn.style.display = isFiltered ? 'inline-flex' : 'none';
  }

  const filtered = all.filter((p) => {
    if (typeFilter !== 'ALL' && (p.type || 'Web Application') !== typeFilter) {
      return false;
    }
    if (statusFilter !== 'ALL' && (p.status || 'Active') !== statusFilter) {
      return false;
    }
    if (query) {
      const name = (p.name || '').toLowerCase();
      const desc = (p.description || '').toLowerCase();
      const version = (p.version || '').toLowerCase();
      const type = (p.type || '').toLowerCase();
      if (!name.includes(query) && !desc.includes(query) && !version.includes(query) && !type.includes(query)) {
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
    if (sortBy === 'name-asc') {
      return (a.name || '').localeCompare(b.name || '');
    }
    if (sortBy === 'name-desc') {
      return (b.name || '').localeCompare(a.name || '');
    }
    return 0;
  });

  return filtered;
}

export function renderProjectsGrid() {
  if (typeof document === 'undefined') return;
  updateSidebarProjectCounters();

  const grid = document.getElementById('projects-grid');
  if (!grid) return;

  const filterMetaEl = document.getElementById('projects-filter-meta');

  // 1. Loading State
  if (_isLoadingProjects) {
    if (filterMetaEl) filterMetaEl.textContent = 'Loading projects...';
    grid.innerHTML = `
      <div class="empty-state" id="loading-projects-state" style="grid-column: 1 / -1; padding: 48px 16px;">
        <div class="auth-loading-spinner" style="margin-bottom: 14px;" aria-label="Loading projects"></div>
        <h3 class="empty-state-title">Loading Projects...</h3>
        <p class="empty-state-desc">Fetching your QA workspaces from database...</p>
      </div>`;
    return;
  }

  // 2. Error State
  if (_projectLoadError) {
    if (filterMetaEl) filterMetaEl.textContent = 'Error loading projects';
    grid.innerHTML = `
      <div class="empty-state" id="error-projects-state" style="grid-column: 1 / -1; padding: 48px 16px;">
        <div class="empty-state-icon" style="color: var(--color-red, #ef4444);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <h3 class="empty-state-title">Failed to Load Projects</h3>
        <p class="empty-state-desc">${escapeHtml(_projectLoadError)}</p>
        <button type="button" id="projects-retry-btn" class="btn btn-secondary btn-sm" style="margin-top: 10px;">
          <span>Retry Loading</span>
        </button>
      </div>`;
    return;
  }

  const allProjects = getProjects();

  // 3. Genuine Empty State (user has 0 projects)
  if (allProjects.length === 0) {
    if (filterMetaEl) filterMetaEl.textContent = 'Showing 0 projects';
    grid.innerHTML = `
      <div class="empty-state" id="empty-projects-state" style="grid-column: 1 / -1; padding: 48px 16px;">
        <div class="empty-state-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
        <h3 class="empty-state-title">No Projects Found</h3>
        <p class="empty-state-desc">You haven't created any software testing projects yet. Create your first project to organize test plans, suites, and executions.</p>
        <button type="button" id="empty-projects-create-btn" class="btn btn-primary" data-action="new-project">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Create New Project</span>
        </button>
      </div>`;
    return;
  }

  // 4. Filtered list
  const visibleProjects = getVisibleProjects();
  if (filterMetaEl) {
    filterMetaEl.textContent =
      visibleProjects.length === allProjects.length
        ? `Showing ${allProjects.length} project${allProjects.length === 1 ? '' : 's'}`
        : `Showing ${visibleProjects.length} of ${allProjects.length} projects`;
  }

  if (visibleProjects.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" id="empty-filter-state" style="grid-column: 1 / -1; padding: 48px 16px;">
        <div class="empty-state-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </div>
        <h3 class="empty-state-title">No Matching Projects</h3>
        <p class="empty-state-desc">No projects match your current search or filter criteria. Clear your filters to view all projects.</p>
        <button type="button" id="filter-reset-cta-btn" class="btn btn-secondary btn-sm" style="margin-top: 10px;">
          <span>Clear Filters</span>
        </button>
      </div>`;
    return;
  }

  grid.innerHTML = visibleProjects
    .map((p) => {
      const statusClass = `status-${(p.status || 'Active').toLowerCase()}`;
      const versionTag = p.version ? `<span class="version-tag">v${escapeHtml(p.version)}</span>` : '';
      const descHtml = p.description
        ? `<p class="project-card-desc">${escapeHtml(p.description)}</p>`
        : `<p class="project-card-desc" style="color: var(--text-muted); font-style: italic;">No description provided</p>`;

      return `
        <div class="project-card" data-project-id="${escapeHtml(p.id)}" role="button" tabindex="0" title="Click to view project details">
          <div class="project-card-header">
            <div class="project-card-top">
              <h3 class="project-card-title">${escapeHtml(p.name || 'Untitled Project')}</h3>
              <div class="project-card-badges">
                <span class="status-badge ${statusClass}">${escapeHtml(p.status || 'Active')}</span>
                ${versionTag}
              </div>
            </div>
            <span class="project-badge badge-web" style="align-self: flex-start; font-size: 0.72rem; margin-top: 2px;">
              ${escapeHtml(p.type || 'Web Application')}
            </span>
            ${descHtml}
          </div>

          <div class="project-card-dates">
            <span>Created ${formatDate(p.createdAt)}</span>
            <span>Updated ${formatDate(p.updatedAt)}</span>
          </div>

          <div class="project-card-footer">
            <button type="button" class="btn btn-secondary btn-xs card-view-btn" data-action="view-project" data-project-id="${escapeHtml(p.id)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
              <span>Details</span>
            </button>
            <div class="card-action-group">
              <button type="button" class="btn btn-ghost btn-xs card-edit-btn" data-action="edit-project" data-project-id="${escapeHtml(p.id)}" title="Edit Project">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                <span>Edit</span>
              </button>
              <button type="button" class="btn btn-ghost btn-xs card-delete-btn btn-danger-outline" data-action="delete-project" data-project-id="${escapeHtml(p.id)}" title="Delete Project">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>`;
    })
    .join('');
}

function renderSuiteCard(s) {
  const cases = Array.isArray(s.cases) ? s.cases : [];
  const cPassed = cases.filter((c) => (c.status || '').toLowerCase() === 'passed').length;
  const cFailed = cases.filter((c) => (c.status || '').toLowerCase() === 'failed').length;

  return `
    <div class="suite-preview-card" style="background: var(--bg-surface, #1e293b); border: 1px solid var(--border-color, rgba(255,255,255,0.08)); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; justify-content: space-between; gap: 8px;">
      <div>
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 4px;">
          <h5 style="margin: 0; font-size: 0.88rem; font-weight: 600; color: var(--text-primary);">${escapeHtml(s.name || 'Untitled Suite')}</h5>
          <span class="qa-chip-val" style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: var(--bg-surface-2); color: var(--text-secondary); white-space: nowrap;">${cases.length} cases</span>
        </div>
        ${s.description ? `<p style="margin: 0; font-size: 0.78rem; color: var(--text-muted); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${escapeHtml(s.description)}</p>` : ''}
      </div>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 6px;">
        <div style="display: flex; gap: 6px; font-size: 0.72rem;">
          <span style="color: var(--color-green, #22c55e); font-weight: 500;">✓ ${cPassed}</span>
          <span style="color: var(--color-red, #ef4444); font-weight: 500;">✕ ${cFailed}</span>
        </div>
        <div style="display: inline-flex; gap: 4px; align-items: center;">
          <button type="button" class="btn btn-primary btn-xs" data-action="run-suite-exec" data-suite-id="${escapeHtml(s.id)}" style="font-size: 0.72rem; padding: 2px 8px;" title="Execute this suite in Runner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 10px; height: 10px;">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            <span>Run Suite</span>
          </button>
          <button type="button" class="btn btn-ghost btn-xs" data-action="open-suite-plan" data-suite-id="${escapeHtml(s.id)}" style="font-size: 0.72rem; padding: 2px 8px;">
            <span>Plan</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      </div>
    </div>`;
}

export function renderProjectDetails(projectId) {
  if (typeof document === 'undefined') return;

  const loadingEl = document.getElementById('detail-loading-view');
  const notFoundEl = document.getElementById('detail-not-found-view');
  const contentWrap = document.getElementById('detail-content-wrap');

  if (_isLoadingProjects || !_hasLoadedProjects) {
    if (loadingEl) loadingEl.style.display = 'block';
    if (notFoundEl) notFoundEl.style.display = 'none';
    if (contentWrap) contentWrap.style.display = 'none';
    return;
  }

  const projects = getProjects();
  const targetId = projectId || getActiveProjectId();
  const project = projects.find((p) => p.id === targetId);

  if (!project) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (notFoundEl) notFoundEl.style.display = 'block';
    if (contentWrap) contentWrap.style.display = 'none';
    return;
  }

  if (loadingEl) loadingEl.style.display = 'none';
  if (notFoundEl) notFoundEl.style.display = 'none';
  if (contentWrap) contentWrap.style.display = 'block';

  const nameEl = document.getElementById('detail-name');
  const breadcrumbEl = document.getElementById('detail-breadcrumb-title');
  const statusBadge = document.getElementById('detail-status-badge');
  const typeBadge = document.getElementById('detail-type-badge');
  const versionBadge = document.getElementById('detail-version-badge');
  const descEl = document.getElementById('detail-desc');
  const metaType = document.getElementById('detail-meta-type');
  const metaStatus = document.getElementById('detail-meta-status');
  const metaVersion = document.getElementById('detail-meta-version');
  const metaCreated = document.getElementById('detail-meta-created');
  const metaUpdated = document.getElementById('detail-meta-updated');

  const safeName = project.name || 'Untitled Project';
  if (nameEl) nameEl.textContent = safeName;
  if (breadcrumbEl) breadcrumbEl.textContent = safeName;

  if (statusBadge) {
    statusBadge.textContent = project.status || 'Active';
    statusBadge.className = `status-badge status-${(project.status || 'Active').toLowerCase()}`;
  }

  if (typeBadge) {
    typeBadge.textContent = project.type || 'Web Application';
    typeBadge.className = `project-badge badge-${(project.type || 'web').toLowerCase().replace(/\s+/g, '-')}`;
  }

  if (versionBadge) {
    if (project.version) {
      versionBadge.textContent = `v${project.version}`;
      versionBadge.style.display = 'inline-flex';
    } else {
      versionBadge.style.display = 'none';
    }
  }

  if (descEl) {
    descEl.textContent = project.description || 'No project description provided.';
  }

  if (metaType) metaType.textContent = project.type || 'Web Application';
  if (metaStatus) metaStatus.textContent = project.status || 'Active';
  if (metaVersion) metaVersion.textContent = project.version || 'Not specified';
  if (metaCreated) metaCreated.textContent = formatDate(project.createdAt);
  if (metaUpdated) metaUpdated.textContent = formatDate(project.updatedAt || project.createdAt);

  // Quality metrics overview chips
  const statPhases = document.getElementById('detail-stat-phases');
  const statSuites = document.getElementById('detail-stat-suites');
  const statCases = document.getElementById('detail-stat-cases');
  const statPassed = document.getElementById('detail-stat-passed');
  const statFailed = document.getElementById('detail-stat-failed');
  const statNotRun = document.getElementById('detail-stat-notrun');
  const progressPercent = document.getElementById('detail-progress-percent');
  const progressBar = document.getElementById('detail-progress-bar');
  const progressSub = document.getElementById('detail-progress-sub');

  const phases = Array.isArray(project.testPlan?.phases) ? project.testPlan.phases : [];
  const phasesCount = phases.length;
  const testSuites = Array.isArray(project.testSuites) ? project.testSuites : [];
  const suitesCount = testSuites.length;

  let totalCases = 0;
  let passedCases = 0;
  let failedCases = 0;
  let blockedCases = 0;

  testSuites.forEach((s) => {
    if (Array.isArray(s.cases)) {
      totalCases += s.cases.length;
      s.cases.forEach((c) => {
        const st = (c.status || '').toLowerCase();
        if (st === 'passed') passedCases++;
        else if (st === 'failed') failedCases++;
        else if (st === 'blocked') blockedCases++;
      });
    }
  });

  const executions = Array.isArray(project.executions) ? project.executions : [];
  let passedExecs = 0;
  let failedExecs = 0;
  let blockedExecs = 0;
  const executedCaseIds = new Set();

  executions.forEach((e) => {
    const st = (e.status || '').toLowerCase();
    if (st === 'passed' || st === 'pass') passedExecs++;
    else if (st === 'failed' || st === 'fail') failedExecs++;
    else if (st === 'blocked') blockedExecs++;
    if (e.testCaseId || e.caseId) executedCaseIds.add(String(e.testCaseId || e.caseId));
  });

  const passedCount = executions.length > 0 ? passedExecs : passedCases;
  const failedCount = executions.length > 0 ? failedExecs : failedCases;
  const executedTotal = executions.length > 0
    ? Math.min(totalCases, executedCaseIds.size > 0 ? executedCaseIds.size : (passedExecs + failedExecs + blockedExecs))
    : (passedCases + failedCases + blockedCases);

  const notRunCount = Math.max(0, totalCases - executedTotal);
  const pct = totalCases > 0 ? Math.min(100, Math.round((executedTotal / totalCases) * 100)) : 0;

  if (statPhases) statPhases.textContent = String(phasesCount);
  if (statSuites) statSuites.textContent = String(suitesCount);
  if (statCases) statCases.textContent = String(totalCases);
  if (statPassed) statPassed.textContent = String(passedCount);
  if (statFailed) statFailed.textContent = String(failedCount);
  if (statNotRun) statNotRun.textContent = String(notRunCount);
  if (progressPercent) progressPercent.textContent = `${pct}%`;
  if (progressBar) progressBar.style.width = `${pct}%`;
  if (progressSub) progressSub.textContent = `${executedTotal} of ${totalCases} executed`;

  const defectsBtn = document.getElementById('detail-defects-btn');
  if (defectsBtn) {
    const defectsCount = Array.isArray(project.defects) ? project.defects.length : 0;
    const activeDefectsCount = Array.isArray(project.defects)
      ? project.defects.filter((d) => d.status !== 'Resolved' && d.status !== 'Closed').length
      : 0;
    const defectsLabel = defectsBtn.querySelector('span');
    if (defectsLabel) {
      defectsLabel.textContent = defectsCount > 0 ? `Defects (${activeDefectsCount > 0 ? activeDefectsCount : defectsCount})` : 'Defects';
    }
  }

  const suitesCounter = document.getElementById('detail-suites-counter');
  if (suitesCounter) {
    suitesCounter.textContent = `${suitesCount} suite${suitesCount === 1 ? '' : 's'}`;
  }

  const suitesContainer = document.getElementById('detail-suites-container');
  if (suitesContainer) {
    if (suitesCount === 0) {
      suitesContainer.innerHTML = `
        <div class="empty-state" style="padding: 32px 16px;">
          <div class="empty-state-icon" style="width: 44px; height: 44px; margin-bottom: 12px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
          </div>
          <h4 class="empty-state-title" style="font-size: 1rem;">No Test Suites Defined Yet</h4>
          <p class="empty-state-desc" style="font-size: 0.85rem; max-width: 420px; margin-bottom: 16px;">
            Structure your QA test cases into suites and phases to begin running manual validations and tracking pass/fail rates.
          </p>
          <button type="button" class="btn btn-primary btn-xs" id="detail-empty-create-suite-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>Add First Test Suite</span>
          </button>
        </div>`;
    } else {
      const phaseMap = new Map();
      phases.forEach((ph) => {
        phaseMap.set(ph.id, { phase: ph, suites: [] });
      });
      const unassignedSuites = [];

      testSuites.forEach((s) => {
        if (s.phaseId && phaseMap.has(s.phaseId)) {
          phaseMap.get(s.phaseId).suites.push(s);
        } else {
          unassignedSuites.push(s);
        }
      });

      let suitesHtml = '';

      phaseMap.forEach(({ phase, suites }) => {
        if (suites.length === 0) return;
        suitesHtml += `
          <div class="detail-phase-group" style="margin-bottom: 16px;">
            <div class="detail-phase-group-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="project-badge badge-qa" style="font-size: 0.68rem; text-transform: uppercase;">Phase</span>
                <strong style="font-size: 0.85rem;">${escapeHtml(phase.name || 'Untitled Phase')}</strong>
              </div>
              <span style="font-size: 0.75rem; color: var(--text-muted);">${suites.length} suite${suites.length === 1 ? '' : 's'}</span>
            </div>
            <div class="detail-suites-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px;">
              ${suites.map(renderSuiteCard).join('')}
            </div>
          </div>`;
      });

      if (unassignedSuites.length > 0) {
        suitesHtml += `
          <div class="detail-phase-group" style="margin-bottom: 16px;">
            <div class="detail-phase-group-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="project-badge" style="font-size: 0.68rem; background: var(--bg-surface-2); text-transform: uppercase;">Test Suites</span>
                <strong style="font-size: 0.85rem;">General Test Suites</strong>
              </div>
              <span style="font-size: 0.75rem; color: var(--text-muted);">${unassignedSuites.length} suite${unassignedSuites.length === 1 ? '' : 's'}</span>
            </div>
            <div class="detail-suites-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px;">
              ${unassignedSuites.map(renderSuiteCard).join('')}
            </div>
          </div>`;
      }

      suitesContainer.innerHTML = suitesHtml;
    }
  }
}

