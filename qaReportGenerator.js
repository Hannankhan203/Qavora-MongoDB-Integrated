/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Test Completion Report Generator & Exporter
 * Extracted from qaChecklistStore.js for modular maintainability.
 */

/**
 * Generates README-compatible Markdown (.md) report with headings, summary tables, lists, and code blocks.
 */
export function generateMarkdownReport(reportData) {
  if (!reportData) return '';

  const {
    title,
    createdAt,
    completedAt,
    completedBy,
    originalPrompt,
    stats,
    phases,
    documentNotes
  } = reportData;

  const formatDate = (isoStr) => {
    if (!isoStr) return 'N/A';
    const d = new Date(isoStr);
    return Number.isNaN(d.getTime()) ? isoStr : d.toUTCString();
  };

  const testerStr = completedBy
    ? `${completedBy.name || 'QA Tester'}${completedBy.role ? ` (${completedBy.role})` : ''}${completedBy.email ? ` <${completedBy.email}>` : ''}`
    : 'QA Testing Team';

  let md = '';

  const statusLabel = stats.isComplete ? 'Completed' : 'In Progress';
  md += `# Test Completion Report: ${title}\n\n`;
  md += `> **Status**: ${statusLabel}  \n`;
  md += `> **Completion Date**: ${formatDate(completedAt)}  \n`;
  md += `> **Session Started**: ${formatDate(createdAt)}  \n`;
  md += `> **Executed By**: ${testerStr}  \n`;
  md += `> **Platform**: Qavora Manual QA Testing Manager  \n\n`;

  md += `## 1. Executive Summary & Statistics\n\n`;
  md += `| Metric | Count | Percentage |\n`;
  md += `| :--- | :---: | :---: |\n`;
  md += `| **Total Failure Areas / Scenarios** | ${stats.totalPhases} | 100% |\n`;
  md += `| **Total Test Cases Executed** | ${stats.totalTests} | 100% |\n`;
  md += `| **Passed Tests** | ${stats.passedCount} | ${stats.passRate}% |\n`;
  md += `| **Failed Tests** | ${stats.failedCount} | ${stats.failRate}% |\n`;
  md += `| **Skipped Tests** | ${stats.skippedCount} | ${stats.totalTests > 0 ? Math.round((stats.skippedCount / stats.totalTests) * 100) : 0}% |\n\n`;

  md += `### Failure Area Summary Breakdown\n\n`;
  md += `| # | Failure Area / Phase | Total Tests | Passed | Failed | Skipped | Pass Rate |\n`;
  md += `| :---: | :--- | :---: | :---: | :---: | :---: | :---: |\n`;
  phases.forEach((p, idx) => {
    const label = p.phaseLabel ? `${p.phaseLabel}: ${p.name}` : p.name;
    md += `| ${idx + 1} | ${label.replace(/\|/g, '\\|')} | ${p.stats.total} | ${p.stats.passed} | ${p.stats.failed} | ${p.stats.skipped} | ${p.stats.passRate}% |\n`;
  });
  md += `\n---\n\n`;

  if (documentNotes && documentNotes.length > 0) {
    md += `## 2. Test Environment & Prerequisites\n\n`;
    documentNotes.forEach(n => {
      md += `- **[${(n.kind || 'Note').toUpperCase()}]**: ${n.text}\n`;
    });
    md += `\n---\n\n`;
  }

  md += `## 3. Original Testing Prompt & Requirements\n\n`;
  md += `The testing session was generated from the following specification prompt:\n\n`;
  md += `\`\`\`text\n`;
  md += (originalPrompt && originalPrompt.trim() ? originalPrompt.trim() : '(No initial prompt recorded for this checklist session)') + '\n';
  md += `\`\`\`\n\n`;
  md += `---\n\n`;

  md += `## 4. Comprehensive Test Results by Failure Area\n\n`;
  phases.forEach((p, idx) => {
    const heading = p.phaseLabel ? `${p.phaseLabel} — ${p.name}` : p.name;
    md += `### 4.${idx + 1}. ${heading}\n\n`;
    if (p.description) {
      md += `**Failure Description / Scope**:\n${p.description}\n\n`;
    }

    if (p.notes && p.notes.length > 0) {
      p.notes.forEach(n => {
        md += `> **${(n.kind || 'Note').toUpperCase()}**: ${n.text}\n`;
      });
      md += `\n`;
    }

    let flatTests = [];
    (p.sections || []).forEach(sec => {
      const secName = sec.type === 'category' ? sec.name : '';
      (sec.tests || []).forEach(tc => {
        flatTests.push({ ...tc, categoryName: secName });
      });
    });

    if (flatTests.length === 0) {
      md += `*No tests recorded for this phase.*\n\n`;
    } else {
      md += `| Test ID | Category / Scenario | Test Performed | Priority | Result |\n`;
      md += `| :--- | :--- | :--- | :---: | :---: |\n`;
      flatTests.forEach(t => {
        const tid = t.testId ? `\`${t.testId.replace(/\|/g, '\\|')}\`` : '—';
        const cat = t.categoryName ? t.categoryName.replace(/\|/g, '\\|') : 'General';
        const desc = (t.text || '').replace(/\|/g, '\\|');
        const prio = t.priority ? t.priority : '—';
        let resBadge = `**${t.status}**`;
        if (t.status === 'Passed' || t.status === 'Completed') {
          resBadge = '✅ **PASSED**';
        } else if (t.status === 'Failed') {
          resBadge = '❌ **FAILED**';
        } else if (t.status === 'Skipped') {
          resBadge = '⚠️ **SKIPPED**';
        }
        md += `| ${tid} | ${cat} | ${desc} | ${prio} | ${resBadge} |\n`;
      });
      md += `\n`;
    }
  });

  md += `---\n\n`;
  md += `*Report generated on ${formatDate(completedAt)} by [Qavora](https://github.com/Hannankhan203/Qavora-MongoDB-Integrated) — Manual QA Testing Manager.*\n`;

  return md;
}

/**
 * Generates clean, readable plain-text (.txt) report with ASCII dividers.
 */
export function generatePlainTextReport(reportData) {
  if (!reportData) return '';

  const {
    title,
    createdAt,
    completedAt,
    completedBy,
    originalPrompt,
    stats,
    phases,
    documentNotes
  } = reportData;

  const formatDate = (isoStr) => {
    if (!isoStr) return 'N/A';
    const d = new Date(isoStr);
    return Number.isNaN(d.getTime()) ? isoStr : d.toUTCString();
  };

  const divider = '='.repeat(80);
  const subDivider = '-'.repeat(80);

  let out = [];

  out.push(divider);
  out.push('QAVORA — MANUAL QA TEST COMPLETION REPORT');
  out.push(divider);
  const pct = stats.totalTests > 0 ? Math.round((stats.completedTests / stats.totalTests) * 100) : 0;
  const txtStatus = stats.isComplete ? 'COMPLETED (100% Executed)' : `IN PROGRESS (${pct}% Executed)`;
  out.push(`Project / Title   : ${title}`);
  out.push(`Testing Status    : ${txtStatus}`);
  out.push(`Completion Date   : ${formatDate(completedAt)}`);
  out.push(`Session Started   : ${formatDate(createdAt)}`);
  const testerName = completedBy
    ? `${completedBy.name || 'QA Tester'}${completedBy.role ? ` (${completedBy.role})` : ''}`
    : 'QA Tester';
  out.push(`Tester / Role     : ${testerName}`);
  out.push(divider);
  out.push('');

  out.push(subDivider);
  out.push('1. OVERALL TESTING SUMMARY & STATISTICS');
  out.push(subDivider);
  out.push(`Total Failure Areas / Scenarios : ${stats.totalPhases}`);
  out.push(`Total Tests Executed            : ${stats.totalTests}`);
  out.push(`  - Passed                      : ${stats.passedCount} (${stats.passRate}%)`);
  out.push(`  - Failed                      : ${stats.failedCount} (${stats.failRate}%)`);
  out.push(`  - Skipped                     : ${stats.skippedCount}`);
  out.push('');
  out.push('Breakdown by Failure Area:');
  phases.forEach((p, idx) => {
    const label = p.phaseLabel ? `${p.phaseLabel}: ${p.name}` : p.name;
    out.push(`  [${idx + 1}] ${label}`);
    out.push(`      Total: ${p.stats.total} | Passed: ${p.stats.passed} | Failed: ${p.stats.failed} | Skipped: ${p.stats.skipped} | Pass Rate: ${p.stats.passRate}%`);
  });
  out.push('');

  if (documentNotes && documentNotes.length > 0) {
    out.push(subDivider);
    out.push('2. TEST ENVIRONMENT & PREREQUISITES');
    out.push(subDivider);
    documentNotes.forEach(n => {
      out.push(`* [${(n.kind || 'NOTE').toUpperCase()}] ${n.text}`);
    });
    out.push('');
  }

  out.push(subDivider);
  out.push('3. ORIGINAL TESTING PROMPT & REQUIREMENTS');
  out.push(subDivider);
  if (originalPrompt && originalPrompt.trim()) {
    out.push(originalPrompt.trim());
  } else {
    out.push('(No initial prompt recorded for this checklist session)');
  }
  out.push('');

  out.push(subDivider);
  out.push('4. DETAILED RESULTS BY FAILURE AREA & TESTS');
  out.push(subDivider);

  phases.forEach((p, idx) => {
    const heading = p.phaseLabel ? `${p.phaseLabel} — ${p.name}` : p.name;
    out.push('--------------------------------------------------------------------------------');
    out.push(`FAILURE AREA ${idx + 1}: ${heading}`);
    out.push('--------------------------------------------------------------------------------');
    if (p.description) {
      out.push(`Description: ${p.description}`);
    }
    if (p.notes && p.notes.length > 0) {
      p.notes.forEach(n => {
        out.push(`Note [${(n.kind || 'NOTE').toUpperCase()}]: ${n.text}`);
      });
    }
    out.push('');

    let flatTests = [];
    (p.sections || []).forEach(sec => {
      const secName = sec.type === 'category' ? sec.name : '';
      (sec.tests || []).forEach(tc => {
        flatTests.push({ ...tc, categoryName: secName });
      });
    });

    if (flatTests.length === 0) {
      out.push('  No tests recorded for this failure area.');
    } else {
      flatTests.forEach(t => {
        const statusTag = String(t.status || 'DONE').toUpperCase().padEnd(7, ' ');
        const testIdPart = t.testId ? `[${t.testId}] ` : '';
        const prioPart = t.priority ? `(${t.priority}) ` : '';
        const catPart = t.categoryName ? `[${t.categoryName}] ` : '';
        out.push(`  [${statusTag}] ${testIdPart}${catPart}${prioPart}${t.text}`);
      });
    }
    out.push('');
  });

  out.push(divider);
  out.push(`Report generated by Qavora — Manual QA Testing Manager on ${formatDate(completedAt)}`);
  out.push(divider);

  return out.join('\n');
}

/**
 * Returns a standardized, meaningful filename for exporting reports.
 */
export function getReportFilename(title, ext = 'md') {
  const cleanExt = ext.replace(/^\./, '');
  const cleanTitle = (title || 'QA_Checklist')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 50);
  const dateStr = new Date().toISOString().slice(0, 10);
  return `Test_Completion_Report_${cleanTitle || 'QA_Checklist'}_${dateStr}.${cleanExt}`;
}

/**
 * Initiates client-side file download with given filename, contents, and MIME type.
 */
export function downloadFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
