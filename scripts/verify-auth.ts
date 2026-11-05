import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import http from 'http';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

async function runVerification() {
  console.log('============================================================');
  console.log('QAVORA CUSTOM AUTHENTICATION BACKEND CORE VERIFICATION');
  console.log('============================================================\n');

  // 1. Spin up a genuine in-process MongoDB instance
  console.log('[Setup] Launching local MongoDB instance...');
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  const dbName = 'qavora_auth_verify';
  const jwtSecret = 'qavora_test_jwt_secret_key_9876543210_secure';
  process.env.JWT_SECRET = jwtSecret;

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  console.log(`[Setup] Connected to MongoDB at ${uri} (db: ${dbName})`);

  // Create unique indexes
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("users").createIndex({ userId: 1 }, { unique: true });
  await db.collection("projects").createIndex({ id: 1 }, { unique: true });
  console.log('[Setup] Created unique indexes on users (email, userId) and projects (id)\n');

  // Launch and interact with the actual Express server defined in server.ts
  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'production';
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = dbName;
  process.env.JWT_SECRET = jwtSecret;

  const serverModule = await import('../server.ts');
  const app = serverModule.default;
  const connectToDatabase = serverModule.connectToDatabase;
  const closeDatabase = serverModule.closeDatabase;

  await connectToDatabase();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const BASE_URL = `http://127.0.0.1:${port}`;

  let ipCounter = 10;
  // Helper fetch wrapper
  async function api(path: string, options: any = {}) {
    const { headers: customHeaders, ...restOptions } = options;
    const res = await fetch(`${BASE_URL}${path}`, {
      ...restOptions,
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': `198.51.100.${ipCounter++}`,
        ...(customHeaders || {})
      }
    });
    const status = res.status;
    let data = null;
    try {
      data = await res.json();
    } catch {}
    return { status, data };
  }

  let testCount = 0;
  let passCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    testCount++;
    if (condition) {
      passCount++;
      console.log(`  ✓ [PASS] Test ${testCount}: ${testName}`);
    } else {
      console.error(`  ✗ [FAIL] Test ${testCount}: ${testName} - ${detail || 'Assertion failed'}`);
    }
  }

  const testEmail = 'lead.tester@qavora-test.internal';
  const testPassword = 'SecurePassword2026!';
  const testName = 'Sarah Connor';
  let activeToken = '';
  let activeUserId = '';

  // --------------------------------------------------------------------------
  // TEST 1: Successful registration
  // --------------------------------------------------------------------------
  console.log('\n--- Running Test 1: Successful registration ---');
  const regRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: testName,
      email: testEmail,
      password: testPassword
    })
  });
  assert(regRes.status === 201, 'Status code is 201 Created');
  assert(Boolean(regRes.data?.token), 'JWT token returned in response');
  assert(regRes.data?.user?.email === testEmail.toLowerCase(), 'User email matches normalized input');
  assert(regRes.data?.user?.role === 'QA Tester', 'Default role is "QA Tester"');
  assert(regRes.data?.user?.avatarInitials === 'SC', 'Avatar initials computed as "SC"');
  assert(Boolean(regRes.data?.user?.userId), 'Unique userId generated');
  activeToken = regRes.data?.token || '';
  activeUserId = regRes.data?.user?.userId || '';

  // --------------------------------------------------------------------------
  // TEST 2: Duplicate email rejection
  // --------------------------------------------------------------------------
  console.log('\n--- Running Test 2: Duplicate email rejection ---');
  const dupRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Another Name',
      email: testEmail.toUpperCase(), // Case insensitive duplicate
      password: 'AnotherPassword123!'
    })
  });
  assert(dupRes.status === 409, 'Duplicate email returns 409 Conflict');
  assert(dupRes.data?.error?.includes('already exists'), 'Clear duplicate error message returned');

  // --------------------------------------------------------------------------
  // TEST 3: Password hashing (no plaintext storage)
  // --------------------------------------------------------------------------
  console.log('\n--- Running Test 3: Password hashing & raw database verification ---');
  const rawDbUser = await db.collection("users").findOne({ email: testEmail });
  assert(Boolean(rawDbUser), 'User document exists in MongoDB Atlas collection');
  assert(typeof rawDbUser?.passwordHash === 'string', 'passwordHash field exists');
  assert(rawDbUser?.passwordHash.startsWith('$2a$') || rawDbUser?.passwordHash.startsWith('$2b$'), 'passwordHash is valid bcrypt hash');
  assert(rawDbUser?.passwordHash !== testPassword, 'passwordHash is NOT the plaintext password');
  assert(!JSON.stringify(rawDbUser).includes(testPassword), 'Plaintext password is never stored anywhere in document');
  const isBcryptValid = await bcrypt.compare(testPassword, rawDbUser?.passwordHash);
  assert(isBcryptValid === true, 'bcrypt.compare confirms hash matches original password with salt factor 10');

  // --------------------------------------------------------------------------
  // TEST 4: Successful login
  // --------------------------------------------------------------------------
  console.log('\n--- Running Test 4: Successful login ---');
  const loginRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: testEmail,
      password: testPassword
    })
  });
  assert(loginRes.status === 200, 'Status code is 200 OK');
  assert(Boolean(loginRes.data?.token), 'Signed JWT token returned on login');
  assert(loginRes.data?.user?.userId === activeUserId, 'Returned user matches active userId');
  assert(Boolean(loginRes.data?.user?.lastLoginAt), 'lastLoginAt timestamp returned');

  // --------------------------------------------------------------------------
  // TEST 5: Incorrect password rejection
  // --------------------------------------------------------------------------
  console.log('\n--- Running Test 5: Incorrect password rejection ---');
  const badPassRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: testEmail,
      password: 'WrongPasswordTotally!'
    })
  });
  assert(badPassRes.status === 401, 'Incorrect password returns 401 Unauthorized');
  assert(badPassRes.data?.error === 'Invalid email or password.', 'Generic invalid credentials message returned');

  // --------------------------------------------------------------------------
  // TEST 6: Invalid email handling
  // --------------------------------------------------------------------------
  console.log('\n--- Running Test 6: Invalid email & password validation handling ---');
  const badEmailRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Test Name',
      email: 'not-an-email',
      password: 'ValidPassword123!'
    })
  });
  assert(badEmailRes.status === 400, 'Invalid email format returns 400 Bad Request');

  const shortPassRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Test Name',
      email: 'valid@example.com',
      password: 'short' // < 8 characters
    })
  });
  assert(shortPassRes.status === 400, 'Password under 8 chars returns 400 Bad Request');
  assert(shortPassRes.data?.error?.includes('8 characters'), 'Password error specifies minimum 8 chars');

  const emptyNameRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: '   ',
      email: 'valid2@example.com',
      password: 'ValidPassword123!'
    })
  });
  assert(emptyNameRes.status === 400, 'Empty name returns 400 Bad Request');

  // --------------------------------------------------------------------------
  // TEST 7: Valid JWT session verification
  // --------------------------------------------------------------------------
  console.log('\n--- Running Test 7: Valid JWT session verification (/api/auth/me) ---');
  const meRes = await api('/api/auth/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${activeToken}` }
  });
  assert(meRes.status === 200, 'Status code is 200 OK');
  assert(meRes.data?.user?.userId === activeUserId, 'Returns verified user profile matching userId');
  assert(meRes.data?.user?.email === testEmail, 'Returns matching email');

  // --------------------------------------------------------------------------
  // TEST 8: Invalid and expired JWT rejection
  // --------------------------------------------------------------------------
  console.log('\n--- Running Test 8: Invalid and expired JWT rejection ---');
  // 8a. Corrupted / garbage token
  const badTokenRes = await api('/api/auth/me', {
    method: 'GET',
    headers: { Authorization: 'Bearer this.is.a.corrupted.token' }
  });
  assert(badTokenRes.status === 401, 'Corrupted token returns 401 Unauthorized');
  assert(badTokenRes.data?.error === 'Invalid authentication token.', 'Invalid token message returned');

  // 8b. Missing token header
  const noTokenRes = await api('/api/auth/me', { method: 'GET' });
  assert(noTokenRes.status === 401, 'Missing token header returns 401 Unauthorized');

  // 8c. Expired token
  const expiredToken = jwt.sign(
    { userId: activeUserId, email: testEmail, name: testName, role: 'QA Tester' },
    jwtSecret,
    { expiresIn: '0s' } as any
  );
  // Wait 50ms so token is definitively in the past
  await new Promise(r => setTimeout(r, 50));
  const expRes = await api('/api/auth/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${expiredToken}` }
  });
  assert(expRes.status === 401, 'Expired token returns 401 Unauthorized');
  assert(expRes.data?.error?.includes('expired'), 'Session expired error message returned');

  // --------------------------------------------------------------------------
  // TEST 9: Password hashes never appear in API responses
  // --------------------------------------------------------------------------
  console.log('\n--- Running Test 9: Password hashes never appear in API responses ---');
  const responsesToCheck = [regRes.data, loginRes.data, meRes.data];
  let leakDetected = false;
  for (const resp of responsesToCheck) {
    const str = JSON.stringify(resp);
    if (str.includes('passwordHash') || str.includes('$2a$') || str.includes('$2b$')) {
      leakDetected = true;
    }
    if (resp?.user?.passwordHash !== undefined || resp?.user?.password !== undefined) {
      leakDetected = true;
    }
  }
  assert(!leakDetected, 'Zero password hashes or plain passwords present in register, login, or me responses');

  // --------------------------------------------------------------------------
  // TEST 10: Existing project APIs continue working unchanged
  // --------------------------------------------------------------------------
  console.log('\n--- Running Test 10: Existing project APIs continue working unchanged ---');
  const getProjRes = await api('/api/projects', {
    headers: { Authorization: `Bearer ${activeToken}` }
  });
  assert(getProjRes.status === 200, 'GET /api/projects returns 200');
  assert(Array.isArray(getProjRes.data), 'GET /api/projects returns array');

  const createProjRes = await api('/api/projects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${activeToken}` },
    body: JSON.stringify({ name: 'Regression Sanity Project', type: 'Web Application' })
  });
  assert(createProjRes.status === 201, 'POST /api/projects creates project with 201 Created');
  const createdProjId = createProjRes.data?.id;

  if (createdProjId) {
    const delProjRes = await api(`/api/projects/${createdProjId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${activeToken}` }
    });
    assert(delProjRes.status === 200, 'DELETE /api/projects/:id cleans up project');
  }

  // --------------------------------------------------------------------------
  // TEST 11: Fail securely if JWT_SECRET is missing
  // --------------------------------------------------------------------------
  console.log('\n--- Running Test 11: Fail securely if JWT_SECRET is missing ---');
  const originalSecret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  const noSecretRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: testEmail, password: testPassword })
  });
  assert(noSecretRes.status === 500, 'Returns 500 when JWT_SECRET is missing');
  assert(noSecretRes.data?.error?.includes('JWT_SECRET is missing'), 'Security error message indicates missing configuration');
  process.env.JWT_SECRET = originalSecret;

  // --------------------------------------------------------------------------
  // CLEANUP: Remove temporary test accounts
  // --------------------------------------------------------------------------
  console.log('\n[Cleanup] Deleting temporary verification accounts from database...');
  const deleteResult = await db.collection("users").deleteMany({ email: testEmail });
  console.log(`[Cleanup] Removed ${deleteResult.deletedCount} temporary test user(s) from collection`);

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDatabase();
  await client.close();
  await mongod.stop();
  console.log('[Cleanup] Stopped MongoDB instance and test HTTP server.\n');

  console.log('============================================================');
  console.log(`VERIFICATION COMPLETE: ${passCount} / ${testCount} assertions passed.`);
  console.log('============================================================');

  if (passCount !== testCount) {
    process.exit(1);
  }
}

runVerification().catch(err => {
  console.error('Verification error:', err);
  process.exit(1);
});
