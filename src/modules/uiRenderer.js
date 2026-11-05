/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — UI Rendering, Routing & Toast Notifications Module (CQ-003)
 */

import { getAppState } from './state.js';

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
  }
}

export function resolveInitialRoute() {
  if (typeof window === 'undefined') return '/projects';
  const pathname = window.location.pathname || '/projects';
  if (pathname === '/' || pathname === '') return '/projects';
  return pathname;
}
