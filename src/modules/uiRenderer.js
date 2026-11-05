/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — UI Rendering, Routing, Event Bindings & Toast Notifications Module (CQ-003)
 */

import authController from '../../authController.js';
import { getAppState } from './state.js';
import { createProject, updateSidebarProjectCounters, renderProjectsGrid } from './projectManager.js';

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

  if (typeof window !== 'undefined' && pushState && window.location.pathname !== cleanRoute) {
    try {
      window.history.pushState({ route: cleanRoute }, '', cleanRoute);
    } catch {
      // Ignore history pushState errors
    }
  }

  if (typeof document !== 'undefined') {
    const viewSlug = cleanRoute.replace(/^\//, '').split('/')[0] || 'projects';

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
  }
}

export function resolveInitialRoute() {
  if (typeof window === 'undefined') return '/projects';
  const pathname = window.location.pathname || '/projects';
  if (pathname === '/' || pathname === '') return '/projects';
  return pathname;
}

export function initUIEventListeners() {
  if (typeof document === 'undefined' || _listenersBound) return;
  _listenersBound = true;

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
    window.addEventListener('popstate', () => {
      navigateTo(resolveInitialRoute(), false);
    });
  }

  // 4. Notifications panel toggle
  const notifBtn = document.getElementById('notification-btn');
  const notifPanel = document.getElementById('notification-panel');
  const notifMarkAll = document.getElementById('notification-mark-all-btn');
  const notifClearAll = document.getElementById('notification-clear-all-btn');

  notifBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!notifPanel) return;
    const isHidden = notifPanel.style.display === 'none' || !notifPanel.style.display;
    notifPanel.style.display = isHidden ? 'block' : 'none';
    notifBtn.setAttribute('aria-expanded', String(isHidden));
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
      notifPanel.style.display = 'none';
      notifBtn?.setAttribute('aria-expanded', 'false');
    }
  });

  // 5. Logout button
  const logoutBtn = document.getElementById('sidebar-logout-btn');
  logoutBtn?.addEventListener('click', async () => {
    await authController.logout();
  });

  // 6. New Project modal & buttons
  const projectForm = document.getElementById('create-project-form');
  const projectModal = document.getElementById('project-modal');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalCancelBtn = document.getElementById('modal-cancel-btn');

  const openProjectModal = () => {
    if (projectModal) {
      projectModal.classList.add('open');
      projectModal.setAttribute('aria-hidden', 'false');
    }
  };

  const closeProjectModal = () => {
    if (projectModal) {
      projectModal.classList.remove('open');
      projectModal.setAttribute('aria-hidden', 'true');
    }
  };

  document
    .querySelectorAll(
      '#projects-create-btn, #panel-new-project-btn, .plans-create-project-btn, #empty-projects-create-btn, [data-action="new-project"]'
    )
    .forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openProjectModal();
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
    const nameInput = document.getElementById('project-name-input');
    const typeInput = document.getElementById('project-type-input');
    const name = nameInput?.value?.trim();
    if (!name) {
      const errAlert = document.getElementById('modal-error-alert');
      if (errAlert) errAlert.style.display = 'flex';
      return;
    }
    const res = await createProject({
      name,
      type: typeInput?.value?.trim() || 'Web App'
    });
    if (res.ok) {
      updateSidebarProjectCounters();
      renderProjectsGrid();
      showToast('Project created successfully.', 'success');
      closeProjectModal();
      projectForm.reset();
    } else {
      showToast(res.error || 'Failed to create project.', 'error');
    }
  });
}
