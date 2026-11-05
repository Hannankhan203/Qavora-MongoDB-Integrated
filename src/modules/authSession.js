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

  const headerAvatar = document.getElementById('header-user-avatar');
  const headerName = document.getElementById('header-user-name');
  const headerRole = document.getElementById('header-user-role');

  const dropAvatar = document.getElementById('account-dropdown-avatar');
  const dropName = document.getElementById('account-dropdown-name');
  const dropEmail = document.getElementById('account-dropdown-email');
  const dropRole = document.getElementById('account-dropdown-role');

  if (user) {
    const initials = user.avatarInitials || (user.name ? user.name.slice(0, 2).toUpperCase() : 'QA');
    const displayName = user.name || user.email || 'QA User';
    const roleTitle = user.role || 'QA Tester';
    const emailAddr = user.email || `${user.username || 'user'}@qavora.internal`;

    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) roleEl.textContent = roleTitle;
    if (avatarEl) avatarEl.textContent = initials;

    if (headerName) headerName.textContent = displayName;
    if (headerRole) headerRole.textContent = roleTitle;
    if (headerAvatar) headerAvatar.textContent = initials;

    if (dropAvatar) dropAvatar.textContent = initials;
    if (dropName) dropName.textContent = displayName;
    if (dropEmail) dropEmail.textContent = emailAddr;
    if (dropRole) dropRole.textContent = roleTitle;
  } else {
    if (nameEl) nameEl.textContent = 'Guest';
    if (roleEl) roleEl.textContent = 'Not signed in';
    if (avatarEl) avatarEl.textContent = 'QA';

    if (headerName) headerName.textContent = 'QA Tester';
    if (headerRole) headerRole.textContent = 'Manual QA';
    if (headerAvatar) headerAvatar.textContent = 'QA';

    if (dropAvatar) dropAvatar.textContent = 'QA';
    if (dropName) dropName.textContent = 'QA Tester';
    if (dropEmail) dropEmail.textContent = 'tester@qavora.internal';
    if (dropRole) dropRole.textContent = 'Manual QA';
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
