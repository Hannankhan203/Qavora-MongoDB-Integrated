/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Manual QA Testing Manager
 * Modular Application Entry Point & Orchestrator (CQ-003)
 */

import { initChecklistGenerator } from './checklistGeneratorUI.js';
import { initQARunnerAndChecklists } from './qaRunnerUI.js';
import authController from './authController.js';
import {
  openOfflineDatabase,
  getStorageStatus,
  ChecklistsPersistence
} from './qaChecklistStore.js';

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
  addPromotedProjectToState,
  updateProjectMetadata,
  saveProjectData,
  deleteProjectById,
  updateSidebarProjectCounters,
  renderProjectsGrid,
  renderProjectDetails
} from './src/modules/projectManager.js';
import {
  renderDashboard,
  getDashboardMetrics
} from './src/modules/dashboardManager.js';
import {
  saveTestPlan,
  saveTestSuite,
  saveTestCase,
  duplicateTestCase,
  addPhase,
  updatePhase,
  deletePhase,
  deleteTestSuite,
  deleteTestCase,
  populateProjectsDropdown,
  renderTestPlanWorkspace,
  openSuiteExplorer,
  closeSuiteExplorer
} from './src/modules/testPlanManager.js';
import {
  saveExecutionResult,
  renderExecutionWorkspace,
  openExecutionModal,
  closeExecutionModal,
  openExecutionHistoryModal,
  closeExecutionHistoryModal,
  quickRecordOutcome
} from './src/modules/executionManager.js';
import {
  saveDefect,
  updateDefectQuickStatus,
  deleteDefectById,
  renderDefectsWorkspace,
  openCreateDefectModal,
  openEditDefectModal,
  closeDefectModal,
  openDefectViewModal,
  closeDefectViewModal,
  openDeleteDefectModal
} from './src/modules/defectManager.js';
import { renderReportsWorkspace } from './src/modules/reportsManager.js';
import { renderSettingsWorkspace } from './src/modules/settingsManager.js';
import { renderDataManagementWorkspace, refreshStorageUsage } from './src/modules/dataManager.js';
import {
  showToast,
  navigateTo,
  resolveInitialRoute,
  initUIEventListeners,
  updateSidebarDbStatus,
  syncSidebarDbStatus
} from './src/modules/uiRenderer.js';

let _initialized = false;

async function init() {
  if (_initialized) return;
  _initialized = true;

  initUIEventListeners();
  const initialRoute = resolveInitialRoute();

  await syncSidebarDbStatus();

  await initAuthAndSession({
    onAuthenticated: async () => {
      // Safely navigate to verified user route only after session is confirmed
      navigateTo(initialRoute, false);

      await loadProjectsFromBackend();
      updateSidebarProjectCounters();
      renderProjectsGrid();
      populateProjectsDropdown();

      const currentRoute = getAppState().currentRoute;
      const baseSlug = currentRoute.replace(/^\//, '').split('?')[0].split('/')[0];

      if (baseSlug === 'dashboard') {
        renderDashboard();
      } else if (baseSlug === 'project-details') {
        let pId = null;
        if (currentRoute.includes('?')) {
          const params = new URLSearchParams(currentRoute.split('?')[1]);
          pId = params.get('id');
        } else if (currentRoute.startsWith('/project-details/')) {
          pId = currentRoute.replace('/project-details/', '').split('?')[0];
        }
        if (pId) {
          setActiveProjectId(pId);
        }
        renderProjectDetails(pId || getActiveProjectId());
      } else if (baseSlug === 'plans') {
        renderTestPlanWorkspace();
      } else if (baseSlug === 'execution') {
        renderExecutionWorkspace();
      } else if (baseSlug === 'defects') {
        renderDefectsWorkspace();
      } else if (baseSlug === 'reports') {
        renderReportsWorkspace();
      } else if (baseSlug === 'settings') {
        renderSettingsWorkspace();
      } else if (baseSlug === 'data') {
        renderDataManagementWorkspace();
      }

      if (typeof initChecklistGenerator === 'function') {
        initChecklistGenerator({
          navigateTo,
          notify: showToast
        });
      }
      if (typeof initQARunnerAndChecklists === 'function') {
        initQARunnerAndChecklists({
          navigateTo,
          notify: showToast,
          onChecklistPromoted: (res) => {
            if (res && res.project) {
              addPromotedProjectToState(res.project);
              showToast(
                `Promoted "${res.checklist?.title || 'Checklist'}" to project "${res.project?.name || 'Project'}" (${res.summary?.phasesCount || 0} phases, ${res.summary?.suitesCount || 0} suites, ${res.summary?.casesCount || 0} test cases).`,
                'success'
              );
              navigateTo(`/project-details?id=${encodeURIComponent(res.project.id)}`);
            }
          },
          onOpenPromotedProject: (projectId) => {
            if (projectId) {
              setActiveProjectId(projectId);
              navigateTo(`/project-details?id=${encodeURIComponent(projectId)}`);
            }
          }
        });
      }
    },
    onUnauthenticated: () => {
      const appContainer = document.getElementById('app-container');
      if (appContainer) {
        appContainer.classList.add('app-hidden');
        appContainer.style.setProperty('display', 'none', 'important');
      }
      if (typeof document !== 'undefined') {
        document.body.classList.add('auth-view-active');
      }
      setProjects([]);
      updateSidebarProjectCounters();
      renderProjectsGrid();
      populateProjectsDropdown();
      renderDashboard();
      renderProjectDetails();
      renderExecutionWorkspace();
      renderDefectsWorkspace();
      renderReportsWorkspace();
      renderSettingsWorkspace();
      renderDataManagementWorkspace();
      if (getAppState().currentRoute === '/plans') {
        renderTestPlanWorkspace();
      }
    }
  });
}

if (typeof window !== 'undefined') {
  globalThis.__qavoraGetActiveProjects = () => getProjects();
  globalThis.__qavoraOnProjectPromoted = (project) => addPromotedProjectToState(project);

  window.QavoraApp = {
    authController,
    apiFetch,
    apiJson,
    checkBackendHealth,
    updateSidebarDbStatus,
    syncSidebarDbStatus,
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
    addPromotedProjectToState,
    updateProjectMetadata,
    saveProjectData,
    deleteProjectById,
    updateSidebarProjectCounters,
    renderProjectsGrid,
    renderProjectDetails,
    renderDashboard,
    getDashboardMetrics,
    saveTestPlan,
    saveTestSuite,
    saveTestCase,
    duplicateTestCase,
    addPhase,
    updatePhase,
    deletePhase,
    deleteTestSuite,
    deleteTestCase,
    populateProjectsDropdown,
    renderTestPlanWorkspace,
    openSuiteExplorer,
    saveExecutionResult,
    renderExecutionWorkspace,
    openExecutionModal,
    closeExecutionModal,
    openExecutionHistoryModal,
    closeExecutionHistoryModal,
    quickRecordOutcome,
    saveDefect,
    updateDefectQuickStatus,
    deleteDefectById,
    renderDefectsWorkspace,
    openCreateDefectModal,
    openEditDefectModal,
    closeDefectModal,
    openDefectViewModal,
    closeDefectViewModal,
    openDeleteDefectModal,
    renderReportsWorkspace,
    renderSettingsWorkspace,
    renderDataManagementWorkspace,
    refreshStorageUsage,
    showToast,
    navigateTo,
    resolveInitialRoute,
    openOfflineDatabase,
    getStorageStatus,
    ChecklistsPersistence
  };

  ChecklistsPersistence.onPersistenceFailure(({ action, error }) => {
    showToast(`Storage failure during ${action}: ${error}`, 'error');
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

export { init };