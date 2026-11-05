/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Test Execution & Results Module (CQ-003)
 */

import { generateStableId } from '../../qaChecklistStore.js';
import { getActiveProject } from './state.js';
import { saveProjectData } from './projectManager.js';

export async function saveExecutionResult(executionData) {
  const project = getActiveProject();
  if (!project) return { ok: false, error: 'No active project selected.' };
  const executions = Array.isArray(project.executions) ? [...project.executions] : [];
  const idx = executions.findIndex((e) => e.id === executionData.id);
  const record = {
    id: executionData.id || generateStableId('exec'),
    executedAt: new Date().toISOString(),
    ...executionData
  };
  if (idx >= 0) {
    executions[idx] = { ...executions[idx], ...record };
  } else {
    executions.unshift(record);
  }
  return saveProjectData(project.id, { executions });
}
