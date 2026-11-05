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
  setActiveProjectId
} from './state.js';

export async function loadProjectsFromBackend() {
  const res = await apiJson('/api/projects');
  if (res.ok && Array.isArray(res.data)) {
    setProjects(res.data);
    if (!getActiveProjectId() && res.data.length > 0) {
      setActiveProjectId(res.data[0].id);
    }
    return { ok: true, projects: res.data };
  }
  return { ok: false, status: res.status, error: res.data?.error || 'Failed to load projects.' };
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
    return { ok: true, project: res.data };
  }
  return { ok: false, status: res.status, error: res.data?.error || 'Failed to create project.' };
}

export async function updateProjectMetadata(projectId, payload) {
  const res = await apiJson(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
  if (res.ok && res.data) {
    const updated = getProjects().map((p) => (p.id === projectId ? { ...p, ...res.data } : p));
    setProjects(updated);
    return { ok: true, project: res.data };
  }
  return { ok: false, status: res.status, error: res.data?.error || 'Failed to update project.' };
}

export async function saveProjectData(projectId, dataPayload) {
  const res = await apiJson(`/api/projects/${encodeURIComponent(projectId)}/data`, {
    method: 'PATCH',
    body: JSON.stringify(dataPayload)
  });
  if (res.ok && res.data) {
    const updated = getProjects().map((p) => (p.id === projectId ? res.data : p));
    setProjects(updated);
    return { ok: true, project: res.data };
  }
  return { ok: false, status: res.status, error: res.data?.error || 'Failed to save project data.' };
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
}
