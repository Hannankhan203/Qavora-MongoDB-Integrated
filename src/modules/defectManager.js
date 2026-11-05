/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Defect Management Module (CQ-003)
 */

import { generateStableId } from '../../qaChecklistStore.js';
import { getActiveProject } from './state.js';
import { saveProjectData } from './projectManager.js';

export async function saveDefect(defectData) {
  const project = getActiveProject();
  if (!project) return { ok: false, error: 'No active project selected.' };
  const defects = Array.isArray(project.defects) ? [...project.defects] : [];
  const idx = defects.findIndex((d) => d.id === defectData.id);
  const record = {
    id: defectData.id || generateStableId('def'),
    status: defectData.status || 'Open',
    updatedAt: new Date().toISOString(),
    ...defectData
  };
  if (idx >= 0) {
    defects[idx] = { ...defects[idx], ...record };
  } else {
    defects.unshift(record);
  }
  return saveProjectData(project.id, { defects });
}

export async function updateDefectQuickStatus(defectId, newStatus) {
  const project = getActiveProject();
  if (!project) return { ok: false, error: 'No active project selected.' };
  const defects = Array.isArray(project.defects) ? [...project.defects] : [];
  const idx = defects.findIndex((d) => d.id === defectId);
  if (idx < 0) return { ok: false, error: 'Defect not found.' };
  defects[idx] = {
    ...defects[idx],
    status: newStatus,
    updatedAt: new Date().toISOString()
  };
  return saveProjectData(project.id, { defects });
}
