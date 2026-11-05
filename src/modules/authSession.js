/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Authentication & Session Management Module (CQ-003)
 */

import authController from '../../authController.js';
import { initAuthUI } from '../../authUI.js';

export function updateUserProfileUI(user) {
  if (typeof document === 'undefined') return;
  const nameEl = document.getElementById('sidebar-user-name');
  const roleEl = document.getElementById('sidebar-user-role');
  const avatarEl = document.getElementById('sidebar-user-avatar');

  if (user) {
    if (nameEl) nameEl.textContent = user.name || user.email || 'QA User';
    if (roleEl) roleEl.textContent = user.role || 'QA Tester';
    if (avatarEl) {
      avatarEl.textContent =
        user.avatarInitials ||
        (user.name ? user.name.slice(0, 2).toUpperCase() : 'QA');
    }
  } else {
    if (nameEl) nameEl.textContent = 'Guest';
    if (roleEl) roleEl.textContent = 'Not signed in';
    if (avatarEl) avatarEl.textContent = 'QA';
  }
}

export async function initAuthAndSession({ onAuthenticated, onUnauthenticated }) {
  if (typeof initAuthUI === 'function') {
    initAuthUI();
  }

  authController.onAuthStateChanged(async (snapshot) => {
    updateUserProfileUI(snapshot.user);
    if (snapshot.isAuthenticated && snapshot.user) {
      if (typeof onAuthenticated === 'function') {
        await onAuthenticated(snapshot.user);
      }
    } else if (snapshot.state === 'unauthenticated') {
      if (typeof onUnauthenticated === 'function') {
        onUnauthenticated();
      }
    }
  });

  return authController.init();
}
