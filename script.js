/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Qavora — Manual QA Testing Manager
 * Dynamic Test Plans, Phases, Test Suites & Test Cases Controller
 */

import { initChecklistGenerator } from './checklistGeneratorUI.js';
import { initQARunnerAndChecklists } from './qaRunnerUI.js';
import { initQAChecklistTransferUI } from './qaChecklistTransferUI.js';
import {
  validateChecklistTransferCode,
  applyChecklistTransferPayload
} from './qaChecklistTransfer.js';
import {
  CHECKLISTS_STORAGE_KEY,
  ACTIVE_RUNNER_STORAGE_KEY,
  loadAllChecklists,
  saveAllChecklists,
  normalizeChecklistRecord,
  getActiveRunnerState,
  normalizeActiveRunnerState,
  replaceActiveRunnerState,
  calculateChecklistProgress,
  calculateQavoraStorageFootprint,
  generateStableId,
  comparePhaseNumbers,
  isQuotaExceededError,
  isSecurityError,
  getStorageErrorMessage,
  safeStorageWrite,
  safeStorageRead,
  safeStorageRemove
} from './qaChecklistStore.js';

(function () {
  'use strict';

  let qaRunnerController = null;
  let qaTransferController = null;

  // ==========================================================================
  // Storage Keys & Constants
  // ==========================================================================
  const STORAGE_KEYS = {
    PROJECTS: 'qavora_projects_v1',
    ACTIVITIES: 'qavora_activities_v1',
    THEME: 'qavora_theme_preference',
    PREFERENCES: 'qavora_preferences_v1',
    NOTIFICATIONS: 'qavora_notifications_v1'
  };

  const LEGACY_STORAGE_KEYS = {
    PROJECTS: 'testpilot_projects_v1',
    ACTIVITIES: 'testpilot_activities_v1',
    THEME: 'testpilot_theme_preference'
  };

  const ROLLBACK_KEY = 'qavora_rollback_v1';
  const LEGACY_ROLLBACK_KEY = 'testpilot_rollback_v1';

  const VALID_PROJECT_TYPES = [
    'Website',
    'Web Application',
    'Mobile Application',
    'Desktop Application',
    'SaaS Platform',
    'Chatbot / AI Application',
    'E-commerce',
    'Other'
  ];

  const VALID_STATUSES = ['Active', 'Completed', 'Archived'];

  const DEFAULT_SUITE_CATEGORIES = [
    'Functional',
    'UI/UX',
    'Security',
    'Performance',
    'Compatibility',
    'Integration',
    'Regression',
    'Accessibility',
    'Other'
  ];

  const VIEW_TITLES = {
    'checklist-generator': {
      title: 'Create QA Checklist',
      subtitle: 'Import & structure manual testing plans'
    },
    'my-checklists': {
      title: 'My QA Checklists',
      subtitle: 'Saved manual QA checklists & progress'
    },
    'qa-runner': {
      title: 'QA Test Runner',
      subtitle: 'Execute manual verifications with automatic progress saving'
    },
    dashboard: {
      title: 'Dashboard',
      subtitle: 'Overview & testing health'
    },
    projects: {
      title: 'My Projects',
      subtitle: 'Manage and organize testing workspaces'
    },
    'project-details': {
      title: 'Project Details',
      subtitle: 'Workspace specifications & testing progress'
    },
    plans: {
      title: 'Test Plans',
      subtitle: 'Dynamic test planning, phases, suites, and test cases'
    },
    execution: {
      title: 'Test Execution',
      subtitle: 'Run manual cycles, verify steps, and log outcomes'
    },
    defects: {
      title: 'Defects',
      subtitle: 'Manage, prioritize, and resolve QA issues'
    },
    reports: {
      title: 'Reports',
      subtitle: 'Execution velocity and QA health metrics'
    },
    data: {
      title: 'Data Management',
      subtitle: 'Export, import, back up, and restore your Qavora projects and QA data'
    },
    settings: {
      title: 'Settings',
      subtitle: 'Preferences and data management'
    }
  };

  // ==========================================================================
  // Application State
  // ==========================================================================
  const State = {
    currentView: 'checklist-generator',
    currentDetailProjectId: null,

    // My Projects Filtering
    searchQuery: '',
    typeFilter: 'ALL',
    statusFilter: 'ALL',
    sortBy: 'newest',

    // Test Plans Workspace
    activePlanProjectId: null,
    activeSuiteId: null, // If non-null, shows Suite Cases Explorer sub-view
    caseSearchQuery: '',
    casePriorityFilter: 'ALL',
    caseCategoryFilter: 'ALL',
    caseSortBy: 'newest',

    // Temporary Test Steps Builder state (while case modal is open)
    modalSteps: [],

    // Test Execution Workspace State (Prompt 4)
    activeExecProjectId: null,
    execPhaseFilter: 'ALL',
    execSuiteFilter: 'ALL',
    execStatusFilter: 'ALL',
    execPriorityFilter: 'ALL',
    execCategoryFilter: 'ALL',
    execSearchQuery: '',
    execSortBy: 'id-asc',

    // Interactive Step Runner state (while execution modal is open)
    modalExecContext: null, // { projectId, suiteId, caseId, steps: [{ stepId, action, testData, status, note }] }

    // Defects Workspace State (Prompt 4)
    activeDefectsProjectId: 'ALL',
    defectSeverityFilter: 'ALL',
    defectStatusFilter: 'ALL',
    defectSearchQuery: '',
    defectSortBy: 'newest',

    // Reports Workspace State (Prompt 5)
    reportsProjectId: 'ALL',
    reportsDateRange: 'ALL',
    reportsCustomStartDate: '',
    reportsCustomEndDate: '',

    // Data Management Workspace State (Prompt 6)
    activeDataTab: 'export',
    pendingImportPayload: null,

    // Last used tester name cache
    cachedTesterName: '',

    // Universal Confirmation Dialog State
    pendingConfirm: null, // { type: 'project'|'phase'|'suite'|'case'|'defect', targetId: '', parentId: '', name: '' }
    lastDeleteFocusedElement: null,

    // Phase 5: Workspace Preferences (QAV-ISS-010)
    preferences: null,
    _hasCustomSort: false,
    _settingsSaveTimeout: null,

    // Phase 5: Notifications (QAV-ISS-011)
    notifications: [],
    isNotificationPanelOpen: false
  };

  // ==========================================================================
  // Centralized Priority & Severity Classification Engine (ISSUE-007)
  // ==========================================================================
  const SUPPORTED_PRIORITY_CATEGORIES = ['Critical', 'High', 'Medium', 'Low'];

  function classifyPriority(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') {
      if (val === 0) return 'Critical';
      if (val === 1) return 'High';
      if (val === 2) return 'Medium';
      if (val === 3 || val === 4) return 'Low';
      return null;
    }
    if (typeof val !== 'string') return null;
    const s = val.trim().toLowerCase();
    if (!s) return null;

    // Critical mappings: Critical, Blocker, P0, Sev0, 0, etc.
    if (s === 'critical' || s === 'blocker' || s === 'p0' || s === 'sev0' || s === 'sev-0' || s === 'prio0' || s === 'priority 0' || s === 'fatal' || s === '0') {
      return 'Critical';
    }

    // High mappings: High, Urgent, P1, Sev1, 1, etc.
    if (s === 'high' || s === 'urgent' || s === 'p1' || s === 'sev1' || s === 'sev-1' || s === 'prio1' || s === 'priority 1' || s === 'major' || s === '1') {
      return 'High';
    }

    // Medium mappings: Medium, Normal, Moderate, P2, Sev2, 2, etc.
    if (s === 'medium' || s === 'normal' || s === 'moderate' || s === 'p2' || s === 'sev2' || s === 'sev-2' || s === 'prio2' || s === 'priority 2' || s === 'med' || s === '2') {
      return 'Medium';
    }

    // Low mappings: Low, Minor, Trivial, P3, P4, Sev3, Sev4, 3, 4, etc.
    if (s === 'low' || s === 'minor' || s === 'trivial' || s === 'p3' || s === 'p4' || s === 'sev3' || s === 'sev-3' || s === 'sev4' || s === 'sev-4' || s === 'prio3' || s === 'prio4' || s === 'priority 3' || s === 'priority 4' || s === '3' || s === '4') {
      return 'Low';
    }

    return null;
  }

  function classifyDefectPriority(dfOrVal) {
    if (dfOrVal === null || dfOrVal === undefined) return null;
    if (typeof dfOrVal === 'object') {
      const prioClass = classifyPriority(dfOrVal.priority);
      if (prioClass) return prioClass;
      const sevClass = classifyPriority(dfOrVal.severity);
      if (sevClass) return sevClass;
      return null;
    }
    return classifyPriority(dfOrVal);
  }

  // ==========================================================================
  // Safe Storage Layer with Comprehensive Schema Normalization & Legacy Migration
  // ==========================================================================
  function migrateLegacyWorkspaceStorage() {
    try {
      // 1. Projects
      const currentProjects = safeStorageRead(STORAGE_KEYS.PROJECTS).raw;
      const legacyProjects = safeStorageRead(LEGACY_STORAGE_KEYS.PROJECTS).raw;
      if (!currentProjects && legacyProjects) {
        try {
          const parsed = JSON.parse(legacyProjects);
          if (Array.isArray(parsed)) {
            const writeRes = safeStorageWrite(STORAGE_KEYS.PROJECTS, legacyProjects, 'migrating projects from legacy storage');
            if (writeRes && writeRes.ok) {
              const verified = safeStorageRead(STORAGE_KEYS.PROJECTS).raw;
              if (verified === legacyProjects) {
                safeStorageRemove(LEGACY_STORAGE_KEYS.PROJECTS);
              }
            }
          }
        } catch (_) {}
      }

      // 2. Activities
      const currentActivities = safeStorageRead(STORAGE_KEYS.ACTIVITIES).raw;
      const legacyActivities = safeStorageRead(LEGACY_STORAGE_KEYS.ACTIVITIES).raw;
      if (!currentActivities && legacyActivities) {
        try {
          const parsed = JSON.parse(legacyActivities);
          if (Array.isArray(parsed)) {
            const writeRes = safeStorageWrite(STORAGE_KEYS.ACTIVITIES, legacyActivities, 'migrating activities from legacy storage');
            if (writeRes && writeRes.ok) {
              const verified = safeStorageRead(STORAGE_KEYS.ACTIVITIES).raw;
              if (verified === legacyActivities) {
                safeStorageRemove(LEGACY_STORAGE_KEYS.ACTIVITIES);
              }
            }
          }
        } catch (_) {}
      }

      // 3. Theme
      const currentTheme = safeStorageRead(STORAGE_KEYS.THEME).raw;
      const legacyTheme = safeStorageRead(LEGACY_STORAGE_KEYS.THEME).raw;
      if (!currentTheme && legacyTheme) {
        if (legacyTheme === 'dark' || legacyTheme === 'light') {
          const writeRes = safeStorageWrite(STORAGE_KEYS.THEME, legacyTheme, 'migrating theme preference');
          if (writeRes && writeRes.ok) {
            const verified = safeStorageRead(STORAGE_KEYS.THEME).raw;
            if (verified === legacyTheme) {
              safeStorageRemove(LEGACY_STORAGE_KEYS.THEME);
            }
          }
        }
      }
    } catch (err) {
      console.warn('Qavora: Error during legacy workspace storage migration', err);
    }
  }

  const Storage = {
    getProjects() {
      try {
        migrateLegacyWorkspaceStorage();
        const { raw } = safeStorageRead(STORAGE_KEYS.PROJECTS);
        if (!raw) return [];
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (jsonErr) {
          console.error('Qavora: JSON parse error in localStorage projects', jsonErr);
          if (typeof showToast === 'function') {
            showToast('Warning: Unable to parse local project records. Stored data preserved.', 'error');
          }
          return [];
        }
        if (!Array.isArray(parsed)) return [];

        let needsPersistence = false;

        const normalizedProjects = parsed.map((rawP, pIdx) => {
          const p = (rawP && typeof rawP === 'object') ? rawP : {};
          let projId = (p.id !== undefined && p.id !== null && String(p.id).trim() !== '')
            ? String(p.id).trim()
            : null;
          if (!projId) {
            projId = 'proj_' + Date.now() + '_' + pIdx + '_' + Math.random().toString(36).substring(2, 7);
            needsPersistence = true;
          }

          const createdAt = p.createdAt || new Date().toISOString();
          const updatedAt = p.updatedAt || createdAt;

          // Normalize Test Plan
          const rawPlan = p.testPlan || {};
          const planPhases = Array.isArray(rawPlan.phases) ? rawPlan.phases.map((ph, phIdx) => ({
            id: ph.id || ('phase_' + Date.now() + '_' + phIdx),
            name: (ph.name !== undefined && ph.name !== null && String(ph.name).trim() !== '') ? String(ph.name).trim() : 'Phase ' + (phIdx + 1),
            phaseNumber: (ph.phaseNumber !== undefined && ph.phaseNumber !== null && String(ph.phaseNumber).trim() !== '') ? String(ph.phaseNumber).trim() : '',
            description: typeof ph.description === 'string' ? ph.description.trim() : '',
            order: typeof ph.order === 'number' ? ph.order : phIdx
          })) : [];

          const testPlan = {
            id: rawPlan.id || ('plan_' + projId),
            name: rawPlan.name || (p.name ? `${p.name} Master Test Plan` : 'Master Manual QA Plan'),
            description: typeof rawPlan.description === 'string' ? rawPlan.description.trim() : '',
            objective: typeof rawPlan.objective === 'string' ? rawPlan.objective.trim() : '',
            scope: typeof rawPlan.scope === 'string' ? rawPlan.scope.trim() : '',
            notes: typeof rawPlan.notes === 'string' ? rawPlan.notes.trim() : '',
            createdAt: rawPlan.createdAt || createdAt,
            updatedAt: rawPlan.updatedAt || updatedAt,
            phases: planPhases
          };

          // Normalize Test Suites & Test Cases
          const testSuites = Array.isArray(p.testSuites) ? p.testSuites.map((s, sIdx) => {
            const rawCases = Array.isArray(s.testCases) ? s.testCases : [];
            const testCases = rawCases.map((tc, tcIdx) => {
              const rawSteps = Array.isArray(tc.steps) ? tc.steps : [];
              const steps = rawSteps.map((st, stIdx) => ({
                id: st.id || ('step_' + Date.now() + '_' + stIdx),
                action: typeof st.action === 'string' ? st.action.trim() : '',
                testData: typeof st.testData === 'string' ? st.testData.trim() : (typeof st.testData === 'number' ? String(st.testData) : ''),
                order: typeof st.order === 'number' ? st.order : stIdx
              }));

              const validStatuses = ['Pass', 'Fail', 'Blocked', 'Skipped', 'Not Run'];
              const caseStatus = validStatuses.includes(tc.status) ? tc.status : 'Not Run';

              return {
                id: (tc.id !== undefined && tc.id !== null && String(tc.id).trim() !== '') ? String(tc.id).trim() : `TC-${String(tcIdx + 1).padStart(3, '0')}`,
                title: tc.title || 'Untitled Test Case',
                description: typeof tc.description === 'string' ? tc.description.trim() : '',
                preconditions: typeof tc.preconditions === 'string' ? tc.preconditions.trim() : '',
                steps: steps,
                expectedResult: typeof tc.expectedResult === 'string' ? tc.expectedResult.trim() : '',
                priority: ['Critical', 'High', 'Medium', 'Low'].includes(tc.priority) ? tc.priority : (classifyPriority(tc.priority) || 'High'),
                category: tc.category || s.category || 'Functional',
                tags: Array.isArray(tc.tags) ? tc.tags : [],
                status: caseStatus,
                lastExecutedAt: tc.lastExecutedAt || null,
                lastExecutionId: tc.lastExecutionId || null,
                executions: Array.isArray(tc.executions) ? tc.executions : [],
                defectIds: Array.isArray(tc.defectIds) ? tc.defectIds : [],
                createdAt: tc.createdAt || createdAt,
                updatedAt: tc.updatedAt || updatedAt
              };
            });

            return {
              id: s.id || ('suite_' + Date.now() + '_' + sIdx),
              phaseId: s.phaseId || (planPhases[0] ? planPhases[0].id : ''),
              name: s.name || 'Test Suite ' + (sIdx + 1),
              description: typeof s.description === 'string' ? s.description.trim() : '',
              category: s.category || 'Functional',
              tags: Array.isArray(s.tags) ? s.tags : [],
              order: typeof s.order === 'number' ? s.order : sIdx,
              createdAt: s.createdAt || createdAt,
              updatedAt: s.updatedAt || updatedAt,
              testCases: testCases
            };
          }) : [];

          // Normalize Executions Array (Prompt 4)
          const executions = Array.isArray(p.executions) ? p.executions.map(ex => ({
            id: ex.id || ('exec_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)),
            testCaseId: (ex.testCaseId !== undefined && ex.testCaseId !== null) ? String(ex.testCaseId) : '',
            testCaseTitle: ex.testCaseTitle || '',
            suiteId: ex.suiteId || '',
            phaseId: ex.phaseId || '',
            status: ['Pass', 'Fail', 'Blocked', 'Skipped'].includes(ex.status) ? ex.status : 'Pass',
            actualResult: typeof ex.actualResult === 'string' ? ex.actualResult.trim() : '',
            notes: typeof ex.notes === 'string' ? ex.notes.trim() : '',
            tester: typeof ex.tester === 'string' ? ex.tester.trim() : '',
            environment: typeof ex.environment === 'string' ? ex.environment.trim() : '',
            browserDevice: typeof ex.browserDevice === 'string' ? ex.browserDevice.trim() : '',
            buildVersion: typeof ex.buildVersion === 'string' ? ex.buildVersion.trim() : '',
            stepResults: Array.isArray(ex.stepResults) ? ex.stepResults : [],
            defectIds: Array.isArray(ex.defectIds) ? ex.defectIds : [],
            executedAt: ex.executedAt || new Date().toISOString()
          })) : [];

          // Normalize Defects Array (Prompt 4 & ISSUE-007 Fix)
          const defects = Array.isArray(p.defects) ? p.defects.map((df, dfIdx) => {
            const rawPriority = df.priority;
            const rawSeverity = df.severity;
            const classified = classifyDefectPriority(df);

            return {
              id: df.id || `DEF-${String(dfIdx + 1).padStart(3, '0')}`,
              testCaseId: (df.testCaseId !== undefined && df.testCaseId !== null) ? String(df.testCaseId) : '',
              executionId: df.executionId || '',
              title: df.title || 'Untitled Defect',
              description: typeof df.description === 'string' ? df.description.trim() : '',
              priority: rawPriority !== undefined ? rawPriority : (classified || rawSeverity || ''),
              severity: classified || (typeof rawSeverity === 'string' && rawSeverity.trim() ? rawSeverity.trim() : (typeof rawPriority === 'string' && rawPriority.trim() ? rawPriority.trim() : '')),
              status: ['Open', 'In Progress', 'Resolved', 'Closed', 'Reopened'].includes(df.status) ? df.status : 'Open',
              stepsToReproduce: typeof df.stepsToReproduce === 'string' ? df.stepsToReproduce.trim() : '',
              expectedResult: typeof df.expectedResult === 'string' ? df.expectedResult.trim() : '',
              actualResult: typeof df.actualResult === 'string' ? df.actualResult.trim() : '',
              externalIssueUrl: typeof df.externalIssueUrl === 'string' ? df.externalIssueUrl.trim() : '',
              createdAt: df.createdAt || createdAt,
              updatedAt: df.updatedAt || updatedAt
            };
          }) : [];

          // Compute aggregated testing statistics (Prompt 4 strict formulas)
          let totalCases = 0;
          let passedCases = 0;
          let failedCases = 0;
          let blockedCases = 0;
          let skippedCases = 0;

          testSuites.forEach(suite => {
            suite.testCases.forEach(tc => {
              totalCases++;
              if (tc.status === 'Pass') passedCases++;
              else if (tc.status === 'Fail') failedCases++;
              else if (tc.status === 'Blocked') blockedCases++;
              else if (tc.status === 'Skipped') skippedCases++;
            });
          });

          const notRunCases = Math.max(0, totalCases - (passedCases + failedCases + blockedCases + skippedCases));
          const executedCases = passedCases + failedCases + blockedCases + skippedCases;
          const completionPercent = totalCases > 0 ? Math.round((executedCases / totalCases) * 100) : 0;
          const passRate = executedCases > 0 ? Math.round((passedCases / executedCases) * 100) : 0;
          const openDefectsCount = defects.filter(d => ['Open', 'In Progress', 'Reopened'].includes(d.status)).length;

          return {
            id: projId,
            name: p.name || 'Untitled Project',
            type: VALID_PROJECT_TYPES.includes(p.type) ? p.type : 'Other',
            status: VALID_STATUSES.includes(p.status) ? p.status : 'Active',
            version: typeof p.version === 'string' ? p.version.trim() : (typeof p.version === 'number' ? String(p.version) : ''),
            description: typeof p.description === 'string' ? p.description.trim() : '',
            sourceChecklistId: typeof p.sourceChecklistId === 'string' && p.sourceChecklistId.trim() ? p.sourceChecklistId.trim() : null,
            promotedFromChecklistTitle: typeof p.promotedFromChecklistTitle === 'string' && p.promotedFromChecklistTitle.trim() ? p.promotedFromChecklistTitle.trim() : null,
            promotedAt: typeof p.promotedAt === 'string' && p.promotedAt.trim() ? p.promotedAt.trim() : null,
            createdAt: createdAt,
            updatedAt: updatedAt,
            testCaseCount: totalCases,
            passedTests: passedCases,
            failedTests: failedCases,
            blockedTests: blockedCases,
            skippedTests: skippedCases,
            notRunTests: notRunCases,
            executedTests: executedCases,
            completionRate: completionPercent,
            passRate: passRate,
            totalDefects: defects.length,
            openDefects: openDefectsCount,
            testPlan: testPlan,
            testSuites: testSuites,
            executions: executions,
            defects: defects
          };
        });

        if (needsPersistence) {
          try {
            Storage.saveProjects(normalizedProjects);
          } catch (persistErr) {
            console.error('Qavora: Failed to auto-persist generated project IDs', persistErr);
          }
        }

        return normalizedProjects;
      } catch (err) {
        console.error('Qavora: Failed to read projects from localStorage', err);
        return [];
      }
    },

    saveProjects(projects) {
      try {
        const payload = JSON.stringify(projects);
        const res = safeStorageWrite(STORAGE_KEYS.PROJECTS, payload, 'saving projects');
        if (!res.ok) {
          if (typeof showToast === 'function') {
            showToast(res.error, 'error');
          }
        }
        return res;
      } catch (err) {
        const isQuota = isQuotaExceededError(err);
        const isSecurity = isSecurityError(err);
        const errorMsg = getStorageErrorMessage(err, 'saving projects');
        console.error('Qavora: Failed to persist projects to storage', err);
        if (typeof showToast === 'function') {
          showToast(errorMsg, 'error');
        }
        return {
          ok: false,
          error: errorMsg,
          isQuota,
          isSecurity,
          valueOf() { return false; }
        };
      }
    },

    getActivities() {
      try {
        migrateLegacyWorkspaceStorage();
        const { raw } = safeStorageRead(STORAGE_KEYS.ACTIVITIES);
        if (!raw) return [];
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return [];
        }
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        console.error('Qavora: Failed to read activities', err);
        return [];
      }
    },

    saveActivities(activities) {
      try {
        const payload = JSON.stringify(activities);
        return safeStorageWrite(STORAGE_KEYS.ACTIVITIES, payload, 'saving activities');
      } catch (err) {
        console.error('Qavora: Failed to persist activities', err);
        return {
          ok: false,
          error: getStorageErrorMessage(err, 'saving activities'),
          isQuota: isQuotaExceededError(err),
          isSecurity: isSecurityError(err),
          valueOf() { return false; }
        };
      }
    },

    addActivity(action, targetName) {
      try {
        const activities = this.getActivities();
        const newEntry = {
          id: 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
          action: action,
          target: targetName,
          timestamp: new Date().toISOString()
        };
        activities.unshift(newEntry);
        if (activities.length > 60) activities.length = 60;
        this.saveActivities(activities);
        return newEntry;
      } catch (err) {
        console.warn('Qavora: Unable to record activity', err);
        return null;
      }
    },

    clearActivities() {
      try {
        safeStorageRemove(STORAGE_KEYS.ACTIVITIES);
      } catch (err) {
        console.error('Qavora: Failed to clear activities', err);
      }
    },

    saveRollbackSnapshot(projects, activities, qaChecklists = null, qaActiveRunner = undefined) {
      try {
        const checklistsToSave = Array.isArray(qaChecklists)
          ? qaChecklists
          : loadAllChecklists().checklists;
        const runnerStateToSave = normalizeActiveRunnerState(
          qaActiveRunner !== undefined ? qaActiveRunner : getActiveRunnerState(),
          checklistsToSave
        );
        sessionStorage.setItem(ROLLBACK_KEY, JSON.stringify({
          timestamp: new Date().toISOString(),
          projects: projects,
          activities: activities,
          qaChecklists: checklistsToSave,
          qaActiveRunner: runnerStateToSave
        }));
      } catch (err) {
        console.warn('Qavora: Unable to write rollback to sessionStorage', err);
      }
    },

    getRollbackSnapshot() {
      try {
        const raw = sessionStorage.getItem(ROLLBACK_KEY) || sessionStorage.getItem(LEGACY_ROLLBACK_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },

    clearRollbackSnapshot() {
      try {
        sessionStorage.removeItem(ROLLBACK_KEY);
        sessionStorage.removeItem(LEGACY_ROLLBACK_KEY);
      } catch {}
    },

    getTheme() {
      try {
        migrateLegacyWorkspaceStorage();
        const { raw } = safeStorageRead(STORAGE_KEYS.THEME);
        return raw || 'dark';
      } catch {
        return 'dark';
      }
    },

    saveTheme(theme) {
      try {
        return safeStorageWrite(STORAGE_KEYS.THEME, theme, 'saving theme');
      } catch (err) {
        console.error('Qavora: Failed to save theme', err);
      }
    },

    getPreferences() {
      const defaultPrefs = {
        density: 'comfortable',
        defaultProjectSort: 'newest',
        defaultCasePriority: 'Medium',
        autopassSteps: true,
        actionToasts: true
      };
      try {
        const { raw } = safeStorageRead(STORAGE_KEYS.PREFERENCES);
        if (!raw) return { ...defaultPrefs };
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return { ...defaultPrefs };
        }
        if (!parsed || typeof parsed !== 'object') return { ...defaultPrefs };
        return {
          density: parsed.density === 'compact' ? 'compact' : 'comfortable',
          defaultProjectSort: ['newest', 'oldest', 'name-asc', 'name-desc'].includes(parsed.defaultProjectSort)
            ? parsed.defaultProjectSort
            : (parsed.defaultProjectSort === 'name' ? 'name-asc' : (parsed.defaultProjectSort === 'cases' ? 'name-desc' : 'newest')),
          defaultCasePriority: ['Critical', 'High', 'Medium', 'Low'].includes(parsed.defaultCasePriority)
            ? parsed.defaultCasePriority
            : 'Medium',
          autopassSteps: typeof parsed.autopassSteps === 'boolean' ? parsed.autopassSteps : true,
          actionToasts: typeof parsed.actionToasts === 'boolean' ? parsed.actionToasts : true
        };
      } catch (_err) {
        return { ...defaultPrefs };
      }
    },

    savePreferences(prefs) {
      try {
        const current = Storage.getPreferences();
        const candidate = { ...current, ...(prefs || {}) };
        const clean = {
          density: candidate.density === 'compact' ? 'compact' : 'comfortable',
          defaultProjectSort: ['newest', 'oldest', 'name-asc', 'name-desc'].includes(candidate.defaultProjectSort)
            ? candidate.defaultProjectSort
            : (candidate.defaultProjectSort === 'name' ? 'name-asc' : (candidate.defaultProjectSort === 'cases' ? 'name-desc' : 'newest')),
          defaultCasePriority: ['Critical', 'High', 'Medium', 'Low'].includes(candidate.defaultCasePriority)
            ? candidate.defaultCasePriority
            : 'Medium',
          autopassSteps: typeof candidate.autopassSteps === 'boolean' ? candidate.autopassSteps : true,
          actionToasts: typeof candidate.actionToasts === 'boolean' ? candidate.actionToasts : true
        };
        safeStorageWrite(STORAGE_KEYS.PREFERENCES, JSON.stringify(clean), 'saving preferences');
        return clean;
      } catch (err) {
        console.error('Qavora: Failed to save preferences', err);
        return Storage.getPreferences();
      }
    },

    getNotifications() {
      try {
        const { raw } = safeStorageRead(STORAGE_KEYS.NOTIFICATIONS);
        if (!raw) return [];
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return [];
        }
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(item => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.title === 'string');
      } catch (_err) {
        return [];
      }
    },

    saveNotifications(notifications) {
      try {
        const safeList = Array.isArray(notifications) ? notifications.slice(0, 50) : [];
        safeStorageWrite(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(safeList), 'saving notifications');
        return safeList;
      } catch (err) {
        console.error('Qavora: Failed to save notifications', err);
        return [];
      }
    }
  };

  // ==========================================================================
  // DOM Elements Cache
  // ==========================================================================
  const DOM = {
    // Navigation & Shell
    sidebar: document.getElementById('sidebar'),
    sidebarToggleBtn: document.getElementById('sidebar-toggle-btn'),
    sidebarCloseBtn: document.getElementById('sidebar-close-btn'),
    sidebarOverlay: document.getElementById('sidebar-overlay'),
    navLinks: document.querySelectorAll('.nav-link'),
    viewSections: document.querySelectorAll('.view-section'),
    pageTitle: document.getElementById('page-title'),
    pageSubtitle: document.getElementById('page-subtitle'),
    navProjectCount: document.getElementById('nav-project-count'),
    navCasesCount: document.getElementById('nav-cases-count'),
    themeToggleBtn: document.getElementById('theme-toggle-btn'),
    topQuickSearch: document.getElementById('top-quick-search'),

    // Dashboard Stats
    statProjects: document.getElementById('stat-projects'),
    statCases: document.getElementById('stat-cases'),
    statPassed: document.getElementById('stat-passed'),
    statFailed: document.getElementById('stat-failed'),
    statProgress: document.getElementById('stat-progress'),
    statProgressSub: document.getElementById('stat-progress-sub'),
    statProgressBar: document.getElementById('stat-progress-bar'),

    // Dashboard Panels
    recentProjectsContainer: document.getElementById('recent-projects-container'),
    recentProjectsCounter: document.getElementById('recent-projects-counter'),
    viewAllProjectsBtn: document.getElementById('view-all-projects-btn'),
    recentActivityContainer: document.getElementById('recent-activity-container'),
    clearActivityBtn: document.getElementById('clear-activity-btn'),

    // My Projects View
    projectsCreateBtn: document.getElementById('projects-create-btn'),
    myStatTotal: document.getElementById('my-stat-total'),
    myStatActive: document.getElementById('my-stat-active'),
    myStatCompleted: document.getElementById('my-stat-completed'),
    myStatArchived: document.getElementById('my-stat-archived'),
    projectSearchInput: document.getElementById('project-search-input'),
    searchClearBtn: document.getElementById('search-clear-btn'),
    projectFilterType: document.getElementById('project-filter-type'),
    projectFilterStatus: document.getElementById('project-filter-status'),
    projectSortBy: document.getElementById('project-sort-by'),
    projectsClearFiltersBtn: document.getElementById('projects-clear-filters-btn'),
    projectsFilterMeta: document.getElementById('projects-filter-meta'),
    projectsGrid: document.getElementById('projects-grid'),

    // Project Details View
    detailBackCrumb: document.getElementById('detail-back-crumb'),
    detailBreadcrumbTitle: document.getElementById('detail-breadcrumb-title'),
    detailName: document.getElementById('detail-name'),
    detailStatusBadge: document.getElementById('detail-status-badge'),
    detailTypeBadge: document.getElementById('detail-type-badge'),
    detailVersionBadge: document.getElementById('detail-version-badge'),
    detailExecBtn: document.getElementById('detail-exec-btn'),
    detailOpenPlanBtn: document.getElementById('detail-open-plan-btn'),
    detailDefectsBtn: document.getElementById('detail-defects-btn'),
    detailEditBtn: document.getElementById('detail-edit-btn'),
    detailDeleteBtn: document.getElementById('detail-delete-btn'),
    detailBackBtn: document.getElementById('detail-back-btn'),
    detailMetaType: document.getElementById('detail-meta-type'),
    detailMetaStatus: document.getElementById('detail-meta-status'),
    detailMetaVersion: document.getElementById('detail-meta-version'),
    detailMetaCreated: document.getElementById('detail-meta-created'),
    detailMetaUpdated: document.getElementById('detail-meta-updated'),
    detailProgressPercent: document.getElementById('detail-progress-percent'),
    detailProgressSub: document.getElementById('detail-progress-sub'),
    detailProgressBar: document.getElementById('detail-progress-bar'),
    detailStatPhases: document.getElementById('detail-stat-phases'),
    detailStatSuites: document.getElementById('detail-stat-suites'),
    detailStatCases: document.getElementById('detail-stat-cases'),
    detailStatPassed: document.getElementById('detail-stat-passed'),
    detailStatFailed: document.getElementById('detail-stat-failed'),
    detailStatNotRun: document.getElementById('detail-stat-notrun'),
    detailSuitesCounter: document.getElementById('detail-suites-counter'),
    detailQuickAddPhaseBtn: document.getElementById('detail-quick-add-phase-btn'),
    detailQuickAddSuiteBtn: document.getElementById('detail-quick-add-suite-btn'),
    detailGotoPlansBtn: document.getElementById('detail-goto-plans-btn'),
    detailSuitesContainer: document.getElementById('detail-suites-container'),

    // Test Plans Workspace View
    plansProjectSelect: document.getElementById('plans-project-select'),
    plansEditPlanBtn: document.getElementById('plans-edit-plan-btn'),
    plansAddPhaseBtn: document.getElementById('plans-add-phase-btn'),
    plansNoProjectsView: document.getElementById('plans-no-projects-view'),
    plansPhasesSubview: document.getElementById('plans-phases-subview'),
    plansCasesSubview: document.getElementById('plans-cases-subview'),

    // Plan Banner Info
    planName: document.getElementById('plan-name'),
    planCreatedDate: document.getElementById('plan-created-date'),
    planUpdatedDate: document.getElementById('plan-updated-date'),
    planObjective: document.getElementById('plan-objective'),
    planScope: document.getElementById('plan-scope'),
    planDesc: document.getElementById('plan-desc'),
    planStatPhases: document.getElementById('plan-stat-phases'),
    planStatSuites: document.getElementById('plan-stat-suites'),
    planStatCases: document.getElementById('plan-stat-cases'),
    planStatCrit: document.getElementById('plan-stat-crit'),
    planStatHigh: document.getElementById('plan-stat-high'),
    planStatMed: document.getElementById('plan-stat-med'),
    planStatLow: document.getElementById('plan-stat-low'),
    phasesCounterBadge: document.getElementById('phases-counter-badge'),
    phasesAddBtnSecondary: document.getElementById('phases-add-btn-secondary'),
    phasesContainer: document.getElementById('phases-container'),

    // Suite Cases Explorer Sub-View
    casesBackToPhasesBtn: document.getElementById('cases-back-to-phases-btn'),
    casesCrumbPhase: document.getElementById('cases-crumb-phase'),
    casesCrumbSuite: document.getElementById('cases-crumb-suite'),
    suiteViewTitle: document.getElementById('suite-view-title'),
    suiteViewCategory: document.getElementById('suite-view-category'),
    suiteViewTags: document.getElementById('suite-view-tags'),
    suiteViewDesc: document.getElementById('suite-view-desc'),
    suiteEditThisBtn: document.getElementById('suite-edit-this-btn'),
    suiteAddCaseBtn: document.getElementById('suite-add-case-btn'),
    caseSearchInput: document.getElementById('case-search-input'),
    caseSearchClearBtn: document.getElementById('case-search-clear-btn'),
    caseFilterPriority: document.getElementById('case-filter-priority'),
    caseFilterCategory: document.getElementById('case-filter-category'),
    caseSortBy: document.getElementById('case-sort-by'),
    caseClearFiltersBtn: document.getElementById('case-clear-filters-btn'),
    casesMetaCount: document.getElementById('cases-meta-count'),
    casesTableContainer: document.getElementById('cases-table-container'),

    // Project Modal
    projectModal: document.getElementById('project-modal'),
    modalTitle: document.getElementById('modal-title'),
    modalSubtitle: document.getElementById('modal-subtitle'),
    modalCloseBtn: document.getElementById('modal-close-btn'),
    modalCancelBtn: document.getElementById('modal-cancel-btn'),
    createProjectForm: document.getElementById('create-project-form'),
    projectIdInput: document.getElementById('project-id-input'),
    projectNameInput: document.getElementById('project-name-input'),
    projectTypeInput: document.getElementById('project-type-input'),
    projectStatusInput: document.getElementById('project-status-input'),
    projectVersionInput: document.getElementById('project-version-input'),
    projectDescInput: document.getElementById('project-desc-input'),
    modalErrorAlert: document.getElementById('modal-error-alert'),
    modalErrorText: document.getElementById('modal-error-text'),
    modalSubmitBtnText: document.getElementById('modal-submit-btn-text'),

    // Test Plan Edit Modal
    testplanModal: document.getElementById('testplan-modal'),
    testplanModalClose: document.getElementById('testplan-modal-close'),
    testplanModalCancel: document.getElementById('testplan-modal-cancel'),
    testplanForm: document.getElementById('testplan-form'),
    planNameInput: document.getElementById('plan-name-input'),
    planObjectiveInput: document.getElementById('plan-objective-input'),
    planScopeInput: document.getElementById('plan-scope-input'),
    planDescInput: document.getElementById('plan-desc-input'),

    // Phase Modal
    phaseModal: document.getElementById('phase-modal'),
    phaseModalTitle: document.getElementById('phase-modal-title'),
    phaseModalSubtitle: document.getElementById('phase-modal-subtitle'),
    phaseModalClose: document.getElementById('phase-modal-close'),
    phaseModalCancel: document.getElementById('phase-modal-cancel'),
    phaseForm: document.getElementById('phase-form'),
    phaseIdInput: document.getElementById('phase-id-input'),
    phaseNameInput: document.getElementById('phase-name-input'),
    phaseDescInput: document.getElementById('phase-desc-input'),
    phaseErrorAlert: document.getElementById('phase-error-alert'),
    phaseErrorText: document.getElementById('phase-error-text'),
    phaseModalSubmitText: document.getElementById('phase-modal-submit-text'),

    // Test Suite Modal
    suiteModal: document.getElementById('suite-modal'),
    suiteModalTitle: document.getElementById('suite-modal-title'),
    suiteModalSubtitle: document.getElementById('suite-modal-subtitle'),
    suiteModalClose: document.getElementById('suite-modal-close'),
    suiteModalCancel: document.getElementById('suite-modal-cancel'),
    suiteForm: document.getElementById('suite-form'),
    suiteIdInput: document.getElementById('suite-id-input'),
    suitePhaseSelect: document.getElementById('suite-phase-select'),
    suiteNameInput: document.getElementById('suite-name-input'),
    suiteCategorySelect: document.getElementById('suite-category-select'),
    suiteCustomCatGroup: document.getElementById('suite-custom-cat-group'),
    suiteCustomCatInput: document.getElementById('suite-custom-cat-input'),
    suiteTagsInput: document.getElementById('suite-tags-input'),
    suiteDescInput: document.getElementById('suite-desc-input'),
    suiteErrorAlert: document.getElementById('suite-error-alert'),
    suiteErrorText: document.getElementById('suite-error-text'),
    suiteModalSubmitText: document.getElementById('suite-modal-submit-text'),

    // Test Case Modal
    testcaseModal: document.getElementById('testcase-modal'),
    caseModalTitle: document.getElementById('case-modal-title'),
    caseModalSubtitle: document.getElementById('case-modal-subtitle'),
    caseModalClose: document.getElementById('case-modal-close'),
    caseModalCancel: document.getElementById('case-modal-cancel'),
    caseForm: document.getElementById('case-form'),
    caseIdInput: document.getElementById('case-id-input'),
    caseSuiteIdInput: document.getElementById('case-suite-id-input'),
    caseTitleInput: document.getElementById('case-title-input'),
    casePrioritySelect: document.getElementById('case-priority-select'),
    caseCategoryInput: document.getElementById('case-category-input'),
    caseTagsInput: document.getElementById('case-tags-input'),
    caseDescInput: document.getElementById('case-desc-input'),
    casePreconditionsInput: document.getElementById('case-preconditions-input'),
    btnAddStep: document.getElementById('btn-add-step'),
    tcStepsList: document.getElementById('tc-steps-list'),
    caseExpectedInput: document.getElementById('case-expected-input'),
    caseErrorAlert: document.getElementById('case-error-alert'),
    caseErrorText: document.getElementById('case-error-text'),
    caseModalSubmitText: document.getElementById('case-modal-submit-text'),

    // Test Case Inspection Modal
    testcaseViewModal: document.getElementById('testcase-view-modal'),
    viewCaseClose: document.getElementById('view-case-close'),
    viewCaseId: document.getElementById('view-case-id'),
    viewCaseTitle: document.getElementById('view-case-title'),
    viewCasePriority: document.getElementById('view-case-priority'),
    viewCaseCategory: document.getElementById('view-case-category'),
    viewCaseTags: document.getElementById('view-case-tags'),
    viewCaseDescBox: document.getElementById('view-case-desc-box'),
    viewCaseDesc: document.getElementById('view-case-desc'),
    viewCasePreconditionsBox: document.getElementById('view-case-preconditions-box'),
    viewCasePreconditions: document.getElementById('view-case-preconditions'),
    viewCaseStepsContainer: document.getElementById('view-case-steps-container'),
    viewCaseExpected: document.getElementById('view-case-expected'),
    viewCaseCreated: document.getElementById('view-case-created'),
    viewCaseUpdated: document.getElementById('view-case-updated'),
    viewCaseDuplicateBtn: document.getElementById('view-case-duplicate-btn'),
    viewCaseEditBtn: document.getElementById('view-case-edit-btn'),

    // Universal Delete Modal
    deleteModal: document.getElementById('delete-modal'),
    deleteDialogTitle: document.getElementById('delete-dialog-title'),
    deleteCloseBtn: document.getElementById('delete-close-btn'),
    deleteCancelBtn: document.getElementById('delete-cancel-btn'),
    deleteConfirmBtn: document.getElementById('delete-confirm-btn'),
    deleteProjectName: document.getElementById('delete-project-name'),
    deleteWarningMsg: document.getElementById('delete-warning-msg'),
    deleteConfirmBtnText: document.getElementById('delete-confirm-btn-text'),

    // Test Execution Workspace (Prompt 4)
    navDefectsCount: document.getElementById('nav-defects-count'),
    execProjectSelect: document.getElementById('exec-project-select'),
    execJumpDefectsBtn: document.getElementById('exec-jump-defects-btn'),
    execJumpPlansBtn: document.getElementById('exec-jump-plans-btn'),
    execNoProjectsView: document.getElementById('exec-no-projects-view'),
    execMainContent: document.getElementById('exec-main-content'),
    execStatTotal: document.getElementById('exec-stat-total'),
    execStatNotrun: document.getElementById('exec-stat-notrun'),
    execStatPassed: document.getElementById('exec-stat-passed'),
    execStatFailed: document.getElementById('exec-stat-failed'),
    execStatBlocked: document.getElementById('exec-stat-blocked'),
    execStatSkipped: document.getElementById('exec-stat-skipped'),
    execStatCompletion: document.getElementById('exec-stat-completion'),
    execStatCompletionBar: document.getElementById('exec-stat-completion-bar'),
    execStatPassrate: document.getElementById('exec-stat-passrate'),
    execSearchInput: document.getElementById('exec-search-input'),
    execSearchClearBtn: document.getElementById('exec-search-clear-btn'),
    execFilterPhase: document.getElementById('exec-filter-phase'),
    execFilterSuite: document.getElementById('exec-filter-suite'),
    execFilterStatus: document.getElementById('exec-filter-status'),
    execFilterPriority: document.getElementById('exec-filter-priority'),
    execFilterCategory: document.getElementById('exec-filter-category'),
    execSortBy: document.getElementById('exec-sort-by'),
    execClearFiltersBtn: document.getElementById('exec-clear-filters-btn'),
    execMetaCount: document.getElementById('exec-meta-count'),
    execTableContainer: document.getElementById('exec-table-container'),

    // Execution Runner Modal (Prompt 4)
    executionModal: document.getElementById('execution-modal'),
    execModalCaseId: document.getElementById('exec-modal-case-id'),
    execModalPriority: document.getElementById('exec-modal-priority'),
    execModalCategory: document.getElementById('exec-modal-category'),
    execModalTitle: document.getElementById('exec-modal-title'),
    execModalClose: document.getElementById('exec-modal-close'),
    execModalCancel: document.getElementById('exec-modal-cancel'),
    executionForm: document.getElementById('execution-form'),
    execCaseIdInput: document.getElementById('exec-case-id-input'),
    execProjectIdInput: document.getElementById('exec-project-id-input'),
    execErrorAlert: document.getElementById('exec-error-alert'),
    execErrorText: document.getElementById('exec-error-text'),
    execIncompleteWarning: document.getElementById('exec-incomplete-warning'),
    execIncompleteWarningText: document.getElementById('exec-incomplete-warning-text'),
    execCasePreconditions: document.getElementById('exec-case-preconditions'),
    execCaseDescWrap: document.getElementById('exec-case-desc-wrap'),
    execCaseDesc: document.getElementById('exec-case-desc'),
    execStepProgressText: document.getElementById('exec-step-progress-text'),
    btnPassAllSteps: document.getElementById('btn-pass-all-steps'),
    btnResetAllSteps: document.getElementById('btn-reset-all-steps'),
    execStepsProgressBar: document.getElementById('exec-steps-progress-bar'),
    execStepsContainer: document.getElementById('exec-steps-container'),
    execExpectedResult: document.getElementById('exec-expected-result'),
    execStatusSelect: document.getElementById('exec-status-select'),
    execTesterInput: document.getElementById('exec-tester-input'),
    execActualInput: document.getElementById('exec-actual-input'),
    execActualLabel: document.getElementById('exec-actual-label'),
    execActualHint: document.getElementById('exec-actual-hint'),
    execNotesInput: document.getElementById('exec-notes-input'),
    execEnvInput: document.getElementById('exec-env-input'),
    execDeviceInput: document.getElementById('exec-device-input'),
    execBuildInput: document.getElementById('exec-build-input'),
    execDefectSection: document.getElementById('exec-defect-section'),
    execLogDefectToggle: document.getElementById('exec-log-defect-toggle'),
    execDefectFields: document.getElementById('exec-defect-fields'),
    execDefectTitle: document.getElementById('exec-defect-title'),
    execDefectSeverity: document.getElementById('exec-defect-severity'),
    execDefectUrl: document.getElementById('exec-defect-url'),
    execDefectSteps: document.getElementById('exec-defect-steps'),
    execSubmitBtn: document.getElementById('exec-submit-btn'),

    // Execution History Modal (Prompt 4)
    executionHistoryModal: document.getElementById('execution-history-modal'),
    historyModalCaseId: document.getElementById('history-modal-case-id'),
    historyModalTotalRuns: document.getElementById('history-modal-total-runs'),
    historyModalTitle: document.getElementById('history-modal-title'),
    historyModalClose: document.getElementById('history-modal-close'),
    historyModalCloseBtn: document.getElementById('history-modal-close-btn'),
    historyModalCaseTitle: document.getElementById('history-modal-case-title'),
    historyRunsContainer: document.getElementById('history-runs-container'),
    historyExecuteAgainBtn: document.getElementById('history-execute-again-btn'),

    // Defects Workspace View (Prompt 4)
    defectsProjectSelect: document.getElementById('defects-project-select'),
    btnCreateDefect: document.getElementById('btn-create-defect'),
    defectsStatTotal: document.getElementById('defects-stat-total'),
    defectsStatOpen: document.getElementById('defects-stat-open'),
    defectsStatProgress: document.getElementById('defects-stat-progress'),
    defectsStatResolved: document.getElementById('defects-stat-resolved'),
    defectsStatCritical: document.getElementById('defects-stat-critical'),
    defectsSearchInput: document.getElementById('defects-search-input'),
    defectsSearchClearBtn: document.getElementById('defects-search-clear-btn'),
    defectsFilterSeverity: document.getElementById('defects-filter-severity'),
    defectsFilterStatus: document.getElementById('defects-filter-status'),
    defectsSortBy: document.getElementById('defects-sort-by'),
    defectsClearFiltersBtn: document.getElementById('defects-clear-filters-btn'),
    defectsMetaCount: document.getElementById('defects-meta-count'),
    defectsTableContainer: document.getElementById('defects-table-container'),

    // Defect Edit Modal (Prompt 4)
    defectModal: document.getElementById('defect-modal'),
    defectModalTitle: document.getElementById('defect-modal-title'),
    defectModalSubtitle: document.getElementById('defect-modal-subtitle'),
    defectModalClose: document.getElementById('defect-modal-close'),
    defectModalCancel: document.getElementById('defect-modal-cancel'),
    defectForm: document.getElementById('defect-form'),
    defectIdInput: document.getElementById('defect-id-input'),
    defectProjectIdInput: document.getElementById('defect-project-id-input'),
    defectProjectSelectField: document.getElementById('defect-project-select-field'),
    defectLinkedCaseSelect: document.getElementById('defect-linked-case-select'),
    defectTitleInput: document.getElementById('defect-title-input'),
    defectSeveritySelect: document.getElementById('defect-severity-select'),
    defectStatusSelect: document.getElementById('defect-status-select'),
    defectStepsInput: document.getElementById('defect-steps-input'),
    defectExpectedInput: document.getElementById('defect-expected-input'),
    defectActualInput: document.getElementById('defect-actual-input'),
    defectDescInput: document.getElementById('defect-desc-input'),
    defectUrlInput: document.getElementById('defect-url-input'),
    defectErrorAlert: document.getElementById('defect-error-alert'),
    defectErrorText: document.getElementById('defect-error-text'),
    defectModalSubmitText: document.getElementById('defect-modal-submit-text'),

    // Defect Inspection View Modal (Prompt 4)
    defectViewModal: document.getElementById('defect-view-modal'),
    viewDefectClose: document.getElementById('view-defect-close'),
    viewDefectId: document.getElementById('view-defect-id'),
    viewDefectTitle: document.getElementById('view-defect-title'),
    viewDefectSeverity: document.getElementById('view-defect-severity'),
    viewDefectStatus: document.getElementById('view-defect-status'),
    viewDefectProjectBadge: document.getElementById('view-defect-project-badge'),
    viewDefectStatusSelect: document.getElementById('view-defect-status-select'),
    viewDefectLinkedCaseWrap: document.getElementById('view-defect-linked-case-wrap'),
    viewDefectLinkedCase: document.getElementById('view-defect-linked-case'),
    viewDefectSteps: document.getElementById('view-defect-steps'),
    viewDefectExpected: document.getElementById('view-defect-expected'),
    viewDefectActual: document.getElementById('view-defect-actual'),
    viewDefectDescWrap: document.getElementById('view-defect-desc-wrap'),
    viewDefectDesc: document.getElementById('view-defect-desc'),
    viewDefectUrlWrap: document.getElementById('view-defect-url-wrap'),
    viewDefectUrlLink: document.getElementById('view-defect-url-link'),
    viewDefectUrlText: document.getElementById('view-defect-url-text'),
    viewDefectCreated: document.getElementById('view-defect-created'),
    viewDefectUpdated: document.getElementById('view-defect-updated'),
    viewDefectEditBtn: document.getElementById('view-defect-edit-btn'),

    // Toast Container
    toastContainer: document.getElementById('toast-container'),

    // Quick Entry Buttons
    headerCreateBtn: document.getElementById('header-create-btn'),
    heroCreateBtn: document.getElementById('hero-create-btn'),
    panelNewProjectBtn: document.getElementById('panel-new-project-btn'),

    // Dashboard QA Snapshot Widget (Prompt 5)
    dashAnalyticsTag: document.getElementById('dash-analytics-tag'),
    dashOpenReportsBtn: document.getElementById('dash-open-reports-btn'),
    dashStatExecs: document.getElementById('dash-stat-execs'),
    dashStatPassrate: document.getElementById('dash-stat-passrate'),
    dashStatDefects: document.getElementById('dash-stat-defects'),
    dashStatCoverage: document.getElementById('dash-stat-coverage'),
    dashBarPassCnt: document.getElementById('dash-bar-pass-cnt'),
    dashBarFailCnt: document.getElementById('dash-bar-fail-cnt'),
    dashBarBlockedCnt: document.getElementById('dash-bar-blocked-cnt'),
    dashBarSkippedCnt: document.getElementById('dash-bar-skipped-cnt'),
    dashBarPass: document.getElementById('dash-bar-pass'),
    dashBarFail: document.getElementById('dash-bar-fail'),
    dashBarBlocked: document.getElementById('dash-bar-blocked'),
    dashBarSkipped: document.getElementById('dash-bar-skipped'),

    // Reports Workspace View (Prompt 5)
    reportsProjectSelect: document.getElementById('reports-project-select'),
    reportsDateFilter: document.getElementById('reports-date-filter'),
    reportsCustomDates: document.getElementById('reports-custom-dates'),
    reportsDateStart: document.getElementById('reports-date-start'),
    reportsDateEnd: document.getElementById('reports-date-end'),
    reportsApplyCustomBtn: document.getElementById('reports-apply-custom-btn'),
    reportsRefreshBtn: document.getElementById('reports-refresh-btn'),
    reportsExportBtn: document.getElementById('reports-export-btn'),
    reportsNoProjectsView: document.getElementById('reports-no-projects-view'),
    reportsMainContent: document.getElementById('reports-main-content'),

    // Reports KPIs (11 cards)
    repKpiTotalCases: document.getElementById('rep-kpi-total-cases'),
    repKpiTotalExecs: document.getElementById('rep-kpi-total-execs'),
    repKpiExecutedCases: document.getElementById('rep-kpi-executed-cases'),
    repKpiExecutedRatio: document.getElementById('rep-kpi-executed-ratio'),
    repKpiNotrunCases: document.getElementById('rep-kpi-notrun-cases'),
    repKpiPassedExecs: document.getElementById('rep-kpi-passed-execs'),
    repKpiPassedRate: document.getElementById('rep-kpi-passed-rate'),
    repKpiFailedExecs: document.getElementById('rep-kpi-failed-execs'),
    repKpiFailedRate: document.getElementById('rep-kpi-failed-rate'),
    repKpiBlockedExecs: document.getElementById('rep-kpi-blocked-execs'),
    repKpiSkippedExecs: document.getElementById('rep-kpi-skipped-execs'),
    repKpiTotalDefects: document.getElementById('rep-kpi-total-defects'),
    repKpiOpenDefects: document.getElementById('rep-kpi-open-defects'),
    repKpiCriticalDefects: document.getElementById('rep-kpi-critical-defects'),
    repKpiResolvedDefects: document.getElementById('rep-kpi-resolved-defects'),
    repKpiDefectFixRate: document.getElementById('rep-kpi-defect-fix-rate'),

    // Reports QA Insights
    repHealthStatusBadge: document.getElementById('rep-health-status-badge'),
    reportsInsightsContainer: document.getElementById('reports-insights-container'),

    // Reports Donut Chart
    repDonutTag: document.getElementById('rep-donut-tag'),
    repDonutSvg: document.getElementById('rep-donut-svg'),
    repDonutCenterVal: document.getElementById('rep-donut-center-val'),
    repDonutCenterSub: document.getElementById('rep-donut-center-sub'),
    repDonutLegend: document.getElementById('rep-donut-legend'),

    // Reports Velocity Trend Chart
    repTrendChartWrap: document.getElementById('rep-trend-chart-wrap'),
    repTrendSvg: document.getElementById('rep-trend-svg'),
    repTrendFooter: document.getElementById('rep-trend-footer'),
    repTrendTotalSummary: document.getElementById('rep-trend-total-summary'),

    // Reports Daily Table
    repDailyCounter: document.getElementById('rep-daily-counter'),
    repDailyTableContainer: document.getElementById('rep-daily-table-container'),

    // Reports Phase Coverage
    repPhasesCounter: document.getElementById('rep-phases-counter'),
    repPhasesTableContainer: document.getElementById('rep-phases-table-container'),

    // Reports Priority Breakdown
    repPriorityContainer: document.getElementById('rep-priority-container'),

    // Reports Suites Matrix
    repSuitesCounter: document.getElementById('rep-suites-counter'),
    repSuitesTableContainer: document.getElementById('rep-suites-table-container'),

    // Reports Defect Analytics
    repDefectsBreakdownContainer: document.getElementById('rep-defects-breakdown-container'),
    repDefectsTableCounter: document.getElementById('rep-defects-table-counter'),
    repDefectsTableContainer: document.getElementById('rep-defects-table-container'),
    repJumpDefectsBtn: document.getElementById('rep-jump-defects-btn'),

    // Reports Activity Feed
    repActivityCounter: document.getElementById('rep-activity-counter'),
    repActivityTableContainer: document.getElementById('rep-activity-table-container'),
    repJumpExecBtn: document.getElementById('rep-jump-exec-btn'),

    // Data Management & Backups (Prompt 6)
    dataStatProjects: document.getElementById('data-stat-projects'),
    dataStatPlans: document.getElementById('data-stat-plans'),
    dataStatSuites: document.getElementById('data-stat-suites'),
    dataStatCases: document.getElementById('data-stat-cases'),
    dataStatExecs: document.getElementById('data-stat-execs'),
    dataStatDefects: document.getElementById('data-stat-defects'),
    dataStatChecklists: document.getElementById('data-stat-checklists'),
    dataStatChecklistsSub: document.getElementById('data-stat-checklists-sub'),
    dataStatStorageSize: document.getElementById('data-stat-storage-size'),
    dataStatStoragePercent: document.getElementById('data-stat-storage-percent'),
    dataStatStorageBar: document.getElementById('data-stat-storage-bar'),

    // Data Tabs
    dataTabBtns: document.querySelectorAll('.data-tab-btn'),
    dataTabPanels: document.querySelectorAll('.data-tab-panel'),

    // Export Card Controls
    exportProjectSelect: document.getElementById('export-project-select'),
    btnExportProjectJson: document.getElementById('btn-export-project-json'),
    printProjectSelect: document.getElementById('print-project-select'),
    printReportTypeSelect: document.getElementById('print-report-type-select'),
    btnPrintQaReport: document.getElementById('btn-print-qa-report'),
    exportCsvScopeSelect: document.getElementById('export-csv-scope-select'),
    btnExportCasesCsv: document.getElementById('btn-export-cases-csv'),
    btnExportExecsCsv: document.getElementById('btn-export-execs-csv'),
    btnExportDefectsCsv: document.getElementById('btn-export-defects-csv'),
    btnExportChecklistsCsv: document.getElementById('btn-export-checklists-csv'),

    // Import Card Controls
    importDropzone: document.getElementById('import-dropzone'),
    importFileInput: document.getElementById('import-file-input'),
    btnBrowseFile: document.getElementById('btn-browse-file'),
    importValidationAlert: document.getElementById('import-validation-alert'),
    importValidationText: document.getElementById('import-validation-text'),

    // Backup & Rollback Card Controls
    btnCreateFullBackup: document.getElementById('btn-create-full-backup'),
    rollbackStatusBadge: document.getElementById('rollback-status-badge'),
    rollbackSnapshotTitle: document.getElementById('rollback-snapshot-title'),
    rollbackSnapshotMeta: document.getElementById('rollback-snapshot-meta'),
    btnExecuteRollback: document.getElementById('btn-execute-rollback'),
    btnTriggerResetModal: document.getElementById('btn-trigger-reset-modal'),
    settingsJumpDataBtn: document.getElementById('settings-jump-data-btn'),

    // Phase 5: Settings Elements (QAV-ISS-010)
    settingsSaveIndicator: document.getElementById('settings-save-indicator'),
    settingsThemeSelect: document.getElementById('settings-theme-select'),
    settingsDensitySelect: document.getElementById('settings-density-select'),
    settingsProjectSortSelect: document.getElementById('settings-project-sort-select'),
    settingsCasePrioritySelect: document.getElementById('settings-case-priority-select'),
    settingsAutopassStepsToggle: document.getElementById('settings-autopass-steps-toggle'),
    settingsActionToastsToggle: document.getElementById('settings-action-toasts-toggle'),
    settingsStorageUsed: document.getElementById('settings-storage-used'),
    settingsStoragePercent: document.getElementById('settings-storage-percent'),
    settingsCountProjects: document.getElementById('settings-count-projects'),
    settingsCountChecklists: document.getElementById('settings-count-checklists'),
    settingsCountCases: document.getElementById('settings-count-cases'),
    settingsQuickBackupBtn: document.getElementById('settings-quick-backup-btn'),

    // Phase 5: Notifications Elements (QAV-ISS-011)
    notificationWrapper: document.getElementById('notification-wrapper'),
    notificationBtn: document.getElementById('notification-btn'),
    notificationIndicator: document.getElementById('notification-indicator'),
    notificationCountBadge: document.getElementById('notification-count-badge'),
    notificationPanel: document.getElementById('notification-panel'),
    notificationUnreadCount: document.getElementById('notification-unread-count'),
    notificationMarkAllBtn: document.getElementById('notification-mark-all-btn'),
    notificationClearAllBtn: document.getElementById('notification-clear-all-btn'),
    notificationList: document.getElementById('notification-list'),

    // Import Preview Modal
    importPreviewModal: document.getElementById('import-preview-modal'),
    importPreviewClose: document.getElementById('import-preview-close'),
    importPreviewFilename: document.getElementById('import-preview-filename'),
    importPreviewFilesize: document.getElementById('import-preview-filesize'),
    importPreviewFormat: document.getElementById('import-preview-format'),
    importPreviewDate: document.getElementById('import-preview-date'),
    importPreviewProjectsCnt: document.getElementById('import-preview-projects-cnt'),
    importPreviewPlansCnt: document.getElementById('import-preview-plans-cnt'),
    importPreviewSuitesCnt: document.getElementById('import-preview-suites-cnt'),
    importPreviewCasesCnt: document.getElementById('import-preview-cases-cnt'),
    importPreviewExecsCnt: document.getElementById('import-preview-execs-cnt'),
    importPreviewDefectsCnt: document.getElementById('import-preview-defects-cnt'),
    importPreviewProjectsList: document.getElementById('import-preview-projects-list'),
    importModeMerge: document.getElementById('import-mode-merge'),
    importModeReplace: document.getElementById('import-mode-replace'),
    importReplaceWarning: document.getElementById('import-replace-warning'),
    importReplaceWarningText: document.getElementById('import-replace-warning-text'),
    importPreviewCancelBtn: document.getElementById('import-preview-cancel-btn'),
    importPreviewConfirmBtn: document.getElementById('import-preview-confirm-btn'),
    importConfirmBtnText: document.getElementById('import-confirm-btn-text'),

    // Reset Confirm Modal
    resetConfirmModal: document.getElementById('reset-confirm-modal'),
    resetModalClose: document.getElementById('reset-modal-close'),
    resetConfirmCheckbox: document.getElementById('reset-confirm-checkbox'),
    resetBackupFirstBtn: document.getElementById('reset-backup-first-btn'),
    resetModalCancel: document.getElementById('reset-modal-cancel'),
    resetModalConfirmBtn: document.getElementById('reset-modal-confirm-btn'),

    // Printable Report Container
    printableReportContainer: document.getElementById('printable-report-container')
  };

  // ==========================================================================
  // Helper Utilities
  // ==========================================================================
  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function sanitizeExternalUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return '';
    const trimmed = rawUrl.trim();
    if (!trimmed) return '';

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.href;
      }
    } catch {
      return '';
    }
    return '';
  }

  function formatRelativeTime(isoString) {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffSec = Math.floor((now - date) / 1000);

      if (isNaN(diffSec) || diffSec < 5) return 'Just now';
      if (diffSec < 60) return `${diffSec}s ago`;
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHours = Math.floor(diffMin / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 7) return `${diffDays}d ago`;

      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
      });
    } catch {
      return 'Recently';
    }
  }

  function formatDisplayDate(isoString) {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return 'Unknown date';
    }
  }

  function formatDisplayDateTime(isoString) {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'Unknown date';
    }
  }

  function getBadgeClass(type) {
    switch (type) {
      case 'Website':
      case 'Web Application':
        return 'badge-web';
      case 'Mobile Application':
      case 'Desktop Application':
        return 'badge-mobile';
      case 'SaaS Platform':
      case 'Chatbot / AI Application':
        return 'badge-saas';
      case 'E-commerce':
        return 'badge-ecom';
      default:
        return 'project-badge';
    }
  }

  function getStatusBadgeClass(status) {
    switch (status) {
      case 'Completed':
        return 'status-completed';
      case 'Archived':
        return 'status-archived';
      case 'Active':
      default:
        return 'status-active';
    }
  }

  function getExecutionStatusBadgeClass(status) {
    switch (status) {
      case 'Pass':
        return 'status-pass';
      case 'Fail':
        return 'status-fail';
      case 'Blocked':
        return 'status-blocked';
      case 'Skipped':
        return 'status-skipped';
      case 'Not Run':
      default:
        return 'status-notrun';
    }
  }

  function getDefectStatusBadgeClass(status) {
    switch (status) {
      case 'Open':
        return 'status-open';
      case 'In Progress':
        return 'status-progress';
      case 'Resolved':
        return 'status-resolved';
      case 'Closed':
        return 'status-closed';
      case 'Reopened':
        return 'status-reopened';
      default:
        return 'status-open';
    }
  }

  function getPriorityBadgeClass(priority) {
    const category = classifyPriority(priority);
    switch (category) {
      case 'Critical':
        return 'p-critical';
      case 'High':
        return 'p-high';
      case 'Medium':
        return 'p-medium';
      case 'Low':
        return 'p-low';
      default:
        return 'p-low';
    }
  }

  function showToast(message, type = 'success') {
    if (!DOM.toastContainer) return;
    if (State.preferences && State.preferences.actionToasts === false && type !== 'error' && type !== 'warning') {
      return;
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const iconSvg = type === 'success'
      ? `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
           <polyline points="22 4 12 14.01 9 11.01"></polyline>
         </svg>`
      : `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <circle cx="12" cy="12" r="10"></circle>
           <line x1="12" y1="8" x2="12" y2="12"></line>
           <line x1="12" y1="16" x2="12.01" y2="16"></line>
         </svg>`;

    toast.innerHTML = `
      ${iconSvg}
      <span class="toast-message">${escapeHTML(message)}</span>
    `;

    DOM.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-hiding');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 250);
    }, 3200);
  }

  // ==========================================================================
  // Dashboard & Metrics Rendering
  // ==========================================================================
  function renderDashboard() {
    const projects = Storage.getProjects();
    const activities = Storage.getActivities();

    const totalProjects = projects.length;
    let totalCases = 0;
    let totalPassed = 0;
    let totalFailed = 0;
    let totalBlocked = 0;
    let totalSkipped = 0;
    let totalDefects = 0;
    let totalOpenDefects = 0;

    projects.forEach(project => {
      totalCases += Number(project.testCaseCount) || 0;
      totalPassed += Number(project.passedTests) || 0;
      totalFailed += Number(project.failedTests) || 0;
      totalBlocked += Number(project.blockedTests) || 0;
      totalSkipped += Number(project.skippedTests) || 0;
      totalDefects += Number(project.totalDefects) || 0;
      totalOpenDefects += Number(project.openDefects) || 0;
    });

    const totalExecuted = totalPassed + totalFailed + totalBlocked + totalSkipped;
    const progressPercent = totalCases > 0 ? Math.round((totalExecuted / totalCases) * 100) : 0;
    const passRate = totalExecuted > 0 ? Math.round((totalPassed / totalExecuted) * 100) : 0;

    if (DOM.statProjects) DOM.statProjects.textContent = totalProjects.toString();
    if (DOM.statCases) DOM.statCases.textContent = totalCases.toString();
    if (DOM.statPassed) DOM.statPassed.textContent = totalPassed.toString();
    if (DOM.statFailed) DOM.statFailed.textContent = totalFailed.toString();

    if (DOM.statProgress) DOM.statProgress.textContent = `${progressPercent}%`;
    if (DOM.statProgressSub) {
      DOM.statProgressSub.textContent = totalCases > 0
        ? `${totalExecuted} of ${totalCases} executed (${passRate}% pass rate)`
        : '0 of 0 executed';
    }
    if (DOM.statProgressBar) {
      DOM.statProgressBar.style.width = `${progressPercent}%`;
    }

    // Update Dashboard QA Snapshot Widget (Prompt 5)
    let totalExecRuns = 0;
    projects.forEach(p => {
      totalExecRuns += Array.isArray(p.executions) ? p.executions.length : 0;
    });

    if (DOM.dashStatExecs) DOM.dashStatExecs.textContent = totalExecRuns.toString();
    if (DOM.dashStatPassrate) DOM.dashStatPassrate.textContent = `${passRate}%`;
    if (DOM.dashStatDefects) DOM.dashStatDefects.textContent = totalOpenDefects.toString();
    if (DOM.dashStatCoverage) DOM.dashStatCoverage.textContent = `${totalExecuted} / ${totalCases}`;

    if (DOM.dashBarPassCnt) DOM.dashBarPassCnt.textContent = totalPassed.toString();
    if (DOM.dashBarFailCnt) DOM.dashBarFailCnt.textContent = totalFailed.toString();
    if (DOM.dashBarBlockedCnt) DOM.dashBarBlockedCnt.textContent = totalBlocked.toString();
    if (DOM.dashBarSkippedCnt) DOM.dashBarSkippedCnt.textContent = totalSkipped.toString();

    if (totalExecuted > 0) {
      const pPct = (totalPassed / totalExecuted) * 100;
      const fPct = (totalFailed / totalExecuted) * 100;
      const bPct = (totalBlocked / totalExecuted) * 100;
      const sPct = (totalSkipped / totalExecuted) * 100;
      if (DOM.dashBarPass) DOM.dashBarPass.style.width = `${pPct}%`;
      if (DOM.dashBarFail) DOM.dashBarFail.style.width = `${fPct}%`;
      if (DOM.dashBarBlocked) DOM.dashBarBlocked.style.width = `${bPct}%`;
      if (DOM.dashBarSkipped) DOM.dashBarSkipped.style.width = `${sPct}%`;
    } else {
      if (DOM.dashBarPass) DOM.dashBarPass.style.width = '0%';
      if (DOM.dashBarFail) DOM.dashBarFail.style.width = '0%';
      if (DOM.dashBarBlocked) DOM.dashBarBlocked.style.width = '0%';
      if (DOM.dashBarSkipped) DOM.dashBarSkipped.style.width = '0%';
    }

    // Sidebar Counters
    if (DOM.navProjectCount) DOM.navProjectCount.textContent = totalProjects.toString();
    if (DOM.navCasesCount) DOM.navCasesCount.textContent = totalCases.toString();
    if (DOM.navDefectsCount) DOM.navDefectsCount.textContent = totalOpenDefects.toString();
    if (DOM.recentProjectsCounter) DOM.recentProjectsCounter.textContent = `${totalProjects} total`;

    renderRecentProjects(projects);
    renderRecentActivities(activities);
  }

  function renderRecentProjects(projects) {
    if (!DOM.recentProjectsContainer) return;

    if (projects.length === 0) {
      DOM.recentProjectsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              <line x1="12" y1="11" x2="12" y2="17"></line>
              <line x1="9" y1="14" x2="15" y2="14"></line>
            </svg>
          </div>
          <h4 class="empty-state-title">No projects created yet</h4>
          <p class="empty-state-desc">Create your first software testing project to start organizing test suites, plans, and case executions.</p>
          <button type="button" class="btn btn-primary btn-sm empty-state-create-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>Create First Project</span>
          </button>
        </div>
      `;

      const emptyBtn = DOM.recentProjectsContainer.querySelector('.empty-state-create-btn');
      if (emptyBtn) emptyBtn.addEventListener('click', () => openProjectModal(null));
      return;
    }

    const sorted = [...projects].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const recent = sorted.slice(0, 5);

    let html = '<div class="project-card-list">';

    recent.forEach(proj => {
      const typeClass = getBadgeClass(proj.type);
      const statusClass = getStatusBadgeClass(proj.status);
      const descText = proj.description
        ? escapeHTML(proj.description)
        : '<em style="color: var(--text-muted);">No description provided</em>';

      const casesCount = Number.isFinite(Number(proj.testCaseCount)) ? Number(proj.testCaseCount) : 0;

      html += `
        <article class="project-item" data-id="${escapeHTML(proj.id)}" style="cursor: pointer;" title="Click to view project details">
          <div class="project-item-top">
            <h4 class="project-item-title" title="${escapeHTML(proj.name)}">${escapeHTML(proj.name)}</h4>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="status-badge ${statusClass}">${escapeHTML(proj.status)}</span>
              <span class="project-badge ${typeClass}">${escapeHTML(proj.type)}</span>
            </div>
          </div>
          <p class="project-item-desc">${descText}</p>
          <div class="project-item-meta">
            <div class="meta-group" title="Created date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              <span>${formatDisplayDate(proj.createdAt)}</span>
            </div>
            <div class="meta-group" title="Test case count">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 11 12 14 22 4"></polyline>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
              </svg>
              <span>${casesCount} test cases</span>
            </div>
          </div>
        </article>
      `;
    });

    html += '</div>';
    DOM.recentProjectsContainer.innerHTML = html;

    DOM.recentProjectsContainer.querySelectorAll('.project-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.getAttribute('data-id');
        if (id) openProjectDetails(id);
      });
    });
  }

  function renderRecentActivities(activities) {
    if (!DOM.recentActivityContainer) return;

    if (activities.length === 0) {
      DOM.recentActivityContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
          <h4 class="empty-state-title">No recent activity</h4>
          <p class="empty-state-desc">Actions such as creating projects, suites, or test cases will log live entries here.</p>
        </div>
      `;
      return;
    }

    let html = '<div class="activity-timeline">';

    activities.slice(0, 7).forEach(item => {
      html += `
        <div class="activity-item">
          <div class="activity-icon-bubble">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
              <path d="M2 17l10 5 10-5"></path>
              <path d="M2 12l10 5 10-5"></path>
            </svg>
          </div>
          <div class="activity-content">
            <div class="activity-text">
              ${escapeHTML(item.action)}: <span class="activity-target">${escapeHTML(item.target)}</span>
            </div>
            <div class="activity-time">${formatRelativeTime(item.timestamp)}</div>
          </div>
        </div>
      `;
    });

    html += '</div>';
    DOM.recentActivityContainer.innerHTML = html;
  }

  // ==========================================================================
  // My Projects Page (Prompt 2)
  // ==========================================================================
  function renderMyProjects() {
    const projects = Storage.getProjects();

    if (!State._hasCustomSort && State.preferences?.defaultProjectSort) {
      State.sortBy = State.preferences.defaultProjectSort;
      if (DOM.projectSortBy) DOM.projectSortBy.value = State.preferences.defaultProjectSort;
    }

    const totalCount = projects.length;
    const activeCount = projects.filter(p => p.status === 'Active').length;
    const completedCount = projects.filter(p => p.status === 'Completed').length;
    const archivedCount = projects.filter(p => p.status === 'Archived').length;

    if (DOM.myStatTotal) DOM.myStatTotal.textContent = totalCount.toString();
    if (DOM.myStatActive) DOM.myStatActive.textContent = activeCount.toString();
    if (DOM.myStatCompleted) DOM.myStatCompleted.textContent = completedCount.toString();
    if (DOM.myStatArchived) DOM.myStatArchived.textContent = archivedCount.toString();

    const hasActiveFilters = Boolean(
      (State.searchQuery && State.searchQuery.trim().length > 0) ||
      State.typeFilter !== 'ALL' ||
      State.statusFilter !== 'ALL' ||
      State.sortBy !== 'newest'
    );

    if (DOM.projectsClearFiltersBtn) {
      DOM.projectsClearFiltersBtn.style.display = hasActiveFilters ? 'inline-flex' : 'none';
    }

    if (DOM.searchClearBtn) {
      DOM.searchClearBtn.style.display = (State.searchQuery && State.searchQuery.length > 0) ? 'inline-flex' : 'none';
    }

    let filtered = projects.filter(project => {
      if (State.searchQuery && State.searchQuery.trim().length > 0) {
        const query = State.searchQuery.trim().toLowerCase();
        const nameMatch = (project.name || '').toLowerCase().includes(query);
        const descMatch = (project.description || '').toLowerCase().includes(query);
        const versionMatch = (project.version || '').toLowerCase().includes(query);
        if (!nameMatch && !descMatch && !versionMatch) return false;
      }

      if (State.typeFilter !== 'ALL' && project.type !== State.typeFilter) return false;
      if (State.statusFilter !== 'ALL' && project.status !== State.statusFilter) return false;

      return true;
    });

    filtered.sort((a, b) => {
      switch (State.sortBy) {
        case 'oldest':
          return new Date(a.createdAt) - new Date(b.createdAt);
        case 'name-asc':
          return (a.name || '').localeCompare(b.name || '');
        case 'name-desc':
          return (b.name || '').localeCompare(a.name || '');
        case 'newest':
        default:
          return new Date(b.createdAt) - new Date(a.createdAt);
      }
    });

    if (DOM.projectsFilterMeta) {
      if (projects.length === 0) {
        DOM.projectsFilterMeta.textContent = 'No projects available';
      } else if (hasActiveFilters) {
        DOM.projectsFilterMeta.textContent = `Showing ${filtered.length} of ${projects.length} projects (filtered)`;
      } else {
        DOM.projectsFilterMeta.textContent = `Showing all ${projects.length} projects`;
      }
    }

    if (!DOM.projectsGrid) return;

    if (projects.length === 0) {
      DOM.projectsGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; padding: 48px 20px;">
          <div class="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <h4 class="empty-state-title">No projects created yet</h4>
          <p class="empty-state-desc">Create your first testing project to start organizing test suites, manual cases, and execution runs.</p>
          <button type="button" class="btn btn-primary my-empty-create-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>Create New Project</span>
          </button>
        </div>
      `;

      const emptyBtn = DOM.projectsGrid.querySelector('.my-empty-create-btn');
      if (emptyBtn) emptyBtn.addEventListener('click', () => openProjectModal(null));
      return;
    }

    if (filtered.length === 0) {
      DOM.projectsGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; padding: 48px 20px;">
          <div class="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </div>
          <h4 class="empty-state-title">No matching projects found</h4>
          <p class="empty-state-desc">Try adjusting your search query or reset filters.</p>
          <button type="button" class="btn btn-secondary my-empty-reset-btn">
            <span>Clear Filters & Reset</span>
          </button>
        </div>
      `;

      const resetBtn = DOM.projectsGrid.querySelector('.my-empty-reset-btn');
      if (resetBtn) resetBtn.addEventListener('click', resetAllFilters);
      return;
    }

    let html = '';

    filtered.forEach(proj => {
      const typeClass = getBadgeClass(proj.type);
      const statusClass = getStatusBadgeClass(proj.status);
      const descText = proj.description
        ? escapeHTML(proj.description)
        : '<em style="color: var(--text-muted);">No description provided</em>';

      const casesCount = Number.isFinite(Number(proj.testCaseCount)) ? Number(proj.testCaseCount) : 0;
      const passedCount = Number.isFinite(Number(proj.passedTests)) ? Number(proj.passedTests) : 0;
      const failedCount = Number.isFinite(Number(proj.failedTests)) ? Number(proj.failedTests) : 0;
      const blockedCount = Number.isFinite(Number(proj.blockedTests)) ? Number(proj.blockedTests) : 0;
      const skippedCount = Number.isFinite(Number(proj.skippedTests)) ? Number(proj.skippedTests) : 0;
      const executed = Number.isFinite(Number(proj.executedTests))
        ? Number(proj.executedTests)
        : (passedCount + failedCount + blockedCount + skippedCount);
      const progressPercent = casesCount > 0 ? Math.round((executed / casesCount) * 100) : 0;
      const passRate = executed > 0 ? Math.round((passedCount / executed) * 100) : 0;

      const hasVersion = proj.version !== undefined && proj.version !== null && String(proj.version).trim() !== '';
      const versionBadge = hasVersion
        ? `<span class="version-tag">${escapeHTML(String(proj.version))}</span>`
        : '';

      html += `
        <article class="project-card" data-id="${escapeHTML(proj.id)}">
          <div class="project-card-header">
            <div class="project-card-top">
              <h3 class="project-card-title btn-open-project" data-id="${escapeHTML(proj.id)}" title="Open project details">${escapeHTML(proj.name)}</h3>
            </div>
            <div class="project-card-badges">
              <span class="status-badge ${statusClass}">${escapeHTML(proj.status)}</span>
              <span class="project-badge ${typeClass}">${escapeHTML(proj.type)}</span>
              ${versionBadge}
            </div>
            <p class="project-card-desc">${descText}</p>
          </div>

          <div class="card-testing-block">
            <div class="card-testing-header">
              <span class="card-cases-total">${casesCount} test cases (${executed} executed)</span>
              <div class="card-testing-counts">
                <span class="count-passed">${passedCount} pass</span>
                <span>•</span>
                <span class="count-failed">${failedCount} fail</span>
                ${blockedCount > 0 ? `<span>•</span><span style="color: var(--color-amber);">${blockedCount} blk</span>` : ''}
                <span>•</span>
                <span style="font-weight: 700; color: var(--accent-primary);">${progressPercent}%</span>
              </div>
            </div>
            <div class="card-progress-bar-track">
              <div class="card-progress-bar-fill" style="width: ${progressPercent}%;"></div>
            </div>
          </div>

          <div class="project-card-dates">
            <span>Created ${formatDisplayDate(proj.createdAt)}</span>
            <span>Updated ${formatRelativeTime(proj.updatedAt)}</span>
          </div>

          <div class="project-card-footer">
            <button type="button" class="btn btn-secondary btn-sm btn-open-project" data-id="${escapeHTML(proj.id)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
              <span>Open Project</span>
            </button>

            <div class="card-action-group">
              <button type="button" class="icon-btn btn-exec-project" data-id="${escapeHTML(proj.id)}" title="Run Test Execution">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--color-green);">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
              </button>
              <button type="button" class="icon-btn btn-open-plan" data-id="${escapeHTML(proj.id)}" title="Open Test Plan">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
              </button>
              <button type="button" class="icon-btn btn-edit-project" data-id="${escapeHTML(proj.id)}" title="Edit Project">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
              <button type="button" class="icon-btn btn-delete-project" data-id="${escapeHTML(proj.id)}" title="Delete Project">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--color-red);">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>
        </article>
      `;
    });

    DOM.projectsGrid.innerHTML = html;

    DOM.projectsGrid.querySelectorAll('.btn-open-project').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (id) openProjectDetails(id);
      });
    });

    DOM.projectsGrid.querySelectorAll('.btn-exec-project').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (id) switchView('execution', id);
      });
    });

    DOM.projectsGrid.querySelectorAll('.btn-open-plan').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (id) navigateToProjectPlan(id);
      });
    });

    DOM.projectsGrid.querySelectorAll('.btn-edit-project').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (id) openProjectModal(id);
      });
    });

    DOM.projectsGrid.querySelectorAll('.btn-delete-project').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (id) requestUniversalDelete('project', id, null);
      });
    });
  }

  function resetAllFilters() {
    State.searchQuery = '';
    State.typeFilter = 'ALL';
    State.statusFilter = 'ALL';
    const defaultSort = State.preferences?.defaultProjectSort || 'newest';
    State.sortBy = defaultSort;
    State._hasCustomSort = false;

    if (DOM.projectSearchInput) DOM.projectSearchInput.value = '';
    if (DOM.projectFilterType) DOM.projectFilterType.value = 'ALL';
    if (DOM.projectFilterStatus) DOM.projectFilterStatus.value = 'ALL';
    if (DOM.projectSortBy) DOM.projectSortBy.value = defaultSort;
    if (DOM.topQuickSearch) DOM.topQuickSearch.value = '';

    renderMyProjects();
  }

  // ==========================================================================
  // Project Details View Integration (Prompt 2 & 3)
  // ==========================================================================
  function openProjectDetails(projectId) {
    const projects = Storage.getProjects();
    const project = projects.find(p => p.id === projectId);

    if (!project) {
      showToast('Project could not be found.', 'error');
      switchView('projects');
      return;
    }

    State.currentDetailProjectId = projectId;
    switchView('project-details');
    renderProjectDetailsData(project);
  }

  function renderProjectDetailsData(project) {
    if (!project) return;

    if (DOM.detailBreadcrumbTitle) DOM.detailBreadcrumbTitle.textContent = project.name;
    if (DOM.detailName) DOM.detailName.textContent = project.name;
    if (DOM.detailDesc) {
      DOM.detailDesc.textContent = project.description || 'No description provided for this testing project.';
    }

    if (DOM.detailStatusBadge) {
      DOM.detailStatusBadge.className = `status-badge ${getStatusBadgeClass(project.status)}`;
      DOM.detailStatusBadge.textContent = project.status;
    }

    if (DOM.detailTypeBadge) {
      DOM.detailTypeBadge.className = `project-badge ${getBadgeClass(project.type)}`;
      DOM.detailTypeBadge.textContent = project.type;
    }

    const hasProjectVersion = project.version !== undefined && project.version !== null && String(project.version).trim() !== '';
    if (DOM.detailVersionBadge) {
      if (hasProjectVersion) {
        DOM.detailVersionBadge.textContent = String(project.version);
        DOM.detailVersionBadge.style.display = 'inline-block';
      } else {
        DOM.detailVersionBadge.style.display = 'none';
      }
    }

    if (DOM.detailMetaType) DOM.detailMetaType.textContent = project.type;
    if (DOM.detailMetaStatus) DOM.detailMetaStatus.textContent = project.status;
    if (DOM.detailMetaVersion) DOM.detailMetaVersion.textContent = hasProjectVersion ? String(project.version) : 'Not specified';
    if (DOM.detailMetaCreated) DOM.detailMetaCreated.textContent = formatDisplayDateTime(project.createdAt);
    if (DOM.detailMetaUpdated) DOM.detailMetaUpdated.textContent = formatDisplayDateTime(project.updatedAt);

    // Testing Metrics Calculations
    const phases = project.testPlan?.phases || [];
    const suites = project.testSuites || [];
    const casesCount = Number.isFinite(Number(project.testCaseCount)) ? Number(project.testCaseCount) : 0;
    const passedCount = Number.isFinite(Number(project.passedTests)) ? Number(project.passedTests) : 0;
    const failedCount = Number.isFinite(Number(project.failedTests)) ? Number(project.failedTests) : 0;
    const blockedCount = Number.isFinite(Number(project.blockedTests)) ? Number(project.blockedTests) : 0;
    const skippedCount = Number.isFinite(Number(project.skippedTests)) ? Number(project.skippedTests) : 0;
    const totalExecuted = Number.isFinite(Number(project.executedTests))
      ? Number(project.executedTests)
      : (passedCount + failedCount + blockedCount + skippedCount);
    const notRunCount = Number.isFinite(Number(project.notRunTests)) ? Number(project.notRunTests) : Math.max(0, casesCount - totalExecuted);
    const progressPercent = Number.isFinite(Number(project.completionRate)) ? Number(project.completionRate) : (casesCount > 0 ? Math.round((totalExecuted / casesCount) * 100) : 0);

    if (DOM.detailStatPhases) DOM.detailStatPhases.textContent = phases.length.toString();
    if (DOM.detailStatSuites) DOM.detailStatSuites.textContent = suites.length.toString();
    if (DOM.detailStatCases) DOM.detailStatCases.textContent = casesCount.toString();
    if (DOM.detailStatPassed) DOM.detailStatPassed.textContent = passedCount.toString();
    if (DOM.detailStatFailed) DOM.detailStatFailed.textContent = failedCount.toString();
    if (DOM.detailStatNotRun) DOM.detailStatNotRun.textContent = notRunCount.toString();

    if (DOM.detailProgressPercent) DOM.detailProgressPercent.textContent = `${progressPercent}%`;
    if (DOM.detailProgressSub) {
      DOM.detailProgressSub.textContent = casesCount > 0
        ? `${totalExecuted} of ${casesCount} tests executed`
        : '0 of 0 executed';
    }
    if (DOM.detailProgressBar) {
      DOM.detailProgressBar.style.width = `${progressPercent}%`;
    }

    if (DOM.detailSuitesCounter) {
      DOM.detailSuitesCounter.textContent = `${suites.length} suites • ${casesCount} cases`;
    }

    // Render Testing Architecture Preview inside Project Details
    renderProjectDetailsArchitecture(project);
  }

  function renderProjectDetailsArchitecture(project) {
    if (!DOM.detailSuitesContainer) return;

    const phases = project.testPlan?.phases || [];
    const suites = project.testSuites || [];

    if (phases.length === 0 && suites.length === 0) {
      DOM.detailSuitesContainer.innerHTML = `
        <div class="empty-state" style="padding: 32px 18px;">
          <div class="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
          </div>
          <h4 class="empty-state-title">No test suites or phases configured yet</h4>
          <p class="empty-state-desc">Define your first testing phase and build suites of test cases to start quality assurance.</p>
          <div style="display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap; justify-content: center;">
            <button type="button" class="btn btn-primary btn-sm btn-detail-add-phase">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>Add Testing Phase</span>
            </button>
            <button type="button" class="btn btn-secondary btn-sm btn-detail-open-plan">
              <span>Open Test Plan Workspace</span>
            </button>
          </div>
        </div>
      `;

      const addPhaseBtn = DOM.detailSuitesContainer.querySelector('.btn-detail-add-phase');
      if (addPhaseBtn) addPhaseBtn.addEventListener('click', () => openPhaseModal(null));

      const openPlanBtn = DOM.detailSuitesContainer.querySelector('.btn-detail-open-plan');
      if (openPlanBtn) openPlanBtn.addEventListener('click', () => navigateToProjectPlan(project.id));
      return;
    }

    let html = '<div style="display: flex; flex-direction: column; gap: 14px;">';

    phases.forEach((ph, pIdx) => {
      const phaseSuites = suites.filter(s => s.phaseId === ph.id);
      let phaseCases = 0;
      phaseSuites.forEach(s => phaseCases += (s.testCases?.length || 0));

      html += `
        <div class="phase-card" style="background-color: var(--bg-input);">
          <div class="phase-header" style="padding: 10px 14px;">
            <div class="phase-header-left">
              <span class="phase-order-badge">${pIdx + 1}</span>
              <div class="phase-title-group">
                <span style="font-weight: 700; color: var(--text-primary); font-size: 0.92rem;">${escapeHTML(ph.name)}</span>
                ${ph.description ? `<span class="phase-desc">${escapeHTML(ph.description)}</span>` : ''}
              </div>
            </div>
            <div class="phase-header-right">
              <span class="phase-counter-pill">${phaseSuites.length} suites • ${phaseCases} cases</span>
              <button type="button" class="btn btn-ghost btn-xs btn-detail-manage-phase" data-phase="${escapeHTML(ph.id)}">
                <span>Manage</span>
              </button>
            </div>
          </div>
          <div class="phase-body" style="padding: 10px 14px;">
            ${phaseSuites.length === 0 ? `<div style="font-size: 0.78rem; color: var(--text-muted); font-style: italic;">No suites in this phase yet.</div>` : ''}
            <div class="suites-grid">
      `;

      phaseSuites.forEach(s => {
        const cCount = s.testCases?.length || 0;
        html += `
          <div class="suite-card" style="background-color: var(--bg-card); padding: 10px 12px;">
            <div class="suite-card-top">
              <span style="font-weight: 700; font-size: 0.88rem; color: var(--text-primary);">${escapeHTML(s.name)}</span>
              <span class="project-badge badge-web" style="font-size: 0.65rem;">${escapeHTML(s.category)}</span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.74rem; color: var(--text-muted); margin-top: 6px;">
              <span>${cCount} test cases</span>
              <button type="button" class="btn btn-ghost btn-xs btn-open-suite-cases" data-suite="${escapeHTML(s.id)}" data-project="${escapeHTML(project.id)}" style="color: var(--accent-primary);">
                <span>Open Suite</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
            </div>
          </div>
        `;
      });

      html += `
            </div>
          </div>
        </div>
      `;
    });

    html += '</div>';
    DOM.detailSuitesContainer.innerHTML = html;

    DOM.detailSuitesContainer.querySelectorAll('.btn-open-suite-cases').forEach(btn => {
      btn.addEventListener('click', () => {
        const pId = btn.getAttribute('data-project');
        const sId = btn.getAttribute('data-suite');
        if (pId && sId) openSuiteCasesView(pId, sId);
      });
    });

    DOM.detailSuitesContainer.querySelectorAll('.btn-detail-manage-phase').forEach(btn => {
      btn.addEventListener('click', () => navigateToProjectPlan(project.id));
    });
  }

  // ==========================================================================
  // Prompt 3: Test Plans Workspace Architecture
  // ==========================================================================
  function navigateToProjectPlan(projectId) {
    State.activePlanProjectId = projectId;
    State.activeSuiteId = null;
    switchView('plans');
  }

  function renderTestPlansWorkspace() {
    const projects = Storage.getProjects();

    // 1. Guard check: projects empty state
    if (projects.length === 0) {
      if (DOM.plansProjectSelect) DOM.plansProjectSelect.innerHTML = '<option value="" disabled selected>No projects available</option>';
      if (DOM.plansNoProjectsView) DOM.plansNoProjectsView.style.display = 'block';
      if (DOM.plansPhasesSubview) DOM.plansPhasesSubview.style.display = 'none';
      if (DOM.plansCasesSubview) DOM.plansCasesSubview.style.display = 'none';
      return;
    }

    if (DOM.plansNoProjectsView) DOM.plansNoProjectsView.style.display = 'none';

    // 2. Resolve Active Project
    let activeProject = projects.find(p => p.id === State.activePlanProjectId);
    if (!activeProject) {
      activeProject = projects[0];
      State.activePlanProjectId = activeProject.id;
    }

    // 3. Populate Project Picker Select
    if (DOM.plansProjectSelect) {
      let optionsHtml = '';
      projects.forEach(p => {
        const isSelected = p.id === activeProject.id ? 'selected' : '';
        optionsHtml += `<option value="${escapeHTML(p.id)}" ${isSelected}>${escapeHTML(p.name)} (${p.status})</option>`;
      });
      DOM.plansProjectSelect.innerHTML = optionsHtml;
    }

    // 4. Decide whether to show Phases View or Suite Cases Explorer Sub-view
    if (State.activeSuiteId) {
      const targetSuite = (activeProject.testSuites || []).find(s => s.id === State.activeSuiteId);
      if (targetSuite) {
        if (DOM.plansPhasesSubview) DOM.plansPhasesSubview.style.display = 'none';
        if (DOM.plansCasesSubview) DOM.plansCasesSubview.style.display = 'block';
        renderSuiteCasesExplorer(activeProject, targetSuite);
        return;
      } else {
        // Suite was deleted or not found; fallback to phases subview
        State.activeSuiteId = null;
      }
    }

    if (DOM.plansPhasesSubview) DOM.plansPhasesSubview.style.display = 'block';
    if (DOM.plansCasesSubview) DOM.plansCasesSubview.style.display = 'none';

    renderPhasesSubview(activeProject);
  }

  function renderPhasesSubview(project) {
    const plan = project.testPlan || {};
    const phases = plan.phases || [];
    const suites = project.testSuites || [];

    // 1. Update Test Plan Info Banner
    if (DOM.planName) DOM.planName.textContent = plan.name || `${project.name} Test Plan`;
    if (DOM.planCreatedDate) DOM.planCreatedDate.textContent = `Created ${formatDisplayDate(plan.createdAt)}`;
    if (DOM.planUpdatedDate) DOM.planUpdatedDate.textContent = `Updated ${formatRelativeTime(plan.updatedAt)}`;

    if (DOM.planObjective) {
      DOM.planObjective.textContent = plan.objective || 'Not defined yet. Click "Edit Test Plan" to document goals.';
    }
    if (DOM.planScope) {
      DOM.planScope.textContent = plan.scope || 'Not defined yet. Click "Edit Test Plan" to document scope.';
    }
    if (DOM.planDesc) {
      DOM.planDesc.textContent = plan.description || plan.notes || 'No general description or notes provided.';
    }

    // 2. Compute Priority Distribution
    let critCount = 0;
    let highCount = 0;
    let medCount = 0;
    let lowCount = 0;
    let totalCases = 0;

    suites.forEach(suite => {
      (suite.testCases || []).forEach(tc => {
        totalCases++;
        const cPrio = classifyPriority(tc.priority);
        if (cPrio === 'Critical') critCount++;
        else if (cPrio === 'High') highCount++;
        else if (cPrio === 'Medium') medCount++;
        else if (cPrio === 'Low') lowCount++;
      });
    });

    if (DOM.planStatPhases) DOM.planStatPhases.textContent = phases.length.toString();
    if (DOM.planStatSuites) DOM.planStatSuites.textContent = suites.length.toString();
    if (DOM.planStatCases) DOM.planStatCases.textContent = totalCases.toString();

    if (DOM.planStatCrit) DOM.planStatCrit.textContent = critCount.toString();
    if (DOM.planStatHigh) DOM.planStatHigh.textContent = highCount.toString();
    if (DOM.planStatMed) DOM.planStatMed.textContent = medCount.toString();
    if (DOM.planStatLow) DOM.planStatLow.textContent = lowCount.toString();

    if (DOM.phasesCounterBadge) DOM.phasesCounterBadge.textContent = `${phases.length} phases`;

    // 3. Render Phases and Suites List
    if (!DOM.phasesContainer) return;

    if (phases.length === 0) {
      DOM.phasesContainer.innerHTML = `
        <div class="empty-state" style="padding: 48px 20px;">
          <div class="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
              <polyline points="2 17 12 22 22 17"></polyline>
              <polyline points="2 12 12 17 22 12"></polyline>
            </svg>
          </div>
          <h4 class="empty-state-title">No Testing Phases Created</h4>
          <p class="empty-state-desc">Phases allow you to divide testing into stages (e.g. Core Features, Integration, UI/UX, or Regression). Create your first phase to start adding suites.</p>
          <button type="button" class="btn btn-primary btn-sm btn-workspace-add-phase">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>Add Testing Phase</span>
          </button>
        </div>
      `;

      const btn = DOM.phasesContainer.querySelector('.btn-workspace-add-phase');
      if (btn) btn.addEventListener('click', () => openPhaseModal(null));
      return;
    }

    // Sort phases by order, falling back to numeric phase comparison
    const sortedPhases = [...phases].sort((a, b) => {
      const orderA = typeof a.order === 'number' ? a.order : (typeof a.order === 'string' && a.order.trim() ? parseFloat(a.order) : null);
      const orderB = typeof b.order === 'number' ? b.order : (typeof b.order === 'string' && b.order.trim() ? parseFloat(b.order) : null);
      if (orderA !== null && orderB !== null && !Number.isNaN(orderA) && !Number.isNaN(orderB) && orderA !== orderB) {
        return orderA - orderB;
      }
      const phaseNumA = (a.phaseNumber !== undefined && a.phaseNumber !== null && a.phaseNumber !== '') ? a.phaseNumber : (a.name ?? '');
      const phaseNumB = (b.phaseNumber !== undefined && b.phaseNumber !== null && b.phaseNumber !== '') ? b.phaseNumber : (b.name ?? '');
      return comparePhaseNumbers(phaseNumA, phaseNumB);
    });

    let html = '';

    sortedPhases.forEach((ph, pIdx) => {
      const phaseSuites = suites.filter(s => s.phaseId === ph.id);
      let phaseCasesCount = 0;
      phaseSuites.forEach(s => phaseCasesCount += (s.testCases?.length || 0));

      const isFirst = pIdx === 0;
      const isLast = pIdx === sortedPhases.length - 1;

      html += `
        <div class="phase-card" data-phase-id="${escapeHTML(ph.id)}">
          <div class="phase-header">
            <div class="phase-header-left">
              <span class="phase-order-badge" title="Phase sequence">${pIdx + 1}</span>
              <div class="phase-title-group">
                <h4 class="phase-title">${escapeHTML(ph.name)}</h4>
                <span class="phase-desc">${ph.description ? escapeHTML(ph.description) : '<em style="color: var(--text-muted);">No description provided</em>'}</span>
              </div>
            </div>

            <div class="phase-header-right">
              <span class="phase-counter-pill">${phaseSuites.length} suites • ${phaseCasesCount} cases</span>

              <!-- Move Up / Down -->
              <button type="button" class="icon-btn btn-phase-up" data-phase-id="${escapeHTML(ph.id)}" title="Move Phase Up" ${isFirst ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="18 15 12 9 6 15"></polyline>
                </svg>
              </button>
              <button type="button" class="icon-btn btn-phase-down" data-phase-id="${escapeHTML(ph.id)}" title="Move Phase Down" ${isLast ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>

              <!-- Add Suite to this Phase -->
              <button type="button" class="btn btn-secondary btn-xs btn-add-suite-phase" data-phase-id="${escapeHTML(ph.id)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                <span>Add Suite</span>
              </button>

              <!-- Edit Phase -->
              <button type="button" class="icon-btn btn-edit-phase" data-phase-id="${escapeHTML(ph.id)}" title="Edit Phase Details">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>

              <!-- Delete Phase -->
              <button type="button" class="icon-btn btn-delete-phase" data-phase-id="${escapeHTML(ph.id)}" title="Delete Phase">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--color-red);">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>

          <div class="phase-body">
      `;

      if (phaseSuites.length === 0) {
        html += `
          <div class="empty-state" style="padding: 24px 14px;">
            <p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 10px;">No test suites defined in this phase yet.</p>
            <button type="button" class="btn btn-secondary btn-xs btn-add-suite-phase" data-phase-id="${escapeHTML(ph.id)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>Create First Suite in ${escapeHTML(ph.name)}</span>
            </button>
          </div>
        `;
      } else {
        html += '<div class="suites-grid">';
        phaseSuites.forEach(suite => {
          const caseList = suite.testCases || [];
          const tags = Array.isArray(suite.tags) ? suite.tags : [];

          html += `
            <div class="suite-card" data-suite-id="${escapeHTML(suite.id)}">
              <div>
                <div class="suite-card-top">
                  <h5 class="suite-card-title btn-open-suite" data-suite-id="${escapeHTML(suite.id)}" title="Open suite test cases">${escapeHTML(suite.name)}</h5>
                  <span class="project-badge badge-web" style="font-size: 0.68rem;">${escapeHTML(suite.category)}</span>
                </div>
                <p class="suite-card-desc">${suite.description ? escapeHTML(suite.description) : '<em style="color: var(--text-muted);">No description provided</em>'}</p>
                <div class="tags-group" style="margin-top: 8px;">
                  ${tags.map(t => `<span class="tag-pill">#${escapeHTML(t)}</span>`).join('')}
                </div>
              </div>

              <div class="suite-card-meta">
                <span style="font-weight: 700; color: var(--text-primary); font-size: 0.78rem;">${caseList.length} test cases</span>

                <div style="display: flex; align-items: center; gap: 4px;">
                  <button type="button" class="btn btn-secondary btn-xs btn-open-suite" data-suite-id="${escapeHTML(suite.id)}">
                    <span>Manage Cases</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  </button>
                  <button type="button" class="icon-btn btn-edit-suite" data-suite-id="${escapeHTML(suite.id)}" title="Edit Suite Details">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                  </button>
                  <button type="button" class="icon-btn btn-delete-suite" data-suite-id="${escapeHTML(suite.id)}" title="Delete Suite">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--color-red);">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          `;
        });
        html += '</div>';
      }

      html += `
          </div>
        </div>
      `;
    });

    DOM.phasesContainer.innerHTML = html;

    // Attach Event Listeners to Phase controls
    DOM.phasesContainer.querySelectorAll('.btn-phase-up').forEach(btn => {
      btn.addEventListener('click', () => {
        const phId = btn.getAttribute('data-phase-id');
        movePhase(project.id, phId, -1);
      });
    });

    DOM.phasesContainer.querySelectorAll('.btn-phase-down').forEach(btn => {
      btn.addEventListener('click', () => {
        const phId = btn.getAttribute('data-phase-id');
        movePhase(project.id, phId, 1);
      });
    });

    DOM.phasesContainer.querySelectorAll('.btn-edit-phase').forEach(btn => {
      btn.addEventListener('click', () => {
        const phId = btn.getAttribute('data-phase-id');
        openPhaseModal(phId);
      });
    });

    DOM.phasesContainer.querySelectorAll('.btn-delete-phase').forEach(btn => {
      btn.addEventListener('click', () => {
        const phId = btn.getAttribute('data-phase-id');
        requestUniversalDelete('phase', phId, project.id);
      });
    });

    DOM.phasesContainer.querySelectorAll('.btn-add-suite-phase').forEach(btn => {
      btn.addEventListener('click', () => {
        const phId = btn.getAttribute('data-phase-id');
        openSuiteModal(null, phId);
      });
    });

    DOM.phasesContainer.querySelectorAll('.btn-open-suite').forEach(btn => {
      btn.addEventListener('click', () => {
        const sId = btn.getAttribute('data-suite-id');
        openSuiteCasesView(project.id, sId);
      });
    });

    DOM.phasesContainer.querySelectorAll('.btn-edit-suite').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sId = btn.getAttribute('data-suite-id');
        openSuiteModal(sId);
      });
    });

    DOM.phasesContainer.querySelectorAll('.btn-delete-suite').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sId = btn.getAttribute('data-suite-id');
        requestUniversalDelete('suite', sId, project.id);
      });
    });
  }

  // ==========================================================================
  // Prompt 3: Suite Test Cases Explorer Sub-View
  // ==========================================================================
  function openSuiteCasesView(projectId, suiteId) {
    State.activePlanProjectId = projectId;
    State.activeSuiteId = suiteId;
    State.caseSearchQuery = '';
    State.casePriorityFilter = 'ALL';
    State.caseCategoryFilter = 'ALL';
    State.caseSortBy = 'newest';

    switchView('plans');
  }

  function renderSuiteCasesExplorer(project, suite) {
    const phases = project.testPlan?.phases || [];
    const parentPhase = phases.find(ph => ph.id === suite.phaseId);

    // Update Header Breadcrumbs
    if (DOM.casesCrumbPhase) DOM.casesCrumbPhase.textContent = parentPhase ? parentPhase.name : 'Phase';
    if (DOM.casesCrumbSuite) DOM.casesCrumbSuite.textContent = suite.name;

    // Update Suite Header Information
    if (DOM.suiteViewTitle) DOM.suiteViewTitle.textContent = suite.name;
    if (DOM.suiteViewCategory) DOM.suiteViewCategory.textContent = suite.category || 'Functional';
    if (DOM.suiteViewDesc) {
      DOM.suiteViewDesc.textContent = suite.description || 'No description provided for this test suite.';
    }

    if (DOM.suiteViewTags) {
      const tags = Array.isArray(suite.tags) ? suite.tags : [];
      DOM.suiteViewTags.innerHTML = tags.map(t => `<span class="tag-pill">#${escapeHTML(t)}</span>`).join('');
    }

    // Populate Category Filter dropdown with categories present in this suite
    if (DOM.caseFilterCategory) {
      const distinctCats = new Set([suite.category || 'Functional']);
      (suite.testCases || []).forEach(tc => {
        if (tc.category) distinctCats.add(tc.category);
      });

      let catHtml = '<option value="ALL">All Categories</option>';
      distinctCats.forEach(c => {
        const isSel = State.caseCategoryFilter === c ? 'selected' : '';
        catHtml += `<option value="${escapeHTML(c)}" ${isSel}>${escapeHTML(c)}</option>`;
      });
      DOM.caseFilterCategory.innerHTML = catHtml;
    }

    // Sync filter controls with State
    if (DOM.caseSearchInput) DOM.caseSearchInput.value = State.caseSearchQuery;
    if (DOM.caseFilterPriority) DOM.caseFilterPriority.value = State.casePriorityFilter;
    if (DOM.caseFilterCategory) DOM.caseFilterCategory.value = State.caseCategoryFilter;
    if (DOM.caseSortBy) DOM.caseSortBy.value = State.caseSortBy;

    const hasFilters = Boolean(
      (State.caseSearchQuery && State.caseSearchQuery.trim().length > 0) ||
      State.casePriorityFilter !== 'ALL' ||
      State.caseCategoryFilter !== 'ALL' ||
      State.caseSortBy !== 'newest'
    );

    if (DOM.caseClearFiltersBtn) {
      DOM.caseClearFiltersBtn.style.display = hasFilters ? 'inline-flex' : 'none';
    }
    if (DOM.caseSearchClearBtn) {
      DOM.caseSearchClearBtn.style.display = State.caseSearchQuery ? 'inline-flex' : 'none';
    }

    // Filter & Sort Test Cases
    const rawCases = suite.testCases || [];
    let filteredCases = rawCases.filter(tc => {
      if (State.caseSearchQuery && State.caseSearchQuery.trim().length > 0) {
        const q = State.caseSearchQuery.trim().toLowerCase();
        const idMatch = (tc.id || '').toLowerCase().includes(q);
        const titleMatch = (tc.title || '').toLowerCase().includes(q);
        const descMatch = (tc.description || '').toLowerCase().includes(q);
        const expMatch = (tc.expectedResult || '').toLowerCase().includes(q);
        if (!idMatch && !titleMatch && !descMatch && !expMatch) return false;
      }

      if (State.casePriorityFilter !== 'ALL' && tc.priority !== State.casePriorityFilter) {
        return false;
      }

      if (State.caseCategoryFilter !== 'ALL' && tc.category !== State.caseCategoryFilter) {
        return false;
      }

      return true;
    });

    // Sort
    filteredCases.sort((a, b) => {
      switch (State.caseSortBy) {
        case 'oldest':
          return new Date(a.createdAt) - new Date(b.createdAt);
        case 'title-asc':
          return (a.title || '').localeCompare(b.title || '');
        case 'priority-desc': {
          const weights = { Critical: 4, High: 3, Medium: 2, Low: 1 };
          return (weights[b.priority] || 0) - (weights[a.priority] || 0);
        }
        case 'newest':
        default:
          return new Date(b.createdAt) - new Date(a.createdAt);
      }
    });

    // Meta count
    if (DOM.casesMetaCount) {
      if (rawCases.length === 0) {
        DOM.casesMetaCount.textContent = 'No test cases in this suite yet';
      } else if (hasFilters) {
        DOM.casesMetaCount.textContent = `Showing ${filteredCases.length} of ${rawCases.length} test cases (filtered)`;
      } else {
        DOM.casesMetaCount.textContent = `Showing all ${rawCases.length} test cases`;
      }
    }

    // Render Table
    if (!DOM.casesTableContainer) return;

    if (rawCases.length === 0) {
      DOM.casesTableContainer.innerHTML = `
        <div class="empty-state" style="padding: 48px 20px;">
          <div class="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 11 12 14 22 4"></polyline>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
            </svg>
          </div>
          <h4 class="empty-state-title">No test cases in this suite</h4>
          <p class="empty-state-desc">Create your first test case to specify preconditions, verification steps, and expected outcomes.</p>
          <button type="button" class="btn btn-primary btn-sm btn-suite-add-first-case">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>Create First Test Case</span>
          </button>
        </div>
      `;

      const btn = DOM.casesTableContainer.querySelector('.btn-suite-add-first-case');
      if (btn) btn.addEventListener('click', () => openTestCaseModal(null, suite.id));
      return;
    }

    if (filteredCases.length === 0) {
      DOM.casesTableContainer.innerHTML = `
        <div class="empty-state" style="padding: 36px 18px;">
          <div class="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </div>
          <h4 class="empty-state-title">No matching test cases</h4>
          <p class="empty-state-desc">Try clearing your search query or priority filters.</p>
          <button type="button" class="btn btn-secondary btn-sm btn-clear-case-filters">
            <span>Reset Filters</span>
          </button>
        </div>
      `;

      const btn = DOM.casesTableContainer.querySelector('.btn-clear-case-filters');
      if (btn) btn.addEventListener('click', resetCaseFilters);
      return;
    }

    let tableHtml = `
      <table class="cases-table">
        <thead>
          <tr>
            <th style="width: 100px;">Case ID</th>
            <th>Title & Objectives</th>
            <th style="width: 110px;">Priority</th>
            <th style="width: 120px;">Category</th>
            <th style="width: 90px;">Steps</th>
            <th style="width: 120px;">Updated</th>
            <th style="width: 120px; text-align: right;">Actions</th>
          </tr>
        </thead>
        <tbody>
    `;

    filteredCases.forEach(tc => {
      const stepCount = (tc.steps || []).length;
      const priorityClass = getPriorityBadgeClass(tc.priority);
      const tags = Array.isArray(tc.tags) ? tc.tags : [];

      tableHtml += `
        <tr data-case-id="${escapeHTML(tc.id)}">
          <td>
            <span class="case-id-tag">${escapeHTML(tc.id)}</span>
          </td>
          <td>
            <div class="case-title-cell btn-view-case" data-case-id="${escapeHTML(tc.id)}">
              ${escapeHTML(tc.title)}
            </div>
            ${tc.description ? `<div style="font-size: 0.74rem; color: var(--text-muted); margin-top: 2px;">${escapeHTML(tc.description)}</div>` : ''}
            ${tags.length > 0 ? `
              <div class="tags-group" style="margin-top: 4px;">
                ${tags.map(t => `<span class="tag-pill">#${escapeHTML(t)}</span>`).join('')}
              </div>
            ` : ''}
          </td>
          <td>
            <span class="priority-badge ${priorityClass}">${escapeHTML(tc.priority)}</span>
          </td>
          <td>
            <span style="font-size: 0.78rem; color: var(--text-secondary);">${escapeHTML(tc.category || 'Functional')}</span>
          </td>
          <td>
            <span style="font-family: var(--font-mono); font-size: 0.76rem; color: var(--text-secondary);">${stepCount} step${stepCount === 1 ? '' : 's'}</span>
          </td>
          <td>
            <span style="font-size: 0.74rem; color: var(--text-muted);">${formatRelativeTime(tc.updatedAt)}</span>
          </td>
          <td>
            <div class="case-actions-cell" style="justify-content: flex-end;">
              <button type="button" class="icon-btn btn-view-case" data-case-id="${escapeHTML(tc.id)}" title="View Details">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
              <button type="button" class="icon-btn btn-edit-case" data-case-id="${escapeHTML(tc.id)}" title="Edit Case">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
              <button type="button" class="icon-btn btn-duplicate-case" data-case-id="${escapeHTML(tc.id)}" title="Duplicate Case">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
              <button type="button" class="icon-btn btn-delete-case" data-case-id="${escapeHTML(tc.id)}" title="Delete Case">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--color-red);">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    tableHtml += `
        </tbody>
      </table>
    `;

    DOM.casesTableContainer.innerHTML = tableHtml;

    // Attach Event Listeners to Case Action Buttons
    DOM.casesTableContainer.querySelectorAll('.btn-view-case').forEach(btn => {
      btn.addEventListener('click', () => {
        const cId = btn.getAttribute('data-case-id');
        openTestCaseViewModal(project.id, suite.id, cId);
      });
    });

    DOM.casesTableContainer.querySelectorAll('.btn-edit-case').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cId = btn.getAttribute('data-case-id');
        openTestCaseModal(cId, suite.id);
      });
    });

    DOM.casesTableContainer.querySelectorAll('.btn-duplicate-case').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cId = btn.getAttribute('data-case-id');
        duplicateTestCase(project.id, suite.id, cId);
      });
    });

    DOM.casesTableContainer.querySelectorAll('.btn-delete-case').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cId = btn.getAttribute('data-case-id');
        requestUniversalDelete('case', cId, suite.id);
      });
    });
  }

  function resetCaseFilters() {
    State.caseSearchQuery = '';
    State.casePriorityFilter = 'ALL';
    State.caseCategoryFilter = 'ALL';
    State.caseSortBy = 'newest';

    if (DOM.caseSearchInput) DOM.caseSearchInput.value = '';
    if (DOM.caseFilterPriority) DOM.caseFilterPriority.value = 'ALL';
    if (DOM.caseFilterCategory) DOM.caseFilterCategory.value = 'ALL';
    if (DOM.caseSortBy) DOM.caseSortBy.value = 'newest';

    renderTestPlansWorkspace();
  }

  // ==========================================================================
  // Prompt 3: Modals — Test Plan Configuration
  // ==========================================================================
  function openTestPlanModal() {
    const projects = Storage.getProjects();
    const project = projects.find(p => p.id === State.activePlanProjectId);
    if (!project) return;

    const plan = project.testPlan || {};

    if (DOM.planNameInput) DOM.planNameInput.value = plan.name || `${project.name} Test Plan`;
    if (DOM.planObjectiveInput) DOM.planObjectiveInput.value = plan.objective || '';
    if (DOM.planScopeInput) DOM.planScopeInput.value = plan.scope || '';
    if (DOM.planDescInput) DOM.planDescInput.value = plan.description || plan.notes || '';

    if (DOM.testplanModal) {
      DOM.testplanModal.classList.add('open');
      DOM.testplanModal.setAttribute('aria-hidden', 'false');
    }
  }

  function closeTestPlanModal() {
    if (!DOM.testplanModal) return;
    DOM.testplanModal.classList.remove('open');
    DOM.testplanModal.setAttribute('aria-hidden', 'true');
  }

  function handleSaveTestPlanSubmit(e) {
    e.preventDefault();

    const name = DOM.planNameInput ? DOM.planNameInput.value.trim() : '';
    if (!name) {
      showToast('Please provide a Test Plan Name.', 'error');
      return;
    }

    const projects = Storage.getProjects();
    const project = projects.find(p => p.id === State.activePlanProjectId);
    if (!project) return;

    if (!project.testPlan) {
      project.testPlan = { id: 'plan_' + Date.now(), phases: [] };
    }

    project.testPlan.name = name;
    project.testPlan.objective = DOM.planObjectiveInput ? DOM.planObjectiveInput.value.trim() : '';
    project.testPlan.scope = DOM.planScopeInput ? DOM.planScopeInput.value.trim() : '';
    project.testPlan.description = DOM.planDescInput ? DOM.planDescInput.value.trim() : '';
    project.testPlan.notes = project.testPlan.description;
    project.testPlan.updatedAt = new Date().toISOString();
    project.updatedAt = new Date().toISOString();

    const saveRes = Storage.saveProjects(projects);
    if (!saveRes.ok) {
      return;
    }
    Storage.addActivity('Updated test plan', name);

    closeTestPlanModal();
    showToast(`Test Plan "${name}" saved!`, 'success');
    renderTestPlansWorkspace();
    renderDashboard();
    if (State.currentView === 'project-details' && State.currentDetailProjectId === project.id) {
      renderProjectDetailsData(project);
    }
  }

  // ==========================================================================
  // Prompt 3: Modals — Testing Phase (Create / Edit)
  // ==========================================================================
  function openPhaseModal(phaseId = null) {
    const projects = Storage.getProjects();
    const project = projects.find(p => p.id === State.activePlanProjectId);
    if (!project) return;

    if (DOM.phaseForm) DOM.phaseForm.reset();
    hidePhaseError();

    if (phaseId) {
      const phases = project.testPlan?.phases || [];
      const phase = phases.find(ph => ph.id === phaseId);
      if (!phase) return;

      if (DOM.phaseIdInput) DOM.phaseIdInput.value = phase.id;
      if (DOM.phaseNameInput) DOM.phaseNameInput.value = phase.name;
      if (DOM.phaseDescInput) DOM.phaseDescInput.value = phase.description || '';

      if (DOM.phaseModalTitle) DOM.phaseModalTitle.textContent = 'Edit Testing Phase';
      if (DOM.phaseModalSubtitle) DOM.phaseModalSubtitle.textContent = 'Update phase title and scope description';
      if (DOM.phaseModalSubmitText) DOM.phaseModalSubmitText.textContent = 'Save Changes';
    } else {
      if (DOM.phaseIdInput) DOM.phaseIdInput.value = '';
      if (DOM.phaseModalTitle) DOM.phaseModalTitle.textContent = 'Add Testing Phase';
      if (DOM.phaseModalSubtitle) DOM.phaseModalSubtitle.textContent = 'Organize testing activities into custom phases';
      if (DOM.phaseModalSubmitText) DOM.phaseModalSubmitText.textContent = 'Add Phase';
    }

    if (DOM.phaseModal) {
      DOM.phaseModal.classList.add('open');
      DOM.phaseModal.setAttribute('aria-hidden', 'false');
    }

    setTimeout(() => {
      if (DOM.phaseNameInput) DOM.phaseNameInput.focus();
    }, 100);
  }

  function closePhaseModal() {
    if (!DOM.phaseModal) return;
    DOM.phaseModal.classList.remove('open');
    DOM.phaseModal.setAttribute('aria-hidden', 'true');
    hidePhaseError();
  }

  function showPhaseError(msg) {
    if (!DOM.phaseErrorAlert || !DOM.phaseErrorText) return;
    DOM.phaseErrorText.textContent = msg;
    DOM.phaseErrorAlert.style.display = 'flex';
  }

  function hidePhaseError() {
    if (DOM.phaseErrorAlert) DOM.phaseErrorAlert.style.display = 'none';
  }

  function handleSavePhaseSubmit(e) {
    e.preventDefault();

    const phaseId = DOM.phaseIdInput ? DOM.phaseIdInput.value.trim() : '';
    const name = DOM.phaseNameInput ? DOM.phaseNameInput.value.trim() : '';
    const description = DOM.phaseDescInput ? DOM.phaseDescInput.value.trim() : '';

    if (!name) {
      showPhaseError('Phase Name is required.');
      if (DOM.phaseNameInput) DOM.phaseNameInput.focus();
      return;
    }

    const projects = Storage.getProjects();
    const project = projects.find(p => p.id === State.activePlanProjectId);
    if (!project) return;

    if (!project.testPlan) {
      project.testPlan = { id: 'plan_' + Date.now(), phases: [] };
    }
    if (!Array.isArray(project.testPlan.phases)) {
      project.testPlan.phases = [];
    }

    if (phaseId) {
      // Edit Phase
      const phase = project.testPlan.phases.find(ph => ph.id === phaseId);
      if (!phase) {
        showPhaseError('Phase not found.');
        return;
      }
      const prevName = phase.name;
      const prevDesc = phase.description;
      phase.name = name;
      phase.description = description;

      project.testPlan.updatedAt = new Date().toISOString();
      project.updatedAt = new Date().toISOString();

      const saveRes = Storage.saveProjects(projects);
      if (!saveRes.ok) {
        phase.name = prevName;
        phase.description = prevDesc;
        showPhaseError(saveRes.error || 'Failed to save phase to storage.');
        return;
      }

      Storage.addActivity('Updated testing phase', name);
      showToast(`Phase "${name}" updated.`, 'success');
      closePhaseModal();
    } else {
      // Create Phase
      const newPhase = {
        id: 'phase_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        name: name,
        description: description,
        order: project.testPlan.phases.length
      };
      project.testPlan.phases.push(newPhase);

      project.testPlan.updatedAt = new Date().toISOString();
      project.updatedAt = new Date().toISOString();

      const saveRes = Storage.saveProjects(projects);
      if (!saveRes.ok) {
        project.testPlan.phases.pop();
        showPhaseError(saveRes.error || 'Failed to save phase to storage.');
        return;
      }

      Storage.addActivity('Created testing phase', name);
      showToast(`Testing phase "${name}" created!`, 'success');
      closePhaseModal();
    }

    renderTestPlansWorkspace();
    renderDashboard();
    renderMyProjects();
    renderTestExecutionWorkspace();
    renderReportsWorkspace();
    if (State.currentView === 'project-details' && State.currentDetailProjectId === project.id) {
      renderProjectDetailsData(project);
    }
  }

  function movePhase(projectId, phaseId, direction) {
    const projects = Storage.getProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project || !project.testPlan?.phases) return;

    const phases = project.testPlan.phases;
    phases.sort((a, b) => a.order - b.order);

    const idx = phases.findIndex(ph => ph.id === phaseId);
    if (idx === -1) return;

    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= phases.length) return;

    // Swap orders
    const prevIdxOrder = phases[idx].order;
    const prevTargetOrder = phases[targetIdx].order;
    phases[idx].order = prevTargetOrder;
    phases[targetIdx].order = prevIdxOrder;

    project.testPlan.updatedAt = new Date().toISOString();
    const saveRes = Storage.saveProjects(projects);
    if (!saveRes.ok) {
      phases[idx].order = prevIdxOrder;
      phases[targetIdx].order = prevTargetOrder;
      return;
    }

    renderTestPlansWorkspace();
    renderTestExecutionWorkspace();
    if (State.currentView === 'project-details' && State.currentDetailProjectId === project.id) {
      renderProjectDetailsData(project);
    }
  }

  // ==========================================================================
  // Prompt 3: Modals — Test Suite (Create / Edit)
  // ==========================================================================
  function openSuiteModal(suiteId = null, targetPhaseId = null) {
    const projects = Storage.getProjects();
    const project = projects.find(p => p.id === State.activePlanProjectId);
    if (!project) return;

    if (DOM.suiteForm) DOM.suiteForm.reset();
    hideSuiteError();

    const phases = project.testPlan?.phases || [];
    if (phases.length === 0) {
      showToast('Please create a testing phase first before adding test suites.', 'error');
      openPhaseModal(null);
      return;
    }

    // Populate Phase Selector Dropdown
    if (DOM.suitePhaseSelect) {
      let optionsHtml = '';
      phases.forEach(ph => {
        optionsHtml += `<option value="${escapeHTML(ph.id)}">${escapeHTML(ph.name)}</option>`;
      });
      DOM.suitePhaseSelect.innerHTML = optionsHtml;
    }

    if (suiteId) {
      const suite = (project.testSuites || []).find(s => s.id === suiteId);
      if (!suite) return;

      if (DOM.suiteIdInput) DOM.suiteIdInput.value = suite.id;
      if (DOM.suitePhaseSelect) DOM.suitePhaseSelect.value = suite.phaseId;
      if (DOM.suiteNameInput) DOM.suiteNameInput.value = suite.name;

      // Handle category selection vs custom
      if (DEFAULT_SUITE_CATEGORIES.includes(suite.category)) {
        if (DOM.suiteCategorySelect) DOM.suiteCategorySelect.value = suite.category;
        if (DOM.suiteCustomCatGroup) DOM.suiteCustomCatGroup.style.display = 'none';
      } else {
        if (DOM.suiteCategorySelect) DOM.suiteCategorySelect.value = 'CUSTOM';
        if (DOM.suiteCustomCatGroup) {
          DOM.suiteCustomCatGroup.style.display = 'flex';
          if (DOM.suiteCustomCatInput) DOM.suiteCustomCatInput.value = suite.category || '';
        }
      }

      if (DOM.suiteTagsInput) DOM.suiteTagsInput.value = (suite.tags || []).join(', ');
      if (DOM.suiteDescInput) DOM.suiteDescInput.value = suite.description || '';

      if (DOM.suiteModalTitle) DOM.suiteModalTitle.textContent = 'Edit Test Suite';
      if (DOM.suiteModalSubtitle) DOM.suiteModalSubtitle.textContent = 'Update suite name, category, and tags';
      if (DOM.suiteModalSubmitText) DOM.suiteModalSubmitText.textContent = 'Save Changes';
    } else {
      if (DOM.suiteIdInput) DOM.suiteIdInput.value = '';
      if (DOM.suitePhaseSelect) {
        DOM.suitePhaseSelect.value = targetPhaseId || phases[0].id;
      }
      if (DOM.suiteCategorySelect) DOM.suiteCategorySelect.value = 'Functional';
      if (DOM.suiteCustomCatGroup) DOM.suiteCustomCatGroup.style.display = 'none';
      if (DOM.suiteModalTitle) DOM.suiteModalTitle.textContent = 'Add Test Suite';
      if (DOM.suiteModalSubtitle) DOM.suiteModalSubtitle.textContent = 'Group related test cases under a focused test suite';
      if (DOM.suiteModalSubmitText) DOM.suiteModalSubmitText.textContent = 'Add Test Suite';
    }

    if (DOM.suiteModal) {
      DOM.suiteModal.classList.add('open');
      DOM.suiteModal.setAttribute('aria-hidden', 'false');
    }

    setTimeout(() => {
      if (DOM.suiteNameInput) DOM.suiteNameInput.focus();
    }, 100);
  }

  function closeSuiteModal() {
    if (!DOM.suiteModal) return;
    DOM.suiteModal.classList.remove('open');
    DOM.suiteModal.setAttribute('aria-hidden', 'true');
    hideSuiteError();
  }

  function showSuiteError(msg) {
    if (!DOM.suiteErrorAlert || !DOM.suiteErrorText) return;
    DOM.suiteErrorText.textContent = msg;
    DOM.suiteErrorAlert.style.display = 'flex';
  }

  function hideSuiteError() {
    if (DOM.suiteErrorAlert) DOM.suiteErrorAlert.style.display = 'none';
  }

  function handleSaveSuiteSubmit(e) {
    e.preventDefault();

    const suiteId = DOM.suiteIdInput ? DOM.suiteIdInput.value.trim() : '';
    const phaseId = DOM.suitePhaseSelect ? DOM.suitePhaseSelect.value : '';
    const name = DOM.suiteNameInput ? DOM.suiteNameInput.value.trim() : '';
    let category = DOM.suiteCategorySelect ? DOM.suiteCategorySelect.value : 'Functional';

    if (category === 'CUSTOM') {
      const customVal = DOM.suiteCustomCatInput ? DOM.suiteCustomCatInput.value.trim() : '';
      category = customVal || 'Other';
    }

    const rawTags = DOM.suiteTagsInput ? DOM.suiteTagsInput.value : '';
    const tags = rawTags.split(',').map(t => t.trim().replace(/^#/, '')).filter(t => t.length > 0);
    const description = DOM.suiteDescInput ? DOM.suiteDescInput.value.trim() : '';

    if (!name) {
      showSuiteError('Suite Name is required.');
      if (DOM.suiteNameInput) DOM.suiteNameInput.focus();
      return;
    }

    if (!phaseId) {
      showSuiteError('Please select a valid testing phase.');
      return;
    }

    const projects = Storage.getProjects();
    const project = projects.find(p => p.id === State.activePlanProjectId);
    if (!project) return;

    if (!Array.isArray(project.testSuites)) {
      project.testSuites = [];
    }

    if (suiteId) {
      // Edit Suite (Preserve existing testCases array!)
      const suite = project.testSuites.find(s => s.id === suiteId);
      if (!suite) {
        showSuiteError('Test suite could not be found.');
        return;
      }
      const prevSuiteState = {
        phaseId: suite.phaseId,
        name: suite.name,
        category: suite.category,
        tags: [...(suite.tags || [])],
        description: suite.description,
        updatedAt: suite.updatedAt
      };

      suite.phaseId = phaseId;
      suite.name = name;
      suite.category = category;
      suite.tags = tags;
      suite.description = description;
      suite.updatedAt = new Date().toISOString();
      project.updatedAt = new Date().toISOString();

      const saveRes = Storage.saveProjects(projects);
      if (!saveRes.ok) {
        Object.assign(suite, prevSuiteState);
        showSuiteError(saveRes.error || 'Failed to save suite to storage.');
        return;
      }

      Storage.addActivity('Updated test suite', name);
      showToast(`Suite "${name}" updated.`, 'success');
      closeSuiteModal();
    } else {
      // Create Suite
      const newSuite = {
        id: 'suite_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        phaseId: phaseId,
        name: name,
        category: category,
        tags: tags,
        description: description,
        order: project.testSuites.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        testCases: []
      };
      project.testSuites.push(newSuite);
      project.updatedAt = new Date().toISOString();

      const saveRes = Storage.saveProjects(projects);
      if (!saveRes.ok) {
        project.testSuites.pop();
        showSuiteError(saveRes.error || 'Failed to save suite to storage.');
        return;
      }

      Storage.addActivity('Created test suite', name);
      showToast(`Test suite "${name}" created!`, 'success');
      closeSuiteModal();
    }

    renderTestPlansWorkspace();
    renderDashboard();
    renderMyProjects();
    renderTestExecutionWorkspace();
    renderReportsWorkspace();

    if (State.currentView === 'project-details' && State.currentDetailProjectId === project.id) {
      renderProjectDetailsData(project);
    }
  }

  // ==========================================================================
  // Prompt 3: Modals — Test Case (Create / Edit with Dynamic Step Builder)
  // ==========================================================================
  function openTestCaseModal(caseId = null, suiteId = null) {
    const projects = Storage.getProjects();
    const project = projects.find(p => p.id === State.activePlanProjectId);
    if (!project) return;

    const resolvedSuiteId = suiteId || State.activeSuiteId;
    const suite = (project.testSuites || []).find(s => s.id === resolvedSuiteId);
    if (!suite) {
      showToast('Target test suite not found.', 'error');
      return;
    }

    if (DOM.caseForm) DOM.caseForm.reset();
    hideCaseError();

    if (DOM.caseSuiteIdInput) DOM.caseSuiteIdInput.value = suite.id;

    if (caseId) {
      const tc = (suite.testCases || []).find(c => c.id === caseId);
      if (!tc) return;

      if (DOM.caseIdInput) DOM.caseIdInput.value = tc.id;
      if (DOM.caseTitleInput) DOM.caseTitleInput.value = tc.title;
      if (DOM.casePrioritySelect) DOM.casePrioritySelect.value = classifyPriority(tc.priority) || (tc.priority !== undefined && tc.priority !== null ? String(tc.priority) : 'High');
      if (DOM.caseCategoryInput) DOM.caseCategoryInput.value = tc.category || suite.category || 'Functional';
      if (DOM.caseTagsInput) DOM.caseTagsInput.value = (tc.tags || []).join(', ');
      if (DOM.caseDescInput) DOM.caseDescInput.value = tc.description || '';
      if (DOM.casePreconditionsInput) DOM.casePreconditionsInput.value = tc.preconditions || '';
      if (DOM.caseExpectedInput) DOM.caseExpectedInput.value = tc.expectedResult || '';

      // Initialize Dynamic Steps
      State.modalSteps = Array.isArray(tc.steps) && tc.steps.length > 0
        ? tc.steps.map(st => ({
            id: st.id,
            action: st.action,
            testData: (st.testData !== undefined && st.testData !== null) ? String(st.testData) : ''
          }))
        : [{ id: 'step_init_1', action: '', testData: '' }];

      if (DOM.caseModalTitle) DOM.caseModalTitle.textContent = `Edit Test Case (${tc.id})`;
      if (DOM.caseModalSubtitle) DOM.caseModalSubtitle.textContent = 'Update steps, preconditions, priority, or expected results';
      if (DOM.caseModalSubmitText) DOM.caseModalSubmitText.textContent = 'Save Changes';
    } else {
      if (DOM.caseIdInput) DOM.caseIdInput.value = '';
      if (DOM.casePrioritySelect) DOM.casePrioritySelect.value = State.preferences?.defaultCasePriority || 'Medium';
      if (DOM.caseCategoryInput) DOM.caseCategoryInput.value = suite.category || 'Functional';

      // Default to one empty step
      State.modalSteps = [
        { id: 'step_init_1', action: '', testData: '' }
      ];

      if (DOM.caseModalTitle) DOM.caseModalTitle.textContent = 'Create Test Case';
      if (DOM.caseModalSubtitle) DOM.caseModalSubtitle.textContent = 'Specify step-by-step verification instructions and expected outcome';
      if (DOM.caseModalSubmitText) DOM.caseModalSubmitText.textContent = 'Create Test Case';
    }

    renderModalStepsBuilder();

    if (DOM.testcaseModal) {
      DOM.testcaseModal.classList.add('open');
      DOM.testcaseModal.setAttribute('aria-hidden', 'false');
    }

    setTimeout(() => {
      if (DOM.caseTitleInput) DOM.caseTitleInput.focus();
    }, 100);
  }

  function closeTestCaseModal() {
    if (!DOM.testcaseModal) return;
    DOM.testcaseModal.classList.remove('open');
    DOM.testcaseModal.setAttribute('aria-hidden', 'true');
    hideCaseError();
  }

  function showCaseError(msg) {
    if (!DOM.caseErrorAlert || !DOM.caseErrorText) return;
    DOM.caseErrorText.textContent = msg;
    DOM.caseErrorAlert.style.display = 'flex';
  }

  function hideCaseError() {
    if (DOM.caseErrorAlert) DOM.caseErrorAlert.style.display = 'none';
  }

  function renderModalStepsBuilder() {
    if (!DOM.tcStepsList) return;

    if (State.modalSteps.length === 0) {
      State.modalSteps.push({ id: 'step_' + Date.now(), action: '', testData: '' });
    }

    let html = '';

    State.modalSteps.forEach((st, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === State.modalSteps.length - 1;

      html += `
        <div class="step-row" data-step-index="${idx}">
          <div class="step-num-bubble">${idx + 1}</div>
          <div class="step-inputs-group">
            <input
              type="text"
              class="form-control step-action-input"
              data-step-index="${idx}"
              placeholder="Step ${idx + 1} Action: e.g. Open login page and submit credentials..."
              value="${escapeHTML(st.action)}"
              required
            />
            <input
              type="text"
              class="form-control step-data-input"
              data-step-index="${idx}"
              placeholder="Test Data (Optional): e.g. Email: user@example.com / Pass: secret123"
              value="${escapeHTML(st.testData)}"
            />
          </div>
          <div class="step-actions-group">
            <button type="button" class="step-tool-btn btn-step-up" data-step-index="${idx}" title="Move Step Up" ${isFirst ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="18 15 12 9 6 15"></polyline>
              </svg>
            </button>
            <button type="button" class="step-tool-btn btn-step-down" data-step-index="${idx}" title="Move Step Down" ${isLast ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            <button type="button" class="step-tool-btn danger-btn btn-step-delete" data-step-index="${idx}" title="Remove Step">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
      `;
    });

    DOM.tcStepsList.innerHTML = html;

    // Synchronize inputs on change
    DOM.tcStepsList.querySelectorAll('.step-action-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const i = parseInt(e.target.getAttribute('data-step-index'), 10);
        if (State.modalSteps[i]) State.modalSteps[i].action = e.target.value;
      });
    });

    DOM.tcStepsList.querySelectorAll('.step-data-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const i = parseInt(e.target.getAttribute('data-step-index'), 10);
        if (State.modalSteps[i]) State.modalSteps[i].testData = e.target.value;
      });
    });

    DOM.tcStepsList.querySelectorAll('.btn-step-up').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const i = parseInt(btn.getAttribute('data-step-index'), 10);
        if (i > 0) {
          const temp = State.modalSteps[i];
          State.modalSteps[i] = State.modalSteps[i - 1];
          State.modalSteps[i - 1] = temp;
          renderModalStepsBuilder();
        }
      });
    });

    DOM.tcStepsList.querySelectorAll('.btn-step-down').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const i = parseInt(btn.getAttribute('data-step-index'), 10);
        if (i < State.modalSteps.length - 1) {
          const temp = State.modalSteps[i];
          State.modalSteps[i] = State.modalSteps[i + 1];
          State.modalSteps[i + 1] = temp;
          renderModalStepsBuilder();
        }
      });
    });

    DOM.tcStepsList.querySelectorAll('.btn-step-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const i = parseInt(btn.getAttribute('data-step-index'), 10);
        if (State.modalSteps.length > 1) {
          State.modalSteps.splice(i, 1);
        } else {
          State.modalSteps[0] = { id: 'step_' + Date.now(), action: '', testData: '' };
        }
        renderModalStepsBuilder();
      });
    });
  }

  function handleSaveTestCaseSubmit(e) {
    e.preventDefault();

    const caseId = DOM.caseIdInput ? DOM.caseIdInput.value.trim() : '';
    const suiteId = DOM.caseSuiteIdInput ? DOM.caseSuiteIdInput.value.trim() : '';
    const title = DOM.caseTitleInput ? DOM.caseTitleInput.value.trim() : '';
    const priority = DOM.casePrioritySelect ? DOM.casePrioritySelect.value : 'High';
    const category = DOM.caseCategoryInput ? DOM.caseCategoryInput.value.trim() : 'Functional';
    const rawTags = DOM.caseTagsInput ? DOM.caseTagsInput.value : '';
    const tags = rawTags.split(',').map(t => t.trim().replace(/^#/, '')).filter(t => t.length > 0);
    const description = DOM.caseDescInput ? DOM.caseDescInput.value.trim() : '';
    const preconditions = DOM.casePreconditionsInput ? DOM.casePreconditionsInput.value.trim() : '';
    const expectedResult = DOM.caseExpectedInput ? DOM.caseExpectedInput.value.trim() : '';

    if (!title) {
      showCaseError('Test Case Title is required.');
      if (DOM.caseTitleInput) DOM.caseTitleInput.focus();
      return;
    }

    if (!expectedResult) {
      showCaseError('Expected Result is required.');
      if (DOM.caseExpectedInput) DOM.caseExpectedInput.focus();
      return;
    }

    // Validate that at least one step has an action
    const cleanedSteps = State.modalSteps
      .map((st, idx) => ({
        id: st.id || ('step_' + Date.now() + '_' + idx),
        action: (st.action || '').trim(),
        testData: (st.testData !== undefined && st.testData !== null ? String(st.testData) : '').trim(),
        order: idx
      }))
      .filter(st => st.action.length > 0);

    if (cleanedSteps.length === 0) {
      showCaseError('Please define at least one testing step action.');
      return;
    }

    const projects = Storage.getProjects();
    const project = projects.find(p => p.id === State.activePlanProjectId);
    if (!project) return;

    const suite = (project.testSuites || []).find(s => s.id === suiteId);
    if (!suite) {
      showCaseError('Test suite not found.');
      return;
    }

    if (!Array.isArray(suite.testCases)) {
      suite.testCases = [];
    }

    if (caseId) {
      // Edit Case
      const tc = suite.testCases.find(c => c.id === caseId);
      if (!tc) {
        showCaseError('Test case not found.');
        return;
      }

      const prevCaseState = {
        title: tc.title,
        priority: tc.priority,
        category: tc.category,
        tags: [...(tc.tags || [])],
        description: tc.description,
        preconditions: tc.preconditions,
        steps: [...(tc.steps || [])],
        expectedResult: tc.expectedResult,
        updatedAt: tc.updatedAt
      };

      tc.title = title;
      tc.priority = priority;
      tc.category = category;
      tc.tags = tags;
      tc.description = description;
      tc.preconditions = preconditions;
      tc.steps = cleanedSteps;
      tc.expectedResult = expectedResult;
      tc.updatedAt = new Date().toISOString();
      suite.updatedAt = new Date().toISOString();
      project.updatedAt = new Date().toISOString();

      const saveRes = Storage.saveProjects(projects);
      if (!saveRes.ok) {
        Object.assign(tc, prevCaseState);
        showCaseError(saveRes.error || 'Failed to save test case to storage.');
        return;
      }

      Storage.addActivity('Updated test case', `${tc.id}: ${title}`);
      showToast(`Test Case ${tc.id} updated!`, 'success');
      closeTestCaseModal();
    } else {
      // Create Case with unique ID
      const newId = generateUniqueCaseId(projects);

      const newCase = {
        id: newId,
        title: title,
        priority: priority,
        category: category,
        tags: tags,
        description: description,
        preconditions: preconditions,
        steps: cleanedSteps,
        expectedResult: expectedResult,
        status: 'Not Run',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      suite.testCases.push(newCase);
      suite.updatedAt = new Date().toISOString();
      project.updatedAt = new Date().toISOString();

      const saveRes = Storage.saveProjects(projects);
      if (!saveRes.ok) {
        suite.testCases.pop();
        showCaseError(saveRes.error || 'Failed to save test case to storage.');
        return;
      }

      Storage.addActivity('Created test case', `${newId}: ${title}`);
      showToast(`Test Case ${newId} created!`, 'success');
      closeTestCaseModal();
    }

    renderTestPlansWorkspace();
    renderDashboard();
    renderMyProjects();
    renderTestExecutionWorkspace();
    renderReportsWorkspace();

    if (State.currentView === 'project-details' && State.currentDetailProjectId === project.id) {
      renderProjectDetailsData(project);
    }
  }

  function generateUniqueCaseId(projects) {
    let maxNum = 0;
    projects.forEach(p => {
      (p.testSuites || []).forEach(s => {
        (s.testCases || []).forEach(tc => {
          const match = (tc.id || '').match(/TC-(\d+)/i);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
          }
        });
      });
    });

    const nextNum = maxNum + 1;
    return `TC-${String(nextNum).padStart(3, '0')}`;
  }

  function duplicateTestCase(projectId, suiteId, caseId) {
    const projects = Storage.getProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const suite = (project.testSuites || []).find(s => s.id === suiteId);
    if (!suite) return;

    const original = (suite.testCases || []).find(c => c.id === caseId);
    if (!original) return;

    const newId = generateUniqueCaseId(projects);
    const cloned = {
      ...original,
      id: newId,
      title: `${original.title} (Copy)`,
      steps: original.steps.map((st, idx) => ({ ...st, id: 'step_' + Date.now() + '_' + idx })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const origIdx = suite.testCases.findIndex(c => c.id === caseId);
    if (origIdx !== -1) {
      suite.testCases.splice(origIdx + 1, 0, cloned);
    } else {
      suite.testCases.push(cloned);
    }

    suite.updatedAt = new Date().toISOString();
    project.updatedAt = new Date().toISOString();

    const saveRes = Storage.saveProjects(projects);
    if (!saveRes.ok) {
      const idxToRemove = suite.testCases.findIndex(c => c.id === newId);
      if (idxToRemove !== -1) {
        suite.testCases.splice(idxToRemove, 1);
      }
      return;
    }

    Storage.addActivity('Duplicated test case', `${newId}: ${cloned.title}`);
    showToast(`Test case duplicated as ${newId}`, 'success');

    renderTestPlansWorkspace();
    renderDashboard();
  }

  // ==========================================================================
  // Prompt 3: Modals — Test Case Inspection View
  // ==========================================================================
  function resolveProjectCaseContext(projectId, caseId, optProjects = null) {
    if (!projectId || projectId === 'ALL' || caseId === undefined || caseId === null) {
      return null;
    }
    const normalizedCaseId = String(caseId).trim();
    if (!normalizedCaseId) return null;

    const projects = Array.isArray(optProjects) ? optProjects : Storage.getProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) return null;

    for (const suite of (project.testSuites || [])) {
      const tc = (suite.testCases || []).find(c => c.id === normalizedCaseId);
      if (tc) {
        return { project, suite, testCase: tc };
      }
    }
    return null;
  }

  function openTestCaseViewModal(projectId, suiteId, caseId) {
    if (!projectId || projectId === 'ALL') {
      showToast('Linked test case could not be opened: invalid project reference.', 'warning');
      return false;
    }

    const projects = Storage.getProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) {
      showToast('Project for linked test case could not be found.', 'warning');
      return false;
    }

    let suite = null;
    let tc = null;

    if (caseId !== undefined && caseId !== null && String(caseId).trim() !== '') {
      const targetCaseId = String(caseId).trim();
      if (suiteId) {
        suite = (project.testSuites || []).find(s => s.id === suiteId) || null;
        if (suite) {
          tc = (suite.testCases || []).find(c => c.id === targetCaseId) || null;
        }
      }
      if (!tc) {
        const resolved = resolveProjectCaseContext(project.id, targetCaseId, projects);
        if (resolved) {
          suite = resolved.suite;
          tc = resolved.testCase;
        }
      }
    } else if (suiteId !== undefined && suiteId !== null && String(suiteId).trim() !== '') {
      // Backward-compatible 2-argument call: openTestCaseViewModal(projectId, caseId)
      const resolved = resolveProjectCaseContext(project.id, suiteId, projects);
      if (resolved) {
        suite = resolved.suite;
        tc = resolved.testCase;
      }
    }

    if (!suite || !tc) {
      showToast('Linked test case could not be found or has been deleted.', 'warning');
      return false;
    }

    if (DOM.viewCaseId) DOM.viewCaseId.textContent = tc.id;
    if (DOM.viewCaseTitle) DOM.viewCaseTitle.textContent = tc.title;

    if (DOM.viewCasePriority) {
      DOM.viewCasePriority.className = `priority-badge ${getPriorityBadgeClass(tc.priority)}`;
      DOM.viewCasePriority.textContent = tc.priority;
    }

    if (DOM.viewCaseCategory) DOM.viewCaseCategory.textContent = tc.category || 'Functional';

    if (DOM.viewCaseTags) {
      const tags = Array.isArray(tc.tags) ? tc.tags : [];
      DOM.viewCaseTags.innerHTML = tags.map(t => `<span class="tag-pill">#${escapeHTML(t)}</span>`).join('');
    }

    if (DOM.viewCaseDesc) {
      if (tc.description) {
        DOM.viewCaseDesc.textContent = tc.description;
        if (DOM.viewCaseDescBox) DOM.viewCaseDescBox.style.display = 'flex';
      } else {
        if (DOM.viewCaseDescBox) DOM.viewCaseDescBox.style.display = 'none';
      }
    }

    if (DOM.viewCasePreconditions) {
      if (tc.preconditions) {
        DOM.viewCasePreconditions.textContent = tc.preconditions;
        if (DOM.viewCasePreconditionsBox) DOM.viewCasePreconditionsBox.style.display = 'flex';
      } else {
        if (DOM.viewCasePreconditionsBox) DOM.viewCasePreconditionsBox.style.display = 'none';
      }
    }

    if (DOM.viewCaseExpected) DOM.viewCaseExpected.textContent = tc.expectedResult;

    if (DOM.viewCaseCreated) DOM.viewCaseCreated.textContent = `Created ${formatDisplayDateTime(tc.createdAt)}`;
    if (DOM.viewCaseUpdated) DOM.viewCaseUpdated.textContent = `Updated ${formatRelativeTime(tc.updatedAt)}`;

    // Render Steps Table
    if (DOM.viewCaseStepsContainer) {
      const steps = tc.steps || [];
      if (steps.length === 0) {
        DOM.viewCaseStepsContainer.innerHTML = '<p style="font-size: 0.8rem; color: var(--text-muted);">No steps documented.</p>';
      } else {
        let stHtml = `
          <table class="view-steps-table">
            <thead>
              <tr>
                <th style="width: 50px;">#</th>
                <th>Action / Verification Step</th>
                <th style="width: 220px;">Test Data</th>
              </tr>
            </thead>
            <tbody>
        `;

        steps.forEach((st, idx) => {
          stHtml += `
            <tr>
              <td style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-primary);">${idx + 1}</td>
              <td style="color: var(--text-primary); line-height: 1.45;">${escapeHTML(st.action)}</td>
              <td style="font-family: var(--font-mono); color: var(--text-secondary); font-size: 0.78rem;">${(st.testData !== undefined && st.testData !== null && String(st.testData).trim() !== '') ? escapeHTML(String(st.testData)) : '<em style="color: var(--text-muted); font-family: var(--font-sans);">None</em>'}</td>
            </tr>
          `;
        });

        stHtml += '</tbody></table>';
        DOM.viewCaseStepsContainer.innerHTML = stHtml;
      }
    }

    // Modal Actions Bindings
    if (DOM.viewCaseEditBtn) {
      DOM.viewCaseEditBtn.onclick = () => {
        closeTestCaseViewModal();
        State.activePlanProjectId = project.id;
        openTestCaseModal(tc.id, suite.id);
      };
    }

    if (DOM.viewCaseDuplicateBtn) {
      DOM.viewCaseDuplicateBtn.onclick = () => {
        closeTestCaseViewModal();
        duplicateTestCase(project.id, suite.id, tc.id);
      };
    }

    if (DOM.testcaseViewModal) {
      DOM.testcaseViewModal.setAttribute('data-project-id', project.id);
      DOM.testcaseViewModal.setAttribute('data-suite-id', suite.id);
      DOM.testcaseViewModal.setAttribute('data-case-id', tc.id);
      DOM.testcaseViewModal.classList.add('open');
      DOM.testcaseViewModal.setAttribute('aria-hidden', 'false');
    }
    return true;
  }

  function closeTestCaseViewModal() {
    if (!DOM.testcaseViewModal) return;
    DOM.testcaseViewModal.classList.remove('open');
    DOM.testcaseViewModal.setAttribute('aria-hidden', 'true');
  }

  // ==========================================================================
  // Prompt 4: Defect ID Generator & Helper
  // ==========================================================================
  function generateUniqueDefectId(projects) {
    let maxNum = 0;
    projects.forEach(p => {
      (p.defects || []).forEach(df => {
        const match = (df.id || '').match(/DEF-(\d+)/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNum) maxNum = num;
        }
      });
    });
    return `DEF-${String(maxNum + 1).padStart(3, '0')}`;
  }

  // ==========================================================================
  // Prompt 4: Test Execution Workspace Controller
  // ==========================================================================
  function renderTestExecutionWorkspace() {
    const projects = Storage.getProjects();

    if (projects.length === 0) {
      if (DOM.execNoProjectsView) DOM.execNoProjectsView.style.display = 'flex';
      if (DOM.execMainContent) DOM.execMainContent.style.display = 'none';
      if (DOM.execProjectSelect) {
        DOM.execProjectSelect.innerHTML = '<option value="" disabled selected>No projects available</option>';
      }
      return;
    }

    if (DOM.execNoProjectsView) DOM.execNoProjectsView.style.display = 'none';
    if (DOM.execMainContent) DOM.execMainContent.style.display = 'block';

    // Ensure active project ID is valid
    if (!State.activeExecProjectId || !projects.some(p => p.id === State.activeExecProjectId)) {
      State.activeExecProjectId = projects[0].id;
    }

    // Populate Project Select Dropdown
    if (DOM.execProjectSelect) {
      DOM.execProjectSelect.innerHTML = projects.map(p =>
        `<option value="${escapeHTML(p.id)}" ${p.id === State.activeExecProjectId ? 'selected' : ''}>${escapeHTML(p.name)} (${p.testCaseCount ?? 0} cases)</option>`
      ).join('');
    }

    const project = projects.find(p => p.id === State.activeExecProjectId);
    if (!project) return;

    const phases = project.testPlan?.phases || [];
    const suites = project.testSuites || [];

    // Populate Phase Filter Dropdown
    if (DOM.execFilterPhase) {
      let phaseHtml = '<option value="ALL">All Phases</option>';
      phases.forEach((ph, idx) => {
        const phDisplayName = ph.name
          ? (ph.name.toLowerCase().startsWith('phase') ? escapeHTML(ph.name) : `Phase ${idx + 1}: ${escapeHTML(ph.name)}`)
          : `Phase ${idx + 1}`;
        phaseHtml += `<option value="${escapeHTML(ph.id)}" ${State.execPhaseFilter === ph.id ? 'selected' : ''}>${phDisplayName}</option>`;
      });
      DOM.execFilterPhase.innerHTML = phaseHtml;
      if (State.execPhaseFilter !== 'ALL' && !phases.some(ph => ph.id === State.execPhaseFilter)) {
        State.execPhaseFilter = 'ALL';
      }
      DOM.execFilterPhase.value = State.execPhaseFilter;
    }

    // Populate Suite Filter Dropdown (scoped by selected phase if any)
    const relevantSuites = State.execPhaseFilter === 'ALL'
      ? suites
      : suites.filter(s => s.phaseId === State.execPhaseFilter);
    if (State.execSuiteFilter !== 'ALL' && !relevantSuites.some(s => s.id === State.execSuiteFilter)) {
      State.execSuiteFilter = 'ALL';
    }
    if (DOM.execFilterSuite) {
      let suiteHtml = '<option value="ALL">All Suites</option>';
      relevantSuites.forEach(s => {
        suiteHtml += `<option value="${escapeHTML(s.id)}" ${State.execSuiteFilter === s.id ? 'selected' : ''}>${escapeHTML(s.name)}</option>`;
      });
      DOM.execFilterSuite.innerHTML = suiteHtml;
      DOM.execFilterSuite.value = State.execSuiteFilter;
    }

    // Populate Category Filter Dropdown
    if (DOM.execFilterCategory) {
      const catSet = new Set();
      suites.forEach(s => {
        if (s.category) catSet.add(s.category);
        (s.testCases || []).forEach(tc => { if (tc.category) catSet.add(tc.category); });
      });
      if (State.execCategoryFilter && State.execCategoryFilter !== 'ALL') {
        catSet.add(State.execCategoryFilter);
      }
      let catHtml = '<option value="ALL">All Categories</option>';
      Array.from(catSet).sort().forEach(cat => {
        catHtml += `<option value="${escapeHTML(cat)}" ${State.execCategoryFilter === cat ? 'selected' : ''}>${escapeHTML(cat)}</option>`;
      });
      DOM.execFilterCategory.innerHTML = catHtml;
      DOM.execFilterCategory.value = State.execCategoryFilter || 'ALL';
    }

    // Sync Status, Priority, Sort, and Search controls with State
    if (DOM.execFilterStatus) DOM.execFilterStatus.value = State.execStatusFilter || 'ALL';
    if (DOM.execFilterPriority) DOM.execFilterPriority.value = State.execPriorityFilter || 'ALL';
    if (DOM.execSortBy) DOM.execSortBy.value = State.execSortBy || 'id-asc';
    if (DOM.execSearchInput && DOM.execSearchInput.value !== State.execSearchQuery) {
      DOM.execSearchInput.value = State.execSearchQuery || '';
    }

    // Compute and Render Execution KPI Metrics (Strict Formulas)
    const totalCases = Number.isFinite(Number(project.testCaseCount)) ? Number(project.testCaseCount) : 0;
    const passedCount = Number.isFinite(Number(project.passedTests)) ? Number(project.passedTests) : 0;
    const failedCount = Number.isFinite(Number(project.failedTests)) ? Number(project.failedTests) : 0;
    const blockedCount = Number.isFinite(Number(project.blockedTests)) ? Number(project.blockedTests) : 0;
    const skippedCount = Number.isFinite(Number(project.skippedTests)) ? Number(project.skippedTests) : 0;
    const notRunCount = Number.isFinite(Number(project.notRunTests)) ? Number(project.notRunTests) : Math.max(0, totalCases - (passedCount + failedCount + blockedCount + skippedCount));
    const executedCount = Number.isFinite(Number(project.executedTests))
      ? Number(project.executedTests)
      : (passedCount + failedCount + blockedCount + skippedCount);
    const completionRate = totalCases > 0 ? Math.round((executedCount / totalCases) * 100) : 0;
    const passRate = executedCount > 0 ? Math.round((passedCount / executedCount) * 100) : 0;

    if (DOM.execStatTotal) DOM.execStatTotal.textContent = totalCases.toString();
    if (DOM.execStatNotrun) DOM.execStatNotrun.textContent = notRunCount.toString();
    if (DOM.execStatPassed) DOM.execStatPassed.textContent = passedCount.toString();
    if (DOM.execStatFailed) DOM.execStatFailed.textContent = failedCount.toString();
    if (DOM.execStatBlocked) DOM.execStatBlocked.textContent = blockedCount.toString();
    if (DOM.execStatSkipped) DOM.execStatSkipped.textContent = skippedCount.toString();
    if (DOM.execStatCompletion) DOM.execStatCompletion.textContent = `${completionRate}%`;
    if (DOM.execStatCompletionBar) DOM.execStatCompletionBar.style.width = `${completionRate}%`;
    if (DOM.execStatPassrate) DOM.execStatPassrate.textContent = `${passRate}%`;

    // Flatten all test cases with suite/phase metadata
    const allCases = [];
    suites.forEach(suite => {
      const phase = phases.find(ph => ph.id === suite.phaseId);
      (suite.testCases || []).forEach(tc => {
        allCases.push({
          ...tc,
          suiteId: suite.id,
          suiteName: suite.name,
          phaseId: suite.phaseId,
          phaseName: phase ? phase.name : 'Unassigned Phase'
        });
      });
    });

    // Determine Active Filter State
    const hasActiveFilters = Boolean(
      (State.execSearchQuery && State.execSearchQuery.trim().length > 0) ||
      State.execPhaseFilter !== 'ALL' ||
      State.execSuiteFilter !== 'ALL' ||
      State.execStatusFilter !== 'ALL' ||
      State.execPriorityFilter !== 'ALL' ||
      State.execCategoryFilter !== 'ALL' ||
      State.execSortBy !== 'id-asc'
    );

    if (DOM.execClearFiltersBtn) DOM.execClearFiltersBtn.style.display = hasActiveFilters ? 'inline-flex' : 'none';
    if (DOM.execSearchClearBtn) DOM.execSearchClearBtn.style.display = (State.execSearchQuery && State.execSearchQuery.length > 0) ? 'inline-flex' : 'none';

    // Apply Filter Pipeline
    let filtered = allCases.filter(c => {
      if (State.execSearchQuery && State.execSearchQuery.trim().length > 0) {
        const q = State.execSearchQuery.trim().toLowerCase();
        const idMatch = (c.id || '').toLowerCase().includes(q);
        const titleMatch = (c.title || '').toLowerCase().includes(q);
        const tagMatch = (c.tags || []).some(t => t.toLowerCase().includes(q));
        if (!idMatch && !titleMatch && !tagMatch) return false;
      }
      if (State.execPhaseFilter !== 'ALL' && c.phaseId !== State.execPhaseFilter) return false;
      if (State.execSuiteFilter !== 'ALL' && c.suiteId !== State.execSuiteFilter) return false;
      if (State.execStatusFilter !== 'ALL' && c.status !== State.execStatusFilter) return false;
      if (State.execPriorityFilter !== 'ALL' && c.priority !== State.execPriorityFilter) return false;
      if (State.execCategoryFilter !== 'ALL' && c.category !== State.execCategoryFilter) return false;
      return true;
    });

    // Apply Sorting
    filtered.sort((a, b) => {
      switch (State.execSortBy) {
        case 'id-desc':
          return (b.id || '').localeCompare(a.id || '', undefined, { numeric: true });
        case 'priority-desc': {
          const map = { Critical: 4, High: 3, Medium: 2, Low: 1 };
          return (map[b.priority] || 0) - (map[a.priority] || 0);
        }
        case 'newest':
          return new Date(b.createdAt) - new Date(a.createdAt);
        case 'oldest':
          return new Date(a.createdAt) - new Date(b.createdAt);
        case 'title-asc':
          return (a.title || '').localeCompare(b.title || '');
        case 'id-asc':
        default:
          return (a.id || '').localeCompare(b.id || '', undefined, { numeric: true });
      }
    });

    // Meta Count Text
    if (DOM.execMetaCount) {
      if (allCases.length === 0) {
        DOM.execMetaCount.textContent = 'This project currently has 0 test cases.';
      } else if (hasActiveFilters) {
        DOM.execMetaCount.textContent = `Showing ${filtered.length} of ${allCases.length} test cases (filtered)`;
      } else {
        DOM.execMetaCount.textContent = `Showing all ${allCases.length} test cases in project`;
      }
    }

    if (!DOM.execTableContainer) return;

    if (allCases.length === 0) {
      DOM.execTableContainer.innerHTML = `
        <div class="empty-state" style="padding: 48px 20px;">
          <div class="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </div>
          <h4 class="empty-state-title">No test cases to execute</h4>
          <p class="empty-state-desc">Before running test cycles, define test suites and test cases inside Test Plans.</p>
          <button type="button" class="btn btn-primary btn-sm btn-goto-plans">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <span>Go to Test Plans</span>
          </button>
        </div>
      `;

      const btn = DOM.execTableContainer.querySelector('.btn-goto-plans');
      if (btn) btn.addEventListener('click', () => navigateToProjectPlan(project.id));
      return;
    }

    if (filtered.length === 0) {
      DOM.execTableContainer.innerHTML = `
        <div class="empty-state" style="padding: 48px 20px;">
          <div class="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </div>
          <h4 class="empty-state-title">No test cases match active filters</h4>
          <p class="empty-state-desc">Try resetting your status, priority, or search parameters.</p>
          <button type="button" class="btn btn-secondary btn-sm btn-reset-exec-filters">
            <span>Reset All Filters</span>
          </button>
        </div>
      `;

      const btn = DOM.execTableContainer.querySelector('.btn-reset-exec-filters');
      if (btn) btn.addEventListener('click', resetExecFilters);
      return;
    }

    // Render Execution Cases Table
    let html = `
      <table class="cases-table">
        <thead>
          <tr>
            <th style="width: 90px;">Case ID</th>
            <th>Test Case Title</th>
            <th style="width: 140px;">Suite / Phase</th>
            <th style="width: 100px;">Priority</th>
            <th style="width: 110px;">Category</th>
            <th style="width: 110px;">Status</th>
            <th style="width: 130px;">Last Run</th>
            <th style="width: 170px; text-align: right;">Execution</th>
          </tr>
        </thead>
        <tbody>
    `;

    filtered.forEach(tc => {
      const priorityClass = getPriorityBadgeClass(tc.priority);
      const statusClass = getExecutionStatusBadgeClass(tc.status);

      const lastRunDisplay = tc.lastExecutedAt
        ? `<span title="${formatDisplayDateTime(tc.lastExecutedAt)}">${formatRelativeTime(tc.lastExecutedAt)}</span>`
        : `<span style="color: var(--text-muted);">Never run</span>`;

      const linkedDefectHtml = (tc.defectIds && tc.defectIds.length > 0)
        ? `<span class="badge-danger-soft btn-jump-defect" data-defect-id="${escapeHTML(tc.defectIds[0])}" style="cursor: pointer; margin-left: 6px;" title="View linked defect ${escapeHTML(tc.defectIds[0])}">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 11px; height: 11px;">
               <circle cx="12" cy="12" r="10"></circle>
               <line x1="12" y1="8" x2="12" y2="12"></line>
               <line x1="12" y1="16" x2="12.01" y2="16"></line>
             </svg>
             <span>${escapeHTML(tc.defectIds[0])}</span>
           </span>`
        : '';

      html += `
        <tr class="case-table-row" data-case-id="${escapeHTML(tc.id)}" data-suite-id="${escapeHTML(tc.suiteId)}">
          <td>
            <span class="case-id-tag">${escapeHTML(tc.id)}</span>
          </td>
          <td>
            <div class="case-title-cell">
              <span class="case-title-text" title="${escapeHTML(tc.title)}">${escapeHTML(tc.title)}</span>
              ${linkedDefectHtml}
            </div>
          </td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <span style="font-size: 0.82rem; font-weight: 600; color: var(--text-primary);">${escapeHTML(tc.suiteName)}</span>
              <span style="font-size: 0.72rem; color: var(--text-muted);">${escapeHTML(tc.phaseName)}</span>
            </div>
          </td>
          <td>
            <span class="priority-badge ${priorityClass}">${escapeHTML(tc.priority)}</span>
          </td>
          <td>
            <span class="project-badge badge-web">${escapeHTML(tc.category || 'Functional')}</span>
          </td>
          <td>
            <span class="status-badge ${statusClass}">${escapeHTML(tc.status || 'Not Run')}</span>
          </td>
          <td style="font-size: 0.78rem; color: var(--text-secondary);">
            ${lastRunDisplay}
          </td>
          <td style="text-align: right;">
            <div style="display: inline-flex; align-items: center; gap: 6px;">
              <button type="button" class="btn btn-primary btn-xs btn-run-case" data-case-id="${escapeHTML(tc.id)}" data-suite-id="${escapeHTML(tc.suiteId)}" title="Execute test case steps and record result">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                <span>Execute</span>
              </button>
              <button type="button" class="icon-btn btn-history-case" data-case-id="${escapeHTML(tc.id)}" data-suite-id="${escapeHTML(tc.suiteId)}" title="View execution history & logs">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    DOM.execTableContainer.innerHTML = html;

    // Attach Row Event Listeners
    DOM.execTableContainer.querySelectorAll('.btn-run-case').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const caseId = btn.getAttribute('data-case-id');
        if (caseId) openExecutionModal(project.id, caseId);
      });
    });

    DOM.execTableContainer.querySelectorAll('.btn-history-case').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const caseId = btn.getAttribute('data-case-id');
        if (caseId) openExecutionHistoryModal(project.id, caseId);
      });
    });

    DOM.execTableContainer.querySelectorAll('.btn-jump-defect').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const defectId = badge.getAttribute('data-defect-id');
        if (defectId) openDefectViewModal(project.id, defectId);
      });
    });
  }

  function resetExecFilters() {
    State.execSearchQuery = '';
    State.execPhaseFilter = 'ALL';
    State.execSuiteFilter = 'ALL';
    State.execStatusFilter = 'ALL';
    State.execPriorityFilter = 'ALL';
    State.execCategoryFilter = 'ALL';
    State.execSortBy = 'id-asc';

    if (DOM.execSearchInput) DOM.execSearchInput.value = '';
    if (DOM.execFilterPhase) DOM.execFilterPhase.value = 'ALL';
    if (DOM.execFilterSuite) DOM.execFilterSuite.value = 'ALL';
    if (DOM.execFilterStatus) DOM.execFilterStatus.value = 'ALL';
    if (DOM.execFilterPriority) DOM.execFilterPriority.value = 'ALL';
    if (DOM.execFilterCategory) DOM.execFilterCategory.value = 'ALL';
    if (DOM.execSortBy) DOM.execSortBy.value = 'id-asc';

    renderTestExecutionWorkspace();
  }

  // ==========================================================================
  // Prompt 4: Dedicated Test Execution Runner Modal
  // ==========================================================================
  function openExecutionModal(projectId, caseId) {
    if (!DOM.executionModal) return;

    const projects = Storage.getProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    let targetSuite = null;
    let targetCase = null;

    (project.testSuites || []).forEach(s => {
      const found = (s.testCases || []).find(c => c.id === caseId);
      if (found) {
        targetSuite = s;
        targetCase = found;
      }
    });

    if (!targetCase || !targetSuite) {
      showToast('Test case could not be found.', 'error');
      return;
    }

    if (DOM.executionForm) DOM.executionForm.reset();
    hideExecError();

    // Context & Specifications setup
    if (DOM.execCaseIdInput) DOM.execCaseIdInput.value = targetCase.id;
    if (DOM.execProjectIdInput) DOM.execProjectIdInput.value = project.id;
    if (DOM.execModalCaseId) DOM.execModalCaseId.textContent = targetCase.id;
    if (DOM.execModalPriority) {
      DOM.execModalPriority.className = `priority-badge ${getPriorityBadgeClass(targetCase.priority)}`;
      DOM.execModalPriority.textContent = targetCase.priority;
    }
    if (DOM.execModalCategory) DOM.execModalCategory.textContent = targetCase.category || 'Functional';
    if (DOM.execModalTitle) DOM.execModalTitle.textContent = targetCase.title;
    if (DOM.execCasePreconditions) DOM.execCasePreconditions.textContent = targetCase.preconditions || 'None specified.';
    if (DOM.execCaseDesc) DOM.execCaseDesc.textContent = targetCase.description || 'No additional description provided.';
    if (DOM.execExpectedResult) DOM.execExpectedResult.textContent = targetCase.expectedResult;

    // Presets for tester, environment, build
    if (DOM.execTesterInput) DOM.execTesterInput.value = State.cachedTesterName || '';
    if (DOM.execEnvInput) DOM.execEnvInput.value = 'Staging';
    if (DOM.execBuildInput) DOM.execBuildInput.value = (project.version !== undefined && project.version !== null) ? String(project.version) : '';

    // Step Runner State Initialization
    const rawSteps = Array.isArray(targetCase.steps) ? targetCase.steps : [];
    State.modalExecContext = {
      projectId: project.id,
      suiteId: targetSuite.id,
      caseId: targetCase.id,
      steps: rawSteps.map((st, idx) => ({
        stepId: st.id || ('st_' + idx),
        action: st.action || '',
        testData: (st.testData !== undefined && st.testData !== null) ? String(st.testData) : '',
        status: 'untested', // 'completed' | 'failed' | 'untested'
        note: ''
      }))
    };

    renderExecutionStepsList();

    // Defect Section Setup
    if (DOM.execDefectSection) DOM.execDefectSection.style.display = 'none';
    if (DOM.execDefectTitle) DOM.execDefectTitle.value = `[Defect] ${targetCase.title}`;
    if (DOM.execDefectSeverity) DOM.execDefectSeverity.value = classifyPriority(targetCase.priority) || (targetCase.priority !== undefined && targetCase.priority !== null ? String(targetCase.priority) : 'High');
    if (DOM.execDefectSteps) {
      const stepsText = rawSteps.map((st, idx) => {
        const hasData = st.testData !== undefined && st.testData !== null && String(st.testData).trim() !== '';
        return `${idx + 1}. ${st.action}${hasData ? ' (Data: ' + st.testData + ')' : ''}`;
      }).join('\n');
      DOM.execDefectSteps.value = stepsText;
    }
    if (DOM.execDefectUrl) DOM.execDefectUrl.value = '';

    DOM.executionModal.classList.add('open');
    DOM.executionModal.setAttribute('aria-hidden', 'false');
  }

  function closeExecutionModal() {
    if (!DOM.executionModal) return;
    DOM.executionModal.classList.remove('open');
    DOM.executionModal.setAttribute('aria-hidden', 'true');
    hideExecError();
    State.modalExecContext = null;
  }

  function showExecError(msg) {
    if (DOM.execErrorAlert && DOM.execErrorText) {
      DOM.execErrorText.textContent = msg;
      DOM.execErrorAlert.style.display = 'flex';
    }
  }

  function hideExecError() {
    if (DOM.execErrorAlert) DOM.execErrorAlert.style.display = 'none';
  }

  function renderExecutionStepsList() {
    if (!DOM.execStepsContainer || !State.modalExecContext || !Array.isArray(State.modalExecContext.steps)) return;

    const steps = State.modalExecContext.steps;
    const total = steps.length;
    const completed = steps.filter(s => s.status === 'completed').length;
    const failed = steps.filter(s => s.status === 'failed').length;
    const progressPercent = total > 0 ? Math.round(((completed + failed) / total) * 100) : 100;

    if (DOM.execStepProgressText) {
      DOM.execStepProgressText.textContent = total > 0
        ? `${completed} of ${total} steps completed (${progressPercent}% progress)`
        : 'No explicit steps defined. Verify expected result.';
    }

    if (DOM.execStepsProgressBar) {
      DOM.execStepsProgressBar.style.width = `${progressPercent}%`;
      DOM.execStepsProgressBar.style.backgroundColor = failed > 0 ? 'var(--color-red)' : 'var(--color-green)';
    }

    if (DOM.execIncompleteWarning) {
      const hasUntested = steps.some(s => s.status === 'untested');
      DOM.execIncompleteWarning.style.display = (total > 0 && hasUntested) ? 'flex' : 'none';
    }

    if (steps.length === 0) {
      DOM.execStepsContainer.innerHTML = `
        <div style="padding: 12px; font-size: 0.83rem; color: var(--text-muted); text-align: center;">
          No sequential steps configured for this test case. Compare actual system state against the Expected Result below.
        </div>
      `;
      return;
    }

    let html = '';
    steps.forEach((st, idx) => {
      const cardClass = st.status === 'completed'
        ? 'step-passed'
        : st.status === 'failed'
          ? 'step-failed'
          : '';

      const hasData = st.testData !== undefined && st.testData !== null && String(st.testData).trim() !== '';
      const dataSnippet = hasData
        ? `<span class="exec-step-data">Input / Data: <code>${escapeHTML(String(st.testData))}</code></span>`
        : '';

      html += `
        <div class="exec-step-card ${cardClass}" data-step-index="${idx}">
          <div class="exec-step-main">
            <div class="exec-step-left">
              <span class="exec-step-num">${idx + 1}</span>
              <div class="exec-step-texts">
                <span class="exec-step-action">${escapeHTML(st.action)}</span>
                ${dataSnippet}
              </div>
            </div>

            <div class="exec-step-actions">
              <button type="button" class="step-status-btn btn-pass ${st.status === 'completed' ? 'active' : ''}" data-step-index="${idx}" title="Mark step passed">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span>Pass</span>
              </button>
              <button type="button" class="step-status-btn btn-fail ${st.status === 'failed' ? 'active' : ''}" data-step-index="${idx}" title="Mark step failed">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
                <span>Fail</span>
              </button>
              <button type="button" class="step-status-btn btn-reset" data-step-index="${idx}" title="Reset step status">
                <span>Reset</span>
              </button>
            </div>
          </div>

          <div class="exec-step-note-wrap">
            <input
              type="text"
              class="exec-step-note-input"
              data-step-index="${idx}"
              placeholder="Optional step execution note or observed test data..."
              value="${escapeHTML(st.note || '')}"
            />
          </div>
        </div>
      `;
    });

    DOM.execStepsContainer.innerHTML = html;

    // Attach step action button events
    DOM.execStepsContainer.querySelectorAll('.btn-pass').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.getAttribute('data-step-index'), 10);
        if (State.modalExecContext && Array.isArray(State.modalExecContext.steps) && State.modalExecContext.steps[i]) {
          State.modalExecContext.steps[i].status = 'completed';
          renderExecutionStepsList();
        }
      });
    });

    DOM.execStepsContainer.querySelectorAll('.btn-fail').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.getAttribute('data-step-index'), 10);
        if (State.modalExecContext && Array.isArray(State.modalExecContext.steps) && State.modalExecContext.steps[i]) {
          State.modalExecContext.steps[i].status = 'failed';
          renderExecutionStepsList();

          // Auto-suggest Fail in status dropdown if not already set
          if (DOM.execStatusSelect && DOM.execStatusSelect.value !== 'Fail') {
            DOM.execStatusSelect.value = 'Fail';
            handleExecStatusChange();
          }
        }
      });
    });

    DOM.execStepsContainer.querySelectorAll('.btn-reset').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.getAttribute('data-step-index'), 10);
        if (State.modalExecContext && Array.isArray(State.modalExecContext.steps) && State.modalExecContext.steps[i]) {
          State.modalExecContext.steps[i].status = 'untested';
          renderExecutionStepsList();
        }
      });
    });

    DOM.execStepsContainer.querySelectorAll('.exec-step-note-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const i = parseInt(input.getAttribute('data-step-index'), 10);
        if (State.modalExecContext && Array.isArray(State.modalExecContext.steps) && State.modalExecContext.steps[i]) {
          State.modalExecContext.steps[i].note = e.target.value;
        }
      });
    });
  }

  function handleExecStatusChange() {
    if (!DOM.execStatusSelect) return;
    const val = DOM.execStatusSelect.value;

    if (val === 'Fail') {
      if (DOM.execDefectSection) DOM.execDefectSection.style.display = 'flex';
      if (DOM.execActualLabel) DOM.execActualLabel.innerHTML = 'Actual Result / Defect Behavior <span class="required-mark">*</span>';
      if (DOM.execActualHint) DOM.execActualHint.textContent = 'Describe the exact bug, unexpected message, or failure observed (Required for Fail).';
      if (DOM.execActualInput) DOM.execActualInput.placeholder = 'e.g. Received HTTP 500 error and screen did not update...';
    } else {
      if (DOM.execDefectSection) DOM.execDefectSection.style.display = 'none';
      if (val === 'Pass') {
        if (DOM.execActualLabel) DOM.execActualLabel.innerHTML = 'Actual Result <span class="required-mark">*</span>';
        if (DOM.execActualHint) DOM.execActualHint.textContent = 'Describe the confirmed outcome matching the expected specification (Required for Pass).';
        if (DOM.execActualInput) DOM.execActualInput.placeholder = 'e.g. Operation completed successfully as expected; UI transitioned to confirmation state.';

        if (State.preferences?.autopassSteps && State.modalExecContext && Array.isArray(State.modalExecContext.steps)) {
          let updated = false;
          State.modalExecContext.steps.forEach(st => {
            if (st && st.status === 'untested') {
              st.status = 'completed';
              updated = true;
            }
          });
          if (updated) {
            renderExecutionStepsList();
          }
        }
      } else if (val === 'Blocked') {
        if (DOM.execActualLabel) DOM.execActualLabel.innerHTML = 'Blocking Reason & Obstacle <span class="required-mark">*</span>';
        if (DOM.execActualHint) DOM.execActualHint.textContent = 'State the external dependency, unavailable environment, or open bug blocking execution (Required).';
        if (DOM.execActualInput) DOM.execActualInput.placeholder = 'e.g. Blocked because staging database service is offline / down for maintenance.';
      } else if (val === 'Skipped') {
        if (DOM.execActualLabel) DOM.execActualLabel.innerHTML = 'Reason for Skipping <span class="required-mark">*</span>';
        if (DOM.execActualHint) DOM.execActualHint.textContent = 'Explain why this test case was intentionally skipped in this execution cycle (Required).';
        if (DOM.execActualInput) DOM.execActualInput.placeholder = 'e.g. Feature flag is disabled in the current test sprint.';
      }
    }
  }

  function handleSaveExecutionSubmit(e) {
    e.preventDefault();

    const caseId = DOM.execCaseIdInput ? DOM.execCaseIdInput.value.trim() : '';
    const projectId = DOM.execProjectIdInput ? DOM.execProjectIdInput.value.trim() : '';
    const status = DOM.execStatusSelect ? DOM.execStatusSelect.value : '';
    const actualResult = DOM.execActualInput ? DOM.execActualInput.value.trim() : '';
    const notes = DOM.execNotesInput ? DOM.execNotesInput.value.trim() : '';
    const tester = DOM.execTesterInput ? DOM.execTesterInput.value.trim() : '';
    const env = DOM.execEnvInput ? DOM.execEnvInput.value.trim() : '';
    const device = DOM.execDeviceInput ? DOM.execDeviceInput.value.trim() : '';
    const build = DOM.execBuildInput ? DOM.execBuildInput.value.trim() : '';

    if (!status || !['Pass', 'Fail', 'Blocked', 'Skipped'].includes(status)) {
      showExecError('Please select a valid Execution Status (Pass, Fail, Blocked, or Skipped).');
      if (DOM.execStatusSelect) DOM.execStatusSelect.focus();
      return;
    }

    if (!actualResult) {
      if (status === 'Pass' || status === 'Fail') {
        showExecError(`Actual Result is required when recording a ${status} outcome.`);
      } else if (status === 'Blocked') {
        showExecError('A reason/obstacle is required when marking a test as Blocked.');
      } else if (status === 'Skipped') {
        showExecError('A reason is required when marking a test as Skipped.');
      }
      if (DOM.execActualInput) DOM.execActualInput.focus();
      return;
    }

    const projects = Storage.getProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    let targetSuite = null;
    let targetCase = null;

    (project.testSuites || []).forEach(s => {
      const found = (s.testCases || []).find(c => c.id === caseId);
      if (found) {
        targetSuite = s;
        targetCase = found;
      }
    });

    if (!targetCase || !targetSuite) {
      showExecError('Test case could not be located in storage.');
      return;
    }

    // Cache Tester Name for subsequent test executions
    if (tester) {
      State.cachedTesterName = tester;
    }

    // Optional Quick Defect Creation on Fail
    let defectId = null;
    const shouldLogDefect = status === 'Fail' && DOM.execLogDefectToggle && DOM.execLogDefectToggle.checked;

    if (shouldLogDefect) {
      const defectTitle = DOM.execDefectTitle ? DOM.execDefectTitle.value.trim() : '';
      const defectSeverity = DOM.execDefectSeverity ? DOM.execDefectSeverity.value : 'High';
      const defectUrl = DOM.execDefectUrl ? DOM.execDefectUrl.value.trim() : '';
      const defectSteps = DOM.execDefectSteps ? DOM.execDefectSteps.value.trim() : '';

      if (!defectTitle) {
        showExecError('Please provide a Defect Title for the logged defect.');
        if (DOM.execDefectTitle) DOM.execDefectTitle.focus();
        return;
      }

      defectId = generateUniqueDefectId(projects);

      const defectRecord = {
        id: defectId,
        testCaseId: targetCase.id,
        executionId: '', // populated below
        title: defectTitle,
        description: notes || `Recorded during test execution of ${targetCase.id}`,
        priority: defectSeverity,
        severity: defectSeverity,
        status: 'Open',
        stepsToReproduce: defectSteps,
        expectedResult: targetCase.expectedResult,
        actualResult: actualResult,
        externalIssueUrl: defectUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (!Array.isArray(project.defects)) project.defects = [];
      project.defects.unshift(defectRecord);

      if (!Array.isArray(targetCase.defectIds)) targetCase.defectIds = [];
      if (!targetCase.defectIds.includes(defectId)) {
        targetCase.defectIds.unshift(defectId);
      }
    }

    // Generate unique execution ID and record
    const execId = 'exec_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    // If defect created, attach execution ID
    if (defectId && project.defects && project.defects[0] && project.defects[0].id === defectId) {
      project.defects[0].executionId = execId;
    }

    const executionRecord = {
      id: execId,
      testCaseId: targetCase.id,
      testCaseTitle: targetCase.title,
      suiteId: targetSuite.id,
      phaseId: targetSuite.phaseId || '',
      status: status,
      actualResult: actualResult,
      notes: notes,
      tester: tester,
      environment: env,
      browserDevice: device,
      buildVersion: build,
      stepResults: (State.modalExecContext?.steps || []).map(st => ({
        stepId: st.stepId,
        action: st.action,
        testData: st.testData,
        status: st.status,
        note: st.note
      })),
      defectIds: defectId ? [defectId] : [],
      executedAt: new Date().toISOString()
    };

    const prevCaseStatus = targetCase.status;
    const prevLastExecutedAt = targetCase.lastExecutedAt;
    const prevLastExecutionId = targetCase.lastExecutionId;
    const prevCaseExecs = Array.isArray(targetCase.executions) ? [...targetCase.executions] : [];
    const prevCaseDefects = Array.isArray(targetCase.defectIds) ? [...targetCase.defectIds] : [];
    const prevProjectExecs = Array.isArray(project.executions) ? [...project.executions] : [];
    const prevProjectDefects = Array.isArray(project.defects) ? [...project.defects] : [];

    if (!Array.isArray(project.executions)) project.executions = [];
    project.executions.unshift(executionRecord);

    // Update test case status & audit pointers
    targetCase.status = status;
    targetCase.lastExecutedAt = executionRecord.executedAt;
    targetCase.lastExecutionId = execId;
    if (!Array.isArray(targetCase.executions)) targetCase.executions = [];
    targetCase.executions.unshift(execId);
    targetCase.updatedAt = executionRecord.executedAt;

    project.updatedAt = executionRecord.executedAt;
    targetSuite.updatedAt = executionRecord.executedAt;

    const saveRes = Storage.saveProjects(projects);
    if (!saveRes.ok) {
      project.executions = prevProjectExecs;
      project.defects = prevProjectDefects;
      targetCase.status = prevCaseStatus;
      targetCase.lastExecutedAt = prevLastExecutedAt;
      targetCase.lastExecutionId = prevLastExecutionId;
      targetCase.executions = prevCaseExecs;
      targetCase.defectIds = prevCaseDefects;
      showExecError(saveRes.error || 'Failed to save test execution to storage.');
      return;
    }

    const defectText = defectId ? ` (Logged ${defectId})` : '';
    Storage.addActivity('Executed test case', `${targetCase.id} [${status}]${defectText}`);
    addNotification({
      title: `Test ${status}: ${targetCase.id}`,
      message: `Execution recorded as ${status} in "${project.name}".`,
      type: 'execution',
      link: { view: 'execution', projectId: project.id, caseId: targetCase.id }
    });
    showToast(`Execution recorded: ${targetCase.id} (${status})`, 'success');

    closeExecutionModal();

    // Re-render views
    renderDashboard();
    renderMyProjects();
    renderTestPlansWorkspace();
    renderTestExecutionWorkspace();
    renderDefectsWorkspace();
    renderReportsWorkspace();

    if (State.currentView === 'project-details' && State.currentDetailProjectId === project.id) {
      renderProjectDetailsData(project);
    }
  }

  // ==========================================================================
  // Prompt 4: Execution History Modal Controller
  // ==========================================================================
  function openExecutionHistoryModal(projectId, caseId) {
    if (!DOM.executionHistoryModal) return;

    const projects = Storage.getProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    let targetCase = null;
    (project.testSuites || []).forEach(s => {
      const found = (s.testCases || []).find(c => c.id === caseId);
      if (found) targetCase = found;
    });

    if (!targetCase) return;

    if (DOM.historyModalCaseId) DOM.historyModalCaseId.textContent = targetCase.id;
    if (DOM.historyModalCaseTitle) DOM.historyModalCaseTitle.textContent = `${targetCase.id} — ${targetCase.title}`;

    // Filter executions belonging to this test case
    const caseExecutions = (project.executions || []).filter(ex => ex.testCaseId === caseId);

    if (DOM.historyModalTotalRuns) {
      DOM.historyModalTotalRuns.textContent = `${caseExecutions.length} execution run${caseExecutions.length === 1 ? '' : 's'}`;
    }

    if (DOM.historyExecuteAgainBtn) {
      DOM.historyExecuteAgainBtn.onclick = () => {
        closeExecutionHistoryModal();
        openExecutionModal(projectId, caseId);
      };
    }

    if (!DOM.historyRunsContainer) return;

    if (caseExecutions.length === 0) {
      DOM.historyRunsContainer.innerHTML = `
        <div class="empty-state" style="padding: 36px 16px;">
          <div class="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
          <h4 class="empty-state-title">No execution history recorded</h4>
          <p class="empty-state-desc">This test case has not been executed yet. Click "Execute Again" to run testing steps.</p>
        </div>
      `;
    } else {
      let html = '';
      caseExecutions.forEach((run, idx) => {
        const runNum = caseExecutions.length - idx;
        const statusClass = getExecutionStatusBadgeClass(run.status);

        // Step breakdown
        const steps = Array.isArray(run.stepResults) ? run.stepResults : [];
        const passedSteps = steps.filter(s => s.status === 'completed').length;
        const failedSteps = steps.filter(s => s.status === 'failed').length;

        const testerDisplay = run.tester
          ? `<span>Tester: <strong>${escapeHTML(run.tester)}</strong></span>`
          : '<span>Tester: <em>Anonymous</em></span>';

        const envDisplay = run.environment
          ? `<span>Env: <strong>${escapeHTML(run.environment)}</strong></span>`
          : '';

        const deviceDisplay = run.browserDevice
          ? `<span>Device: <strong>${escapeHTML(run.browserDevice)}</strong></span>`
          : '';

        const buildDisplay = run.buildVersion
          ? `<span>Build: <strong>${escapeHTML(run.buildVersion)}</strong></span>`
          : '';

        const linkedDefectHtml = (run.defectIds && run.defectIds.length > 0)
          ? `<span class="badge-danger-soft btn-jump-history-defect" data-defect-id="${escapeHTML(run.defectIds[0])}" style="cursor: pointer;" title="Inspect Defect">
               Defect: ${escapeHTML(run.defectIds[0])}
             </span>`
          : '';

        let stepsHtml = '';
        if (steps.length > 0) {
          stepsHtml = `
            <div id="history-steps-${idx}" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-subtle);">
              <span class="case-detail-label" style="font-size: 0.7rem; margin-bottom: 4px; display: block;">Step Verifications:</span>
              <div style="display: flex; flex-direction: column; gap: 4px;">
                ${steps.map((st, sIdx) => `
                  <div style="font-size: 0.77rem; display: flex; align-items: flex-start; gap: 6px;">
                    <span style="font-weight: 700; color: ${st.status === 'completed' ? 'var(--color-green)' : st.status === 'failed' ? 'var(--color-red)' : 'var(--text-muted)'};">[${st.status || 'untested'}]</span>
                    <span>${sIdx + 1}. ${escapeHTML(st.action)}</span>
                    ${st.note ? `<span style="color: var(--text-muted); font-style: italic;">(${escapeHTML(st.note)})</span>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }

        html += `
          <div class="history-run-card">
            <div class="history-run-top">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 0.8rem; font-weight: 700; color: var(--accent-primary);">Run #${runNum}</span>
                <span class="status-badge ${statusClass}">${escapeHTML(run.status)}</span>
                ${linkedDefectHtml}
              </div>
              <span style="font-size: 0.74rem; color: var(--text-muted);">${formatDisplayDateTime(run.executedAt)} (${formatRelativeTime(run.executedAt)})</span>
            </div>

            <div class="history-run-meta">
              ${testerDisplay}
              ${envDisplay}
              ${deviceDisplay}
              ${buildDisplay}
              ${steps.length > 0 ? `<span>Steps: ${passedSteps} passed, ${failedSteps} failed</span>` : ''}
            </div>

            <div class="history-run-body">
              <strong>Actual Result:</strong> ${escapeHTML(run.actualResult)}
              ${run.notes ? `<div style="margin-top: 4px; color: var(--text-muted);"><strong>Notes:</strong> ${escapeHTML(run.notes)}</div>` : ''}
            </div>

            ${steps.length > 0 ? `
              <div>
                <button type="button" class="history-run-steps-toggle" data-target="history-steps-${idx}">
                  <span>View Step Verification Details</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>
                ${stepsHtml}
              </div>
            ` : ''}
          </div>
        `;
      });

      DOM.historyRunsContainer.innerHTML = html;

      // Toggle step details
      DOM.historyRunsContainer.querySelectorAll('.history-run-steps-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
          const targetId = btn.getAttribute('data-target');
          const el = document.getElementById(targetId);
          if (el) {
            const isHidden = el.style.display === 'none';
            el.style.display = isHidden ? 'block' : 'none';
            btn.querySelector('span').textContent = isHidden ? 'Hide Step Details' : 'View Step Verification Details';
          }
        });
      });

      // Jump to defect from history
      DOM.historyRunsContainer.querySelectorAll('.btn-jump-history-defect').forEach(badge => {
        badge.addEventListener('click', () => {
          const dfId = badge.getAttribute('data-defect-id');
          if (dfId) {
            closeExecutionHistoryModal();
            openDefectViewModal(projectId, dfId);
          }
        });
      });
    }

    DOM.executionHistoryModal.classList.add('open');
    DOM.executionHistoryModal.setAttribute('aria-hidden', 'false');
  }

  function closeExecutionHistoryModal() {
    if (!DOM.executionHistoryModal) return;
    DOM.executionHistoryModal.classList.remove('open');
    DOM.executionHistoryModal.setAttribute('aria-hidden', 'true');
  }

  // ==========================================================================
  // Prompt 4: Defects Workspace Controller
  // ==========================================================================
  function renderDefectsWorkspace() {
    const projects = Storage.getProjects();

    // Ensure activeDefectsProjectId is valid ('ALL' or an existing project ID)
    if (
      !State.activeDefectsProjectId ||
      (State.activeDefectsProjectId !== 'ALL' && !projects.some(p => p.id === State.activeDefectsProjectId))
    ) {
      State.activeDefectsProjectId = 'ALL';
    }

    // Populate Project Filter Dropdown
    if (DOM.defectsProjectSelect) {
      let optHtml = '<option value="ALL">All Projects (Combined)</option>';
      projects.forEach(p => {
        optHtml += `<option value="${escapeHTML(p.id)}" ${State.activeDefectsProjectId === p.id ? 'selected' : ''}>${escapeHTML(p.name)} (${p.totalDefects ?? 0} defects)</option>`;
      });
      DOM.defectsProjectSelect.innerHTML = optHtml;
      DOM.defectsProjectSelect.value = State.activeDefectsProjectId;
    }

    // Synchronize filter & sort controls with State (QAV-ISS-004)
    if (DOM.defectsSearchInput) DOM.defectsSearchInput.value = State.defectSearchQuery || '';
    if (DOM.defectsFilterSeverity) DOM.defectsFilterSeverity.value = State.defectSeverityFilter || 'ALL';
    if (DOM.defectsFilterStatus) DOM.defectsFilterStatus.value = State.defectStatusFilter || 'ALL';
    if (DOM.defectsSortBy) DOM.defectsSortBy.value = State.defectSortBy || 'newest';

    // Collect all defects according to active project scope
    const allDefects = [];
    projects.forEach(p => {
      if (State.activeDefectsProjectId === 'ALL' || State.activeDefectsProjectId === p.id) {
        (p.defects || []).forEach(df => {
          allDefects.push({
            ...df,
            projectId: p.id,
            projectName: p.name
          });
        });
      }
    });

    // Compute KPI Counts
    const totalCount = allDefects.length;
    const openCount = allDefects.filter(d => ['Open', 'Reopened'].includes(d.status)).length;
    const inProgressCount = allDefects.filter(d => d.status === 'In Progress').length;
    const resolvedCount = allDefects.filter(d => ['Resolved', 'Closed'].includes(d.status)).length;
    const criticalCount = allDefects.filter(d => classifyDefectPriority(d) === 'Critical').length;

    if (DOM.defectsStatTotal) DOM.defectsStatTotal.textContent = totalCount.toString();
    if (DOM.defectsStatOpen) DOM.defectsStatOpen.textContent = openCount.toString();
    if (DOM.defectsStatProgress) DOM.defectsStatProgress.textContent = inProgressCount.toString();
    if (DOM.defectsStatResolved) DOM.defectsStatResolved.textContent = resolvedCount.toString();
    if (DOM.defectsStatCritical) DOM.defectsStatCritical.textContent = criticalCount.toString();

    // Check active filters
    const hasActiveFilters = Boolean(
      (State.defectSearchQuery && State.defectSearchQuery.trim().length > 0) ||
      State.defectSeverityFilter !== 'ALL' ||
      State.defectStatusFilter !== 'ALL' ||
      State.defectSortBy !== 'newest'
    );

    if (DOM.defectsClearFiltersBtn) DOM.defectsClearFiltersBtn.style.display = hasActiveFilters ? 'inline-flex' : 'none';
    if (DOM.defectsSearchClearBtn) DOM.defectsSearchClearBtn.style.display = (State.defectSearchQuery && State.defectSearchQuery.length > 0) ? 'inline-flex' : 'none';

    // Apply Filter Pipeline
    let filtered = allDefects.filter(d => {
      if (State.defectSearchQuery && State.defectSearchQuery.trim().length > 0) {
        const q = State.defectSearchQuery.trim().toLowerCase();
        const idMatch = (d.id || '').toLowerCase().includes(q);
        const titleMatch = (d.title || '').toLowerCase().includes(q);
        const descMatch = (d.description || '').toLowerCase().includes(q);
        const caseMatch = (d.testCaseId !== undefined && d.testCaseId !== null && String(d.testCaseId).toLowerCase().includes(q));
        if (!idMatch && !titleMatch && !descMatch && !caseMatch) return false;
      }
      if (State.defectSeverityFilter !== 'ALL' && classifyDefectPriority(d) !== State.defectSeverityFilter) return false;
      if (State.defectStatusFilter !== 'ALL' && d.status !== State.defectStatusFilter) return false;
      return true;
    });

    // Apply Sorting
    filtered.sort((a, b) => {
      switch (State.defectSortBy) {
        case 'oldest':
          return new Date(a.createdAt) - new Date(b.createdAt);
        case 'severity-desc': {
          const map = { Critical: 4, High: 3, Medium: 2, Low: 1 };
          return (map[classifyDefectPriority(b)] || 0) - (map[classifyDefectPriority(a)] || 0);
        }
        case 'severity-asc': {
          const map = { Critical: 4, High: 3, Medium: 2, Low: 1 };
          return (map[classifyDefectPriority(a)] || 0) - (map[classifyDefectPriority(b)] || 0);
        }
        case 'id-desc':
          return (b.id || '').localeCompare(a.id || '', undefined, { numeric: true });
        case 'id-asc':
          return (a.id || '').localeCompare(b.id || '', undefined, { numeric: true });
        case 'newest':
        default:
          return new Date(b.createdAt) - new Date(a.createdAt);
      }
    });

    if (DOM.defectsMetaCount) {
      if (allDefects.length === 0) {
        DOM.defectsMetaCount.textContent = 'No defects found in this scope.';
      } else if (hasActiveFilters) {
        DOM.defectsMetaCount.textContent = `Showing ${filtered.length} of ${allDefects.length} defects (filtered)`;
      } else {
        DOM.defectsMetaCount.textContent = `Showing all ${allDefects.length} defects`;
      }
    }

    if (!DOM.defectsTableContainer) return;

    if (allDefects.length === 0) {
      DOM.defectsTableContainer.innerHTML = `
        <div class="empty-state" style="padding: 48px 20px;">
          <div class="empty-state-icon" style="color: var(--color-green); border-color: var(--color-green-border);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
          </div>
          <h4 class="empty-state-title">Clean bill of health! No defects logged.</h4>
          <p class="empty-state-desc">When test cases fail during execution, you can log defects with automated steps and screenshots here.</p>
          <button type="button" class="btn btn-primary btn-sm btn-empty-create-defect">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>Log First Defect</span>
          </button>
        </div>
      `;

      const btn = DOM.defectsTableContainer.querySelector('.btn-empty-create-defect');
      if (btn) btn.addEventListener('click', () => openDefectModal(State.activeDefectsProjectId, null));
      return;
    }

    if (filtered.length === 0) {
      DOM.defectsTableContainer.innerHTML = `
        <div class="empty-state" style="padding: 48px 20px;">
          <div class="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </div>
          <h4 class="empty-state-title">No defects match filter parameters</h4>
          <p class="empty-state-desc">Try clearing your search query or reset the severity and status filters.</p>
          <button type="button" class="btn btn-secondary btn-sm btn-reset-defect-filters">
            <span>Reset Defect Filters</span>
          </button>
        </div>
      `;

      const btn = DOM.defectsTableContainer.querySelector('.btn-reset-defect-filters');
      if (btn) btn.addEventListener('click', resetDefectFilters);
      return;
    }

    let html = `
      <table class="cases-table">
        <thead>
          <tr>
            <th style="width: 100px;">Defect ID</th>
            <th>Defect Title</th>
            <th style="width: 140px;">Project</th>
            <th style="width: 110px;">Linked Test</th>
            <th style="width: 100px;">Severity</th>
            <th style="width: 120px;">Status</th>
            <th style="width: 120px;">Created</th>
            <th style="width: 160px; text-align: right;">Actions</th>
          </tr>
        </thead>
        <tbody>
    `;

    filtered.forEach(df => {
      const prioCategory = classifyDefectPriority(df);
      const sevClass = getPriorityBadgeClass(prioCategory || df.severity || df.priority);
      const displaySeverity = prioCategory || df.priority || df.severity || 'Unassigned';
      const statusClass = getDefectStatusBadgeClass(df.status);

      const hasLinkedTest = df.testCaseId !== undefined && df.testCaseId !== null && String(df.testCaseId).trim() !== '';
      const resolvedLinkedCtx = hasLinkedTest
        ? resolveProjectCaseContext(df.projectId, df.testCaseId, projects)
        : null;
      const linkedSuiteIdAttr = resolvedLinkedCtx ? ` data-suite-id="${escapeHTML(resolvedLinkedCtx.suite.id)}"` : '';
      const linkedTestHtml = hasLinkedTest
        ? `<span class="case-id-tag btn-inspect-linked-test" data-project-id="${escapeHTML(df.projectId)}"${linkedSuiteIdAttr} data-case-id="${escapeHTML(String(df.testCaseId).trim())}" style="cursor: pointer;" title="${resolvedLinkedCtx ? `Inspect linked test case ${escapeHTML(String(df.testCaseId).trim())}` : `Linked test case ${escapeHTML(String(df.testCaseId).trim())} is unavailable`}">${escapeHTML(String(df.testCaseId).trim())}</span>`
        : `<span style="color: var(--text-muted); font-size: 0.76rem;">Independent</span>`;

      const safeExternalUrl = sanitizeExternalUrl(df.externalIssueUrl);
      const externalLinkHtml = safeExternalUrl
        ? `<a href="${escapeHTML(safeExternalUrl)}" target="_blank" rel="noopener noreferrer" class="link-external" style="font-size: 0.72rem; margin-top: 2px;">External Issue</a>`
        : '';

      html += `
        <tr class="case-table-row" data-defect-id="${escapeHTML(df.id)}" data-project-id="${escapeHTML(df.projectId)}">
          <td>
            <span class="case-id-tag badge-danger-soft">${escapeHTML(df.id)}</span>
          </td>
          <td>
            <div class="case-title-cell">
              <span class="case-title-text" style="font-weight: 600;" title="${escapeHTML(df.title)}">${escapeHTML(df.title)}</span>
              ${externalLinkHtml}
            </div>
          </td>
          <td>
            <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary);">${escapeHTML(df.projectName)}</span>
          </td>
          <td>
            ${linkedTestHtml}
          </td>
          <td>
            <span class="priority-badge ${sevClass}">${escapeHTML(displaySeverity)}</span>
          </td>
          <td>
            <span class="status-badge ${statusClass}">${escapeHTML(df.status)}</span>
          </td>
          <td style="font-size: 0.78rem; color: var(--text-muted);">
            <span title="${formatDisplayDateTime(df.createdAt)}">${formatRelativeTime(df.createdAt)}</span>
          </td>
          <td style="text-align: right;">
            <div style="display: inline-flex; align-items: center; gap: 4px;">
              <button type="button" class="btn btn-secondary btn-xs btn-view-defect" data-project-id="${escapeHTML(df.projectId)}" data-defect-id="${escapeHTML(df.id)}" title="View complete defect report">
                <span>View</span>
              </button>
              <button type="button" class="icon-btn btn-edit-defect" data-project-id="${escapeHTML(df.projectId)}" data-defect-id="${escapeHTML(df.id)}" title="Edit defect specifications">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
              <button type="button" class="icon-btn btn-delete-defect" data-project-id="${escapeHTML(df.projectId)}" data-defect-id="${escapeHTML(df.id)}" title="Delete defect" style="color: var(--color-red);">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    DOM.defectsTableContainer.innerHTML = html;

    // Attach Action Listeners
    DOM.defectsTableContainer.querySelectorAll('.btn-view-defect').forEach(btn => {
      btn.addEventListener('click', () => {
        const pId = btn.getAttribute('data-project-id');
        const dId = btn.getAttribute('data-defect-id');
        if (pId && dId) openDefectViewModal(pId, dId);
      });
    });

    DOM.defectsTableContainer.querySelectorAll('.btn-edit-defect').forEach(btn => {
      btn.addEventListener('click', () => {
        const pId = btn.getAttribute('data-project-id');
        const dId = btn.getAttribute('data-defect-id');
        if (pId && dId) openDefectModal(pId, dId);
      });
    });

    DOM.defectsTableContainer.querySelectorAll('.btn-delete-defect').forEach(btn => {
      btn.addEventListener('click', () => {
        const pId = btn.getAttribute('data-project-id');
        const dId = btn.getAttribute('data-defect-id');
        if (pId && dId) requestUniversalDelete('defect', dId, pId);
      });
    });

    DOM.defectsTableContainer.querySelectorAll('.btn-inspect-linked-test').forEach(badge => {
      badge.addEventListener('click', () => {
        const pId = badge.getAttribute('data-project-id');
        const sId = badge.getAttribute('data-suite-id');
        const cId = badge.getAttribute('data-case-id');
        if (!pId || !cId) return;
        const resolved = resolveProjectCaseContext(pId, cId);
        if (!resolved) {
          showToast(`Linked test case "${cId}" could not be found or has been deleted.`, 'warning');
          return;
        }
        openTestCaseViewModal(resolved.project.id, sId || resolved.suite.id, resolved.testCase.id);
      });
    });
  }

  function resetDefectFilters() {
    State.defectSearchQuery = '';
    State.defectSeverityFilter = 'ALL';
    State.defectStatusFilter = 'ALL';
    State.defectSortBy = 'newest';

    if (DOM.defectsSearchInput) DOM.defectsSearchInput.value = '';
    if (DOM.defectsFilterSeverity) DOM.defectsFilterSeverity.value = 'ALL';
    if (DOM.defectsFilterStatus) DOM.defectsFilterStatus.value = 'ALL';
    if (DOM.defectsSortBy) DOM.defectsSortBy.value = 'newest';

    renderDefectsWorkspace();
  }

  // ==========================================================================
  // Prompt 4: Create / Edit Defect Modal
  // ==========================================================================
  function openDefectModal(projectId = null, defectId = null, optLinkedCaseId = null) {
    if (!DOM.defectModal) return;

    const projects = Storage.getProjects();
    if (projects.length === 0) {
      showToast('Create a project before creating defects.', 'error');
      return;
    }

    if (DOM.defectForm) DOM.defectForm.reset();
    hideDefectError();

    // Mode: Edit vs Create
    if (defectId) {
      const requestedProjId = (projectId && projectId !== 'ALL') ? projectId : null;
      let origProj = requestedProjId
        ? projects.find(p => p.id === requestedProjId && (p.defects || []).some(d => d.id === defectId))
        : null;
      if (!origProj) {
        origProj = projects.find(p => (p.defects || []).some(d => d.id === defectId)) || null;
      }
      const df = origProj ? (origProj.defects || []).find(d => d.id === defectId) : null;
      if (!origProj || !df) {
        showToast('Defect could not be found.', 'error');
        return;
      }

      const selectedProjectId = origProj.id;

      // Populate Project Select Field with real projects only (never 'ALL')
      if (DOM.defectProjectSelectField) {
        DOM.defectProjectSelectField.innerHTML = projects.map(p =>
          `<option value="${escapeHTML(p.id)}" ${p.id === selectedProjectId ? 'selected' : ''}>${escapeHTML(p.name)}</option>`
        ).join('');
        DOM.defectProjectSelectField.value = selectedProjectId;
      }

      const existingLinkedCaseId = (df.testCaseId !== undefined && df.testCaseId !== null)
        ? String(df.testCaseId).trim()
        : '';
      updateDefectModalCasesDropdown(selectedProjectId, existingLinkedCaseId);

      if (DOM.defectIdInput) DOM.defectIdInput.value = df.id;
      if (DOM.defectProjectIdInput) DOM.defectProjectIdInput.value = origProj.id;
      if (DOM.defectModalTitle) DOM.defectModalTitle.textContent = `Edit Defect (${df.id})`;
      if (DOM.defectModalSubtitle) DOM.defectModalSubtitle.textContent = 'Update bug details, severity, status, and reproduction steps';
      if (DOM.defectModalSubmitText) DOM.defectModalSubmitText.textContent = 'Save Changes';

      if (DOM.defectTitleInput) DOM.defectTitleInput.value = df.title || '';
      if (DOM.defectSeveritySelect) DOM.defectSeveritySelect.value = classifyDefectPriority(df) || 'Medium';
      if (DOM.defectStatusSelect) DOM.defectStatusSelect.value = df.status || 'Open';
      if (DOM.defectStepsInput) DOM.defectStepsInput.value = df.stepsToReproduce || '';
      if (DOM.defectExpectedInput) DOM.defectExpectedInput.value = df.expectedResult || '';
      if (DOM.defectActualInput) DOM.defectActualInput.value = df.actualResult || '';
      if (DOM.defectDescInput) DOM.defectDescInput.value = df.description || '';
      if (DOM.defectUrlInput) DOM.defectUrlInput.value = df.externalIssueUrl || '';
    } else {
      // Create Mode: treat 'ALL' as UI scope, never as a project ID (QAV-ISS-007)
      const candidateProjectId = (projectId && projectId !== 'ALL')
        ? projectId
        : (State.activeDefectsProjectId && State.activeDefectsProjectId !== 'ALL'
            ? State.activeDefectsProjectId
            : null);
      const resolvedProj = (candidateProjectId && projects.find(p => p.id === candidateProjectId)) || projects[0];
      const selectedProjectId = resolvedProj.id;

      // Populate Project Select Field with real projects only
      if (DOM.defectProjectSelectField) {
        DOM.defectProjectSelectField.innerHTML = projects.map(p =>
          `<option value="${escapeHTML(p.id)}" ${p.id === selectedProjectId ? 'selected' : ''}>${escapeHTML(p.name)}</option>`
        ).join('');
        DOM.defectProjectSelectField.value = selectedProjectId;
      }

      // Populate Linked Test Case Select Field for the resolved real project
      updateDefectModalCasesDropdown(selectedProjectId, optLinkedCaseId);

      if (DOM.defectIdInput) DOM.defectIdInput.value = '';
      if (DOM.defectProjectIdInput) DOM.defectProjectIdInput.value = selectedProjectId;
      if (DOM.defectModalTitle) DOM.defectModalTitle.textContent = 'Create Defect';
      if (DOM.defectModalSubtitle) DOM.defectModalSubtitle.textContent = 'Document software bug, attach reproduction steps, and link test case';
      if (DOM.defectModalSubmitText) DOM.defectModalSubmitText.textContent = 'Save Defect';

      if (DOM.defectSeveritySelect) DOM.defectSeveritySelect.value = 'High';
      if (DOM.defectStatusSelect) DOM.defectStatusSelect.value = 'Open';
    }

    DOM.defectModal.classList.add('open');
    DOM.defectModal.setAttribute('aria-hidden', 'false');

    setTimeout(() => {
      if (DOM.defectTitleInput) DOM.defectTitleInput.focus();
    }, 100);
  }

  function updateDefectModalCasesDropdown(projectId, selectedCaseId = null) {
    if (!DOM.defectLinkedCaseSelect) return;

    const normalizedCaseId = (selectedCaseId !== undefined && selectedCaseId !== null)
      ? String(selectedCaseId).trim()
      : '';
    const projects = Storage.getProjects();
    const proj = (projectId && projectId !== 'ALL')
      ? projects.find(p => p.id === projectId)
      : null;

    let optHtml = '<option value="">None (Independent defect)</option>';
    let matchedCaseId = '';

    if (proj) {
      (proj.testSuites || []).forEach(suite => {
        (suite.testCases || []).forEach(tc => {
          const isSelected = Boolean(normalizedCaseId && normalizedCaseId === tc.id);
          if (isSelected) matchedCaseId = tc.id;
          optHtml += `<option value="${escapeHTML(tc.id)}" ${isSelected ? 'selected' : ''}>${escapeHTML(tc.id)}: ${escapeHTML(tc.title)}</option>`;
        });
      });
    }

    DOM.defectLinkedCaseSelect.innerHTML = optHtml;
    DOM.defectLinkedCaseSelect.value = matchedCaseId;
  }

  function closeDefectModal() {
    if (!DOM.defectModal) return;
    DOM.defectModal.classList.remove('open');
    DOM.defectModal.setAttribute('aria-hidden', 'true');
    hideDefectError();
  }

  function showDefectError(msg) {
    if (DOM.defectErrorAlert && DOM.defectErrorText) {
      DOM.defectErrorText.textContent = msg;
      DOM.defectErrorAlert.style.display = 'flex';
    }
  }

  function hideDefectError() {
    if (DOM.defectErrorAlert) DOM.defectErrorAlert.style.display = 'none';
  }

  function restoreProjectsInPlace(targetArray, snapshotArray) {
    targetArray.length = 0;
    snapshotArray.forEach(item => targetArray.push(item));
  }

  function handleSaveDefectSubmit(e) {
    e.preventDefault();

    const defectId = DOM.defectIdInput ? DOM.defectIdInput.value.trim() : '';
    const originalProjectIdInput = DOM.defectProjectIdInput ? DOM.defectProjectIdInput.value.trim() : '';
    const targetProjectId = DOM.defectProjectSelectField ? DOM.defectProjectSelectField.value.trim() : '';
    const title = DOM.defectTitleInput ? DOM.defectTitleInput.value.trim() : '';
    const severity = DOM.defectSeveritySelect ? DOM.defectSeveritySelect.value : 'Medium';
    const status = DOM.defectStatusSelect ? DOM.defectStatusSelect.value : 'Open';
    const linkedCaseId = DOM.defectLinkedCaseSelect ? DOM.defectLinkedCaseSelect.value.trim() : '';
    const steps = DOM.defectStepsInput ? DOM.defectStepsInput.value.trim() : '';
    const expected = DOM.defectExpectedInput ? DOM.defectExpectedInput.value.trim() : '';
    const actual = DOM.defectActualInput ? DOM.defectActualInput.value.trim() : '';
    const description = DOM.defectDescInput ? DOM.defectDescInput.value.trim() : '';
    const url = DOM.defectUrlInput ? DOM.defectUrlInput.value.trim() : '';

    if (!title) {
      showDefectError('Defect Title is required.');
      if (DOM.defectTitleInput) DOM.defectTitleInput.focus();
      return;
    }

    if (!targetProjectId || targetProjectId === 'ALL') {
      showDefectError('Please select a valid project for this defect.');
      return;
    }

    const projects = Storage.getProjects();
    const targetProject = projects.find(p => p.id === targetProjectId);
    if (!targetProject) {
      showDefectError('Selected project does not exist.');
      return;
    }

    // Validate linked Test Case belongs to the selected target project if specified (QAV-ISS-006 & QAV-ISS-007)
    let targetCaseCtx = null;
    if (linkedCaseId) {
      targetCaseCtx = resolveProjectCaseContext(targetProject.id, linkedCaseId, projects);
      if (!targetCaseCtx) {
        showDefectError('Selected linked test case does not exist in the selected project.');
        return;
      }
    }

    // Capture full pre-mutation snapshot for atomic rollback if storage write fails
    const preMutationSnapshot = JSON.parse(JSON.stringify(projects));
    const nowIso = new Date().toISOString();

    if (!Array.isArray(targetProject.defects)) targetProject.defects = [];

    if (defectId) {
      // Locate original project containing defectId (QAV-ISS-006)
      let originalProject = (originalProjectIdInput && originalProjectIdInput !== 'ALL')
        ? projects.find(p => p.id === originalProjectIdInput && (p.defects || []).some(d => d.id === defectId))
        : null;
      if (!originalProject) {
        originalProject = projects.find(p => (p.defects || []).some(d => d.id === defectId)) || null;
      }
      const df = originalProject ? (originalProject.defects || []).find(d => d.id === defectId) : null;
      if (!originalProject || !df) {
        showDefectError('The defect being edited could not be found in storage.');
        return;
      }

      // 1. Remove stale defectId from any previously linked Test Cases across projects
      projects.forEach(p => {
        (p.testSuites || []).forEach(s => {
          (s.testCases || []).forEach(tc => {
            if (!Array.isArray(tc.defectIds)) return;
            const isNewTargetCase = (p.id === targetProject.id && linkedCaseId && tc.id === linkedCaseId);
            if (!isNewTargetCase && tc.defectIds.includes(defectId)) {
              tc.defectIds = tc.defectIds.filter(id => id !== defectId);
            }
          });
        });
      });

      // 2. If moving defect to a different project, transfer record cleanly without duplication
      if (originalProject.id !== targetProject.id) {
        originalProject.defects = (originalProject.defects || []).filter(d => d.id !== defectId);
        (originalProject.executions || []).forEach(ex => {
          if (Array.isArray(ex.defectIds) && ex.defectIds.includes(defectId)) {
            ex.defectIds = ex.defectIds.filter(id => id !== defectId);
          }
        });
        if (df.executionId) {
          df.executionId = '';
        }
        originalProject.updatedAt = nowIso;

        // Ensure no duplicate in targetProject.defects before inserting
        targetProject.defects = targetProject.defects.filter(d => d.id !== defectId);
        targetProject.defects.unshift(df);
      }

      // 3. Update defect fields while preserving ID, createdAt, and any unrelated properties
      df.title = title;
      df.priority = severity;
      df.severity = severity;
      df.status = status;
      df.testCaseId = linkedCaseId;
      df.stepsToReproduce = steps;
      df.expectedResult = expected;
      df.actualResult = actual;
      df.description = description;
      df.externalIssueUrl = url;
      df.updatedAt = nowIso;

      // 4. Add defectId to newly linked Test Case in targetProject if specified
      if (targetCaseCtx && targetCaseCtx.testCase) {
        if (!Array.isArray(targetCaseCtx.testCase.defectIds)) {
          targetCaseCtx.testCase.defectIds = [];
        }
        if (!targetCaseCtx.testCase.defectIds.includes(defectId)) {
          targetCaseCtx.testCase.defectIds.unshift(defectId);
        }
      }

      targetProject.updatedAt = nowIso;
      const saveRes = Storage.saveProjects(projects);
      if (!saveRes.ok) {
        restoreProjectsInPlace(projects, preMutationSnapshot);
        showDefectError(saveRes.error || 'Failed to save defect to storage.');
        return;
      }

      Storage.addActivity('Updated defect', `${df.id}: ${title}`);
      showToast(`Defect ${df.id} updated!`, 'success');
      closeDefectModal();
    } else {
      // Create new defect
      const newId = generateUniqueDefectId(projects);

      const newDefect = {
        id: newId,
        testCaseId: linkedCaseId,
        executionId: '',
        title: title,
        description: description,
        priority: severity,
        severity: severity,
        status: status,
        stepsToReproduce: steps,
        expectedResult: expected,
        actualResult: actual,
        externalIssueUrl: url,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      targetProject.defects.unshift(newDefect);

      // Link to test case in targetProject if specified
      if (targetCaseCtx && targetCaseCtx.testCase) {
        if (!Array.isArray(targetCaseCtx.testCase.defectIds)) {
          targetCaseCtx.testCase.defectIds = [];
        }
        if (!targetCaseCtx.testCase.defectIds.includes(newId)) {
          targetCaseCtx.testCase.defectIds.unshift(newId);
        }
      }

      targetProject.updatedAt = nowIso;
      const saveRes = Storage.saveProjects(projects);
      if (!saveRes.ok) {
        restoreProjectsInPlace(projects, preMutationSnapshot);
        showDefectError(saveRes.error || 'Failed to save defect to storage.');
        return;
      }

      Storage.addActivity('Created defect', `${newId}: ${title}`);
      addNotification({
        title: `Defect Logged: ${newId}`,
        message: `"${title}" logged with ${severity} severity in "${targetProject.name}".`,
        type: 'defect',
        link: { view: 'defects', projectId: targetProject.id, defectId: newId }
      });
      showToast(`Defect ${newId} logged!`, 'success');
      closeDefectModal();
    }

    renderDefectsWorkspace();
    renderDashboard();
    renderTestExecutionWorkspace();
    renderReportsWorkspace();

    if (State.currentView === 'project-details' && State.currentDetailProjectId) {
      const updatedDetailProj = Storage.getProjects().find(p => p.id === State.currentDetailProjectId);
      if (updatedDetailProj) renderProjectDetailsData(updatedDetailProj);
    }
  }

  // ==========================================================================
  // Prompt 4: Defect Inspection & Quick Status View Modal
  // ==========================================================================
  function openDefectViewModal(projectId, defectId) {
    if (!DOM.defectViewModal || !defectId) return;

    const projects = Storage.getProjects();
    let project = (projectId && projectId !== 'ALL')
      ? projects.find(p => p.id === projectId && (p.defects || []).some(d => d.id === defectId))
      : null;
    if (!project) {
      project = projects.find(p => (p.defects || []).some(d => d.id === defectId)) || null;
    }
    if (!project) return;

    const df = (project.defects || []).find(d => d.id === defectId);
    if (!df) return;

    DOM.defectViewModal.setAttribute('data-project-id', project.id);
    DOM.defectViewModal.setAttribute('data-defect-id', df.id);

    if (DOM.viewDefectId) DOM.viewDefectId.textContent = df.id;
    if (DOM.viewDefectTitle) DOM.viewDefectTitle.textContent = df.title;

    if (DOM.viewDefectSeverity) {
      const prioCategory = classifyDefectPriority(df);
      DOM.viewDefectSeverity.className = `priority-badge ${getPriorityBadgeClass(prioCategory || df.severity || df.priority)}`;
      DOM.viewDefectSeverity.textContent = prioCategory || df.severity || df.priority || 'Unassigned';
    }

    if (DOM.viewDefectStatus) {
      DOM.viewDefectStatus.className = `status-badge ${getDefectStatusBadgeClass(df.status)}`;
      DOM.viewDefectStatus.textContent = df.status;
    }

    if (DOM.viewDefectProjectBadge) {
      DOM.viewDefectProjectBadge.textContent = project.name;
    }

    if (DOM.viewDefectStatusSelect) {
      DOM.viewDefectStatusSelect.value = df.status || 'Open';
      DOM.viewDefectStatusSelect.onchange = (e) => {
        updateDefectQuickStatus(project.id, df.id, e.target.value);
      };
    }

    if (DOM.viewDefectLinkedCase) {
      const hasLinkedTest = df.testCaseId !== undefined && df.testCaseId !== null && String(df.testCaseId).trim() !== '';
      const linkedCaseIdStr = hasLinkedTest ? String(df.testCaseId).trim() : '';
      const resolvedLinked = hasLinkedTest ? resolveProjectCaseContext(project.id, linkedCaseIdStr, projects) : null;

      if (!hasLinkedTest) {
        DOM.viewDefectLinkedCase.textContent = 'None (Independent)';
        DOM.viewDefectLinkedCase.style.cursor = 'default';
        DOM.viewDefectLinkedCase.onclick = null;
      } else if (resolvedLinked) {
        DOM.viewDefectLinkedCase.textContent = linkedCaseIdStr;
        DOM.viewDefectLinkedCase.style.cursor = 'pointer';
        DOM.viewDefectLinkedCase.onclick = () => {
          const latestCtx = resolveProjectCaseContext(project.id, linkedCaseIdStr);
          if (!latestCtx) {
            showToast(`Linked test case "${linkedCaseIdStr}" could not be found or has been deleted.`, 'warning');
            return;
          }
          closeDefectViewModal();
          openTestCaseViewModal(latestCtx.project.id, latestCtx.suite.id, latestCtx.testCase.id);
        };
      } else {
        DOM.viewDefectLinkedCase.textContent = `${linkedCaseIdStr} (Unavailable)`;
        DOM.viewDefectLinkedCase.style.cursor = 'not-allowed';
        DOM.viewDefectLinkedCase.onclick = () => {
          showToast(`Linked test case "${linkedCaseIdStr}" could not be found in project "${project.name}".`, 'warning');
        };
      }
    }

    if (DOM.viewDefectSteps) {
      DOM.viewDefectSteps.textContent = df.stepsToReproduce || 'No reproduction steps provided.';
    }

    if (DOM.viewDefectExpected) {
      DOM.viewDefectExpected.textContent = df.expectedResult || 'No expected result recorded.';
    }

    if (DOM.viewDefectActual) {
      DOM.viewDefectActual.textContent = df.actualResult || 'No actual result recorded.';
    }

    if (DOM.viewDefectDesc) {
      DOM.viewDefectDesc.textContent = df.description || 'No additional notes.';
    }

    if (DOM.viewDefectUrlWrap && DOM.viewDefectUrlLink && DOM.viewDefectUrlText) {
      const safeUrl = sanitizeExternalUrl(df.externalIssueUrl);
      if (safeUrl) {
        DOM.viewDefectUrlWrap.style.display = 'block';
        DOM.viewDefectUrlLink.href = safeUrl;
        DOM.viewDefectUrlText.textContent = safeUrl;
      } else {
        DOM.viewDefectUrlWrap.style.display = 'none';
        DOM.viewDefectUrlLink.removeAttribute('href');
        DOM.viewDefectUrlText.textContent = '';
      }
    }

    if (DOM.viewDefectCreated) DOM.viewDefectCreated.textContent = `Created ${formatDisplayDateTime(df.createdAt)}`;
    if (DOM.viewDefectUpdated) DOM.viewDefectUpdated.textContent = `Updated ${formatRelativeTime(df.updatedAt)}`;

    if (DOM.viewDefectEditBtn) {
      DOM.viewDefectEditBtn.onclick = () => {
        closeDefectViewModal();
        openDefectModal(project.id, df.id);
      };
    }

    DOM.defectViewModal.classList.add('open');
    DOM.defectViewModal.setAttribute('aria-hidden', 'false');
  }

  function closeDefectViewModal() {
    if (!DOM.defectViewModal) return;
    DOM.defectViewModal.classList.remove('open');
    DOM.defectViewModal.setAttribute('aria-hidden', 'true');
    if (DOM.viewDefectUrlLink) {
      DOM.viewDefectUrlLink.removeAttribute('href');
    }
  }

  function updateDefectQuickStatus(projectId, defectId, newStatus) {
    const projects = Storage.getProjects();
    const project = (projectId && projectId !== 'ALL')
      ? projects.find(p => p.id === projectId && (p.defects || []).some(d => d.id === defectId))
      : projects.find(p => (p.defects || []).some(d => d.id === defectId));
    if (!project) return;

    const df = (project.defects || []).find(d => d.id === defectId);
    if (!df) return;

    const oldStatus = df.status;
    if (oldStatus === newStatus) return;
    df.status = newStatus;
    df.updatedAt = new Date().toISOString();
    project.updatedAt = df.updatedAt;

    const saveRes = Storage.saveProjects(projects);
    if (!saveRes.ok) {
      df.status = oldStatus;
      return;
    }
    Storage.addActivity('Updated defect status', `${df.id} (${oldStatus} → ${newStatus})`);
    showToast(`Defect ${df.id} marked as ${newStatus}`, 'info');

    if (DOM.viewDefectStatus) {
      DOM.viewDefectStatus.className = `status-badge ${getDefectStatusBadgeClass(newStatus)}`;
      DOM.viewDefectStatus.textContent = newStatus;
    }

    renderDefectsWorkspace();
    renderDashboard();
    renderReportsWorkspace();

    if (State.currentView === 'project-details' && State.currentDetailProjectId === project.id) {
      renderProjectDetailsData(project);
    }
  }
  function requestUniversalDelete(type, targetId, parentId) {
    const projects = Storage.getProjects();

    State.pendingConfirm = { type, targetId, parentId };
    State.lastDeleteFocusedElement = document.activeElement;

    if (type === 'project') {
      const proj = projects.find(p => p.id === targetId);
      if (!proj) {
        State.pendingConfirm = null;
        console.warn('Qavora: Project not found for deletion dialog', targetId);
        showToast('Could not find project to delete.', 'error');
        return;
      }
      if (DOM.deleteDialogTitle) DOM.deleteDialogTitle.textContent = 'Delete Project';
      if (DOM.deleteProjectName) DOM.deleteProjectName.textContent = proj.name;
      if (DOM.deleteConfirmBtnText) DOM.deleteConfirmBtnText.textContent = 'Delete Project';
      if (DOM.deleteWarningMsg) {
        DOM.deleteWarningMsg.textContent = 'This action will permanently delete this project and all its associated test plans, testing phases, suites, and test cases.';
      }
    } else if (type === 'phase') {
      const proj = projects.find(p => p.id === parentId);
      const phase = (proj?.testPlan?.phases || []).find(ph => ph.id === targetId);
      if (!phase) {
        State.pendingConfirm = null;
        return;
      }

      const attachedSuites = (proj?.testSuites || []).filter(s => s.phaseId === phase.id);
      let attachedCases = 0;
      attachedSuites.forEach(s => attachedCases += (s.testCases?.length || 0));

      if (DOM.deleteDialogTitle) DOM.deleteDialogTitle.textContent = 'Delete Testing Phase';
      if (DOM.deleteProjectName) DOM.deleteProjectName.textContent = `phase "${phase.name}"`;
      if (DOM.deleteConfirmBtnText) DOM.deleteConfirmBtnText.textContent = 'Delete Phase';
      if (DOM.deleteWarningMsg) {
        DOM.deleteWarningMsg.textContent = `Deleting this phase will also delete all ${attachedSuites.length} test suites and ${attachedCases} test cases attached to it.`;
      }
    } else if (type === 'suite') {
      const proj = projects.find(p => p.id === parentId);
      const suite = (proj?.testSuites || []).find(s => s.id === targetId);
      if (!suite) {
        State.pendingConfirm = null;
        return;
      }

      const casesCount = (suite.testCases || []).length;

      if (DOM.deleteDialogTitle) DOM.deleteDialogTitle.textContent = 'Delete Test Suite';
      if (DOM.deleteProjectName) DOM.deleteProjectName.textContent = `suite "${suite.name}"`;
      if (DOM.deleteConfirmBtnText) DOM.deleteConfirmBtnText.textContent = 'Delete Suite';
      if (DOM.deleteWarningMsg) {
        DOM.deleteWarningMsg.textContent = `Deleting this suite will permanently delete all ${casesCount} individual test cases inside it.`;
      }
    } else if (type === 'case') {
      const proj = projects.find(p => (p.testSuites || []).some(s => s.id === parentId)) || projects.find(p => p.id === State.activePlanProjectId);
      const suite = (proj?.testSuites || []).find(s => s.id === parentId);
      const tc = (suite?.testCases || []).find(c => c.id === targetId);
      if (!tc) {
        State.pendingConfirm = null;
        return;
      }

      if (DOM.deleteDialogTitle) DOM.deleteDialogTitle.textContent = 'Delete Test Case';
      if (DOM.deleteProjectName) DOM.deleteProjectName.textContent = `${tc.id} (${tc.title})`;
      if (DOM.deleteConfirmBtnText) DOM.deleteConfirmBtnText.textContent = 'Delete Test Case';
      if (DOM.deleteWarningMsg) {
        DOM.deleteWarningMsg.textContent = 'This test case and its verification steps will be permanently removed.';
      }
    } else if (type === 'defect') {
      const proj = (parentId && parentId !== 'ALL')
        ? projects.find(p => p.id === parentId && (p.defects || []).some(d => d.id === targetId))
        : projects.find(p => (p.defects || []).some(d => d.id === targetId));
      const df = (proj?.defects || []).find(d => d.id === targetId);
      if (!df) {
        State.pendingConfirm = null;
        return;
      }

      if (DOM.deleteDialogTitle) DOM.deleteDialogTitle.textContent = 'Delete Defect';
      if (DOM.deleteProjectName) DOM.deleteProjectName.textContent = `${df.id}: ${df.title}`;
      if (DOM.deleteConfirmBtnText) DOM.deleteConfirmBtnText.textContent = 'Delete Defect';
      if (DOM.deleteWarningMsg) {
        DOM.deleteWarningMsg.textContent = 'This defect record will be permanently deleted and unlinked from associated test cases and test execution runs.';
      }
    }

    if (DOM.deleteConfirmBtn) {
      DOM.deleteConfirmBtn.disabled = false;
    }

    if (DOM.deleteModal) {
      DOM.deleteModal.classList.add('open');
      DOM.deleteModal.setAttribute('aria-hidden', 'false');
    }

    setTimeout(() => {
      if (DOM.deleteCancelBtn) {
        DOM.deleteCancelBtn.focus();
      }
    }, 0);
  }

  function closeDeleteModal() {
    if (!DOM.deleteModal) return;
    DOM.deleteModal.classList.remove('open');
    DOM.deleteModal.setAttribute('aria-hidden', 'true');
    State.pendingConfirm = null;
    if (DOM.deleteConfirmBtn) {
      DOM.deleteConfirmBtn.disabled = false;
    }
    const prevFocus = State.lastDeleteFocusedElement;
    State.lastDeleteFocusedElement = null;
    if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) {
      prevFocus.focus();
    }
  }

  function executeUniversalDelete() {
    if (!State.pendingConfirm) return;
    if (DOM.deleteConfirmBtn) {
      DOM.deleteConfirmBtn.disabled = true;
    }

    try {
      const { type, targetId, parentId } = State.pendingConfirm;

      const projects = Storage.getProjects();

    if (type === 'project') {
      const targetProj = projects.find(p => p.id === targetId);
      if (!targetProj) {
        console.error('Qavora: Project deletion failed - project ID not found in storage:', targetId);
        showToast('Failed to delete project: Project not found.', 'error');
        closeDeleteModal();
        return;
      }

      const deletedDefectIds = new Set((targetProj.defects || []).map(d => d.id));
      const updated = projects.filter(p => p.id !== targetId);
      if (deletedDefectIds.size > 0) {
        updated.forEach(p => {
          (p.executions || []).forEach(ex => {
            if (Array.isArray(ex.defectIds)) ex.defectIds = ex.defectIds.filter(id => !deletedDefectIds.has(id));
          });
          (p.testSuites || []).forEach(s => {
            (s.testCases || []).forEach(tc => {
              if (Array.isArray(tc.defectIds)) tc.defectIds = tc.defectIds.filter(id => !deletedDefectIds.has(id));
            });
          });
        });
      }
      const saveRes = Storage.saveProjects(updated);
      if (!saveRes.ok) {
        return;
      }
      Storage.addActivity('Deleted project', targetProj.name || targetId);
      showToast(`Project deleted.`, 'info');

      // Reliably clear active-project references across all workspaces
      if (State.currentDetailProjectId === targetId) {
        State.currentDetailProjectId = null;
        if (State.currentView === 'project-details') {
          switchView('projects');
        }
      }

      if (State.activePlanProjectId === targetId) {
        State.activePlanProjectId = updated.length > 0 ? updated[0].id : null;
        State.activeSuiteId = null;
      }

      if (State.activeExecProjectId === targetId) {
        State.activeExecProjectId = updated.length > 0 ? updated[0].id : null;
        State.execPhaseFilter = 'ALL';
        State.execSuiteFilter = 'ALL';
      }

      if (State.activeDefectsProjectId === targetId) {
        State.activeDefectsProjectId = 'ALL';
      }

      if (State.reportsProjectId === targetId) {
        State.reportsProjectId = 'ALL';
      }

      if (State.modalExecContext && State.modalExecContext.projectId === targetId) {
        State.modalExecContext = null;
        if (typeof closeExecutionModal === 'function') {
          closeExecutionModal();
        }
      }
    } else if (type === 'phase') {
      const project = projects.find(p => p.id === parentId);
      if (project && project.testPlan?.phases) {
        const ph = project.testPlan.phases.find(x => x.id === targetId);
        project.testPlan.phases = project.testPlan.phases.filter(x => x.id !== targetId);
        // Identify deleted test case IDs from removed suites
        const removedSuites = (project.testSuites || []).filter(s => s.phaseId === targetId);
        const deletedCaseIds = new Set();
        removedSuites.forEach(s => (s.testCases || []).forEach(c => deletedCaseIds.add(c.id)));
        project.testSuites = (project.testSuites || []).filter(s => s.phaseId !== targetId);
        // Cleanly unlink from defects
        if (Array.isArray(project.defects)) {
          project.defects.forEach(df => {
            if (deletedCaseIds.has(df.testCaseId)) {
              df.testCaseId = '';
            }
          });
        }
        project.updatedAt = new Date().toISOString();

        const saveRes = Storage.saveProjects(projects);
        if (!saveRes.ok) {
          return;
        }
        Storage.addActivity('Deleted testing phase', ph ? ph.name : targetId);
        showToast(`Phase deleted.`, 'info');
      }
    } else if (type === 'suite') {
      const project = projects.find(p => p.id === parentId);
      if (project && project.testSuites) {
        const suite = project.testSuites.find(s => s.id === targetId);
        const deletedCaseIds = new Set((suite?.testCases || []).map(c => c.id));
        project.testSuites = project.testSuites.filter(s => s.id !== targetId);
        // Cleanly unlink from defects
        if (Array.isArray(project.defects)) {
          project.defects.forEach(df => {
            if (deletedCaseIds.has(df.testCaseId)) {
              df.testCaseId = '';
            }
          });
        }
        project.updatedAt = new Date().toISOString();

        const saveRes = Storage.saveProjects(projects);
        if (!saveRes.ok) {
          return;
        }
        Storage.addActivity('Deleted test suite', suite ? suite.name : targetId);
        showToast(`Test suite deleted.`, 'info');

        if (State.activeSuiteId === targetId) {
          State.activeSuiteId = null;
        }
      }
    } else if (type === 'case') {
      const project = projects.find(p => (p.testSuites || []).some(s => s.id === parentId)) || projects.find(p => p.id === State.activePlanProjectId);
      const suite = (project?.testSuites || []).find(s => s.id === parentId);
      if (suite && suite.testCases) {
        const tc = suite.testCases.find(c => c.id === targetId);
        suite.testCases = suite.testCases.filter(c => c.id !== targetId);
        suite.updatedAt = new Date().toISOString();
        if (project) {
          project.updatedAt = new Date().toISOString();
          // Cleanly unlink from defects
          if (Array.isArray(project.defects)) {
            project.defects.forEach(df => {
              if (df.testCaseId === targetId) {
                df.testCaseId = '';
              }
            });
          }
        }

        const saveRes = Storage.saveProjects(projects);
        if (!saveRes.ok) {
          return;
        }
        Storage.addActivity('Deleted test case', tc ? tc.id : targetId);
        showToast(`Test case deleted.`, 'info');
      }
    } else if (type === 'defect') {
      const project = (parentId && parentId !== 'ALL')
        ? projects.find(p => p.id === parentId && (p.defects || []).some(d => d.id === targetId))
        : projects.find(p => (p.defects || []).some(d => d.id === targetId));
      if (project && project.defects) {
        const df = project.defects.find(d => d.id === targetId);
        project.defects = project.defects.filter(d => d.id !== targetId);
        // Cleanly unlink from all executions and test cases across projects
        projects.forEach(p => {
          (p.executions || []).forEach(ex => {
            if (Array.isArray(ex.defectIds)) ex.defectIds = ex.defectIds.filter(id => id !== targetId);
          });
          (p.testSuites || []).forEach(s => {
            (s.testCases || []).forEach(tc => {
              if (Array.isArray(tc.defectIds)) tc.defectIds = tc.defectIds.filter(id => id !== targetId);
            });
          });
        });
        project.updatedAt = new Date().toISOString();

        const saveRes = Storage.saveProjects(projects);
        if (!saveRes.ok) {
          return;
        }
        Storage.addActivity('Deleted defect', df ? `${df.id} (${df.title})` : targetId);
        showToast(`Defect deleted.`, 'info');
      }
    }

    closeDeleteModal();
    renderDashboard();
    renderMyProjects();
    renderTestPlansWorkspace();
    renderTestExecutionWorkspace();
    renderDefectsWorkspace();
    renderReportsWorkspace();

    if (State.currentView === 'project-details' && State.currentDetailProjectId) {
      const p = Storage.getProjects().find(x => x.id === State.currentDetailProjectId);
      if (p) renderProjectDetailsData(p);
    }
    } finally {
      if (DOM.deleteConfirmBtn) {
        DOM.deleteConfirmBtn.disabled = false;
      }
    }
  }

  // ==========================================================================
  // Project Creation / Editing Modal (Prompt 1 & 2)
  // ==========================================================================
  function openProjectModal(projectId = null) {
    if (!DOM.projectModal) return;

    if (DOM.createProjectForm) DOM.createProjectForm.reset();
    hideModalError();

    if (projectId) {
      const projects = Storage.getProjects();
      const project = projects.find(p => p.id === projectId);
      if (!project) return;

      if (DOM.projectIdInput) DOM.projectIdInput.value = project.id;
      if (DOM.projectNameInput) DOM.projectNameInput.value = project.name;
      if (DOM.projectTypeInput) DOM.projectTypeInput.value = project.type;
      if (DOM.projectStatusInput) DOM.projectStatusInput.value = project.status || 'Active';
      if (DOM.projectVersionInput) DOM.projectVersionInput.value = (project.version !== undefined && project.version !== null) ? String(project.version) : '';
      if (DOM.projectDescInput) DOM.projectDescInput.value = project.description || '';

      if (DOM.modalTitle) DOM.modalTitle.textContent = 'Edit Project';
      if (DOM.modalSubtitle) DOM.modalSubtitle.textContent = 'Update project specifications, status, and milestone';
      if (DOM.modalSubmitBtnText) DOM.modalSubmitBtnText.textContent = 'Save Changes';
    } else {
      if (DOM.projectIdInput) DOM.projectIdInput.value = '';
      if (DOM.projectStatusInput) DOM.projectStatusInput.value = 'Active';
      if (DOM.modalTitle) DOM.modalTitle.textContent = 'Create New Project';
      if (DOM.modalSubtitle) DOM.modalSubtitle.textContent = 'Configure testing workspace and project properties';
      if (DOM.modalSubmitBtnText) DOM.modalSubmitBtnText.textContent = 'Create Project';
    }

    DOM.projectModal.classList.add('open');
    DOM.projectModal.setAttribute('aria-hidden', 'false');

    setTimeout(() => {
      if (DOM.projectNameInput) DOM.projectNameInput.focus();
    }, 100);
  }

  function closeProjectModal() {
    if (!DOM.projectModal) return;
    DOM.projectModal.classList.remove('open');
    DOM.projectModal.setAttribute('aria-hidden', 'true');
    hideModalError();
  }

  function showModalError(message) {
    if (!DOM.modalErrorAlert || !DOM.modalErrorText) return;
    DOM.modalErrorText.textContent = message;
    DOM.modalErrorAlert.style.display = 'flex';
  }

  function hideModalError() {
    if (DOM.modalErrorAlert) DOM.modalErrorAlert.style.display = 'none';
  }

  function handleCreateOrEditProjectSubmit(e) {
    e.preventDefault();

    const existingId = DOM.projectIdInput ? DOM.projectIdInput.value.trim() : '';
    const name = DOM.projectNameInput ? DOM.projectNameInput.value.trim() : '';
    const type = DOM.projectTypeInput ? DOM.projectTypeInput.value.trim() : '';
    const status = DOM.projectStatusInput ? DOM.projectStatusInput.value.trim() : 'Active';
    const version = DOM.projectVersionInput ? DOM.projectVersionInput.value.trim() : '';
    const description = DOM.projectDescInput ? DOM.projectDescInput.value.trim() : '';

    if (!name) {
      showModalError('Project Name is required.');
      if (DOM.projectNameInput) DOM.projectNameInput.focus();
      return;
    }

    if (!type || !VALID_PROJECT_TYPES.includes(type)) {
      showModalError('Please select a valid Project Type.');
      return;
    }

    const projects = Storage.getProjects();

    if (existingId) {
      const idx = projects.findIndex(p => p.id === existingId);
      if (idx === -1) return;

      const p = projects[idx];
      const prevProjectState = {
        name: p.name,
        type: p.type,
        status: p.status,
        version: p.version,
        description: p.description,
        updatedAt: p.updatedAt
      };

      p.name = name;
      p.type = type;
      p.status = status;
      p.version = version;
      p.description = description;
      p.updatedAt = new Date().toISOString();

      const saveRes = Storage.saveProjects(projects);
      if (!saveRes.ok) {
        Object.assign(p, prevProjectState);
        showModalError(saveRes.error || 'Failed to save project changes to storage.');
        return;
      }

      Storage.addActivity('Updated project', name);
      showToast(`Project "${name}" updated.`, 'success');
      closeProjectModal();
    } else {
      const newId = 'proj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
      const newProj = {
        id: newId,
        name: name,
        type: type,
        status: status,
        version: version,
        description: description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        testCaseCount: 0,
        passedTests: 0,
        failedTests: 0,
        blockedTests: 0,
        skippedTests: 0,
        notRunTests: 0,
        executedTests: 0,
        completionRate: 0,
        passRate: 0,
        totalDefects: 0,
        openDefects: 0,
        testPlan: {
          id: 'plan_' + newId,
          name: `${name} Test Plan`,
          description: '',
          objective: '',
          scope: '',
          notes: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          phases: []
        },
        testSuites: [],
        executions: [],
        defects: []
      };

      projects.unshift(newProj);

      const saveRes = Storage.saveProjects(projects);
      if (!saveRes.ok) {
        projects.shift();
        showModalError(saveRes.error || 'Failed to save new project to storage.');
        return;
      }

      Storage.addActivity('Created new project', name);
      addNotification({
        title: 'Project Created',
        message: `Project "${name}" was successfully initialized.`,
        type: 'project',
        link: { view: 'project-details', projectId: newId }
      });
      showToast(`Project "${name}" created!`, 'success');
      closeProjectModal();
    }

    renderDashboard();
    renderMyProjects();
    renderTestPlansWorkspace();
    renderTestExecutionWorkspace();
    renderDefectsWorkspace();
    renderReportsWorkspace();

    if (State.currentView === 'project-details' && State.currentDetailProjectId === existingId) {
      const p = projects.find(x => x.id === existingId);
      if (p) renderProjectDetailsData(p);
    }
  }

  // ==========================================================================
  // Prompt 5: Advanced Reports, Analytics & QA Insights Engine
  // ==========================================================================

  function getFilteredReportsData() {
    const allProjects = Storage.getProjects();
    const targetProjects = State.reportsProjectId === 'ALL'
      ? allProjects
      : allProjects.filter(p => p.id === State.reportsProjectId);

    // Compute Date Range Cutoffs
    let minTime = null;
    let maxTime = null;
    const now = new Date();

    if (State.reportsDateRange === '7D') {
      minTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (State.reportsDateRange === '30D') {
      minTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (State.reportsDateRange === '90D') {
      minTime = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    } else if (State.reportsDateRange === 'CUSTOM') {
      if (State.reportsCustomStartDate) {
        minTime = new Date(State.reportsCustomStartDate + 'T00:00:00');
      }
      if (State.reportsCustomEndDate) {
        maxTime = new Date(State.reportsCustomEndDate + 'T23:59:59');
      }
    }

    function isDateInFilter(isoStr) {
      if (!isoStr) return false;
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return false;
      if (minTime && d < minTime) return false;
      if (maxTime && d > maxTime) return false;
      return true;
    }

    // Collect all cases, suites, phases
    let totalCases = 0;
    const allCases = [];
    const allSuites = [];
    const allPhases = [];

    targetProjects.forEach(p => {
      const planPhases = p.testPlan?.phases || [];
      planPhases.forEach(ph => {
        allPhases.push({ ...ph, projectId: p.id, projectName: p.name });
      });

      (p.testSuites || []).forEach(s => {
        const ph = planPhases.find(x => x.id === s.phaseId);
        allSuites.push({
          ...s,
          projectId: p.id,
          projectName: p.name,
          phaseName: ph ? ph.name : 'Default Phase'
        });

        (s.testCases || []).forEach(tc => {
          totalCases++;
          allCases.push({
            ...tc,
            projectId: p.id,
            projectName: p.name,
            suiteId: s.id,
            suiteName: s.name,
            phaseId: s.phaseId,
            phaseName: ph ? ph.name : 'Default Phase'
          });
        });
      });
    });

    // Collect and filter executions
    const allExecutions = [];
    targetProjects.forEach(p => {
      (p.executions || []).forEach(ex => {
        allExecutions.push({ ...ex, projectId: p.id, projectName: p.name });
      });
    });

    const filteredExecutions = State.reportsDateRange === 'ALL'
      ? allExecutions
      : allExecutions.filter(ex => isDateInFilter(ex.executedAt));

    // Sort executions by date descending
    filteredExecutions.sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime());

    // Collect and filter defects
    const allDefects = [];
    targetProjects.forEach(p => {
      (p.defects || []).forEach(df => {
        allDefects.push({ ...df, projectId: p.id, projectName: p.name });
      });
    });

    const filteredDefects = State.reportsDateRange === 'ALL'
      ? allDefects
      : allDefects.filter(df => isDateInFilter(df.createdAt));

    // Calculate unique executed test cases
    const executedCaseIdSet = new Set();
    filteredExecutions.forEach(ex => {
      if (ex.testCaseId) executedCaseIdSet.add(ex.testCaseId);
    });

    // If All Time is selected, also consider current test case status !== 'Not Run'
    if (State.reportsDateRange === 'ALL') {
      allCases.forEach(tc => {
        if (tc.status && tc.status !== 'Not Run') {
          executedCaseIdSet.add(tc.id);
        }
      });
    }

    const executedCasesCount = Math.min(totalCases, executedCaseIdSet.size);
    const notRunCasesCount = Math.max(0, totalCases - executedCasesCount);
    const completionRate = totalCases > 0 ? Math.round((executedCasesCount / totalCases) * 100) : 0;

    // Execution counts
    const totalExecutions = filteredExecutions.length;
    let passedExecs = 0;
    let failedExecs = 0;
    let blockedExecs = 0;
    let skippedExecs = 0;

    filteredExecutions.forEach(ex => {
      if (ex.status === 'Pass') passedExecs++;
      else if (ex.status === 'Fail') failedExecs++;
      else if (ex.status === 'Blocked') blockedExecs++;
      else if (ex.status === 'Skipped') skippedExecs++;
    });

    const passRate = totalExecutions > 0 ? Math.round((passedExecs / totalExecutions) * 100) : 0;
    const failRate = totalExecutions > 0 ? Math.round((failedExecs / totalExecutions) * 100) : 0;

    // Defect counts
    const totalDefects = filteredDefects.length;
    let openDefects = 0;
    let inProgressDefects = 0;
    let resolvedDefects = 0;
    let closedDefects = 0;
    let reopenedDefects = 0;

    let criticalDefects = 0;
    let highDefects = 0;
    let mediumDefects = 0;
    let lowDefects = 0;
    let unclassifiedDefects = 0;

    let activeCriticalDefects = 0;
    let activeHighDefects = 0;
    let activeMediumDefects = 0;
    let activeLowDefects = 0;

    filteredDefects.forEach(d => {
      const status = d.status || 'Open';
      if (status === 'Open') openDefects++;
      else if (status === 'In Progress') inProgressDefects++;
      else if (status === 'Resolved') resolvedDefects++;
      else if (status === 'Closed') closedDefects++;
      else if (status === 'Reopened') reopenedDefects++;

      const isActive = ['Open', 'In Progress', 'Reopened'].includes(status);
      const prioCategory = classifyDefectPriority(d);

      if (prioCategory === 'Critical') {
        criticalDefects++;
        if (isActive) activeCriticalDefects++;
      } else if (prioCategory === 'High') {
        highDefects++;
        if (isActive) activeHighDefects++;
      } else if (prioCategory === 'Medium') {
        mediumDefects++;
        if (isActive) activeMediumDefects++;
      } else if (prioCategory === 'Low') {
        lowDefects++;
        if (isActive) activeLowDefects++;
      } else {
        unclassifiedDefects++;
      }
    });

    const activeDefects = openDefects + inProgressDefects + reopenedDefects;
    const resolvedTotal = resolvedDefects + closedDefects;
    const defectFixRate = totalDefects > 0 ? Math.round((resolvedTotal / totalDefects) * 100) : 0;

    return {
      allProjects,
      targetProjects,
      totalCases,
      allCases,
      allSuites,
      allPhases,
      filteredExecutions,
      executedCaseIdSet,
      executedCasesCount,
      notRunCasesCount,
      completionRate,
      totalExecutions,
      passedExecs,
      failedExecs,
      blockedExecs,
      skippedExecs,
      passRate,
      failRate,
      filteredDefects,
      totalDefects,
      openDefects,
      inProgressDefects,
      resolvedDefects,
      closedDefects,
      reopenedDefects,
      activeDefects,
      resolvedTotal,
      criticalDefects,
      highDefects,
      mediumDefects,
      lowDefects,
      unclassifiedDefects,
      activeCriticalDefects,
      activeHighDefects,
      activeMediumDefects,
      activeLowDefects,
      defectFixRate
    };
  }

  function renderReportsWorkspace() {
    const projects = Storage.getProjects();

    if (
      !State.reportsProjectId ||
      (State.reportsProjectId !== 'ALL' && !projects.some(p => p.id === State.reportsProjectId))
    ) {
      State.reportsProjectId = 'ALL';
    }

    // 1. Populate Projects Selector
    if (DOM.reportsProjectSelect) {
      let optionsHtml = '<option value="ALL">All Projects (Combined)</option>';
      projects.forEach(p => {
        const hasVer = p.version !== undefined && p.version !== null && String(p.version).trim() !== '';
        optionsHtml += `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)} (${hasVer ? escapeHTML(String(p.version)) : escapeHTML(p.type)})</option>`;
      });
      DOM.reportsProjectSelect.innerHTML = optionsHtml;
      DOM.reportsProjectSelect.value = State.reportsProjectId;
    }

    // 2. Sync Date Filter Dropdown
    if (DOM.reportsDateFilter) {
      DOM.reportsDateFilter.value = State.reportsDateRange || 'ALL';
    }

    if (DOM.reportsCustomDates) {
      DOM.reportsCustomDates.style.display = State.reportsDateRange === 'CUSTOM' ? 'flex' : 'none';
      if (DOM.reportsDateStart && State.reportsCustomStartDate) {
        DOM.reportsDateStart.value = State.reportsCustomStartDate;
      }
      if (DOM.reportsDateEnd && State.reportsCustomEndDate) {
        DOM.reportsDateEnd.value = State.reportsCustomEndDate;
      }
    }

    // 3. Handle Empty Projects Guard State
    if (projects.length === 0) {
      if (DOM.reportsNoProjectsView) DOM.reportsNoProjectsView.style.display = 'block';
      if (DOM.reportsMainContent) DOM.reportsMainContent.style.display = 'none';
      return;
    }

    if (DOM.reportsNoProjectsView) DOM.reportsNoProjectsView.style.display = 'none';
    if (DOM.reportsMainContent) DOM.reportsMainContent.style.display = 'block';

    // 4. Compute Aggregate Data
    const data = getFilteredReportsData();

    // 5. Render All Components
    renderReportsKPIs(data);
    renderReportsInsights(data);
    renderReportsDonutChart(data);
    renderReportsTrendChart(data);
    renderReportsDailyTable(data);
    renderReportsPhaseCoverage(data);
    renderReportsPriorityDistribution(data);
    renderReportsSuiteCoverage(data);
    renderReportsDefectAnalytics(data);
    renderReportsRecentActivity(data);
  }

  function renderReportsKPIs(data) {
    if (DOM.repKpiTotalCases) DOM.repKpiTotalCases.textContent = data.totalCases.toString();
    if (DOM.repKpiTotalExecs) DOM.repKpiTotalExecs.textContent = data.totalExecutions.toString();
    if (DOM.repKpiExecutedCases) DOM.repKpiExecutedCases.textContent = data.executedCasesCount.toString();
    if (DOM.repKpiExecutedRatio) {
      DOM.repKpiExecutedRatio.textContent = `${data.executedCasesCount} of ${data.totalCases} cases (${data.completionRate}%)`;
    }
    if (DOM.repKpiNotrunCases) DOM.repKpiNotrunCases.textContent = data.notRunCasesCount.toString();

    if (DOM.repKpiPassedExecs) DOM.repKpiPassedExecs.textContent = data.passedExecs.toString();
    if (DOM.repKpiPassedRate) DOM.repKpiPassedRate.textContent = `${data.passRate}% pass rate`;

    if (DOM.repKpiFailedExecs) DOM.repKpiFailedExecs.textContent = data.failedExecs.toString();
    if (DOM.repKpiFailedRate) DOM.repKpiFailedRate.textContent = `${data.failRate}% failure rate`;

    if (DOM.repKpiBlockedExecs) DOM.repKpiBlockedExecs.textContent = data.blockedExecs.toString();
    if (DOM.repKpiSkippedExecs) DOM.repKpiSkippedExecs.textContent = data.skippedExecs.toString();

    if (DOM.repKpiTotalDefects) DOM.repKpiTotalDefects.textContent = data.totalDefects.toString();
    if (DOM.repKpiOpenDefects) DOM.repKpiOpenDefects.textContent = data.activeDefects.toString();
    if (DOM.repKpiCriticalDefects) {
      DOM.repKpiCriticalDefects.textContent = `${data.activeCriticalDefects} critical blocker${data.activeCriticalDefects === 1 ? '' : 's'}`;
    }
    if (DOM.repKpiResolvedDefects) DOM.repKpiResolvedDefects.textContent = data.resolvedTotal.toString();
    if (DOM.repKpiDefectFixRate) DOM.repKpiDefectFixRate.textContent = `${data.defectFixRate}% resolution rate`;
  }

  function renderReportsInsights(data) {
    if (!DOM.reportsInsightsContainer) return;

    const insights = [];

    // Rule 1: Critical Defect Release Blockers
    if (data.activeCriticalDefects > 0) {
      insights.push({
        severity: 'critical',
        badge: 'Critical Blocker',
        title: `${data.activeCriticalDefects} Critical Defect(s) Active`,
        text: `${data.activeCriticalDefects} critical severity defect(s) require immediate remediation before release approval.`,
        action: 'Review Defect Tracking workspace to assign and resolve urgent defects.'
      });
    }

    // Rule 2: Execution Coverage Status
    if (data.totalCases === 0) {
      insights.push({
        severity: 'info',
        badge: 'Setup Needed',
        title: 'No Test Cases Registered',
        text: 'Create test suites and write manual test cases to build test coverage for this project scope.',
        action: 'Open Test Plans & Suites to define testing architecture.'
      });
    } else if (data.completionRate < 50) {
      insights.push({
        severity: 'warning',
        badge: 'Low Coverage',
        title: `Low Execution Coverage (${data.completionRate}%)`,
        text: `${data.notRunCasesCount} out of ${data.totalCases} test cases have not yet been executed in this cycle.`,
        action: 'Schedule manual testing runs in the Test Execution workspace.'
      });
    } else if (data.completionRate >= 90) {
      insights.push({
        severity: 'success',
        badge: 'High Coverage',
        title: `Comprehensive Coverage (${data.completionRate}%)`,
        text: 'Over 90% of test cases have been executed and verified in active testing runs.',
        action: 'Ready for final sign-off and regression verification.'
      });
    }

    // Rule 3: Pass Rate & Stability
    if (data.totalExecutions > 0 && data.passRate >= 85 && data.activeCriticalDefects === 0) {
      insights.push({
        severity: 'success',
        badge: 'Stable Build',
        title: `High Testing Stability (${data.passRate}% Pass Rate)`,
        text: `${data.passedExecs} passing test executions recorded with zero active critical release blockers.`,
        action: 'Milestone quality criteria currently satisfied.'
      });
    } else if (data.totalExecutions > 0 && data.failRate >= 25) {
      insights.push({
        severity: 'warning',
        badge: 'Elevated Failures',
        title: `Elevated Failure Rate (${data.failRate}%)`,
        text: `${data.failedExecs} failed executions recorded. Potential regression or unstable features detected.`,
        action: 'Inspect recent failed executions and verify defect links.'
      });
    }

    // Rule 4: Suite Bottleneck Concentration
    let worstSuite = null;
    let worstSuiteFailCount = 0;
    data.allSuites.forEach(s => {
      const suiteExecs = data.filteredExecutions.filter(ex => ex.suiteId === s.id);
      const suiteFails = suiteExecs.filter(ex => ex.status === 'Fail').length;
      if (suiteFails > worstSuiteFailCount) {
        worstSuiteFailCount = suiteFails;
        worstSuite = { ...s, failCount: suiteFails, totalExecs: suiteExecs.length };
      }
    });

    if (worstSuite && worstSuiteFailCount >= 2) {
      const suiteFailPct = Math.round((worstSuite.failCount / worstSuite.totalExecs) * 100);
      insights.push({
        severity: 'warning',
        badge: 'Component Risk',
        title: `Suite Hotspot: ${escapeHTML(worstSuite.name)}`,
        text: `${worstSuite.failCount} failures (${suiteFailPct}% failure rate) logged in "${escapeHTML(worstSuite.name)}".`,
        action: 'Focus engineering fixes and exploratory QA on this functional area.'
      });
    }

    // Rule 5: Blocked Tests Hold
    if (data.blockedExecs > 0) {
      insights.push({
        severity: 'warning',
        badge: 'Execution Blocked',
        title: `${data.blockedExecs} Blocked Execution Run(s)`,
        text: 'Testing activities are blocked by environment instability, missing test data, or third-party dependencies.',
        action: 'Resolve external dependencies to unblock test case execution.'
      });
    }

    // Fallback info insight if quiet
    if (insights.length === 0) {
      insights.push({
        severity: 'info',
        badge: 'QA Assessment',
        title: 'Testing Activities Normal',
        text: 'All recorded test executions and defect metrics indicate active, healthy manual testing operations.',
        action: 'Continue executing planned test suites across all target environments.'
      });
    }

    // Update Overall QA Health Badge
    if (DOM.repHealthStatusBadge) {
      if (data.activeCriticalDefects > 0) {
        DOM.repHealthStatusBadge.className = 'report-health-badge health-danger';
        DOM.repHealthStatusBadge.textContent = 'QA Assessment: Critical Blockers';
      } else if (data.failRate > 25 || data.completionRate < 40 || data.activeDefects >= 5) {
        DOM.repHealthStatusBadge.className = 'report-health-badge health-warning';
        DOM.repHealthStatusBadge.textContent = 'QA Assessment: Attention Needed';
      } else {
        DOM.repHealthStatusBadge.className = 'report-health-badge health-good';
        DOM.repHealthStatusBadge.textContent = 'QA Assessment: Stable Progress';
      }
    }

    // Render insight cards
    let html = '';
    insights.forEach(ins => {
      let iconSvg = '';
      if (ins.severity === 'critical') {
        iconSvg = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        `;
      } else if (ins.severity === 'warning') {
        iconSvg = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        `;
      } else if (ins.severity === 'success') {
        iconSvg = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        `;
      } else {
        iconSvg = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
        `;
      }

      html += `
        <div class="insight-card severity-${ins.severity}">
          <div class="insight-icon-bubble">
            ${iconSvg}
          </div>
          <div class="insight-content">
            <div class="insight-title-row">
              <span class="insight-title">${escapeHTML(ins.title)}</span>
              <span class="insight-badge">${escapeHTML(ins.badge)}</span>
            </div>
            <p class="insight-text">${escapeHTML(ins.text)}</p>
            <div class="insight-action-hint">Tip: ${escapeHTML(ins.action)}</div>
          </div>
        </div>
      `;
    });

    DOM.reportsInsightsContainer.innerHTML = html;
  }

  function renderReportsDonutChart(data) {
    if (!DOM.repDonutSvg || !DOM.repDonutLegend) return;

    if (DOM.repDonutTag) {
      DOM.repDonutTag.textContent = `${data.totalExecutions} Total Run${data.totalExecutions === 1 ? '' : 's'}`;
    }

    if (DOM.repDonutCenterVal) {
      DOM.repDonutCenterVal.textContent = `${data.passRate}%`;
    }

    const C = 2 * Math.PI * 60; // 376.9911
    let svgHtml = '';

    if (data.totalExecutions === 0) {
      svgHtml = `<circle cx="90" cy="90" r="60" class="donut-segment-bg" />`;
    } else {
      svgHtml = `<circle cx="90" cy="90" r="60" class="donut-segment-bg" />`;

      const segments = [
        { label: 'Pass', count: data.passedExecs, color: 'var(--color-green)' },
        { label: 'Fail', count: data.failedExecs, color: 'var(--color-red)' },
        { label: 'Blocked', count: data.blockedExecs, color: 'var(--color-amber)' },
        { label: 'Skipped', count: data.skippedExecs, color: 'var(--color-purple)' }
      ];

      let offset = 0;
      segments.forEach(seg => {
        if (seg.count > 0) {
          const dash = (seg.count / data.totalExecutions) * C;
          const pct = Math.round((seg.count / data.totalExecutions) * 100);
          svgHtml += `
            <circle
              cx="90"
              cy="90"
              r="60"
              class="donut-segment"
              stroke="${seg.color}"
              stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}"
              stroke-dashoffset="${(-offset).toFixed(2)}"
            >
              <title>${seg.label}: ${seg.count} (${pct}%)</title>
            </circle>
          `;
          offset += dash;
        }
      });
    }

    DOM.repDonutSvg.innerHTML = svgHtml;

    // Render Donut Legend
    const items = [
      { label: 'Passed', count: data.passedExecs, colorClass: 'dot-pass' },
      { label: 'Failed', count: data.failedExecs, colorClass: 'dot-fail' },
      { label: 'Blocked', count: data.blockedExecs, colorClass: 'dot-blocked' },
      { label: 'Skipped', count: data.skippedExecs, colorClass: 'dot-skipped' }
    ];

    let legendHtml = '';
    items.forEach(it => {
      const pct = data.totalExecutions > 0
        ? Math.round((it.count / data.totalExecutions) * 100)
        : 0;
      legendHtml += `
        <div class="donut-legend-item">
          <div class="donut-legend-left">
            <span class="donut-legend-dot ${it.colorClass}"></span>
            <span>${it.label}</span>
          </div>
          <div class="donut-legend-right">
            <span>${it.count}</span>
            <span class="donut-legend-pct">(${pct}%)</span>
          </div>
        </div>
      `;
    });

    DOM.repDonutLegend.innerHTML = legendHtml;
  }

  function renderReportsTrendChart(data) {
    if (!DOM.repTrendSvg) return;

    if (DOM.repTrendTotalSummary) {
      DOM.repTrendTotalSummary.textContent = `${data.totalExecutions} executions recorded across selected timeline`;
    }

    // Group executions by date
    const dateMap = {};
    data.filteredExecutions.forEach(ex => {
      try {
        const dStr = ex.executedAt ? ex.executedAt.substring(0, 10) : '';
        if (dStr) {
          if (!dateMap[dStr]) {
            dateMap[dStr] = { date: dStr, total: 0, pass: 0, fail: 0, blocked: 0, skipped: 0 };
          }
          dateMap[dStr].total++;
          if (ex.status === 'Pass') dateMap[dStr].pass++;
          else if (ex.status === 'Fail') dateMap[dStr].fail++;
          else if (ex.status === 'Blocked') dateMap[dStr].blocked++;
          else if (ex.status === 'Skipped') dateMap[dStr].skipped++;
        }
      } catch {}
    });

    const dates = Object.keys(dateMap).sort();

    // If 0 dates or only 1 date, pad with recent days so the SVG chart is always visually informative
    if (dates.length < 5) {
      const now = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const iso = d.toISOString().substring(0, 10);
        if (!dateMap[iso]) {
          dateMap[iso] = { date: iso, total: 0, pass: 0, fail: 0, blocked: 0, skipped: 0 };
        }
      }
    }

    const chartDates = Object.keys(dateMap).sort();
    let maxVal = 1;
    chartDates.forEach(d => {
      if (dateMap[d].total > maxVal) maxVal = dateMap[d].total;
    });

    // SVG coordinates
    const width = 540;
    const height = 220;
    const padLeft = 40;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 35;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    let svgHtml = '';

    // Draw horizontal grid lines (3 tiers)
    const tiers = [0, Math.ceil(maxVal / 2), maxVal];
    tiers.forEach(tVal => {
      const y = (padTop + plotH) - (tVal / maxVal) * plotH;
      svgHtml += `
        <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" class="trend-grid-line" />
        <text x="${padLeft - 8}" y="${y + 3}" text-anchor="end" class="trend-axis-text">${tVal}</text>
      `;
    });

    const totalPoints = [];
    const passPoints = [];
    const failPoints = [];

    const numPoints = chartDates.length;
    chartDates.forEach((dKey, idx) => {
      const x = padLeft + (numPoints > 1 ? (idx / (numPoints - 1)) * plotW : plotW / 2);
      const info = dateMap[dKey];

      const yTotal = (padTop + plotH) - (info.total / maxVal) * plotH;
      const yPass = (padTop + plotH) - (info.pass / maxVal) * plotH;
      const yFail = (padTop + plotH) - (info.fail / maxVal) * plotH;

      totalPoints.push({ x, y: yTotal, info });
      passPoints.push({ x, y: yPass, info });
      failPoints.push({ x, y: yFail, info });

      // Draw X axis label for select points to prevent overlap
      if (numPoints <= 7 || idx === 0 || idx === numPoints - 1 || idx % Math.ceil(numPoints / 6) === 0) {
        try {
          const dObj = new Date(dKey + 'T12:00:00');
          const lbl = dObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          svgHtml += `
            <text x="${x}" y="${height - 10}" text-anchor="middle" class="trend-axis-text">${lbl}</text>
          `;
        } catch {
          svgHtml += `
            <text x="${x}" y="${height - 10}" text-anchor="middle" class="trend-axis-text">${dKey.substring(5)}</text>
          `;
        }
      }
    });

    // Area under total polyline
    if (totalPoints.length > 0) {
      const areaPolygon = [
        `${padLeft},${padTop + plotH}`,
        ...totalPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
        `${width - padRight},${padTop + plotH}`
      ].join(' ');

      svgHtml += `<polygon points="${areaPolygon}" fill="var(--accent-primary)" class="trend-area" />`;
    }

    // Polylines
    const totalLinePoints = totalPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const passLinePoints = passPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const failLinePoints = failPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    svgHtml += `<polyline points="${totalLinePoints}" class="trend-polyline" stroke="var(--accent-primary)" />`;
    svgHtml += `<polyline points="${passLinePoints}" class="trend-polyline" stroke="var(--color-green)" />`;
    svgHtml += `<polyline points="${failLinePoints}" class="trend-polyline" stroke="var(--color-red)" />`;

    // Data points dots with tooltips
    totalPoints.forEach(p => {
      svgHtml += `
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="var(--bg-card)" stroke="var(--accent-primary)" class="trend-dot">
          <title>${p.info.date}: ${p.info.total} total runs (${p.info.pass} pass, ${p.info.fail} fail)</title>
        </circle>
      `;
    });

    passPoints.forEach(p => {
      if (p.info.pass > 0) {
        svgHtml += `
          <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="var(--bg-card)" stroke="var(--color-green)" class="trend-dot">
            <title>${p.info.date}: ${p.info.pass} passed</title>
          </circle>
        `;
      }
    });

    failPoints.forEach(p => {
      if (p.info.fail > 0) {
        svgHtml += `
          <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="var(--bg-card)" stroke="var(--color-red)" class="trend-dot">
            <title>${p.info.date}: ${p.info.fail} failed</title>
          </circle>
        `;
      }
    });

    DOM.repTrendSvg.innerHTML = svgHtml;
  }

  function renderReportsDailyTable(data) {
    if (!DOM.repDailyTableContainer) return;

    // Group by date
    const dateMap = {};
    data.filteredExecutions.forEach(ex => {
      const dStr = ex.executedAt ? ex.executedAt.substring(0, 10) : 'Unknown';
      if (!dateMap[dStr]) {
        dateMap[dStr] = { date: dStr, total: 0, pass: 0, fail: 0, blocked: 0, skipped: 0 };
      }
      dateMap[dStr].total++;
      if (ex.status === 'Pass') dateMap[dStr].pass++;
      else if (ex.status === 'Fail') dateMap[dStr].fail++;
      else if (ex.status === 'Blocked') dateMap[dStr].blocked++;
      else if (ex.status === 'Skipped') dateMap[dStr].skipped++;
    });

    const dates = Object.keys(dateMap).sort().reverse();

    if (DOM.repDailyCounter) {
      DOM.repDailyCounter.textContent = `${dates.length} active day${dates.length === 1 ? '' : 's'}`;
    }

    if (dates.length === 0) {
      DOM.repDailyTableContainer.innerHTML = `
        <div class="empty-state" style="padding: 32px 16px;">
          <h4 class="empty-state-title">No execution activity for this period</h4>
          <p class="empty-state-desc">Test runs executed in the selected project or date range will appear here daily.</p>
        </div>
      `;
      return;
    }

    let html = `
      <table class="cases-table">
        <thead>
          <tr>
            <th style="width: 160px;">Date</th>
            <th style="width: 120px;">Executions</th>
            <th style="width: 100px;">Passed</th>
            <th style="width: 100px;">Failed</th>
            <th style="width: 100px;">Blocked</th>
            <th style="width: 100px;">Skipped</th>
            <th>Daily Pass Rate</th>
          </tr>
        </thead>
        <tbody>
    `;

    dates.forEach(dKey => {
      const row = dateMap[dKey];
      const pRate = row.total > 0 ? Math.round((row.pass / row.total) * 100) : 0;
      let displayDate = dKey;
      try {
        const dObj = new Date(dKey + 'T12:00:00');
        displayDate = dObj.toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
      } catch {}

      html += `
        <tr>
          <td>
            <strong>${escapeHTML(displayDate)}</strong>
          </td>
          <td>
            <span class="project-badge badge-saas">${row.total} run${row.total === 1 ? '' : 's'}</span>
          </td>
          <td>
            <span class="status-badge status-pass">${row.pass}</span>
          </td>
          <td>
            <span class="status-badge ${row.fail > 0 ? 'status-fail' : 'status-notrun'}">${row.fail}</span>
          </td>
          <td>
            <span class="status-badge ${row.blocked > 0 ? 'status-blocked' : 'status-notrun'}">${row.blocked}</span>
          </td>
          <td>
            <span class="status-badge ${row.skipped > 0 ? 'status-skipped' : 'status-notrun'}">${row.skipped}</span>
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-weight: 700; width: 40px;">${pRate}%</span>
              <div class="progress-bar-track" style="flex: 1; height: 6px; margin: 0;">
                <div class="progress-bar-fill" style="width: ${pRate}%;"></div>
              </div>
            </div>
          </td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;

    DOM.repDailyTableContainer.innerHTML = html;
  }

  function renderReportsPhaseCoverage(data) {
    if (!DOM.repPhasesTableContainer) return;

    if (DOM.repPhasesCounter) {
      DOM.repPhasesCounter.textContent = `${data.allPhases.length} phase${data.allPhases.length === 1 ? '' : 's'}`;
    }

    if (data.allPhases.length === 0) {
      DOM.repPhasesTableContainer.innerHTML = `
        <div class="empty-state" style="padding: 24px 16px;">
          <h4 class="empty-state-title">No testing phases configured</h4>
          <p class="empty-state-desc">Define testing phases in the Test Plans workspace to track phase-level verification.</p>
        </div>
      `;
      return;
    }

    let html = `
      <table class="cases-table">
        <thead>
          <tr>
            <th>Testing Phase</th>
            <th style="width: 80px;">Suites</th>
            <th style="width: 80px;">Cases</th>
            <th style="width: 80px;">Executed</th>
            <th style="width: 140px;">Completion</th>
          </tr>
        </thead>
        <tbody>
    `;

    data.allPhases.forEach(ph => {
      const suitesInPhase = data.allSuites.filter(s => s.phaseId === ph.id);
      const casesInPhase = data.allCases.filter(c => c.phaseId === ph.id);

      const executedInPhase = casesInPhase.filter(c => data.executedCaseIdSet.has(c.id)).length;
      const pct = casesInPhase.length > 0 ? Math.round((executedInPhase / casesInPhase.length) * 100) : 0;

      html += `
        <tr>
          <td>
            <div style="font-weight: 600;">${escapeHTML(ph.name)}</div>
            ${State.reportsProjectId === 'ALL' ? `<div style="font-size: 0.6875rem; color: var(--text-muted);">${escapeHTML(ph.projectName)}</div>` : ''}
          </td>
          <td>${suitesInPhase.length}</td>
          <td><strong>${casesInPhase.length}</strong></td>
          <td><span class="text-green" style="font-weight: 600;">${executedInPhase}</span></td>
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 0.75rem; font-weight: 700; width: 34px;">${pct}%</span>
              <div class="progress-bar-track" style="flex: 1; height: 6px; margin: 0;">
                <div class="progress-bar-fill" style="width: ${pct}%;"></div>
              </div>
            </div>
          </td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;

    DOM.repPhasesTableContainer.innerHTML = html;
  }

  function renderReportsPriorityDistribution(data) {
    if (!DOM.repPriorityContainer) return;

    const priorities = ['Critical', 'High', 'Medium', 'Low'];

    let html = '<div class="priority-breakdown-list">';

    priorities.forEach(prio => {
      const cases = data.allCases.filter(c => classifyPriority(c.priority) === prio);
      const total = cases.length;

      let pass = 0;
      let fail = 0;
      let blocked = 0;
      let skipped = 0;
      let notrun = 0;

      cases.forEach(c => {
        if (c.status === 'Pass') pass++;
        else if (c.status === 'Fail') fail++;
        else if (c.status === 'Blocked') blocked++;
        else if (c.status === 'Skipped') skipped++;
        else notrun++;
      });

      const passRate = total > 0 ? Math.round((pass / total) * 100) : 0;

      const pPct = total > 0 ? (pass / total) * 100 : 0;
      const fPct = total > 0 ? (fail / total) * 100 : 0;
      const bPct = total > 0 ? (blocked / total) * 100 : 0;
      const sPct = total > 0 ? (skipped / total) * 100 : 0;
      const nPct = total > 0 ? (notrun / total) * 100 : 0;

      const prioClass = getPriorityBadgeClass(prio);

      html += `
        <div class="priority-row-item">
          <div class="priority-row-header">
            <div class="priority-row-label">
              <span class="priority-badge ${prioClass}">${escapeHTML(prio)}</span>
              <span style="font-weight: 700;">${total} cases</span>
            </div>
            <div class="priority-row-counts">
              <span class="text-green">${pass}P</span> •
              <span class="text-red">${fail}F</span> •
              <span class="text-amber">${blocked}B</span> •
              <span class="text-muted">${notrun} Not Run</span>
              <span style="font-weight: 700; margin-left: 6px;">(${passRate}% pass)</span>
            </div>
          </div>
          <div class="priority-bar-track" title="${prio}: ${pass} Passed, ${fail} Failed, ${blocked} Blocked, ${notrun} Not Run">
            <div class="pbar-seg-pass" style="width: ${pPct}%;"></div>
            <div class="pbar-seg-fail" style="width: ${fPct}%;"></div>
            <div class="pbar-seg-blocked" style="width: ${bPct}%;"></div>
            <div class="pbar-seg-skipped" style="width: ${sPct}%;"></div>
            <div class="pbar-seg-notrun" style="width: ${nPct}%;"></div>
          </div>
        </div>
      `;
    });

    html += '</div>';
    DOM.repPriorityContainer.innerHTML = html;
  }

  function renderReportsSuiteCoverage(data) {
    if (!DOM.repSuitesTableContainer) return;

    if (DOM.repSuitesCounter) {
      DOM.repSuitesCounter.textContent = `${data.allSuites.length} suite${data.allSuites.length === 1 ? '' : 's'}`;
    }

    if (data.allSuites.length === 0) {
      DOM.repSuitesTableContainer.innerHTML = `
        <div class="empty-state" style="padding: 32px 16px;">
          <h4 class="empty-state-title">No test suites registered</h4>
          <p class="empty-state-desc">Create test suites in the Test Plans workspace to populate coverage analytics.</p>
        </div>
      `;
      return;
    }

    let html = `
      <table class="cases-table">
        <thead>
          <tr>
            <th>Suite Name</th>
            <th style="width: 140px;">Phase</th>
            <th style="width: 80px;">Cases</th>
            <th style="width: 80px;">Executed</th>
            <th style="width: 70px;">Pass</th>
            <th style="width: 70px;">Fail</th>
            <th style="width: 70px;">Block</th>
            <th style="width: 140px;">Completion</th>
            <th style="width: 120px;">Status</th>
          </tr>
        </thead>
        <tbody>
    `;

    data.allSuites.forEach(s => {
      const cases = s.testCases || [];
      const totalCases = cases.length;

      let pass = 0;
      let fail = 0;
      let blocked = 0;
      let skipped = 0;

      cases.forEach(c => {
        if (c.status === 'Pass') pass++;
        else if (c.status === 'Fail') fail++;
        else if (c.status === 'Blocked') blocked++;
        else if (c.status === 'Skipped') skipped++;
      });

      const executed = pass + fail + blocked + skipped;
      const pct = totalCases > 0 ? Math.round((executed / totalCases) * 100) : 0;

      let statusBadge = '<span class="status-badge status-notrun">Not Started</span>';
      if (totalCases === 0) {
        statusBadge = '<span class="status-badge status-notrun">Empty</span>';
      } else if (fail > 0) {
        statusBadge = `<span class="status-badge status-fail">${fail} Defect${fail === 1 ? '' : 's'}</span>`;
      } else if (blocked > 0) {
        statusBadge = '<span class="status-badge status-blocked">Blocked</span>';
      } else if (executed === totalCases) {
        statusBadge = '<span class="status-badge status-pass">100% Passed</span>';
      } else if (executed > 0) {
        statusBadge = '<span class="status-badge status-progress">In Progress</span>';
      }

      html += `
        <tr>
          <td>
            <div style="font-weight: 600;">${escapeHTML(s.name)}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHTML(s.category || 'Functional')}</div>
          </td>
          <td>
            <span class="project-badge badge-web">${escapeHTML(s.phaseName)}</span>
          </td>
          <td><strong>${totalCases}</strong></td>
          <td>${executed}</td>
          <td><span class="text-green">${pass}</span></td>
          <td><span class="${fail > 0 ? 'text-red' : 'text-muted'}">${fail}</span></td>
          <td><span class="${blocked > 0 ? 'text-amber' : 'text-muted'}">${blocked}</span></td>
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 0.75rem; font-weight: 700; width: 34px;">${pct}%</span>
              <div class="progress-bar-track" style="flex: 1; height: 6px; margin: 0;">
                <div class="progress-bar-fill" style="width: ${pct}%;"></div>
              </div>
            </div>
          </td>
          <td>${statusBadge}</td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;

    DOM.repSuitesTableContainer.innerHTML = html;
  }

  function renderReportsDefectAnalytics(data) {
    if (DOM.repDefectsBreakdownContainer) {
      let breakdownHtml = `
        <div class="defect-breakdown-wrapper">
          <div class="defect-summary-pills">
            <div class="defect-pill">
              <div class="defect-pill-val text-red">${data.activeCriticalDefects}</div>
              <div class="defect-pill-lbl">Critical Blockers</div>
            </div>
            <div class="defect-pill">
              <div class="defect-pill-val text-amber">${data.activeDefects}</div>
              <div class="defect-pill-lbl">Active Unresolved</div>
            </div>
            <div class="defect-pill">
              <div class="defect-pill-val text-green">${data.defectFixRate}%</div>
              <div class="defect-pill-lbl">Fix / Verify Rate</div>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--text-secondary);">
              Defects by Priority
            </div>
            <div class="priority-row-item">
              <div class="priority-row-header">
                <span style="color: var(--color-red); font-weight: 600;">Critical Priority</span>
                <span style="font-weight: 700;">${data.criticalDefects}</span>
              </div>
              <div class="progress-bar-track" style="height: 6px; margin: 0;">
                <div class="progress-bar-fill" style="width: ${data.totalDefects > 0 ? (data.criticalDefects / data.totalDefects) * 100 : 0}%; background: var(--color-red);"></div>
              </div>
            </div>
            <div class="priority-row-item">
              <div class="priority-row-header">
                <span style="color: var(--color-amber); font-weight: 600;">High Priority</span>
                <span style="font-weight: 700;">${data.highDefects}</span>
              </div>
              <div class="progress-bar-track" style="height: 6px; margin: 0;">
                <div class="progress-bar-fill" style="width: ${data.totalDefects > 0 ? (data.highDefects / data.totalDefects) * 100 : 0}%; background: var(--color-amber);"></div>
              </div>
            </div>
            <div class="priority-row-item">
              <div class="priority-row-header">
                <span style="color: var(--color-blue); font-weight: 600;">Medium Priority</span>
                <span style="font-weight: 700;">${data.mediumDefects}</span>
              </div>
              <div class="progress-bar-track" style="height: 6px; margin: 0;">
                <div class="progress-bar-fill" style="width: ${data.totalDefects > 0 ? (data.mediumDefects / data.totalDefects) * 100 : 0}%; background: var(--color-blue);"></div>
              </div>
            </div>
            <div class="priority-row-item">
              <div class="priority-row-header">
                <span style="color: var(--text-muted); font-weight: 600;">Low Priority</span>
                <span style="font-weight: 700;">${data.lowDefects}</span>
              </div>
              <div class="progress-bar-track" style="height: 6px; margin: 0;">
                <div class="progress-bar-fill" style="width: ${data.totalDefects > 0 ? (data.lowDefects / data.totalDefects) * 100 : 0}%; background: var(--text-muted);"></div>
              </div>
            </div>
            ${data.unclassifiedDefects > 0 ? `
            <div class="priority-row-item">
              <div class="priority-row-header">
                <span style="color: var(--text-secondary); font-weight: 600;">Unclassified Priority</span>
                <span style="font-weight: 700;">${data.unclassifiedDefects}</span>
              </div>
              <div class="progress-bar-track" style="height: 6px; margin: 0;">
                <div class="progress-bar-fill" style="width: ${data.totalDefects > 0 ? (data.unclassifiedDefects / data.totalDefects) * 100 : 0}%; background: var(--border-color);"></div>
              </div>
            </div>
            ` : ''}
          </div>
        </div>
      `;
      DOM.repDefectsBreakdownContainer.innerHTML = breakdownHtml;
    }

    if (DOM.repDefectsTableContainer) {
      if (DOM.repDefectsTableCounter) {
        DOM.repDefectsTableCounter.textContent = `${data.filteredDefects.length} defect${data.filteredDefects.length === 1 ? '' : 's'}`;
      }

      if (data.filteredDefects.length === 0) {
        DOM.repDefectsTableContainer.innerHTML = `
          <div class="empty-state" style="padding: 24px 16px;">
            <h4 class="empty-state-title">No defects recorded</h4>
            <p class="empty-state-desc">Zero defects found in this project scope and timeline.</p>
          </div>
        `;
        return;
      }

      let html = `
        <table class="cases-table">
          <thead>
            <tr>
              <th style="width: 80px;">ID</th>
              <th>Defect Title</th>
              <th style="width: 100px;">Priority</th>
              <th style="width: 100px;">Status</th>
              <th style="width: 70px; text-align: center;">Action</th>
            </tr>
          </thead>
          <tbody>
      `;

      // Sort defects: Active first, then by priority weight (Critical > High > Medium > Low), then recency
      const priorityWeights = { Critical: 4, High: 3, Medium: 2, Low: 1 };
      const sortedDefects = [...data.filteredDefects].sort((a, b) => {
        const aActive = ['Open', 'In Progress', 'Reopened'].includes(a.status) ? 1 : 0;
        const bActive = ['Open', 'In Progress', 'Reopened'].includes(b.status) ? 1 : 0;
        if (bActive !== aActive) return bActive - aActive;

        const aPrio = priorityWeights[classifyDefectPriority(a)] || 0;
        const bPrio = priorityWeights[classifyDefectPriority(b)] || 0;
        if (bPrio !== aPrio) return bPrio - aPrio;

        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      sortedDefects.slice(0, 10).forEach(df => {
        const prioCategory = classifyDefectPriority(df);
        const sevClass = getPriorityBadgeClass(prioCategory || df.priority || df.severity);
        const statClass = getDefectStatusBadgeClass(df.status);
        const displayPriority = prioCategory || df.priority || df.severity || 'Unassigned';

        html += `
          <tr>
            <td>
              <span class="testcase-id-badge">${escapeHTML(df.id)}</span>
            </td>
            <td>
              <div style="font-weight: 600;" title="${escapeHTML(df.title)}">${escapeHTML(df.title)}</div>
              ${(df.testCaseId !== undefined && df.testCaseId !== null && String(df.testCaseId).trim() !== '') ? `<div style="font-size: 0.6875rem; color: var(--text-muted);">Linked: ${escapeHTML(String(df.testCaseId))}</div>` : ''}
            </td>
            <td>
              <span class="priority-badge ${sevClass}">${escapeHTML(displayPriority)}</span>
            </td>
            <td>
              <span class="status-badge ${statClass}">${escapeHTML(df.status)}</span>
            </td>
            <td style="text-align: center;">
              <button class="btn btn-ghost btn-xs rep-view-defect-btn" data-proj="${escapeHTML(df.projectId)}" data-id="${escapeHTML(df.id)}">
                View
              </button>
            </td>
          </tr>
        `;
      });

      html += `
          </tbody>
        </table>
      `;

      DOM.repDefectsTableContainer.innerHTML = html;

      DOM.repDefectsTableContainer.querySelectorAll('.rep-view-defect-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const pId = btn.getAttribute('data-proj');
          const dId = btn.getAttribute('data-id');
          if (pId && dId) openDefectViewModal(pId, dId);
        });
      });
    }
  }

  function renderReportsRecentActivity(data) {
    if (!DOM.repActivityTableContainer) return;

    if (DOM.repActivityCounter) {
      DOM.repActivityCounter.textContent = `${data.filteredExecutions.length} run${data.filteredExecutions.length === 1 ? '' : 's'}`;
    }

    if (data.filteredExecutions.length === 0) {
      DOM.repActivityTableContainer.innerHTML = `
        <div class="empty-state" style="padding: 32px 16px;">
          <h4 class="empty-state-title">No test runs executed yet</h4>
          <p class="empty-state-desc">Run test cases from the Test Execution Workspace to generate an execution history log.</p>
        </div>
      `;
      return;
    }

    let html = `
      <table class="cases-table">
        <thead>
          <tr>
            <th style="width: 140px;">Timestamp</th>
            <th style="width: 90px;">Case ID</th>
            <th>Test Case Title</th>
            <th style="width: 100px;">Outcome</th>
            <th style="width: 120px;">Tester</th>
            <th style="width: 140px;">Project Scope</th>
            <th style="width: 80px; text-align: center;">History</th>
          </tr>
        </thead>
        <tbody>
    `;

    data.filteredExecutions.slice(0, 15).forEach(ex => {
      const statClass = getExecutionStatusBadgeClass(ex.status);
      const caseTitleDisplay = (ex.testCaseTitle !== undefined && ex.testCaseTitle !== null && String(ex.testCaseTitle).trim() !== '')
        ? String(ex.testCaseTitle)
        : ((ex.testCaseId !== undefined && ex.testCaseId !== null) ? String(ex.testCaseId) : '');
      html += `
        <tr>
          <td>
            <div style="font-size: 0.75rem;">${formatRelativeTime(ex.executedAt)}</div>
            <div style="font-size: 0.6875rem; color: var(--text-muted);">${formatDisplayDate(ex.executedAt)}</div>
          </td>
          <td>
            <span class="testcase-id-badge">${escapeHTML(ex.testCaseId)}</span>
          </td>
          <td>
            <div style="font-weight: 600;" title="${escapeHTML(caseTitleDisplay)}">
              ${escapeHTML(caseTitleDisplay)}
            </div>
            ${ex.actualResult ? `<div style="font-size: 0.6875rem; color: var(--text-muted); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 280px;">${escapeHTML(ex.actualResult)}</div>` : ''}
          </td>
          <td>
            <span class="status-badge ${statClass}">${escapeHTML(ex.status)}</span>
          </td>
          <td>
            <span style="font-size: 0.8125rem;">${escapeHTML(ex.tester || 'QA Tester')}</span>
          </td>
          <td>
            <span class="project-badge badge-saas">${escapeHTML(ex.projectName)}</span>
          </td>
          <td style="text-align: center;">
            <button class="btn btn-ghost btn-xs rep-view-history-btn" data-proj="${escapeHTML(ex.projectId)}" data-case="${escapeHTML(ex.testCaseId)}" title="View complete run history">
              Audit
            </button>
          </td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;

    DOM.repActivityTableContainer.innerHTML = html;

    DOM.repActivityTableContainer.querySelectorAll('.rep-view-history-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pId = btn.getAttribute('data-proj');
        const cId = btn.getAttribute('data-case');
        if (pId && cId) openExecutionHistoryModal(pId, cId);
      });
    });
  }

  // ==========================================================================
  // Prompt 6: Data Management, Import/Export, Backup, CSV & Printable Reports
  // ==========================================================================

  function sanitizeFilename(name) {
    if (!name) return 'Workspace';
    return String(name).replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').substring(0, 50);
  }

  function getISODate() {
    return new Date().toISOString().split('T')[0];
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 150);
  }

  function formatCSVCell(val) {
    if (val === null || val === undefined) return '""';
    let str = String(val);
    // Formula Injection Mitigation:
    // If cell begins with =, +, -, @, \t, or \r, prefix with a single quote '
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str;
    }
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  function generateCSV(headers, rows) {
    const BOM = '\uFEFF'; // UTF-8 Byte Order Mark for Excel/Sheets international character handling
    const headerLine = headers.map(formatCSVCell).join(',');
    const bodyLines = rows.map(row => row.map(formatCSVCell).join(','));
    return BOM + [headerLine, ...bodyLines].join('\r\n');
  }

  function switchDataTab(tabName) {
    State.activeDataTab = tabName;
    if (DOM.dataTabBtns) {
      DOM.dataTabBtns.forEach(btn => {
        const t = btn.getAttribute('data-tab');
        if (t === tabName) {
          btn.classList.add('active');
          btn.setAttribute('aria-selected', 'true');
        } else {
          btn.classList.remove('active');
          btn.setAttribute('aria-selected', 'false');
        }
      });
    }

    if (DOM.dataTabPanels) {
      DOM.dataTabPanels.forEach(panel => {
        if (panel.id === `data-tabpanel-${tabName}`) {
          panel.classList.add('active');
        } else {
          panel.classList.remove('active');
        }
      });
    }
  }

  function renderDataWorkspace() {
    const projects = Storage.getProjects();
    const { checklists: savedChecklists } = loadAllChecklists();

    // 1. Calculate stored data metrics (including QA Checklists — QAV-ISS-009)
    let totalPlans = 0;
    let totalSuites = 0;
    let totalCases = 0;
    let totalExecs = 0;
    let totalDefects = 0;

    projects.forEach(p => {
      if (p.testPlan) totalPlans++;
      if (Array.isArray(p.testSuites)) {
        totalSuites += p.testSuites.length;
        p.testSuites.forEach(s => {
          if (Array.isArray(s.testCases)) totalCases += s.testCases.length;
        });
      }
      if (Array.isArray(p.executions)) totalExecs += p.executions.length;
      totalDefects += p.totalDefects ?? 0;
    });

    let totalChecklistTests = 0;
    savedChecklists.forEach(chk => {
      const prog = calculateChecklistProgress(chk);
      totalChecklistTests += prog.totalTests;
    });

    if (DOM.dataStatProjects) DOM.dataStatProjects.textContent = projects.length.toString();
    if (DOM.dataStatPlans) DOM.dataStatPlans.textContent = totalPlans.toString();
    if (DOM.dataStatSuites) DOM.dataStatSuites.textContent = totalSuites.toString();
    if (DOM.dataStatCases) DOM.dataStatCases.textContent = totalCases.toString();
    if (DOM.dataStatExecs) DOM.dataStatExecs.textContent = totalExecs.toString();
    if (DOM.dataStatDefects) DOM.dataStatDefects.textContent = totalDefects.toString();
    if (DOM.dataStatChecklists) DOM.dataStatChecklists.textContent = savedChecklists.length.toString();
    if (DOM.dataStatChecklistsSub) {
      DOM.dataStatChecklistsSub.textContent = `${totalChecklistTests} checklist test ${totalChecklistTests === 1 ? 'item' : 'items'}`;
    }

    // Storage footprint calculation across all Qavora persistent keys (QAV-ISS-009)
    try {
      const footprint = calculateQavoraStorageFootprint();
      if (DOM.dataStatStorageSize) DOM.dataStatStorageSize.textContent = footprint.formattedKB;
      if (DOM.dataStatStoragePercent) {
        DOM.dataStatStoragePercent.textContent =
          footprint.totalBytes === 0
            ? '0% of ~5 MB est. quota'
            : `${footprint.clampedPercent.toFixed(2)}% of ~5 MB est. quota`;
      }
      if (DOM.dataStatStorageBar) {
        DOM.dataStatStorageBar.style.width = `${footprint.barWidthPercent}%`;
      }
    } catch {
      if (DOM.dataStatStorageSize) DOM.dataStatStorageSize.textContent = '0.0 KB';
    }

    // 2. Populate Export Project Select
    if (DOM.exportProjectSelect) {
      const prevVal = DOM.exportProjectSelect.value;
      if (projects.length === 0) {
        DOM.exportProjectSelect.innerHTML = '<option value="" disabled selected>No projects available</option>';
        if (DOM.btnExportProjectJson) DOM.btnExportProjectJson.disabled = true;
      } else {
        DOM.exportProjectSelect.innerHTML = projects.map(p => `
          <option value="${escapeHTML(p.id)}">${escapeHTML(p.name)} (${p.testCaseCount ?? 0} cases)</option>
        `).join('');
        if (prevVal && projects.some(p => p.id === prevVal)) {
          DOM.exportProjectSelect.value = prevVal;
        }
        if (DOM.btnExportProjectJson) DOM.btnExportProjectJson.disabled = false;
      }
    }

    // 3. Populate Print Project Select
    if (DOM.printProjectSelect) {
      const prevVal = DOM.printProjectSelect.value;
      let printOpts = '<option value="ALL">All Projects (Global Summary)</option>';
      projects.forEach(p => {
        printOpts += `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`;
      });
      DOM.printProjectSelect.innerHTML = printOpts;
      if (prevVal && (prevVal === 'ALL' || projects.some(p => p.id === prevVal))) {
        DOM.printProjectSelect.value = prevVal;
      }
    }

    // 4. Populate CSV Scope Select
    if (DOM.exportCsvScopeSelect) {
      const prevVal = DOM.exportCsvScopeSelect.value;
      let csvOpts = '<option value="ALL">All Projects (All Data)</option>';
      projects.forEach(p => {
        csvOpts += `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`;
      });
      DOM.exportCsvScopeSelect.innerHTML = csvOpts;
      if (prevVal && (prevVal === 'ALL' || projects.some(p => p.id === prevVal))) {
        DOM.exportCsvScopeSelect.value = prevVal;
      }
    }

    // 5. Update Rollback card status
    const snapshot = Storage.getRollbackSnapshot();
    if (snapshot && (Array.isArray(snapshot.projects) || Array.isArray(snapshot.qaChecklists))) {
      const snapProjectsCnt = Array.isArray(snapshot.projects) ? snapshot.projects.length : 0;
      const snapChecklistsCnt = Array.isArray(snapshot.qaChecklists) ? snapshot.qaChecklists.length : 0;
      if (DOM.rollbackStatusBadge) {
        DOM.rollbackStatusBadge.textContent = 'Snapshot Available';
        DOM.rollbackStatusBadge.className = 'panel-tag badge-saas';
      }
      if (DOM.rollbackSnapshotTitle) {
        DOM.rollbackSnapshotTitle.textContent = `Snapshot created ${formatRelativeTime(snapshot.timestamp)}`;
      }
      if (DOM.rollbackSnapshotMeta) {
        const chkText = snapChecklistsCnt > 0 ? `, ${snapChecklistsCnt} QA checklists` : '';
        DOM.rollbackSnapshotMeta.textContent = `${snapProjectsCnt} projects${chkText} preserved before restore (${formatDisplayDate(snapshot.timestamp)})`;
      }
      if (DOM.btnExecuteRollback) DOM.btnExecuteRollback.disabled = false;
    } else {
      if (DOM.rollbackStatusBadge) {
        DOM.rollbackStatusBadge.textContent = 'No Snapshot';
        DOM.rollbackStatusBadge.className = 'panel-tag';
      }
      if (DOM.rollbackSnapshotTitle) {
        DOM.rollbackSnapshotTitle.textContent = 'No recovery snapshot currently stored.';
      }
      if (DOM.rollbackSnapshotMeta) {
        DOM.rollbackSnapshotMeta.textContent = 'Snapshots are created automatically before any replace/overwrite import.';
      }
      if (DOM.btnExecuteRollback) DOM.btnExecuteRollback.disabled = true;
    }

    // 6. Refresh Transfer Between Devices checklist summary
    if (qaTransferController && typeof qaTransferController.refreshTransferWorkspace === 'function') {
      qaTransferController.refreshTransferWorkspace();
    }

    // 7. Ensure active tab is shown
    switchDataTab(State.activeDataTab || 'export');
  }

  function exportProjectJSON(projectId) {
    const projects = Storage.getProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) {
      showToast('Please select a valid project to export', 'error');
      return;
    }

    const payload = {
      application: 'Qavora',
      backupVersion: 1,
      schemaVersion: 1,
      type: 'project',
      exportedAt: new Date().toISOString(),
      metadata: {
        totalCases: project.testCaseCount ?? 0,
        totalSuites: project.testSuites ? project.testSuites.length : 0,
        totalExecutions: project.executions ? project.executions.length : 0,
        totalDefects: project.totalDefects ?? 0
      },
      project: project
    };

    const jsonStr = JSON.stringify(payload, null, 2);
    const safeName = sanitizeFilename(project.name);
    const filename = `Qavora_${safeName}_${getISODate()}.json`;

    downloadFile(jsonStr, filename, 'application/json');
    Storage.addActivity('Exported Project JSON', project.name);
    showToast(`Project "${project.name}" exported successfully (${(jsonStr.length / 1024).toFixed(1)} KB)`);
  }

  function exportFullApplicationBackup() {
    const projects = Storage.getProjects();
    const activities = Storage.getActivities();
    const qaChecklists = loadAllChecklists().checklists;
    const qaActiveRunner = getActiveRunnerState();

    let totalCases = 0;
    let totalSuites = 0;
    let totalExecs = 0;
    let totalDefects = 0;
    let totalPlans = 0;

    projects.forEach(p => {
      if (p.testPlan) totalPlans++;
      if (Array.isArray(p.testSuites)) totalSuites += p.testSuites.length;
      totalCases += p.testCaseCount ?? 0;
      if (Array.isArray(p.executions)) totalExecs += p.executions.length;
      totalDefects += p.totalDefects ?? 0;
    });

    const payload = {
      application: 'Qavora',
      backupVersion: 1,
      schemaVersion: 1,
      type: 'full_backup',
      exportedAt: new Date().toISOString(),
      metadata: {
        totalProjects: projects.length,
        totalQaChecklists: qaChecklists.length,
        activeChecklistId: qaActiveRunner.activeChecklistId,
        lastQaView: qaActiveRunner.lastQaView,
        totalPlans: totalPlans,
        totalSuites: totalSuites,
        totalCases: totalCases,
        totalExecutions: totalExecs,
        totalDefects: totalDefects,
        theme: Storage.getTheme()
      },
      projects: projects,
      qaChecklists: qaChecklists,
      qaActiveRunner: qaActiveRunner,
      activities: activities
    };

    const jsonStr = JSON.stringify(payload, null, 2);
    const filename = `Qavora_Full_Backup_${getISODate()}.json`;

    downloadFile(jsonStr, filename, 'application/json');
    const summaryLabel = `${projects.length} Projects, ${qaChecklists.length} QA Checklists`;
    Storage.addActivity('Created Full Backup', summaryLabel);
    addNotification({
      title: 'Full Backup Created',
      message: `Application backup downloaded (${summaryLabel}).`,
      type: 'backup',
      link: { view: 'data' }
    });
    showToast(`Complete application backup downloaded (${projects.length} projects, ${qaChecklists.length} QA checklists)`);
  }

  function exportTestCasesCSV() {
    const scope = DOM.exportCsvScopeSelect?.value || 'ALL';
    const allProjects = Storage.getProjects();
    const targetProjects = scope === 'ALL' ? allProjects : allProjects.filter(p => p.id === scope);

    if (targetProjects.length === 0) {
      showToast('No projects found for CSV export', 'warning');
      return;
    }

    const headers = [
      'Project Name',
      'Test Plan',
      'Phase',
      'Test Suite',
      'Test Case ID',
      'Title',
      'Description',
      'Preconditions',
      'Test Steps',
      'Expected Result',
      'Priority',
      'Category',
      'Tags',
      'Current Status',
      'Created Date',
      'Updated Date'
    ];

    const rows = [];

    targetProjects.forEach(p => {
      const planName = p.testPlan?.name || 'Master Test Plan';
      const phasesMap = new Map();
      if (p.testPlan && Array.isArray(p.testPlan.phases)) {
        p.testPlan.phases.forEach(ph => phasesMap.set(ph.id, ph.name));
      }

      if (Array.isArray(p.testSuites)) {
        p.testSuites.forEach(s => {
          const phaseName = phasesMap.get(s.phaseId) || '';
          if (Array.isArray(s.testCases)) {
            s.testCases.forEach(tc => {
              const stepsStr = (tc.steps && tc.steps.length)
                ? tc.steps.map((st, i) => {
                    const hasData = st.testData !== undefined && st.testData !== null && String(st.testData).trim() !== '';
                    return `${i + 1}. ${st.action || ''}${hasData ? ' (Data: ' + st.testData + ')' : ''}`;
                  }).join('\n')
                : '';
              const tagsStr = Array.isArray(tc.tags) ? tc.tags.join(', ') : '';

              rows.push([
                p.name,
                planName,
                phaseName,
                s.name,
                tc.id,
                tc.title,
                tc.description || '',
                tc.preconditions || '',
                stepsStr,
                tc.expectedResult || '',
                tc.priority || 'Medium',
                tc.category || s.category || 'Functional',
                tagsStr,
                tc.status || 'Not Run',
                tc.createdAt || '',
                tc.updatedAt || ''
              ]);
            });
          }
        });
      }
    });

    if (rows.length === 0) {
      showToast('No test cases found in the selected scope', 'warning');
      return;
    }

    const csvContent = generateCSV(headers, rows);
    const scopeName = scope === 'ALL' ? 'AllProjects' : sanitizeFilename(targetProjects[0].name);
    const filename = `Qavora_${scopeName}_TestCases_${getISODate()}.csv`;

    downloadFile(csvContent, filename, 'text/csv;charset=utf-8;');
    Storage.addActivity('Exported Test Cases CSV', `${rows.length} Cases (${scopeName})`);
    showToast(`Exported ${rows.length} test cases to CSV`);
  }

  function exportExecutionsCSV() {
    const scope = DOM.exportCsvScopeSelect?.value || 'ALL';
    const allProjects = Storage.getProjects();
    const targetProjects = scope === 'ALL' ? allProjects : allProjects.filter(p => p.id === scope);

    if (targetProjects.length === 0) {
      showToast('No projects found for CSV export', 'warning');
      return;
    }

    const headers = [
      'Project Name',
      'Test Case ID',
      'Test Case Title',
      'Execution ID',
      'Execution Status',
      'Actual Result',
      'Execution Notes',
      'Tester',
      'Environment',
      'Browser / Device',
      'Build / Version',
      'Execution Date'
    ];

    const rows = [];

    targetProjects.forEach(p => {
      if (Array.isArray(p.executions)) {
        p.executions.forEach(ex => {
          rows.push([
            p.name,
            (ex.testCaseId !== undefined && ex.testCaseId !== null) ? String(ex.testCaseId) : '',
            ex.testCaseTitle || '',
            ex.id || '',
            ex.status || 'Pass',
            (ex.actualResult !== undefined && ex.actualResult !== null) ? String(ex.actualResult) : '',
            (ex.notes !== undefined && ex.notes !== null) ? String(ex.notes) : '',
            ex.tester || 'Anonymous Tester',
            ex.environment || '',
            ex.browserDevice || '',
            (ex.buildVersion !== undefined && ex.buildVersion !== null) ? String(ex.buildVersion) : '',
            ex.executedAt || ''
          ]);
        });
      }
    });

    if (rows.length === 0) {
      showToast('No execution records found in the selected scope', 'warning');
      return;
    }

    const csvContent = generateCSV(headers, rows);
    const scopeName = scope === 'ALL' ? 'AllProjects' : sanitizeFilename(targetProjects[0].name);
    const filename = `Qavora_${scopeName}_Executions_${getISODate()}.csv`;

    downloadFile(csvContent, filename, 'text/csv;charset=utf-8;');
    Storage.addActivity('Exported Executions CSV', `${rows.length} Runs (${scopeName})`);
    showToast(`Exported ${rows.length} execution runs to CSV`);
  }

  function exportDefectsCSV() {
    const scope = DOM.exportCsvScopeSelect?.value || 'ALL';
    const allProjects = Storage.getProjects();
    const targetProjects = scope === 'ALL' ? allProjects : allProjects.filter(p => p.id === scope);

    if (targetProjects.length === 0) {
      showToast('No projects found for CSV export', 'warning');
      return;
    }

    const headers = [
      'Project Name',
      'Defect ID',
      'Defect Title',
      'Description',
      'Severity',
      'Status',
      'Linked Test Case',
      'Linked Execution',
      'Steps to Reproduce',
      'Expected Result',
      'Actual Result',
      'External Issue URL',
      'Created Date',
      'Updated Date'
    ];

    const rows = [];

    targetProjects.forEach(p => {
      if (Array.isArray(p.defects)) {
        p.defects.forEach(df => {
          rows.push([
            p.name,
            df.id || '',
            df.title || 'Untitled Defect',
            df.description || '',
            classifyDefectPriority(df) || df.priority || df.severity || 'Medium',
            df.status || 'Open',
            (df.testCaseId !== undefined && df.testCaseId !== null) ? String(df.testCaseId) : '',
            (df.executionId !== undefined && df.executionId !== null) ? String(df.executionId) : '',
            (df.stepsToReproduce !== undefined && df.stepsToReproduce !== null) ? String(df.stepsToReproduce) : '',
            (df.expectedResult !== undefined && df.expectedResult !== null) ? String(df.expectedResult) : '',
            (df.actualResult !== undefined && df.actualResult !== null) ? String(df.actualResult) : '',
            df.externalIssueUrl || '',
            df.createdAt || '',
            df.updatedAt || ''
          ]);
        });
      }
    });

    if (rows.length === 0) {
      showToast('No defect records found in the selected scope', 'warning');
      return;
    }

    const csvContent = generateCSV(headers, rows);
    const scopeName = scope === 'ALL' ? 'AllProjects' : sanitizeFilename(targetProjects[0].name);
    const filename = `Qavora_${scopeName}_Defects_${getISODate()}.csv`;

    downloadFile(csvContent, filename, 'text/csv;charset=utf-8;');
    Storage.addActivity('Exported Defects CSV', `${rows.length} Defects (${scopeName})`);
    showToast(`Exported ${rows.length} defects to CSV`);
  }

  function exportChecklistsCSV() {
    const { checklists } = loadAllChecklists();
    if (!Array.isArray(checklists) || checklists.length === 0) {
      showToast('No saved QA checklists available to export', 'warning');
      return;
    }

    const headers = [
      'Checklist ID',
      'Checklist Title',
      'Phase Number',
      'Phase Name',
      'Section / Category',
      'Test ID',
      'Test Case Description',
      'Priority',
      'Checklist Progress Status',
      'Supporting Notes',
      'Promoted Project ID',
      'Created Date',
      'Updated Date'
    ];

    const rows = [];

    checklists.forEach(chk => {
      const docNotes = Array.isArray(chk.documentNotes)
        ? chk.documentNotes.map(n => n.text).filter(Boolean).join(' | ')
        : '';
      const phases = Array.isArray(chk.phases) ? chk.phases : [];

      if (phases.length === 0) {
        rows.push([
          chk.id || '',
          chk.title || 'Untitled QA Checklist',
          '',
          '',
          '',
          '',
          '',
          '',
          'Not Started',
          docNotes,
          chk.promotedProjectId || '',
          chk.createdAt || '',
          chk.updatedAt || ''
        ]);
        return;
      }

      phases.forEach((ph, pIdx) => {
        const phNum = ph.phaseNumber !== undefined && ph.phaseNumber !== null ? String(ph.phaseNumber) : String(pIdx + 1);
        const phName = ph.name || `Phase ${phNum}`;
        const phNotes = Array.isArray(ph.notes) ? ph.notes.map(n => n.text).filter(Boolean).join(' | ') : '';
        const sections = Array.isArray(ph.sections) ? ph.sections : [];

        sections.forEach(sec => {
          const secName = sec.type === 'category' && sec.name ? sec.name : 'Direct Phase Tests';
          const secNotes = Array.isArray(sec.notes) ? sec.notes.map(n => n.text).filter(Boolean).join(' | ') : '';
          const combinedNotes = [docNotes, phNotes, secNotes].filter(Boolean).join(' — ');
          const tests = Array.isArray(sec.tests) ? sec.tests : [];

          if (tests.length === 0 && (sec.type === 'category' || secNotes)) {
            rows.push([
              chk.id || '',
              chk.title || 'Untitled QA Checklist',
              phNum,
              phName,
              secName,
              '',
              '(No test items in section)',
              '',
              'Not Started',
              combinedNotes,
              chk.promotedProjectId || '',
              chk.createdAt || '',
              chk.updatedAt || ''
            ]);
            return;
          }

          tests.forEach(tc => {
            const isChecked = tc.completed === true || tc.status === 'Completed';
            rows.push([
              chk.id || '',
              chk.title || 'Untitled QA Checklist',
              phNum,
              phName,
              secName,
              tc.testId || '',
              tc.text || '',
              tc.priority || '',
              isChecked ? 'Completed (Checklist)' : 'Not Started (Checklist)',
              combinedNotes,
              chk.promotedProjectId || '',
              chk.createdAt || '',
              chk.updatedAt || ''
            ]);
          });
        });
      });
    });

    if (rows.length === 0) {
      showToast('No checklist items found to export', 'warning');
      return;
    }

    const csvContent = generateCSV(headers, rows);
    const filename = `Qavora_QA_Checklists_${getISODate()}.csv`;

    downloadFile(csvContent, filename, 'text/csv;charset=utf-8;');
    Storage.addActivity('Exported QA Checklists CSV', `${checklists.length} Checklists (${rows.length} rows)`);
    showToast(`Exported ${checklists.length} QA checklist(s) (${rows.length} rows) to CSV`);
  }

  function generateAndPrintQAReport(projectId = null, docType = null) {
    const scope = projectId || DOM.printProjectSelect?.value || 'ALL';
    const type = docType || DOM.printReportTypeSelect?.value || 'qa-summary';
    const allProjects = Storage.getProjects();
    const { checklists: savedChecklists } = loadAllChecklists();
    const targetProjects = scope === 'ALL' ? allProjects : allProjects.filter(p => p.id === scope);

    if (!DOM.printableReportContainer) return;

    const canPrintChecklists = (scope === 'ALL' && savedChecklists.length > 0) || type === 'qa-checklists';
    if (targetProjects.length === 0 && !canPrintChecklists) {
      showToast('No projects or saved QA checklists available to print report', 'warning');
      return;
    }
    if (type === 'qa-checklists' && savedChecklists.length === 0) {
      showToast('No saved QA checklists available to print report', 'warning');
      return;
    }

    let totalCases = 0;
    let passedCases = 0;
    let failedCases = 0;
    let blockedCases = 0;
    let skippedCases = 0;
    let notRunCases = 0;
    let executedCases = 0;
    let totalDefects = 0;
    let openDefects = 0;

    targetProjects.forEach(p => {
      totalCases += p.testCaseCount ?? 0;
      passedCases += p.passedTests ?? 0;
      failedCases += p.failedTests ?? 0;
      blockedCases += p.blockedTests ?? 0;
      skippedCases += p.skippedTests ?? 0;
      notRunCases += p.notRunTests ?? 0;
      executedCases += p.executedTests ?? 0;
      totalDefects += p.totalDefects ?? 0;
      openDefects += p.openDefects ?? 0;
    });

    const passRate = executedCases > 0 ? Math.round((passedCases / executedCases) * 100) : 0;
    const completionRate = totalCases > 0 ? Math.round((executedCases / totalCases) * 100) : 0;

    let docTitle = 'Executive QA Summary & Health Report';
    if (type === 'case-inventory') docTitle = 'Test Case Specifications & Inventory Ledger';
    else if (type === 'exec-audit') docTitle = 'Test Execution Runs & Verification Audit Trail';
    else if (type === 'defect-log') docTitle = 'Defects & Bug Tracking Registry';
    else if (type === 'qa-checklists') docTitle = 'Saved QA Checklists & Runner Progress Ledger';

    let docScope = '';
    if (type === 'qa-checklists') {
      docScope = `Workspace Scope: Saved QA Checklists (${savedChecklists.length} Checklists)`;
    } else if (scope === 'ALL') {
      docScope = `Workspace Scope: All Projects (${targetProjects.length} Active Workspaces) & Saved QA Checklists (${savedChecklists.length})`;
    } else {
      const p = targetProjects[0];
      const hasVer = p.version !== undefined && p.version !== null && String(p.version).trim() !== '';
      docScope = `Project Scope: ${p.name} • ${p.type} ${hasVer ? '(v' + p.version + ')' : ''} • Status: ${p.status}`;
    }

    const now = new Date();
    const dateFormatted = `${now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    const buildChecklistsPrintSectionHtml = (sectionNumberPrefix = '') => {
      if (savedChecklists.length === 0) {
        return `
          <div class="print-section-title">${sectionNumberPrefix}Saved QA Checklists Overview (0 Checklists)</div>
          <p style="font-size: 9pt; color: #6b7280;">No saved QA checklists currently stored in workspace.</p>
        `;
      }
      return `
        <div class="print-section-title">${sectionNumberPrefix}Saved QA Checklists Overview (${savedChecklists.length} Checklists)</div>
        <table class="print-table">
          <thead>
            <tr>
              <th>Checklist Title</th>
              <th>Phases</th>
              <th>Total Items</th>
              <th>Checked Off</th>
              <th>Remaining</th>
              <th>Runner Progress</th>
              <th>Promoted Project</th>
              <th>Last Updated</th>
            </tr>
          </thead>
          <tbody>
            ${savedChecklists.map(chk => {
              const prog = calculateChecklistProgress(chk);
              const linkedProj = allProjects.find(p => p.sourceChecklistId === chk.id || (chk.promotedProjectId && p.id === chk.promotedProjectId));
              return `
                <tr>
                  <td><strong>${escapeHTML(chk.title)}</strong></td>
                  <td>${prog.totalPhases}</td>
                  <td>${prog.totalTests}</td>
                  <td>${prog.completedTests}</td>
                  <td>${prog.remainingTests}</td>
                  <td><strong>${prog.percentage}%</strong></td>
                  <td>${linkedProj ? escapeHTML(linkedProj.name) : '—'}</td>
                  <td>${formatDisplayDate(chk.updatedAt)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    };

    let contentHtml = `
      <div class="print-header">
        <div>
          <div class="print-brand">Qavora</div>
          <div class="print-subbrand">Manual QA Testing Architecture • Quality Assurance Ledger</div>
        </div>
        <div class="print-meta">
          <div><strong>Generated:</strong> ${dateFormatted}</div>
          <div><strong>Classification:</strong> Internal QA Documentation</div>
        </div>
      </div>

      <div class="print-doc-title">${escapeHTML(docTitle)}</div>
      <div class="print-doc-scope">${escapeHTML(docScope)}</div>

      <div class="print-kpi-grid">
        <div class="print-kpi-card">
          <div class="print-kpi-label">Total Test Cases</div>
          <div class="print-kpi-val">${totalCases}</div>
          <div style="font-size: 8pt; color: #4b5563; margin-top: 2px;">Executed: ${executedCases} (${completionRate}%)</div>
        </div>
        <div class="print-kpi-card">
          <div class="print-kpi-label">Overall Pass Rate</div>
          <div class="print-kpi-val">${passRate}%</div>
          <div style="font-size: 8pt; color: #4b5563; margin-top: 2px;">Passed: ${passedCases} • Failed: ${failedCases}</div>
        </div>
        <div class="print-kpi-card">
          <div class="print-kpi-label">Untested / Other</div>
          <div class="print-kpi-val">${notRunCases}</div>
          <div style="font-size: 8pt; color: #4b5563; margin-top: 2px;">Blocked: ${blockedCases} • Skipped: ${skippedCases}</div>
        </div>
        <div class="print-kpi-card">
          <div class="print-kpi-label">Defects &amp; Issues</div>
          <div class="print-kpi-val">${totalDefects}</div>
          <div style="font-size: 8pt; color: #4b5563; margin-top: 2px;">Open: ${openDefects} unresolved</div>
        </div>
      </div>
    `;

    if (type === 'qa-summary') {
      contentHtml += `
        <div class="print-section-title">1. Projects Overview</div>
        <table class="print-table">
          <thead>
            <tr>
              <th>Project Name</th>
              <th>Type</th>
              <th>Status</th>
              <th>Version</th>
              <th>Total</th>
              <th>Pass</th>
              <th>Fail</th>
              <th>Block</th>
              <th>Skip</th>
              <th>Not Run</th>
              <th>Pass Rate</th>
              <th>Open Bugs</th>
            </tr>
          </thead>
          <tbody>
            ${targetProjects.length === 0 ? '<tr><td colspan="12" style="text-align: center; color: #6b7280;">No formal projects in selected scope</td></tr>' : targetProjects.map(p => `
              <tr>
                <td><strong>${escapeHTML(p.name)}</strong></td>
                <td>${escapeHTML(p.type)}</td>
                <td><span class="print-badge">${escapeHTML(p.status)}</span></td>
                <td>${escapeHTML((p.version !== undefined && p.version !== null && String(p.version).trim() !== '') ? String(p.version) : '—')}</td>
                <td>${p.testCaseCount ?? 0}</td>
                <td>${p.passedTests ?? 0}</td>
                <td>${p.failedTests ?? 0}</td>
                <td>${p.blockedTests ?? 0}</td>
                <td>${p.skippedTests ?? 0}</td>
                <td>${p.notRunTests ?? 0}</td>
                <td><strong>${p.passRate ?? 0}%</strong></td>
                <td>${p.openDefects ?? 0}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="print-section-title">2. Test Suites &amp; Phases Matrix</div>
        <table class="print-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Phase</th>
              <th>Suite Name</th>
              <th>Category</th>
              <th>Cases</th>
              <th>Passed</th>
              <th>Failed</th>
              <th>Coverage</th>
            </tr>
          </thead>
          <tbody>
            ${targetProjects.length === 0 ? '<tr><td colspan="8" style="text-align: center; color: #6b7280;">No test suites defined</td></tr>' : targetProjects.map(p => {
              const phasesMap = new Map();
              if (p.testPlan && Array.isArray(p.testPlan.phases)) {
                p.testPlan.phases.forEach(ph => phasesMap.set(ph.id, ph.name));
              }
              if (!Array.isArray(p.testSuites) || p.testSuites.length === 0) {
                return `<tr><td>${escapeHTML(p.name)}</td><td colspan="7" style="color: #6b7280;">No test suites defined</td></tr>`;
              }
              return p.testSuites.map(s => {
                const cases = Array.isArray(s.testCases) ? s.testCases : [];
                const passed = cases.filter(c => c.status === 'Pass').length;
                const failed = cases.filter(c => c.status === 'Fail').length;
                const exec = cases.filter(c => c.status !== 'Not Run').length;
                const pRate = exec > 0 ? Math.round((passed / exec) * 100) : 0;
                return `
                  <tr>
                    <td>${escapeHTML(p.name)}</td>
                    <td>${escapeHTML(phasesMap.get(s.phaseId) || '—')}</td>
                    <td><strong>${escapeHTML(s.name)}</strong></td>
                    <td>${escapeHTML(s.category || 'Functional')}</td>
                    <td>${cases.length}</td>
                    <td>${passed}</td>
                    <td>${failed}</td>
                    <td>${pRate}% (${exec}/${cases.length})</td>
                  </tr>
                `;
              }).join('');
            }).join('')}
          </tbody>
        </table>
      `;
      if (scope === 'ALL') {
        contentHtml += buildChecklistsPrintSectionHtml('3. ');
      }
    } else if (type === 'qa-checklists') {
      contentHtml += buildChecklistsPrintSectionHtml('1. ');
      contentHtml += `
        <div class="print-section-title">2. Detailed QA Checklist Items</div>
        <table class="print-table">
          <thead>
            <tr>
              <th>Checklist</th>
              <th>Phase</th>
              <th>Section / Category</th>
              <th>Test ID</th>
              <th>Test Item Description</th>
              <th>Priority</th>
              <th>Runner Status</th>
            </tr>
          </thead>
          <tbody>
            ${savedChecklists.map(chk => {
              const phases = Array.isArray(chk.phases) ? chk.phases : [];
              return phases.map((ph, pIdx) => {
                const phName = ph.name || `Phase ${pIdx + 1}`;
                const sections = Array.isArray(ph.sections) ? ph.sections : [];
                return sections.map(sec => {
                  const secName = sec.type === 'category' && sec.name ? sec.name : 'Direct Phase Tests';
                  const tests = Array.isArray(sec.tests) ? sec.tests : [];
                  return tests.map(tc => {
                    const isChecked = tc.completed === true || tc.status === 'Completed';
                    return `
                      <tr>
                        <td>${escapeHTML(chk.title)}</td>
                        <td>${escapeHTML(phName)}</td>
                        <td>${escapeHTML(secName)}</td>
                        <td><code>${escapeHTML(tc.testId || '—')}</code></td>
                        <td><strong>${escapeHTML(tc.text)}</strong></td>
                        <td><span class="print-badge">${escapeHTML(tc.priority || '—')}</span></td>
                        <td><span class="print-badge">${isChecked ? 'Completed' : 'Not Started'}</span></td>
                      </tr>
                    `;
                  }).join('');
                }).join('');
              }).join('');
            }).join('')}
          </tbody>
        </table>
      `;
    } else if (type === 'case-inventory') {
      contentHtml += `
        <div class="print-section-title">Test Case Specifications &amp; Inventory</div>
        <table class="print-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Project</th>
              <th>Suite</th>
              <th>Title</th>
              <th>Priority</th>
              <th>Category</th>
              <th>Status</th>
              <th>Steps</th>
              <th>Expected Result</th>
            </tr>
          </thead>
          <tbody>
            ${targetProjects.map(p => {
              if (!Array.isArray(p.testSuites)) return '';
              return p.testSuites.map(s => {
                if (!Array.isArray(s.testCases)) return '';
                return s.testCases.map(tc => `
                  <tr>
                    <td><code>${escapeHTML(tc.id)}</code></td>
                    <td>${escapeHTML(p.name)}</td>
                    <td>${escapeHTML(s.name)}</td>
                    <td><strong>${escapeHTML(tc.title)}</strong></td>
                    <td><span class="print-badge">${escapeHTML(tc.priority)}</span></td>
                    <td>${escapeHTML(tc.category || s.category || 'Functional')}</td>
                    <td><span class="print-badge">${escapeHTML(tc.status)}</span></td>
                    <td>${Array.isArray(tc.steps) ? tc.steps.length : 0} steps</td>
                    <td style="font-size: 8.5pt;">${escapeHTML(tc.expectedResult || '—')}</td>
                  </tr>
                `).join('');
              }).join('');
            }).join('')}
          </tbody>
        </table>
      `;
    } else if (type === 'exec-audit') {
      const allExecs = [];
      targetProjects.forEach(p => {
        if (Array.isArray(p.executions)) {
          p.executions.forEach(ex => {
            allExecs.push({ ...ex, projectName: p.name });
          });
        }
      });
      allExecs.sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime());

      contentHtml += `
        <div class="print-section-title">Test Execution Runs (${allExecs.length} Total Runs)</div>
        <table class="print-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Project</th>
              <th>Case ID</th>
              <th>Title</th>
              <th>Verdict</th>
              <th>Tester</th>
              <th>Environment</th>
              <th>Device / Browser</th>
              <th>Actual Notes</th>
            </tr>
          </thead>
          <tbody>
            ${allExecs.length === 0 ? '<tr><td colspan="9" style="text-align: center; color: #6b7280;">No execution records found</td></tr>' : allExecs.map(ex => `
              <tr>
                <td style="white-space: nowrap;">${formatDisplayDate(ex.executedAt)}</td>
                <td>${escapeHTML(ex.projectName)}</td>
                <td><code>${escapeHTML(ex.testCaseId)}</code></td>
                <td><strong>${escapeHTML(ex.testCaseTitle || '—')}</strong></td>
                <td><span class="print-badge">${escapeHTML(ex.status)}</span></td>
                <td>${escapeHTML(ex.tester || 'Tester')}</td>
                <td>${escapeHTML(ex.environment || '—')}</td>
                <td>${escapeHTML(ex.browserDevice || '—')}</td>
                <td style="font-size: 8.5pt;">${escapeHTML((ex.actualResult !== undefined && ex.actualResult !== null && String(ex.actualResult).trim() !== '') ? String(ex.actualResult) : ((ex.notes !== undefined && ex.notes !== null && String(ex.notes).trim() !== '') ? String(ex.notes) : '—'))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else if (type === 'defect-log') {
      const allDefects = [];
      targetProjects.forEach(p => {
        if (Array.isArray(p.defects)) {
          p.defects.forEach(df => {
            allDefects.push({ ...df, projectName: p.name });
          });
        }
      });

      contentHtml += `
        <div class="print-section-title">Defects &amp; Bug Tracking Ledger (${allDefects.length} Total)</div>
        <table class="print-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Project</th>
              <th>Title</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Linked Case</th>
              <th>Reproduction Steps</th>
              <th>Expected vs Actual</th>
            </tr>
          </thead>
          <tbody>
            ${allDefects.length === 0 ? '<tr><td colspan="8" style="text-align: center; color: #6b7280;">No defects logged</td></tr>' : allDefects.map(df => `
              <tr>
                <td><code>${escapeHTML(df.id)}</code></td>
                <td>${escapeHTML(df.projectName)}</td>
                <td><strong>${escapeHTML(df.title)}</strong></td>
                <td><span class="print-badge">${escapeHTML(classifyDefectPriority(df) || df.priority || df.severity || '—')}</span></td>
                <td><span class="print-badge">${escapeHTML(df.status)}</span></td>
                <td><code>${escapeHTML((df.testCaseId !== undefined && df.testCaseId !== null && String(df.testCaseId).trim() !== '') ? String(df.testCaseId) : '—')}</code></td>
                <td style="font-size: 8.5pt;">${escapeHTML(df.stepsToReproduce || '—')}</td>
                <td style="font-size: 8.5pt;">
                  <div><strong>Exp:</strong> ${escapeHTML((df.expectedResult !== undefined && df.expectedResult !== null && String(df.expectedResult).trim() !== '') ? String(df.expectedResult) : '—')}</div>
                  <div><strong>Act:</strong> ${escapeHTML((df.actualResult !== undefined && df.actualResult !== null && String(df.actualResult).trim() !== '') ? String(df.actualResult) : '—')}</div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    contentHtml += `
      <div class="print-footer">
        <div>Qavora Manual QA Testing Architecture • Offline Workspace Engine</div>
        <div>Confidential QA Audit Report • Printed ${dateFormatted}</div>
      </div>
    `;

    DOM.printableReportContainer.innerHTML = contentHtml;
    window.print();
  }

  function showImportValidationAlert(message) {
    if (DOM.importValidationAlert && DOM.importValidationText) {
      DOM.importValidationText.textContent = message;
      DOM.importValidationAlert.style.display = 'flex';
    }
    showToast(message, 'error');
  }

  function hideImportValidationAlert() {
    if (DOM.importValidationAlert) {
      DOM.importValidationAlert.style.display = 'none';
    }
  }

  function handleImportFile(file) {
    if (!file) return;

    hideImportValidationAlert();

    const reader = new FileReader();
    reader.onload = async function(e) {
      try {
        const rawContent = typeof e.target.result === 'string' ? e.target.result : '';
        const text = rawContent.trim().replace(/^\uFEFF/, '');

        if (!text) {
          showImportValidationAlert('The selected file is empty.');
          return;
        }

        // 1. Detect if this is a TPX1 transfer code file (or starts with TPX prefix)
        const isTransferCodeCandidate = text.startsWith('TPX1.') || /^TPX\d+\./i.test(text);

        if (isTransferCodeCandidate) {
          try {
            const transferResult = await validateChecklistTransferCode(text);
            if (!transferResult.ok) {
              showImportValidationAlert(transferResult.error || 'Invalid or corrupted transfer code file.');
              return;
            }
            previewTransferImport(transferResult.payload, file.name, file.size);
            return;
          } catch (tpxErr) {
            showImportValidationAlert(tpxErr && tpxErr.message ? tpxErr.message : 'Unable to decode transfer code file.');
            return;
          }
        }

        // 2. Otherwise, attempt JSON parsing for project exports or full backups
        let jsonData = null;
        try {
          jsonData = JSON.parse(text);
        } catch (_jsonErr) {
          // If JSON parse fails, check if text might contain a TPX1 code (e.g. wrapped in comments or whitespace)
          if (text.includes('TPX1.')) {
            const extractedCodeMatch = text.match(/TPX1\.[a-z0-9\-_.]+/i);
            if (extractedCodeMatch) {
              const transferResult = await validateChecklistTransferCode(extractedCodeMatch[0]);
              if (transferResult.ok) {
                previewTransferImport(transferResult.payload, file.name, file.size);
                return;
              }
            }
          }

          showImportValidationAlert('Invalid file format. Please select a valid Qavora JSON backup (.json) or device transfer code (.txt) file.');
          return;
        }

        validateAndPreviewImport(jsonData, file.name, file.size);
      } catch (err) {
        showImportValidationAlert(`Import read error: ${err.message || err}`);
      }
    };
    reader.onerror = function() {
      showImportValidationAlert('Failed to read the selected file.');
    };
    reader.readAsText(file);
  }

  function validateAndPreviewImport(data, filename, filesize) {
    if (!data || typeof data !== 'object') {
      showImportValidationAlert('Invalid data: Imported JSON must be an object or array.');
      return;
    }

    // Check version compatibility (reject future unsupported formats)
    if (data.backupVersion && Number(data.backupVersion) > 1) {
      showImportValidationAlert(`Unsupported future backup format (version ${data.backupVersion}). This version of Qavora supports version 1.`);
      return;
    }
    if (data.schemaVersion && Number(data.schemaVersion) > 1) {
      showImportValidationAlert(`Unsupported future schema version (version ${data.schemaVersion}). This version of Qavora supports version 1.`);
      return;
    }

    // Validate optional qaChecklists and qaActiveRunner fields on object backups (QAV-ISS-013)
    if (!Array.isArray(data)) {
      if ('qaChecklists' in data && data.qaChecklists !== null && !Array.isArray(data.qaChecklists)) {
        showImportValidationAlert('Invalid backup format: "qaChecklists" must be an array.');
        return;
      }
      if ('projects' in data && data.projects !== null && !Array.isArray(data.projects)) {
        showImportValidationAlert('Invalid backup format: "projects" must be an array.');
        return;
      }
      const candidateRunner = data.qaActiveRunner !== undefined ? data.qaActiveRunner : data.activeRunnerState;
      if (
        candidateRunner !== undefined &&
        candidateRunner !== null &&
        (typeof candidateRunner !== 'object' || Array.isArray(candidateRunner))
      ) {
        showImportValidationAlert('Invalid backup format: "qaActiveRunner" must be a valid runner state object.');
        return;
      }
    }

    let rawProjects = [];
    const hasQaChecklistsField = !Array.isArray(data) && Array.isArray(data.qaChecklists);
    const rawQaChecklists = hasQaChecklistsField
      ? data.qaChecklists.filter(c => c && typeof c === 'object')
      : null;
    const hasQaActiveRunnerField =
      !Array.isArray(data) && ('qaActiveRunner' in data || 'activeRunnerState' in data);
    const rawQaActiveRunner = hasQaActiveRunnerField
      ? (data.qaActiveRunner !== undefined ? data.qaActiveRunner : data.activeRunnerState)
      : null;
    let payloadType = 'Workspace Payload';

    if (Array.isArray(data.projects)) {
      rawProjects = data.projects;
      payloadType = 'Full Application Backup';
    } else if (hasQaChecklistsField) {
      rawProjects = [];
      payloadType = 'QA Checklists Backup';
    } else if (Array.isArray(data)) {
      rawProjects = data;
      payloadType = 'Full Application Backup';
    } else if (data.project && typeof data.project === 'object') {
      rawProjects = [data.project];
      payloadType = 'Individual Project Export';
    } else if ((data.id || data.name) && (data.testPlan || data.testSuites || data.type)) {
      rawProjects = [data];
      payloadType = 'Individual Project Export';
    } else {
      showImportValidationAlert('Unrecognized Qavora data format. Missing required project or QA checklist structure.');
      return;
    }

    // Sanitize & validate each candidate project
    rawProjects = rawProjects.filter(p => p && typeof p === 'object' && (p.name || p.id));

    const isExplicitFullBackup =
      !Array.isArray(data) &&
      (data.type === 'full_backup' || data.backupFormat === 'Qavora_Full_Backup') &&
      Array.isArray(data.projects);

    if (
      !isExplicitFullBackup &&
      rawProjects.length === 0 &&
      (!rawQaChecklists || rawQaChecklists.length === 0)
    ) {
      showImportValidationAlert('No valid Qavora project or QA checklist records found in file.');
      return;
    }

    // Calculate summary statistics across payload
    let planCnt = 0;
    let suiteCnt = 0;
    let caseCnt = 0;
    let execCnt = 0;
    let defectCnt = 0;

    rawProjects.forEach(p => {
      if (p.testPlan) planCnt++;
      if (Array.isArray(p.testSuites)) {
        suiteCnt += p.testSuites.length;
        p.testSuites.forEach(s => {
          if (Array.isArray(s.testCases)) caseCnt += s.testCases.length;
        });
      }
      if (Array.isArray(p.executions)) execCnt += p.executions.length;
      if (Array.isArray(p.defects)) defectCnt += p.defects.length;
    });

    if (rawQaChecklists && rawQaChecklists.length > 0) {
      planCnt += rawQaChecklists.length;
      rawQaChecklists.forEach(chk => {
        if (Array.isArray(chk.phases)) {
          chk.phases.forEach(ph => {
            if (Array.isArray(ph.sections)) {
              ph.sections.forEach(sec => {
                if (Array.isArray(sec.tests)) caseCnt += sec.tests.length;
              });
            }
          });
        }
      });
    }

    hideImportValidationAlert();

    // Populate Import Preview Modal
    if (DOM.importPreviewFilename) DOM.importPreviewFilename.textContent = filename;
    if (DOM.importPreviewFilesize) {
      const formattedSize = filesize > 1048576
        ? (filesize / 1048576).toFixed(1) + ' MB'
        : (filesize / 1024).toFixed(1) + ' KB';
      DOM.importPreviewFilesize.textContent = formattedSize;
    }
    if (DOM.importPreviewFormat) DOM.importPreviewFormat.textContent = payloadType;
    if (DOM.importPreviewDate) {
      DOM.importPreviewDate.textContent = data.exportedAt
        ? `${formatDisplayDate(data.exportedAt)} (${formatRelativeTime(data.exportedAt)})`
        : 'Recently';
    }

    if (DOM.importPreviewProjectsCnt) DOM.importPreviewProjectsCnt.textContent = rawProjects.length.toString();
    if (DOM.importPreviewPlansCnt) DOM.importPreviewPlansCnt.textContent = planCnt.toString();
    if (DOM.importPreviewSuitesCnt) DOM.importPreviewSuitesCnt.textContent = suiteCnt.toString();
    if (DOM.importPreviewCasesCnt) DOM.importPreviewCasesCnt.textContent = caseCnt.toString();
    if (DOM.importPreviewExecsCnt) DOM.importPreviewExecsCnt.textContent = execCnt.toString();
    if (DOM.importPreviewDefectsCnt) DOM.importPreviewDefectsCnt.textContent = defectCnt.toString();

    if (DOM.importPreviewProjectsList) {
      const projPills = rawProjects.map(p => {
        const cCnt = Array.isArray(p.testSuites)
          ? p.testSuites.reduce((acc, s) => acc + (Array.isArray(s.testCases) ? s.testCases.length : 0), 0)
          : (p.testCaseCount ?? 0);
        return `
          <span class="import-proj-pill">
            <strong>${escapeHTML(p.name || 'Untitled Project')}</strong>
            <span style="font-size: 0.65rem; color: var(--text-muted);">(${cCnt} cases)</span>
          </span>
        `;
      });
      const chkPills = (rawQaChecklists || []).map((chk, idx) => {
        const normalizedChk = normalizeChecklistRecord(chk, idx);
        const phaseCnt = normalizedChk ? normalizedChk.phases.length : 0;
        return `
          <span class="import-proj-pill">
            <strong>QA Checklist: ${escapeHTML((normalizedChk && normalizedChk.title) || 'Untitled Checklist')}</strong>
            <span style="font-size: 0.65rem; color: var(--text-muted);">(${phaseCnt} phases)</span>
          </span>
        `;
      });
      DOM.importPreviewProjectsList.innerHTML = [...projPills, ...chkPills].join('');
    }

    // Default to Merge mode
    if (DOM.importModeMerge) DOM.importModeMerge.checked = true;
    if (DOM.importReplaceWarning) DOM.importReplaceWarning.style.display = 'none';
    if (DOM.importConfirmBtnText) DOM.importConfirmBtnText.textContent = 'Confirm & Merge Data';
    if (DOM.importPreviewConfirmBtn) DOM.importPreviewConfirmBtn.className = 'btn btn-primary';

    State.pendingImportPayload = {
      rawProjects: rawProjects,
      rawQaChecklists: rawQaChecklists,
      hasQaActiveRunner: hasQaActiveRunnerField,
      rawQaActiveRunner: rawQaActiveRunner,
      payloadType: payloadType,
      activities: Array.isArray(data.activities) ? data.activities : []
    };

    if (DOM.importPreviewModal) {
      DOM.importPreviewModal.classList.add('open');
      DOM.importPreviewModal.setAttribute('aria-hidden', 'false');
    }
  }

  function previewTransferImport(transferPayload, filename, filesize) {
    if (!transferPayload || !Array.isArray(transferPayload.checklists) || transferPayload.checklists.length === 0) {
      showImportValidationAlert('No QA checklists found in transfer code payload.');
      return;
    }

    const { summary, checklists, generatedAt } = transferPayload;
    hideImportValidationAlert();

    // Populate Import Preview Modal metadata
    if (DOM.importPreviewFilename) DOM.importPreviewFilename.textContent = filename || 'transfer_code.txt';
    if (DOM.importPreviewFilesize) {
      const formattedSize = filesize > 1048576
        ? (filesize / 1048576).toFixed(1) + ' MB'
        : (filesize / 1024).toFixed(1) + ' KB';
      DOM.importPreviewFilesize.textContent = formattedSize;
    }
    if (DOM.importPreviewFormat) {
      DOM.importPreviewFormat.textContent = 'Device Transfer Code (TPX1)';
    }
    if (DOM.importPreviewDate) {
      DOM.importPreviewDate.textContent = generatedAt
        ? `${formatDisplayDate(generatedAt)} (${formatRelativeTime(generatedAt)})`
        : 'Recently';
    }

    // Counters:
    if (DOM.importPreviewProjectsCnt) DOM.importPreviewProjectsCnt.textContent = '0';
    if (DOM.importPreviewPlansCnt) DOM.importPreviewPlansCnt.textContent = (summary.totalChecklists || checklists.length).toString();
    if (DOM.importPreviewSuitesCnt) DOM.importPreviewSuitesCnt.textContent = (summary.totalPhases || 0).toString();
    if (DOM.importPreviewCasesCnt) DOM.importPreviewCasesCnt.textContent = (summary.totalTests || 0).toString();
    if (DOM.importPreviewExecsCnt) DOM.importPreviewExecsCnt.textContent = (summary.completedTests || 0).toString();
    if (DOM.importPreviewDefectsCnt) DOM.importPreviewDefectsCnt.textContent = '0';

    // Checklist Pills
    if (DOM.importPreviewProjectsList) {
      const chkPills = checklists.map((chk, idx) => {
        const normalizedChk = normalizeChecklistRecord(chk, idx);
        const phaseCnt = normalizedChk && Array.isArray(normalizedChk.phases) ? normalizedChk.phases.length : 0;
        let testCount = 0;
        if (normalizedChk && Array.isArray(normalizedChk.phases)) {
          normalizedChk.phases.forEach(ph => {
            if (Array.isArray(ph.sections)) {
              ph.sections.forEach(sec => {
                if (Array.isArray(sec.tests)) testCount += sec.tests.length;
              });
            }
          });
        }
        return `
          <span class="import-proj-pill">
            <strong>QA Checklist: ${escapeHTML((normalizedChk && normalizedChk.title) || 'Untitled Checklist')}</strong>
            <span style="font-size: 0.65rem; color: var(--text-muted);">(${phaseCnt} phases, ${testCount} tests)</span>
          </span>
        `;
      });
      DOM.importPreviewProjectsList.innerHTML = chkPills.join('');
    }

    // Default to Merge mode
    if (DOM.importModeMerge) DOM.importModeMerge.checked = true;
    if (DOM.importReplaceWarning) DOM.importReplaceWarning.style.display = 'none';
    if (DOM.importConfirmBtnText) DOM.importConfirmBtnText.textContent = 'Confirm & Merge Checklists';
    if (DOM.importPreviewConfirmBtn) DOM.importPreviewConfirmBtn.className = 'btn btn-primary';

    State.pendingImportPayload = {
      isTransferCode: true,
      transferPayload: transferPayload,
      rawProjects: [],
      rawQaChecklists: checklists,
      payloadType: 'Device Transfer Code (TPX1)',
      activities: []
    };

    if (DOM.importPreviewModal) {
      DOM.importPreviewModal.classList.add('open');
      DOM.importPreviewModal.setAttribute('aria-hidden', 'false');
    }
  }

  function closeImportPreviewModal() {
    if (DOM.importPreviewModal) {
      DOM.importPreviewModal.classList.remove('open');
      DOM.importPreviewModal.setAttribute('aria-hidden', 'true');
    }
    State.pendingImportPayload = null;
    if (DOM.importFileInput) DOM.importFileInput.value = '';
  }

  function commitImport() {
    if (!State.pendingImportPayload) {
      showToast('No active import payload to process', 'error');
      return;
    }

    // Handle TPX1 Device Transfer Payloads
    if (State.pendingImportPayload.isTransferCode && State.pendingImportPayload.transferPayload) {
      const strategy = document.querySelector('input[name="import-mode"]:checked')?.value || 'merge';
      const currentProjects = Storage.getProjects();
      const currentActivities = Storage.getActivities();
      const currentChecklists = loadAllChecklists().checklists;
      const currentActiveRunner = getActiveRunnerState();

      if (strategy === 'replace') {
        Storage.saveRollbackSnapshot(currentProjects, currentActivities, currentChecklists, currentActiveRunner);
      }

      const applyRes = applyChecklistTransferPayload(State.pendingImportPayload.transferPayload, strategy);
      if (!applyRes.ok) {
        showToast(`Import failed: ${applyRes.error || 'Unable to apply transfer payload.'}`, 'error');
        return;
      }

      const actionLabel = strategy === 'replace'
        ? 'Transferred Checklists (Replace)'
        : 'Transferred Checklists (Merge)';
      const summaryDetail = strategy === 'replace'
        ? `${applyRes.importedCount} QA Checklists restored (replaced)`
        : `${applyRes.importedCount} QA Checklists merged`;

      Storage.addActivity(actionLabel, summaryDetail);

      closeImportPreviewModal();
      if (qaRunnerController) {
        if (typeof qaRunnerController.syncFromStorage === 'function') {
          qaRunnerController.syncFromStorage();
        } else {
          qaRunnerController.refreshGlobalBadgesAndBanners();
        }
      }
      const toastSuccessMsg = strategy === 'replace'
        ? `Restored ${applyRes.importedCount} QA Checklist(s) from transfer code. Pre-restore rollback snapshot saved.`
        : `Merged ${applyRes.importedCount} QA Checklist(s) into workspace.`;
      addNotification({
        title: 'Checklists Imported',
        message: toastSuccessMsg,
        type: 'import',
        link: { view: 'data' }
      });
      showToast(toastSuccessMsg, 'success');
      renderDashboard();
      renderDataWorkspace();
      return;
    }

    if (!Array.isArray(State.pendingImportPayload.rawProjects)) {
      showToast('No active import payload to process', 'error');
      return;
    }

    const strategy = document.querySelector('input[name="import-mode"]:checked')?.value || 'merge';
    const importedRaw = State.pendingImportPayload.rawProjects;
    const importedRawChecklists = State.pendingImportPayload.rawQaChecklists;
    const hasQaActiveRunner = Boolean(State.pendingImportPayload.hasQaActiveRunner);
    const importedRawRunner = State.pendingImportPayload.rawQaActiveRunner;

    const currentProjects = Storage.getProjects();
    const currentActivities = Storage.getActivities();
    const currentChecklists = loadAllChecklists().checklists;
    const currentActiveRunner = getActiveRunnerState();

    if (strategy === 'replace') {
      // 1. Create safety rollback snapshot in sessionStorage (preserving projects, activities, QA checklists, and active runner state — QAV-ISS-013)
      Storage.saveRollbackSnapshot(currentProjects, currentActivities, currentChecklists, currentActiveRunner);

      // 2. Persist imported projects through the normalization engine
      const saveProjRes = Storage.saveProjects(importedRaw);
      if (!saveProjRes.ok) {
        showToast(`Import failed: ${saveProjRes.error || 'Unable to save imported projects.'}`, 'error');
        return;
      }
      const normalized = Storage.getProjects();
      const saveNormRes = Storage.saveProjects(normalized);
      if (!saveNormRes.ok) {
        Storage.saveProjects(currentProjects);
        showToast(`Import failed: ${saveNormRes.error || 'Unable to normalize imported projects.'}`, 'error');
        return;
      }

      // 3. Replace QA checklists only when the backup explicitly includes qaChecklists
      let restoredChkCount = currentChecklists.length;
      let targetChecklistsForRunner = currentChecklists;
      if (Array.isArray(importedRawChecklists)) {
        const normalizedChks = importedRawChecklists
          .map((c, idx) => normalizeChecklistRecord(c, idx))
          .filter(Boolean);
        const chkSaveRes = saveAllChecklists(normalizedChks);
        if (!chkSaveRes.ok) {
          Storage.saveProjects(currentProjects);
          saveAllChecklists(currentChecklists);
          showToast(`Import failed while saving QA checklists: ${chkSaveRes.error}`, 'error');
          return;
        }
        restoredChkCount = normalizedChks.length;
        targetChecklistsForRunner = normalizedChks;
      }

      // 4. Restore or reconcile active runner state (QAV-ISS-013)
      // Backward-compatible with older backups that omit qaActiveRunner:
      if (hasQaActiveRunner || Array.isArray(importedRawChecklists)) {
        const candidateRunnerState = hasQaActiveRunner ? importedRawRunner : currentActiveRunner;
        const runnerSaveRes = replaceActiveRunnerState(candidateRunnerState, targetChecklistsForRunner);
        if (!runnerSaveRes.ok) {
          Storage.saveProjects(currentProjects);
          saveAllChecklists(currentChecklists);
          replaceActiveRunnerState(currentActiveRunner, currentChecklists);
          showToast(`Import failed while restoring active runner state: ${runnerSaveRes.error}`, 'error');
          return;
        }
      }

      // 5. Restore activities if provided
      if (Array.isArray(State.pendingImportPayload.activities) && State.pendingImportPayload.activities.length > 0) {
        Storage.saveActivities(State.pendingImportPayload.activities);
      }
      const actDetail = Array.isArray(importedRawChecklists)
        ? `${normalized.length} Projects, ${restoredChkCount} QA Checklists`
        : `${normalized.length} Projects`;
      Storage.addActivity('Restored Workspace Backup', actDetail);

      closeImportPreviewModal();
      if (qaRunnerController) {
        if (typeof qaRunnerController.syncFromStorage === 'function') {
          qaRunnerController.syncFromStorage();
        } else {
          qaRunnerController.refreshGlobalBadgesAndBanners();
        }
      }
      addNotification({
        title: 'Backup Restored',
        message: `Restored ${actDetail}. Pre-restore rollback snapshot saved.`,
        type: 'import',
        link: { view: 'data' }
      });
      showToast(`Restored ${actDetail}. Pre-restore rollback snapshot saved.`, 'success');
      renderDashboard();
      renderDataWorkspace();
    } else {
      // MERGE Strategy
      const existingIds = new Set(currentProjects.map(p => p.id));
      const existingNames = new Set(currentProjects.map(p => (p.name || '').trim().toLowerCase()));

      const processedImported = importedRaw.map((p, idx) => {
        const newProj = { ...p };
        if (!newProj.id || existingIds.has(newProj.id)) {
          newProj.id = 'proj_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substring(2, 6);
        }
        if (newProj.name && existingNames.has(newProj.name.trim().toLowerCase())) {
          newProj.name = `${newProj.name} (Imported)`;
        }
        return newProj;
      });

      if (processedImported.length > 0) {
        const merged = [...currentProjects, ...processedImported];
        const saveMergedRes = Storage.saveProjects(merged);
        if (!saveMergedRes.ok) {
          showToast(`Merge import failed: ${saveMergedRes.error}`, 'error');
          return;
        }
        const normalized = Storage.getProjects();
        Storage.saveProjects(normalized);
      }

      let mergedChkCount = 0;
      let finalMergedChecklists = currentChecklists;
      if (Array.isArray(importedRawChecklists) && importedRawChecklists.length > 0) {
        const existingChkIds = new Set(currentChecklists.map(c => c.id));
        const existingChkTitles = new Set(currentChecklists.map(c => (c.title || '').trim().toLowerCase()));
        const processedChks = importedRawChecklists
          .map((c, idx) => normalizeChecklistRecord(c, idx))
          .filter(Boolean)
          .map(chk => {
            const copy = { ...chk };
            if (!copy.id || existingChkIds.has(copy.id)) {
              copy.id = generateStableId('chk');
            }
            existingChkIds.add(copy.id);
            if (copy.title && existingChkTitles.has(copy.title.trim().toLowerCase())) {
              copy.title = `${copy.title} (Imported)`;
            }
            existingChkTitles.add((copy.title || '').trim().toLowerCase());
            return copy;
          });
        finalMergedChecklists = [...processedChks, ...currentChecklists];
        const chkSaveRes = saveAllChecklists(finalMergedChecklists);
        if (!chkSaveRes.ok) {
          if (processedImported.length > 0) {
            Storage.saveProjects(currentProjects);
          }
          showToast(`Checklist merge failed: ${chkSaveRes.error}`, 'error');
          return;
        }
        mergedChkCount = processedChks.length;
      }

      // If no active checklist was set prior to merge and backup provides one (or checklists were merged), reconcile active runner state
      if (!currentActiveRunner.activeChecklistId && (hasQaActiveRunner || mergedChkCount > 0)) {
        replaceActiveRunnerState(
          hasQaActiveRunner ? importedRawRunner : currentActiveRunner,
          finalMergedChecklists
        );
      }

      const mergeSummary = mergedChkCount > 0
        ? `${processedImported.length} Projects, ${mergedChkCount} QA Checklists`
        : `${processedImported.length} Projects`;
      Storage.addActivity('Merged Import', mergeSummary);

      closeImportPreviewModal();
      if (qaRunnerController) {
        if (typeof qaRunnerController.syncFromStorage === 'function') {
          qaRunnerController.syncFromStorage();
        } else {
          qaRunnerController.refreshGlobalBadgesAndBanners();
        }
      }
      addNotification({
        title: 'Data Merged',
        message: `Merged ${mergeSummary} into workspace.`,
        type: 'import',
        link: { view: 'data' }
      });
      showToast(`Merged ${mergeSummary} into workspace.`, 'success');
      renderDashboard();
      renderDataWorkspace();
    }
  }

  function executeRollback() {
    const snapshot = Storage.getRollbackSnapshot();
    if (!snapshot || (!Array.isArray(snapshot.projects) && !Array.isArray(snapshot.qaChecklists))) {
      showToast('No valid recovery snapshot available to roll back to.', 'warning');
      return;
    }

    const prevProjects = Storage.getProjects();
    const prevChecklists = loadAllChecklists().checklists;
    const prevRunnerState = getActiveRunnerState();

    const restoredProjects = Array.isArray(snapshot.projects) ? snapshot.projects : [];
    const saveProjRes = Storage.saveProjects(restoredProjects);
    if (!saveProjRes.ok) {
      showToast(`Rollback failed: ${saveProjRes.error}. Recovery snapshot preserved.`, 'error');
      return;
    }

    const restoredChecklists = Array.isArray(snapshot.qaChecklists)
      ? snapshot.qaChecklists
      : prevChecklists;

    if (Array.isArray(snapshot.qaChecklists)) {
      const chkSaveRes = saveAllChecklists(restoredChecklists);
      if (!chkSaveRes.ok) {
        Storage.saveProjects(prevProjects);
        showToast(`Checklist rollback failed: ${chkSaveRes.error}. Recovery snapshot preserved.`, 'error');
        return;
      }
    }

    // Restore active runner state from snapshot (or reconcile with restored checklists if older snapshot)
    const runnerSaveRes = replaceActiveRunnerState(
      snapshot.qaActiveRunner !== undefined ? snapshot.qaActiveRunner : prevRunnerState,
      restoredChecklists
    );
    if (!runnerSaveRes.ok) {
      Storage.saveProjects(prevProjects);
      saveAllChecklists(prevChecklists);
      replaceActiveRunnerState(prevRunnerState, prevChecklists);
      showToast(`Runner state rollback failed: ${runnerSaveRes.error}. Recovery snapshot preserved.`, 'error');
      return;
    }

    if (Array.isArray(snapshot.activities)) {
      Storage.saveActivities(snapshot.activities);
    }
    const chkSuffix = Array.isArray(snapshot.qaChecklists)
      ? `, ${snapshot.qaChecklists.length} QA Checklists`
      : '';
    Storage.addActivity('Rolled Back Workspace', `${restoredProjects.length} Projects${chkSuffix} Restored`);
    Storage.clearRollbackSnapshot();

    if (qaRunnerController) {
      if (typeof qaRunnerController.syncFromStorage === 'function') {
        qaRunnerController.syncFromStorage();
      } else {
        qaRunnerController.refreshGlobalBadgesAndBanners();
      }
    }
    showToast(`Workspace rolled back to snapshot (${restoredProjects.length} projects${chkSuffix} restored).`, 'info');
    renderDashboard();
    renderDataWorkspace();
  }

  function openResetConfirmModal() {
    if (!DOM.resetConfirmModal) return;
    if (DOM.resetConfirmCheckbox) DOM.resetConfirmCheckbox.checked = false;
    if (DOM.resetModalConfirmBtn) DOM.resetModalConfirmBtn.disabled = true;
    DOM.resetConfirmModal.classList.add('open');
    DOM.resetConfirmModal.setAttribute('aria-hidden', 'false');
  }

  function closeResetConfirmModal() {
    if (!DOM.resetConfirmModal) return;
    DOM.resetConfirmModal.classList.remove('open');
    DOM.resetConfirmModal.setAttribute('aria-hidden', 'true');
    if (DOM.resetConfirmCheckbox) DOM.resetConfirmCheckbox.checked = false;
    if (DOM.resetModalConfirmBtn) DOM.resetModalConfirmBtn.disabled = true;
  }

  function executeWorkspaceReset() {
    const currentProjects = Storage.getProjects();
    const currentActivities = Storage.getActivities();
    const currentChecklists = loadAllChecklists().checklists;
    const currentActiveRunner = getActiveRunnerState();
    Storage.saveRollbackSnapshot(currentProjects, currentActivities, currentChecklists, currentActiveRunner);

    const pRes = Storage.saveProjects([]);
    const cRes = saveAllChecklists([]);
    const rRes = replaceActiveRunnerState({ activeChecklistId: null, lastQaView: null }, []);
    if (!pRes.ok || !cRes.ok || !rRes.ok) {
      Storage.saveProjects(currentProjects);
      saveAllChecklists(currentChecklists);
      replaceActiveRunnerState(currentActiveRunner, currentChecklists);
      showToast('Reset failed due to storage error. Existing workspace preserved.', 'error');
      return;
    }

    Storage.clearActivities();
    closeResetConfirmModal();

    if (qaRunnerController) {
      if (typeof qaRunnerController.syncFromStorage === 'function') {
        qaRunnerController.syncFromStorage();
      } else {
        qaRunnerController.refreshGlobalBadgesAndBanners();
      }
    }
    showToast('All workspace projects, QA checklists, and test data have been cleared.', 'warning');
    renderDashboard();
    renderDataWorkspace();
  }

  // ==========================================================================
  // Navigation & View Routing
  // ==========================================================================
  function switchView(viewName, optArg = null) {
    State.currentView = viewName;

    DOM.navLinks.forEach(link => {
      const target = link.getAttribute('data-view');
      if (target === viewName || (viewName === 'project-details' && target === 'projects')) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    DOM.viewSections.forEach(section => {
      if (section.id === `view-${viewName}`) {
        section.classList.add('active');
      } else {
        section.classList.remove('active');
      }
    });

    const info = VIEW_TITLES[viewName] || VIEW_TITLES.dashboard;
    if (DOM.pageTitle) DOM.pageTitle.textContent = info.title;
    if (DOM.pageSubtitle) DOM.pageSubtitle.textContent = info.subtitle;

    closeMobileSidebar();

    if (viewName === 'dashboard') {
      renderDashboard();
    } else if (viewName === 'projects') {
      renderMyProjects();
    } else if (viewName === 'plans') {
      if (optArg) {
        if (State.activePlanProjectId !== optArg) {
          State.activeSuiteId = null;
        }
        State.activePlanProjectId = optArg;
      }
      renderTestPlansWorkspace();
    } else if (viewName === 'execution') {
      if (optArg) {
        if (State.activeExecProjectId !== optArg) {
          State.execPhaseFilter = 'ALL';
          State.execSuiteFilter = 'ALL';
        }
        State.activeExecProjectId = optArg;
      }
      renderTestExecutionWorkspace();
    } else if (viewName === 'defects') {
      if (optArg) State.activeDefectsProjectId = optArg;
      renderDefectsWorkspace();
    } else if (viewName === 'reports') {
      if (optArg) State.reportsProjectId = optArg;
      renderReportsWorkspace();
    } else if (viewName === 'data') {
      renderDataWorkspace();
    } else if (viewName === 'checklist-generator') {
      if (qaRunnerController) {
        qaRunnerController.recordLastQaView('checklist-generator');
        qaRunnerController.refreshGlobalBadgesAndBanners();
      }
    } else if (viewName === 'my-checklists') {
      if (qaRunnerController) {
        qaRunnerController.recordLastQaView('my-checklists');
        qaRunnerController.renderMyChecklistsView();
      }
    } else if (viewName === 'qa-runner') {
      if (qaRunnerController) {
        qaRunnerController.recordLastQaView('qa-runner');
        qaRunnerController.renderRunnerView();
      }
    } else if (viewName === 'settings') {
      renderSettingsWorkspace();
    }
  }

  function openMobileSidebar() {
    if (DOM.sidebar) DOM.sidebar.classList.add('open');
    if (DOM.sidebarOverlay) DOM.sidebarOverlay.classList.add('active');
    document.body.classList.add('mobile-nav-open');
  }

  function closeMobileSidebar() {
    if (DOM.sidebar) DOM.sidebar.classList.remove('open');
    if (DOM.sidebarOverlay) DOM.sidebarOverlay.classList.remove('active');
    document.body.classList.remove('mobile-nav-open');
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    Storage.saveTheme(theme);
    if (DOM.settingsThemeSelect) {
      DOM.settingsThemeSelect.value = theme;
    }
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  }

  // ==========================================================================
  // Phase 5: Workspace Settings Controller (QAV-ISS-010)
  // ==========================================================================
  function applyPreferences(prefs, showIndicator = false) {
    const cleanPrefs = Storage.savePreferences(prefs);
    State.preferences = cleanPrefs;

    if (cleanPrefs.density) {
      document.documentElement.setAttribute('data-density', cleanPrefs.density);
    }

    if (showIndicator && DOM.settingsSaveIndicator) {
      DOM.settingsSaveIndicator.style.display = 'inline-flex';
      DOM.settingsSaveIndicator.style.opacity = '1';
      clearTimeout(State._settingsSaveTimeout);
      State._settingsSaveTimeout = setTimeout(() => {
        if (DOM.settingsSaveIndicator) {
          DOM.settingsSaveIndicator.style.opacity = '0';
          setTimeout(() => {
            if (DOM.settingsSaveIndicator) DOM.settingsSaveIndicator.style.display = 'none';
          }, 300);
        }
      }, 2000);
    }

    return cleanPrefs;
  }

  function renderSettingsWorkspace() {
    if (!State.preferences) {
      State.preferences = Storage.getPreferences();
    }
    const prefs = State.preferences;

    // 1. Controls reflection
    if (DOM.settingsThemeSelect) {
      DOM.settingsThemeSelect.value = Storage.getTheme();
    }
    if (DOM.settingsDensitySelect) {
      DOM.settingsDensitySelect.value = prefs.density || 'comfortable';
    }
    if (DOM.settingsProjectSortSelect) {
      DOM.settingsProjectSortSelect.value = prefs.defaultProjectSort || 'newest';
    }
    if (DOM.settingsCasePrioritySelect) {
      DOM.settingsCasePrioritySelect.value = prefs.defaultCasePriority || 'Medium';
    }
    if (DOM.settingsAutopassStepsToggle) {
      DOM.settingsAutopassStepsToggle.checked = Boolean(prefs.autopassSteps);
    }
    if (DOM.settingsActionToastsToggle) {
      DOM.settingsActionToastsToggle.checked = Boolean(prefs.actionToasts);
    }

    // 2. Storage Health Overview
    const footprint = calculateQavoraStorageFootprint();
    if (DOM.settingsStorageUsed) {
      DOM.settingsStorageUsed.textContent = footprint.formattedKB;
    }
    if (DOM.settingsStoragePercent) {
      DOM.settingsStoragePercent.textContent = footprint.totalBytes === 0
        ? '0% used of ~5 MB'
        : `${footprint.clampedPercent.toFixed(1)}% of ~5 MB est. quota`;
    }
    const projects = Storage.getProjects();
    if (DOM.settingsCountProjects) {
      DOM.settingsCountProjects.textContent = String(projects.length);
    }
    const chkListRes = loadAllChecklists();
    const chkCount = Array.isArray(chkListRes?.checklists) ? chkListRes.checklists.length : 0;
    if (DOM.settingsCountChecklists) {
      DOM.settingsCountChecklists.textContent = String(chkCount);
    }
    let totalCases = 0;
    projects.forEach(p => {
      if (Array.isArray(p.testSuites)) {
        p.testSuites.forEach(s => {
          if (Array.isArray(s.testCases)) totalCases += s.testCases.length;
        });
      }
    });
    if (DOM.settingsCountCases) {
      DOM.settingsCountCases.textContent = String(totalCases);
    }
  }

  // ==========================================================================
  // Phase 5: Notification System Controller (QAV-ISS-011)
  // ==========================================================================
  function formatRelativeTime(isoString) {
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 45) return 'Just now';
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHours = Math.floor(diffMin / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ago`;
    } catch (_err) {
      return '';
    }
  }

  function getNotificationIconSvg(type) {
    switch (type) {
      case 'project':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
      case 'execution':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
      case 'defect':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
      case 'promotion':
      case 'checklist':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      case 'backup':
      case 'import':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
      default:
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`;
    }
  }

  function getNotificationIconClass(type) {
    switch (type) {
      case 'project': return 'icon-blue';
      case 'execution': return 'icon-purple';
      case 'defect': return 'icon-red';
      case 'promotion':
      case 'checklist': return 'icon-green';
      case 'backup':
      case 'import': return 'icon-blue';
      default: return 'icon-purple';
    }
  }

  function addNotification({ title, message, type = 'system', link = null }) {
    if (!title || !message) return;
    const notifications = Storage.getNotifications();
    const now = new Date().toISOString();

    // Deduplication check: prevent identical notification within 2 seconds
    const isDuplicate = notifications.length > 0 &&
      notifications[0].title === title &&
      notifications[0].message === message &&
      notifications[0].type === type &&
      (Date.now() - new Date(notifications[0].timestamp).getTime() < 2000);

    if (isDuplicate) return;

    const newNotif = {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      title: String(title),
      message: String(message),
      type: String(type),
      timestamp: now,
      read: false,
      link: link && typeof link === 'object' ? link : null
    };

    notifications.unshift(newNotif);
    const saved = Storage.saveNotifications(notifications);
    State.notifications = saved;
    updateNotificationUI();
  }

  function markNotificationAsRead(id) {
    const list = Storage.getNotifications();
    const target = list.find(n => n.id === id);
    if (target) {
      target.read = true;
      State.notifications = Storage.saveNotifications(list);
      updateNotificationUI();
    }
  }

  function markAllNotificationsAsRead() {
    const list = Storage.getNotifications();
    let hasChanges = false;
    list.forEach(n => {
      if (!n.read) {
        n.read = true;
        hasChanges = true;
      }
    });
    if (hasChanges) {
      State.notifications = Storage.saveNotifications(list);
      updateNotificationUI();
    }
  }

  function clearAllNotifications() {
    State.notifications = Storage.saveNotifications([]);
    updateNotificationUI();
  }

  function dismissNotification(id) {
    const list = Storage.getNotifications();
    const filtered = list.filter(n => n.id !== id);
    State.notifications = Storage.saveNotifications(filtered);
    updateNotificationUI();
  }

  function toggleNotificationPanel(forceState) {
    if (!DOM.notificationPanel) return;
    const shouldOpen = typeof forceState === 'boolean'
      ? forceState
      : DOM.notificationPanel.style.display === 'none';

    if (shouldOpen) {
      DOM.notificationPanel.style.display = 'flex';
      if (DOM.notificationBtn) DOM.notificationBtn.setAttribute('aria-expanded', 'true');
      State.isNotificationPanelOpen = true;
      updateNotificationUI();
    } else {
      DOM.notificationPanel.style.display = 'none';
      if (DOM.notificationBtn) DOM.notificationBtn.setAttribute('aria-expanded', 'false');
      State.isNotificationPanelOpen = false;
    }
  }

  function handleNotificationNavigation(link) {
    if (!link || typeof link !== 'object') return;
    toggleNotificationPanel(false);

    const { view, projectId } = link;
    if (view === 'project-details') {
      const projects = Storage.getProjects();
      const proj = projects.find(p => p.id === projectId);
      if (proj) {
        openProjectDetails(projectId);
      } else {
        showToast('Referenced project is no longer available.', 'warning');
      }
    } else if (view === 'execution') {
      const projects = Storage.getProjects();
      if (projectId && projects.some(p => p.id === projectId)) {
        switchView('execution', projectId);
      } else {
        switchView('execution');
      }
    } else if (view === 'defects') {
      const projects = Storage.getProjects();
      if (projectId && projects.some(p => p.id === projectId)) {
        switchView('defects', projectId);
      } else {
        switchView('defects');
      }
    } else if (view === 'plans') {
      const projects = Storage.getProjects();
      if (projectId && projects.some(p => p.id === projectId)) {
        switchView('plans', projectId);
      } else {
        switchView('plans');
      }
    } else if (view === 'my-checklists') {
      switchView('my-checklists');
    } else if (view === 'data') {
      switchView('data');
    } else if (view === 'settings') {
      switchView('settings');
    } else if (view === 'projects') {
      switchView('projects');
    } else if (view === 'dashboard') {
      switchView('dashboard');
    } else if (view === 'checklist-generator') {
      switchView('checklist-generator');
    } else if (view === 'qa-runner') {
      switchView('qa-runner');
    } else if (view === 'reports') {
      const projects = Storage.getProjects();
      if (projectId && projects.some(p => p.id === projectId)) {
        switchView('reports', projectId);
      } else {
        switchView('reports');
      }
    } else if (view && VIEW_TITLES[view]) {
      switchView(view);
    } else {
      showToast('Referenced workspace is not available.', 'warning');
    }
  }

  function updateNotificationUI() {
    const notifications = State.notifications || Storage.getNotifications();
    State.notifications = notifications;

    const unreadCount = notifications.filter(n => !n.read).length;

    if (DOM.notificationCountBadge) {
      if (unreadCount > 0) {
        DOM.notificationCountBadge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        DOM.notificationCountBadge.style.display = 'flex';
      } else {
        DOM.notificationCountBadge.style.display = 'none';
      }
    }

    if (DOM.notificationIndicator) {
      DOM.notificationIndicator.style.display = unreadCount > 0 ? 'block' : 'none';
    }

    if (DOM.notificationUnreadCount) {
      if (unreadCount > 0) {
        DOM.notificationUnreadCount.textContent = `${unreadCount} new`;
        DOM.notificationUnreadCount.style.display = 'inline-block';
      } else {
        DOM.notificationUnreadCount.style.display = 'none';
      }
    }

    if (!DOM.notificationList) return;

    if (notifications.length === 0) {
      DOM.notificationList.innerHTML = `
        <div class="notification-empty-state">
          <div class="notification-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
          </div>
          <div class="notification-empty-title">No notifications</div>
          <div class="notification-empty-text">You're all caught up with your QA testing updates.</div>
        </div>
      `;
      return;
    }

    let html = '';
    notifications.forEach(item => {
      const iconClass = getNotificationIconClass(item.type);
      const iconSvg = getNotificationIconSvg(item.type);
      const timeStr = formatRelativeTime(item.timestamp);
      const unreadClass = item.read ? '' : 'unread';
      const typeLabel = (item.type || 'system').toUpperCase();

      html += `
        <div class="notification-item ${unreadClass}" data-id="${escapeHTML(item.id)}" role="article">
          <div class="notification-item-icon ${iconClass}">
            ${iconSvg}
          </div>
          <div class="notification-item-body">
            <div class="notification-item-header">
              <span class="notification-item-title">${escapeHTML(item.title)}</span>
              <span class="notification-item-time">${escapeHTML(timeStr)}</span>
            </div>
            <div class="notification-item-msg">${escapeHTML(item.message)}</div>
            <div class="notification-item-actions">
              <span class="notification-item-badge">${escapeHTML(typeLabel)}</span>
              <button type="button" class="notification-item-dismiss" data-dismiss-id="${escapeHTML(item.id)}" title="Dismiss notification" aria-label="Dismiss">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>
        </div>
      `;
    });

    DOM.notificationList.innerHTML = html;

    // Attach click handlers to items and dismiss buttons
    DOM.notificationList.querySelectorAll('.notification-item').forEach(el => {
      const id = el.getAttribute('data-id');
      const item = notifications.find(n => n.id === id);

      el.addEventListener('click', (e) => {
        if (e.target.closest('.notification-item-dismiss')) return;
        if (item) {
          markNotificationAsRead(item.id);
          if (item.link) {
            handleNotificationNavigation(item.link);
          }
        }
      });
    });

    DOM.notificationList.querySelectorAll('.notification-item-dismiss').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-dismiss-id');
        if (id) dismissNotification(id);
      });
    });
  }

  // ==========================================================================
  // Event Listeners Binding
  // ==========================================================================
  function bindEvents() {
    // 1. Navigation clicks
    DOM.navLinks.forEach(link => {
      link.addEventListener('click', () => {
        const view = link.getAttribute('data-view');
        if (view) switchView(view);
      });
    });

    document.querySelectorAll('.back-to-dashboard-btn').forEach(btn => {
      btn.addEventListener('click', () => switchView('dashboard'));
    });

    if (DOM.viewAllProjectsBtn) {
      DOM.viewAllProjectsBtn.addEventListener('click', () => switchView('projects'));
    }

    // 2. Project Creation Entry Points
    if (DOM.headerCreateBtn) DOM.headerCreateBtn.addEventListener('click', () => openProjectModal(null));
    if (DOM.heroCreateBtn) DOM.heroCreateBtn.addEventListener('click', () => openProjectModal(null));
    if (DOM.panelNewProjectBtn) DOM.panelNewProjectBtn.addEventListener('click', () => openProjectModal(null));
    if (DOM.projectsCreateBtn) DOM.projectsCreateBtn.addEventListener('click', () => openProjectModal(null));
    document.querySelectorAll('.plans-create-project-btn').forEach(btn => {
      btn.addEventListener('click', () => openProjectModal(null));
    });

    // 3. My Projects Search & Filters
    if (DOM.projectSearchInput) {
      DOM.projectSearchInput.addEventListener('input', (e) => {
        State.searchQuery = e.target.value;
        renderMyProjects();
      });
    }

    if (DOM.searchClearBtn) {
      DOM.searchClearBtn.addEventListener('click', () => {
        State.searchQuery = '';
        if (DOM.projectSearchInput) DOM.projectSearchInput.value = '';
        renderMyProjects();
      });
    }

    if (DOM.projectFilterType) {
      DOM.projectFilterType.addEventListener('change', (e) => {
        State.typeFilter = e.target.value;
        renderMyProjects();
      });
    }

    if (DOM.projectFilterStatus) {
      DOM.projectFilterStatus.addEventListener('change', (e) => {
        State.statusFilter = e.target.value;
        renderMyProjects();
      });
    }

    if (DOM.projectSortBy) {
      DOM.projectSortBy.addEventListener('change', (e) => {
        State.sortBy = e.target.value;
        State._hasCustomSort = true;
        renderMyProjects();
      });
    }

    if (DOM.projectsClearFiltersBtn) {
      DOM.projectsClearFiltersBtn.addEventListener('click', resetAllFilters);
    }

    // Top Quick Search Input
    if (DOM.topQuickSearch) {
      DOM.topQuickSearch.addEventListener('input', (e) => {
        State.searchQuery = e.target.value;
        if (DOM.projectSearchInput) DOM.projectSearchInput.value = e.target.value;
        if (State.currentView !== 'projects') {
          switchView('projects');
        } else {
          renderMyProjects();
        }
      });
    }

    // 4. Project Details View Actions
    if (DOM.detailBackCrumb) DOM.detailBackCrumb.addEventListener('click', () => switchView('projects'));
    if (DOM.detailBackBtn) DOM.detailBackBtn.addEventListener('click', () => switchView('projects'));
    if (DOM.detailEditBtn) {
      DOM.detailEditBtn.addEventListener('click', () => {
        if (State.currentDetailProjectId) openProjectModal(State.currentDetailProjectId);
      });
    }
    if (DOM.detailDeleteBtn) {
      DOM.detailDeleteBtn.addEventListener('click', () => {
        if (State.currentDetailProjectId) requestUniversalDelete('project', State.currentDetailProjectId, null);
      });
    }
    if (DOM.detailExecBtn) {
      DOM.detailExecBtn.addEventListener('click', () => {
        if (State.currentDetailProjectId) switchView('execution', State.currentDetailProjectId);
      });
    }
    if (DOM.detailDefectsBtn) {
      DOM.detailDefectsBtn.addEventListener('click', () => {
        if (State.currentDetailProjectId) switchView('defects', State.currentDetailProjectId);
      });
    }
    if (DOM.detailOpenPlanBtn) {
      DOM.detailOpenPlanBtn.addEventListener('click', () => {
        if (State.currentDetailProjectId) navigateToProjectPlan(State.currentDetailProjectId);
      });
    }
    if (DOM.detailGotoPlansBtn) {
      DOM.detailGotoPlansBtn.addEventListener('click', () => {
        if (State.currentDetailProjectId) navigateToProjectPlan(State.currentDetailProjectId);
      });
    }
    if (DOM.detailQuickAddPhaseBtn) {
      DOM.detailQuickAddPhaseBtn.addEventListener('click', () => {
        if (State.currentDetailProjectId) {
          State.activePlanProjectId = State.currentDetailProjectId;
          openPhaseModal(null);
        }
      });
    }
    if (DOM.detailQuickAddSuiteBtn) {
      DOM.detailQuickAddSuiteBtn.addEventListener('click', () => {
        if (State.currentDetailProjectId) {
          State.activePlanProjectId = State.currentDetailProjectId;
          openSuiteModal(null, null);
        }
      });
    }

    // 5. Test Plans Top Bar Controls
    if (DOM.plansProjectSelect) {
      DOM.plansProjectSelect.addEventListener('change', (e) => {
        State.activePlanProjectId = e.target.value;
        State.activeSuiteId = null;
        renderTestPlansWorkspace();
      });
    }

    if (DOM.plansEditPlanBtn) {
      DOM.plansEditPlanBtn.addEventListener('click', openTestPlanModal);
    }

    if (DOM.plansAddPhaseBtn) {
      DOM.plansAddPhaseBtn.addEventListener('click', () => openPhaseModal(null));
    }

    if (DOM.phasesAddBtnSecondary) {
      DOM.phasesAddBtnSecondary.addEventListener('click', () => openPhaseModal(null));
    }

    // 6. Suite Cases Explorer Controls
    if (DOM.casesBackToPhasesBtn) {
      DOM.casesBackToPhasesBtn.addEventListener('click', () => {
        State.activeSuiteId = null;
        renderTestPlansWorkspace();
      });
    }

    if (DOM.suiteEditThisBtn) {
      DOM.suiteEditThisBtn.addEventListener('click', () => {
        if (State.activeSuiteId) openSuiteModal(State.activeSuiteId);
      });
    }

    if (DOM.suiteAddCaseBtn) {
      DOM.suiteAddCaseBtn.addEventListener('click', () => {
        if (State.activeSuiteId) openTestCaseModal(null, State.activeSuiteId);
      });
    }

    if (DOM.caseSearchInput) {
      DOM.caseSearchInput.addEventListener('input', (e) => {
        State.caseSearchQuery = e.target.value;
        renderTestPlansWorkspace();
      });
    }

    if (DOM.caseSearchClearBtn) {
      DOM.caseSearchClearBtn.addEventListener('click', () => {
        State.caseSearchQuery = '';
        if (DOM.caseSearchInput) DOM.caseSearchInput.value = '';
        renderTestPlansWorkspace();
      });
    }

    if (DOM.caseFilterPriority) {
      DOM.caseFilterPriority.addEventListener('change', (e) => {
        State.casePriorityFilter = e.target.value;
        renderTestPlansWorkspace();
      });
    }

    if (DOM.caseFilterCategory) {
      DOM.caseFilterCategory.addEventListener('change', (e) => {
        State.caseCategoryFilter = e.target.value;
        renderTestPlansWorkspace();
      });
    }

    if (DOM.caseSortBy) {
      DOM.caseSortBy.addEventListener('change', (e) => {
        State.caseSortBy = e.target.value;
        renderTestPlansWorkspace();
      });
    }

    if (DOM.caseClearFiltersBtn) {
      DOM.caseClearFiltersBtn.addEventListener('click', resetCaseFilters);
    }

    // 7. Dynamic Test Steps Builder button
    if (DOM.btnAddStep) {
      DOM.btnAddStep.addEventListener('click', () => {
        State.modalSteps.push({
          id: 'step_' + Date.now() + '_' + State.modalSteps.length,
          action: '',
          testData: ''
        });
        renderModalStepsBuilder();
      });
    }

    // Suite Category dropdown toggle custom input
    if (DOM.suiteCategorySelect) {
      DOM.suiteCategorySelect.addEventListener('change', (e) => {
        if (DOM.suiteCustomCatGroup) {
          DOM.suiteCustomCatGroup.style.display = e.target.value === 'CUSTOM' ? 'flex' : 'none';
        }
      });
    }

    // 8. Modals Form Submissions & Cancels
    // Project Modal
    if (DOM.modalCloseBtn) DOM.modalCloseBtn.addEventListener('click', closeProjectModal);
    if (DOM.modalCancelBtn) DOM.modalCancelBtn.addEventListener('click', closeProjectModal);
    if (DOM.createProjectForm) DOM.createProjectForm.addEventListener('submit', handleCreateOrEditProjectSubmit);

    // Test Plan Modal
    if (DOM.testplanModalClose) DOM.testplanModalClose.addEventListener('click', closeTestPlanModal);
    if (DOM.testplanModalCancel) DOM.testplanModalCancel.addEventListener('click', closeTestPlanModal);
    if (DOM.testplanForm) DOM.testplanForm.addEventListener('submit', handleSaveTestPlanSubmit);

    // Phase Modal
    if (DOM.phaseModalClose) DOM.phaseModalClose.addEventListener('click', closePhaseModal);
    if (DOM.phaseModalCancel) DOM.phaseModalCancel.addEventListener('click', closePhaseModal);
    if (DOM.phaseForm) DOM.phaseForm.addEventListener('submit', handleSavePhaseSubmit);

    // Suite Modal
    if (DOM.suiteModalClose) DOM.suiteModalClose.addEventListener('click', closeSuiteModal);
    if (DOM.suiteModalCancel) DOM.suiteModalCancel.addEventListener('click', closeSuiteModal);
    if (DOM.suiteForm) DOM.suiteForm.addEventListener('submit', handleSaveSuiteSubmit);

    // Case Modal
    if (DOM.caseModalClose) DOM.caseModalClose.addEventListener('click', closeTestCaseModal);
    if (DOM.caseModalCancel) DOM.caseModalCancel.addEventListener('click', closeTestCaseModal);
    if (DOM.caseForm) DOM.caseForm.addEventListener('submit', handleSaveTestCaseSubmit);

    // Case View Modal
    if (DOM.viewCaseClose) DOM.viewCaseClose.addEventListener('click', closeTestCaseViewModal);

    // Universal Delete Modal
    if (DOM.deleteCloseBtn) DOM.deleteCloseBtn.addEventListener('click', closeDeleteModal);
    if (DOM.deleteCancelBtn) DOM.deleteCancelBtn.addEventListener('click', closeDeleteModal);
    if (DOM.deleteConfirmBtn) DOM.deleteConfirmBtn.addEventListener('click', executeUniversalDelete);

    // Execution Workspace Top Bar & Actions (Prompt 4)
    if (DOM.execProjectSelect) {
      DOM.execProjectSelect.addEventListener('change', (e) => {
        State.activeExecProjectId = e.target.value;
        State.execPhaseFilter = 'ALL';
        State.execSuiteFilter = 'ALL';
        renderTestExecutionWorkspace();
      });
    }

    if (DOM.execJumpDefectsBtn) {
      DOM.execJumpDefectsBtn.addEventListener('click', () => {
        switchView('defects', State.activeExecProjectId);
      });
    }

    if (DOM.execJumpPlansBtn) {
      DOM.execJumpPlansBtn.addEventListener('click', () => {
        switchView('plans', State.activeExecProjectId);
      });
    }

    // Execution Workspace Filters & Search
    if (DOM.execFilterPhase) {
      DOM.execFilterPhase.addEventListener('change', (e) => {
        State.execPhaseFilter = e.target.value;
        if (State.execPhaseFilter !== 'ALL' && State.execSuiteFilter !== 'ALL') {
          const projects = Storage.getProjects();
          const project = projects.find(p => p.id === State.activeExecProjectId);
          const suites = project?.testSuites || [];
          const suiteInPhase = suites.some(
            s => s.id === State.execSuiteFilter && s.phaseId === State.execPhaseFilter
          );
          if (!suiteInPhase) {
            State.execSuiteFilter = 'ALL';
          }
        }
        renderTestExecutionWorkspace();
      });
    }

    if (DOM.execFilterSuite) {
      DOM.execFilterSuite.addEventListener('change', (e) => {
        State.execSuiteFilter = e.target.value;
        renderTestExecutionWorkspace();
      });
    }

    if (DOM.execFilterStatus) {
      DOM.execFilterStatus.addEventListener('change', (e) => {
        State.execStatusFilter = e.target.value;
        renderTestExecutionWorkspace();
      });
    }

    if (DOM.execFilterPriority) {
      DOM.execFilterPriority.addEventListener('change', (e) => {
        State.execPriorityFilter = e.target.value;
        renderTestExecutionWorkspace();
      });
    }

    if (DOM.execFilterCategory) {
      DOM.execFilterCategory.addEventListener('change', (e) => {
        State.execCategoryFilter = e.target.value;
        renderTestExecutionWorkspace();
      });
    }

    if (DOM.execSortBy) {
      DOM.execSortBy.addEventListener('change', (e) => {
        State.execSortBy = e.target.value;
        renderTestExecutionWorkspace();
      });
    }

    if (DOM.execSearchInput) {
      DOM.execSearchInput.addEventListener('input', (e) => {
        State.execSearchQuery = e.target.value;
        renderTestExecutionWorkspace();
      });
    }

    if (DOM.execSearchClearBtn) {
      DOM.execSearchClearBtn.addEventListener('click', () => {
        State.execSearchQuery = '';
        if (DOM.execSearchInput) DOM.execSearchInput.value = '';
        renderTestExecutionWorkspace();
      });
    }

    if (DOM.execClearFiltersBtn) {
      DOM.execClearFiltersBtn.addEventListener('click', resetExecFilters);
    }

    // Execution Modal Actions (Prompt 4)
    if (DOM.execModalClose) DOM.execModalClose.addEventListener('click', closeExecutionModal);
    if (DOM.execModalCancel) DOM.execModalCancel.addEventListener('click', closeExecutionModal);
    if (DOM.executionForm) DOM.executionForm.addEventListener('submit', handleSaveExecutionSubmit);

    if (DOM.execStatusSelect) {
      DOM.execStatusSelect.addEventListener('change', (e) => {
        handleExecStatusChange(e.target.value);
      });
    }

    if (DOM.btnPassAllSteps) {
      DOM.btnPassAllSteps.addEventListener('click', () => {
        if (!State.modalExecContext || !Array.isArray(State.modalExecContext.steps)) {
          return;
        }
        State.modalExecContext.steps.forEach(st => {
          if (st && typeof st === 'object') {
            st.status = 'completed';
          }
        });
        renderExecutionStepsList();
      });
    }

    if (DOM.btnResetAllSteps) {
      DOM.btnResetAllSteps.addEventListener('click', () => {
        if (!State.modalExecContext || !Array.isArray(State.modalExecContext.steps)) {
          return;
        }
        State.modalExecContext.steps.forEach(st => {
          if (st && typeof st === 'object') {
            st.status = 'untested';
          }
        });
        renderExecutionStepsList();
      });
    }

    if (DOM.execLogDefectToggle) {
      DOM.execLogDefectToggle.addEventListener('change', (e) => {
        if (DOM.execDefectFields) {
          DOM.execDefectFields.style.display = e.target.checked ? 'flex' : 'none';
        }
      });
    }

    // Execution History Modal (Prompt 4)
    if (DOM.historyModalClose) DOM.historyModalClose.addEventListener('click', closeExecutionHistoryModal);
    if (DOM.historyModalCloseBtn) DOM.historyModalCloseBtn.addEventListener('click', closeExecutionHistoryModal);

    // Defects Workspace Controls (Prompt 4)
    if (DOM.defectsProjectSelect) {
      DOM.defectsProjectSelect.addEventListener('change', (e) => {
        State.activeDefectsProjectId = e.target.value;
        renderDefectsWorkspace();
      });
    }

    if (DOM.btnCreateDefect) {
      DOM.btnCreateDefect.addEventListener('click', () => {
        openDefectModal(State.activeDefectsProjectId || null, null);
      });
    }

    if (DOM.defectsFilterSeverity) {
      DOM.defectsFilterSeverity.addEventListener('change', (e) => {
        State.defectSeverityFilter = e.target.value;
        renderDefectsWorkspace();
      });
    }

    if (DOM.defectsFilterStatus) {
      DOM.defectsFilterStatus.addEventListener('change', (e) => {
        State.defectStatusFilter = e.target.value;
        renderDefectsWorkspace();
      });
    }

    if (DOM.defectsSortBy) {
      DOM.defectsSortBy.addEventListener('change', (e) => {
        State.defectSortBy = e.target.value;
        renderDefectsWorkspace();
      });
    }

    if (DOM.defectsSearchInput) {
      DOM.defectsSearchInput.addEventListener('input', (e) => {
        State.defectSearchQuery = e.target.value;
        renderDefectsWorkspace();
      });
    }

    if (DOM.defectsSearchClearBtn) {
      DOM.defectsSearchClearBtn.addEventListener('click', () => {
        State.defectSearchQuery = '';
        if (DOM.defectsSearchInput) DOM.defectsSearchInput.value = '';
        renderDefectsWorkspace();
      });
    }

    if (DOM.defectsClearFiltersBtn) {
      DOM.defectsClearFiltersBtn.addEventListener('click', resetDefectFilters);
    }

    // Defect Modal Form & Controls (Prompt 4)
    if (DOM.defectModalClose) DOM.defectModalClose.addEventListener('click', closeDefectModal);
    if (DOM.defectModalCancel) DOM.defectModalCancel.addEventListener('click', closeDefectModal);
    if (DOM.defectForm) DOM.defectForm.addEventListener('submit', handleSaveDefectSubmit);
    if (DOM.defectProjectSelectField) {
      DOM.defectProjectSelectField.addEventListener('change', (e) => {
        updateDefectModalCasesDropdown(e.target.value, null);
      });
    }

    // Defect View Modal (Prompt 4)
    if (DOM.viewDefectClose) DOM.viewDefectClose.addEventListener('click', closeDefectViewModal);
    if (DOM.viewDefectStatusSelect) {
      DOM.viewDefectStatusSelect.addEventListener('change', (e) => {
        const modal = DOM.defectViewModal;
        const pId = modal?.getAttribute('data-project-id');
        const dId = modal?.getAttribute('data-defect-id');
        if (pId && dId) {
          updateDefectQuickStatus(pId, dId, e.target.value);
        }
      });
    }

    // Backdrop clicks to close modals
    [
      DOM.projectModal,
      DOM.testplanModal,
      DOM.phaseModal,
      DOM.suiteModal,
      DOM.testcaseModal,
      DOM.testcaseViewModal,
      DOM.deleteModal,
      DOM.executionModal,
      DOM.executionHistoryModal,
      DOM.defectModal,
      DOM.defectViewModal,
      DOM.importPreviewModal,
      DOM.resetConfirmModal
    ].forEach(modal => {
      if (modal) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            if (modal === DOM.deleteModal) {
              closeDeleteModal();
            } else if (modal === DOM.resetConfirmModal) {
              closeResetConfirmModal();
            } else {
              modal.classList.remove('open');
              modal.setAttribute('aria-hidden', 'true');
            }
          }
        });
      }
    });

    // Global Keyboard Handlers (Escape to close modals, Cmd+K / Ctrl+K for search)
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (DOM.topQuickSearch) {
          DOM.topQuickSearch.focus();
          DOM.topQuickSearch.select();
        }
        return;
      }

      if (e.key === 'Escape') {
        closeMobileSidebar();
        if (DOM.deleteModal && DOM.deleteModal.classList.contains('open')) {
          closeDeleteModal();
        }
        if (DOM.resetConfirmModal && DOM.resetConfirmModal.classList.contains('open')) {
          closeResetConfirmModal();
        }
        const qaChkDeleteModal = document.getElementById('qa-checklist-delete-modal');
        if (qaChkDeleteModal && qaChkDeleteModal.classList.contains('open')) {
          const cancelBtn = document.getElementById('qa-chk-delete-cancel');
          if (cancelBtn) cancelBtn.click();
        }
        [
          DOM.projectModal,
          DOM.testplanModal,
          DOM.phaseModal,
          DOM.suiteModal,
          DOM.testcaseModal,
          DOM.testcaseViewModal,
          DOM.executionModal,
          DOM.executionHistoryModal,
          DOM.defectModal,
          DOM.defectViewModal,
          DOM.importPreviewModal
        ].forEach(modal => {
          if (modal && modal.classList.contains('open')) {
            modal.classList.remove('open');
            modal.setAttribute('aria-hidden', 'true');
          }
        });
        return;
      }

      if (e.key === 'Tab' && DOM.deleteModal && DOM.deleteModal.classList.contains('open')) {
        const focusable = Array.from(
          DOM.deleteModal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
        );
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    });

    // Auto-close mobile drawer when viewport expands to desktop
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1024 && DOM.sidebar && DOM.sidebar.classList.contains('open')) {
        closeMobileSidebar();
      }
    });

    // 9. Miscellaneous Controls
    if (DOM.clearActivityBtn) {
      DOM.clearActivityBtn.addEventListener('click', () => {
        Storage.clearActivities();
        renderRecentActivities([]);
        showToast('Activity log cleared', 'info');
      });
    }

    // 10. Dashboard QA Snapshot Widget Actions (Prompt 5)
    if (DOM.dashOpenReportsBtn) {
      DOM.dashOpenReportsBtn.addEventListener('click', () => {
        switchView('reports');
      });
    }

    // 11. Reports Workspace Top Bar & Actions (Prompt 5)
    if (DOM.reportsProjectSelect) {
      DOM.reportsProjectSelect.addEventListener('change', (e) => {
        State.reportsProjectId = e.target.value;
        renderReportsWorkspace();
      });
    }

    if (DOM.reportsDateFilter) {
      DOM.reportsDateFilter.addEventListener('change', (e) => {
        State.reportsDateRange = e.target.value;
        if (DOM.reportsCustomDates) {
          DOM.reportsCustomDates.style.display = e.target.value === 'CUSTOM' ? 'flex' : 'none';
        }
        if (e.target.value !== 'CUSTOM') {
          renderReportsWorkspace();
        }
      });
    }

    if (DOM.reportsApplyCustomBtn) {
      DOM.reportsApplyCustomBtn.addEventListener('click', () => {
        if (DOM.reportsDateStart) State.reportsCustomStartDate = DOM.reportsDateStart.value;
        if (DOM.reportsDateEnd) State.reportsCustomEndDate = DOM.reportsDateEnd.value;
        renderReportsWorkspace();
      });
    }

    if (DOM.reportsRefreshBtn) {
      DOM.reportsRefreshBtn.addEventListener('click', () => {
        const icon = DOM.reportsRefreshBtn.querySelector('.refresh-icon');
        if (icon) icon.classList.add('refresh-spinning');
        setTimeout(() => {
          if (icon) icon.classList.remove('refresh-spinning');
          renderReportsWorkspace();
          showToast('Analytics & charts refreshed', 'info');
        }, 500);
      });
    }

    if (DOM.reportsExportBtn) {
      DOM.reportsExportBtn.addEventListener('click', () => {
        generateAndPrintQAReport(State.reportsProjectId, 'qa-summary');
      });
    }

    if (DOM.repJumpDefectsBtn) {
      DOM.repJumpDefectsBtn.addEventListener('click', () => {
        switchView('defects', State.reportsProjectId === 'ALL' ? null : State.reportsProjectId);
      });
    }

    if (DOM.repJumpExecBtn) {
      DOM.repJumpExecBtn.addEventListener('click', () => {
        switchView('execution', State.reportsProjectId === 'ALL' ? null : State.reportsProjectId);
      });
    }

    // 12. Data Management & Backups Controls (Prompt 6)
    if (DOM.dataTabBtns) {
      DOM.dataTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const tab = btn.getAttribute('data-tab');
          if (tab) switchDataTab(tab);
        });
      });
    }

    if (DOM.btnExportProjectJson) {
      DOM.btnExportProjectJson.addEventListener('click', () => {
        const pId = DOM.exportProjectSelect?.value;
        if (pId) exportProjectJSON(pId);
        else showToast('Please select a project to export', 'warning');
      });
    }

    if (DOM.btnCreateFullBackup) {
      DOM.btnCreateFullBackup.addEventListener('click', exportFullApplicationBackup);
    }

    if (DOM.btnExportCasesCsv) {
      DOM.btnExportCasesCsv.addEventListener('click', exportTestCasesCSV);
    }

    if (DOM.btnExportExecsCsv) {
      DOM.btnExportExecsCsv.addEventListener('click', exportExecutionsCSV);
    }

    if (DOM.btnExportDefectsCsv) {
      DOM.btnExportDefectsCsv.addEventListener('click', exportDefectsCSV);
    }

    if (DOM.btnExportChecklistsCsv) {
      DOM.btnExportChecklistsCsv.addEventListener('click', exportChecklistsCSV);
    }

    if (DOM.btnPrintQaReport) {
      DOM.btnPrintQaReport.addEventListener('click', () => {
        generateAndPrintQAReport();
      });
    }

    // Drag & Drop and File Selection
    if (DOM.btnBrowseFile) {
      DOM.btnBrowseFile.addEventListener('click', (e) => {
        e.stopPropagation();
        if (DOM.importFileInput) DOM.importFileInput.click();
      });
    }

    if (DOM.importDropzone) {
      DOM.importDropzone.addEventListener('click', (e) => {
        if (e.target !== DOM.importFileInput && DOM.importFileInput) {
          DOM.importFileInput.click();
        }
      });

      DOM.importDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        DOM.importDropzone.classList.add('dragover');
      });

      DOM.importDropzone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        DOM.importDropzone.classList.remove('dragover');
      });

      DOM.importDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        DOM.importDropzone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleImportFile(e.dataTransfer.files[0]);
        }
      });
    }

    if (DOM.importFileInput) {
      DOM.importFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          handleImportFile(e.target.files[0]);
        }
      });
    }

    // Import Preview Modal Controls
    if (DOM.importModeMerge) {
      DOM.importModeMerge.addEventListener('change', () => {
        if (DOM.importReplaceWarning) DOM.importReplaceWarning.style.display = 'none';
        const isTransfer = Boolean(State.pendingImportPayload && State.pendingImportPayload.isTransferCode);
        if (DOM.importConfirmBtnText) {
          DOM.importConfirmBtnText.textContent = isTransfer ? 'Confirm & Merge Checklists' : 'Confirm & Merge Data';
        }
        if (DOM.importPreviewConfirmBtn) DOM.importPreviewConfirmBtn.className = 'btn btn-primary';
      });
    }

    if (DOM.importModeReplace) {
      DOM.importModeReplace.addEventListener('change', () => {
        if (DOM.importReplaceWarning) DOM.importReplaceWarning.style.display = 'flex';
        const isTransfer = Boolean(State.pendingImportPayload && State.pendingImportPayload.isTransferCode);
        if (DOM.importReplaceWarningText) {
          DOM.importReplaceWarningText.innerHTML = isTransfer
            ? '<strong>Warning:</strong> Existing saved QA checklists will be replaced. Qavora will preserve a rollback snapshot in memory so you can undo this restore if needed.'
            : '<strong>Warning:</strong> Existing projects will be overwritten. Qavora will preserve a rollback snapshot in memory so you can undo this restore if needed.';
        }
        if (DOM.importConfirmBtnText) {
          DOM.importConfirmBtnText.textContent = isTransfer ? 'Confirm & Replace Checklists' : 'Confirm & Replace Workspace';
        }
        if (DOM.importPreviewConfirmBtn) DOM.importPreviewConfirmBtn.className = 'btn btn-danger';
      });
    }

    if (DOM.importPreviewClose) DOM.importPreviewClose.addEventListener('click', closeImportPreviewModal);
    if (DOM.importPreviewCancelBtn) DOM.importPreviewCancelBtn.addEventListener('click', closeImportPreviewModal);
    if (DOM.importPreviewConfirmBtn) DOM.importPreviewConfirmBtn.addEventListener('click', commitImport);

    // Rollback & Reset Controls
    if (DOM.btnExecuteRollback) {
      DOM.btnExecuteRollback.addEventListener('click', executeRollback);
    }

    if (DOM.btnTriggerResetModal) {
      DOM.btnTriggerResetModal.addEventListener('click', openResetConfirmModal);
    }

    if (DOM.resetModalClose) DOM.resetModalClose.addEventListener('click', closeResetConfirmModal);
    if (DOM.resetModalCancel) DOM.resetModalCancel.addEventListener('click', closeResetConfirmModal);

    if (DOM.resetConfirmCheckbox) {
      DOM.resetConfirmCheckbox.addEventListener('change', (e) => {
        if (DOM.resetModalConfirmBtn) DOM.resetModalConfirmBtn.disabled = !e.target.checked;
      });
    }

    if (DOM.resetBackupFirstBtn) {
      DOM.resetBackupFirstBtn.addEventListener('click', () => {
        exportFullApplicationBackup();
      });
    }

    if (DOM.resetModalConfirmBtn) {
      DOM.resetModalConfirmBtn.addEventListener('click', executeWorkspaceReset);
    }

    // 13. Workspace Settings Controls (QAV-ISS-010)
    if (DOM.settingsJumpDataBtn) {
      DOM.settingsJumpDataBtn.addEventListener('click', () => {
        switchView('data');
      });
    }

    if (DOM.settingsQuickBackupBtn) {
      DOM.settingsQuickBackupBtn.addEventListener('click', () => {
        exportFullApplicationBackup();
      });
    }

    if (DOM.settingsThemeSelect) {
      DOM.settingsThemeSelect.addEventListener('change', (e) => {
        applyTheme(e.target.value);
        if (DOM.settingsSaveIndicator) {
          DOM.settingsSaveIndicator.style.display = 'inline-flex';
          DOM.settingsSaveIndicator.style.opacity = '1';
          clearTimeout(State._settingsSaveTimeout);
          State._settingsSaveTimeout = setTimeout(() => {
            if (DOM.settingsSaveIndicator) {
              DOM.settingsSaveIndicator.style.opacity = '0';
              setTimeout(() => {
                if (DOM.settingsSaveIndicator) DOM.settingsSaveIndicator.style.display = 'none';
              }, 300);
            }
          }, 2000);
        }
      });
    }

    if (DOM.settingsDensitySelect) {
      DOM.settingsDensitySelect.addEventListener('change', (e) => {
        applyPreferences({ density: e.target.value }, true);
      });
    }

    if (DOM.settingsProjectSortSelect) {
      DOM.settingsProjectSortSelect.addEventListener('change', (e) => {
        applyPreferences({ defaultProjectSort: e.target.value }, true);
        if (!State._hasCustomSort) {
          State.sortBy = e.target.value;
          if (DOM.projectSortBy) DOM.projectSortBy.value = e.target.value;
        }
      });
    }

    if (DOM.settingsCasePrioritySelect) {
      DOM.settingsCasePrioritySelect.addEventListener('change', (e) => {
        applyPreferences({ defaultCasePriority: e.target.value }, true);
      });
    }

    if (DOM.settingsAutopassStepsToggle) {
      DOM.settingsAutopassStepsToggle.addEventListener('change', (e) => {
        applyPreferences({ autopassSteps: e.target.checked }, true);
      });
    }

    if (DOM.settingsActionToastsToggle) {
      DOM.settingsActionToastsToggle.addEventListener('change', (e) => {
        applyPreferences({ actionToasts: e.target.checked }, true);
      });
    }

    // 14. Notifications Controls (QAV-ISS-011)
    if (DOM.notificationBtn) {
      DOM.notificationBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleNotificationPanel();
      });
    }

    if (DOM.notificationMarkAllBtn) {
      DOM.notificationMarkAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        markAllNotificationsAsRead();
      });
    }

    if (DOM.notificationClearAllBtn) {
      DOM.notificationClearAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearAllNotifications();
      });
    }

    document.addEventListener('click', (e) => {
      if (DOM.notificationPanel && DOM.notificationPanel.style.display !== 'none') {
        if (!DOM.notificationWrapper || !DOM.notificationWrapper.contains(e.target)) {
          toggleNotificationPanel(false);
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (DOM.notificationPanel && DOM.notificationPanel.style.display !== 'none') {
          toggleNotificationPanel(false);
          if (DOM.notificationBtn) DOM.notificationBtn.focus();
        }
      }
    });

    if (DOM.sidebarToggleBtn) DOM.sidebarToggleBtn.addEventListener('click', openMobileSidebar);
    if (DOM.sidebarCloseBtn) DOM.sidebarCloseBtn.addEventListener('click', closeMobileSidebar);
    if (DOM.sidebarOverlay) DOM.sidebarOverlay.addEventListener('click', closeMobileSidebar);
    if (DOM.themeToggleBtn) DOM.themeToggleBtn.addEventListener('click', toggleTheme);
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================
  function init() {
    const savedTheme = Storage.getTheme();
    applyTheme(savedTheme);

    State.preferences = Storage.getPreferences();
    if (State.preferences && State.preferences.density) {
      document.documentElement.setAttribute('data-density', State.preferences.density);
    }
    State.notifications = Storage.getNotifications();

    bindEvents();
    updateNotificationUI();

    qaRunnerController = initQARunnerAndChecklists({
      navigateTo: (targetView, optArg) => switchView(targetView, optArg),
      notify: showToast,
      onChecklistPromoted: ({ project, checklist, summary }) => {
        Storage.addActivity(
          'Promoted Checklist to Project',
          `${checklist.title} → ${project.name} (${summary.casesCount} cases)`
        );
        addNotification({
          title: 'Checklist Promoted',
          message: `Checklist "${checklist.title}" promoted to project "${project.name}".`,
          type: 'promotion',
          link: { view: 'project-details', projectId: project.id }
        });
        renderDashboard();
        renderMyProjects();
        renderTestPlansWorkspace();
        renderTestExecutionWorkspace();
        renderDefectsWorkspace();
        renderReportsWorkspace();
        renderDataWorkspace();
        showToast(
          `Promoted "${checklist.title}" to formal project "${project.name}" (${summary.phasesCount} phases, ${summary.suitesCount} suites, ${summary.casesCount} test cases initialized as Not Run).`,
          'success'
        );
      },
      onOpenPromotedProject: (projectId) => {
        switchView('plans', projectId);
      }
    });
    initChecklistGenerator({
      notify: showToast,
      onChecklistStarted: (newChecklist) => {
        qaRunnerController.openChecklistInRunner(newChecklist.id);
      }
    });
    qaTransferController = initQAChecklistTransferUI({
      notify: showToast,
      onBeforeReplaceSnapshot: () => {
        const currentProjects = Storage.getProjects();
        const currentActivities = Storage.getActivities();
        const currentChecklists = loadAllChecklists().checklists;
        const currentActiveRunner = getActiveRunnerState();
        Storage.saveRollbackSnapshot(currentProjects, currentActivities, currentChecklists, currentActiveRunner);
      },
      onAfterTransferImport: ({ mode, importedCount }) => {
        const actionLabel = mode === 'replace'
          ? 'Transferred Checklists (Replace)'
          : 'Transferred Checklists (Merge)';
        Storage.addActivity(actionLabel, `${importedCount} QA Checklists`);
        if (qaRunnerController) {
          if (typeof qaRunnerController.syncFromStorage === 'function') {
            qaRunnerController.syncFromStorage();
          } else {
            qaRunnerController.refreshGlobalBadgesAndBanners();
          }
        }
        renderDashboard();
        renderDataWorkspace();
      },
      onOpenChecklistsView: () => {
        switchView('my-checklists');
      }
    });
    renderDashboard();

    const restoredQaView = qaRunnerController.getRestoredInitialView();
    if (restoredQaView) {
      switchView(restoredQaView);
    }

    if (typeof globalThis !== 'undefined') {
      globalThis.__qavoraApp = {
        State,
        DOM,
        Storage,
        applyTheme,
        toggleTheme,
        applyPreferences,
        renderSettingsWorkspace,
        addNotification,
        markNotificationAsRead,
        markAllNotificationsAsRead,
        clearAllNotifications,
        dismissNotification,
        toggleNotificationPanel,
        handleNotificationNavigation,
        updateNotificationUI,
        switchView
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();