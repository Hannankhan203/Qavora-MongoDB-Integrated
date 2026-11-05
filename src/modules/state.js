/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Centralized Application State Module (CQ-003)
 */


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
}

export function getActiveProject() {
  if (!_appState.activeProjectId) return _appState.projects[0] || null;
  return (
    _appState.projects.find((p) => p.id === _appState.activeProjectId) ||
    _appState.projects[0] ||
    null
  );
}
