import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getChecklistReportData,
  generateMarkdownReport,
  generatePlainTextReport,
  getReportFilename,
  TEST_STATUS
} from '../qaChecklistStore.js';

test('getChecklistReportData preserves null completedAt when checklist is incomplete', () => {
  const checklist = {
    id: 'chk_1',
    title: 'Auth Flow',
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T01:00:00.000Z',
    phases: [
      {
        id: 'ph_1',
        name: 'Login',
        sections: [
          {
            id: 'sec_1',
            type: 'direct',
            tests: [
              { id: 't_1', text: 'Valid login', status: TEST_STATUS.PASSED, completed: true },
              { id: 't_2', text: 'Invalid password', status: TEST_STATUS.NOT_STARTED, completed: false }
            ]
          }
        ]
      }
    ]
  };

  const report = getChecklistReportData(checklist);
  assert.equal(report.completedAt, null);
  assert.equal(report.stats.isComplete, false);
  assert.equal(report.stats.passedCount, 1);
  assert.equal(report.stats.totalTests, 2);

  const md = generateMarkdownReport(report);
  assert.match(md, /> \*\*Status\*\*: In Progress/);
  assert.match(md, /> \*\*Completion Date\*\*: N\/A/);

  const txt = generatePlainTextReport(report);
  assert.match(txt, /Testing Status\s+: IN PROGRESS \(50% Executed\)/);
});

test('getReportFilename falls back to QA_Checklist for special-character-only titles', () => {
  const filename = getReportFilename('???///', 'md');
  assert.match(filename, /^Test_Completion_Report_QA_Checklist_\d{4}-\d{2}-\d{2}\.md$/);
});

test('getChecklistReportData preserves persisted completedAt and marks completed checklists', () => {
  const persistedCompletedAt = '2026-11-06T02:30:00.000Z';
  const checklist = {
    id: 'chk_2',
    title: 'Release Signoff',
    createdAt: '2026-11-06T01:00:00.000Z',
    updatedAt: '2026-11-06T02:30:00.000Z',
    completedAt: persistedCompletedAt,
    phases: [
      {
        id: 'ph_1',
        name: 'Smoke',
        sections: [
          {
            id: 'sec_1',
            type: 'direct',
            tests: [
              { id: 't_1', text: 'Health check', status: TEST_STATUS.PASSED, completed: true }
            ]
          }
        ]
      }
    ]
  };

  const report1 = getChecklistReportData(checklist);
  const report2 = getChecklistReportData(checklist);
  assert.equal(report1.completedAt, persistedCompletedAt);
  assert.equal(report2.completedAt, persistedCompletedAt);
  assert.equal(report1.stats.isComplete, true);

  const md = generateMarkdownReport(report1);
  assert.match(md, /> \*\*Status\*\*: Completed/);

  const txt = generatePlainTextReport(report1);
  assert.match(txt, /Testing Status\s+: COMPLETED \(100% Executed\)/);
});
