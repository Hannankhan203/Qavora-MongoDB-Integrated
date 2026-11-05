/**
 * TST-001 Verification Suite: Integration tests executing against the actual server.ts implementation
 * 
 * Tests the real Express server from server.ts against real HTTP requests, actual middleware,
 * authentication, tenant isolation, and error handling with an isolated in-memory MongoDB environment.
 */

import http from 'http';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';

let passedCount = 0;
let failedCount = 0;
let testCount = 0;

function assert(condition: boolean, message: string, detail?: string) {
  testCount++;
  if (condition) {
    passedCount++;
    console.log(`  ✓ [PASS] #${testCount}: ${message}`);
  } else {
    failedCount++;
    console.error(`  ✗ [FAIL] #${testCount}: ${message} ${detail ? `(${detail})` : ''}`);
  }
}

async function runTst001Suite() {
  console.log('========================================================================');
  console.log('TST-001: INTEGRATION TESTS FOR ACTUAL SERVER.TS IMPLEMENTATION');
  console.log('========================================================================\n');

  // 1. Setup isolated in-memory test database (Never touch production MongoDB)
  console.log('[Setup] Launching isolated in-memory MongoDB instance for TST-001...');
  const mongod = await MongoMemoryServer.create();
  const mongoUri = mongod.getUri();
  const dbName = 'qavora_tst001_verify';
  const jwtSecret = 'tst001_super_secure_jwt_secret_key_32chars_min!';

  const mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  const db = mongoClient.db(dbName);
  console.log(`[Setup] Connected to isolated test MongoDB at ${mongoUri}`);

  // 2. Configure environment for serverless/test mounting of actual server.ts
  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'production';
  process.env.MONGODB_URI = mongoUri;
  process.env.MONGODB_DB = dbName;
  process.env.JWT_SECRET = jwtSecret;

  // Import actual server.ts implementation directly (NO mock or duplicate Express app)
  console.log('[Setup] Importing actual server.ts application...');
  const serverModule = await import('../server.ts');
  const actualApp = serverModule.default;
  const connectToDatabase = serverModule.connectToDatabase;
  const closeDatabase = serverModule.closeDatabase;

  assert(typeof actualApp === 'function', 'Actual server.ts exports Express application');
  assert(typeof connectToDatabase === 'function', 'server.ts exports connectToDatabase');
  assert(typeof closeDatabase === 'function', 'server.ts exports closeDatabase');

  // Connect actual server to test database
  await connectToDatabase();

  // 3. Mount actual server.ts on an ephemeral local HTTP port
  const server = http.createServer(actualApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[Setup] Actual server.ts HTTP server listening on ${baseUrl}\n`);

  let ipCounter = 100;
  async function api(path: string, options: any = {}) {
    const { headers: customHeaders, ip, ...restOptions } = options;
    const clientIp = ip || `198.51.100.${ipCounter++}`;
    const res = await fetch(`${baseUrl}${path}`, {
      ...restOptions,
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': clientIp,
        ...(customHeaders || {})
      }
    });
    let data: any = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await res.json();
      } catch {}
    } else {
      try {
        data = await res.text();
      } catch {}
    }
    return { status: res.status, data, headers: res.headers };
  }

  // ==========================================================================
  // SECTION 1: Health Check Endpoint (/api/health)
  // ==========================================================================
  console.log('--- Section 1: /api/health ---');
  const healthRes = await api('/api/health');
  assert(healthRes.status === 200, 'GET /api/health returns HTTP 200');
  assert(healthRes.data?.success === true, 'GET /api/health returns success: true');
  assert(healthRes.data?.database === 'connected', 'GET /api/health reports database: "connected"');

  // Verify production security headers applied by actual server.ts middleware
  assert(healthRes.headers.get('x-content-type-options') === 'nosniff', 'Actual server sets X-Content-Type-Options: nosniff');
  assert(healthRes.headers.get('x-frame-options') === 'DENY', 'Actual server sets X-Frame-Options: DENY in production');

  // ==========================================================================
  // SECTION 2: User Registration Endpoint (/api/auth/register)
  // ==========================================================================
  console.log('\n--- Section 2: /api/auth/register ---');

  // 1. Missing name validation
  const badNameRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: '', email: 'valid@example.com', password: 'Password123!' })
  });
  assert(badNameRes.status === 400, 'POST /api/auth/register without name returns HTTP 400 Bad Request');
  assert(badNameRes.data?.error?.includes('name is required'), 'Error mentions name is required');

  // 2. Malformed email validation
  const badEmailRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Valid User', email: 'not-an-email', password: 'Password123!' })
  });
  assert(badEmailRes.status === 400, 'POST /api/auth/register with invalid email returns HTTP 400 Bad Request');

  // 3. Short password validation (< 8 chars)
  const shortPassRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Valid User', email: 'user@example.com', password: '123' })
  });
  assert(shortPassRes.status === 400, 'POST /api/auth/register with short password returns HTTP 400 Bad Request');

  // 4. Valid registration for User A
  const regUserARes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Auditor Alice',
      email: 'alice.auditor@qavora.com',
      password: 'AuditPassword123!',
      role: 'Lead QA Engineer'
    })
  });
  assert(regUserARes.status === 201, 'POST /api/auth/register for User A returns HTTP 201 Created');
  assert(Boolean(regUserARes.data?.token), 'Registration returns signed JWT token');
  assert(regUserARes.data?.user?.email === 'alice.auditor@qavora.com', 'Registration returns safe user profile');
  assert(regUserARes.data?.user?.role === 'Lead QA Engineer', 'Registration preserves user role');
  assert(!('passwordHash' in (regUserARes.data?.user || {})), 'Response strictly excludes passwordHash');

  const tokenA = regUserARes.data?.token;
  const userAId = regUserARes.data?.user?.userId;

  // 5. Duplicate email registration conflict (409)
  const dupEmailRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Alice Duplicate',
      email: 'alice.auditor@qavora.com',
      password: 'AuditPassword123!'
    })
  });
  assert(dupEmailRes.status === 409, 'Duplicate email registration returns HTTP 409 Conflict');
  assert(dupEmailRes.data?.error?.includes('already exists'), 'Duplicate error specifies account already exists');

  // 6. Valid registration for User B (for user isolation testing)
  const regUserBRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Auditor Bob',
      email: 'bob.auditor@qavora.com',
      password: 'BobAuditPassword123!',
      role: 'QA Specialist'
    })
  });
  assert(regUserBRes.status === 201, 'POST /api/auth/register for User B returns HTTP 201 Created');
  const tokenB = regUserBRes.data?.token;
  const userBId = regUserBRes.data?.user?.userId;
  assert(userAId !== userBId, 'User A and User B receive distinct userIds');

  // ==========================================================================
  // SECTION 3: User Login Endpoint (/api/auth/login)
  // ==========================================================================
  console.log('\n--- Section 3: /api/auth/login ---');

  // 1. Missing credentials
  const emptyLoginRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({})
  });
  assert(emptyLoginRes.status === 400, 'POST /api/auth/login with missing fields returns HTTP 400');

  // 2. Non-existent email
  const notFoundLoginRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'ghost@qavora.com', password: 'Password123!' })
  });
  assert(notFoundLoginRes.status === 401, 'POST /api/auth/login with non-existent user returns HTTP 401');

  // 3. Incorrect password
  const wrongPassLoginRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'alice.auditor@qavora.com', password: 'WrongPassword999!' })
  });
  assert(wrongPassLoginRes.status === 401, 'POST /api/auth/login with wrong password returns HTTP 401');

  // 4. Successful login
  const successLoginRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'alice.auditor@qavora.com', password: 'AuditPassword123!' })
  });
  assert(successLoginRes.status === 200, 'POST /api/auth/login with valid credentials returns HTTP 200 OK');
  assert(Boolean(successLoginRes.data?.token), 'Login returns fresh JWT token');
  assert(successLoginRes.data?.user?.userId === userAId, 'Login returns correct user profile');

  // ==========================================================================
  // SECTION 4: Protected Session Endpoint (/api/auth/me)
  // ==========================================================================
  console.log('\n--- Section 4: /api/auth/me ---');

  // 1. Unauthenticated request
  const unauthMeRes = await api('/api/auth/me');
  assert(unauthMeRes.status === 401, 'GET /api/auth/me without token returns HTTP 401 Unauthorized');

  // 2. Malformed token
  const badTokenMeRes = await api('/api/auth/me', {
    headers: { Authorization: 'Bearer this.is.invalid.jwt' }
  });
  assert(badTokenMeRes.status === 401, 'GET /api/auth/me with invalid JWT returns HTTP 401');

  // 3. Expired token
  const expiredToken = jwt.sign(
    { userId: userAId, email: 'alice.auditor@qavora.com' },
    jwtSecret,
    { expiresIn: -10 }
  );
  const expiredMeRes = await api('/api/auth/me', {
    headers: { Authorization: `Bearer ${expiredToken}` }
  });
  assert(expiredMeRes.status === 401, 'GET /api/auth/me with expired token returns HTTP 401');
  assert(expiredMeRes.data?.error?.includes('expired'), 'Error message reports expired session');

  // 4. Valid token
  const validMeRes = await api('/api/auth/me', {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert(validMeRes.status === 200, 'GET /api/auth/me with valid token returns HTTP 200 OK');
  assert(validMeRes.data?.user?.userId === userAId, 'GET /api/auth/me resolves authenticated user');

  // ==========================================================================
  // SECTION 5: Projects Endpoint (/api/projects) & Tenant Isolation
  // ==========================================================================
  console.log('\n--- Section 5: /api/projects ---');

  // 1. Unauthenticated project access rejected
  const unauthProjRes = await api('/api/projects');
  assert(unauthProjRes.status === 401, 'GET /api/projects without token returns HTTP 401');

  // 2. User A creates a project (testing identity stamping & ignoring spoofed userId)
  const projARes = await api('/api/projects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      name: 'Alice Quality Core Platform',
      type: 'Web Application',
      version: '1.0.0',
      description: 'Core web portal under QA review',
      userId: 'spoofed_user_id_from_hacker'
    })
  });
  assert(projARes.status === 201, 'POST /api/projects for User A returns HTTP 201 Created');
  const projAId = projARes.data?.id;
  assert(Boolean(projAId), 'Project assigned an id');
  assert(projARes.data?.userId === userAId, 'Server strictly enforced authenticated User A identity (ignored spoofed userId)');

  // 3. User B creates a project
  const projBRes = await api('/api/projects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({
      name: 'Bob Mobile Banking Suite',
      type: 'Mobile App',
      version: '2.5.0',
      description: 'Mobile banking app tests'
    })
  });
  assert(projBRes.status === 201, 'POST /api/projects for User B returns HTTP 201 Created');
  const projBId = projBRes.data?.id;

  // 4. Verify User A list isolation
  const listARes = await api('/api/projects', {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert(listARes.status === 200, 'GET /api/projects for User A returns HTTP 200');
  assert(Array.isArray(listARes.data), 'GET /api/projects returns an array');
  assert(listARes.data.some((p: any) => p.id === projAId), 'User A list includes User A project');
  assert(!listARes.data.some((p: any) => p.id === projBId), 'User A list DOES NOT include User B project (Tenant Isolation)');

  // 5. Verify User B list isolation
  const listBRes = await api('/api/projects', {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert(listBRes.data.some((p: any) => p.id === projBId), 'User B list includes User B project');
  assert(!listBRes.data.some((p: any) => p.id === projAId), 'User B list DOES NOT include User A project (Tenant Isolation)');

  // 6. Cross-tenant read protection (User A attempting to GET User B's project)
  const crossGetProjRes = await api(`/api/projects/${projBId}`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert(crossGetProjRes.status === 404, 'Cross-tenant GET /api/projects/:id returns HTTP 404 Not Found (no ownership disclosure)');

  // 7. Cross-tenant update protection (User A attempting to PUT User B's project)
  const crossPutProjRes = await api(`/api/projects/${projBId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ name: 'Hacked Project Name' })
  });
  assert(crossPutProjRes.status === 404, 'Cross-tenant PUT /api/projects/:id returns HTTP 404 Not Found');

  // 8. Cross-tenant delete protection (User A attempting to DELETE User B's project)
  const crossDelProjRes = await api(`/api/projects/${projBId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert(crossDelProjRes.status === 404, 'Cross-tenant DELETE /api/projects/:id returns HTTP 404 Not Found');

  // 9. Legitimate update by owner (User A updates own project)
  const ownPutProjRes = await api(`/api/projects/${projAId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ name: 'Alice Quality Core Platform (Updated)' })
  });
  assert(ownPutProjRes.status === 200, 'Owner PUT /api/projects/:id returns HTTP 200 OK');
  assert(ownPutProjRes.data?.name === 'Alice Quality Core Platform (Updated)', 'Project name updated in database');

  // 10. Legitimate delete by owner (User A deletes own project)
  const ownDelProjRes = await api(`/api/projects/${projAId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert(ownDelProjRes.status === 200, 'Owner DELETE /api/projects/:id returns HTTP 200 OK');

  // ==========================================================================
  // SECTION 6: Checklists Endpoint (/api/checklists) & Tenant Isolation
  // ==========================================================================
  console.log('\n--- Section 6: /api/checklists ---');

  // 1. Unauthenticated checklist access rejected
  const unauthChkRes = await api('/api/checklists');
  assert(unauthChkRes.status === 401, 'GET /api/checklists without token returns HTTP 401 Unauthorized');

  // 2. User A creates a checklist
  const chkARes = await api('/api/checklists', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      title: 'Regression Checklist Sprint 12',
      schemaVersion: 1,
      documentNotes: ['Initial smoke test note'],
      phases: [
        {
          id: 'phase_smoke',
          title: 'Smoke Test Phase',
          items: [
            { id: 'item_1', title: 'Verify login page loads', status: 'Passed' }
          ]
        }
      ],
      userId: 'spoofed_user_id_attack'
    })
  });
  assert(chkARes.status === 201, 'POST /api/checklists for User A returns HTTP 201 Created');
  const chkAId = chkARes.data?.id;
  assert(Boolean(chkAId), 'Checklist assigned an id');
  assert(chkARes.data?.userId === userAId, 'Server enforced authenticated User A userId on checklist');

  // 3. User B creates a checklist
  const chkBRes = await api('/api/checklists', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({
      title: 'Mobile Security Audit Checklist',
      schemaVersion: 1,
      documentNotes: ['Confidential security review'],
      phases: []
    })
  });
  assert(chkBRes.status === 201, 'POST /api/checklists for User B returns HTTP 201 Created');
  const chkBId = chkBRes.data?.id;

  // 4. Verify User A checklist list isolation
  const chkListARes = await api('/api/checklists', {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert(chkListARes.status === 200, 'GET /api/checklists for User A returns HTTP 200 OK');
  assert(Array.isArray(chkListARes.data), 'GET /api/checklists returns array');
  assert(chkListARes.data.some((c: any) => c.id === chkAId), 'User A checklist list includes User A checklist');
  assert(!chkListARes.data.some((c: any) => c.id === chkBId), 'User A checklist list DOES NOT include User B checklist');

  // 5. Cross-tenant GET checklist protection
  const crossGetChkRes = await api(`/api/checklists/${chkBId}`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert(crossGetChkRes.status === 404, 'Cross-tenant GET /api/checklists/:id returns HTTP 404 Not Found');

  // 6. Cross-tenant PATCH checklist protection
  const crossPatchChkRes = await api(`/api/checklists/${chkBId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ title: 'Hacked Checklist Title' })
  });
  assert(crossPatchChkRes.status === 404, 'Cross-tenant PATCH /api/checklists/:id returns HTTP 404 Not Found');

  // 7. Cross-tenant DELETE checklist protection
  const crossDelChkRes = await api(`/api/checklists/${chkBId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert(crossDelChkRes.status === 404, 'Cross-tenant DELETE /api/checklists/:id returns HTTP 404 Not Found');

  // 8. Legitimate owner GET checklist
  const ownGetChkRes = await api(`/api/checklists/${chkAId}`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert(ownGetChkRes.status === 200, 'Owner GET /api/checklists/:id returns HTTP 200 OK');
  assert(ownGetChkRes.data?.title === 'Regression Checklist Sprint 12', 'Owner receives accurate checklist document');

  // 9. Legitimate owner PATCH checklist
  const ownPatchChkRes = await api(`/api/checklists/${chkAId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ title: 'Regression Checklist Sprint 12 (Updated)' })
  });
  assert(ownPatchChkRes.status === 200, 'Owner PATCH /api/checklists/:id returns HTTP 200 OK');
  assert(ownPatchChkRes.data?.title === 'Regression Checklist Sprint 12 (Updated)', 'Checklist updated in database');

  // 10. Legitimate owner DELETE checklist
  const ownDelChkRes = await api(`/api/checklists/${chkAId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert(ownDelChkRes.status === 200, 'Owner DELETE /api/checklists/:id returns HTTP 200 OK');

  // ==========================================================================
  // SECTION 7: Rate Limiting Enforcement (HTTP 429)
  // ==========================================================================
  console.log('\n--- Section 7: Rate Limiting Enforcement (HTTP 429) ---');
  // Login rate limiter enforces max 5 attempts per window per IP
  const rateLimitTargetIp = '198.51.100.222';
  let saw429 = false;

  for (let i = 0; i < 7; i++) {
    const attemptRes = await api('/api/auth/login', {
      method: 'POST',
      ip: rateLimitTargetIp,
      body: JSON.stringify({ email: 'alice.auditor@qavora.com', password: 'WrongPassword!' })
    });
    if (attemptRes.status === 429) {
      saw429 = true;
      assert(attemptRes.data?.error?.includes('Too many login attempts'), 'Rate limit response contains clear 429 error message');
      break;
    }
  }
  assert(saw429 === true, 'Rate limiter in actual server.ts enforces HTTP 429 Too Many Requests after threshold');

  // ==========================================================================
  // SECTION 8: Database Offline Handling (HTTP 503)
  // ==========================================================================
  console.log('\n--- Section 8: Database Offline Behavior (HTTP 503) ---');
  await closeDatabase();
  delete process.env.MONGODB_URI;

  const offlineHealthRes = await api('/api/health');
  assert(offlineHealthRes.status === 200, 'GET /api/health still reports status during offline database');
  assert(offlineHealthRes.data?.database === 'disconnected', 'GET /api/health reports database: "disconnected"');

  const offlineMeRes = await api('/api/auth/me', {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert(offlineMeRes.status === 503, 'Protected endpoint returns HTTP 503 Service Unavailable when database is offline');

  const offlineRegRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Offline User', email: 'offline@qavora.com', password: 'Password123!' })
  });
  assert(offlineRegRes.status === 503, 'POST /api/auth/register returns HTTP 503 Service Unavailable when database is offline');

  // Restore database connection
  process.env.MONGODB_URI = mongoUri;
  await connectToDatabase();

  // ==========================================================================
  // CLEANUP: Close server listener, database pool, and memory server
  // ==========================================================================
  console.log('\n[Cleanup] Cleaning up temporary test artifacts, database connections, and server listener...');
  await closeDatabase();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mongoClient.close();
  await mongod.stop();
  console.log('[Cleanup] All resources closed cleanly.');

  console.log('\n========================================================================');
  console.log(`TST-001 SUITE COMPLETE: ${passedCount} / ${testCount} assertions passed (${failedCount} failures).`);
  console.log('========================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTst001Suite().catch((err) => {
  console.error('Fatal error running TST-001 suite:', err);
  process.exit(1);
});
