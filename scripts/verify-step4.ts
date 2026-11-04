/**
 * Verification test suite for Phase 4 - Step 4: Frontend Authentication Controller
 * Tests all 10 frontend auth controller requirements and workflows.
 */

import express, { Request, Response, NextFunction } from 'express';
import { MongoClient, Db, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import http from 'http';

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    name: string;
    role: string;
  };
}

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

  dump(): Record<string, string> {
    const res: Record<string, string> = {};
    for (const [k, v] of this.store.entries()) {
      res[k] = v;
    }
    return res;
  }
}

async function runStep4Verification() {
  console.log('='.repeat(60));
  console.log('PHASE 4 - STEP 4: FRONTEND AUTHENTICATION CONTROLLER VERIFICATION');
  console.log('='.repeat(60));

  // 1. Setup in-memory MongoDB
  console.log('\n[Setup] Launching MongoDB instance...');
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  const client = new MongoClient(uri);
  await client.connect();
  const db: Db = client.db('qavora_step4_verify');

  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('users').createIndex({ userId: 1 }, { unique: true });
  await db.collection('projects').createIndex({ id: 1 }, { unique: true });

  const JWT_SECRET = 'step4-test-jwt-secret-key-32chars!';
  process.env.JWT_SECRET = JWT_SECRET;

  function toSafeUser(userDoc: any) {
    return {
      userId: userDoc.userId,
      email: userDoc.email,
      name: userDoc.name,
      role: userDoc.role || 'QA Tester',
      avatarInitials: userDoc.avatarInitials || 'QA',
      createdAt: userDoc.createdAt,
      updatedAt: userDoc.updatedAt,
      lastLoginAt: userDoc.lastLoginAt
    };
  }

  // Auth Middleware
  async function requireAuth(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Authentication token missing or invalid." });
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      return res.status(401).json({ error: "Authentication token missing or invalid." });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtErr: any) {
      if (jwtErr?.name === 'TokenExpiredError') {
        return res.status(401).json({ error: "Session expired. Please log in again." });
      }
      return res.status(401).json({ error: "Invalid authentication token." });
    }

    if (!decoded || !decoded.userId) {
      return res.status(401).json({ error: "Invalid authentication token payload." });
    }

    const user = await db.collection("users").findOne({ userId: decoded.userId });
    if (!user) {
      return res.status(401).json({ error: "User account no longer exists." });
    }

    (req as AuthenticatedRequest).user = {
      userId: String(user.userId),
      email: String(user.email),
      name: String(user.name),
      role: String(user.role || 'QA Tester')
    };

    next();
  }

  // 2. Setup Express test server
  const app = express();
  app.use(express.json());

  // POST /api/auth/register
  app.post('/api/auth/register', async (req: Request, res: Response) => {
    try {
      const { name, email, password, role } = req.body || {};
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: "Full name is required." });
      }
      if (!email || typeof email !== 'string' || !email.trim()) {
        return res.status(400).json({ error: "Email is required." });
      }
      if (!password || typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters long." });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const existing = await db.collection('users').findOne({ email: normalizedEmail });
      if (existing) {
        return res.status(409).json({ error: "An account with this email address already exists." });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const now = new Date().toISOString();

      const initials = name.trim().split(/\s+/).map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || 'QA';

      const userDoc = {
        userId,
        email: normalizedEmail,
        passwordHash,
        name: name.trim(),
        role: role ? String(role).trim() : 'QA Tester',
        avatarInitials: initials,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now
      };

      await db.collection('users').insertOne(userDoc);

      const token = jwt.sign(
        { userId, email: normalizedEmail, name: name.trim(), role: userDoc.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      return res.status(201).json({
        success: true,
        token,
        user: toSafeUser(userDoc)
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/auth/login
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const user = await db.collection('users').findOne({ email: normalizedEmail });
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password." });
      }

      const matches = await bcrypt.compare(password, user.passwordHash);
      if (!matches) {
        return res.status(401).json({ error: "Invalid email or password." });
      }

      const now = new Date().toISOString();
      await db.collection('users').updateOne({ userId: user.userId }, { $set: { lastLoginAt: now } });
      user.lastLoginAt = now;

      const token = jwt.sign(
        { userId: user.userId, email: user.email, name: user.name, role: user.role || 'QA Tester' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      return res.json({
        success: true,
        token,
        user: toSafeUser(user)
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/auth/me
  app.get('/api/auth/me', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = await db.collection('users').findOne({ userId: authReq.user!.userId });
    if (!user) {
      return res.status(401).json({ error: "User account no longer exists." });
    }
    return res.json({ success: true, user: toSafeUser(user) });
  });

  // GET /api/projects (Protected)
  app.get('/api/projects', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const projects = await db.collection('projects').find({ userId: authReq.user!.userId }).toArray();
    return res.json(projects);
  });

  // Start HTTP server on dynamic port
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[Setup] Express test server running on ${baseUrl}`);

  // Setup environment mocks
  const mockStorage = new MockLocalStorage();
  (globalThis as any).localStorage = mockStorage;

  // Intercept fetch so relative URLs like '/api/auth/me' hit baseUrl
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (url: string | URL | Request, init?: RequestInit) => {
    let fullUrl = String(url);
    if (fullUrl.startsWith('/')) {
      fullUrl = `${baseUrl}${fullUrl}`;
    }
    return originalFetch(fullUrl, init);
  };

  // Import authController module dynamically
  const { authController, AUTH_TOKEN_STORAGE_KEY } = await import('../authController.js');

  // ==========================================================================
  // SCENARIO 1: App starts without saved token
  // ==========================================================================
  console.log('\n--- Scenario 1: App starts without saved token ---');
  mockStorage.clear();
  authController.logout(); // reset

  assert(authController.getAuthState() === 'unauthenticated', 'Initial auth state is "unauthenticated"');
  assert(authController.getCurrentUser() === null, 'Initial getCurrentUser() returns null');
  assert(authController.getToken() === null, 'Initial getToken() returns null');
  assert(authController.isAuthenticated() === false, 'Initial isAuthenticated() returns false');

  const initEmpty = await authController.init();
  assert(initEmpty.ok === false, 'init() resolves ok: false when no token saved');
  assert(authController.getAuthState() === 'unauthenticated', 'State remains "unauthenticated" after init()');

  // ==========================================================================
  // SCENARIO 2: Registration establishes authenticated session
  // ==========================================================================
  console.log('\n--- Scenario 2: Registration establishes authenticated session ---');
  let listenerNotified = false as boolean;
  let lastAuthSnapshot: any = null;
  const unsubscribe = authController.onAuthStateChanged((snapshot: any) => {
    listenerNotified = true;
    lastAuthSnapshot = snapshot;
  });

  const regRes = await authController.register({
    name: 'Dana Sterling',
    email: 'dana.sterling@qavora.io',
    password: 'MasterPassword2026!',
    role: 'Senior QA Engineer'
  });

  assert(regRes.ok === true, 'register() returns ok: true');
  assert(regRes.status === 201, 'register() status code is 201');
  assert(Boolean(regRes.token), 'register() returns signed JWT token');
  assert(regRes.user.email === 'dana.sterling@qavora.io', 'register() returns safe user profile');
  assert(regRes.user.role === 'Senior QA Engineer', 'register() preserves custom role');
  assert(authController.isAuthenticated() === true, 'isAuthenticated() is true after registration');
  assert(authController.getAuthState() === 'authenticated', 'State is "authenticated"');
  assert(authController.getCurrentUser()?.email === 'dana.sterling@qavora.io', 'getCurrentUser() returns registered profile');
  assert(mockStorage.getItem(AUTH_TOKEN_STORAGE_KEY) === regRes.token, 'Token was stored in localStorage under correct key');
  assert(listenerNotified === true, 'Auth change listener was notified');
  assert(lastAuthSnapshot.isAuthenticated === true, 'Listener received authenticated state snapshot');

  // Verify passwords are never stored in localStorage
  const dumpedStorage = mockStorage.dump();
  for (const [key, value] of Object.entries(dumpedStorage)) {
    assert(!value.includes('MasterPassword2026!'), `No password present in storage key ${key}`);
    assert(!key.toLowerCase().includes('password'), `No password keys in storage`);
  }

  // ==========================================================================
  // SCENARIO 3: Valid saved token restores authenticated session via /api/auth/me
  // ==========================================================================
  console.log('\n--- Scenario 3: Valid saved token restores session via /api/auth/me ---');
  const savedToken = authController.getToken();
  // Simulate page reload: wipe in-memory state while keeping token in storage
  authController.logout();
  mockStorage.setItem(AUTH_TOKEN_STORAGE_KEY, savedToken!);

  assert((authController.isAuthenticated() as boolean) === false, 'State unauthenticated before init()');
  const restoreRes = await authController.init();
  assert(restoreRes.ok === true, 'init() successfully validated restored session');
  assert(authController.isAuthenticated() === true, 'isAuthenticated() is true after session restore');
  assert(authController.getCurrentUser()?.email === 'dana.sterling@qavora.io', 'User profile restored correctly');
  assert(authController.getToken() === savedToken, 'Token retained in memory');

  // ==========================================================================
  // SCENARIO 4: Logout clears session, user, and token
  // ==========================================================================
  console.log('\n--- Scenario 4: Logout clears session, user, and token ---');
  let logoutListenerCalled = false as boolean;
  const unsubLogout = authController.onAuthStateChanged((s: any) => {
    if (s.state === 'unauthenticated' && s.token === null) {
      logoutListenerCalled = true;
    }
  });

  const logoutRes = authController.logout();
  assert(logoutRes.ok === true, 'logout() returns ok: true');
  assert(authController.getAuthState() === 'unauthenticated', 'State changed to "unauthenticated"');
  assert(authController.getCurrentUser() === null, 'getCurrentUser() returns null after logout');
  assert(authController.getToken() === null, 'getToken() returns null after logout');
  assert((authController.isAuthenticated() as boolean) === false, 'isAuthenticated() is false');
  assert(mockStorage.getItem(AUTH_TOKEN_STORAGE_KEY) === null, 'Token removed from localStorage');
  assert(logoutListenerCalled === true, 'Listener notified of unauthenticated logout transition');
  unsubLogout();

  // ==========================================================================
  // SCENARIO 5: Login stores token and establishes authenticated session
  // ==========================================================================
  console.log('\n--- Scenario 5: Login stores token and establishes authenticated session ---');
  const loginRes = await authController.login({
    email: 'dana.sterling@qavora.io',
    password: 'MasterPassword2026!'
  });

  assert(loginRes.ok === true, 'login() returns ok: true');
  assert(loginRes.status === 200, 'login() returns 200 OK');
  assert(Boolean(loginRes.token), 'login() returns signed token');
  assert(authController.isAuthenticated() === true, 'isAuthenticated() is true after login');
  assert(authController.getAuthState() === 'authenticated', 'State is "authenticated"');
  assert(mockStorage.getItem(AUTH_TOKEN_STORAGE_KEY) === loginRes.token, 'Token persisted to localStorage on login');

  // Verify bad login credentials rejection
  const badLoginRes = await authController.login({
    email: 'dana.sterling@qavora.io',
    password: 'WrongPassword999!'
  });
  assert(badLoginRes.ok === false, 'Bad credentials return ok: false');
  assert(badLoginRes.status === 401, 'Bad credentials return HTTP 401');

  // Restore login for subsequent tests
  await authController.login('dana.sterling@qavora.io', 'MasterPassword2026!');

  // ==========================================================================
  // SCENARIO 6: Invalid / expired token handling
  // ==========================================================================
  console.log('\n--- Scenario 6: Invalid / expired token handling ---');
  // Generate an already expired token
  const expiredToken = jwt.sign(
    { userId: 'usr_fake', email: 'fake@example.com' },
    JWT_SECRET,
    { expiresIn: -10 }
  );

  authController.logout();
  mockStorage.setItem(AUTH_TOKEN_STORAGE_KEY, expiredToken);

  const expiredInitRes = await authController.init();
  assert(expiredInitRes.ok === false, 'init() with expired token returns ok: false');
  assert(authController.isAuthenticated() === false, 'isAuthenticated() is false after expired token init');
  assert(authController.getToken() === null, 'Expired token cleared from controller');
  assert(mockStorage.getItem(AUTH_TOKEN_STORAGE_KEY) === null, 'Expired token wiped from localStorage');

  // Test malformed token
  mockStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'not-a-valid-jwt-token');
  const malformedInitRes = await authController.init();
  assert(malformedInitRes.ok === false, 'init() with malformed token returns ok: false');
  assert(mockStorage.getItem(AUTH_TOKEN_STORAGE_KEY) === null, 'Malformed token wiped from localStorage');

  // Re-login
  await authController.login('dana.sterling@qavora.io', 'MasterPassword2026!');

  // ==========================================================================
  // SCENARIO 7: Attaching Bearer header to authenticated requests
  // ==========================================================================
  console.log('\n--- Scenario 7: Attaching Bearer header to authenticated requests ---');
  const authHeaders = authController.getAuthHeaders({ 'X-Custom-Client': 'QavoraWeb' }) as Record<string, string>;
  assert(Boolean(authHeaders.Authorization), 'Authorization header is present');
  assert(authHeaders.Authorization.startsWith('Bearer ey'), 'Authorization header has "Bearer <token>" format');
  assert(authHeaders['X-Custom-Client'] === 'QavoraWeb', 'Custom headers preserved');

  // Test authenticatedFetch to protected endpoint
  const projectsRes = await authController.authenticatedFetch('/api/projects');
  assert(projectsRes.status === 200, 'authenticatedFetch(/api/projects) succeeds with 200 OK');
  const projectsData = await projectsRes.json();
  assert(Array.isArray(projectsData), 'Projects data returned as array');

  // ==========================================================================
  // SCENARIO 8: HTTP 401 response clears authentication safely
  // ==========================================================================
  console.log('\n--- Scenario 8: HTTP 401 clears auth safely and prevents cascades ---');
  assert(authController.isAuthenticated() === true, 'Authenticated before 401 test');

  // Invalidate user account in database to simulate deleted/revoked account
  await db.collection('users').deleteOne({ email: 'dana.sterling@qavora.io' });

  // Call authenticated endpoint which will now return 401
  const revokedRes = await authController.authenticatedFetch('/api/projects');
  assert(revokedRes.status === 401, 'Request with deleted user returns 401');
  assert((authController.isAuthenticated() as boolean) === false, 'handleUnauthorized() reset isAuthenticated() to false');
  assert(authController.getAuthState() === 'unauthenticated', 'Auth state reset to "unauthenticated"');
  assert(authController.getToken() === null, 'Token cleared after 401');
  assert(mockStorage.getItem(AUTH_TOKEN_STORAGE_KEY) === null, 'Token removed from storage after 401');

  // ==========================================================================
  // SCENARIO 9: Unauthenticated requests prevented before initialization
  // ==========================================================================
  console.log('\n--- Scenario 9: Unauthenticated requests prevented before initialization ---');
  assert((authController.isAuthenticated() as boolean) === false, 'State is unauthenticated');
  const unauthHeaders = authController.getAuthHeaders({ 'Accept': 'application/json' }) as Record<string, string>;
  assert(unauthHeaders.Authorization === undefined, 'No Authorization header attached when unauthenticated');

  // ==========================================================================
  // SCENARIO 10: Preserving local storage data & safety
  // ==========================================================================
  console.log('\n--- Scenario 10: Preserving local storage data & safety ---');
  // Store existing project and checklist records
  const sampleProjects = JSON.stringify([{ id: 'proj_local_1', name: 'Offline Safety Project' }]);
  mockStorage.setItem('qavora_projects_v1', sampleProjects);
  mockStorage.setItem('qavora_checklists_v1', JSON.stringify([{ id: 'chk_1', title: 'Smoke Test' }]));

  // Perform auth cycle: register new user and logout
  await authController.register({
    name: 'Evan QA',
    email: 'evan@qavora.io',
    password: 'SafePassword999!',
    role: 'QA Specialist'
  });
  authController.logout();

  assert(
    mockStorage.getItem('qavora_projects_v1') === sampleProjects,
    'Existing local project storage undamaged by auth operations'
  );
  assert(
    Boolean(mockStorage.getItem('qavora_checklists_v1')),
    'Existing checklist storage undamaged by auth operations'
  );

  // Unsubscribe main listener
  unsubscribe();

  // Cleanup
  server.close();
  await client.close();
  await mongod.stop();

  console.log('\n' + '='.repeat(60));
  console.log(`STEP 4 VERIFICATION COMPLETE: ${passedCount} / ${passedCount + failedCount} assertions passed.`);
  console.log('='.repeat(60));

  if (failedCount > 0) {
    process.exit(1);
  }
}

runStep4Verification().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
