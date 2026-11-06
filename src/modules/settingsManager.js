/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Workspace Settings, Account Profile & Preferences Module (Phase 6)
 */

import authController from '../../authController.js';
import { apiFetch, apiJson } from './apiClient.js';
import { getProjects } from './state.js';
import { showToast, navigateTo } from './uiRenderer.js';
import { escapeHtml } from './utils.js';

let _settingsListenersBound = false;

export function renderSettingsWorkspace() {
  if (typeof document === 'undefined') return;

  const user = authController.getCurrentUser();

  // 1. Render Account Profile card
  if (user) {
    const avatarEl = document.getElementById('settings-account-avatar');
    const emailEl = document.getElementById('settings-account-email');
    const roleBadgeEl = document.getElementById('settings-account-role-badge');
    const joinedEl = document.getElementById('settings-account-joined');
    const lastLoginEl = document.getElementById('settings-account-lastlogin');
    const nameInput = document.getElementById('settings-profile-name');
    const roleInput = document.getElementById('settings-profile-role');

    const initials = user.avatarInitials || (user.name ? user.name.slice(0, 2).toUpperCase() : 'QA');
    if (avatarEl) avatarEl.textContent = initials;
    if (emailEl) emailEl.textContent = user.email || 'user@example.com';
    if (roleBadgeEl) roleBadgeEl.textContent = user.role || 'QA Tester';
    if (joinedEl) joinedEl.textContent = (user.createdAt || '').slice(0, 10) || 'Recently';
    if (lastLoginEl) lastLoginEl.textContent = (user.lastLoginAt || '').slice(0, 16).replace('T', ' ') || 'Today';

    if (nameInput && !nameInput.value) nameInput.value = user.name || '';
    if (roleInput && !roleInput.value) roleInput.value = user.role || '';
  }

  // 2. Render Preferences
  const prefs = (user && user.preferences) || {};
  const themeSelect = document.getElementById('settings-theme-select');
  const densitySelect = document.getElementById('settings-density-select');
  const sortSelect = document.getElementById('settings-project-sort-select');
  const prioritySelect = document.getElementById('settings-case-priority-select');
  const autopassToggle = document.getElementById('settings-autopass-steps-toggle');
  const toastsToggle = document.getElementById('settings-action-toasts-toggle');

  const currentTheme = prefs.theme || document.documentElement.getAttribute('data-theme') || 'dark';
  if (themeSelect) themeSelect.value = currentTheme;
  if (densitySelect && prefs.density) densitySelect.value = prefs.density;
  if (sortSelect && prefs.projectSort) sortSelect.value = prefs.projectSort;
  if (prioritySelect && prefs.casePriority) prioritySelect.value = prefs.casePriority;
  if (autopassToggle && prefs.autoPassSteps !== undefined) autopassToggle.checked = Boolean(prefs.autoPassSteps);
  if (toastsToggle && prefs.actionToasts !== undefined) toastsToggle.checked = Boolean(prefs.actionToasts);

  // Apply theme & density to document
  document.documentElement.setAttribute('data-theme', currentTheme);
  if (prefs.density === 'compact') {
    document.body.classList.add('density-compact');
  } else {
    document.body.classList.remove('density-compact');
  }

  // 3. Render Storage Health
  computeStorageHealth();
}

export async function computeStorageHealth() {
  const usedEl = document.getElementById('settings-storage-used');
  const pctEl = document.getElementById('settings-storage-percent');
  const availableEl = document.getElementById('settings-storage-available');
  const countProjEl = document.getElementById('settings-count-projects');
  const countChkEl = document.getElementById('settings-count-checklists');
  const countCasesEl = document.getElementById('settings-count-cases');

  // Display initial loading state for cloud storage metrics
  if (usedEl) usedEl.textContent = 'Loading...';
  if (pctEl) pctEl.textContent = 'Retrieving MongoDB storage metrics...';
  if (availableEl) availableEl.textContent = 'Calculating...';

  // 1. Calculate project and test case counts from active workspace
  const projects = getProjects() || [];
  let totalCases = 0;
  for (const p of projects) {
    for (const ph of (p.phases || [])) {
      for (const su of (ph.suites || [])) {
        totalCases += (su.testCases || []).length;
      }
    }
  }

  if (countProjEl) countProjEl.textContent = String(projects.length);
  if (countCasesEl) countCasesEl.textContent = String(totalCases);

  // 2. Retrieve checklist count
  let checklistsCount = 0;
  try {
    const res = await apiFetch('/api/checklists');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) checklistsCount = data.length;
    }
  } catch {
    // Non-fatal if offline
  }
  if (countChkEl) countChkEl.textContent = String(checklistsCount);

  // 3. Fetch actual MongoDB Atlas database storage metrics from backend
  try {
    const res = await apiFetch('/api/data/storage-usage');
    if (res.ok) {
      const data = await res.json();
      const storage = data.storage || {};

      const usedMb = typeof storage.usedMb === 'number' ? storage.usedMb : 0;
      const usedBytes = typeof storage.usedBytes === 'number' ? storage.usedBytes : 0;
      const capacityMb = typeof storage.capacityMb === 'number' ? storage.capacityMb : 512;
      const availableMb = typeof storage.availableMb === 'number' ? storage.availableMb : capacityMb;
      const usagePercentage = typeof storage.usagePercentage === 'number' ? storage.usagePercentage : 0;

      let usedText = `${usedMb} MB`;
      if (usedMb < 0.01 && usedBytes > 0) {
        usedText = `${(usedBytes / 1024).toFixed(1)} KB (<0.01 MB)`;
      } else if (usedMb === 0 && usedBytes === 0) {
        usedText = `0 MB`;
      }

      if (usedEl) usedEl.textContent = usedText;
      if (pctEl) {
        pctEl.textContent = `${usagePercentage}% of ${capacityMb} MB (${availableMb} MB available)`;
      }
      if (availableEl) {
        availableEl.textContent = `${availableMb} MB available`;
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('qavora:db-status-change', { detail: { database: 'connected' } }));
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      const isOffline = res.status === 503 || errData.status === 'offline';
      if (usedEl) usedEl.textContent = isOffline ? 'Database Offline' : 'Unavailable';
      if (pctEl) {
        pctEl.textContent = isOffline
          ? 'MongoDB offline — storage metrics unavailable'
          : (errData.error || 'Storage service unavailable');
      }
      if (availableEl) availableEl.textContent = 'Unavailable';

      if (typeof window !== 'undefined' && isOffline) {
        window.dispatchEvent(new CustomEvent('qavora:db-status-change', { detail: { database: 'disconnected' } }));
      }
    }
  } catch (err) {
    if (usedEl) usedEl.textContent = 'Unavailable';
    if (pctEl) pctEl.textContent = 'Connection error retrieving storage stats';
    if (availableEl) availableEl.textContent = 'Unavailable';
  }
}

// Save preferences to backend
let _savePrefTimeout = null;
async function savePreferencesToBackend(updatedPrefs) {
  const indicator = document.getElementById('settings-save-indicator');
  try {
    const user = authController.getCurrentUser();
    const currentPrefs = (user && user.preferences) || {};
    const mergedPrefs = { ...currentPrefs, ...updatedPrefs };

    const res = await apiFetch('/api/auth/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ preferences: mergedPrefs })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.user) {
        authController.setSession({ user: data.user });
      }
      if (indicator) {
        indicator.style.display = 'inline-flex';
        clearTimeout(_savePrefTimeout);
        _savePrefTimeout = setTimeout(() => {
          indicator.style.display = 'none';
        }, 2500);
      }
    }
  } catch (err) {
    console.warn('Failed to persist preferences', err);
  }
}

export function initSettingsEventListeners() {
  if (typeof document === 'undefined' || _settingsListenersBound) return;
  _settingsListenersBound = true;

  // 1. Profile Form Submission
  const profileForm = document.getElementById('settings-profile-form');
  const profileAlert = document.getElementById('settings-profile-alert');
  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('settings-profile-name');
      const roleInput = document.getElementById('settings-profile-role');
      const name = nameInput ? nameInput.value.trim() : '';
      const role = roleInput ? roleInput.value.trim() : '';

      if (!name) {
        if (profileAlert) {
          profileAlert.className = 'alert-banner alert-danger';
          profileAlert.textContent = 'Full name is required.';
          profileAlert.style.display = 'flex';
        }
        return;
      }

      try {
        const res = await apiFetch('/api/auth/profile', {
          method: 'PATCH',
          body: JSON.stringify({ name, role })
        });
        const data = await res.json();

        if (res.ok && data.user) {
          authController.setSession({ user: data.user });
          if (profileAlert) {
            profileAlert.className = 'alert-banner alert-success';
            profileAlert.textContent = 'Profile updated successfully!';
            profileAlert.style.display = 'flex';
            setTimeout(() => { profileAlert.style.display = 'none'; }, 4000);
          }
          showToast('Profile updated successfully', 'success');
          renderSettingsWorkspace();
        } else {
          if (profileAlert) {
            profileAlert.className = 'alert-banner alert-danger';
            profileAlert.textContent = data.error || 'Failed to update profile.';
            profileAlert.style.display = 'flex';
          }
        }
      } catch (err) {
        if (profileAlert) {
          profileAlert.className = 'alert-banner alert-danger';
          profileAlert.textContent = err.message || 'Connection error while updating profile.';
          profileAlert.style.display = 'flex';
        }
      }
    });
  }

  // 2. Password Change Form Submission
  const passwordForm = document.getElementById('settings-password-form');
  const passwordAlert = document.getElementById('settings-password-alert');
  if (passwordForm) {
    passwordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const curPass = document.getElementById('settings-password-current')?.value;
      const newPass = document.getElementById('settings-password-new')?.value;
      const confirmPass = document.getElementById('settings-password-confirm')?.value;

      if (!curPass) {
        if (passwordAlert) {
          passwordAlert.className = 'alert-banner alert-danger';
          passwordAlert.textContent = 'Please enter your current password.';
          passwordAlert.style.display = 'flex';
        }
        return;
      }

      if (!newPass || newPass.length < 8) {
        if (passwordAlert) {
          passwordAlert.className = 'alert-banner alert-danger';
          passwordAlert.textContent = 'New password must be at least 8 characters long.';
          passwordAlert.style.display = 'flex';
        }
        return;
      }

      if (newPass !== confirmPass) {
        if (passwordAlert) {
          passwordAlert.className = 'alert-banner alert-danger';
          passwordAlert.textContent = 'New password and confirmation password do not match.';
          passwordAlert.style.display = 'flex';
        }
        return;
      }

      try {
        const res = await apiFetch('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword: curPass, newPassword: newPass })
        });
        const data = await res.json();

        if (res.ok) {
          passwordForm.reset();
          if (passwordAlert) {
            passwordAlert.className = 'alert-banner alert-success';
            passwordAlert.textContent = 'Account password changed successfully!';
            passwordAlert.style.display = 'flex';
            setTimeout(() => { passwordAlert.style.display = 'none'; }, 4000);
          }
          showToast('Password changed successfully', 'success');
        } else {
          if (passwordAlert) {
            passwordAlert.className = 'alert-banner alert-danger';
            passwordAlert.textContent = data.error || 'Failed to change password.';
            passwordAlert.style.display = 'flex';
          }
        }
      } catch (err) {
        if (passwordAlert) {
          passwordAlert.className = 'alert-banner alert-danger';
          passwordAlert.textContent = err.message || 'Connection error while changing password.';
          passwordAlert.style.display = 'flex';
        }
      }
    });
  }

  // 3. Theme Select
  const themeSelect = document.getElementById('settings-theme-select');
  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      const newTheme = themeSelect.value;
      document.documentElement.setAttribute('data-theme', newTheme);
      savePreferencesToBackend({ theme: newTheme });
    });
  }

  // 4. Density Select
  const densitySelect = document.getElementById('settings-density-select');
  if (densitySelect) {
    densitySelect.addEventListener('change', () => {
      const val = densitySelect.value;
      if (val === 'compact') {
        document.body.classList.add('density-compact');
      } else {
        document.body.classList.remove('density-compact');
      }
      savePreferencesToBackend({ density: val });
    });
  }

  // 5. Workflow Selects & Toggles
  const sortSelect = document.getElementById('settings-project-sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      savePreferencesToBackend({ projectSort: sortSelect.value });
    });
  }

  const prioritySelect = document.getElementById('settings-case-priority-select');
  if (prioritySelect) {
    prioritySelect.addEventListener('change', () => {
      savePreferencesToBackend({ casePriority: prioritySelect.value });
    });
  }

  const autopassToggle = document.getElementById('settings-autopass-steps-toggle');
  if (autopassToggle) {
    autopassToggle.addEventListener('change', () => {
      savePreferencesToBackend({ autoPassSteps: autopassToggle.checked });
    });
  }

  const toastsToggle = document.getElementById('settings-action-toasts-toggle');
  if (toastsToggle) {
    toastsToggle.addEventListener('change', () => {
      savePreferencesToBackend({ actionToasts: toastsToggle.checked });
    });
  }

  // 6. Quick Jump to Data Management
  const jumpDataBtn = document.getElementById('settings-jump-data-btn');
  if (jumpDataBtn) {
    jumpDataBtn.addEventListener('click', () => {
      navigateTo('/data');
    });
  }

  // 7. Quick Backup Export (Includes Projects & Checklists)
  const quickBackupBtn = document.getElementById('settings-quick-backup-btn');
  if (quickBackupBtn) {
    quickBackupBtn.addEventListener('click', async () => {
      const projects = getProjects() || [];
      let checklists = [];
      try {
        const res = await apiFetch('/api/checklists');
        if (res.ok) {
          const chk = await res.json();
          if (Array.isArray(chk)) checklists = chk;
        }
      } catch (err) {
        console.warn('Could not fetch checklists for quick backup:', err);
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupData = {
        application: 'Qavora',
        backupVersion: 1,
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        metadata: {
          totalProjects: projects.length,
          totalChecklists: checklists.length,
          exportedBy: authController.getCurrentUser()?.email || 'authenticated_user'
        },
        projects,
        checklists
      };

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Qavora_Full_Backup_${timestamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Full workspace backup downloaded (${projects.length} projects, ${checklists.length} checklists)`, 'success');
    });
  }

  // 8. MongoDB Connection Test Button
  const testMongoBtn = document.getElementById('btn-test-mongo-connection');
  const loadingBanner = document.getElementById('mongo-test-loading');
  const errorBanner = document.getElementById('mongo-test-error');
  const errorText = document.getElementById('mongo-test-error-text');
  const idleBox = document.getElementById('mongo-test-idle');
  const resultsContainer = document.getElementById('mongo-test-results');
  const countLabel = document.getElementById('mongo-test-count');
  const listContainer = document.getElementById('mongo-test-list');

  if (testMongoBtn) {
    testMongoBtn.addEventListener('click', async () => {
      if (idleBox) idleBox.style.display = 'none';
      if (errorBanner) errorBanner.style.display = 'none';
      if (resultsContainer) resultsContainer.style.display = 'none';
      if (loadingBanner) loadingBanner.style.display = 'flex';

      try {
        const response = await apiFetch('/api/tests');
        if (loadingBanner) loadingBanner.style.display = 'none';

        if (response.ok) {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('qavora:db-status-change', { detail: { database: 'connected' } }));
          }
          const items = await response.json();
          if (resultsContainer) resultsContainer.style.display = 'block';
          if (countLabel) {
            countLabel.textContent = `Retrieved ${Array.isArray(items) ? items.length : 0} items from MongoDB /api/tests`;
          }
          if (listContainer) {
            if (Array.isArray(items) && items.length > 0) {
              listContainer.innerHTML = items.map(item => `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background-color: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: 0.8125rem;">
                  <span style="font-weight: 500;">${escapeHtml(item.name || 'Test Document')}</span>
                  <span class="project-badge badge-pass">${escapeHtml(item.status || 'Active')}</span>
                </div>
              `).join('');
            } else {
              listContainer.innerHTML = `
                <div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 0.8125rem;">
                  Connected to MongoDB successfully! Currently 0 test items in the tests collection.
                </div>
              `;
            }
          }
        } else {
          if (typeof window !== 'undefined' && response.status === 503) {
            window.dispatchEvent(new CustomEvent('qavora:db-status-change', { detail: { database: 'disconnected' } }));
          }
          const errData = await response.json().catch(() => ({}));
          if (errorBanner) {
            errorBanner.style.display = 'flex';
            if (errorText) errorText.textContent = errData.error || `HTTP ${response.status} returned from /api/tests.`;
          }
        }
      } catch (err) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('qavora:db-status-change', { detail: { database: 'disconnected' } }));
        }
        if (loadingBanner) loadingBanner.style.display = 'none';
        if (errorBanner) {
          errorBanner.style.display = 'flex';
          if (errorText) errorText.textContent = err.message || 'Network error querying /api/tests.';
        }
      }
    });
  }
}
