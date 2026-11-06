/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — UI Rendering, Routing, Event Bindings & Toast Notifications Module (CQ-003)
 */

import authController from '../../authController.js';
import { checkBackendHealth } from './apiClient.js';
import {
  getAppState,
  getProjects,
  setActiveProjectId,
  getActiveProject,
  getPendingDelete,
  setPendingDelete
} from './state.js';
import {
  createProject,
  updateProjectMetadata,
  deleteProjectById,
  updateSidebarProjectCounters,
  renderProjectsGrid,
  renderProjectDetails,
  openCreateProjectModal,
  openEditProjectModal,
  closeProjectModal,
  resetProjectModal,
  openDeleteProjectModal,
  closeDeleteModal,
  getPendingDeleteProject,
  loadProjectsFromBackend
} from './projectManager.js';
import { renderDashboard } from './dashboardManager.js';
import { renderExecutionWorkspace, initExecutionEventListeners, openExecutionModal, getExecutionFilterState } from './executionManager.js';
import { renderDefectsWorkspace, initDefectEventListeners, getDefectFilterState } from './defectManager.js';
import { renderReportsWorkspace, initReportsEventListeners } from './reportsManager.js';
import { renderSettingsWorkspace, initSettingsEventListeners } from './settingsManager.js';
import { renderDataManagementWorkspace, initDataManagementEventListeners } from './dataManager.js';
import {
  populateProjectsDropdown,
  renderTestPlanWorkspace,
  saveTestPlan,
  openTestPlanModal,
  closeTestPlanModal,
  addPhase,
  updatePhase,
  deletePhase,
  openPhaseModal,
  closePhaseModal,
  saveTestSuite,
  deleteTestSuite,
  openSuiteModal,
  closeSuiteModal,
  saveTestCase,
  deleteTestCase,
  duplicateTestCase,
  openTestCaseModal,
  closeTestCaseModal,
  openTestCaseViewModal,
  closeTestCaseViewModal,
  openSuiteExplorer,
  closeSuiteExplorer,
  renderTestCasesTable,
  addStepRow,
  renumberStepRows,
  collectStepsFromBuilder,
  openDeleteConfirmModal,
  getActiveSuiteId,
  getCurrentViewingCase,
  getCurrentViewingSuite
} from './testPlanManager.js';

let _listenersBound = false;

export function showToast(message, type = 'info') {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-hiding');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

export function navigateTo(route, pushState = true) {
  const appState = getAppState();
  const cleanRoute = route && route !== '/' ? route : '/projects';
  appState.currentRoute = cleanRoute;

  if (typeof window !== 'undefined' && pushState) {
    const currentFull = (window.location.pathname || '') + (window.location.search || '');
    if (currentFull !== cleanRoute) {
      try {
        window.history.pushState({ route: cleanRoute }, '', cleanRoute);
      } catch {
        // Ignore history pushState errors
      }
    }
  }

  if (typeof document !== 'undefined') {
    const routeWithoutSlash = cleanRoute.replace(/^\//, '');
    const pathPart = routeWithoutSlash.split('?')[0];
    const viewSlug = pathPart.split('/')[0] || 'projects';

    const navItems = document.querySelectorAll('.nav-link[data-view]');
    navItems.forEach((el) => {
      const targetView = el.getAttribute('data-view');
      el.classList.toggle('active', targetView === viewSlug);
    });

    const views = document.querySelectorAll('.view-section');
    views.forEach((view) => {
      const isMatch = view.id === `view-${viewSlug}`;
      view.style.display = isMatch ? 'block' : 'none';
      view.classList.toggle('active', isMatch);
    });

    const VIEW_TITLES = {
      'checklist-generator': 'Create QA Checklist',
      'my-checklists': 'My QA Checklists',
      'qa-runner': 'QA Test Runner',
      dashboard: 'Dashboard',
      projects: 'My Projects',
      'project-details': 'Project Details',
      plans: 'Test Plan',
      execution: 'Test Execution',
      defects: 'Defects',
      reports: 'Reports',
      data: 'Data Management',
      settings: 'Settings'
    };
    const pageTitleEl = document.getElementById('page-title');
    if (pageTitleEl) {
      pageTitleEl.textContent = VIEW_TITLES[viewSlug] || 'Qavora';
    }

    if (viewSlug === 'dashboard') {
      renderDashboard();
    }
    if (viewSlug === 'project-details') {
      let targetId = null;
      if (cleanRoute.includes('?')) {
        const queryStr = cleanRoute.split('?')[1];
        const params = new URLSearchParams(queryStr);
        targetId = params.get('id');
      } else if (cleanRoute.startsWith('/project-details/')) {
        targetId = cleanRoute.replace('/project-details/', '').split('?')[0];
      }

      if (targetId) {
        setActiveProjectId(targetId);
      }
      renderProjectDetails(targetId || appState.activeProjectId);
    }
    if (viewSlug === 'plans') {
      let targetId = null;
      if (cleanRoute.includes('?')) {
        const queryStr = cleanRoute.split('?')[1];
        const params = new URLSearchParams(queryStr);
        targetId = params.get('id');
      }
      if (targetId) {
        setActiveProjectId(targetId);
      }
      renderTestPlanWorkspace();
    }
    if (viewSlug === 'execution') {
      let targetId = null;
      let targetSuite = null;
      if (cleanRoute.includes('?')) {
        const queryStr = cleanRoute.split('?')[1];
        const params = new URLSearchParams(queryStr);
        targetId = params.get('id');
        targetSuite = params.get('suite');
      }
      if (targetId) {
        setActiveProjectId(targetId);
      }
      if (targetSuite) {
        getExecutionFilterState().suite = targetSuite;
      }
      renderExecutionWorkspace();
    }
    if (viewSlug === 'defects') {
      let targetId = null;
      if (cleanRoute.includes('?')) {
        const queryStr = cleanRoute.split('?')[1];
        const params = new URLSearchParams(queryStr);
        targetId = params.get('id');
      }
      if (targetId) {
        setActiveProjectId(targetId);
        getDefectFilterState().projectId = targetId;
      }
      renderDefectsWorkspace();
    }
    if (viewSlug === 'reports') {
      let targetId = null;
      if (cleanRoute.includes('?')) {
        const queryStr = cleanRoute.split('?')[1];
        const params = new URLSearchParams(queryStr);
        targetId = params.get('id');
      }
      if (targetId) {
        setActiveProjectId(targetId);
      }
      renderReportsWorkspace(targetId);
    }
    if (viewSlug === 'settings') {
      renderSettingsWorkspace();
    }
    if (viewSlug === 'data') {
      renderDataManagementWorkspace();
    }
  }
}

export function resolveInitialRoute() {
  if (typeof window === 'undefined') return '/projects';
  const pathname = window.location.pathname || '/projects';
  const search = window.location.search || '';
  if (pathname === '/' || pathname === '') return '/projects' + search;
  return pathname + search;
}

export function initUIEventListeners() {
  if (typeof document === 'undefined' || _listenersBound) return;
  _listenersBound = true;

  initExecutionEventListeners();
  initDefectEventListeners();
  initReportsEventListeners();
  initSettingsEventListeners();
  initDataManagementEventListeners();

  // 1. Theme toggle
  const themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
    });
  }

  // 2. Sidebar toggle & mobile overlay
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
  const sidebarCloseBtn = document.getElementById('sidebar-close-btn');

  const closeSidebar = () => {
    sidebar?.classList.remove('open');
    sidebarOverlay?.classList.remove('active');
  };

  sidebarToggleBtn?.addEventListener('click', () => {
    sidebar?.classList.toggle('open');
    sidebarOverlay?.classList.toggle('active');
  });
  sidebarCloseBtn?.addEventListener('click', closeSidebar);
  sidebarOverlay?.addEventListener('click', closeSidebar);

  // 2b. Sidebar MongoDB Connection Status Badge Click & Dynamic Event Listeners
  const dbBadge = document.getElementById('sidebar-db-badge') || document.querySelector('.storage-badge');
  if (dbBadge) {
    dbBadge.addEventListener('click', () => {
      syncSidebarDbStatus(true);
    });
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('qavora:db-status-change', (e) => {
      const status = e.detail?.database;
      if (status === 'connected' || status === 'disconnected' || status === 'connecting') {
        updateSidebarDbStatus(status);
      }
    });

    window.addEventListener('online', () => {
      syncSidebarDbStatus(true);
    });

    window.addEventListener('offline', () => {
      updateSidebarDbStatus('disconnected');
    });
  }

  // 3. Sidebar navigation links (.nav-link[data-view]) & browser popstate
  document.querySelectorAll('.nav-link[data-view]').forEach((navEl) => {
    navEl.addEventListener('click', (e) => {
      e.preventDefault();
      const viewName = navEl.getAttribute('data-view');
      if (viewName) {
        navigateTo(`/${viewName}`, true);
        closeSidebar();
      }
    });
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', (e) => {
      const targetRoute = e.state?.route || resolveInitialRoute();
      navigateTo(targetRoute, false);
    });
  }

  // 4. Notifications panel toggle & Account dropdown menu
  const notifBtn = document.getElementById('notification-btn');
  const notifPanel = document.getElementById('notification-panel');
  const notifMarkAll = document.getElementById('notification-mark-all-btn');
  const notifClearAll = document.getElementById('notification-clear-all-btn');

  const profileBtn = document.getElementById('header-user-profile-btn') || document.getElementById('header-user-profile');
  const accountMenu = document.getElementById('account-dropdown-menu');

  const closeAccountMenu = () => {
    if (accountMenu) {
      accountMenu.style.display = 'none';
      profileBtn?.setAttribute('aria-expanded', 'false');
    }
  };

  const closeNotifPanel = () => {
    if (notifPanel) {
      notifPanel.style.display = 'none';
      notifBtn?.setAttribute('aria-expanded', 'false');
    }
  };

  notifBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAccountMenu();
    if (!notifPanel) return;
    const isHidden = notifPanel.style.display === 'none' || !notifPanel.style.display;
    notifPanel.style.display = isHidden ? 'block' : 'none';
    notifBtn.setAttribute('aria-expanded', String(isHidden));
  });

  profileBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeNotifPanel();
    if (!accountMenu) return;
    const isHidden = accountMenu.style.display === 'none' || !accountMenu.style.display;
    accountMenu.style.display = isHidden ? 'flex' : 'none';
    profileBtn.setAttribute('aria-expanded', String(isHidden));
  });

  const accountSettingsBtn = document.getElementById('account-menu-settings-btn');
  accountSettingsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAccountMenu();
    navigateTo('/settings', true);
  });

  const accountDataBtn = document.getElementById('account-menu-data-btn');
  accountDataBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAccountMenu();
    navigateTo('/data', true);
  });

  const accountLogoutBtn = document.getElementById('account-menu-logout-btn');
  accountLogoutBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeAccountMenu();
    await authController.logout();
  });

  notifMarkAll?.addEventListener('click', () => {
    const unread = document.getElementById('notification-unread-count');
    const badge = document.getElementById('notification-count-badge');
    const indicator = document.getElementById('notification-indicator');
    if (unread) unread.style.display = 'none';
    if (badge) badge.style.display = 'none';
    if (indicator) indicator.style.display = 'none';
  });

  notifClearAll?.addEventListener('click', () => {
    const list = document.getElementById('notification-list');
    if (list) list.innerHTML = '<p class="notification-empty">No notifications</p>';
  });

  document.addEventListener('click', (e) => {
    if (
      notifPanel &&
      notifPanel.style.display === 'block' &&
      e.target instanceof Node &&
      !notifPanel.contains(e.target) &&
      e.target !== notifBtn
    ) {
      closeNotifPanel();
    }

    if (
      accountMenu &&
      accountMenu.style.display !== 'none' &&
      e.target instanceof Node &&
      !accountMenu.contains(e.target) &&
      e.target !== profileBtn &&
      !profileBtn?.contains(e.target)
    ) {
      closeAccountMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeNotifPanel();
      closeAccountMenu();
    }
  });

  // 5. Logout buttons (sidebar, header navbar, and account menu)
  const logoutButtons = document.querySelectorAll('#sidebar-logout-btn, #header-logout-btn');
  logoutButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      await authController.logout();
    });
  });

  // 6. Project Modal: Create & Edit Workflows
  const projectForm = document.getElementById('create-project-form');
  const projectModal = document.getElementById('project-modal');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalCancelBtn = document.getElementById('modal-cancel-btn');
  const submitBtn = document.getElementById('modal-submit-btn');
  const submitBtnText = document.getElementById('modal-submit-btn-text');

  let isSubmittingProject = false;

  document
    .querySelectorAll(
      '#header-create-btn, #projects-create-btn, #panel-new-project-btn, #hero-create-btn, .plans-create-project-btn, #empty-projects-create-btn, [data-action="new-project"]'
    )
    .forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openCreateProjectModal();
      });
    });

  modalCloseBtn?.addEventListener('click', closeProjectModal);
  modalCancelBtn?.addEventListener('click', closeProjectModal);
  projectModal?.addEventListener('click', (e) => {
    if (e.target === projectModal) {
      closeProjectModal();
    }
  });

  projectForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmittingProject) {
      return;
    }

    const nameInput = document.getElementById('project-name-input');
    const typeInput = document.getElementById('project-type-input');
    const statusInput = document.getElementById('project-status-input');
    const versionInput = document.getElementById('project-version-input');
    const descInput = document.getElementById('project-desc-input');
    const idInput = document.getElementById('project-id-input');
    const editingProjectId = idInput?.value?.trim();

    const name = nameInput?.value?.trim();
    if (!name) {
      const errAlert = document.getElementById('modal-error-alert');
      if (errAlert) errAlert.style.display = 'flex';
      return;
    }

    isSubmittingProject = true;
    const isEdit = Boolean(editingProjectId);
    const originalText = submitBtnText ? submitBtnText.textContent : (isEdit ? 'Save Changes' : 'Create Project');
    if (submitBtn) {
      submitBtn.disabled = true;
    }
    if (submitBtnText) {
      submitBtnText.textContent = isEdit ? 'Saving Changes...' : 'Creating Project...';
    }

    try {
      const payload = {
        name,
        type: typeInput?.value?.trim() || 'Web Application',
        status: statusInput?.value || 'Active',
        version: versionInput?.value?.trim() || '',
        description: descInput?.value?.trim() || ''
      };

      if (isEdit && editingProjectId) {
        const currentProj = getProjects().find((p) => p.id === editingProjectId);
        const expectedUpdatedAt = idInput?.dataset?.expectedUpdatedAt || currentProj?.updatedAt;
        if (expectedUpdatedAt) {
          payload.expectedUpdatedAt = expectedUpdatedAt;
        }
        const res = await updateProjectMetadata(editingProjectId, payload);
        if (res.ok) {
          updateSidebarProjectCounters();
          renderProjectsGrid();
          populateProjectsDropdown();
          renderProjectDetails(editingProjectId);
          if (getAppState().currentRoute === '/plans') {
            renderTestPlanWorkspace();
          }
          showToast('Project updated successfully.', 'success');
          closeProjectModal();
        } else if (res.status === 409) {
          await loadProjectsFromBackend();
          showToast(res.error || 'Conflict: This project was modified elsewhere. Workspace reloaded with latest data.', 'error');
          closeProjectModal();
        } else {
          showToast(res.error || 'Failed to update project.', 'error');
        }
      } else {
        const res = await createProject(payload);
        if (res.ok) {
          updateSidebarProjectCounters();
          renderProjectsGrid();
          populateProjectsDropdown();
          if (getAppState().currentRoute === '/plans') {
            renderTestPlanWorkspace();
          }
          showToast('Project created successfully.', 'success');
          closeProjectModal();
        } else {
          showToast(res.error || 'Failed to create project.', 'error');
        }
      }
    } catch {
      showToast('An unexpected error occurred while processing project.', 'error');
    } finally {
      isSubmittingProject = false;
      if (submitBtn) {
        submitBtn.disabled = false;
      }
      if (submitBtnText) {
        submitBtnText.textContent = originalText;
      }
    }
  });

  // 7. Universal Delete Confirmation Modal
  let isDeletingTarget = false;
  const deleteModal = document.getElementById('delete-modal');
  const deleteCloseBtn = document.getElementById('delete-close-btn');
  const deleteCancelBtn = document.getElementById('delete-cancel-btn');
  const deleteConfirmBtn = document.getElementById('delete-confirm-btn');
  const deleteConfirmBtnText = document.getElementById('delete-confirm-btn-text');

  deleteCloseBtn?.addEventListener('click', closeDeleteModal);
  deleteCancelBtn?.addEventListener('click', closeDeleteModal);
  deleteModal?.addEventListener('click', (e) => {
    if (e.target === deleteModal) closeDeleteModal();
  });

  deleteConfirmBtn?.addEventListener('click', async () => {
    if (isDeletingTarget) return;

    // Check custom pending delete (Phase, Suite, Case)
    const pending = getPendingDelete();
    if (pending && typeof pending.onConfirm === 'function') {
      isDeletingTarget = true;
      const originalText = deleteConfirmBtnText ? deleteConfirmBtnText.textContent : 'Delete';
      if (deleteConfirmBtn) deleteConfirmBtn.disabled = true;
      if (deleteConfirmBtnText) deleteConfirmBtnText.textContent = 'Deleting...';
      try {
        await pending.onConfirm();
      } finally {
        isDeletingTarget = false;
        if (deleteConfirmBtn) deleteConfirmBtn.disabled = false;
        if (deleteConfirmBtnText) deleteConfirmBtnText.textContent = originalText;
        setPendingDelete(null);
        closeDeleteModal();
      }
      return;
    }

    // Project delete (Phase 2 workflow)
    const targetProject = getPendingDeleteProject();
    if (!targetProject) return;

    isDeletingTarget = true;
    const originalText = deleteConfirmBtnText ? deleteConfirmBtnText.textContent : 'Delete';
    if (deleteConfirmBtn) deleteConfirmBtn.disabled = true;
    if (deleteConfirmBtnText) deleteConfirmBtnText.textContent = 'Deleting...';

    const targetId = targetProject.id;
    try {
      const res = await deleteProjectById(targetId);
      if (res.ok) {
        updateSidebarProjectCounters();
        renderProjectsGrid();
        populateProjectsDropdown();

        const appState = getAppState();
        if (appState.currentRoute === '/project-details' || appState.activeProjectId === targetId) {
          navigateTo('/projects');
        } else if (appState.currentRoute === '/plans') {
          renderTestPlanWorkspace();
        }

        showToast('Project deleted successfully.', 'success');
        closeDeleteModal();
      } else {
        showToast(res.error || 'Failed to delete project.', 'error');
      }
    } catch {
      showToast('An unexpected error occurred while deleting project.', 'error');
    } finally {
      isDeletingTarget = false;
      if (deleteConfirmBtn) deleteConfirmBtn.disabled = false;
      if (deleteConfirmBtnText) deleteConfirmBtnText.textContent = originalText;
    }
  });

  // 8. Projects Grid Click Delegation (navigation, edit, delete, empty-state, retry)
  const projectsGrid = document.getElementById('projects-grid');
  projectsGrid?.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    // A. Edit action button
    const editBtn = target.closest('[data-action="edit-project"]');
    if (editBtn) {
      e.stopPropagation();
      const projectId = editBtn.getAttribute('data-project-id');
      const project = getProjects().find((p) => p.id === projectId);
      if (project) openEditProjectModal(project);
      return;
    }

    // B. Delete action button
    const deleteBtn = target.closest('[data-action="delete-project"]');
    if (deleteBtn) {
      e.stopPropagation();
      const projectId = deleteBtn.getAttribute('data-project-id');
      const project = getProjects().find((p) => p.id === projectId);
      if (project) openDeleteProjectModal(project);
      return;
    }

    // C. Create from empty state
    const newProjBtn = target.closest('[data-action="new-project"]');
    if (newProjBtn) {
      e.stopPropagation();
      openCreateProjectModal();
      return;
    }

    // D. Retry from error state
    const retryBtn = target.closest('#projects-retry-btn');
    if (retryBtn) {
      e.stopPropagation();
      loadProjectsFromBackend().then(() => {
        populateProjectsDropdown();
      });
      return;
    }

    // E. Clear filters from empty filter state
    const resetFiltersCta = target.closest('#filter-reset-cta-btn');
    if (resetFiltersCta) {
      e.stopPropagation();
      const sInput = document.getElementById('project-search-input');
      const tSelect = document.getElementById('project-filter-type');
      const stSelect = document.getElementById('project-filter-status');
      if (sInput) sInput.value = '';
      if (tSelect) tSelect.value = 'ALL';
      if (stSelect) stSelect.value = 'ALL';
      renderProjectsGrid();
      return;
    }

    // F. Click on project card -> Navigate to details
    const card = target.closest('.project-card');
    if (card) {
      const projectId = card.getAttribute('data-project-id');
      if (projectId) {
        setActiveProjectId(projectId);
        renderProjectDetails(projectId);
        navigateTo(`/project-details?id=${encodeURIComponent(projectId)}`);
      }
    }
  });

  // 9. Dashboard Event Handlers & Recent Projects Delegation (Phase 4)
  document.getElementById('dash-open-reports-btn')?.addEventListener('click', () => {
    navigateTo('/reports');
  });

  document.getElementById('view-all-projects-btn')?.addEventListener('click', () => {
    navigateTo('/projects');
  });

  document.getElementById('clear-activity-btn')?.addEventListener('click', () => {
    showToast('Activity log is empty.', 'info');
  });

  const recentProjectsContainer = document.getElementById('recent-projects-container');
  recentProjectsContainer?.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    // A. Click on project item
    const item = target.closest('.project-item');
    if (item) {
      const projectId = item.getAttribute('data-project-id');
      if (projectId) {
        setActiveProjectId(projectId);
        renderProjectDetails(projectId);
        navigateTo(`/project-details?id=${encodeURIComponent(projectId)}`);
      }
      return;
    }

    // B. Create project from empty state
    const createBtn = target.closest('.dash-create-project-btn');
    if (createBtn) {
      openCreateProjectModal();
      return;
    }

    // C. Retry button from error state
    const retryBtn = target.closest('#dash-retry-projects-btn');
    if (retryBtn) {
      loadProjectsFromBackend().then(() => {
        renderDashboard();
      });
      return;
    }
  });

  recentProjectsContainer?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const target = e.target;
      if (target instanceof HTMLElement) {
        const item = target.closest('.project-item');
        if (item) {
          e.preventDefault();
          const projectId = item.getAttribute('data-project-id');
          if (projectId) {
            setActiveProjectId(projectId);
            renderProjectDetails(projectId);
            navigateTo(`/project-details?id=${encodeURIComponent(projectId)}`);
          }
        }
      }
    }
  });

  // 10. Search and Filters Toolbar
  const searchInput = document.getElementById('project-search-input');
  const typeSelect = document.getElementById('project-filter-type');
  const statusSelect = document.getElementById('project-filter-status');
  const sortSelect = document.getElementById('project-sort-by');
  const clearSearchBtn = document.getElementById('search-clear-btn');
  const clearFiltersBtn = document.getElementById('projects-clear-filters-btn');

  searchInput?.addEventListener('input', () => {
    renderProjectsGrid();
  });

  typeSelect?.addEventListener('change', () => {
    renderProjectsGrid();
  });

  statusSelect?.addEventListener('change', () => {
    renderProjectsGrid();
  });

  sortSelect?.addEventListener('change', () => {
    renderProjectsGrid();
  });

  clearSearchBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    renderProjectsGrid();
  });

  clearFiltersBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    if (typeSelect) typeSelect.value = 'ALL';
    if (statusSelect) statusSelect.value = 'ALL';
    if (sortSelect) sortSelect.value = 'newest';
    renderProjectsGrid();
  });

  // 11. Project Details View Action Buttons (Phase 4)
  document.getElementById('detail-back-crumb')?.addEventListener('click', () => {
    navigateTo('/projects');
  });

  document.getElementById('detail-back-btn')?.addEventListener('click', () => {
    navigateTo('/projects');
  });

  document.getElementById('detail-not-found-back-btn')?.addEventListener('click', () => {
    navigateTo('/projects');
  });

  document.getElementById('detail-edit-btn')?.addEventListener('click', () => {
    const current = getActiveProject();
    if (current) openEditProjectModal(current);
  });

  document.getElementById('detail-delete-btn')?.addEventListener('click', () => {
    const current = getActiveProject();
    if (current) openDeleteProjectModal(current);
  });

  document.getElementById('detail-open-plan-btn')?.addEventListener('click', () => {
    const current = getActiveProject();
    if (current) {
      setActiveProjectId(current.id);
      populateProjectsDropdown();
    }
    navigateTo('/plans');
  });

  document.getElementById('detail-goto-plans-btn')?.addEventListener('click', () => {
    const current = getActiveProject();
    if (current) {
      setActiveProjectId(current.id);
      populateProjectsDropdown();
    }
    navigateTo('/plans');
  });

  document.getElementById('detail-quick-add-phase-btn')?.addEventListener('click', () => {
    const current = getActiveProject();
    if (current) {
      setActiveProjectId(current.id);
      openPhaseModal();
    }
  });

  document.getElementById('detail-quick-add-suite-btn')?.addEventListener('click', () => {
    const current = getActiveProject();
    if (current) {
      setActiveProjectId(current.id);
      openSuiteModal();
    }
  });

  const detailSuitesContainer = document.getElementById('detail-suites-container');
  detailSuitesContainer?.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const runSuiteBtn = target.closest('[data-action="run-suite-exec"]');
    if (runSuiteBtn) {
      e.stopPropagation();
      const suiteId = runSuiteBtn.getAttribute('data-suite-id');
      const current = getActiveProject();
      if (current) {
        setActiveProjectId(current.id);
        populateProjectsDropdown();
      }
      if (suiteId) {
        getExecutionFilterState().suite = suiteId;
      }
      navigateTo(current ? `/execution?id=${encodeURIComponent(current.id)}&suite=${encodeURIComponent(suiteId || '')}` : '/execution');
      return;
    }

    const openSuiteBtn = target.closest('[data-action="open-suite-plan"]');
    if (openSuiteBtn) {
      e.stopPropagation();
      const suiteId = openSuiteBtn.getAttribute('data-suite-id');
      const current = getActiveProject();
      if (current) {
        setActiveProjectId(current.id);
        populateProjectsDropdown();
      }
      if (suiteId) {
        openSuiteExplorer(suiteId);
      }
      navigateTo('/plans');
      return;
    }

    const emptyAddBtn = target.closest('#detail-empty-create-suite-btn');
    if (emptyAddBtn) {
      e.stopPropagation();
      const current = getActiveProject();
      if (current) {
        setActiveProjectId(current.id);
      }
      openSuiteModal();
      return;
    }
  });

  document.getElementById('detail-exec-btn')?.addEventListener('click', () => {
    const current = getActiveProject();
    if (current) {
      setActiveProjectId(current.id);
      navigateTo(`/execution?id=${encodeURIComponent(current.id)}`);
    } else {
      navigateTo('/execution');
    }
  });

  document.getElementById('detail-defects-btn')?.addEventListener('click', () => {
    const current = getActiveProject();
    if (current) {
      setActiveProjectId(current.id);
      getDefectFilterState().projectId = current.id;
      navigateTo(`/defects?id=${encodeURIComponent(current.id)}`);
    } else {
      navigateTo('/defects');
    }
  });

  // ==========================================================================
  // PHASE 3: TEST PLANS, PHASES, SUITES & TEST CASES WORKFLOWS
  // ==========================================================================

  // 11. Active Projects Dropdown in #view-plans
  const plansProjectSelect = document.getElementById('plans-project-select');
  plansProjectSelect?.addEventListener('change', (e) => {
    const newProjectId = e.target.value;
    if (newProjectId) {
      setActiveProjectId(newProjectId);
      renderProjectDetails(newProjectId);
      renderTestPlanWorkspace();
    }
  });

  // 12. Test Plan Modal & Editing Workflow
  const testplanModal = document.getElementById('testplan-modal');
  const testplanCloseBtn = document.getElementById('testplan-modal-close');
  const testplanCancelBtn = document.getElementById('testplan-modal-cancel');
  const testplanForm = document.getElementById('testplan-form');
  const editPlanBtn = document.getElementById('plans-edit-plan-btn');

  editPlanBtn?.addEventListener('click', () => {
    openTestPlanModal();
  });

  testplanCloseBtn?.addEventListener('click', closeTestPlanModal);
  testplanCancelBtn?.addEventListener('click', closeTestPlanModal);
  testplanModal?.addEventListener('click', (e) => {
    if (e.target === testplanModal) closeTestPlanModal();
  });

  let isSubmittingTestPlan = false;
  testplanForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmittingTestPlan) return;

    const nameInput = document.getElementById('plan-name-input');
    const objInput = document.getElementById('plan-objective-input');
    const scopeInput = document.getElementById('plan-scope-input');
    const descInput = document.getElementById('plan-desc-input');

    const name = nameInput?.value?.trim();
    if (!name) {
      showToast('Test plan name is required.', 'error');
      nameInput?.focus();
      return;
    }

    isSubmittingTestPlan = true;
    const saveBtn = testplanForm.querySelector('button[type="submit"]');
    const originalText = saveBtn ? saveBtn.textContent : 'Save Test Plan';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving Test Plan...';
    }

    try {
      const res = await saveTestPlan({
        name,
        objective: objInput?.value?.trim() || '',
        scope: scopeInput?.value?.trim() || '',
        description: descInput?.value?.trim() || ''
      });
      if (res.ok) {
        showToast('Test plan updated successfully.', 'success');
        closeTestPlanModal();
        renderTestPlanWorkspace();
      } else {
        showToast(res.error || 'Failed to update test plan.', 'error');
      }
    } catch {
      showToast('An unexpected error occurred while saving test plan.', 'error');
    } finally {
      isSubmittingTestPlan = false;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
      }
    }
  });

  // 13. Phase Modal & Adding/Editing Workflow
  const phaseModal = document.getElementById('phase-modal');
  const phaseCloseBtn = document.getElementById('phase-modal-close');
  const phaseCancelBtn = document.getElementById('phase-modal-cancel');
  const phaseForm = document.getElementById('phase-form');
  const phaseSubmitBtn = phaseForm?.querySelector('button[type="submit"]');
  const phaseSubmitText = document.getElementById('phase-modal-submit-text');

  document.querySelectorAll('#plans-add-phase-btn, #phases-add-btn-secondary').forEach((btn) => {
    btn.addEventListener('click', () => {
      openPhaseModal(null);
    });
  });

  phaseCloseBtn?.addEventListener('click', closePhaseModal);
  phaseCancelBtn?.addEventListener('click', closePhaseModal);
  phaseModal?.addEventListener('click', (e) => {
    if (e.target === phaseModal) closePhaseModal();
  });

  let isSubmittingPhase = false;
  phaseForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmittingPhase) return;

    const idInput = document.getElementById('phase-id-input');
    const nameInput = document.getElementById('phase-name-input');
    const descInput = document.getElementById('phase-desc-input');
    const errAlert = document.getElementById('phase-error-alert');

    const phaseId = idInput?.value?.trim();
    const name = nameInput?.value?.trim();

    if (!name) {
      if (errAlert) errAlert.style.display = 'flex';
      nameInput?.focus();
      return;
    }
    if (errAlert) errAlert.style.display = 'none';

    isSubmittingPhase = true;
    const isEdit = Boolean(phaseId);
    const originalText = phaseSubmitText ? phaseSubmitText.textContent : (isEdit ? 'Save Changes' : 'Add Phase');
    if (phaseSubmitBtn) phaseSubmitBtn.disabled = true;
    if (phaseSubmitText) phaseSubmitText.textContent = isEdit ? 'Saving...' : 'Adding Phase...';

    try {
      const payload = {
        name,
        description: descInput?.value?.trim() || ''
      };

      const res = isEdit ? await updatePhase(phaseId, payload) : await addPhase(payload);
      if (res.ok) {
        showToast(isEdit ? 'Testing phase updated.' : 'Testing phase created.', 'success');
        closePhaseModal();
        renderTestPlanWorkspace();
      } else {
        showToast(res.error || 'Failed to save phase.', 'error');
      }
    } catch {
      showToast('An error occurred while saving testing phase.', 'error');
    } finally {
      isSubmittingPhase = false;
      if (phaseSubmitBtn) phaseSubmitBtn.disabled = false;
      if (phaseSubmitText) phaseSubmitText.textContent = originalText;
    }
  });

  // 14. Suite Modal & Adding/Editing Workflow
  const suiteModal = document.getElementById('suite-modal');
  const suiteCloseBtn = document.getElementById('suite-modal-close');
  const suiteCancelBtn = document.getElementById('suite-modal-cancel');
  const suiteForm = document.getElementById('suite-form');
  const suiteSubmitBtn = suiteForm?.querySelector('button[type="submit"]');
  const suiteSubmitText = document.getElementById('suite-modal-submit-text');
  const suiteCatSelect = document.getElementById('suite-category-select');
  const suiteCustomCatGroup = document.getElementById('suite-custom-cat-group');

  suiteCatSelect?.addEventListener('change', () => {
    if (suiteCustomCatGroup) {
      suiteCustomCatGroup.style.display = suiteCatSelect.value === 'CUSTOM' ? 'block' : 'none';
    }
  });

  suiteCloseBtn?.addEventListener('click', closeSuiteModal);
  suiteCancelBtn?.addEventListener('click', closeSuiteModal);
  suiteModal?.addEventListener('click', (e) => {
    if (e.target === suiteModal) closeSuiteModal();
  });

  let isSubmittingSuite = false;
  suiteForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmittingSuite) return;

    const idInput = document.getElementById('suite-id-input');
    const phaseSelect = document.getElementById('suite-phase-select');
    const nameInput = document.getElementById('suite-name-input');
    const catSelect = document.getElementById('suite-category-select');
    const customCatInput = document.getElementById('suite-custom-cat-input');
    const tagsInput = document.getElementById('suite-tags-input');
    const descInput = document.getElementById('suite-desc-input');
    const errAlert = document.getElementById('suite-error-alert');

    const suiteId = idInput?.value?.trim();
    const phaseId = phaseSelect?.value?.trim();
    const name = nameInput?.value?.trim();

    if (!name || !phaseId) {
      if (errAlert) errAlert.style.display = 'flex';
      return;
    }
    if (errAlert) errAlert.style.display = 'none';

    let category = catSelect?.value || 'Functional';
    if (category === 'CUSTOM') {
      category = customCatInput?.value?.trim() || 'Custom';
    }

    const tags = tagsInput?.value
      ? tagsInput.value
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    isSubmittingSuite = true;
    const isEdit = Boolean(suiteId);
    const originalText = suiteSubmitText ? suiteSubmitText.textContent : (isEdit ? 'Save Changes' : 'Add Test Suite');
    if (suiteSubmitBtn) suiteSubmitBtn.disabled = true;
    if (suiteSubmitText) suiteSubmitText.textContent = isEdit ? 'Saving...' : 'Adding Suite...';

    try {
      const payload = {
        id: suiteId || undefined,
        phaseId,
        name,
        category,
        tags,
        description: descInput?.value?.trim() || ''
      };

      const res = await saveTestSuite(payload);
      if (res.ok) {
        showToast(isEdit ? 'Test suite updated.' : 'Test suite added.', 'success');
        closeSuiteModal();
        renderTestPlanWorkspace();
      } else {
        showToast(res.error || 'Failed to save test suite.', 'error');
      }
    } catch {
      showToast('An error occurred while saving test suite.', 'error');
    } finally {
      isSubmittingSuite = false;
      if (suiteSubmitBtn) suiteSubmitBtn.disabled = false;
      if (suiteSubmitText) suiteSubmitText.textContent = originalText;
    }
  });

  // 15. Phases Container Delegation (Phases & Suites buttons)
  const phasesContainer = document.getElementById('phases-container');
  phasesContainer?.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    // A. Add first phase from empty state
    if (target.closest('.btn-empty-add-phase')) {
      e.stopPropagation();
      openPhaseModal(null);
      return;
    }

    // B. Add suite to phase
    const addSuiteBtn = target.closest('.btn-phase-add-suite');
    if (addSuiteBtn) {
      e.stopPropagation();
      const phaseId = addSuiteBtn.getAttribute('data-phase-id');
      openSuiteModal(null, phaseId);
      return;
    }

    // C. Edit phase
    const editPhaseBtn = target.closest('.btn-phase-edit');
    if (editPhaseBtn) {
      e.stopPropagation();
      const phaseId = editPhaseBtn.getAttribute('data-phase-id');
      const project = getActiveProject();
      const phase = project?.testPlan?.phases?.find((p) => p.id === phaseId);
      if (phase) openPhaseModal(phase);
      return;
    }

    // D. Delete phase
    const deletePhaseBtn = target.closest('.btn-phase-delete');
    if (deletePhaseBtn) {
      e.stopPropagation();
      const phaseId = deletePhaseBtn.getAttribute('data-phase-id');
      const project = getActiveProject();
      const phase = project?.testPlan?.phases?.find((p) => p.id === phaseId);
      if (phase) {
        openDeleteConfirmModal({
          type: 'phase',
          target: `Phase "${phase.name}"`,
          warning: 'This will permanently delete this phase and all test suites and test cases within it.',
          onConfirm: async () => {
            const res = await deletePhase(phaseId);
            if (res.ok) {
              showToast('Testing phase deleted.', 'success');
              renderTestPlanWorkspace();
            } else {
              showToast(res.error || 'Failed to delete phase.', 'error');
            }
          }
        });
      }
      return;
    }

    // E. Edit suite
    const editSuiteBtn = target.closest('.btn-suite-edit');
    if (editSuiteBtn) {
      e.stopPropagation();
      const suiteId = editSuiteBtn.getAttribute('data-suite-id');
      const project = getActiveProject();
      const suite = project?.testSuites?.find((s) => s.id === suiteId);
      if (suite) openSuiteModal(suite);
      return;
    }

    // F. Delete suite
    const deleteSuiteBtn = target.closest('.btn-suite-delete');
    if (deleteSuiteBtn) {
      e.stopPropagation();
      const suiteId = deleteSuiteBtn.getAttribute('data-suite-id');
      const project = getActiveProject();
      const suite = project?.testSuites?.find((s) => s.id === suiteId);
      if (suite) {
        openDeleteConfirmModal({
          type: 'suite',
          target: `Suite "${suite.name}"`,
          warning: 'This will permanently delete this suite and all test cases contained within it.',
          onConfirm: async () => {
            const res = await deleteTestSuite(suiteId);
            if (res.ok) {
              showToast('Test suite deleted.', 'success');
              if (getActiveSuiteId() === suiteId) {
                closeSuiteExplorer();
              } else {
                renderTestPlanWorkspace();
              }
            } else {
              showToast(res.error || 'Failed to delete suite.', 'error');
            }
          }
        });
      }
      return;
    }

    // G. Open suite / click on suite card
    const suiteCard = target.closest('.suite-card');
    if (suiteCard) {
      const suiteId = suiteCard.getAttribute('data-suite-id');
      if (suiteId) openSuiteExplorer(suiteId);
    }
  });

  // 16. Suite Explorer Subview Controls
  document.getElementById('cases-back-to-phases-btn')?.addEventListener('click', () => {
    closeSuiteExplorer();
  });

  document.getElementById('suite-edit-this-btn')?.addEventListener('click', () => {
    const activeSuiteId = getActiveSuiteId();
    const project = getActiveProject();
    const suite = project?.testSuites?.find((s) => s.id === activeSuiteId);
    if (suite) openSuiteModal(suite);
  });

  document.getElementById('suite-add-case-btn')?.addEventListener('click', () => {
    openTestCaseModal(null, getActiveSuiteId());
  });

  const caseSearchInput = document.getElementById('case-search-input');
  const casePriorityFilter = document.getElementById('case-filter-priority');
  const caseCategoryFilter = document.getElementById('case-filter-category');
  const caseSortBy = document.getElementById('case-sort-by');
  const caseSearchClearBtn = document.getElementById('case-search-clear-btn');
  const caseClearFiltersBtn = document.getElementById('case-clear-filters-btn');

  caseSearchInput?.addEventListener('input', () => renderTestCasesTable());
  casePriorityFilter?.addEventListener('change', () => renderTestCasesTable());
  caseCategoryFilter?.addEventListener('change', () => renderTestCasesTable());
  caseSortBy?.addEventListener('change', () => renderTestCasesTable());

  caseSearchClearBtn?.addEventListener('click', () => {
    if (caseSearchInput) caseSearchInput.value = '';
    renderTestCasesTable();
  });

  caseClearFiltersBtn?.addEventListener('click', () => {
    if (caseSearchInput) caseSearchInput.value = '';
    if (casePriorityFilter) casePriorityFilter.value = 'ALL';
    if (caseCategoryFilter) caseCategoryFilter.value = 'ALL';
    if (caseSortBy) caseSortBy.value = 'newest';
    renderTestCasesTable();
  });

  // 17. Test Case Modal & Dynamic Steps Builder
  const caseModal = document.getElementById('testcase-modal');
  const caseCloseBtn = document.getElementById('case-modal-close');
  const caseCancelBtn = document.getElementById('case-modal-cancel');
  const caseForm = document.getElementById('case-form');
  const caseSubmitBtn = caseForm?.querySelector('button[type="submit"]');
  const caseSubmitText = document.getElementById('case-modal-submit-text');
  const addStepBtn = document.getElementById('btn-add-step');
  const stepsList = document.getElementById('tc-steps-list');

  addStepBtn?.addEventListener('click', () => {
    addStepRow('', '');
  });

  stepsList?.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const row = target.closest('.step-row');
    if (!row) return;

    if (target.closest('.step-btn-remove')) {
      row.remove();
      renumberStepRows();
      return;
    }

    if (target.closest('.step-btn-up')) {
      const prev = row.previousElementSibling;
      if (prev && stepsList) {
        stepsList.insertBefore(row, prev);
        renumberStepRows();
      }
      return;
    }

    if (target.closest('.step-btn-down')) {
      const next = row.nextElementSibling;
      if (next && stepsList) {
        stepsList.insertBefore(next, row);
        renumberStepRows();
      }
      return;
    }
  });

  caseCloseBtn?.addEventListener('click', closeTestCaseModal);
  caseCancelBtn?.addEventListener('click', closeTestCaseModal);
  caseModal?.addEventListener('click', (e) => {
    if (e.target === caseModal) closeTestCaseModal();
  });

  let isSubmittingCase = false;
  caseForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmittingCase) return;

    const idInput = document.getElementById('case-id-input');
    const suiteIdInput = document.getElementById('case-suite-id-input');
    const titleInput = document.getElementById('case-title-input');
    const prioritySelect = document.getElementById('case-priority-select');
    const catInput = document.getElementById('case-category-input');
    const tagsInput = document.getElementById('case-tags-input');
    const descInput = document.getElementById('case-desc-input');
    const precondInput = document.getElementById('case-preconditions-input');
    const expectedInput = document.getElementById('case-expected-input');
    const errAlert = document.getElementById('case-error-alert');

    const caseId = idInput?.value?.trim();
    const suiteId = suiteIdInput?.value?.trim() || getActiveSuiteId();
    const title = titleInput?.value?.trim();
    const expectedResult = expectedInput?.value?.trim();

    if (!title || !expectedResult || !suiteId) {
      if (errAlert) errAlert.style.display = 'flex';
      return;
    }
    if (errAlert) errAlert.style.display = 'none';

    const tags = tagsInput?.value
      ? tagsInput.value
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    const steps = collectStepsFromBuilder();

    isSubmittingCase = true;
    const isEdit = Boolean(caseId);
    const originalText = caseSubmitText ? caseSubmitText.textContent : (isEdit ? 'Save Changes' : 'Save Test Case');
    if (caseSubmitBtn) caseSubmitBtn.disabled = true;
    if (caseSubmitText) caseSubmitText.textContent = isEdit ? 'Saving...' : 'Creating...';

    try {
      const payload = {
        id: caseId || undefined,
        title,
        priority: prioritySelect?.value || 'High',
        category: catInput?.value?.trim() || 'Functional',
        tags,
        description: descInput?.value?.trim() || '',
        preconditions: precondInput?.value?.trim() || '',
        steps,
        expectedResult
      };

      const res = await saveTestCase(suiteId, payload);
      if (res.ok) {
        showToast(isEdit ? 'Test case updated.' : 'Test case created.', 'success');
        closeTestCaseModal();
        renderTestPlanWorkspace();
      } else {
        showToast(res.error || 'Failed to save test case.', 'error');
      }
    } catch {
      showToast('An error occurred while saving test case.', 'error');
    } finally {
      isSubmittingCase = false;
      if (caseSubmitBtn) caseSubmitBtn.disabled = false;
      if (caseSubmitText) caseSubmitText.textContent = originalText;
    }
  });

  // 18. Cases Table Click Delegation
  const casesTableContainer = document.getElementById('cases-table-container');
  casesTableContainer?.addEventListener('click', async (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.closest('.btn-empty-add-case')) {
      e.stopPropagation();
      openTestCaseModal(null, getActiveSuiteId());
      return;
    }

    if (target.closest('#btn-reset-case-filters')) {
      e.stopPropagation();
      if (caseSearchInput) caseSearchInput.value = '';
      if (casePriorityFilter) casePriorityFilter.value = 'ALL';
      if (caseCategoryFilter) caseCategoryFilter.value = 'ALL';
      if (caseSortBy) caseSortBy.value = 'newest';
      renderTestCasesTable();
      return;
    }

    const suiteId = getActiveSuiteId();
    const project = getActiveProject();
    const suite = project?.testSuites?.find((s) => s.id === suiteId);
    const caseId = target.closest('[data-case-id]')?.getAttribute('data-case-id');
    const testCase = suite?.cases?.find((c) => c.id === caseId);

    // Execute case directly from plans workspace
    if (target.closest('[data-action="execute-case"]')) {
      e.stopPropagation();
      if (testCase) {
        openExecutionModal({ ...testCase, suiteId, suiteName: suite?.name || 'Suite' }, project?.id);
      }
      return;
    }

    // View / inspect case
    if (target.closest('[data-action="view-case"]')) {
      e.stopPropagation();
      if (testCase && suite) openTestCaseViewModal(testCase, suite);
      return;
    }

    // Edit case
    if (target.closest('[data-action="edit-case"]')) {
      e.stopPropagation();
      if (testCase) openTestCaseModal(testCase, suiteId);
      return;
    }

    // Duplicate case
    if (target.closest('[data-action="duplicate-case"]')) {
      e.stopPropagation();
      if (suiteId && caseId) {
        const res = await duplicateTestCase(suiteId, caseId);
        if (res.ok) {
          showToast('Test case duplicated.', 'success');
          renderTestPlanWorkspace();
        } else {
          showToast(res.error || 'Failed to duplicate test case.', 'error');
        }
      }
      return;
    }

    // Delete case
    if (target.closest('[data-action="delete-case"]')) {
      e.stopPropagation();
      if (testCase && suiteId) {
        openDeleteConfirmModal({
          type: 'case',
          target: `Test Case "${testCase.testCaseId ? testCase.testCaseId + ': ' : ''}${testCase.title}"`,
          warning: 'This will permanently delete this test case.',
          onConfirm: async () => {
            const res = await deleteTestCase(suiteId, caseId);
            if (res.ok) {
              showToast('Test case deleted.', 'success');
              renderTestPlanWorkspace();
            } else {
              showToast(res.error || 'Failed to delete test case.', 'error');
            }
          }
        });
      }
      return;
    }
  });

  // 19. Test Case Inspection Modal Actions
  const viewCaseModal = document.getElementById('testcase-view-modal');
  const viewCaseCloseBtn = document.getElementById('view-case-close');
  const viewCaseDupBtn = document.getElementById('view-case-duplicate-btn');
  const viewCaseEditBtn = document.getElementById('view-case-edit-btn');
  const viewCaseExecBtn = document.getElementById('view-case-execute-btn');

  viewCaseCloseBtn?.addEventListener('click', closeTestCaseViewModal);
  viewCaseModal?.addEventListener('click', (e) => {
    if (e.target === viewCaseModal) closeTestCaseViewModal();
  });

  viewCaseExecBtn?.addEventListener('click', () => {
    const currentCase = getCurrentViewingCase();
    const currentSuite = getCurrentViewingSuite();
    const currentProj = getActiveProject();
    if (currentCase) {
      closeTestCaseViewModal();
      openExecutionModal({ ...currentCase, suiteId: currentSuite?.id, suiteName: currentSuite?.name || 'Suite' }, currentProj?.id);
    }
  });

  viewCaseDupBtn?.addEventListener('click', async () => {
    const currentCase = getCurrentViewingCase();
    const currentSuite = getCurrentViewingSuite();
    if (currentCase && currentSuite) {
      const res = await duplicateTestCase(currentSuite.id, currentCase.id);
      if (res.ok) {
        showToast('Test case duplicated.', 'success');
        closeTestCaseViewModal();
        renderTestPlanWorkspace();
      } else {
        showToast(res.error || 'Failed to duplicate test case.', 'error');
      }
    }
  });

  viewCaseEditBtn?.addEventListener('click', () => {
    const currentCase = getCurrentViewingCase();
    const currentSuite = getCurrentViewingSuite();
    if (currentCase && currentSuite) {
      closeTestCaseViewModal();
      openTestCaseModal(currentCase, currentSuite.id);
    }
  });
}

// ============================================================================
// MongoDB Connection Status Badge Manager
// ============================================================================
let _dbStatusCheckInFlight = null;
let _lastDbStatus = null;

export function updateSidebarDbStatus(status) {
  if (typeof document === 'undefined') return;
  const badge = document.getElementById('sidebar-db-badge') || document.querySelector('.storage-badge');
  const dot = document.getElementById('sidebar-db-dot') || document.querySelector('.storage-badge .storage-dot');
  const text = document.getElementById('sidebar-db-text') || document.querySelector('.storage-badge .storage-text');

  if (!dot || !text) return;

  dot.classList.remove('connected');
  dot.classList.remove('disconnected');
  dot.classList.remove('connecting');

  if (status === 'connected') {
    _lastDbStatus = 'connected';
    dot.classList.add('connected');
    text.textContent = 'MongoDB Connected';
    if (badge) badge.setAttribute('title', 'MongoDB database is connected and active. Click to refresh.');
  } else if (status === 'connecting') {
    _lastDbStatus = 'connecting';
    dot.classList.add('connecting');
    text.textContent = 'MongoDB Connecting...';
    if (badge) badge.setAttribute('title', 'Connecting to MongoDB database...');
  } else {
    _lastDbStatus = 'disconnected';
    dot.classList.add('disconnected');
    text.textContent = 'MongoDB Disconnected';
    if (badge) badge.setAttribute('title', 'MongoDB database is disconnected or offline. Click to retry.');
  }
}

export async function syncSidebarDbStatus(force = false) {
  if (typeof document === 'undefined') return _lastDbStatus;

  // Deduplicate overlapping requests
  if (_dbStatusCheckInFlight) {
    return _dbStatusCheckInFlight;
  }

  if (!_lastDbStatus || _lastDbStatus === 'connecting' || force) {
    updateSidebarDbStatus('connecting');
  }

  _dbStatusCheckInFlight = (async () => {
    try {
      const health = await checkBackendHealth();
      const status = health && health.database === 'connected' ? 'connected' : 'disconnected';
      updateSidebarDbStatus(status);
      return status;
    } catch {
      updateSidebarDbStatus('disconnected');
      return 'disconnected';
    } finally {
      _dbStatusCheckInFlight = null;
    }
  })();

  return _dbStatusCheckInFlight;
}
