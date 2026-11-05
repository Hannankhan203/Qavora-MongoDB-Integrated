import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import http from 'http';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    name: string;
    role: string;
  };
}

async function runStep3Verification() {
  console.log('============================================================');
  console.log('PHASE 4 - STEP 3: ROUTE PROTECTION & USER ISOLATION VERIFICATION');
  console.log('============================================================\n');

  // 1. Spin up an in-process MongoDB instance
  console.log('[Setup] Launching local MongoDB instance...');
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  const dbName = 'qavora_step3_verify';
  const jwtSecret = 'qavora_step3_jwt_secret_key_9876543210_secure';
  process.env.JWT_SECRET = jwtSecret;

  const client = new MongoClient(uri);
  await client.connect();
  let db: any = client.db(dbName);
  console.log(`[Setup] Connected to MongoDB at ${uri} (db: ${dbName})`);

  // Create indexes as implemented in server.ts
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("users").createIndex({ userId: 1 }, { unique: true });
  await db.collection("projects").createIndex({ id: 1 }, { unique: true });
  await db.collection("projects").createIndex({ userId: 1, id: 1 });
  await db.collection("projects").createIndex({ userId: 1, status: 1 });
  await db.collection("projects").createIndex({ userId: 1 });
  await db.collection("tests").createIndex({ userId: 1 });
  console.log('[Setup] Created all required indexes on users, projects, and tests.\n');

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

  // Mount actual server.ts app on ephemeral HTTP port
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as any).port;
  const BASE = `http://127.0.0.1:${port}`;

  let ipCounter = 1;
  async function api(path: string, options: any = {}) {
    const { headers, ...restOptions } = options;
    const res = await fetch(`${BASE}${path}`, {
      ...restOptions,
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': `198.51.100.${ipCounter++}`,
        ...(headers || {})
      }
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }


  let testCount = 0;
  let passCount = 0;

  function assert(condition: boolean, name: string, detail?: string) {
    testCount++;
    if (condition) {
      passCount++;
      console.log(`  ✓ [PASS] #${testCount}: ${name}`);
    } else {
      console.error(`  ✗ [FAIL] #${testCount}: ${name} ${detail ? `(${detail})` : ''}`);
    }
  }

  // --- Step 3 Test Scenarios ---

  // Register User A & User B
  console.log('\n--- Scenario 1: Setup Users A and B ---');
  const regUserARes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Alice QA', email: 'alice@qavora.com', password: 'Password123!' })
  });
  assert(regUserARes.status === 201, 'User A registered with 201 Created');
  const tokenA = regUserARes.data?.token;
  const userAId = regUserARes.data?.user?.userId;

  const regUserBRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Bob Tester', email: 'bob@qavora.com', password: 'Password123!' })
  });
  assert(regUserBRes.status === 201, 'User B registered with 201 Created');
  const tokenB = regUserBRes.data?.token;
  const userBId = regUserBRes.data?.user?.userId;

  // Scenario 2: Unauthenticated requests rejected with 401
  console.log('\n--- Scenario 2: Unauthenticated Requests Rejected (HTTP 401) ---');
  const unauthGetRes = await api('/api/projects');
  assert(unauthGetRes.status === 401, 'GET /api/projects without token returns 401');

  const unauthGetOneRes = await api('/api/projects/proj_fake');
  assert(unauthGetOneRes.status === 401, 'GET /api/projects/:id without token returns 401');

  const unauthPostRes = await api('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'Hacked Project' })
  });
  assert(unauthPostRes.status === 401, 'POST /api/projects without token returns 401');

  const unauthPutRes = await api('/api/projects/proj_fake', {
    method: 'PUT',
    body: JSON.stringify({ name: 'Updated Name' })
  });
  assert(unauthPutRes.status === 401, 'PUT /api/projects/:id without token returns 401');

  const unauthPatchDataRes = await api('/api/projects/proj_fake/data', {
    method: 'PATCH',
    body: JSON.stringify({ name: 'Patch Data' })
  });
  assert(unauthPatchDataRes.status === 401, 'PATCH /api/projects/:id/data without token returns 401');

  const unauthPatchStatusRes = await api('/api/projects/proj_fake/status', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'Completed' })
  });
  assert(unauthPatchStatusRes.status === 401, 'PATCH /api/projects/:id/status without token returns 401');

  const unauthDelRes = await api('/api/projects/proj_fake', { method: 'DELETE' });
  assert(unauthDelRes.status === 401, 'DELETE /api/projects/:id without token returns 401');

  const unauthSyncRes = await api('/api/projects/sync-local', {
    method: 'POST',
    body: JSON.stringify({ projects: [] })
  });
  assert(unauthSyncRes.status === 401, 'POST /api/projects/sync-local without token returns 401');

  // Scenario 3: Invalid and Expired Tokens Rejected with 401
  console.log('\n--- Scenario 3: Invalid and Expired Tokens Rejected (HTTP 401) ---');
  const invalidTokenRes = await api('/api/projects', {
    headers: { Authorization: 'Bearer totally.invalid.signature' }
  });
  assert(invalidTokenRes.status === 401, 'Invalid signature returns 401');

  const expiredToken = jwt.sign(
    { userId: userAId, email: 'alice@qavora.com', name: 'Alice QA', role: 'QA Tester' },
    jwtSecret,
    { expiresIn: '0s' } as any
  );
  await new Promise(r => setTimeout(r, 60));
  const expTokenRes = await api('/api/projects', {
    headers: { Authorization: `Bearer ${expiredToken}` }
  });
  assert(expTokenRes.status === 401, 'Expired token returns 401');
  assert(expTokenRes.data?.error?.includes('expired') || expTokenRes.data?.error?.includes('invalid'), 'Clear session expiry/invalid message');

  // Scenario 4: User A creates their own projects
  console.log('\n--- Scenario 4: User A creates and retrieves their own projects ---');
  const createA1Res = await api('/api/projects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ name: "Alice Alpha App", type: "Web Application" })
  });
  console.log('DEBUG createA1Res status:', createA1Res.status, 'data:', createA1Res.data);
  assert(createA1Res.status === 201, 'User A project 1 created');
  const projA1Id = createA1Res.data?.id;
  assert(createA1Res.data?.userId === userAId, 'Created project is tagged with User A userId');

  const createA2Res = await api('/api/projects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ name: "Alice Beta Service", type: "API / Microservice" })
  });
  assert(createA2Res.status === 201, 'User A project 2 created');
  const projA2Id = createA2Res.data?.id;

  // User B creates their own project
  const createB1Res = await api('/api/projects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({ name: "Bob Confidential Tool", type: "Mobile Application" })
  });
  assert(createB1Res.status === 201, 'User B project created');
  const projB1Id = createB1Res.data?.id;
  assert(createB1Res.data?.userId === userBId, 'Created project is tagged with User B userId');

  // Scenario 5: User Data Isolation - List Scoping
  console.log('\n--- Scenario 5: User Data Isolation (List Scoping) ---');
  const listARes = await api('/api/projects', {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert(listARes.status === 200, 'User A can query project list');
  const listAIds = (listARes.data || []).map((p: any) => p.id);
  assert(listAIds.includes(projA1Id), 'User A list includes Alice Alpha App');
  assert(listAIds.includes(projA2Id), 'User A list includes Alice Beta Service');
  assert(!listAIds.includes(projB1Id), "User A list DOES NOT include Bob Confidential Tool");

  const listBRes = await api('/api/projects', {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  const listBIds = (listBRes.data || []).map((p: any) => p.id);
  assert(listBIds.includes(projB1Id), 'User B list includes Bob Confidential Tool');
  assert(!listBIds.includes(projA1Id), "User B list DOES NOT include Alice Alpha App");
  assert(!listBIds.includes(projA2Id), "User B list DOES NOT include Alice Beta Service");

  // Scenario 6: User A cannot read User B's project (returns HTTP 404)
  console.log("\n--- Scenario 6: Cross-Tenant Access Protection (Read) ---");
  const getBbyARes = await api(`/api/projects/${projB1Id}`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert(getBbyARes.status === 404, "User A GET User B's project returns 404 Not Found (no ownership disclosure)");

  // Scenario 7: User A cannot update User B's project (returns HTTP 404)
  console.log("\n--- Scenario 7: Cross-Tenant Access Protection (Update / Delete) ---");
  const putBbyARes = await api(`/api/projects/${projB1Id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ name: "Hacked by Alice" })
  });
  assert(putBbyARes.status === 404, "User A PUT User B's project returns 404 Not Found");

  const patchStatusBbyARes = await api(`/api/projects/${projB1Id}/status`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ status: "Archived" })
  });
  assert(patchStatusBbyARes.status === 404, "User A PATCH status on User B's project returns 404 Not Found");

  const patchDataBbyARes = await api(`/api/projects/${projB1Id}/data`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ description: "Malicious update attempt" })
  });
  assert(patchDataBbyARes.status === 404, "User A PATCH data on User B's project returns 404 Not Found");

  const deleteBbyARes = await api(`/api/projects/${projB1Id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert(deleteBbyARes.status === 404, "User A DELETE User B's project returns 404 Not Found");

  // Verify User B's project is completely untouched
  const getBbyBRes = await api(`/api/projects/${projB1Id}`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert(getBbyBRes.status === 200, "User B can still retrieve their project intact");
  assert(getBbyBRes.data?.name === "Bob Confidential Tool", "Project name unchanged after attack attempt");

  // Scenario 8: Mass Assignment / Ownership Tampering Prevention
  console.log("\n--- Scenario 8: Prevent Ownership Tampering in Request Bodies ---");
  const spoofCreateRes = await api('/api/projects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      name: "Spoofed Ownership Project",
      userId: userBId // Attempt to create project owned by User B while authenticated as User A
    })
  });
  assert(spoofCreateRes.status === 201, "Project created successfully");
  assert(spoofCreateRes.data?.userId === userAId, "Server ignored incoming userId and stamped authenticated User A's identity");
  const spoofProjId = spoofCreateRes.data?.id;

  // Tamper attempt on PATCH /data
  const spoofPatchRes = await api(`/api/projects/${spoofProjId}/data`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      userId: userBId, // Attempt to transfer ownership to User B
      name: "Transferred Name"
    })
  });
  assert(spoofPatchRes.status === 200, "PATCH succeeded");
  // Inspect in DB to ensure userId was NOT overwritten
  const dbDoc = await db.collection("projects").findOne({ id: spoofProjId });
  assert(dbDoc?.userId === userAId, "Database record userId remains strictly User A (ownership cannot be transferred via payload)");

  // Scenario 9: Duplicate ID Conflict Handling (HTTP 409)
  console.log("\n--- Scenario 9: Duplicate ID Conflict Handling ---");
  const duplicateIdRes = await api('/api/projects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      id: projA1Id, // Same ID as already created
      name: "Duplicate ID Project"
    })
  });
  assert(duplicateIdRes.status === 409, "Duplicate project ID returns 409 Conflict");

  // Scenario 10: Deleted User Token Rejection (HTTP 401)
  console.log("\n--- Scenario 10: Deleted User Token Invalidation ---");
  // Create User C, get token, then delete User C from DB
  const regUserCRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Charlie Temp', email: 'charlie@qavora.com', password: 'Password123!' })
  });
  const tokenC = regUserCRes.data?.token;
  const userCId = regUserCRes.data?.user?.userId;

  // Confirm token works
  const meBeforeDel = await api('/api/auth/me', { headers: { Authorization: `Bearer ${tokenC}` } });
  assert(meBeforeDel.status === 200, "User C token valid before deletion");

  // Delete User C from MongoDB
  await db.collection("users").deleteOne({ userId: userCId });

  // Token now rejected because user no longer exists in DB
  const meAfterDel = await api('/api/auth/me', { headers: { Authorization: `Bearer ${tokenC}` } });
  assert(meAfterDel.status === 401, "Deleted user token returns 401 Unauthorized");
  assert(meAfterDel.data?.error?.includes('no longer exists'), "Clear error that user account no longer exists");

  const projAfterDel = await api('/api/projects', { headers: { Authorization: `Bearer ${tokenC}` } });
  assert(projAfterDel.status === 401, "Project access blocked with 401 for deleted user");

  // Scenario 11: Local Storage Sync Stamps Authenticated User
  console.log("\n--- Scenario 11: Sync Local Storage Isolation ---");
  const syncRes = await api('/api/projects/sync-local', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      projects: [
        { id: 'sync_proj_alpha', name: 'Offline Created Project', userId: 'spoofed_user_id' }
      ]
    })
  });
  assert(syncRes.status === 200, "Sync endpoint succeeded with 200 OK");
  const syncedDoc = await db.collection("projects").findOne({ id: 'sync_proj_alpha' });
  assert(syncedDoc?.userId === userAId, "Synced project correctly tagged with authenticated User A's ID");

  // Scenario 12: Database Offline Behavior (HTTP 503)
  console.log("\n--- Scenario 12: Database Offline Behavior (HTTP 503) ---");
  await closeDatabase();
  delete process.env.MONGODB_URI;
  const offlineGetRes = await api('/api/projects', { headers: { Authorization: `Bearer ${tokenA}` } });
  assert(offlineGetRes.status === 503, "Database offline returns 503 Service Unavailable");
  process.env.MONGODB_URI = uri;
  await connectToDatabase();

  // Clean up
  console.log('\n[Cleanup] Cleaning up test database and stopping server...');
  await closeDatabase();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await client.close();
  await mongod.stop();

  console.log('\n============================================================');
  console.log(`VERIFICATION COMPLETE: ${passCount} / ${testCount} assertions passed.`);
  console.log('============================================================\n');

  if (passCount !== testCount) {
    process.exit(1);
  }
}

runStep3Verification().catch(err => {
  console.error('Test runner failure:', err);
  process.exit(1);
});
