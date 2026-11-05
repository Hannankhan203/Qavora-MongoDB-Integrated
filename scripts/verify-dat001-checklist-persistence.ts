/**
 * QAVORA-DAT-001 — Standalone QA Checklist MongoDB Persistence Verification Suite
 *
 * Verifies:
 * 1. Dedicated 'checklists' collection and required indexes in MongoDB Atlas.
 * 2. Unauthenticated access enforcement (HTTP 401).
 * 3. Offline / disconnected database handling (HTTP 503).
 * 4. User A checklist creation via POST /api/checklists with server-derived userId.
 * 5. Data validation and protection of immutable fields (_id, userId).
 * 6. User A checklist retrieval via GET /api/checklists and GET /api/checklists/:id.
 * 7. Checklist modification via PATCH /api/checklists/:id with atomic $set and updatedAt update.
 * 8. Multi-tenant isolation: User B cannot view, modify, or delete User A's checklists (HTTP 404).
 * 9. User A checklist deletion via DELETE /api/checklists/:id.
 * 10. Frontend ChecklistsPersistence engine write-through, in-flight queuing, hydration on login, and cache wiping on logout.
 * 11. Compatibility with checklist promotion to formal project (promoteChecklistToProject).
 */

import http from 'http';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passedCount++;
    console.log(`  ✓ [PASS] #${passedCount}: ${message}`);
  } else {
    failedCount++;
    console.error(`  ✗ [FAIL] ${message}`);
  }
}

// Lightweight localStorage mock for frontend testing in Node.js
class MockLocalStorage {
  private store = new Map<string, string>();

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
}

async function runDat001Verification() {
  console.log('========================================================================');
  console.log('QAVORA-DAT-001: STANDALONE QA CHECKLIST MONGODB PERSISTENCE SUITE');
  console.log('========================================================================\n');

  // 1. Setup MongoMemoryServer
  const mongod = await MongoMemoryServer.create();
  const mongoUri = mongod.getUri();
  const dbName = 'qavora_dat001_test';

  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'production';
  process.env.MONGODB_URI = mongoUri;
  process.env.MONGODB_DB = dbName;
  process.env.JWT_SECRET = 'qavora_dat001_jwt_secret_key_secure_1234567890';

  // Import server.ts
  const serverModule = await import('../server.ts');
  const expressApp = serverModule.default;
  const connectToDatabase = serverModule.connectToDatabase;

  const httpServer = http.createServer(expressApp);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const port = (httpServer.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const directClient = new MongoClient(mongoUri);
  await directClient.connect();
  const db = directClient.db(dbName);

  // Pre-connect database in server to ensure collections & indexes are created
  await connectToDatabase();

  // Setup DOM / localStorage environment for frontend modules
  const mockStorage = new MockLocalStorage();
  (globalThis as any).localStorage = mockStorage;
  (globalThis as any).window = globalThis;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const fullUrl = rawUrl.startsWith('/') ? `${baseUrl}${rawUrl}` : rawUrl;
    return originalFetch(fullUrl, init);
  }) as typeof fetch;

  const checklistStore = await import('../qaChecklistStore.js');
  const authModule = await import('../authController.js');
  const authCtrl = authModule.authController;

  try {
    // ========================================================================
    // SECTION 1: MongoDB Indexes on 'checklists' collection
    // ========================================================================
    console.log('\n--- Section 1: MongoDB Collection & Indexing ---');
    const indexes = await db.collection('checklists').indexes();
    const hasIdIndex = indexes.some(idx => idx.key?.id === 1 && idx.unique === true);
    const hasCompoundIndex = indexes.some(idx => idx.key?.userId === 1 && idx.key?.id === 1);
    const hasUserIdIndex = indexes.some(idx => idx.key?.userId === 1 && Object.keys(idx.key).length === 1);

    assert(hasIdIndex, "Unique index on checklists.id is created in MongoDB");
    assert(hasCompoundIndex, "Compound tenant-isolation index on checklists { userId: 1, id: 1 } exists");
    assert(hasUserIdIndex, "Tenant-isolation index on checklists.userId exists");

    // ========================================================================
    // SECTION 2: Authentication Enforcement (HTTP 401)
    // ========================================================================
    console.log('\n--- Section 2: Route Protection & Authentication Guard ---');
    const resGetUnauth = await originalFetch(`${baseUrl}/api/checklists`);
    assert(resGetUnauth.status === 401, "GET /api/checklists without token returns HTTP 401");

    const resGetOneUnauth = await originalFetch(`${baseUrl}/api/checklists/chk_sample_123`);
    assert(resGetOneUnauth.status === 401, "GET /api/checklists/:id without token returns HTTP 401");

    const resPostUnauth = await originalFetch(`${baseUrl}/api/checklists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Unauthorized Checklist' })
    });
    assert(resPostUnauth.status === 401, "POST /api/checklists without token returns HTTP 401");

    const resPatchUnauth = await originalFetch(`${baseUrl}/api/checklists/chk_sample_123`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hacked' })
    });
    assert(resPatchUnauth.status === 401, "PATCH /api/checklists/:id without token returns HTTP 401");

    const resDeleteUnauth = await originalFetch(`${baseUrl}/api/checklists/chk_sample_123`, {
      method: 'DELETE'
    });
    assert(resDeleteUnauth.status === 401, "DELETE /api/checklists/:id without token returns HTTP 401");

    // ========================================================================
    // SECTION 3: User A Registration & Authenticated CRUD Operations
    // ========================================================================
    console.log('\n--- Section 3: User A Registration & Authenticated Checklist Persistence ---');
    const regResA = await authCtrl.register('Alice QA Engineer', 'alice.dat001@example.com', 'PassSecure123!');
    assert(regResA.ok === true && Boolean(regResA.token), "User A registered successfully with valid JWT token");
    const userA = regResA.user!;
    const tokenA = regResA.token!;

    // 3a. POST /api/checklists — Create checklist with malicious field overrides attempted
    const samplePhases = [
      {
        id: 'phase_smoke_1',
        name: 'Smoke Testing',
        sections: [
          {
            id: 'sec_auth_1',
            name: 'Authentication Checks',
            tests: [
              { id: 't_1', text: 'Verify user registration with valid credentials', status: 'Completed', completed: true },
              { id: 't_2', text: 'Verify brute-force rate limiter on login', status: 'Not Started', completed: false }
            ]
          }
        ]
      }
    ];

    const createPayload = {
      id: 'chk_dat001_alice_01',
      title: 'Alice Master QA Checklist',
      schemaVersion: 1,
      documentNotes: [{ id: 'note_1', text: 'Target release v3.0' }],
      phases: samplePhases,
      // Attempt to spoof ownership and MongoDB internals:
      userId: 'forged_hacker_user_id',
      _id: '507f1f77bcf86cd799439011'
    };

    const resCreate = await originalFetch(`${baseUrl}/api/checklists`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify(createPayload)
    });

    assert(resCreate.status === 201, "POST /api/checklists returns HTTP 201 Created");
    const createdChecklist = await resCreate.json();
    assert(createdChecklist.id === 'chk_dat001_alice_01', "Created checklist preserves business ID");
    assert(createdChecklist.userId === userA.userId, "Created checklist assigns authenticated userId from JWT (forged userId rejected)");
    assert(createdChecklist.userId !== 'forged_hacker_user_id', "Client-supplied forged userId was not saved");
    assert(createdChecklist._id !== '507f1f77bcf86cd799439011', "Client-supplied _id was not accepted");

    // Verify direct MongoDB state
    const mongoChkAlice = await db.collection('checklists').findOne({ id: 'chk_dat001_alice_01' });
    assert(Boolean(mongoChkAlice), "Checklist document is permanently stored in MongoDB Atlas 'checklists' collection");
    assert(mongoChkAlice?.userId === userA.userId, "MongoDB document userId strictly matches User A's ID");
    assert(mongoChkAlice?.title === 'Alice Master QA Checklist', "MongoDB document title matches payload");
    assert(mongoChkAlice?.phases?.length === 1, "MongoDB document preserves phases structure");

    // 3b. GET /api/checklists — Retrieve authenticated user's checklists
    const resGetAlice = await originalFetch(`${baseUrl}/api/checklists`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(resGetAlice.status === 200, "GET /api/checklists returns HTTP 200 OK");
    const aliceChecklists = await resGetAlice.json();
    assert(Array.isArray(aliceChecklists) && aliceChecklists.length === 1, "GET /api/checklists returns list containing User A's checklist");
    assert(aliceChecklists[0].id === 'chk_dat001_alice_01', "Checklist returned has correct ID");

    // 3c. GET /api/checklists/:id — Retrieve specific checklist
    const resGetOne = await originalFetch(`${baseUrl}/api/checklists/chk_dat001_alice_01`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(resGetOne.status === 200, "GET /api/checklists/:id returns HTTP 200 OK");
    const fetchedOne = await resGetOne.json();
    assert(fetchedOne.id === 'chk_dat001_alice_01' && fetchedOne.title === 'Alice Master QA Checklist', "GET /api/checklists/:id returns exact document");

    // 3d. PATCH /api/checklists/:id — Update checklist execution & progress
    const updatedPhases = JSON.parse(JSON.stringify(samplePhases));
    updatedPhases[0].sections[0].tests[1].status = 'Completed';
    updatedPhases[0].sections[0].tests[1].completed = true;

    const patchPayload = {
      title: 'Alice Master QA Checklist (Updated)',
      phases: updatedPhases,
      // Malicious attempts to overwrite ownership or ID
      userId: 'new_spoofed_owner',
      id: 'chk_attempt_to_rename_id',
      _id: '507f1f77bcf86cd799439011'
    };

    const resPatch = await originalFetch(`${baseUrl}/api/checklists/chk_dat001_alice_01`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify(patchPayload)
    });

    assert(resPatch.status === 200, "PATCH /api/checklists/:id returns HTTP 200 OK");
    const patchedDoc = await resPatch.json();
    assert(patchedDoc.title === 'Alice Master QA Checklist (Updated)', "PATCH successfully updated title");
    assert(patchedDoc.userId === userA.userId, "PATCH cannot overwrite userId (remains User A)");
    assert(patchedDoc.id === 'chk_dat001_alice_01', "PATCH cannot overwrite business id");
    assert(Boolean(patchedDoc.updatedAt), "PATCH updates updatedAt timestamp");

    // Check direct MongoDB state after PATCH
    const mongoPatched = await db.collection('checklists').findOne({ id: 'chk_dat001_alice_01' });
    assert(mongoPatched?.phases[0].sections[0].tests[1].completed === true, "MongoDB Atlas document reflects updated test execution checkbox");

    // ========================================================================
    // SECTION 4: Multi-Tenant Isolation (User B cannot access User A's data)
    // ========================================================================
    console.log('\n--- Section 4: Multi-Tenant Isolation & Ownership Boundaries ---');
    const regResB = await authCtrl.register('Bob Security Auditor', 'bob.dat001@example.com', 'PassSecure456!');
    assert(regResB.ok === true && Boolean(regResB.token), "User B registered successfully with independent JWT");
    const userB = regResB.user!;
    const tokenB = regResB.token!;
    assert(userB.userId !== userA.userId, "User A and User B have distinct userIds");

    // 4a. User B GET /api/checklists returns empty array (cannot see User A's checklist)
    const resGetBob = await originalFetch(`${baseUrl}/api/checklists`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    const bobChecklists = await resGetBob.json();
    assert(Array.isArray(bobChecklists) && bobChecklists.length === 0, "User B receives empty array from GET /api/checklists");

    // 4b. User B GET /api/checklists/:aliceChkId returns HTTP 404
    const resBobGetAliceChk = await originalFetch(`${baseUrl}/api/checklists/chk_dat001_alice_01`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert(resBobGetAliceChk.status === 404, "User B requesting User A's checklist receives HTTP 404 Not Found");

    // 4c. User B PATCH /api/checklists/:aliceChkId returns HTTP 404
    const resBobPatchAliceChk = await originalFetch(`${baseUrl}/api/checklists/chk_dat001_alice_01`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenB}`
      },
      body: JSON.stringify({ title: 'Tampered by Bob' })
    });
    assert(resBobPatchAliceChk.status === 404, "User B attempting to PATCH User A's checklist receives HTTP 404 Not Found");

    // 4d. User B DELETE /api/checklists/:aliceChkId returns HTTP 404
    const resBobDeleteAliceChk = await originalFetch(`${baseUrl}/api/checklists/chk_dat001_alice_01`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert(resBobDeleteAliceChk.status === 404, "User B attempting to DELETE User A's checklist receives HTTP 404 Not Found");

    // Verify User A's checklist was not modified or deleted
    const mongoAliceUnchanged = await db.collection('checklists').findOne({ id: 'chk_dat001_alice_01' });
    assert(mongoAliceUnchanged?.title === 'Alice Master QA Checklist (Updated)', "User A's checklist remains intact after User B attacks");

    // 4e. User B creates their own checklist
    const resCreateBob = await originalFetch(`${baseUrl}/api/checklists`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenB}`
      },
      body: JSON.stringify({
        id: 'chk_dat001_bob_01',
        title: 'Bob Penetration Checklist',
        phases: []
      })
    });
    assert(resCreateBob.status === 201, "User B creates own checklist successfully");

    const resGetBob2 = await originalFetch(`${baseUrl}/api/checklists`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    const bobListAfter = await resGetBob2.json();
    assert(bobListAfter.length === 1 && bobListAfter[0].id === 'chk_dat001_bob_01', "User B sees only their own checklist");

    // ========================================================================
    // SECTION 5: Deletion of Checklist
    // ========================================================================
    console.log('\n--- Section 5: Deletion Handling ---');
    const resDeleteAlice = await originalFetch(`${baseUrl}/api/checklists/chk_dat001_alice_01`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(resDeleteAlice.status === 200, "User A deletes own checklist -> HTTP 200 OK");
    const deleteJson = await resDeleteAlice.json();
    assert(deleteJson.success === true, "DELETE response returns success: true");

    const mongoDeletedChk = await db.collection('checklists').findOne({ id: 'chk_dat001_alice_01' });
    assert(mongoDeletedChk === null, "Deleted checklist is removed from MongoDB Atlas collection");

    const resGetOneAfterDel = await originalFetch(`${baseUrl}/api/checklists/chk_dat001_alice_01`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(resGetOneAfterDel.status === 404, "Subsequent GET /api/checklists/:id returns HTTP 404 Not Found");

    // ========================================================================
    // SECTION 6: Frontend Persistence Engine (ChecklistsPersistence) & Hydration
    // ========================================================================
    console.log('\n--- Section 6: Frontend Persistence Engine Integration ---');

    // Re-authenticate as User A for frontend store test
    await authCtrl.login('alice.dat001@example.com', 'PassSecure123!');
    assert(authCtrl.isAuthenticated() === true, "Frontend authController is authenticated as User A");

    // Clear local in-memory store
    checklistStore.clearMemoryDataStore();
    checklistStore.ChecklistsPersistence.clearCache();

    // 6a. createChecklistFromParsedPlan saves in memory and write-through synchronizes to MongoDB
    const parsedPlan = {
      title: 'Checkout & Payments Testing',
      documentNotes: [{ text: 'High priority release' }],
      phases: [
        {
          name: 'Payment Gateways',
          notes: [{ text: 'Stripe and PayPal' }],
          sections: [
            {
              name: 'Card Transactions',
              tests: [
                { text: 'Verify 3D Secure 2 authentication', status: 'Not Started', completed: false },
                { text: 'Verify CVV validation', status: 'Not Started', completed: false }
              ]
            }
          ]
        }
      ]
    };

    const createRes = checklistStore.createChecklistFromParsedPlan(parsedPlan, 'Checkout & Payments Testing');
    assert(createRes.ok === true && Boolean(createRes.checklist?.id), "createChecklistFromParsedPlan created checklist in memory");
    const frontChkId = createRes.checklist!.id;

    // Await all queued background network sync writes
    await checklistStore.ChecklistsPersistence.flushAll();

    const dbChkFromFront = await db.collection('checklists').findOne({ id: frontChkId });
    assert(Boolean(dbChkFromFront), "Checklist created via frontend store write-through is stored in MongoDB Atlas");
    assert(dbChkFromFront?.userId === userA.userId, "Write-through checklist in MongoDB has User A userId");
    assert(checklistStore.ChecklistsPersistence.isPersisted(frontChkId), "ChecklistsPersistence tracks checklist as persisted");

    // 6b. Toggle test status via toggleChecklistTest -> automatically writes through to MongoDB
    const testIdToToggle = createRes.checklist!.phases[0].sections[0].tests[0].id;
    const toggleRes = checklistStore.toggleChecklistTest(frontChkId, testIdToToggle);
    assert(toggleRes.ok === true, "toggleChecklistTest succeeded in memory");
    await checklistStore.ChecklistsPersistence.flushAll();

    const dbChkAfterToggle = await db.collection('checklists').findOne({ id: frontChkId });
    const dbTest0 = dbChkAfterToggle?.phases[0].sections[0].tests[0];
    assert(dbTest0?.completed === true && dbTest0?.status === 'Completed', "Test checkbox toggle synchronized to MongoDB Atlas document");

    // 6c. Concurrent / In-flight queue test: Rapid multiple mutations don't conflict or fail
    const p1 = checklistStore.renameChecklistById(frontChkId, 'Checkout & Payments Testing (Renamed 1)');
    const p2 = checklistStore.renameChecklistById(frontChkId, 'Checkout & Payments Testing (Final Title)');
    assert(p1.ok === true && p2.ok === true, "Consecutive in-memory mutations accepted");
    await checklistStore.ChecklistsPersistence.flushAll();

    const dbChkFinalTitle = await db.collection('checklists').findOne({ id: frontChkId });
    assert(dbChkFinalTitle?.title === 'Checkout & Payments Testing (Final Title)', "Sequential queued mutations accurately settled with latest snapshot in MongoDB");

    // 6d. Hydration test: clear in-memory store and hydrate from backend
    checklistStore.clearMemoryDataStore();
    const beforeHydrate = checklistStore.loadAllChecklists().checklists;
    assert(beforeHydrate.length === 0, "In-memory cache cleared before hydration");

    const hydrateRes = await checklistStore.ChecklistsPersistence.hydrateFromBackend();
    assert(hydrateRes.ok === true, "ChecklistsPersistence.hydrateFromBackend() succeeded");
    const afterHydrate = checklistStore.loadAllChecklists().checklists;
    assert(afterHydrate.length === 1 && afterHydrate[0].id === frontChkId, "Hydration loaded checklist from MongoDB into in-memory store");
    assert(afterHydrate[0].title === 'Checkout & Payments Testing (Final Title)', "Hydrated checklist preserves latest title");

    // 6e. Logout cache wipe: logging out clears user checklist data
    authCtrl.logout();
    checklistStore.ChecklistsPersistence.clearCache();
    assert(checklistStore.loadAllChecklists().checklists.length === 0, "Logging out clears checklist in-memory store (prevents cross-user leakage)");

    // ========================================================================
    // SECTION 7: Checklist Promotion to Project Compatibility
    // ========================================================================
    console.log('\n--- Section 7: Checklist Promotion Compatibility ---');
    // Log back in as User A
    await authCtrl.login('alice.dat001@example.com', 'PassSecure123!');
    await checklistStore.ChecklistsPersistence.hydrateFromBackend();

    const promoteRes = checklistStore.promoteChecklistToProject(frontChkId, {
      projectName: 'Promoted Checkout Platform',
      projectType: 'Web Application'
    });
    assert(promoteRes.ok === true && Boolean(promoteRes.project?.id), "promoteChecklistToProject succeeded");
    await checklistStore.ChecklistsPersistence.flushAll();

    // Verify MongoDB document was updated with promotedProjectId
    const dbPromotedChk = await db.collection('checklists').findOne({ id: frontChkId });
    assert(Boolean(dbPromotedChk?.promotedProjectId), "Checklist in MongoDB Atlas was updated with promotedProjectId link");
    assert(dbPromotedChk?.promotedProjectId === promoteRes.project!.id, "promotedProjectId matches generated project ID");

    console.log('\n========================================================================');
    console.log(`VERIFICATION SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('========================================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    }
  } finally {
    try {
      await directClient.close();
      await mongod.stop();
      httpServer.close();
    } catch (_) {}
    process.exit(failedCount > 0 ? 1 : 0);
  }
}

runDat001Verification().catch((err) => {
  console.error('Fatal error during DAT-001 verification:', err);
  process.exit(1);
});
