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

test('ISSUE-06: apiFetch injects CSRF token for mutating requests', async () => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders = null;
  globalThis.fetch = async (url, options) => {
    capturedHeaders = options.headers;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    // With custom cookie or mock
    const { authController } = await import('../authController.js');
    authController.getCsrfToken = () => 'test-csrf-token-12345';

    await apiFetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test' })
    });

    assert.ok(capturedHeaders, 'Headers must be captured');
    assert.equal(capturedHeaders['X-CSRF-Token'], 'test-csrf-token-12345');
    assert.equal(capturedHeaders['Content-Type'], 'application/json');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ISSUE-06: authController.authenticatedFetch routes through apiFetch', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = null;
  let capturedOptions = null;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return new Response(JSON.stringify({ user: { id: 'usr_1' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const { authController } = await import('../authController.js');
    const res = await authController.authenticatedFetch('/api/test-route', {
      method: 'GET',
      headers: { 'X-Custom': 'value' }
    });

    assert.equal(res.status, 200);
    assert.equal(capturedUrl, '/api/test-route');
    assert.equal(capturedOptions.credentials, 'include');
    assert.equal(capturedOptions.headers['X-Custom'], 'value');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ISSUE-06: ChecklistAPI routes through consolidated apiFetch and preserves offline sync format', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = null;
  globalThis.fetch = async (url, options) => {
    requestedUrl = url;
    return new Response(JSON.stringify([{ id: 'chk_1', title: 'Sample' }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const { ChecklistAPI } = await import('../qaChecklistStore.js');
    const res = await ChecklistAPI.list();
    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.equal(res.error, null);
    assert.equal(requestedUrl, '/api/checklists');
    assert.ok(Array.isArray(res.data));
    assert.equal(res.data[0].id, 'chk_1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ISSUE-07: mongodb-memory-server is removed from dependencies and package-lock', async () => {
  const fs = await import('node:fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

  assert.equal(pkg.dependencies?.['mongodb-memory-server'], undefined);
  assert.equal(pkg.devDependencies?.['mongodb-memory-server'], undefined);

  if (fs.existsSync('package-lock.json')) {
    const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
    assert.equal(lock.packages?.['node_modules/mongodb-memory-server'], undefined);
  }
});
