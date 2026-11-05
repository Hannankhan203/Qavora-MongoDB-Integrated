/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Centralized Application State Module (CQ-003)
 */

export const PROJECTS_STORAGE_KEY = 'qavora_projects_v1';
export const ACTIVE_PROJECT_STORAGE_KEY = 'qavora_active_project_v1';
export const THEME_STORAGE_KEY = 'qavora_theme_v1';

const _appState = {
  projects: [],
  activeProjectId: null,
  currentRoute: '/projects',
  isBackendAvailable: true,
  isSyncing: false,
  pendingDelete: null
};

export function getAppState() {
  return _appState;
}

export function getProjects() {
  return _appState.projects;
}

export function setProjects(projects) {
  _appState.projects = Array.isArray(projects) ? projects : [];
}

export function getActiveProjectId() {
  return _appState.activeProjectId;
}

export function setActiveProjectId(projectId) {
  _appState.activeProjectId = projectId || null;
  try {
    if (typeof localStorage !== 'undefined') {
      if (projectId) {
        localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, projectId);
      } else {
        localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
      }
    }
  } catch {
    // Ignore storage errors
  }
}

export function getActiveProject() {
  if (!_appState.activeProjectId) return _appState.projects[0] || null;
  return (
    _appState.projects.find((p) => p.id === _appState.activeProjectId) ||
    _appState.projects[0] ||
    null
  );
}
