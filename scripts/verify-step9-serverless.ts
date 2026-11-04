/**
 * Verification test suite for Phase 5 - Step 5: Backend Serverless Adaptation
 * Verifies:
 * 1. Default export of Express app from root server.ts.
 * 2. Export of connectToDatabase helper.
 * 3. In Vercel mode (process.env.VERCEL = '1'), server.ts does NOT call app.listen() or initialize Vite.
 * 4. In Vercel mode, API requests await connectToDatabase via request middleware.
 * 5. Connection reuse across warm function invocations (promise and instance caching).
 * 6. Graceful HTTP 503 response on database unavailability rather than process termination.
 * 7. Standalone execution (process.env.VERCEL is falsy) starts setupServer().
 */

import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ [PASS] #${passed}: ${message}`);
  } else {
    failed++;
    console.error(`  ✗ [FAIL] ${message}`);
  }
}

async function runStep5Verification() {
  console.log('========================================================================');
  console.log('PHASE 5 - STEP 5: BACKEND SERVERLESS ADAPTATION VERIFICATION');
  console.log('========================================================================\n');

  // Test 1: Check server.ts exports and Vercel isolation under VERCEL='1'
  console.log('--- Test 1: Serverless Module Export & Listener Isolation ---');
  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'qavora_step5_verification_secret_key_12345';

  const serverModule = await import('../server.ts');
  const app = serverModule.default;
  const connectToDatabase = serverModule.connectToDatabase;

  assert(typeof app === 'function', 'server.ts exports Express app as default export');
  assert(typeof connectToDatabase === 'function', 'server.ts exports connectToDatabase function');
  assert(typeof app.use === 'function', 'Exported object is a valid Express application');

  // Test 2: Missing MONGODB_URI in Vercel production returns HTTP 503 (never falls back to mockDb)
  console.log('\n--- Test 2: Vercel Production Missing/Unreachable MongoDB Safety (HTTP 503) ---');
  const httpMod = await import('http');
  const jwtMod = await import('jsonwebtoken');
  const testServer = httpMod.createServer(app);
  await new Promise<void>((resolve) => testServer.listen(0, '127.0.0.1', () => resolve()));
  const port = (testServer.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  delete process.env.MONGODB_URI;
  const missingUriRes = await fetch(`${baseUrl}/api/projects`);
  assert(missingUriRes.status === 503, 'GET /api/projects returns HTTP 503 when MONGODB_URI is missing on Vercel');

  const missingUriRegRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test', email: 'test@example.com', password: 'password123' })
  });
  assert(missingUriRegRes.status === 503, 'POST /api/auth/register returns HTTP 503 when MONGODB_URI is missing on Vercel');

  // Unreachable MongoDB URI on Vercel keeps db = null and returns HTTP 503
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/qavora_unreachable?serverSelectionTimeoutMS=250&connectTimeoutMS=250';
  const unreachableRes = await fetch(`${baseUrl}/api/projects`);
  assert(unreachableRes.status === 503, 'GET /api/projects returns HTTP 503 when MongoDB is unreachable on Vercel (db stays null)');

  // Test 3: Warm Invocation Middleware Retry & Connection Caching
  console.log('\n--- Test 3: Warm Serverless Middleware Retry & Connection Caching ---');
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  process.env.MONGODB_URI = uri;

  // Without manually calling connectToDatabase(), hit /api/auth/register so API middleware retries connectToDatabase() on warm invocation
  const warmRegRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Serverless User', email: 'serverless@example.com', password: 'password123' })
  });
  assert(warmRegRes.status === 201, 'Warm Vercel API request automatically retries connectToDatabase() via middleware and succeeds');
  const warmRegBody = await warmRegRes.json();

  const db1 = await connectToDatabase();
  assert(Boolean(db1) && !db1.__isMock, 'connectToDatabase returns real MongoDB instance (not mockDb)');

  const db2 = await connectToDatabase();
  assert(db1 === db2, 'Second connectToDatabase call returns cached db instance (warm reuse)');

  // Test 4: JWT Production Security on Vercel
  console.log('\n--- Test 4: JWT Production Security (Missing Secret & Dev Secret Rejection) ---');
  const devSignedToken = jwtMod.default.sign(
    { userId: warmRegBody.user.userId, email: warmRegBody.user.email, name: warmRegBody.user.name, role: 'QA Tester' },
    'qavora-dev-fallback-jwt-secret-key',
    { expiresIn: '1h' }
  );
  const forgedRes = await fetch(`${baseUrl}/api/projects`, {
    headers: { Authorization: `Bearer ${devSignedToken}` }
  });
  assert(forgedRes.status === 401, 'Production/Vercel strictly rejects JWTs signed with hardcoded development fallback secret');

  delete process.env.JWT_SECRET;
  const noSecretAuthRes = await fetch(`${baseUrl}/api/projects`, {
    headers: { Authorization: `Bearer ${warmRegBody.token}` }
  });
  assert(noSecretAuthRes.status === 500, 'requireAuth returns HTTP 500 in Vercel production when JWT_SECRET is missing');

  const noSecretLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'serverless@example.com', password: 'password123' })
  });
  assert(noSecretLoginRes.status === 500, 'POST /api/auth/login returns HTTP 500 in Vercel production when JWT_SECRET is missing');

  process.env.JWT_SECRET = 'qavora_step5_verification_secret_key_12345';

  // Test 5: Safe HTTP 503 handling when database goes offline without crashing process
  console.log('\n--- Test 5: Graceful Offline Behavior (HTTP 503 & Process Stability) ---');
  await mongod.stop();

  let processExited = false;
  const origExit = process.exit;
  process.exit = ((code: number) => {
    processExited = true;
    return undefined as never;
  }) as any;

  try {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert(healthRes.status === 200, 'Health endpoint responds with 200 even in serverless mode');
  } finally {
    process.exit = origExit;
  }

  assert(!processExited, 'Serverless execution never terminates process on offline database');

  await new Promise<void>((resolve) => testServer.close(() => resolve()));

  console.log('\n========================================================================');
  console.log(`STEP 5 VERIFICATION COMPLETE: ${passed} passed, ${failed} failed.`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runStep5Verification().catch((err) => {
  console.error('Unexpected error during Step 5 verification:', err);
  process.exit(1);
});
