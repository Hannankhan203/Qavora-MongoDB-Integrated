/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — UI Rendering, Routing, Event Bindings & Toast Notifications Module (CQ-003)
 */

import authController from '../../authController.js';
import { getAppState } from './state.js';
import { createProject, updateSidebarProjectCounters } from './projectManager.js';

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
  appState.currentRoute = route || '/projects';

  if (typeof window !== 'undefined' && pushState && window.location.pathname !== appState.currentRoute) {
    try {
      window.history.pushState({ route: appState.currentRoute }, '', appState.currentRoute);
    } catch {
      // Ignore history pushState errors
    }
  }

  if (typeof document !== 'undefined') {
    const navLinks = document.querySelectorAll('[data-route]');
    navLinks.forEach((el) => {
      const target = el.getAttribute('data-route');
      el.classList.toggle('active', target === appState.currentRoute);
    });

    const routeSlug = appState.currentRoute.replace(/^\//, '').split('/')[0] || 'projects';
    const views = document.querySelectorAll('[data-view], .view-section');
    views.forEach((view) => {
      const viewName = view.getAttribute('data-view') || view.id.replace(/^view-/, '');
      const isMatch = viewName === routeSlug || (routeSlug === 'projects' && viewName === 'my-projects');
      view.style.display = isMatch ? '' : 'none';
      view.classList.toggle('active', isMatch);
    });
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

  // 3. Sidebar navigation links
  document.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target.closest('[data-route]') : null;
    if (target) {
      e.preventDefault();
      const route = target.getAttribute('data-route');
      if (route) {
        navigateTo(route, true);
        closeSidebar();
      }
    }
  });

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
  const projectModal = document.getElementById('project-modal');
  const openProjectModalBtns = document.querySelectorAll(
    '#panel-new-project-btn, .plans-create-project-btn, [data-action="new-project"]'
  );
  openProjectModalBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (projectModal) {
        projectModal.style.display = 'flex';
        projectModal.classList.add('open');
      }
    });
  });

  const projectForm = document.getElementById('project-form');
  projectForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('project-name-input');
    const typeInput = document.getElementById('project-type-input');
    const name = nameInput?.value?.trim();
    if (!name) return;
    const res = await createProject({
      name,
      type: typeInput?.value?.trim() || 'Web App'
    });
    if (res.ok) {
      updateSidebarProjectCounters();
      showToast('Project created successfully.', 'success');
      if (projectModal) {
        projectModal.style.display = 'none';
        projectModal.classList.remove('open');
      }
      projectForm.reset();
    } else {
      showToast(res.error || 'Failed to create project.', 'error');
    }
  });
}
