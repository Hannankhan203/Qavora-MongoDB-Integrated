/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Manual QA Testing Manager
 * Modular Application Entry Point & Orchestrator (CQ-003)
 */

import { initChecklistGenerator } from './checklistGeneratorUI.js';
import { initQARunnerAndChecklists } from './qaRunnerUI.js';
import { initQAChecklistTransferUI } from './qaChecklistTransferUI.js';
import authController from './authController.js';

import { apiFetch, apiJson, checkBackendHealth } from './src/modules/apiClient.js';
import * as utils from './src/modules/utils.js';
import {
  getAppState,
  getProjects,
  setProjects,
  getActiveProjectId,
  setActiveProjectId,
  getActiveProject
} from './src/modules/state.js';
import {
  initAuthAndSession,
  updateUserProfileUI
} from './src/modules/authSession.js';
import {
  loadProjectsFromBackend,
  createProject,
  updateProjectMetadata,
  saveProjectData,
  deleteProjectById,
  updateSidebarProjectCounters,
  renderProjectsGrid
} from './src/modules/projectManager.js';
import {
  saveTestPlan,
  saveTestSuite,
  saveTestCase,
  duplicateTestCase
} from './src/modules/testPlanManager.js';
import { saveExecutionResult } from './src/modules/executionManager.js';
import { saveDefect, updateDefectQuickStatus } from './src/modules/defectManager.js';
import {
  showToast,
  navigateTo,
  resolveInitialRoute,
  initUIEventListeners
} from './src/modules/uiRenderer.js';

let _initialized = false;

async function init() {
  if (_initialized) return;
  _initialized = true;

  initUIEventListeners();
  const initialRoute = resolveInitialRoute();
  navigateTo(initialRoute, false);

  await checkBackendHealth();

  await initAuthAndSession({
    onAuthenticated: async () => {
      await loadProjectsFromBackend();
      updateSidebarProjectCounters();
      renderProjectsGrid();
      if (typeof initChecklistGenerator === 'function') {
        initChecklistGenerator();
      }
      if (typeof initQARunnerAndChecklists === 'function') {
        initQARunnerAndChecklists();
      }
      if (typeof initQAChecklistTransferUI === 'function') {
        initQAChecklistTransferUI();
      }
    },
    onUnauthenticated: () => {
      setProjects([]);
      updateSidebarProjectCounters();
    }
  });
}

if (typeof window !== 'undefined') {
  window.QavoraApp = {
    authController,
    apiFetch,
    apiJson,
    checkBackendHealth,
    utils,
    getAppState,
    getProjects,
    setProjects,
    getActiveProjectId,
    setActiveProjectId,
    getActiveProject,
    updateUserProfileUI,
    loadProjectsFromBackend,
    createProject,
    updateProjectMetadata,
    saveProjectData,
    deleteProjectById,
    updateSidebarProjectCounters,
    saveTestPlan,
    saveTestSuite,
    saveTestCase,
    duplicateTestCase,
    saveExecutionResult,
    saveDefect,
    updateDefectQuickStatus,
    showToast,
    navigateTo,
    resolveInitialRoute
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

export { init };