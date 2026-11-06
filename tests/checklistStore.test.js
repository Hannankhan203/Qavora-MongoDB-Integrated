import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getActiveRunnerState,
  saveActiveRunnerState,
  clearMemoryDataStore,
  calculateChecklistProgress,
  TEST_STATUS
} from '../qaChecklistStore.js';

test('getActiveRunnerState and saveActiveRunnerState persist in-memory runner state', () => {
  clearMemoryDataStore();
  const initial = getActiveRunnerState();
  assert.deepEqual(initial, { activeChecklistId: null, lastQaView: null });

  const saveRes = saveActiveRunnerState({ activeChecklistId: 'chk_123', lastQaView: 'runner' });
  assert.equal(saveRes.ok, true);

  const restored = getActiveRunnerState();
  assert.deepEqual(restored, { activeChecklistId: 'chk_123', lastQaView: 'runner' });
  clearMemoryDataStore();
});

test('calculateChecklistProgress computes accurate completion counts', () => {
  const progress = calculateChecklistProgress({
    phases: [
      {
        sections: [
          {
            tests: [
              { status: TEST_STATUS.PASSED, completed: true },
              { status: TEST_STATUS.FAILED, completed: true },
              { status: TEST_STATUS.NOT_STARTED, completed: false }
            ]
          }
        ]
      }
    ]
  });

  assert.equal(progress.totalTests, 3);
  assert.equal(progress.completedTests, 2);
  assert.equal(progress.remainingTests, 1);
  assert.equal(progress.isComplete, false);
});
