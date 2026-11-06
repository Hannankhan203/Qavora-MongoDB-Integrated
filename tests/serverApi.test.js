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

test('CSP: Production headers enforce nonce-based script-src with zero unsafe-inline', async () => {
  await withTestServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);

    const csp = res.headers.get('content-security-policy') || '';
    assert.ok(csp, 'Content-Security-Policy header must be present');

    // Parse CSP directives into a map
    const directives = Object.fromEntries(
      csp.split(';').map(part => {
        const trimmed = part.trim();
        const firstSpace = trimmed.indexOf(' ');
        if (firstSpace === -1) return [trimmed, ''];
        return [trimmed.slice(0, firstSpace), trimmed.slice(firstSpace + 1)];
      })
    );

    // 1. script-src verification
    assert.ok(directives['script-src'], 'script-src directive must exist');
    assert.equal(directives['script-src'].includes("'unsafe-inline'"), false, "script-src must NOT include 'unsafe-inline' in production");
    assert.equal(directives['script-src'].includes("'wasm-unsafe-eval'"), false, "script-src must NOT include 'wasm-unsafe-eval'");
    assert.ok(directives['script-src'].includes("'self'"), "script-src must include 'self'");
    assert.match(directives['script-src'], /'nonce-[A-Za-z0-9+/=]+'/, "script-src must include a cryptographically random 'nonce-...'");

    // 2. Critical security boundaries
    assert.equal(directives['object-src'], "'none'", "object-src must be 'none'");
    assert.equal(directives['base-uri'], "'self'", "base-uri must be 'self'");
    assert.equal(directives['form-action'], "'self'", "form-action must be 'self'");
    assert.equal(directives['frame-ancestors'], "'none'", "frame-ancestors must be 'none' in production");
    assert.equal(directives['default-src'], "'self'", "default-src must be 'self'");

    // 3. style-src and font-src discipline
    assert.ok(directives['style-src'].includes("'self'"), "style-src must include 'self'");
    assert.equal(directives['style-src'].includes('fonts.googleapis.com'), false, 'style-src must not permit unnecessary external font domains');
    assert.equal(directives['font-src'].includes('fonts.gstatic.com'), false, 'font-src must not permit unnecessary external font domains');

    // 4. Other security headers
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
  });
});

test('CSP: Per-response nonces are cryptographically unique and unpredictable across requests', async () => {
  await withTestServer(async (baseUrl) => {
    const res1 = await fetch(`${baseUrl}/api/health`);
    const csp1 = res1.headers.get('content-security-policy') || '';
    const match1 = csp1.match(/'nonce-([A-Za-z0-9+/=]+)'/);
    assert.ok(match1, 'Response 1 must contain a CSP nonce');
    const nonce1 = match1[1];

    const res2 = await fetch(`${baseUrl}/api/health`);
    const csp2 = res2.headers.get('content-security-policy') || '';
    const match2 = csp2.match(/'nonce-([A-Za-z0-9+/=]+)'/);
    assert.ok(match2, 'Response 2 must contain a CSP nonce');
    const nonce2 = match2[1];

    assert.notEqual(nonce1, nonce2, 'Consecutive requests must produce unique and distinct nonces');
    assert.equal(Buffer.from(nonce1, 'base64').length, 16, 'Nonce must have 128-bit (16-byte) cryptographic entropy');
    assert.equal(Buffer.from(nonce2, 'base64').length, 16, 'Nonce must have 128-bit (16-byte) cryptographic entropy');
  });
});

