/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Advanced Reports, Analytics & QA Insights Module (Phase 6)
 */

import { getProjects, getActiveProjectId, setActiveProjectId } from './state.js';
import { escapeHtml } from './utils.js';
import { navigateTo } from './uiRenderer.js';

let _reportsListenersBound = false;

// Helpers to get all unique test cases in a project or all projects
function getProjectTestCases(project) {
  if (!project) return [];
  const cases = [];
  const phases = project.phases || [];
  for (const ph of phases) {
    for (const su of (ph.suites || [])) {
      for (const tc of (su.testCases || [])) {
        cases.push({ ...tc, suiteTitle: su.title, phaseName: ph.name, projectId: project.id, projectName: project.name });
      }
    }
  }
  return cases;
}

function getProjectExecutions(project) {
  if (!project || !Array.isArray(project.executions)) return [];
  return project.executions.map(e => ({ ...e, projectId: project.id, projectName: project.name }));
}

function getProjectDefects(project) {
  if (!project || !Array.isArray(project.defects)) return [];
  return project.defects.map(d => ({ ...d, projectId: project.id, projectName: project.name }));
}

function getProjectSuites(project) {
  if (!project) return [];
  const suites = [];
  for (const ph of (project.phases || [])) {
    for (const su of (ph.suites || [])) {
      suites.push({ ...su, phaseName: ph.name, projectId: project.id, projectName: project.name });
    }
  }
  return suites;
}

// Date Range Filter logic
function isWithinDateRange(dateString, filterType, customStart, customEnd) {
  if (!dateString) return filterType === 'ALL';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return true;

  const now = new Date();
  if (filterType === '7D') {
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return d >= cutoff;
  }
  if (filterType === '30D') {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return d >= cutoff;
  }
  if (filterType === '90D') {
    const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    return d >= cutoff;
  }
  if (filterType === 'CUSTOM') {
    if (customStart) {
      const s = new Date(customStart);
      s.setHours(0, 0, 0, 0);
      if (d < s) return false;
    }
    if (customEnd) {
      const e = new Date(customEnd);
      e.setHours(23, 59, 59, 999);
      if (d > e) return false;
    }
    return true;
  }
  return true;
}

export function renderReportsWorkspace(targetProjectId = null) {
  if (typeof document === 'undefined') return;

  const projects = getProjects() || [];
  const emptyView = document.getElementById('reports-no-projects-view');
  const mainContent = document.getElementById('reports-main-content');
  const projectSelect = document.getElementById('reports-project-select');

  if (!projects || projects.length === 0) {
    if (emptyView) emptyView.style.display = 'block';
    if (mainContent) mainContent.style.display = 'none';
    return;
  }

  if (emptyView) emptyView.style.display = 'none';
  if (mainContent) mainContent.style.display = 'block';

  // Populate Project Select if needed
  if (projectSelect) {
    const currentVal = targetProjectId || projectSelect.value || 'ALL';
    let optionsHtml = `<option value="ALL">All Projects (Combined)</option>`;
    for (const p of projects) {
      const selected = p.id === currentVal ? 'selected' : '';
      optionsHtml += `<option value="${escapeHtml(p.id)}" ${selected}>${escapeHtml(p.name || 'Untitled Project')}</option>`;
    }
    projectSelect.innerHTML = optionsHtml;
    if (currentVal && projectSelect.querySelector(`option[value="${currentVal}"]`)) {
      projectSelect.value = currentVal;
    } else {
      projectSelect.value = 'ALL';
    }
  }

  computeAndDisplayReports();
}

function computeAndDisplayReports() {
  const projects = getProjects() || [];
  const projectSelect = document.getElementById('reports-project-select');
  const dateFilter = document.getElementById('reports-date-filter');
  const customStart = document.getElementById('reports-date-start')?.value;
  const customEnd = document.getElementById('reports-date-end')?.value;

  const selectedProjectId = projectSelect ? projectSelect.value : 'ALL';
  const filterType = dateFilter ? dateFilter.value : 'ALL';

  // Gather scoped data
  let scopedProjects = [];
  if (selectedProjectId === 'ALL') {
    scopedProjects = projects;
  } else {
    const match = projects.find(p => p.id === selectedProjectId);
    scopedProjects = match ? [match] : projects;
  }

  // Extract raw collections
  let allCases = [];
  let allExecutions = [];
  let allDefects = [];
  let allSuites = [];

  for (const proj of scopedProjects) {
    allCases = allCases.concat(getProjectTestCases(proj));
    allExecutions = allExecutions.concat(getProjectExecutions(proj));
    allDefects = allDefects.concat(getProjectDefects(proj));
    allSuites = allSuites.concat(getProjectSuites(proj));
  }

  // Filter executions and defects by date
  const filteredExecs = allExecutions.filter(e => {
    const dt = e.executedAt || e.timestamp || e.createdAt;
    return isWithinDateRange(dt, filterType, customStart, customEnd);
  });

  const filteredDefects = allDefects.filter(d => {
    const dt = d.createdAt || d.reportedAt;
    return isWithinDateRange(dt, filterType, customStart, customEnd);
  });

  // Calculate KPIs
  const totalCases = allCases.length;
  const totalExecs = filteredExecs.length;

  // Unique test cases executed
  const executedCaseIdSet = new Set();
  let passedCount = 0;
  let failedCount = 0;
  let blockedCount = 0;
  let skippedCount = 0;

  for (const ex of filteredExecs) {
    if (ex.testCaseId) executedCaseIdSet.add(ex.testCaseId);
    const st = String(ex.status || '').toUpperCase();
    if (st === 'PASSED' || st === 'PASS') passedCount++;
    else if (st === 'FAILED' || st === 'FAIL') failedCount++;
    else if (st === 'BLOCKED' || st === 'BLOCK') blockedCount++;
    else if (st === 'SKIPPED' || st === 'SKIP') skippedCount++;
  }

  const executedCasesCount = executedCaseIdSet.size;
  const notRunCount = Math.max(0, totalCases - executedCasesCount);
  const passRate = totalExecs > 0 ? Math.round((passedCount / totalExecs) * 100) : 0;
  const failRate = totalExecs > 0 ? Math.round((failedCount / totalExecs) * 100) : 0;

  // Defect metrics
  const totalDefects = filteredDefects.length;
  let openDefectsCount = 0;
  let resolvedDefectsCount = 0;
  let criticalDefectsCount = 0;

  for (const def of filteredDefects) {
    const st = String(def.status || '').toLowerCase();
    const isResolved = st === 'resolved' || st === 'closed' || st === 'verified';
    if (isResolved) {
      resolvedDefectsCount++;
    } else {
      openDefectsCount++;
      const sev = String(def.severity || '').toLowerCase();
      if (sev === 'critical' || sev === 'blocker') {
        criticalDefectsCount++;
      }
    }
  }

  const defectFixRate = totalDefects > 0 ? Math.round((resolvedDefectsCount / totalDefects) * 100) : 0;

  // Update DOM KPI elements
  setElText('rep-kpi-total-cases', totalCases);
  setElText('rep-kpi-total-execs', totalExecs);
  setElText('rep-kpi-executed-cases', executedCasesCount);
  setElText('rep-kpi-executed-ratio', `${executedCasesCount} of ${totalCases} cases run`);
  setElText('rep-kpi-notrun-cases', notRunCount);
  setElText('rep-kpi-passed-execs', passedCount);
  setElText('rep-kpi-passed-rate', `${passRate}% pass rate`);
  setElText('rep-kpi-failed-execs', failedCount);
  setElText('rep-kpi-failed-rate', `${failRate}% fail rate`);
  setElText('rep-kpi-blocked-execs', blockedCount);
  setElText('rep-kpi-skipped-execs', skippedCount);
  setElText('rep-kpi-total-defects', totalDefects);
  setElText('rep-kpi-open-defects', openDefectsCount);
  setElText('rep-kpi-critical-defects', `${criticalDefectsCount} critical blockers`);
  setElText('rep-kpi-resolved-defects', resolvedDefectsCount);
  setElText('rep-kpi-defect-fix-rate', `${defectFixRate}% fix rate`);

  // Update Health Status Badge & Automated Insights
  renderHealthInsights({
    totalCases,
    totalExecs,
    passRate,
    failRate,
    openDefectsCount,
    criticalDefectsCount,
    defectFixRate,
    executedCasesCount
  });

  // Render Charts
  renderDonutChart({ passedCount, failedCount, blockedCount, skippedCount, totalExecs, passRate });
  renderVelocityTrendChart(filteredExecs);

  // Render Tables & Breakdowns
  renderDailyExecutionTable(filteredExecs);
  renderPhaseCoverageTable(scopedProjects);
  renderPriorityBreakdown(allCases);
  renderSuitesQualityTable(allSuites, filteredExecs, filteredDefects);
  renderDefectsBreakdown(filteredDefects);
  renderRecentDefectsTable(filteredDefects);
  renderRecentExecutionsTable(filteredExecs);
}

function setElText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(text);
}

// 1. Health Insights
function renderHealthInsights({ totalCases, totalExecs, passRate, failRate, openDefectsCount, criticalDefectsCount, defectFixRate, executedCasesCount }) {
  const badge = document.getElementById('rep-health-status-badge');
  const container = document.getElementById('reports-insights-container');

  let healthClass = 'health-good';
  let healthText = 'QA Health: Stable';

  if (criticalDefectsCount > 0 || failRate > 35) {
    healthClass = 'health-danger';
    healthText = 'QA Health: Critical Attention';
  } else if (openDefectsCount > 4 || failRate > 15 || passRate < 70) {
    healthClass = 'health-warning';
    healthText = 'QA Health: Moderate Risk';
  }

  if (badge) {
    badge.className = `report-health-badge ${healthClass}`;
    badge.textContent = healthText;
  }

  if (!container) return;

  const coveragePct = totalCases > 0 ? Math.round((executedCasesCount / totalCases) * 100) : 0;

  container.innerHTML = `
    <div class="report-insight-card">
      <div class="insight-card-header">
        <span class="insight-tag">Test Coverage</span>
        <span class="insight-score">${coveragePct}%</span>
      </div>
      <p class="insight-card-desc">
        ${coveragePct >= 80 ? 'High test execution coverage across configured test suites.' : 'Further execution needed to reach 80% coverage threshold.'}
      </p>
    </div>
    <div class="report-insight-card">
      <div class="insight-card-header">
        <span class="insight-tag">Pass Velocity</span>
        <span class="insight-score text-${passRate >= 80 ? 'green' : passRate >= 60 ? 'amber' : 'red'}">${passRate}%</span>
      </div>
      <p class="insight-card-desc">
        ${passRate >= 80 ? 'Passing criteria comfortably met across execution attempts.' : 'Test failures require regression triage and re-execution.'}
      </p>
    </div>
    <div class="report-insight-card">
      <div class="insight-card-header">
        <span class="insight-tag">Defect Triage</span>
        <span class="insight-score ${criticalDefectsCount > 0 ? 'text-red' : 'text-green'}">
          ${criticalDefectsCount > 0 ? `${criticalDefectsCount} Critical` : '0 Critical'}
        </span>
      </div>
      <p class="insight-card-desc">
        ${criticalDefectsCount > 0 ? 'Critical blockers currently open preventing sign-off.' : 'No open critical severity issues recorded.'}
      </p>
    </div>
  `;
}

// 2. SVG Donut Chart
function renderDonutChart({ passedCount, failedCount, blockedCount, skippedCount, totalExecs, passRate }) {
  const svg = document.getElementById('rep-donut-svg');
  const centerVal = document.getElementById('rep-donut-center-val');
  const legend = document.getElementById('rep-donut-legend');

  if (centerVal) centerVal.textContent = `${passRate}%`;

  if (!svg || !legend) return;

  if (totalExecs === 0) {
    svg.innerHTML = `
      <circle cx="90" cy="90" r="70" fill="none" stroke="var(--border-color, rgba(255,255,255,0.1))" stroke-width="20"></circle>
    `;
    legend.innerHTML = `
      <div style="font-size: 0.8125rem; color: var(--text-muted); text-align: center; padding: 20px 0;">
        No test executions recorded in this timeframe.
      </div>
    `;
    return;
  }

  const radius = 65;
  const circumference = 2 * Math.PI * radius;
  const segments = [
    { label: 'Passed', count: passedCount, color: '#10b981' },
    { label: 'Failed', count: failedCount, color: '#ef4444' },
    { label: 'Blocked', count: blockedCount, color: '#f59e0b' },
    { label: 'Skipped', count: skippedCount, color: '#8b5cf6' }
  ];

  let currentOffset = 0;
  let paths = '';
  let legendHtml = '';

  for (const seg of segments) {
    const fraction = totalExecs > 0 ? seg.count / totalExecs : 0;
    const strokeDash = fraction * circumference;
    const pct = Math.round(fraction * 100);

    if (fraction > 0) {
      paths += `
        <circle cx="90" cy="90" r="${radius}" fill="none"
          stroke="${seg.color}"
          stroke-width="18"
          stroke-dasharray="${strokeDash} ${circumference}"
          stroke-dashoffset="${-currentOffset}"
          transform="rotate(-90 90 90)"
        />
      `;
      currentOffset += strokeDash;
    }

    legendHtml += `
      <div class="donut-legend-item">
        <span class="donut-legend-dot" style="background-color: ${seg.color};"></span>
        <span class="donut-legend-name">${seg.label}</span>
        <span class="donut-legend-count">${seg.count} (${pct}%)</span>
      </div>
    `;
  }

  svg.innerHTML = paths;
  legend.innerHTML = legendHtml;
}

// 3. SVG Velocity Trend Line Chart
function renderVelocityTrendChart(executions) {
  const svg = document.getElementById('rep-trend-svg');
  const footer = document.getElementById('rep-trend-total-summary');

  if (footer) {
    footer.textContent = `${executions.length} executions recorded across timeline`;
  }

  if (!svg) return;

  if (executions.length === 0) {
    svg.innerHTML = `
      <text x="270" y="115" text-anchor="middle" fill="var(--text-muted)" font-size="13">
        No execution activity recorded in this date range
      </text>
    `;
    return;
  }

  // Group by date
  const dateMap = new Map();
  for (const ex of executions) {
    const rawDt = ex.executedAt || ex.timestamp || ex.createdAt || new Date().toISOString();
    const dateKey = String(rawDt).slice(0, 10);
    if (!dateMap.has(dateKey)) {
      dateMap.set(dateKey, { total: 0, passed: 0, failed: 0 });
    }
    const entry = dateMap.get(dateKey);
    entry.total++;
    const st = String(ex.status || '').toUpperCase();
    if (st === 'PASSED' || st === 'PASS') entry.passed++;
    else if (st === 'FAILED' || st === 'FAIL') entry.failed++;
  }

  const sortedDates = Array.from(dateMap.keys()).sort();
  const maxRuns = Math.max(...sortedDates.map(d => dateMap.get(d).total), 1);

  const width = 540;
  const height = 220;
  const padLeft = 40;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 40;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const stepX = sortedDates.length > 1 ? chartW / (sortedDates.length - 1) : chartW / 2;

  let totalPoints = [];
  let passedPoints = [];
  let failedPoints = [];
  let xLabels = '';

  sortedDates.forEach((date, i) => {
    const entry = dateMap.get(date);
    const x = sortedDates.length === 1 ? padLeft + chartW / 2 : padLeft + i * stepX;
    const yTotal = padTop + chartH - (entry.total / maxRuns) * chartH;
    const yPassed = padTop + chartH - (entry.passed / maxRuns) * chartH;
    const yFailed = padTop + chartH - (entry.failed / maxRuns) * chartH;

    totalPoints.push(`${x},${yTotal}`);
    passedPoints.push(`${x},${yPassed}`);
    failedPoints.push(`${x},${yFailed}`);

    if (sortedDates.length <= 7 || i === 0 || i === sortedDates.length - 1 || i % Math.ceil(sortedDates.length / 5) === 0) {
      const shortDate = date.slice(5);
      xLabels += `<text x="${x}" y="${height - 15}" text-anchor="middle" fill="var(--text-muted)" font-size="10">${shortDate}</text>`;
    }
  });

  const totalPolyline = totalPoints.join(' ');
  const passedPolyline = passedPoints.join(' ');
  const failedPolyline = failedPoints.join(' ');

  svg.innerHTML = `
    <!-- Grid horizontal lines -->
    <line x1="${padLeft}" y1="${padTop}" x2="${width - padRight}" y2="${padTop}" stroke="var(--border-color, rgba(255,255,255,0.06))" stroke-dasharray="3,3" />
    <line x1="${padLeft}" y1="${padTop + chartH / 2}" x2="${width - padRight}" y2="${padTop + chartH / 2}" stroke="var(--border-color, rgba(255,255,255,0.06))" stroke-dasharray="3,3" />
    <line x1="${padLeft}" y1="${padTop + chartH}" x2="${width - padRight}" y2="${padTop + chartH}" stroke="var(--border-color, rgba(255,255,255,0.15))" />

    <!-- Lines -->
    <polyline fill="none" stroke="#6366f1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${totalPolyline}" />
    <polyline fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${passedPolyline}" />
    <polyline fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${failedPolyline}" />

    <!-- Points -->
    ${sortedDates.map((date, i) => {
      const entry = dateMap.get(date);
      const x = sortedDates.length === 1 ? padLeft + chartW / 2 : padLeft + i * stepX;
      const yTotal = padTop + chartH - (entry.total / maxRuns) * chartH;
      return `<circle cx="${x}" cy="${yTotal}" r="3.5" fill="#6366f1" />`;
    }).join('')}

    <!-- Labels -->
    ${xLabels}
  `;
}

// 4. Daily Breakdown Table
function renderDailyExecutionTable(executions) {
  const container = document.getElementById('rep-daily-table-container');
  const counter = document.getElementById('rep-daily-counter');
  if (!container) return;

  const dateMap = new Map();
  for (const ex of executions) {
    const rawDt = ex.executedAt || ex.timestamp || ex.createdAt || new Date().toISOString();
    const dateKey = String(rawDt).slice(0, 10);
    if (!dateMap.has(dateKey)) {
      dateMap.set(dateKey, { total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 });
    }
    const entry = dateMap.get(dateKey);
    entry.total++;
    const st = String(ex.status || '').toUpperCase();
    if (st === 'PASSED' || st === 'PASS') entry.passed++;
    else if (st === 'FAILED' || st === 'FAIL') entry.failed++;
    else if (st === 'BLOCKED' || st === 'BLOCK') entry.blocked++;
    else if (st === 'SKIPPED' || st === 'SKIP') entry.skipped++;
  }

  const sortedDates = Array.from(dateMap.keys()).sort().reverse();
  if (counter) counter.textContent = `${sortedDates.length} active testing days`;

  if (sortedDates.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        No daily activity recorded for this filter scope.
      </div>
    `;
    return;
  }

  let rows = '';
  for (const date of sortedDates) {
    const d = dateMap.get(date);
    const passRate = d.total > 0 ? Math.round((d.passed / d.total) * 100) : 0;
    const badgeClass = passRate >= 80 ? 'badge-pass' : passRate >= 50 ? 'badge-amber' : 'badge-fail';
    rows += `
      <tr>
        <td style="font-weight: 600; font-family: var(--font-mono); font-size: 0.8125rem;">${escapeHtml(date)}</td>
        <td><strong>${d.total}</strong></td>
        <td style="color: var(--color-green);">${d.passed}</td>
        <td style="color: var(--color-red);">${d.failed}</td>
        <td style="color: var(--color-amber);">${d.blocked}</td>
        <td><span class="project-badge ${badgeClass}">${passRate}%</span></td>
      </tr>
    `;
  }

  container.innerHTML = `
    <table class="table-cases">
      <thead>
        <tr>
          <th>Date</th>
          <th>Total Runs</th>
          <th>Passed</th>
          <th>Failed</th>
          <th>Blocked</th>
          <th>Pass Rate</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

// 5. Phase Coverage Table
function renderPhaseCoverageTable(projects) {
  const container = document.getElementById('rep-phases-table-container');
  const counter = document.getElementById('rep-phases-counter');
  if (!container) return;

  const phaseMap = new Map();
  for (const proj of projects) {
    for (const ph of (proj.phases || [])) {
      const name = ph.name || 'General';
      if (!phaseMap.has(name)) {
        phaseMap.set(name, { suiteCount: 0, caseCount: 0, executedCount: 0 });
      }
      const entry = phaseMap.get(name);
      entry.suiteCount += (ph.suites || []).length;
      for (const su of (ph.suites || [])) {
        entry.caseCount += (su.testCases || []).length;
        for (const tc of (su.testCases || [])) {
          if (tc.status && tc.status !== 'NOT_RUN' && tc.status !== 'DRAFT') {
            entry.executedCount++;
          }
        }
      }
    }
  }

  const phaseNames = Array.from(phaseMap.keys());
  if (counter) counter.textContent = `${phaseNames.length} phases`;

  if (phaseNames.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        No test phases defined.
      </div>
    `;
    return;
  }

  let rows = '';
  for (const name of phaseNames) {
    const p = phaseMap.get(name);
    const pct = p.caseCount > 0 ? Math.round((p.executedCount / p.caseCount) * 100) : 0;
    rows += `
      <tr>
        <td style="font-weight: 600;">${escapeHtml(name)}</td>
        <td>${p.suiteCount} suites</td>
        <td>${p.caseCount} cases</td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="flex: 1; height: 6px; background-color: var(--border-color); border-radius: 999px; overflow: hidden; min-width: 60px;">
              <div style="height: 100%; width: ${pct}%; background-color: var(--color-green); border-radius: 999px;"></div>
            </div>
            <span style="font-size: 0.75rem; font-weight: 600;">${pct}%</span>
          </div>
        </td>
      </tr>
    `;
  }

  container.innerHTML = `
    <table class="table-cases">
      <thead>
        <tr>
          <th>Phase Name</th>
          <th>Suites</th>
          <th>Cases</th>
          <th>Execution Coverage</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

// 6. Priority Breakdown
function renderPriorityBreakdown(cases) {
  const container = document.getElementById('rep-priority-container');
  if (!container) return;

  const total = cases.length;
  const counts = { Critical: 0, High: 0, Medium: 0, Low: 0 };

  for (const c of cases) {
    const prio = c.priority || 'Medium';
    if (counts[prio] !== undefined) counts[prio]++;
    else counts.Medium++;
  }

  const prios = [
    { label: 'Critical', count: counts.Critical, color: 'var(--color-red, #ef4444)' },
    { label: 'High', count: counts.High, color: 'var(--color-amber, #f59e0b)' },
    { label: 'Medium', count: counts.Medium, color: 'var(--color-blue, #3b82f6)' },
    { label: 'Low', count: counts.Low, color: 'var(--text-muted, #94a3b8)' }
  ];

  let html = `<div style="display: flex; flex-direction: column; gap: 14px;">`;
  for (const p of prios) {
    const pct = total > 0 ? Math.round((p.count / total) * 100) : 0;
    html += `
      <div>
        <div style="display: flex; justify-content: space-between; font-size: 0.8125rem; margin-bottom: 4px;">
          <span style="font-weight: 600; color: var(--text-primary);">${p.label}</span>
          <span style="color: var(--text-secondary);">${p.count} cases (${pct}%)</span>
        </div>
        <div style="height: 8px; background-color: var(--border-color); border-radius: 999px; overflow: hidden;">
          <div style="height: 100%; width: ${pct}%; background-color: ${p.color}; border-radius: 999px;"></div>
        </div>
      </div>
    `;
  }
  html += `</div>`;
  container.innerHTML = html;
}

// 7. Suites Quality Table
function renderSuitesQualityTable(suites, executions, defects) {
  const container = document.getElementById('rep-suites-table-container');
  const counter = document.getElementById('rep-suites-counter');
  if (!container) return;

  if (counter) counter.textContent = `${suites.length} suites`;

  if (suites.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        No test suites configured in scope.
      </div>
    `;
    return;
  }

  let rows = '';
  for (const su of suites) {
    const cases = su.testCases || [];
    const caseIds = new Set(cases.map(c => c.id));
    const suiteExecs = executions.filter(e => caseIds.has(e.testCaseId));
    const passed = suiteExecs.filter(e => String(e.status || '').toUpperCase() === 'PASSED').length;
    const failed = suiteExecs.filter(e => String(e.status || '').toUpperCase() === 'FAILED').length;
    const rate = suiteExecs.length > 0 ? Math.round((passed / suiteExecs.length) * 100) : 0;

    rows += `
      <tr>
        <td style="font-weight: 600;">${escapeHtml(su.title || 'Untitled Suite')}</td>
        <td style="color: var(--text-secondary);">${escapeHtml(su.phaseName || 'General')}</td>
        <td>${cases.length}</td>
        <td>${suiteExecs.length}</td>
        <td style="color: var(--color-green);">${passed}</td>
        <td style="color: var(--color-red);">${failed}</td>
        <td><span class="project-badge ${rate >= 80 ? 'badge-pass' : 'badge-amber'}">${rate}%</span></td>
      </tr>
    `;
  }

  container.innerHTML = `
    <table class="table-cases">
      <thead>
        <tr>
          <th>Suite Title</th>
          <th>Phase</th>
          <th>Total Cases</th>
          <th>Executions</th>
          <th>Passed</th>
          <th>Failed</th>
          <th>Pass Rate</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

// 8. Defects Breakdown & Tables
function renderDefectsBreakdown(defects) {
  const container = document.getElementById('rep-defects-breakdown-container');
  if (!container) return;

  const sevCounts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  const statusCounts = { Open: 0, 'In Progress': 0, Resolved: 0, Closed: 0 };

  for (const d of defects) {
    const sev = d.severity || 'Medium';
    if (sevCounts[sev] !== undefined) sevCounts[sev]++;
    else sevCounts.Medium++;

    const st = d.status || 'Open';
    if (statusCounts[st] !== undefined) statusCounts[st]++;
    else statusCounts.Open++;
  }

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <div>
        <h5 style="font-size: 0.8125rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px;">By Severity</h5>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
          <div class="settings-mini-stat" style="padding: 10px;">
            <span class="settings-mini-stat-label" style="color: var(--color-red);">Critical</span>
            <span class="settings-mini-stat-value" style="font-size: 1.1rem;">${sevCounts.Critical}</span>
          </div>
          <div class="settings-mini-stat" style="padding: 10px;">
            <span class="settings-mini-stat-label" style="color: var(--color-amber);">High</span>
            <span class="settings-mini-stat-value" style="font-size: 1.1rem;">${sevCounts.High}</span>
          </div>
          <div class="settings-mini-stat" style="padding: 10px;">
            <span class="settings-mini-stat-label" style="color: var(--color-blue);">Medium</span>
            <span class="settings-mini-stat-value" style="font-size: 1.1rem;">${sevCounts.Medium}</span>
          </div>
          <div class="settings-mini-stat" style="padding: 10px;">
            <span class="settings-mini-stat-label">Low</span>
            <span class="settings-mini-stat-value" style="font-size: 1.1rem;">${sevCounts.Low}</span>
          </div>
        </div>
      </div>

      <div>
        <h5 style="font-size: 0.8125rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px;">By Status</h5>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
          <div class="settings-mini-stat" style="padding: 10px;">
            <span class="settings-mini-stat-label">Open</span>
            <span class="settings-mini-stat-value" style="font-size: 1.1rem; color: var(--color-red);">${statusCounts.Open}</span>
          </div>
          <div class="settings-mini-stat" style="padding: 10px;">
            <span class="settings-mini-stat-label">In Progress</span>
            <span class="settings-mini-stat-value" style="font-size: 1.1rem; color: var(--color-amber);">${statusCounts['In Progress']}</span>
          </div>
          <div class="settings-mini-stat" style="padding: 10px;">
            <span class="settings-mini-stat-label">Resolved</span>
            <span class="settings-mini-stat-value" style="font-size: 1.1rem; color: var(--color-green);">${statusCounts.Resolved}</span>
          </div>
          <div class="settings-mini-stat" style="padding: 10px;">
            <span class="settings-mini-stat-label">Closed</span>
            <span class="settings-mini-stat-value" style="font-size: 1.1rem;">${statusCounts.Closed}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderRecentDefectsTable(defects) {
  const container = document.getElementById('rep-defects-table-container');
  const counter = document.getElementById('rep-defects-table-counter');
  if (!container) return;

  if (counter) counter.textContent = `${defects.length} defects`;

  if (defects.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        No defects recorded in scope.
      </div>
    `;
    return;
  }

  const sorted = [...defects].reverse().slice(0, 8);
  let rows = '';
  for (const d of sorted) {
    const sevBadge = d.severity === 'Critical' ? 'badge-critical' : d.severity === 'High' ? 'badge-amber' : 'badge-saas';
    const statusBadge = d.status === 'Resolved' || d.status === 'Closed' ? 'badge-pass' : 'badge-fail';
    rows += `
      <tr>
        <td style="font-family: var(--font-mono); font-size: 0.78rem;">${escapeHtml(d.defectId || d.id || '')}</td>
        <td style="font-weight: 500;">${escapeHtml(d.title || 'Untitled Defect')}</td>
        <td><span class="project-badge ${sevBadge}">${escapeHtml(d.severity || 'Medium')}</span></td>
        <td><span class="project-badge ${statusBadge}">${escapeHtml(d.status || 'Open')}</span></td>
      </tr>
    `;
  }

  container.innerHTML = `
    <table class="table-cases">
      <thead>
        <tr>
          <th>ID</th>
          <th>Title</th>
          <th>Severity</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

// 9. Recent Executions Table
function renderRecentExecutionsTable(executions) {
  const container = document.getElementById('rep-activity-table-container');
  const counter = document.getElementById('rep-activity-counter');
  if (!container) return;

  if (counter) counter.textContent = `${executions.length} executions`;

  if (executions.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        No execution logs recorded in scope.
      </div>
    `;
    return;
  }

  const sorted = [...executions].reverse().slice(0, 10);
  let rows = '';
  for (const ex of sorted) {
    const st = String(ex.status || '').toUpperCase();
    const badgeClass = st === 'PASSED' ? 'badge-pass' : st === 'FAILED' ? 'badge-fail' : 'badge-amber';
    const dt = (ex.executedAt || ex.timestamp || ex.createdAt || '').slice(0, 16).replace('T', ' ');

    rows += `
      <tr>
        <td style="font-family: var(--font-mono); font-size: 0.78rem;">${escapeHtml(ex.testCaseId || '')}</td>
        <td style="font-weight: 500;">${escapeHtml(ex.testCaseTitle || ex.title || 'Execution Run')}</td>
        <td><span class="project-badge ${badgeClass}">${escapeHtml(st || 'NOT_RUN')}</span></td>
        <td style="color: var(--text-secondary);">${escapeHtml(ex.testerName || ex.tester || 'QA Tester')}</td>
        <td style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(dt)}</td>
      </tr>
    `;
  }

  container.innerHTML = `
    <table class="table-cases">
      <thead>
        <tr>
          <th>Case ID</th>
          <th>Test Case / Run</th>
          <th>Verdict</th>
          <th>Tester</th>
          <th>Timestamp</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

// Initialise Event Listeners
export function initReportsEventListeners() {
  if (typeof document === 'undefined' || _reportsListenersBound) return;
  _reportsListenersBound = true;

  // Project selector change
  const projectSelect = document.getElementById('reports-project-select');
  if (projectSelect) {
    projectSelect.addEventListener('change', () => {
      computeAndDisplayReports();
    });
  }

  // Date filter change
  const dateFilter = document.getElementById('reports-date-filter');
  const customDatesGroup = document.getElementById('reports-custom-dates');
  if (dateFilter) {
    dateFilter.addEventListener('change', () => {
      if (customDatesGroup) {
        customDatesGroup.style.display = dateFilter.value === 'CUSTOM' ? 'inline-flex' : 'none';
      }
      if (dateFilter.value !== 'CUSTOM') {
        computeAndDisplayReports();
      }
    });
  }

  // Apply custom dates
  const applyCustomBtn = document.getElementById('reports-apply-custom-btn');
  if (applyCustomBtn) {
    applyCustomBtn.addEventListener('click', () => {
      computeAndDisplayReports();
    });
  }

  // Refresh Analytics
  const refreshBtn = document.getElementById('reports-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      computeAndDisplayReports();
    });
  }

  // Export / Print button
  const exportBtn = document.getElementById('reports-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (typeof window !== 'undefined') {
        window.print();
      }
    });
  }

  // Jump buttons
  const jumpDefectsBtn = document.getElementById('rep-jump-defects-btn');
  if (jumpDefectsBtn) {
    jumpDefectsBtn.addEventListener('click', () => {
      navigateTo('/defects');
    });
  }

  const jumpExecBtn = document.getElementById('rep-jump-exec-btn');
  if (jumpExecBtn) {
    jumpExecBtn.addEventListener('click', () => {
      navigateTo('/execution');
    });
  }
}
