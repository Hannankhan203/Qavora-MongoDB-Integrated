/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Dashboard Analytics & Metrics Module (CQ-003 / Phase 4)
 */

import { getProjects, setActiveProjectId } from './state.js';
import { getIsLoadingProjects, getProjectLoadError, renderProjectDetails, openCreateProjectModal } from './projectManager.js';
import { navigateTo } from './uiRenderer.js';
import { escapeHtml, formatDate } from './utils.js';

/**
 * Computes all cross-project quality assurance statistics and metrics.
 */
export function getDashboardMetrics() {
  const projects = getProjects();

  const totalProjects = projects.length;
  const activeProjects = projects.filter((p) => (p.status || 'Active') === 'Active').length;
  const completedProjects = projects.filter((p) => p.status === 'Completed').length;
  const archivedProjects = projects.filter((p) => p.status === 'Archived').length;

  let totalPlans = 0;
  let totalPhases = 0;
  let totalSuites = 0;
  let totalCases = 0;
  let totalExecutions = 0;
  let passCount = 0;
  let failCount = 0;
  let blockedCount = 0;
  let skippedCount = 0;
  let activeDefects = 0;

  const uniqueExecutedCaseIds = new Set();

  projects.forEach((p) => {
    // 1. Test Plan & Phases
    if (p.testPlan && (p.testPlan.name || (Array.isArray(p.testPlan.phases) && p.testPlan.phases.length > 0))) {
      totalPlans++;
    }
    if (Array.isArray(p.testPlan?.phases)) {
      totalPhases += p.testPlan.phases.length;
    }

    // 2. Test Suites & Test Cases
    if (Array.isArray(p.testSuites)) {
      totalSuites += p.testSuites.length;
      p.testSuites.forEach((s) => {
        if (Array.isArray(s.cases)) {
          totalCases += s.cases.length;
          // Check case-level status
          s.cases.forEach((c) => {
            const st = (c.status || '').toLowerCase();
            if (st === 'passed') {
              uniqueExecutedCaseIds.add(c.id);
            } else if (st === 'failed') {
              uniqueExecutedCaseIds.add(c.id);
            } else if (st === 'blocked') {
              uniqueExecutedCaseIds.add(c.id);
            }
          });
        }
      });
    }

    // 3. Executions
    if (Array.isArray(p.executions)) {
      p.executions.forEach((e) => {
        totalExecutions++;
        const st = (e.status || '').toLowerCase();
        if (st === 'passed' || st === 'pass') {
          passCount++;
        } else if (st === 'failed' || st === 'fail') {
          failCount++;
        } else if (st === 'blocked') {
          blockedCount++;
        } else if (st === 'skipped') {
          skippedCount++;
        }
        if (e.testCaseId || e.caseId) {
          uniqueExecutedCaseIds.add(String(e.testCaseId || e.caseId));
        }
      });
    }

    // 4. Defects
    if (Array.isArray(p.defects)) {
      p.defects.forEach((d) => {
        if (d.status !== 'Resolved' && d.status !== 'Closed') {
          activeDefects++;
        }
      });
    }
  });

  // If executions were logged, use execution outcomes; if no executions array exists but test cases have passed/failed status:
  if (totalExecutions === 0 && uniqueExecutedCaseIds.size > 0) {
    projects.forEach((p) => {
      if (Array.isArray(p.testSuites)) {
        p.testSuites.forEach((s) => {
          if (Array.isArray(s.cases)) {
            s.cases.forEach((c) => {
              const st = (c.status || '').toLowerCase();
              if (st === 'passed') passCount++;
              else if (st === 'failed') failCount++;
              else if (st === 'blocked') blockedCount++;
            });
          }
        });
      }
    });
    totalExecutions = passCount + failCount + blockedCount;
  }

  const executedTotal = passCount + failCount + blockedCount;
  const passRate = executedTotal > 0 ? Math.round((passCount / executedTotal) * 100) : 0;
  const overallExecutedCount = Math.min(totalCases, uniqueExecutedCaseIds.size);
  const overallProgressPct = totalCases > 0 ? Math.min(100, Math.round((overallExecutedCount / totalCases) * 100)) : 0;

  return {
    totalProjects,
    activeProjects,
    completedProjects,
    archivedProjects,
    totalPlans,
    totalPhases,
    totalSuites,
    totalCases,
    totalExecutions,
    passCount,
    failCount,
    blockedCount,
    skippedCount,
    passRate,
    overallExecutedCount,
    overallProgressPct,
    activeDefects
  };
}

/**
 * Main render function for the Dashboard view (#view-dashboard).
 */
export function renderDashboard() {
  if (typeof document === 'undefined') return;

  const isLoading = getIsLoadingProjects();
  const loadError = getProjectLoadError();
  const projects = getProjects();
  const metrics = getDashboardMetrics();

  // 1. Statistics Cards Grid
  const statProjectsEl = document.getElementById('stat-projects');
  const statCasesEl = document.getElementById('stat-cases');
  const statPassedEl = document.getElementById('stat-passed');
  const statFailedEl = document.getElementById('stat-failed');

  if (statProjectsEl) statProjectsEl.textContent = String(metrics.totalProjects);
  if (statCasesEl) statCasesEl.textContent = String(metrics.totalCases);
  if (statPassedEl) statPassedEl.textContent = String(metrics.passCount);
  if (statFailedEl) statFailedEl.textContent = String(metrics.failCount);

  // 2. Overall Progress Card
  const progressPctEl = document.getElementById('stat-progress');
  const progressSubEl = document.getElementById('stat-progress-sub');
  const progressBarEl = document.getElementById('stat-progress-bar');

  if (progressPctEl) progressPctEl.textContent = `${metrics.overallProgressPct}%`;
  if (progressSubEl) progressSubEl.textContent = `${metrics.overallExecutedCount} of ${metrics.totalCases} executed`;
  if (progressBarEl) progressBarEl.style.width = `${metrics.overallProgressPct}%`;

  // 3. QA Analytics Snapshot Widget
  const dashActiveProjEl = document.getElementById('dash-stat-active-projects');
  const dashPlansEl = document.getElementById('dash-stat-plans');
  const dashPhasesEl = document.getElementById('dash-stat-phases');
  const dashSuitesEl = document.getElementById('dash-stat-suites');
  const dashExecsEl = document.getElementById('dash-stat-execs');
  const dashPassRateEl = document.getElementById('dash-stat-passrate');
  const dashDefectsEl = document.getElementById('dash-stat-defects');
  const dashCoverageEl = document.getElementById('dash-stat-coverage');

  if (dashActiveProjEl) dashActiveProjEl.textContent = String(metrics.activeProjects);
  if (dashPlansEl) dashPlansEl.textContent = String(metrics.totalPlans);
  if (dashPhasesEl) dashPhasesEl.textContent = String(metrics.totalPhases);
  if (dashSuitesEl) dashSuitesEl.textContent = String(metrics.totalSuites);
  if (dashExecsEl) dashExecsEl.textContent = String(metrics.totalExecutions);
  if (dashPassRateEl) dashPassRateEl.textContent = `${metrics.passRate}%`;
  if (dashDefectsEl) dashDefectsEl.textContent = String(metrics.activeDefects);
  if (dashCoverageEl) dashCoverageEl.textContent = `${metrics.overallExecutedCount} / ${metrics.totalCases}`;

  // 4. Status Bar & Segments
  const barPassCntEl = document.getElementById('dash-bar-pass-cnt');
  const barFailCntEl = document.getElementById('dash-bar-fail-cnt');
  const barBlockedCntEl = document.getElementById('dash-bar-blocked-cnt');
  const barSkippedCntEl = document.getElementById('dash-bar-skipped-cnt');

  if (barPassCntEl) barPassCntEl.textContent = String(metrics.passCount);
  if (barFailCntEl) barFailCntEl.textContent = String(metrics.failCount);
  if (barBlockedCntEl) barBlockedCntEl.textContent = String(metrics.blockedCount);
  if (barSkippedCntEl) barSkippedCntEl.textContent = String(metrics.skippedCount);

  const barPassSeg = document.getElementById('dash-bar-pass');
  const barFailSeg = document.getElementById('dash-bar-fail');
  const barBlockedSeg = document.getElementById('dash-bar-blocked');
  const barSkippedSeg = document.getElementById('dash-bar-skipped');

  const totalStatusRuns = metrics.passCount + metrics.failCount + metrics.blockedCount + metrics.skippedCount;
  if (totalStatusRuns > 0) {
    if (barPassSeg) barPassSeg.style.width = `${(metrics.passCount / totalStatusRuns) * 100}%`;
    if (barFailSeg) barFailSeg.style.width = `${(metrics.failCount / totalStatusRuns) * 100}%`;
    if (barBlockedSeg) barBlockedSeg.style.width = `${(metrics.blockedCount / totalStatusRuns) * 100}%`;
    if (barSkippedSeg) barSkippedSeg.style.width = `${(metrics.skippedCount / totalStatusRuns) * 100}%`;
  } else {
    if (barPassSeg) barPassSeg.style.width = '0%';
    if (barFailSeg) barFailSeg.style.width = '0%';
    if (barBlockedSeg) barBlockedSeg.style.width = '0%';
    if (barSkippedSeg) barSkippedSeg.style.width = '0%';
  }

  // 5. Recent Projects Section
  const recentProjectsCounter = document.getElementById('recent-projects-counter');
  if (recentProjectsCounter) {
    recentProjectsCounter.textContent = `${projects.length} total`;
  }

  const recentContainer = document.getElementById('recent-projects-container');
  if (recentContainer) {
    if (isLoading) {
      recentContainer.innerHTML = `
        <div class="empty-state" style="padding: 28px 16px;">
          <div class="auth-loading-spinner" style="margin-bottom: 12px;" aria-label="Loading recent projects"></div>
          <p class="empty-state-desc" style="margin-bottom: 0;">Loading projects...</p>
        </div>`;
    } else if (loadError) {
      recentContainer.innerHTML = `
        <div class="empty-state" style="padding: 24px 16px;">
          <p class="empty-state-desc" style="color: var(--color-red); margin-bottom: 8px;">${escapeHtml(loadError)}</p>
          <button type="button" class="btn btn-secondary btn-xs" id="dash-retry-projects-btn">Retry</button>
        </div>`;
    } else if (projects.length === 0) {
      recentContainer.innerHTML = `
        <div class="empty-state" style="padding: 28px 16px;">
          <div class="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <h4 class="empty-state-title">No Projects Found</h4>
          <p class="empty-state-desc">Create your first QA testing project to organize test plans, suites, and monitor quality progress.</p>
          <button type="button" class="btn btn-primary btn-xs dash-create-project-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>Create Project</span>
          </button>
        </div>`;
    } else {
      const recent = [...projects]
        .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())
        .slice(0, 5);

      recentContainer.innerHTML = `
        <div class="project-card-list">
          ${recent
            .map((p) => {
              const statusClass = `status-${(p.status || 'Active').toLowerCase()}`;
              const suitesCount = Array.isArray(p.testSuites) ? p.testSuites.length : 0;
              let casesCount = 0;
              if (Array.isArray(p.testSuites)) {
                p.testSuites.forEach((s) => {
                  casesCount += Array.isArray(s.cases) ? s.cases.length : 0;
                });
              }

              return `
                <div class="project-item" data-project-id="${escapeHtml(p.id)}" role="button" tabindex="0" title="Click to open project details">
                  <div class="project-item-top">
                    <span class="project-item-title">${escapeHtml(p.name || 'Untitled Project')}</span>
                    <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
                      <span class="status-badge ${statusClass}">${escapeHtml(p.status || 'Active')}</span>
                      <span class="project-badge badge-web" style="font-size: 0.68rem;">${escapeHtml(p.type || 'Web Application')}</span>
                    </div>
                  </div>
                  ${p.description ? `<p class="project-item-desc">${escapeHtml(p.description)}</p>` : ''}
                  <div class="project-item-meta">
                    <div class="meta-group">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                      </svg>
                      <span>Updated ${formatDate(p.updatedAt || p.createdAt)}</span>
                    </div>
                    <div class="meta-group">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      </svg>
                      <span>${suitesCount} suite${suitesCount === 1 ? '' : 's'} · ${casesCount} cases</span>
                    </div>
                  </div>
                </div>`;
            })
            .join('')}
        </div>`;
    }
  }

  // 6. Recent Activity Section (Empty state representation — backend event logging not provisioned)
  const activityContainer = document.getElementById('recent-activity-container');
  if (activityContainer) {
    activityContainer.innerHTML = `
      <div class="empty-state" style="padding: 28px 16px;">
        <div class="empty-state-icon" style="width: 44px; height: 44px; margin-bottom: 10px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        </div>
        <h4 class="empty-state-title" style="font-size: 0.95rem;">No Recent Activity Recorded</h4>
        <p class="empty-state-desc" style="font-size: 0.8rem; margin-bottom: 0;">
          Activity audit logging is currently not implemented on the backend server. Automated event logs will appear here when an activity logging service is provisioned.
        </p>
      </div>`;
  }
}
