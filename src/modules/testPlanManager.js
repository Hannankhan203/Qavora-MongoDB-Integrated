/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Test Plans, Phases, Suites & Test Cases Module (CQ-003)
 */

import { generateStableId } from '../../qaChecklistStore.js';
import { getActiveProject } from './state.js';
import { saveProjectData } from './projectManager.js';

export async function saveTestPlan(testPlanData) {
  const project = getActiveProject();
  if (!project) return { ok: false, error: 'No active project selected.' };
  return saveProjectData(project.id, { testPlan: testPlanData });
}

export async function saveTestSuite(suiteData) {
  const project = getActiveProject();
  if (!project) return { ok: false, error: 'No active project selected.' };
  const suites = Array.isArray(project.testSuites) ? [...project.testSuites] : [];
  const existingIdx = suites.findIndex((s) => s.id === suiteData.id);
  if (existingIdx >= 0) {
    suites[existingIdx] = { ...suites[existingIdx], ...suiteData };
  } else {
    suites.push({
      id: suiteData.id || generateStableId('suite'),
      cases: [],
      ...suiteData
    });
  }
  return saveProjectData(project.id, { testSuites: suites });
}

export async function saveTestCase(suiteId, testCaseData) {
  const project = getActiveProject();
  if (!project) return { ok: false, error: 'No active project selected.' };
  const suites = Array.isArray(project.testSuites) ? [...project.testSuites] : [];
  const suiteIdx = suites.findIndex((s) => s.id === suiteId);
  if (suiteIdx < 0) return { ok: false, error: 'Test suite not found.' };

  const cases = Array.isArray(suites[suiteIdx].cases) ? [...suites[suiteIdx].cases] : [];
  const caseIdx = cases.findIndex((c) => c.id === testCaseData.id);
  if (caseIdx >= 0) {
    cases[caseIdx] = { ...cases[caseIdx], ...testCaseData };
  } else {
    cases.push({
      id: testCaseData.id || generateStableId('tc'),
      status: 'Not Run',
      ...testCaseData
    });
  }
  suites[suiteIdx] = { ...suites[suiteIdx], cases };
  return saveProjectData(project.id, { testSuites: suites });
}

export async function duplicateTestCase(suiteId, caseId) {
  const project = getActiveProject();
  if (!project) return { ok: false, error: 'No active project selected.' };
  const suites = Array.isArray(project.testSuites) ? [...project.testSuites] : [];
  const suiteIdx = suites.findIndex((s) => s.id === suiteId);
  if (suiteIdx < 0) return { ok: false, error: 'Test suite not found.' };

  const cases = Array.isArray(suites[suiteIdx].cases) ? [...suites[suiteIdx].cases] : [];
  const source = cases.find((c) => c.id === caseId);
  if (!source) return { ok: false, error: 'Test case not found.' };

  const copy = {
    ...source,
    id: generateStableId('tc'),
    title: `${source.title || 'Test Case'} (Copy)`
  };
  cases.push(copy);
  suites[suiteIdx] = { ...suites[suiteIdx], cases };
  return saveProjectData(project.id, { testSuites: suites });
}
