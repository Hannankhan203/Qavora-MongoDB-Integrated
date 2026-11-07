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

// ============================================================================
// In-Memory MongoDB-Compatible Harness for QAV-FINAL-001 to QAV-FINAL-005
// ============================================================================
function matchesFilter(doc, filter = {}) {
  if (!filter || Object.keys(filter).length === 0) return true;
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or' && Array.isArray(cond)) {
      if (!cond.some((sub) => matchesFilter(doc, sub))) return false;
      continue;
    }
    if (key === '$and' && Array.isArray(cond)) {
      if (!cond.every((sub) => matchesFilter(doc, sub))) return false;
      continue;
    }
    const val = doc[key];
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond._bsontype === 'ObjectId')) {
      if ('$in' in cond && Array.isArray(cond.$in)) {
        const hit = cond.$in.some((item) => String(item) === String(val));
        if (!hit) return false;
        continue;
      }
    }
    if (cond && cond._bsontype === 'ObjectId') {
      if (!val || String(val) !== String(cond)) return false;
      continue;
    }
    if (val && val._bsontype === 'ObjectId' && cond) {
      if (String(val) !== String(cond)) return false;
      continue;
    }
    if (val !== cond) return false;
  }
  return true;
}

function createInMemoryMongoHarness(ObjectId) {
  const collections = new Map();
  let failOnCollectionInsert = null;

  function cloneWithObjectId(val) {
    if (val === null || typeof val !== 'object') return val;
    if (val._bsontype === 'ObjectId') return new ObjectId(String(val));
    if (Array.isArray(val)) return val.map(cloneWithObjectId);
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = cloneWithObjectId(v);
    }
    return out;
  }

  function getCol(name) {
    if (!collections.has(name)) {
      collections.set(name, []);
    }
    return collections.get(name);
  }

  const db = {
    collection(name) {
      return {
        find(filter = {}) {
          let results = getCol(name)
            .filter((d) => matchesFilter(d, filter))
            .map((d) => cloneWithObjectId(d));
          const cursor = {
            sort(sortSpec = {}) {
              const entries = Object.entries(sortSpec);
              if (entries.length > 0) {
                const [field, dir] = entries[0];
                results.sort((a, b) => {
                  if (a[field] < b[field]) return dir === -1 ? 1 : -1;
                  if (a[field] > b[field]) return dir === -1 ? -1 : 1;
                  return 0;
                });
              }
              return cursor;
            },
            limit(n) {
              results = results.slice(0, n);
              return cursor;
            },
            async toArray() {
              return results;
            }
          };
          return cursor;
        },
        async findOne(filter = {}) {
          const found = getCol(name).find((d) => matchesFilter(d, filter));
          return found ? cloneWithObjectId(found) : null;
        },
        async insertOne(doc) {
          if (failOnCollectionInsert === name) {
            throw new Error(`Simulated insertOne failure on ${name}`);
          }
          const copy = cloneWithObjectId(doc);
          if (!copy._id) copy._id = new ObjectId();
          getCol(name).push(copy);
          return { insertedId: copy._id };
        },
        async insertMany(docs) {
          if (failOnCollectionInsert === name) {
            throw new Error(`Simulated insertMany failure on ${name}`);
          }
          const col = getCol(name);
          for (const d of docs) {
            const copy = cloneWithObjectId(d);
            if (!copy._id) copy._id = new ObjectId();
            col.push(copy);
          }
          return { insertedCount: docs.length };
        },
        async updateOne(filter, update, options = {}) {
          const col = getCol(name);
          const idx = col.findIndex((d) => matchesFilter(d, filter));
          if (idx === -1) {
            if (options.upsert) {
              const newDoc = { ...(update.$set || {}), _id: new ObjectId() };
              col.push(cloneWithObjectId(newDoc));
              return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
            }
            return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
          }
          const target = { ...col[idx] };
          if (update.$set) Object.assign(target, cloneWithObjectId(update.$set));
          if (update.$unset) {
            for (const k of Object.keys(update.$unset)) delete target[k];
          }
          col[idx] = target;
          return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
        },
        async findOneAndUpdate(filter, update) {
          const col = getCol(name);
          const idx = col.findIndex((d) => matchesFilter(d, filter));
          if (idx === -1) return null;
          const target = { ...col[idx] };
          if (update.$set) Object.assign(target, cloneWithObjectId(update.$set));
          if (update.$unset) {
            for (const k of Object.keys(update.$unset)) delete target[k];
          }
          col[idx] = target;
          return cloneWithObjectId(target);
        },
        async deleteOne(filter) {
          const col = getCol(name);
          const idx = col.findIndex((d) => matchesFilter(d, filter));
          if (idx === -1) return { deletedCount: 0 };
          col.splice(idx, 1);
          return { deletedCount: 1 };
        },
        async deleteMany(filter = {}) {
          const col = getCol(name);
          const before = col.length;
          const remaining = col.filter((d) => !matchesFilter(d, filter));
          collections.set(name, remaining);
          return { deletedCount: before - remaining.length };
        }
      };
    },
    setFailOnInsert(colName) {
      failOnCollectionInsert = colName;
    }
  };

  return db;
}

async function createAuthHeadersForUser(userId, email = 'tester@example.com') {
  const crypto = await import('node:crypto');
  const jwt = (await import('jsonwebtoken')).default;
  const jwtSecret = 'test-jwt-secret-key-for-automated-tests-2026';
  const authToken = jwt.sign({ userId, email, name: 'QA Tester', role: 'QA Tester', tokenVersion: 1 }, jwtSecret);
  const sessionKey = crypto.createHash('sha256').update(authToken).digest('hex');
  const nonce = crypto.randomBytes(24).toString('hex');
  const sig = crypto.createHmac('sha256', jwtSecret).update(`${sessionKey}.${nonce}`).digest('hex');
  const csrfToken = `${nonce}.${sig}`;
  return {
    'Content-Type': 'application/json',
    'Cookie': `qavora_auth_token=${authToken}; qavora_csrf_token=${csrfToken}`,
    'X-CSRF-Token': csrfToken
  };
}

test('QAV-FINAL-001 & QAV-FINAL-002: Workspace export -> import -> export consistency, replace/rollback artifact sync, failure recovery, and type/projectType normalization', async () => {
  const { ObjectId } = await import('mongodb');
  const { setDatabaseForTesting } = await import('../server.ts');
  const mockDb = createInMemoryMongoHarness(ObjectId);

  const userA = 'usr_final_a';
  const userB = 'usr_final_b';
  await mockDb.collection('users').insertOne({ userId: userA, email: 'a@example.com', status: 'active', tokenVersion: 1 });
  await mockDb.collection('users').insertOne({ userId: userB, email: 'b@example.com', status: 'active', tokenVersion: 1 });

  const headersA = await createAuthHeadersForUser(userA, 'a@example.com');
  const headersB = await createAuthHeadersForUser(userB, 'b@example.com');

  setDatabaseForTesting(mockDb, null);
  try {
    await withTestServer(async (baseUrl) => {
      // 1. User A creates a project and saves suites, executions, and defects into project_artifacts via PATCH /api/projects/:id/data
      const createRes = await fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({
          id: 'proj_alpha',
          name: 'Alpha Mobile Suite',
          type: 'Mobile Application',
          version: 'v2.1',
          description: 'Original mobile QA workspace'
        })
      });
      assert.equal(createRes.status, 201);

      const patchDataRes = await fetch(`${baseUrl}/api/projects/proj_alpha/data`, {
        method: 'PATCH',
        headers: headersA,
        body: JSON.stringify({
          testSuites: [
            {
              id: 'su_alpha_1',
              title: 'Checkout Suite',
              name: 'Checkout Suite',
              cases: [{ id: 'tc_alpha_1', title: 'Apple Pay Checkout', status: 'Passed', priority: 'High' }]
            }
          ],
          executions: [{ id: 'ex_alpha_1', caseId: 'tc_alpha_1', status: 'Passed' }],
          defects: [{ id: 'def_alpha_1', title: 'Receipt alignment bug', severity: 'Low', status: 'Open' }]
        })
      });
      assert.equal(patchDataRes.status, 200);

      // Verify testSuites, executions, defects were moved out of projects document and into project_artifacts
      const rawProjInDb = await mockDb.collection('projects').findOne({ id: 'proj_alpha', userId: userA });
      assert.equal(rawProjInDb.testSuites, undefined, 'Raw project doc must have testSuites unset after artifact split');
      const rawArtsBefore = await mockDb.collection('project_artifacts').find({ projectId: 'proj_alpha', userId: userA }).toArray();
      assert.equal(rawArtsBefore.length, 3, 'project_artifacts must contain 3 documents (testSuites, executions, defects)');

      // User B also has a project and artifacts that must remain isolated
      await fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers: headersB,
        body: JSON.stringify({ id: 'proj_beta_b', name: 'User B Project', type: 'API / Microservice' })
      });
      await fetch(`${baseUrl}/api/projects/proj_beta_b/data`, {
        method: 'PATCH',
        headers: headersB,
        body: JSON.stringify({
          testSuites: [{ id: 'su_b', title: 'B Suite', cases: [{ id: 'tc_b', title: 'B Case' }] }]
        })
      });

      // 2. Export User A workspace via GET /api/projects
      const export1Res = await fetch(`${baseUrl}/api/projects`, { headers: headersA });
      assert.equal(export1Res.status, 200);
      const exportedProjects1 = await export1Res.json();
      assert.equal(exportedProjects1.length, 1);
      assert.equal(exportedProjects1[0].type, 'Mobile Application');
      assert.equal(exportedProjects1[0].testSuites.length, 1);
      assert.equal(exportedProjects1[0].executions.length, 1);
      assert.equal(exportedProjects1[0].defects.length, 1);

      // 3. Replace User A workspace with a new workspace that reuses id 'proj_alpha' (with empty suites/defects)
      //    plus a second project using legacy 'projectType' property (QAV-FINAL-002)
      const replaceRes = await fetch(`${baseUrl}/api/data/import`, {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({
          mode: 'replace',
          projects: [
            {
              id: 'proj_alpha',
              name: 'Alpha Replaced Clean',
              type: 'Desktop Software',
              testSuites: [
                {
                  id: 'su_new_1',
                  title: 'Fresh Suite Only',
                  cases: [{ id: 'tc_new_1', title: 'Fresh Case 1', status: 'Active' }]
                }
              ],
              executions: [],
              defects: []
            },
            {
              id: 'proj_legacy_type',
              name: 'Legacy Type Project',
              projectType: 'API / Microservice',
              testSuites: []
            }
          ],
          checklists: []
        })
      });
      assert.equal(replaceRes.status, 200);

      // Verify QAV-FINAL-001: Recovery snapshot captured the FULLY HYDRATED pre-replace project (including artifacts)
      const snapshots = await mockDb.collection('recovery_snapshots').find({ userId: userA }).toArray();
      assert.equal(snapshots.length, 1);
      assert.equal(snapshots[0].projects.length, 1);
      assert.equal(snapshots[0].projects[0].id, 'proj_alpha');
      assert.equal(snapshots[0].projects[0].type, 'Mobile Application');
      assert.equal(snapshots[0].projects[0].testSuites.length, 1, 'Recovery snapshot must include hydrated testSuites');
      assert.equal(snapshots[0].projects[0].executions.length, 1, 'Recovery snapshot must include hydrated executions');
      assert.equal(snapshots[0].projects[0].defects.length, 1, 'Recovery snapshot must include hydrated defects');

      // Verify QAV-FINAL-001 & QAV-FINAL-002: Stale artifacts from pre-replace 'proj_alpha' do NOT overwrite replaced 'proj_alpha'
      // and both 'type' and legacy 'projectType' are normalized to canonical 'type'
      const afterReplaceGet = await fetch(`${baseUrl}/api/projects`, { headers: headersA });
      assert.equal(afterReplaceGet.status, 200);
      const replacedList = await afterReplaceGet.json();
      assert.equal(replacedList.length, 2);

      const alphaAfterReplace = replacedList.find((p) => p.id === 'proj_alpha');
      assert.equal(alphaAfterReplace.name, 'Alpha Replaced Clean');
      assert.equal(alphaAfterReplace.type, 'Desktop Software');
      assert.equal(alphaAfterReplace.testSuites.length, 1);
      assert.equal(alphaAfterReplace.testSuites[0].id, 'su_new_1');
      assert.equal(alphaAfterReplace.executions.length, 0, 'Stale executions artifact must not overwrite replaced project');
      assert.equal(alphaAfterReplace.defects.length, 0, 'Stale defects artifact must not overwrite replaced project');

      const legacyTypeProj = replacedList.find((p) => p.id === 'proj_legacy_type');
      assert.equal(legacyTypeProj.type, 'API / Microservice', 'Legacy projectType must normalize to canonical type field');

      // Verify User B artifacts and projects were completely untouched
      const userBGet = await fetch(`${baseUrl}/api/projects`, { headers: headersB });
      const userBList = await userBGet.json();
      assert.equal(userBList.length, 1);
      assert.equal(userBList[0].testSuites.length, 1);

      // 4. Test failure safety during replace import: if checklist insertion fails midway, pre-replace state & artifacts are rescued
      mockDb.setFailOnInsert('checklists');
      const failedReplaceRes = await fetch(`${baseUrl}/api/data/import`, {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({
          mode: 'replace',
          projects: [{ id: 'proj_broken', name: 'Should Rollback', type: 'Web Application' }],
          checklists: [{ id: 'chk_broken', title: 'Triggers Failure' }]
        })
      });
      assert.equal(failedReplaceRes.status, 500);
      mockDb.setFailOnInsert(null);

      // Verify pre-failed-replace projects and artifacts were restored and aborted snapshot was cleaned up
      const rescuedGet = await fetch(`${baseUrl}/api/projects`, { headers: headersA });
      const rescuedList = await rescuedGet.json();
      assert.equal(rescuedList.length, 2, 'Failed replace must restore pre-replace workspace projects');

      // 5. Execute POST /api/data/rollback and verify original hydrated project and its artifacts are restored
      const rollbackRes = await fetch(`${baseUrl}/api/data/rollback`, {
        method: 'POST',
        headers: headersA
      });
      assert.equal(rollbackRes.status, 200);

      const exportAfterRollbackRes = await fetch(`${baseUrl}/api/projects`, { headers: headersA });
      assert.equal(exportAfterRollbackRes.status, 200);
      const restoredProjects = await exportAfterRollbackRes.json();
      assert.equal(restoredProjects.length, 1);
      assert.equal(restoredProjects[0].id, 'proj_alpha');
      assert.equal(restoredProjects[0].name, 'Alpha Mobile Suite');
      assert.equal(restoredProjects[0].type, 'Mobile Application');
      assert.equal(restoredProjects[0].testSuites.length, 1);
      assert.equal(restoredProjects[0].testSuites[0].id, 'su_alpha_1');
      assert.equal(restoredProjects[0].executions.length, 1);
      assert.equal(restoredProjects[0].defects.length, 1);

      // 6. Test Export -> Import (replace) -> Export round-trip data consistency
      const reImportRes = await fetch(`${baseUrl}/api/data/import`, {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({
          mode: 'replace',
          projects: restoredProjects,
          checklists: []
        })
      });
      assert.equal(reImportRes.status, 200);

      const export2Res = await fetch(`${baseUrl}/api/projects`, { headers: headersA });
      const exportedProjects2 = await export2Res.json();
      assert.equal(exportedProjects2.length, 1);
      assert.equal(exportedProjects2[0].id, exportedProjects1[0].id);
      assert.equal(exportedProjects2[0].name, exportedProjects1[0].name);
      assert.equal(exportedProjects2[0].type, exportedProjects1[0].type);
      assert.equal(exportedProjects2[0].version, exportedProjects1[0].version);
      assert.equal(exportedProjects2[0].testSuites.length, exportedProjects1[0].testSuites.length);
      assert.equal(exportedProjects2[0].testSuites[0].cases.length, exportedProjects1[0].testSuites[0].cases.length);
      assert.equal(exportedProjects2[0].executions.length, exportedProjects1[0].executions.length);
      assert.equal(exportedProjects2[0].defects.length, exportedProjects1[0].defects.length);
    });
  } finally {
    setDatabaseForTesting(null, null);
  }
});

test('QAV-FINAL-003: Prohibited-key and strict top-level allowlist validation on PATCH /api/projects/:id/data, POST /api/projects, PUT /api/projects/:id, and PATCH /api/projects/:id', async () => {
  const { ObjectId } = await import('mongodb');
  const { setDatabaseForTesting } = await import('../server.ts');
  const mockDb = createInMemoryMongoHarness(ObjectId);

  const userId = 'usr_sec_003';
  await mockDb.collection('users').insertOne({ userId, email: 'sec003@example.com', status: 'active', tokenVersion: 1 });
  const headers = await createAuthHeadersForUser(userId, 'sec003@example.com');

  setDatabaseForTesting(mockDb, null);
  try {
    await withTestServer(async (baseUrl) => {
      // 1. Create baseline legitimate project
      const createRes = await fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: 'proj_sec_1',
          name: 'Security Baseline Project',
          type: 'Web Application',
          description: 'Cost is $50.00. Verify constructor.prototype text in strings.'
        })
      });
      assert.equal(createRes.status, 201);
      const baseline = await createRes.json();
      const v1UpdatedAt = baseline.updatedAt;

      // 2. Malicious payloads against PATCH /api/projects/:id/data must all be rejected with HTTP 400
      const maliciousDataPayloads = [
        JSON.stringify({ '$set': { name: 'Hacked' } }),
        JSON.stringify({ '$rename': { name: 'hackedName' } }),
        JSON.stringify({ '$where': 'sleep(1000)' }),
        JSON.stringify({ 'testPlan.phases.0.name': 'Dotted Injection' }),
        JSON.stringify({ testSuites: [{ id: 's1', '$set': { title: 'Bad' } }] }),
        JSON.stringify({ executions: [{ 'nested.dotted': true }] }),
        '{"name": "ProtoAttack", "__proto__": {"polluted": true}}',
        '{"name": "ConstructorAttack", "constructor": {"prototype": {"polluted": true}}}',
        '{"name": "PrototypeAttack", "prototype": {"polluted": true}}',
        '{"testSuites": [{"cases": [{"__proto__": {"admin": true}}]}]}',
        JSON.stringify({ userId: 'attacker_user_id', name: 'Hijack' }),
        JSON.stringify({ _id: '65f000000000000000000001', name: 'Hijack' }),
        JSON.stringify({ id: 'new_id_override', name: 'Hijack' }),
        JSON.stringify({ unapprovedTopLevelField: 'malicious' }),
        JSON.stringify({})
      ];

      for (const rawPayload of maliciousDataPayloads) {
        const res = await fetch(`${baseUrl}/api/projects/proj_sec_1/data`, {
          method: 'PATCH',
          headers,
          body: rawPayload
        });
        assert.equal(res.status, 400, `PATCH /api/projects/:id/data must reject malicious payload: ${rawPayload}`);
      }

      // 3. Malicious payloads against POST /api/projects and PUT /api/projects/:id must also be rejected with HTTP 400
      for (const badCreate of [
        '{"name": "Bad", "$where": "1==1"}',
        '{"name": "Bad", "nested.key": "val"}',
        '{"name": "Bad", "__proto__": {"admin": true}}',
        '{"name": "Bad", "userId": "other_user"}',
        '{"name": "Bad", "unknownMaliciousField": 123}'
      ]) {
        const postRes = await fetch(`${baseUrl}/api/projects`, {
          method: 'POST',
          headers,
          body: badCreate
        });
        assert.equal(postRes.status, 400, `POST /api/projects must reject: ${badCreate}`);
      }

      for (const badPut of [
        '{"name": "Bad", "$set": {"status": "Archived"}}',
        '{"name": "Bad", "a.b": 1}',
        '{"name": "Bad", "__proto__": {"x": 1}}',
        '{"name": "Bad", "unknownField": true}'
      ]) {
        const putRes = await fetch(`${baseUrl}/api/projects/proj_sec_1`, {
          method: 'PUT',
          headers,
          body: badPut
        });
        assert.equal(putRes.status, 400, `PUT /api/projects/:id must reject: ${badPut}`);
      }

      // 4. Legitimate payload with special characters in string values and OCC expectedUpdatedAt succeeds
      const legitRes = await fetch(`${baseUrl}/api/projects/proj_sec_1/data`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          name: 'Valid Project $100.00 (v1.2)',
          expectedUpdatedAt: v1UpdatedAt,
          testSuites: [
            {
              id: 'su_legit_1',
              title: 'Pricing $99.99 & constructor.prototype text check',
              cases: [{ id: 'tc_1', title: 'Verify $0.00 discount', status: 'Passed' }]
            }
          ],
          activeRun: { id: 'run_1', name: 'Smoke Cycle 1.0' },
          executionRuns: [{ id: 'run_0', name: 'Prior Cycle' }],
          defects: [{ id: 'def_1', title: 'Error message displays $NaN.00', status: 'Open' }]
        })
      });
      assert.equal(legitRes.status, 200);
      const updated = await legitRes.json();
      assert.equal(updated.name, 'Valid Project $100.00 (v1.2)');
      assert.equal(updated.testSuites.length, 1);
      assert.equal(updated.defects.length, 1);
    });
  } finally {
    setDatabaseForTesting(null, null);
  }
});

test('QAV-FINAL-004 & QAV-FINAL-005: Project deletion cleans up artifacts by both custom id and MongoDB _id, and PUT/PATCH/status return hydrated projects', async () => {
  const { ObjectId } = await import('mongodb');
  const { setDatabaseForTesting } = await import('../server.ts');
  const mockDb = createInMemoryMongoHarness(ObjectId);

  const userId = 'usr_final_004_005';
  await mockDb.collection('users').insertOne({ userId, email: 'u45@example.com', status: 'active', tokenVersion: 1 });
  const headers = await createAuthHeadersForUser(userId, 'u45@example.com');

  setDatabaseForTesting(mockDb, null);
  try {
    await withTestServer(async (baseUrl) => {
      // Create two projects and populate artifacts for both
      const p1Res = await fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: 'proj_del_custom', name: 'Delete By Custom ID', type: 'Web Application' })
      });
      assert.equal(p1Res.status, 201);
      const p1 = await p1Res.json();

      const p2Res = await fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: 'proj_del_oid', name: 'Delete By ObjectId', type: 'Mobile Application' })
      });
      assert.equal(p2Res.status, 201);
      const p2 = await p2Res.json();
      const p2ObjectId = String(p2._id);
      assert.equal(p2ObjectId.length, 24);

      // Populate artifacts on both projects via PATCH /api/projects/:id/data
      await fetch(`${baseUrl}/api/projects/${p1.id}/data`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          testSuites: [{ id: 'su_p1', title: 'P1 Suite', cases: [{ id: 'c_p1', title: 'Case P1' }] }],
          executions: [{ id: 'ex_p1', status: 'Passed' }],
          defects: [{ id: 'def_p1', title: 'Defect P1' }]
        })
      });

      await fetch(`${baseUrl}/api/projects/${p2.id}/data`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          testSuites: [{ id: 'su_p2', title: 'P2 Suite', cases: [{ id: 'c_p2', title: 'Case P2' }] }],
          executions: [{ id: 'ex_p2', status: 'Failed' }],
          defects: [{ id: 'def_p2', title: 'Defect P2' }]
        })
      });

      // Verify QAV-FINAL-005: PUT /api/projects/:id returns hydrated project with testSuites, executions, defects
      const putRes = await fetch(`${baseUrl}/api/projects/${p1.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ name: 'P1 Updated Via PUT', version: 'v1.1' })
      });
      assert.equal(putRes.status, 200);
      const putBody = await putRes.json();
      assert.equal(putBody.name, 'P1 Updated Via PUT');
      assert.equal(Array.isArray(putBody.testSuites), true, 'PUT response must include hydrated testSuites');
      assert.equal(putBody.testSuites.length, 1);
      assert.equal(Array.isArray(putBody.executions), true, 'PUT response must include hydrated executions');
      assert.equal(putBody.executions.length, 1);
      assert.equal(Array.isArray(putBody.defects), true, 'PUT response must include hydrated defects');
      assert.equal(putBody.defects.length, 1);

      // Verify QAV-FINAL-005: PATCH /api/projects/:id returns hydrated project with testSuites, executions, defects
      const patchRes = await fetch(`${baseUrl}/api/projects/${p1.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          description: 'Updated via PATCH metadata',
          expectedUpdatedAt: putBody.updatedAt
        })
      });
      assert.equal(patchRes.status, 200);
      const patchBody = await patchRes.json();
      assert.equal(patchBody.description, 'Updated via PATCH metadata');
      assert.equal(patchBody.testSuites?.length, 1, 'PATCH response must include hydrated testSuites');
      assert.equal(patchBody.executions?.length, 1, 'PATCH response must include hydrated executions');
      assert.equal(patchBody.defects?.length, 1, 'PATCH response must include hydrated defects');

      // Verify QAV-FINAL-005: PATCH /api/projects/:id/status returns hydrated project with testSuites, executions, defects
      const statusRes = await fetch(`${baseUrl}/api/projects/${p1.id}/status`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'Completed' })
      });
      assert.equal(statusRes.status, 200);
      const statusBody = await statusRes.json();
      assert.equal(statusBody.status, 'Completed');
      assert.equal(statusBody.testSuites?.length, 1, 'PATCH /status response must include hydrated testSuites');
      assert.equal(statusBody.executions?.length, 1, 'PATCH /status response must include hydrated executions');
      assert.equal(statusBody.defects?.length, 1, 'PATCH /status response must include hydrated defects');

      // Verify QAV-FINAL-004: Delete p1 by custom id ('proj_del_custom') removes all p1 artifacts
      const del1Res = await fetch(`${baseUrl}/api/projects/${p1.id}`, {
        method: 'DELETE',
        headers
      });
      assert.equal(del1Res.status, 200);
      const p1ArtsAfter = await mockDb.collection('project_artifacts').find({ projectId: p1.id, userId }).toArray();
      assert.equal(p1ArtsAfter.length, 0, 'Deleting by custom id must remove all project_artifacts');

      // Verify QAV-FINAL-004: Delete p2 by MongoDB _id (p2ObjectId) removes p2 and all p2 artifacts (even though keyed by p2.id)
      const p2ArtsBefore = await mockDb.collection('project_artifacts').find({ projectId: p2.id, userId }).toArray();
      assert.equal(p2ArtsBefore.length, 3, 'p2 must have 3 artifact docs before deletion by _id');

      const del2Res = await fetch(`${baseUrl}/api/projects/${p2ObjectId}`, {
        method: 'DELETE',
        headers
      });
      assert.equal(del2Res.status, 200);
      const p2ArtsAfter = await mockDb.collection('project_artifacts').find({ projectId: p2.id, userId }).toArray();
      assert.equal(p2ArtsAfter.length, 0, 'Deleting by MongoDB _id must resolve project.id and remove all project_artifacts');
    });
  } finally {
    setDatabaseForTesting(null, null);
  }
});




