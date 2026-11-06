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

test('ISSUE-01: CSRF middleware supports __Host-qavora_csrf_token in addition to qavora_csrf_token', async () => {
  const crypto = await import('node:crypto');
  const jwt = (await import('jsonwebtoken')).default;
  const jwtSecret = 'test-jwt-secret-key-for-automated-tests-2026';
  const fakeAuthToken = jwt.sign({ userId: 'u_test_123', email: 'test@example.com' }, jwtSecret);
  const sessionKey = crypto.createHash('sha256').update(fakeAuthToken).digest('hex');
  const nonce = crypto.randomBytes(24).toString('hex');
  const sig = crypto.createHmac('sha256', jwtSecret).update(`${sessionKey}.${nonce}`).digest('hex');
  const validCsrfToken = `${nonce}.${sig}`;

  await withTestServer(async (baseUrl) => {
    // 1. Valid Host-prefixed CSRF token passes CSRF check (fails at DB offline check 503, NOT 403)
    const validHostRes = await fetch(`${baseUrl}/api/checklists`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `qavora_auth_token=${fakeAuthToken}; __Host-qavora_csrf_token=${validCsrfToken}`,
        'X-CSRF-Token': validCsrfToken
      },
      body: JSON.stringify({ title: 'Test' })
    });
    assert.equal(validHostRes.status, 503, 'Should pass CSRF and reach offline database check');

    // 2. Valid standard qavora_csrf_token passes CSRF check
    const validStandardRes = await fetch(`${baseUrl}/api/checklists`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `qavora_auth_token=${fakeAuthToken}; qavora_csrf_token=${validCsrfToken}`,
        'X-CSRF-Token': validCsrfToken
      },
      body: JSON.stringify({ title: 'Test' })
    });
    assert.equal(validStandardRes.status, 503, 'Standard CSRF cookie should pass CSRF and reach offline database check');

    // 3. Mismatched Host-prefixed CSRF token is rejected with 403
    const mismatchHostRes = await fetch(`${baseUrl}/api/checklists`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `qavora_auth_token=${fakeAuthToken}; __Host-qavora_csrf_token=${validCsrfToken}`,
        'X-CSRF-Token': 'wrong_token'
      },
      body: JSON.stringify({ title: 'Test' })
    });
    assert.equal(mismatchHostRes.status, 403);

    // 4. Duplicate tokens across prefixes rejected (preventing cookie tossing)
    const duplicateRes = await fetch(`${baseUrl}/api/checklists`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `qavora_auth_token=${fakeAuthToken}; __Host-qavora_csrf_token=${validCsrfToken}; qavora_csrf_token=${validCsrfToken}`,
        'X-CSRF-Token': validCsrfToken
      },
      body: JSON.stringify({ title: 'Test' })
    });
    assert.equal(duplicateRes.status, 403);
  });
});

test('ISSUE-01: authController.getCsrfTokenFromCookie supports both qavora_csrf_token and __Host-qavora_csrf_token', async () => {
  const { default: authCtrl, getCsrfTokenFromCookie, HOST_CSRF_COOKIE_NAME, CSRF_COOKIE_NAME } = await import('../authController.js');
  assert.equal(HOST_CSRF_COOKIE_NAME, '__Host-qavora_csrf_token');
  assert.equal(CSRF_COOKIE_NAME, 'qavora_csrf_token');

  const tokenDev = getCsrfTokenFromCookie('qavora_csrf_token=token_dev_123; other=abc');
  assert.equal(tokenDev, 'token_dev_123');

  const tokenProd = getCsrfTokenFromCookie('__Host-qavora_csrf_token=token_prod_456; other=abc');
  assert.equal(tokenProd, 'token_prod_456');

  const tokenBoth = authCtrl.getCsrfTokenFromCookie('other=xyz; __Host-qavora_csrf_token=token_host_789');
  assert.equal(tokenBoth, 'token_host_789');
});

test('ISSUE-02: extractProjectCases and extractProjectSuites support actual schema and legacy fallback', async () => {
  const { extractProjectCases, extractProjectSuites } = await import('../src/modules/dataManager.js');

  // Actual schema: project.testSuites[].cases[]
  const modernProject = {
    id: 'proj_modern',
    name: 'Modern Project',
    testPlan: { phases: [{ id: 'ph_1', name: 'Phase 1' }] },
    testSuites: [
      {
        id: 'ts_1',
        name: 'Suite 1',
        phaseId: 'ph_1',
        cases: [
          { id: 'c_1', title: 'Case 1', status: 'Passed', priority: 'High' },
          { id: 'c_2', title: 'Case 2', status: 'Failed', priority: 'Low' }
        ]
      }
    ]
  };

  const modernSuites = extractProjectSuites(modernProject);
  assert.equal(modernSuites.length, 1);
  assert.equal(modernSuites[0].name, 'Suite 1');

  const modernCases = extractProjectCases(modernProject);
  assert.equal(modernCases.length, 2);
  assert.equal(modernCases[0].title, 'Case 1');
  assert.equal(modernCases[1].title, 'Case 2');

  // Legacy schema: project.phases[].suites[].testCases[]
  const legacyProject = {
    id: 'proj_legacy',
    name: 'Legacy Project',
    phases: [
      {
        id: 'ph_leg_1',
        name: 'Phase Legacy',
        suites: [
          {
            id: 'su_leg_1',
            title: 'Legacy Suite',
            testCases: [
              { id: 'tc_leg_1', title: 'Legacy Case 1', status: 'Active' }
            ]
          }
        ]
      }
    ]
  };

  const legacySuites = extractProjectSuites(legacyProject);
  assert.equal(legacySuites.length, 1);
  assert.equal(legacySuites[0].title, 'Legacy Suite');

  const legacyCases = extractProjectCases(legacyProject);
  assert.equal(legacyCases.length, 1);
  assert.equal(legacyCases[0].title, 'Legacy Case 1');
});

test('ISSUE-03: promoteChecklistToProject creates persisted project with testSuites and testPlan', async () => {
  const { promoteChecklistToProject } = await import('../qaChecklistStore.js');

  const sampleChecklist = {
    id: 'chk_promo_test_1',
    title: 'Test Checklist For Promotion',
    phases: [
      {
        id: 'phase_alpha',
        name: 'Alpha Phase',
        sections: [
          {
            id: 'cat_login',
            type: 'category',
            name: 'Authentication',
            tests: [
              { id: 't_1', title: 'User Login', priority: 'High', steps: ['Enter email', 'Enter password'] },
              { id: 't_2', title: 'Password Reset', priority: 'Medium', steps: ['Click forgot password'] }
            ]
          }
        ]
      }
    ]
  };

  let createdProjectPayload = null;
  const mockCreateProject = async (payload) => {
    createdProjectPayload = payload;
    return { ok: true, project: { ...payload, id: 'proj_persisted_123' } };
  };

  let savedProjectState = null;
  const mockOnProjectSaved = (proj) => {
    savedProjectState = proj;
  };

  const res = await promoteChecklistToProject(sampleChecklist, {
    projectName: 'Promoted QA Workspace',
    projectType: 'Web Application',
    createProject: mockCreateProject,
    onProjectSaved: mockOnProjectSaved
  });

  assert.equal(res.ok, true);
  assert.ok(createdProjectPayload, 'createProject must have been called with payload');
  assert.equal(createdProjectPayload.name, 'Promoted QA Workspace');
  assert.equal(createdProjectPayload.type, 'Web Application');
  assert.ok(Array.isArray(createdProjectPayload.testSuites));
  assert.equal(createdProjectPayload.testSuites.length, 1);
  assert.equal(createdProjectPayload.testSuites[0].name, 'Authentication');
  assert.equal(createdProjectPayload.testSuites[0].cases.length, 2);
  assert.equal(createdProjectPayload.testSuites[0].cases[0].title, 'User Login');
  assert.equal(createdProjectPayload.testSuites[0].cases[0].status, 'Not Run');
  assert.equal(savedProjectState?.id, 'proj_persisted_123');
});

test('QAV-AUD-002: updateProjectMetadata supports expectedUpdatedAt and propagates HTTP 409 conflicts', async () => {
  const { updateProjectMetadata } = await import('../src/modules/projectManager.js');
  const { setProjects, getProjects } = await import('../src/modules/state.js');

  const initialProj = {
    id: 'proj_occ_meta_1',
    name: 'Original Name',
    type: 'Web Application',
    status: 'Active',
    updatedAt: '2026-11-06T10:00:00.000Z'
  };
  setProjects([initialProj]);

  const originalFetch = globalThis.fetch;
  try {
    // 1. Test successful metadata update with expectedUpdatedAt
    let capturedBody = null;
    globalThis.fetch = async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          ...initialProj,
          name: capturedBody.name,
          updatedAt: '2026-11-06T10:05:00.000Z'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const okRes = await updateProjectMetadata(
      'proj_occ_meta_1',
      { name: 'Updated Name' },
      '2026-11-06T10:00:00.000Z'
    );
    assert.equal(okRes.ok, true);
    assert.equal(capturedBody.expectedUpdatedAt, '2026-11-06T10:00:00.000Z');
    assert.equal(getProjects()[0].name, 'Updated Name');
    assert.equal(getProjects()[0].updatedAt, '2026-11-06T10:05:00.000Z');

    // 2. Test stale metadata update returning HTTP 409 Conflict
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          error: 'Conflict: The project has been modified by another operation.',
          currentUpdatedAt: '2026-11-06T10:05:00.000Z',
          expectedUpdatedAt: '2026-11-06T10:00:00.000Z'
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const conflictRes = await updateProjectMetadata(
      'proj_occ_meta_1',
      { name: 'Stale Overwrite' },
      '2026-11-06T10:00:00.000Z'
    );
    assert.equal(conflictRes.ok, false);
    assert.equal(conflictRes.status, 409);
    assert.ok(conflictRes.error.includes('Conflict'));
    assert.equal(conflictRes.data?.currentUpdatedAt, '2026-11-06T10:05:00.000Z');
    assert.equal(conflictRes.data?.expectedUpdatedAt, '2026-11-06T10:00:00.000Z');
    assert.equal(getProjects()[0].name, 'Updated Name', 'State must not be overwritten on 409 Conflict');

    // 3. Backward compatibility: update without expectedUpdatedAt omits field
    capturedBody = null;
    globalThis.fetch = async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          ...initialProj,
          name: capturedBody.name,
          updatedAt: '2026-11-06T10:10:00.000Z'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const compatRes = await updateProjectMetadata('proj_occ_meta_1', { name: 'Compat Name' });
    assert.equal(compatRes.ok, true);
    assert.equal(capturedBody.expectedUpdatedAt, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('QAV-AUD-003: Vercel and standalone SPA HTML routes inject matching CSP nonce into script tags', async () => {
  const fs = await import('node:fs');
  const vercelConfig = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));

  // 1. Verify vercel.json rewrites SPA navigation routes to /api so Express injects the nonce
  const spaRewrite = vercelConfig.rewrites?.find((r) => r.source.includes('(?!api/'));
  assert.ok(spaRewrite, 'SPA rewrite rule must exist in vercel.json');
  assert.equal(spaRewrite.destination, '/api', 'SPA rewrite must route through /api for dynamic CSP nonce injection');
  assert.equal(
    vercelConfig.functions?.['api/index.ts']?.includeFiles,
    'dist/index.html',
    'vercel.json must bundle dist/index.html into serverless function'
  );

  // 2. Verify SPA HTML response has CSP nonce matching injected <script nonce="...">
  await withTestServer(async (baseUrl) => {
    const htmlRes = await fetch(`${baseUrl}/projects`);
    assert.equal(htmlRes.status, 200);
    const contentType = htmlRes.headers.get('content-security-policy');
    assert.ok(contentType, 'CSP header must be present on SPA HTML route');

    const nonceMatch = contentType.match(/'nonce-([A-Za-z0-9+/=]+)'/);
    assert.ok(nonceMatch, 'CSP header must include a cryptographic nonce');
    const headerNonce = nonceMatch[1];

    // Verify no unsafe-inline or unsafe-eval in script-src
    const scriptSrcPart = contentType.split(';').find((d) => d.trim().startsWith('script-src')) || '';
    assert.equal(scriptSrcPart.includes('unsafe-inline'), false, 'script-src must not contain unsafe-inline');
    assert.equal(scriptSrcPart.includes('unsafe-eval'), false, 'script-src must not contain unsafe-eval');

    const htmlBody = await htmlRes.text();
    assert.ok(
      htmlBody.includes(`<script nonce="${headerNonce}"`),
      'Served SPA HTML must inject matching nonce attribute into <script> tags'
    );
  });
});

test('QAV-AUD-001: mongoIntegration.test.js does not contain unconditional process.exit(0)', async () => {
  const fs = await import('node:fs');
  const content = fs.readFileSync('tests/mongoIntegration.test.js', 'utf8');
  assert.equal(content.includes('process.exit(0)'), false, 'mongoIntegration.test.js must not call process.exit(0)');
});



