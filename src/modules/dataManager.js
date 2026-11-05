/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Data Management, Import/Export, Backups & Rollback Module (Phase 6)
 */

import authController from '../../authController.js';
import { apiFetch } from './apiClient.js';
import { getProjects, setProjects, setActiveProjectId } from './state.js';
import { loadProjectsFromBackend, updateSidebarProjectCounters, renderProjectsGrid } from './projectManager.js';
import { showToast, navigateTo } from './uiRenderer.js';
import { escapeHtml } from './utils.js';

let _dataListenersBound = false;
let _rollbackSnapshot = null;
let _stagedImportData = null;

// Formula injection sanitizer and CSV generator
function sanitizeCsvCell(value) {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  // Defend against formula injection in spreadsheet engines
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function exportCsvFile(filename, headers, rows) {
  const bom = '\uFEFF';
  const csvContent = [
    headers.map(sanitizeCsvCell).join(','),
    ...rows.map(row => row.map(sanitizeCsvCell).join(','))
  ].join('\r\n');

  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function renderDataManagementWorkspace() {
  if (typeof document === 'undefined') return;

  const projects = getProjects() || [];

  // 1. Compute Stats Ribbon
  let totalPlans = 0;
  let totalSuites = 0;
  let totalCases = 0;
  let totalExecs = 0;
  let totalDefects = 0;

  for (const p of projects) {
    if (p.phases && p.phases.length > 0) totalPlans++;
    for (const ph of (p.phases || [])) {
      totalSuites += (ph.suites || []).length;
      for (const su of (ph.suites || [])) {
        totalCases += (su.testCases || []).length;
      }
    }
    totalExecs += (p.executions || []).length;
    totalDefects += (p.defects || []).length;
  }

  setEl('data-stat-projects', projects.length);
  setEl('data-stat-plans', totalPlans);
  setEl('data-stat-suites', totalSuites);
  setEl('data-stat-cases', totalCases);
  setEl('data-stat-execs', totalExecs);
  setEl('data-stat-defects', totalDefects);

  // Checklists count from backend
  apiFetch('/api/checklists').then(async res => {
    if (res.ok) {
      const chk = await res.json();
      if (Array.isArray(chk)) {
        setEl('data-stat-checklists', chk.length);
      }
    }
  }).catch(() => {});

  // Compute Footprint
  const serialized = JSON.stringify(projects);
  const bytes = new Blob([serialized]).size;
  const kb = (bytes / 1024).toFixed(1);
  const pct = Math.min(100, Math.max(0.1, (bytes / (5 * 1024 * 1024)) * 100)).toFixed(1);

  setEl('data-stat-storage-size', `${kb} KB`);
  setEl('data-stat-storage-percent', `${pct}% used`);
  const bar = document.getElementById('data-stat-storage-bar');
  if (bar) bar.style.width = `${Math.min(100, parseFloat(pct))}%`;

  // 2. Populate Dropdowns
  populateDataProjectDropdowns(projects);

  // 3. Update Rollback Card
  updateRollbackUI();
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(val);
}

function populateDataProjectDropdowns(projects) {
  const exportSelect = document.getElementById('export-project-select');
  const printSelect = document.getElementById('print-project-select');
  const csvScopeSelect = document.getElementById('export-csv-scope-select');

  if (exportSelect) {
    if (projects.length === 0) {
      exportSelect.innerHTML = `<option value="">No projects available</option>`;
    } else {
      exportSelect.innerHTML = projects.map(p => `
        <option value="${escapeHtml(p.id)}">${escapeHtml(p.name || 'Untitled Project')}</option>
      `).join('');
    }
  }

  if (printSelect) {
    let opts = `<option value="ALL">All Projects (Global Summary)</option>`;
    for (const p of projects) {
      opts += `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || 'Untitled Project')}</option>`;
    }
    printSelect.innerHTML = opts;
  }

  if (csvScopeSelect) {
    let opts = `<option value="ALL">All Projects (All Data)</option>`;
    for (const p of projects) {
      opts += `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || 'Untitled Project')}</option>`;
    }
    csvScopeSelect.innerHTML = opts;
  }
}

function updateRollbackUI() {
  const badge = document.getElementById('rollback-status-badge');
  const title = document.getElementById('rollback-snapshot-title');
  const meta = document.getElementById('rollback-snapshot-meta');
  const btn = document.getElementById('btn-execute-rollback');

  if (_rollbackSnapshot) {
    if (badge) {
      badge.textContent = '1 Snapshot Available';
      badge.className = 'panel-tag badge-pass';
    }
    if (title) {
      title.textContent = `Pre-restore snapshot: ${_rollbackSnapshot.projects?.length || 0} projects preserved`;
    }
    if (meta) {
      meta.textContent = `Captured on ${_rollbackSnapshot.timestamp} before overwrite restore.`;
    }
    if (btn) btn.disabled = false;
  } else {
    if (badge) {
      badge.textContent = 'No Snapshot';
      badge.className = 'panel-tag';
    }
    if (title) {
      title.textContent = 'No recovery snapshot currently stored.';
    }
    if (meta) {
      meta.textContent = 'Snapshots are created automatically before any replace/overwrite import.';
    }
    if (btn) btn.disabled = true;
  }
}

// ----------------------------------------------------------------------------
// CSV Generators
// ----------------------------------------------------------------------------
function getScopedProjectsForCsv() {
  const scopeSelect = document.getElementById('export-csv-scope-select');
  const scopeVal = scopeSelect ? scopeSelect.value : 'ALL';
  const allProjects = getProjects() || [];
  if (scopeVal === 'ALL') return allProjects;
  return allProjects.filter(p => p.id === scopeVal);
}

function exportTestCasesCsv() {
  const scoped = getScopedProjectsForCsv();
  const headers = ['Project Name', 'Phase', 'Suite Title', 'Case ID', 'Title', 'Priority', 'Status', 'Preconditions', 'Expected Result', 'Steps Count'];
  const rows = [];

  for (const p of scoped) {
    for (const ph of (p.phases || [])) {
      for (const su of (ph.suites || [])) {
        for (const tc of (su.testCases || [])) {
          rows.push([
            p.name || '',
            ph.name || '',
            su.title || '',
            tc.id || '',
            tc.title || '',
            tc.priority || 'Medium',
            tc.status || 'NOT_RUN',
            tc.preconditions || '',
            tc.expectedResult || '',
            (tc.steps || []).length
          ]);
        }
      }
    }
  }

  const timestamp = new Date().toISOString().slice(0, 10);
  exportCsvFile(`Qavora_TestCases_${timestamp}.csv`, headers, rows);
  showToast(`Exported ${rows.length} test cases to CSV`, 'success');
}

function exportExecutionsCsv() {
  const scoped = getScopedProjectsForCsv();
  const headers = ['Project Name', 'Execution ID', 'Case ID', 'Case Title', 'Verdict', 'Tester', 'Environment', 'Device/Browser', 'Build Version', 'Timestamp', 'Notes'];
  const rows = [];

  for (const p of scoped) {
    for (const ex of (p.executions || [])) {
      rows.push([
        p.name || '',
        ex.id || '',
        ex.testCaseId || '',
        ex.testCaseTitle || '',
        ex.status || '',
        ex.testerName || ex.tester || '',
        ex.environment || '',
        ex.browser || ex.device || '',
        ex.buildVersion || '',
        ex.executedAt || ex.timestamp || '',
        ex.notes || ex.actualResult || ''
      ]);
    }
  }

  const timestamp = new Date().toISOString().slice(0, 10);
  exportCsvFile(`Qavora_Executions_${timestamp}.csv`, headers, rows);
  showToast(`Exported ${rows.length} execution logs to CSV`, 'success');
}

function exportDefectsCsv() {
  const scoped = getScopedProjectsForCsv();
  const headers = ['Project Name', 'Defect ID', 'Title', 'Severity', 'Status', 'Linked Case ID', 'Reporter', 'Created At', 'Reproduction Steps', 'Expected Outcome', 'Actual Outcome'];
  const rows = [];

  for (const p of scoped) {
    for (const def of (p.defects || [])) {
      rows.push([
        p.name || '',
        def.defectId || def.id || '',
        def.title || '',
        def.severity || 'Medium',
        def.status || 'Open',
        def.testCaseId || '',
        def.reporterName || def.reporter || '',
        def.createdAt || '',
        def.stepsToReproduce || '',
        def.expectedResult || '',
        def.actualResult || ''
      ]);
    }
  }

  const timestamp = new Date().toISOString().slice(0, 10);
  exportCsvFile(`Qavora_Defects_${timestamp}.csv`, headers, rows);
  showToast(`Exported ${rows.length} defects to CSV`, 'success');
}

async function exportChecklistsCsv() {
  try {
    const res = await apiFetch('/api/checklists');
    if (!res.ok) throw new Error('Failed to fetch checklists');
    const checklists = await res.json();
    const headers = ['Checklist ID', 'Title', 'Phase', 'Category', 'Total Items', 'Checked Items', 'Completion %', 'Created At'];
    const rows = [];

    for (const c of (checklists || [])) {
      const items = c.items || [];
      const checked = items.filter(i => i.completed || i.checked).length;
      const pct = items.length > 0 ? Math.round((checked / items.length) * 100) : 0;
      rows.push([
        c.id || '',
        c.title || '',
        c.phase || '',
        c.category || '',
        items.length,
        checked,
        `${pct}%`,
        c.createdAt || ''
      ]);
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    exportCsvFile(`Qavora_Checklists_${timestamp}.csv`, headers, rows);
    showToast(`Exported ${rows.length} QA checklists to CSV`, 'success');
  } catch (err) {
    showToast(err.message || 'Error exporting checklists', 'error');
  }
}

// ----------------------------------------------------------------------------
// Printable Reports (Executive Summary & Health)
// ----------------------------------------------------------------------------
function generatePrintableReport() {
  const printSelect = document.getElementById('print-project-select');
  const typeSelect = document.getElementById('print-report-type-select');

  const scopeVal = printSelect ? printSelect.value : 'ALL';
  const reportType = typeSelect ? typeSelect.value : 'qa-summary';
  const allProjects = getProjects() || [];
  const scoped = scopeVal === 'ALL' ? allProjects : allProjects.filter(p => p.id === scopeVal);

  const scopeTitle = scopeVal === 'ALL' ? 'Global QA Portfolio' : (scoped[0]?.name || 'Project QA');
  const nowStr = new Date().toLocaleString();

  let casesCount = 0;
  let execsCount = 0;
  let passedCount = 0;
  let failedCount = 0;
  let defectsCount = 0;
  let openDefectsCount = 0;

  for (const p of scoped) {
    for (const ph of (p.phases || [])) {
      for (const su of (ph.suites || [])) {
        casesCount += (su.testCases || []).length;
      }
    }
    for (const ex of (p.executions || [])) {
      execsCount++;
      const st = String(ex.status || '').toUpperCase();
      if (st === 'PASSED') passedCount++;
      else if (st === 'FAILED') failedCount++;
    }
    for (const d of (p.defects || [])) {
      defectsCount++;
      const st = String(d.status || '').toLowerCase();
      if (st !== 'resolved' && st !== 'closed') openDefectsCount++;
    }
  }

  const passRate = execsCount > 0 ? Math.round((passedCount / execsCount) * 100) : 0;

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('Popup blocker prevented opening the print report. Please allow popups.', 'warning');
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Qavora — ${escapeHtml(scopeTitle)} Executive Report</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #1e293b; }
        h1 { font-size: 24px; margin-bottom: 4px; color: #0f172a; }
        .meta { font-size: 13px; color: #64748b; margin-bottom: 24px; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; }
        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 28px; }
        .stat-box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px; }
        .stat-num { font-size: 22px; font-weight: 700; color: #0f172a; }
        .stat-lbl { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
        th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
        th { background: #f8fafc; font-weight: 600; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <h1>Qavora Quality Assurance Executive Summary</h1>
      <div class="meta">
        Scope: <strong>${escapeHtml(scopeTitle)}</strong> • Generated: ${escapeHtml(nowStr)} • Report Format: ${escapeHtml(reportType)}
      </div>

      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-num">${casesCount}</div>
          <div class="stat-lbl">Total Test Cases</div>
        </div>
        <div class="stat-box">
          <div class="stat-num">${execsCount}</div>
          <div class="stat-lbl">Total Executions</div>
        </div>
        <div class="stat-box">
          <div class="stat-num" style="color: #10b981;">${passRate}%</div>
          <div class="stat-lbl">Pass Rate (${passedCount} passed)</div>
        </div>
        <div class="stat-box">
          <div class="stat-num" style="color: #ef4444;">${openDefectsCount}</div>
          <div class="stat-lbl">Open Defects (${defectsCount} total)</div>
        </div>
      </div>

      <h3>Projects Overview</h3>
      <table>
        <thead>
          <tr>
            <th>Project Name</th>
            <th>Type</th>
            <th>Phases</th>
            <th>Suites</th>
            <th>Executions</th>
            <th>Defects</th>
          </tr>
        </thead>
        <tbody>
          ${scoped.map(p => `
            <tr>
              <td><strong>${escapeHtml(p.name || 'Untitled')}</strong></td>
              <td>${escapeHtml(p.projectType || 'Standard')}</td>
              <td>${(p.phases || []).length}</td>
              <td>${(p.phases || []).reduce((acc, ph) => acc + (ph.suites || []).length, 0)}</td>
              <td>${(p.executions || []).length}</td>
              <td>${(p.defects || []).length}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <script>
        window.onload = function() { window.print(); };
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

// ----------------------------------------------------------------------------
// Validation & Preview Modal for Imports
// ----------------------------------------------------------------------------
function parseAndValidateImportPayload(fileText, fileName, fileSize) {
  let parsed;
  try {
    parsed = JSON.parse(fileText);
  } catch (err) {
    throw new Error('File is not a valid JSON document.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid JSON structure: Root must be an object.');
  }

  // Detect payload type: Full backup vs Single Project vs Raw projects array
  let projects = [];
  let formatType = 'Custom JSON';

  if (Array.isArray(parsed.projects)) {
    projects = parsed.projects;
    formatType = parsed.application === 'Qavora' ? 'Full Application Backup' : 'Multi-Project Archive';
  } else if (parsed.name && (parsed.phases || parsed.testSuites || parsed.id)) {
    // Single project export
    projects = [parsed];
    formatType = 'Individual Project Export';
  } else if (Array.isArray(parsed)) {
    projects = parsed;
    formatType = 'Projects List';
  } else {
    throw new Error('Unrecognized Qavora schema: Missing "projects" array or valid project document.');
  }

  // Normalize project structure
  const normalizedProjects = projects.map((p, idx) => {
    return {
      id: p.id || `proj_${Date.now()}_${idx}`,
      name: p.name || `Imported Project ${idx + 1}`,
      description: p.description || '',
      projectType: p.projectType || 'Web Application',
      status: p.status || 'Active',
      phases: Array.isArray(p.phases) ? p.phases : [],
      executions: Array.isArray(p.executions) ? p.executions : [],
      defects: Array.isArray(p.defects) ? p.defects : [],
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  });

  return {
    fileName,
    fileSize: `${(fileSize / 1024).toFixed(1)} KB`,
    formatType,
    exportedAt: parsed.exportedAt || 'Unknown',
    projects: normalizedProjects
  };
}

function openImportPreviewModal(importData) {
  _stagedImportData = importData;

  const modal = document.getElementById('import-preview-modal');
  if (!modal) return;

  setEl('import-preview-filename', importData.fileName);
  setEl('import-preview-filesize', importData.fileSize);
  setEl('import-preview-format', importData.formatType);
  setEl('import-preview-date', importData.exportedAt);

  // Compute item counts
  let plans = 0;
  let suites = 0;
  let cases = 0;
  let execs = 0;
  let defects = 0;

  for (const p of importData.projects) {
    if (p.phases.length > 0) plans++;
    for (const ph of p.phases) {
      suites += (ph.suites || []).length;
      for (const su of (ph.suites || [])) {
        cases += (su.testCases || []).length;
      }
    }
    execs += p.executions.length;
    defects += p.defects.length;
  }

  setEl('import-preview-projects-cnt', importData.projects.length);
  setEl('import-preview-plans-cnt', plans);
  setEl('import-preview-suites-cnt', suites);
  setEl('import-preview-cases-cnt', cases);
  setEl('import-preview-execs-cnt', execs);
  setEl('import-preview-defects-cnt', defects);

  // Render project pills
  const listEl = document.getElementById('import-preview-projects-list');
  if (listEl) {
    listEl.innerHTML = importData.projects.map(p => `
      <div style="padding: 6px 12px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: 0.8125rem; font-weight: 500;">
        ${escapeHtml(p.name)} (${(p.phases || []).length} phases)
      </div>
    `).join('');
  }

  modal.classList.add('active');
  modal.style.display = 'flex';
}

function closeImportPreviewModal() {
  const modal = document.getElementById('import-preview-modal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
  _stagedImportData = null;
}

async function executeConfirmedImport() {
  if (!_stagedImportData || !_stagedImportData.projects) return;

  const modeRadio = document.querySelector('input[name="import-mode"]:checked');
  const mode = modeRadio ? modeRadio.value : 'merge';
  const existing = getProjects() || [];

  if (mode === 'replace') {
    // Preserve rollback snapshot first
    _rollbackSnapshot = {
      timestamp: new Date().toLocaleString(),
      projects: JSON.parse(JSON.stringify(existing))
    };

    // Save each imported project to backend
    // Delete existing projects from backend
    for (const p of existing) {
      await apiFetch(`/api/projects/${p.id}`, { method: 'DELETE' }).catch(() => {});
    }

    // Insert imported projects
    for (const p of _stagedImportData.projects) {
      await apiFetch('/api/projects', {
        method: 'POST',
        body: JSON.stringify(p)
      }).catch(() => {});
    }
  } else {
    // Merge mode: re-assign unique ID if colliding
    const existingIds = new Set(existing.map(p => p.id));
    for (const p of _stagedImportData.projects) {
      let targetProject = { ...p };
      if (existingIds.has(targetProject.id)) {
        targetProject.id = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        targetProject.name = `${targetProject.name} (Imported)`;
      }
      await apiFetch('/api/projects', {
        method: 'POST',
        body: JSON.stringify(targetProject)
      }).catch(() => {});
    }
  }

  closeImportPreviewModal();
  await loadProjectsFromBackend();
  updateSidebarProjectCounters();
  renderProjectsGrid();
  renderDataManagementWorkspace();
  showToast(`Successfully imported ${_stagedImportData.projects.length} project(s) via ${mode} mode`, 'success');
}

// ----------------------------------------------------------------------------
// Reset Workspace Modal
// ----------------------------------------------------------------------------
function openResetModal() {
  const modal = document.getElementById('reset-confirm-modal');
  const checkbox = document.getElementById('reset-confirm-checkbox');
  if (checkbox) checkbox.checked = false;
  if (modal) {
    modal.classList.add('active');
    modal.style.display = 'flex';
  }
}

function closeResetModal() {
  const modal = document.getElementById('reset-confirm-modal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
}

async function executeWorkspaceReset() {
  const checkbox = document.getElementById('reset-confirm-checkbox');
  if (!checkbox || !checkbox.checked) {
    showToast('Please check the confirmation box to confirm reset.', 'warning');
    return;
  }

  try {
    const res = await apiFetch('/api/data/reset', { method: 'POST' });
    if (res.ok) {
      closeResetModal();
      setProjects([]);
      updateSidebarProjectCounters();
      renderProjectsGrid();
      renderDataManagementWorkspace();
      showToast('All workspace test data has been permanently cleared.', 'info');
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to reset workspace data.', 'error');
    }
  } catch (err) {
    showToast(err.message || 'Error executing reset.', 'error');
  }
}

// ----------------------------------------------------------------------------
// Event Listeners
// ----------------------------------------------------------------------------
export function initDataManagementEventListeners() {
  if (typeof document === 'undefined' || _dataListenersBound) return;
  _dataListenersBound = true;

  // 1. Tab Switching
  const tabBtns = document.querySelectorAll('.data-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      tabBtns.forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      const panels = document.querySelectorAll('.data-tab-panel');
      panels.forEach(p => {
        const isMatch = p.id === `data-tabpanel-${targetTab}`;
        p.classList.toggle('active', isMatch);
      });
    });
  });

  // 2. Export Individual Project JSON
  const btnExportProject = document.getElementById('btn-export-project-json');
  if (btnExportProject) {
    btnExportProject.addEventListener('click', () => {
      const select = document.getElementById('export-project-select');
      const pid = select ? select.value : null;
      if (!pid) {
        showToast('Please select a project to export.', 'warning');
        return;
      }
      const p = (getProjects() || []).find(proj => proj.id === pid);
      if (!p) {
        showToast('Selected project not found.', 'error');
        return;
      }

      const filename = `Qavora_Project_${p.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`;
      const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Exported "${p.name}" to JSON`, 'success');
    });
  }

  // 3. Printable QA Report
  const btnPrint = document.getElementById('btn-print-qa-report');
  if (btnPrint) {
    btnPrint.addEventListener('click', generatePrintableReport);
  }

  // 4. CSV Exports
  const btnCasesCsv = document.getElementById('btn-export-cases-csv');
  if (btnCasesCsv) btnCasesCsv.addEventListener('click', exportTestCasesCsv);

  const btnExecsCsv = document.getElementById('btn-export-execs-csv');
  if (btnExecsCsv) btnExecsCsv.addEventListener('click', exportExecutionsCsv);

  const btnDefectsCsv = document.getElementById('btn-export-defects-csv');
  if (btnDefectsCsv) btnDefectsCsv.addEventListener('click', exportDefectsCsv);

  const btnChecklistsCsv = document.getElementById('btn-export-checklists-csv');
  if (btnChecklistsCsv) btnChecklistsCsv.addEventListener('click', exportChecklistsCsv);

  // 5. Full Backup Download
  const btnFullBackup = document.getElementById('btn-create-full-backup');
  if (btnFullBackup) {
    btnFullBackup.addEventListener('click', () => {
      const projects = getProjects() || [];
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupData = {
        application: 'Qavora',
        backupVersion: 1,
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        metadata: {
          totalProjects: projects.length,
          exportedBy: authController.getCurrentUser()?.email || 'authenticated_user'
        },
        projects
      };

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Qavora_Full_Backup_${timestamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Full backup downloaded successfully', 'success');
    });
  }

  // 6. Import Drag & Drop + Browse
  const dropzone = document.getElementById('import-dropzone');
  const fileInput = document.getElementById('import-file-input');
  const browseBtn = document.getElementById('btn-browse-file');
  const validationAlert = document.getElementById('import-validation-alert');
  const validationText = document.getElementById('import-validation-text');

  if (browseBtn && fileInput) {
    browseBtn.addEventListener('click', () => fileInput.click());
  }

  const handleFile = (file) => {
    if (!file) return;
    if (validationAlert) validationAlert.style.display = 'none';

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const importData = parseAndValidateImportPayload(text, file.name, file.size);
        openImportPreviewModal(importData);
      } catch (err) {
        if (validationAlert) {
          validationAlert.style.display = 'flex';
          if (validationText) validationText.textContent = err.message || 'Invalid file format.';
        }
      }
    };
    reader.onerror = () => {
      if (validationAlert) {
        validationAlert.style.display = 'flex';
        if (validationText) validationText.textContent = 'Error reading file.';
      }
    };
    reader.readAsText(file);
  };

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) {
        handleFile(fileInput.files[0]);
        fileInput.value = '';
      }
    });
  }

  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('drag-over');
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFile(e.dataTransfer.files[0]);
      }
    });
  }

  // 7. Import Preview Modal Controls
  const closePreviewBtn = document.getElementById('import-preview-close');
  const cancelPreviewBtn = document.getElementById('import-preview-cancel-btn');
  const confirmPreviewBtn = document.getElementById('import-preview-confirm-btn');
  const replaceWarning = document.getElementById('import-replace-warning');
  const modeRadios = document.querySelectorAll('input[name="import-mode"]');

  if (closePreviewBtn) closePreviewBtn.addEventListener('click', closeImportPreviewModal);
  if (cancelPreviewBtn) cancelPreviewBtn.addEventListener('click', closeImportPreviewModal);

  modeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (replaceWarning) {
        replaceWarning.style.display = radio.value === 'replace' ? 'flex' : 'none';
      }
    });
  });

  if (confirmPreviewBtn) {
    confirmPreviewBtn.addEventListener('click', executeConfirmedImport);
  }

  // 8. Rollback Snapshot Execution
  const btnRollback = document.getElementById('btn-execute-rollback');
  if (btnRollback) {
    btnRollback.addEventListener('click', async () => {
      if (!_rollbackSnapshot) return;
      try {
        const existing = getProjects() || [];
        for (const p of existing) {
          await apiFetch(`/api/projects/${p.id}`, { method: 'DELETE' }).catch(() => {});
        }
        for (const p of _rollbackSnapshot.projects) {
          await apiFetch('/api/projects', {
            method: 'POST',
            body: JSON.stringify(p)
          }).catch(() => {});
        }

        _rollbackSnapshot = null;
        await loadProjectsFromBackend();
        updateSidebarProjectCounters();
        renderProjectsGrid();
        renderDataManagementWorkspace();
        showToast('Rollback successful: Workspace restored to previous snapshot state', 'success');
      } catch (err) {
        showToast(err.message || 'Error executing rollback.', 'error');
      }
    });
  }

  // 9. Reset Modal Controls
  const btnTriggerReset = document.getElementById('btn-trigger-reset-modal');
  const btnCloseReset = document.getElementById('reset-modal-close');
  const btnResetBackupFirst = document.getElementById('reset-backup-first-btn');

  if (btnTriggerReset) btnTriggerReset.addEventListener('click', openResetModal);
  if (btnCloseReset) btnCloseReset.addEventListener('click', closeResetModal);

  if (btnResetBackupFirst) {
    btnResetBackupFirst.addEventListener('click', () => {
      document.getElementById('btn-create-full-backup')?.click();
    });
  }

  const modalFooter = document.querySelector('#reset-confirm-modal .modal-footer');
  if (modalFooter && !document.getElementById('btn-confirm-reset-workspace')) {
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.id = 'btn-confirm-reset-workspace';
    confirmBtn.className = 'btn btn-danger';
    confirmBtn.textContent = 'Permanently Erase All Data';
    confirmBtn.addEventListener('click', executeWorkspaceReset);
    modalFooter.appendChild(confirmBtn);
  }
}
