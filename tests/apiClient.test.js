import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, apiJson } from '../src/modules/apiClient.js';

test('apiFetch throws structured NetworkError on fetch rejection', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  try {
    await assert.rejects(
      () => apiFetch('/api/health'),
      (err) => {
        assert.equal(err.name, 'NetworkError');
        assert.equal(err.isNetworkError, true);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('apiJson returns structured offline response on network failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('NetworkError when attempting to fetch resource.');
  };

  try {
    const res = await apiJson('/api/projects');
    assert.equal(res.ok, false);
    assert.equal(res.status, 0);
    assert.equal(res.isNetworkError, true);
    assert.equal(res.response, null);
    assert.ok(res.data?.error);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
