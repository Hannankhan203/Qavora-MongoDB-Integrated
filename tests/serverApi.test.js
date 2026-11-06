import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Prevent server.ts from auto-starting on port 3000 during test import
process.env.VERCEL = '1';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-automated-tests-2026';
delete process.env.MONGODB_URI;

const { default: app } = await import('../server.ts');

async function withTestServer(fn) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.CORS_ORIGIN = baseUrl;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /api/health reports disconnected when MONGODB_URI is unset', async () => {
  await withTestServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.database, 'disconnected');
  });
});

test('Auth and API endpoints fail closed with HTTP 503 when MongoDB is offline', async () => {
  await withTestServer(async (baseUrl) => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ email: 'user@example.com', password: 'Password123!' })
    });
    assert.equal(loginRes.status, 503);

    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ name: 'Test', email: 'user@example.com', password: 'Password123!' })
    });
    assert.equal(regRes.status, 503);

    const chkRes = await fetch(`${baseUrl}/api/checklists`);
    assert.equal(chkRes.status, 503);

    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    assert.equal(csrfRes.status, 503);
    const csrfSetCookie = csrfRes.headers.get('set-cookie') || '';
    assert.equal(csrfSetCookie.includes('csrf_token'), false, 'No CSRF cookie should be issued when offline');
  });
});

test('CSRF middleware rejects state-changing requests with missing or mismatched tokens', async () => {
  await withTestServer(async (baseUrl) => {
    const missingRes = await fetch(`${baseUrl}/api/checklists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test' })
    });
    assert.equal(missingRes.status, 403);
    const missingBody = await missingRes.json();
    assert.match(missingBody.error, /CSRF/i);

    const mismatchRes = await fetch(`${baseUrl}/api/checklists`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'qavora_csrf_token=token_a',
        'X-CSRF-Token': 'token_b'
      },
      body: JSON.stringify({ title: 'Test' })
    });
    assert.equal(mismatchRes.status, 403);
  });
});
