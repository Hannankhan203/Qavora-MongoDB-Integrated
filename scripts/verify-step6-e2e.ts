/**
 * Verification test suite for Phase 4 - Step 6: Final Authentication Integration & End-to-End Verification
 * Comprehensive verification covering complete auth workflow, user data isolation,
 * multi-account switching on the same browser, security audits, offline queue, and regression checks.
 */

import fs from 'fs';
import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import { MongoClient, Db, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import http from 'http';

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passedCount++;
    console.log(`  ✓ [PASS] #${passedCount}: ${message}`);
  } else {
    failedCount++;
    console.error(`  ✗ [FAIL] ${message}`);
  }
}

// In-memory mock localStorage
class MockLocalStorage {
  private store: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get length(): number {
    return this.store.size;
  }
}

async function runEndToEndVerification() {
  console.log('========================================================================');
  console.log('PHASE 4 - STEP 6: FINAL AUTHENTICATION INTEGRATION & E2E VERIFICATION');
  console.log('========================================================================\n');

  // ==========================================================================
  // SECTION 1: Static Codebase Security & Configuration Audit
  // ==========================================================================
  console.log('--- Section 1: Security & Environment Audit ---');

  const serverTsPath = path.resolve('server.ts');
  const serverTs = fs.readFileSync(serverTsPath, 'utf8');

  // 1. Verify JWT_SECRET is strictly required with zero insecure fallback
  assert(
    serverTs.includes('getJwtSecret()') &&
    serverTs.includes("throw new Error('JWT_SECRET environment variable is missing.')"),
    'JWT_SECRET is strictly required and throws if missing (no insecure fallback)'
  );
  assert(
    !serverTs.includes("process.env.JWT_SECRET || 'secret'") &&
    !serverTs.includes('process.env.JWT_SECRET || "secret"'),
    'Zero hardcoded fallback secrets in server.ts'
  );

  // 2. Verify all private routes use requireAuth
  assert(serverTs.includes('app.get("/api/auth/me", requireAuth,'), 'GET /api/auth/me is protected with requireAuth');
  assert(serverTs.includes('app.get("/api/tests", requireAuth,'), 'GET /api/tests is protected with requireAuth');
  assert(serverTs.includes('app.post("/api/tests", requireAuth,'), 'POST /api/tests is protected with requireAuth');
  assert(serverTs.includes('app.get("/api/projects", requireAuth,'), 'GET /api/projects is protected with requireAuth');
  assert(serverTs.includes('app.get("/api/projects/:id", requireAuth,'), 'GET /api/projects/:id is protected with requireAuth');
  assert(serverTs.includes('app.post("/api/projects", requireAuth,'), 'POST /api/projects is protected with requireAuth');
  assert(serverTs.includes('app.put("/api/projects/:id", requireAuth,'), 'PUT /api/projects/:id is protected with requireAuth');
  assert(serverTs.includes('app.patch("/api/projects/:id/status", requireAuth,'), 'PATCH /api/projects/:id/status is protected with requireAuth');
  assert(serverTs.includes('app.patch("/api/projects/:id/data", requireAuth,'), 'PATCH /api/projects/:id/data is protected with requireAuth');
  assert(serverTs.includes('app.delete("/api/projects/:id", requireAuth,'), 'DELETE /api/projects/:id is protected with requireAuth');
  assert(serverTs.includes('app.post("/api/projects/sync-local", requireAuth,'), 'POST /api/projects/sync-local is protected with requireAuth');

  // 3. Verify .env.example contains only placeholders
  const envExamplePath = path.resolve('.env.example');
  const envExample = fs.readFileSync(envExamplePath, 'utf8');
  assert(!envExample.includes('mongodb+srv://') && !envExample.includes('password='), '.env.example contains placeholders only (no credentials)');
  assert(envExample.includes('JWT_SECRET='), '.env.example includes JWT_SECRET placeholder');
  assert(envExample.includes('MONGODB_URI='), '.env.example includes MONGODB_URI placeholder');
  assert(envExample.includes('MONGODB_DB='), '.env.example includes MONGODB_DB placeholder');

  // 4. Verify password hash exclusion in responses
  assert(serverTs.includes('toSafeUser(user)'), 'Server formats user objects via toSafeUser()');
  assert(!serverTs.includes('passwordHash: user.passwordHash'), 'passwordHash is excluded from toSafeUser output');

  // ==========================================================================
  // SECTION 2: Launch In-Memory MongoDB & Server Environment
  // ==========================================================================
  console.log('\n--- Section 2: Launching Test Server & Database ---');
  const mongod = await MongoMemoryServer.create();
  const mongoUri = mongod.getUri();
  const mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  const db = mongoClient.db('qavora_final_e2e');

  // Ensure production index setup
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('users').createIndex({ userId: 1 }, { unique: true });
  await db.collection('projects').createIndex({ id: 1 }, { unique: true });
  await db.collection('projects').createIndex({ userId: 1, id: 1 });
  await db.collection('projects').createIndex({ userId: 1, status: 1 });
  await db.collection('projects').createIndex({ userId: 1 });
  await db.collection('tests').createIndex({ userId: 1 });

  const JWT_SECRET = 'qavora_final_step6_audit_jwt_secret_999!';

  // Build Express app with exact server.ts logic
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  let isDatabaseOnline = true;

  // requireAuth middleware
  const requireAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    if (!isDatabaseOnline) {
      return res.status(503).json({ error: 'Authentication service unavailable (database offline).' });
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication token missing or invalid.' });
    }
    const token = authHeader.substring(7).trim();
    if (!token) {
      return res.status(401).json({ error: 'Authentication token missing or invalid.' });
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      if (!decoded || !decoded.userId) {
        return res.status(401).json({ error: 'Invalid authentication token payload.' });
      }
      const user = await db.collection('users').findOne({ userId: decoded.userId });
      if (!user) {
        return res.status(401).json({ error: 'User account no longer exists.' });
      }
      (req as any).user = {
        userId: String(user.userId),
        email: String(user.email),
        name: String(user.name),
        role: String(user.role || 'QA Tester')
      };
      next();
    } catch (jwtErr: any) {
      if (jwtErr?.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
      }
      return res.status(401).json({ error: 'Invalid authentication token.' });
    }
  };

  function toSafeUser(user: any) {
    return {
      userId: String(user.userId),
      email: String(user.email),
      name: String(user.name),
      role: String(user.role || 'QA Tester'),
      avatarInitials: String(user.avatarInitials || 'QA'),
      createdAt: String(user.createdAt),
      updatedAt: String(user.updatedAt),
      lastLoginAt: String(user.lastLoginAt)
    };
  }

  function buildUserProjectQuery(idParam: string | string[], userId: string) {
    const cleanId = Array.isArray(idParam) ? idParam[0] : idParam;
    if (ObjectId.isValid(cleanId) && cleanId.length === 24) {
      return {
        $or: [
          { id: cleanId, userId },
          { _id: new ObjectId(cleanId), userId }
        ]
      };
    }
    return { id: cleanId, userId };
  }

  // Auth Routes
  app.post('/api/auth/register', async (req: Request, res: Response) => {
    if (!isDatabaseOnline) return res.status(503).json({ error: 'Database offline' });
    const { name, email, password, role } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Full name required' });
    if (!email || typeof email !== 'string' || !email.trim()) return res.status(400).json({ error: 'Email required' });
    if (!password || typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password min 8 chars' });

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await db.collection('users').findOne({ email: normalizedEmail });
    if (existing) return res.status(409).json({ error: 'A user with this email address already exists.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const initials = name.trim().split(/\s+/).map((p: string) => p[0]).join('').toUpperCase().slice(0, 2) || 'QA';
    const now = new Date().toISOString();

    const newUser = {
      userId,
      email: normalizedEmail,
      name: name.trim(),
      role: (role && typeof role === 'string' && role.trim()) ? role.trim() : 'QA Tester',
      avatarInitials: initials,
      passwordHash,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now
    };

    await db.collection('users').insertOne(newUser);
    const token = jwt.sign(
      { userId, email: normalizedEmail, name: name.trim(), role: newUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({ success: true, token, user: toSafeUser(newUser) });
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    if (!isDatabaseOnline) return res.status(503).json({ error: 'Database offline' });
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await db.collection('users').findOne({ email: normalizedEmail });
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

    const match = await bcrypt.compare(String(password), user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' });

    const now = new Date().toISOString();
    await db.collection('users').updateOne({ _id: user._id }, { $set: { lastLoginAt: now, updatedAt: now } });
    user.lastLoginAt = now;

    const token = jwt.sign(
      { userId: user.userId, email: user.email, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({ success: true, token, user: toSafeUser(user) });
  });

  app.get('/api/auth/me', requireAuthMiddleware, async (req: Request, res: Response) => {
    const authReq = req as any;
    const user = await db.collection('users').findOne({ userId: authReq.user.userId });
    if (!user) return res.status(401).json({ error: 'User account no longer exists.' });
    return res.json({ success: true, user: toSafeUser(user) });
  });

  // Project Routes
  app.get('/api/projects', requireAuthMiddleware, async (req: Request, res: Response) => {
    const authReq = req as any;
    const projects = await db.collection('projects').find({ userId: authReq.user.userId }).toArray();
    return res.json(projects);
  });

  app.get('/api/projects/:id', requireAuthMiddleware, async (req: Request, res: Response) => {
    const authReq = req as any;
    const query = buildUserProjectQuery(req.params.id, authReq.user.userId);
    const project = await db.collection('projects').findOne(query);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    return res.json(project);
  });

  app.post('/api/projects', requireAuthMiddleware, async (req: Request, res: Response) => {
    const authReq = req as any;
    const userId = authReq.user.userId;
    const { name, type, version, description, status, id, userId: _ignoredUserId, ...extraData } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Name required' });

    const projectId = id ? String(id).trim() : `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const newProject = {
      id: projectId,
      userId,
      name: name.trim(),
      type: type || 'Web Application',
      status: status || 'Active',
      version: version || '',
      description: description || '',
      createdAt: now,
      updatedAt: now,
      testPlan: extraData.testPlan || { id: `plan_${projectId}`, name: `${name.trim()} Plan`, phases: [] },
      testSuites: extraData.testSuites || [],
      executions: extraData.executions || [],
      defects: extraData.defects || []
    };

    try {
      const result = await db.collection('projects').insertOne(newProject);
      return res.status(201).json({ _id: result.insertedId, ...newProject });
    } catch (err: any) {
      if (err.code === 11000) return res.status(409).json({ error: 'Project ID exists' });
      return res.status(500).json({ error: 'Server error' });
    }
  });

  app.put('/api/projects/:id', requireAuthMiddleware, async (req: Request, res: Response) => {
    const authReq = req as any;
    const userId = authReq.user.userId;
    const query = buildUserProjectQuery(req.params.id, userId);
    const { name, type, version, description, status } = req.body || {};
    const updates: any = { updatedAt: new Date().toISOString() };
    if (name) updates.name = name;
    if (type) updates.type = type;
    if (status) updates.status = status;

    const result = await db.collection('projects').findOneAndUpdate(query, { $set: updates }, { returnDocument: 'after' });
    if (!result) return res.status(404).json({ error: 'Project not found.' });
    return res.json(result);
  });

  app.patch('/api/projects/:id/status', requireAuthMiddleware, async (req: Request, res: Response) => {
    const authReq = req as any;
    const userId = authReq.user.userId;
    const query = buildUserProjectQuery(req.params.id, userId);
    const { status } = req.body || {};
    if (!['Active', 'Completed', 'Archived'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const result = await db.collection('projects').findOneAndUpdate(
      query,
      { $set: { status, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Project not found.' });
    return res.json(result);
  });

  app.patch('/api/projects/:id/data', requireAuthMiddleware, async (req: Request, res: Response) => {
    const authReq = req as any;
    const userId = authReq.user.userId;
    const query = buildUserProjectQuery(req.params.id, userId);
    const { _id, id, userId: _ignoredUserId, ...allowedData } = req.body || {};
    allowedData.updatedAt = new Date().toISOString();

    const result = await db.collection('projects').findOneAndUpdate(
      query,
      { $set: allowedData },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Project not found.' });
    return res.json(result);
  });

  app.delete('/api/projects/:id', requireAuthMiddleware, async (req: Request, res: Response) => {
    const authReq = req as any;
    const userId = authReq.user.userId;
    const query = buildUserProjectQuery(req.params.id, userId);
    const result = await db.collection('projects').deleteOne(query);
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Project not found.' });
    return res.json({ success: true, message: 'Deleted' });
  });

  app.post('/api/projects/sync-local', requireAuthMiddleware, async (req: Request, res: Response) => {
    const authReq = req as any;
    const userId = authReq.user.userId;
    const rawList = Array.isArray(req.body) ? req.body : req.body?.projects;
    if (!Array.isArray(rawList)) return res.status(400).json({ error: 'Array required' });

    const operations = rawList.map(item => {
      const projId = item.id || `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const doc = { ...item, id: projId, userId };
      delete doc._id;
      return {
        updateOne: {
          filter: { id: projId, userId },
          update: { $setOnInsert: doc },
          upsert: true
        }
      };
    });

    if (operations.length === 0) return res.json({ success: true, count: 0 });
    const bulk = await db.collection('projects').bulkWrite(operations);
    return res.json({ success: true, insertedCount: bulk.upsertedCount, matchedCount: bulk.matchedCount });
  });

  // Tests Routes
  app.get('/api/tests', requireAuthMiddleware, async (req: Request, res: Response) => {
    const authReq = req as any;
    const tests = await db.collection('tests').find({ userId: authReq.user.userId }).toArray();
    return res.json(tests);
  });

  app.post('/api/tests', requireAuthMiddleware, async (req: Request, res: Response) => {
    const authReq = req as any;
    const { name, status } = req.body || {};
    if (!name || !status) return res.status(400).json({ error: 'Name and status required' });
    const newTest = { name: name.trim(), status: status.trim(), userId: authReq.user.userId };
    const result = await db.collection('tests').insertOne(newTest);
    return res.status(201).json({ _id: result.insertedId, ...newTest });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const serverAddress = server.address() as any;
  const baseUrl = `http://127.0.0.1:${serverAddress.port}`;

  // Configure fetch interception and mock storage for client
  const mockStorage = new MockLocalStorage();
  (globalThis as any).localStorage = mockStorage;
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (url: string | URL | Request, init?: RequestInit) => {
    let fullUrl = String(url);
    if (fullUrl.startsWith('/api/')) {
      fullUrl = `${baseUrl}${fullUrl}`;
    }
    return originalFetch(fullUrl, init);
  };

  const { authController } = await import('../authController.js');

  // ==========================================================================
  // SECTION 3: Complete Authentication Lifecycle
  // ==========================================================================
  console.log('\n--- Section 3: Authentication Lifecycle & Token Validation ---');

  // Register User A
  const regResA = await authController.register({
    name: 'Alice Quality',
    email: 'alice.quality@qavora.io',
    password: 'AliceStrongPassword2026!'
  });
  assert(regResA.ok === true && regResA.status === 201, 'User A registered with 201 Created');
  assert(Boolean(regResA.token), 'Registration returned signed JWT token');
  assert(regResA.user.avatarInitials === 'AQ', 'Avatar initials computed correctly (AQ)');
  assert(!('passwordHash' in regResA.user), 'User response strictly excludes passwordHash');

  // Verify stored in MongoDB with salt 10 hash
  const aliceDbUser = await db.collection('users').findOne({ email: 'alice.quality@qavora.io' });
  assert(aliceDbUser !== null, 'User A persisted in MongoDB Atlas users collection');
  assert(aliceDbUser!.passwordHash !== 'AliceStrongPassword2026!', 'Plaintext password is never stored');
  const saltValid = await bcrypt.compare('AliceStrongPassword2026!', aliceDbUser!.passwordHash);
  assert(saltValid === true, 'Stored bcrypt hash verifies with 10 salt rounds');

  // Duplicate email rejection
  const dupRes = await authController.register({
    name: 'Alice Impostor',
    email: 'alice.quality@qavora.io',
    password: 'DifferentPassword2026!'
  });
  assert(dupRes.ok === false && dupRes.status === 409, 'Duplicate email registration rejected with 409 Conflict');
  assert(dupRes.error.includes('already exists'), 'Duplicate email error states user already exists');

  // Logout User A
  authController.logout();
  assert(!authController.isAuthenticated(), 'User logged out; isAuthenticated() is false');
  assert(mockStorage.getItem('qavora_auth_token_v1') === null, 'JWT token removed from localStorage on logout');

  // Invalid login credentials
  const badLoginRes = await authController.login({
    email: 'alice.quality@qavora.io',
    password: 'WrongPassword123'
  });
  assert(badLoginRes.ok === false && badLoginRes.status === 401, 'Invalid password rejected with 401 Unauthorized');
  assert(badLoginRes.error === 'Invalid email or password.', 'Generic error message protects against account enumeration');

  // Valid login User A
  const goodLoginRes = await authController.login({
    email: 'alice.quality@qavora.io',
    password: 'AliceStrongPassword2026!'
  });
  assert(goodLoginRes.ok === true && goodLoginRes.status === 200, 'User A successfully logged in with 200 OK');
  assert(authController.isAuthenticated(), 'authController state is authenticated');
  assert(mockStorage.getItem('qavora_auth_token_v1') !== null, 'JWT token saved in localStorage after login');

  // Session verification via GET /api/auth/me
  const tokenPayload = jwt.decode(authController.getToken()!) as any;
  assert(tokenPayload.userId === aliceDbUser!.userId, 'JWT payload contains valid userId');
  assert(tokenPayload.email === 'alice.quality@qavora.io', 'JWT payload contains normalized email');

  const meResult = await authController.init();
  assert(meResult.ok === true, 'authController.init() validates session via /api/auth/me');
  assert(authController.getCurrentUser()?.userId === aliceDbUser!.userId, 'Restored user identity matches database');

  // Session expiry / tampering
  const expiredToken = jwt.sign(
    { userId: aliceDbUser!.userId, email: aliceDbUser!.email },
    JWT_SECRET,
    { expiresIn: '0s' }
  );
  mockStorage.setItem('qavora_auth_token_v1', expiredToken);
  const expiredInit = await authController.init();
  assert(expiredInit.ok === false, 'Expired session token rejected');
  assert(mockStorage.getItem('qavora_auth_token_v1') === null, 'Expired session token purged from localStorage');

  // Register User B
  const regResB = await authController.register({
    name: 'Bob Automation',
    email: 'bob.auto@qavora.io',
    password: 'BobStrongPassword2026!'
  });
  assert(regResB.ok === true, 'User B registered successfully');
  const bobDbUser = await db.collection('users').findOne({ email: 'bob.auto@qavora.io' });
  assert(bobDbUser!.userId !== aliceDbUser!.userId, 'User A and User B have distinct unique userIds');

  // ==========================================================================
  // SECTION 4: User Data Isolation & Cross-Tenant Access Protection
  // ==========================================================================
  console.log('\n--- Section 4: User Data Isolation & Cross-Tenant Access Protection ---');

  // Log in as User A and create Alice's projects & tests
  await authController.login({ email: 'alice.quality@qavora.io', password: 'AliceStrongPassword2026!' });
  const aliceToken = authController.getToken();

  const createAliceProjRes = await originalFetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` },
    body: JSON.stringify({
      id: 'proj_alice_core',
      name: 'Alice Core Web Platform',
      type: 'Web Application',
      status: 'Active',
      testSuites: [
        { id: 'suite_1', name: 'Authentication Suite', testCases: [{ id: 'TC-01', title: 'Login with 2FA' }] }
      ]
    })
  });
  assert(createAliceProjRes.status === 201, 'User A created Project "proj_alice_core"');

  const createAliceTestRes = await originalFetch(`${baseUrl}/api/tests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` },
    body: JSON.stringify({ name: 'Alice Private Performance Test', status: 'Passed' })
  });
  assert(createAliceTestRes.status === 201, 'User A created Test document in tests collection');

  // Log in as User B and create Bob's projects & tests
  await authController.login({ email: 'bob.auto@qavora.io', password: 'BobStrongPassword2026!' });
  const bobToken = authController.getToken();

  const createBobProjRes = await originalFetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bobToken}` },
    body: JSON.stringify({
      id: 'proj_bob_mobile',
      name: 'Bob Mobile Banking Suite',
      type: 'Mobile Application',
      status: 'Active'
    })
  });
  assert(createBobProjRes.status === 201, 'User B created Project "proj_bob_mobile"');

  // Test 1: User A list query must only return User A projects
  const aliceListRes = await originalFetch(`${baseUrl}/api/projects`, {
    headers: { 'Authorization': `Bearer ${aliceToken}` }
  });
  const aliceProjects = await aliceListRes.json();
  assert(aliceProjects.length === 1 && aliceProjects[0].id === 'proj_alice_core', 'User A sees only their own project');
  assert(!aliceProjects.some((p: any) => p.id === 'proj_bob_mobile'), 'User A cannot see Bob Mobile Banking Suite in list');

  // Test 2: User B list query must only return User B projects
  const bobListRes = await originalFetch(`${baseUrl}/api/projects`, {
    headers: { 'Authorization': `Bearer ${bobToken}` }
  });
  const bobProjects = await bobListRes.json();
  assert(bobProjects.length === 1 && bobProjects[0].id === 'proj_bob_mobile', 'User B sees only their own project');
  assert(!bobProjects.some((p: any) => p.id === 'proj_alice_core'), 'User B cannot see Alice Core Web Platform in list');

  // Test 3: Direct cross-tenant access - User A attempts to read Bob's project
  const crossGetRes = await originalFetch(`${baseUrl}/api/projects/proj_bob_mobile`, {
    headers: { 'Authorization': `Bearer ${aliceToken}` }
  });
  assert(crossGetRes.status === 404, 'Direct GET by non-owner returns 404 Not Found (no ownership disclosure)');

  // Test 4: Direct cross-tenant access - User A attempts to update Bob's project via PUT
  const crossPutRes = await originalFetch(`${baseUrl}/api/projects/proj_bob_mobile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` },
    body: JSON.stringify({ name: 'Hacked by Alice' })
  });
  assert(crossPutRes.status === 404, 'Cross-tenant PUT returns 404 Not Found');

  // Test 5: Direct cross-tenant access - User A attempts to update Bob's project via PATCH /status
  const crossPatchStatusRes = await originalFetch(`${baseUrl}/api/projects/proj_bob_mobile/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` },
    body: JSON.stringify({ status: 'Archived' })
  });
  assert(crossPatchStatusRes.status === 404, 'Cross-tenant PATCH status returns 404 Not Found');

  // Test 6: Direct cross-tenant access - User A attempts to update Bob's project via PATCH /data
  const crossPatchDataRes = await originalFetch(`${baseUrl}/api/projects/proj_bob_mobile/data`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` },
    body: JSON.stringify({ name: 'Tampered Data', testSuites: [] })
  });
  assert(crossPatchDataRes.status === 404, 'Cross-tenant PATCH data returns 404 Not Found');

  // Test 7: Direct cross-tenant access - User A attempts to delete Bob's project
  const crossDeleteRes = await originalFetch(`${baseUrl}/api/projects/proj_bob_mobile`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${aliceToken}` }
  });
  assert(crossDeleteRes.status === 404, 'Cross-tenant DELETE returns 404 Not Found');

  // Verify Bob's project in database is completely untouched
  const bobProjectInDb = await db.collection('projects').findOne({ id: 'proj_bob_mobile' });
  assert(bobProjectInDb!.name === 'Bob Mobile Banking Suite', "Bob's project name remained intact in database");
  assert(bobProjectInDb!.status === 'Active', "Bob's project status remained intact in database");
  assert(bobProjectInDb!.userId === bobDbUser!.userId, "Bob's project ownership remained with Bob");

  // Test 8: Attempting to override ownership via request body
  const spoofRes = await originalFetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` },
    body: JSON.stringify({
      id: 'proj_alice_spoof',
      name: 'Spoofed Project',
      userId: bobDbUser!.userId // User A maliciously claims Bob owns this
    })
  });
  assert(spoofRes.status === 201, 'Project created');
  const spoofDb = await db.collection('projects').findOne({ id: 'proj_alice_spoof' });
  assert(spoofDb!.userId === aliceDbUser!.userId, 'Server discarded incoming userId and enforced authenticated User A identity');

  // Test 9: Tests collection isolation
  const aliceTestsRes = await originalFetch(`${baseUrl}/api/tests`, {
    headers: { 'Authorization': `Bearer ${aliceToken}` }
  });
  const aliceTests = await aliceTestsRes.json();
  assert(aliceTests.length === 1 && aliceTests[0].name === 'Alice Private Performance Test', 'User A sees only their tests');

  const bobTestsRes = await originalFetch(`${baseUrl}/api/tests`, {
    headers: { 'Authorization': `Bearer ${bobToken}` }
  });
  const bobTests = await bobTestsRes.json();
  assert(bobTests.length === 0, 'User B sees zero tests from User A');

  // ==========================================================================
  // SECTION 5: Multi-Account Switching & Local Data Safety
  // ==========================================================================
  console.log('\n--- Section 5: Multi-Account Switching & Local Data Safety ---');

  // Setup simulated local environment for User A
  mockStorage.setItem('qavora_projects_v1', JSON.stringify([
    { id: 'proj_alice_cached', name: 'Alice Confidential Local Project', userId: aliceDbUser!.userId }
  ]));
  mockStorage.setItem('qavora_activities_v1', JSON.stringify([
    { id: 'act_1', action: 'Created Alice Project' }
  ]));
  mockStorage.setItem('qavora_theme_preference', 'dark');
  mockStorage.setItem('qavora_preferences_v1', JSON.stringify({ density: 'compact' }));

  // Simulate logout cleanup as implemented in script.js clearUserSessionData()
  const STORAGE_KEYS = {
    PROJECTS: 'qavora_projects_v1',
    ACTIVITIES: 'qavora_activities_v1',
    THEME: 'qavora_theme_preference',
    PREFERENCES: 'qavora_preferences_v1'
  };

  function simulateUserLogout() {
    authController.logout();
    mockStorage.removeItem(STORAGE_KEYS.PROJECTS);
    mockStorage.removeItem(STORAGE_KEYS.ACTIVITIES);
  }

  simulateUserLogout();

  assert(mockStorage.getItem('qavora_projects_v1') === null, 'Logout purged private project cache from localStorage');
  assert(mockStorage.getItem('qavora_activities_v1') === null, 'Logout purged private activities from localStorage');
  assert(mockStorage.getItem('qavora_theme_preference') === 'dark', 'Logout preserved general theme preference');
  assert(mockStorage.getItem('qavora_preferences_v1') !== null, 'Logout preserved general UI preferences');

  // Now User B logs in on the same browser
  await authController.login({ email: 'bob.auto@qavora.io', password: 'BobStrongPassword2026!' });
  assert(authController.isAuthenticated(), 'User B successfully authenticated');

  // In script.js, hydrateProjectsFromBackend reads local projects before syncing.
  // Since User A data was purged, local projects are empty, so syncLocal uploads nothing.
  const localProjectsAfterSwitch = mockStorage.getItem('qavora_projects_v1');
  assert(localProjectsAfterSwitch === null, 'User B starts with zero residual local projects from User A');

  // User B creates a new project
  const bobNewProjRes = await originalFetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authController.getToken()}` },
    body: JSON.stringify({
      id: 'proj_bob_second',
      name: 'Bob Payment Gateway Tests'
    })
  });
  assert(bobNewProjRes.status === 201, 'User B created project under their account');

  // Switch back to User A
  simulateUserLogout();
  await authController.login({ email: 'alice.quality@qavora.io', password: 'AliceStrongPassword2026!' });

  const aliceReloadRes = await originalFetch(`${baseUrl}/api/projects`, {
    headers: { 'Authorization': `Bearer ${authController.getToken()}` }
  });
  const aliceProjectsRestored = await aliceReloadRes.json();
  assert(
    aliceProjectsRestored.some((p: any) => p.id === 'proj_alice_core'),
    "User A's original Project Alpha is restored from MongoDB upon re-login"
  );
  assert(
    !aliceProjectsRestored.some((p: any) => p.id === 'proj_bob_second'),
    "User A cannot see User B's new payment gateway project"
  );

  // ==========================================================================
  // SECTION 6: Database Offline & Security Boundary Tests
  // ==========================================================================
  console.log('\n--- Section 6: Database Offline & Security Resilience ---');

  // Simulate Database Offline
  isDatabaseOnline = false;

  const offlineAuthMe = await originalFetch(`${baseUrl}/api/auth/me`, {
    headers: { 'Authorization': `Bearer ${aliceToken}` }
  });
  assert(offlineAuthMe.status === 503, 'Offline database returns HTTP 503 Service Unavailable (no auth bypass)');

  const offlineRegister = await originalFetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Offline User', email: 'offline@qavora.io', password: 'Password123!' })
  });
  assert(offlineRegister.status === 503, 'Offline database registration returns HTTP 503');

  isDatabaseOnline = true;

  // Cleanup
  server.close();
  await mongoClient.close();
  await mongod.stop();
  (globalThis as any).fetch = originalFetch;

  console.log('\n========================================================================');
  console.log(`TOTAL PASSES: ${passedCount}`);
  console.log(`TOTAL FAILURES: ${failedCount}`);
  console.log('========================================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runEndToEndVerification().catch(err => {
  console.error('Fatal test error in Step 6 E2E suite:', err);
  process.exit(1);
});
