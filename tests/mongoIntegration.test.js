import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Safeguard: never allow integration tests to use production MONGODB_URI
if (process.env.MONGODB_TEST_URI && process.env.MONGODB_URI && process.env.MONGODB_TEST_URI === process.env.MONGODB_URI) {
  throw new Error('FATAL: MONGODB_TEST_URI must not match production MONGODB_URI.');
}

let mongod = null;
let testUri = process.env.MONGODB_TEST_URI?.trim();

if (!testUri) {
  mongod = await MongoMemoryServer.create();
  testUri = mongod.getUri();
}

process.env.VERCEL = '1';
process.env.MONGODB_URI = testUri;
process.env.MONGODB_DB = 'qavora_integration_test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-integration-tests-2026';

const { default: app } = await import('../server.ts');

let server;
let baseUrl;
let directClient;
let directDb;

test.before(async () => {
  directClient = new MongoClient(testUri);
  await directClient.connect();
  directDb = directClient.db('qavora_integration_test');
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.CORS_ORIGIN = baseUrl;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (directClient) {
    await directClient.close();
  }
  if (mongod) {
    await mongod.stop({ doCleanup: true, force: true });
  }
  process.exit(0);
});

function extractCookies(res) {
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const map = {};
  for (const raw of setCookie) {
    const [pair] = raw.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) {
      map[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }
  return map;
}

async function registerAndLogin(name, email, password, ip = '10.0.0.1') {
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl, 'X-Forwarded-For': ip },
    body: JSON.stringify({ name, email, password })
  });
  assert.equal(regRes.status, 201);
  const cookies = extractCookies(regRes);
  return {
    cookieHeader: `qavora_auth_token=${cookies.qavora_auth_token}; qavora_csrf_token=${cookies.qavora_csrf_token}`,
    authToken: cookies.qavora_auth_token,
    csrfToken: cookies.qavora_csrf_token
  };
}

test('MongoDB Integration: /api/health reports connected', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.database, 'connected');
});

test('Authentication: registration, duplicate rejection, login, invalid credentials, and unauthenticated/malformed token rejection', async () => {
  const email = 'auth_test@example.com';
  const password = 'StrongPassword123!';

  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl, 'X-Forwarded-For': '10.0.1.1' },
    body: JSON.stringify({ name: 'Auth User', email, password })
  });
  assert.equal(regRes.status, 201);

  const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl, 'X-Forwarded-For': '10.0.1.1' },
    body: JSON.stringify({ name: 'Auth User', email, password })
  });
  assert.equal(dupRes.status, 409);

  const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl, 'X-Forwarded-For': '10.0.1.1' },
    body: JSON.stringify({ email, password: 'WrongPassword!' })
  });
  assert.equal(badLogin.status, 401);

  const goodLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl, 'X-Forwarded-For': '10.0.1.1' },
    body: JSON.stringify({ email, password })
  });
  assert.equal(goodLogin.status, 200);

  const unauthRes = await fetch(`${baseUrl}/api/checklists`);
  assert.equal(unauthRes.status, 401);

  const malformedRes = await fetch(`${baseUrl}/api/checklists`, {
    headers: { Cookie: 'qavora_auth_token=malformed.jwt.token' }
  });
  assert.equal(malformedRes.status, 401);
});

test('Checklist CRUD & Tenant Isolation: user A checklists are isolated from user B', async () => {
  const userA = await registerAndLogin('User A', 'usera@example.com', 'Password123!', '10.0.2.1');
  const userB = await registerAndLogin('User B', 'userb@example.com', 'Password123!', '10.0.2.2');

  const createRes = await fetch(`${baseUrl}/api/checklists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: userA.cookieHeader,
      'X-CSRF-Token': userA.csrfToken
    },
    body: JSON.stringify({ title: 'User A Private Checklist', phases: [] })
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.ok(created.id);

  // User B cannot read, update, or delete User A's checklist
  const bGet = await fetch(`${baseUrl}/api/checklists/${created.id}`, {
    headers: { Cookie: userB.cookieHeader }
  });
  assert.equal(bGet.status, 404);

  const bPatch = await fetch(`${baseUrl}/api/checklists/${created.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: userB.cookieHeader,
      'X-CSRF-Token': userB.csrfToken
    },
    body: JSON.stringify({ title: 'Hacked' })
  });
  assert.equal(bPatch.status, 404);

  const bDelete = await fetch(`${baseUrl}/api/checklists/${created.id}`, {
    method: 'DELETE',
    headers: {
      Cookie: userB.cookieHeader,
      'X-CSRF-Token': userB.csrfToken
    }
  });
  assert.equal(bDelete.status, 404);

  // User A can update and delete their own checklist
  const aPatch = await fetch(`${baseUrl}/api/checklists/${created.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: userA.cookieHeader,
      'X-CSRF-Token': userA.csrfToken
    },
    body: JSON.stringify({ title: 'User A Updated' })
  });
  assert.equal(aPatch.status, 200);

  const aDelete = await fetch(`${baseUrl}/api/checklists/${created.id}`, {
    method: 'DELETE',
    headers: {
      Cookie: userA.cookieHeader,
      'X-CSRF-Token': userA.csrfToken
    }
  });
  assert.equal(aDelete.status, 200);
});

test('Rate Limiting: enforces 3/hr registration and 5/15m login limits per IP with IP isolation', async () => {
  const regIp = '10.0.3.1';
  for (let i = 1; i <= 3; i++) {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl, 'X-Forwarded-For': regIp },
      body: JSON.stringify({ name: `U${i}`, email: `rl_reg_${i}@example.com`, password: 'Password123!' })
    });
    assert.equal(res.status, 201);
  }
  const regBlocked = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl, 'X-Forwarded-For': regIp },
    body: JSON.stringify({ name: 'U4', email: 'rl_reg_4@example.com', password: 'Password123!' })
  });
  assert.equal(regBlocked.status, 429);

  const loginIp = '10.0.4.1';
  for (let i = 1; i <= 5; i++) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl, 'X-Forwarded-For': loginIp },
      body: JSON.stringify({ email: 'rl_reg_1@example.com', password: 'WrongPassword!' })
    });
    assert.equal(res.status, 401);
  }
  const loginBlocked = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl, 'X-Forwarded-For': loginIp },
    body: JSON.stringify({ email: 'rl_reg_1@example.com', password: 'WrongPassword!' })
  });
  assert.equal(loginBlocked.status, 429);

  // Different IP is isolated and not rate-limited
  const otherIpRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl, 'X-Forwarded-For': '10.0.4.2' },
    body: JSON.stringify({ email: 'rl_reg_1@example.com', password: 'Password123!' })
  });
  assert.equal(otherIpRes.status, 200);
});

test('CSRF Session Binding: rejects cross-session token reuse, tampered tokens, and cookie tossing', async () => {
  const userA = await registerAndLogin('CSRF A', 'csrfa@example.com', 'Password123!', '10.0.5.1');
  const userB = await registerAndLogin('CSRF B', 'csrfb@example.com', 'Password123!', '10.0.5.2');

  // 1. Cross-session reuse: User A's CSRF token paired with User B's auth cookie
  const userBAuthOnly = userB.cookieHeader.split(';')[0];
  const crossSessionRes = await fetch(`${baseUrl}/api/checklists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${userBAuthOnly}; qavora_csrf_token=${userA.csrfToken}`,
      'X-CSRF-Token': userA.csrfToken
    },
    body: JSON.stringify({ title: 'Cross-Session CSRF' })
  });
  assert.equal(crossSessionRes.status, 403);

  // 2. Sibling-subdomain cookie tossing: forged cookie + matching header
  const userAAuthOnly = userA.cookieHeader.split(';')[0];
  const tossedToken = 'a'.repeat(48) + '.' + 'b'.repeat(64);
  const tossedRes = await fetch(`${baseUrl}/api/checklists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${userAAuthOnly}; qavora_csrf_token=${tossedToken}`,
      'X-CSRF-Token': tossedToken
    },
    body: JSON.stringify({ title: 'Cookie Tossed' })
  });
  assert.equal(tossedRes.status, 403);

  // 3. Tampered signature
  const [nonce] = userA.csrfToken.split('.');
  const tamperedToken = `${nonce}.${'0'.repeat(64)}`;
  const tamperedRes = await fetch(`${baseUrl}/api/checklists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${userAAuthOnly}; qavora_csrf_token=${tamperedToken}`,
      'X-CSRF-Token': tamperedToken
    },
    body: JSON.stringify({ title: 'Tampered' })
  });
  assert.equal(tamperedRes.status, 403);

  // 4. QAV-AUDIT-003: Unauthenticated CSRF token request is rejected with 401 and no cookie
  const anonCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
  assert.equal(anonCsrfRes.status, 401);
  const anonCookies = extractCookies(anonCsrfRes);
  assert.equal(anonCookies.qavora_csrf_token, undefined, 'No CSRF cookie should be issued to unauthenticated requests');

  // 5. Duplicate CSRF cookies rejected
  const dupCookieRes = await fetch(`${baseUrl}/api/checklists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${userAAuthOnly}; qavora_csrf_token=${tossedToken}; qavora_csrf_token=${userA.csrfToken}`,
      'X-CSRF-Token': userA.csrfToken
    },
    body: JSON.stringify({ title: 'Duplicate Cookie' })
  });
  assert.equal(dupCookieRes.status, 403);

  // 6. Cross-origin, missing, empty, malformed, lookalike, and Host-manipulated Origin rejected
  const missingOriginLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'csrfa@example.com', password: 'Password123!' })
  });
  assert.equal(missingOriginLogin.status, 403);

  for (const badOrigin of ['', 'null', 'not-a-url', 'https://evil.example.com', 'http://sub.127.0.0.1', 'http://127.0.0.1.evil.com']) {
    const crossOriginLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: badOrigin
      },
      body: JSON.stringify({ email: 'csrfa@example.com', password: 'Password123!' })
    });
    assert.equal(crossOriginLogin.status, 403);
  }

  // Manipulated Host + X-Forwarded-Host cannot expand trusted origins
  const hostManipulated = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Host: 'evil.example.com',
      'X-Forwarded-Host': 'evil.example.com',
      Origin: 'https://evil.example.com'
    },
    body: JSON.stringify({ email: 'csrfa@example.com', password: 'Password123!' })
  });
  assert.equal(hostManipulated.status, 403);

  // 7. Logout clears auth & CSRF cookies and invalidates old CSRF token when session changes
  const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: {
      Cookie: userA.cookieHeader,
      'X-CSRF-Token': userA.csrfToken
    }
  });
  assert.equal(logoutRes.status, 200);
  const logoutSetCookies = logoutRes.headers.getSetCookie ? logoutRes.headers.getSetCookie().join('; ') : '';
  assert.match(logoutSetCookies, /qavora_auth_token=;/);
  assert.match(logoutSetCookies, /qavora_csrf_token=;/);
});

test('QAV-AUDIT-001: NoSQL operator injection and prototype pollution protection on POST and PATCH /api/checklists', async () => {
  const user1 = await registerAndLogin('Audit User 1', 'audit1@example.com', 'Password123!', '10.0.6.1');
  const user2 = await registerAndLogin('Audit User 2', 'audit2@example.com', 'Password123!', '10.0.6.2');

  const headers1 = {
    'Content-Type': 'application/json',
    Cookie: user1.cookieHeader,
    'X-CSRF-Token': user1.csrfToken
  };

  const headers2 = {
    'Content-Type': 'application/json',
    Cookie: user2.cookieHeader,
    'X-CSRF-Token': user2.csrfToken
  };

  // 1. Create a legitimate baseline checklist for User 1
  const baselineRes = await fetch(`${baseUrl}/api/checklists`, {
    method: 'POST',
    headers: headers1,
    body: JSON.stringify({
      title: 'Original Baseline Checklist',
      phases: [{ id: 'p1', name: 'Initial Phase' }]
    })
  });
  assert.equal(baselineRes.status, 201);
  const baseline = await baselineRes.json();
  const checklistId = baseline.id;
  assert.ok(checklistId);

  // Helper to assert database mutation did not happen to baseline
  const assertBaselineUnchanged = async () => {
    const checkRes = await fetch(`${baseUrl}/api/checklists/${checklistId}`, {
      headers: { Cookie: user1.cookieHeader }
    });
    assert.equal(checkRes.status, 200);
    const data = await checkRes.json();
    assert.equal(data.title, 'Original Baseline Checklist');
    assert.ok(data.userId);
    assert.equal(data.id, checklistId);
  };

  // Helper to get total checklists count for User 1
  const getUser1ChecklistCount = async () => {
    const listRes = await fetch(`${baseUrl}/api/checklists`, {
      headers: { Cookie: user1.cookieHeader }
    });
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    return list.length;
  };

  // 2. POST /api/checklists — Attack payloads must return HTTP 400 and create NO document
  const maliciousPostPayloads = [
    // $rename and $set operator keys
    JSON.stringify({ '$rename': { title: 'hacked_title' } }),
    JSON.stringify({ '$set': { admin: true } }),
    // $where key
    JSON.stringify({ '$where': 'sleep(5000)' }),
    // Dotted-path injection
    JSON.stringify({ 'phases.0.items.0.status': 'passed' }),
    // Nested MongoDB operator keys inside object/array
    JSON.stringify({ title: 'Bad', phases: [{ '$rename': { name: 'hacked' } }] }),
    JSON.stringify({ title: 'Bad', phases: [{ sections: [{ '$set': { status: 'passed' } }] }] }),
    JSON.stringify({ title: 'Bad', documentNotes: [{ '$where': '1 == 1' }] }),
    // Prototype pollution keys (transmitted as raw JSON)
    '{"title": "Proto", "__proto__": {"polluted": true}}',
    '{"title": "Proto", "constructor": {"prototype": {"polluted": true}}}',
    '{"title": "Proto", "prototype": {"polluted": true}}',
    // Dangerous keys inside arrays and deeply nested structures
    '{"title": "Deep", "phases": [{"sections": [{"tests": [{"__proto__": {"admin": true}}]}]}]}',
    '{"title": "Deep", "phases": [{"sections": [{"tests": [{"deep": {"$where": "sleep"}}]}]}]}',
    '{"title": "Deep", "phases": [{"sections": [{"tests": [{"deep": {"phases.0.bad": true}}]}]}]}',
    // Attempts to control or set server-controlled fields
    JSON.stringify({ title: 'Owned', userId: 'victim_user_id' }),
    JSON.stringify({ title: 'Owned', _id: '60b8d295f1d2b834b8e8f8a1' }),
    // Unrecognized / disallowed top-level fields
    JSON.stringify({ title: 'Extra', maliciousProperty: 'payload' })
  ];

  for (const rawPayload of maliciousPostPayloads) {
    const countBefore = await getUser1ChecklistCount();
    const res = await fetch(`${baseUrl}/api/checklists`, {
      method: 'POST',
      headers: headers1,
      body: rawPayload
    });
    assert.equal(res.status, 400, `POST should reject malicious payload with 400: ${rawPayload.substring(0, 60)}`);
    const body = await res.json();
    assert.ok(body.error, 'Should return error message');
    const countAfter = await getUser1ChecklistCount();
    assert.equal(countAfter, countBefore, 'Malicious POST must not insert document into database');
  }

  // 3. PATCH /api/checklists/:id — Attack payloads must return HTTP 400 and cause NO mutation
  const maliciousPatchPayloads = [
    // $rename and $set operator keys
    JSON.stringify({ '$rename': { title: 'hacked' } }),
    JSON.stringify({ '$set': { title: 'hacked' } }),
    // $where key
    JSON.stringify({ '$where': 'sleep(5000)' }),
    // Dotted-path injection
    JSON.stringify({ 'phases.0.items.0.status': 'hacked' }),
    // Nested operator keys
    JSON.stringify({ phases: [{ '$set': { status: 'hacked' } }] }),
    JSON.stringify({ documentNotes: [{ '$rename': { text: 'bad' } }] }),
    // Prototype pollution keys
    '{"__proto__": {"polluted": true}}',
    '{"constructor": {"prototype": {"polluted": true}}}',
    '{"prototype": {"polluted": true}}',
    // Deeply nested prohibited keys
    '{"phases": [{"sections": [{"__proto__": {"admin": true}}]}]}',
    '{"phases": [{"sections": [{"$set": { "admin": true }}]}]}',
    '{"phases": [{"sections": [{"tests": [{"sub.prop": 1}]}]}]}',
    // Attempts to modify server-controlled or immutable fields
    JSON.stringify({ userId: 'attacker_user_id' }),
    JSON.stringify({ _id: '60b8d295f1d2b834b8e8f8a1' }),
    JSON.stringify({ id: 'new_id_attempt' }),
    // Empty body or unrecognized fields
    JSON.stringify({}),
    JSON.stringify({ unapprovedField: 'value' })
  ];

  for (const rawPayload of maliciousPatchPayloads) {
    const res = await fetch(`${baseUrl}/api/checklists/${checklistId}`, {
      method: 'PATCH',
      headers: headers1,
      body: rawPayload
    });
    assert.equal(res.status, 400, `PATCH should reject malicious payload with 400: ${rawPayload.substring(0, 60)}`);
    const body = await res.json();
    assert.ok(body.error, 'Should return error message');
    await assertBaselineUnchanged();
  }

  // 4. Verify tenant isolation: User 2 cannot access or mutate User 1's checklist
  const u2Patch = await fetch(`${baseUrl}/api/checklists/${checklistId}`, {
    method: 'PATCH',
    headers: headers2,
    body: JSON.stringify({ title: 'Hacked by User 2' })
  });
  assert.equal(u2Patch.status, 404, 'User 2 should not be able to find or update User 1 checklist');
  await assertBaselineUnchanged();

  // 5. Verify legitimate operations with strings containing '$', '.', 'constructor', 'prototype'
  const legitPostRes = await fetch(`${baseUrl}/api/checklists`, {
    method: 'POST',
    headers: headers1,
    body: JSON.stringify({
      title: 'Valid Checklist: Cost is $100.00. Call constructor.prototype in text.',
      documentNotes: [{ text: 'Release v1.2 note: Price $25.50.' }],
      phases: [
        {
          name: 'Phase 1.0 — Smoke Testing',
          sections: [
            {
              type: 'category',
              name: 'Section 1.1',
              tests: [
                {
                  text: 'Verify pricing display shows $10.00 correctly.',
                  priority: 'High'
                }
              ]
            }
          ]
        }
      ]
    })
  });
  assert.equal(legitPostRes.status, 201, 'Legitimate checklist creation should succeed');
  const legitCreated = await legitPostRes.json();
  assert.ok(legitCreated.id);
  assert.equal(legitCreated.title, 'Valid Checklist: Cost is $100.00. Call constructor.prototype in text.');

  // Legitimate update on the newly created checklist
  const legitPatchRes = await fetch(`${baseUrl}/api/checklists/${legitCreated.id}`, {
    method: 'PATCH',
    headers: headers1,
    body: JSON.stringify({
      title: 'Updated Title: Price is now $150.00 (v2.0 constructor text).',
      phases: [
        {
          name: 'Updated Phase 2.0',
          sections: []
        }
      ]
    })
  });
  assert.equal(legitPatchRes.status, 200, 'Legitimate checklist update should succeed');
  const legitUpdated = await legitPatchRes.json();
  assert.equal(legitUpdated.title, 'Updated Title: Price is now $150.00 (v2.0 constructor text).');
  assert.equal(legitUpdated.phases.length, 1);
});

test('QAV-AUDIT-002: Optimistic concurrency control on PATCH /api/checklists/:id with expectedUpdatedAt', async () => {
  const { cookieHeader: cookie1, csrfToken: csrf1 } = await registerAndLogin(
    'OCC User 1',
    'occ1@example.com',
    'Password123!',
    '10.0.7.1'
  );
  const headers1 = {
    'Cookie': cookie1,
    'x-csrf-token': csrf1,
    'Content-Type': 'application/json'
  };

  const { cookieHeader: cookie2, csrfToken: csrf2 } = await registerAndLogin(
    'OCC User 2',
    'occ2@example.com',
    'Password123!',
    '10.0.7.2'
  );
  const headers2 = {
    'Cookie': cookie2,
    'x-csrf-token': csrf2,
    'Content-Type': 'application/json'
  };

  // 1. Create initial checklist
  const createRes = await fetch(`${baseUrl}/api/checklists`, {
    method: 'POST',
    headers: headers1,
    body: JSON.stringify({
      title: 'Initial Concurrent Checklist',
      phases: [
        {
          name: 'Phase 1',
          sections: [
            {
              name: 'Section 1',
              tests: [{ text: 'Test 1', status: 'Not Started', completed: false }]
            }
          ]
        }
      ]
    })
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  const v1UpdatedAt = created.updatedAt;
  assert.ok(v1UpdatedAt, 'Created checklist must have updatedAt');

  // 2. Successful UPDATE with matching expectedUpdatedAt
  const update1Res = await fetch(`${baseUrl}/api/checklists/${created.id}`, {
    method: 'PATCH',
    headers: headers1,
    body: JSON.stringify({
      title: 'Checklist Version 2',
      expectedUpdatedAt: v1UpdatedAt
    })
  });
  assert.equal(update1Res.status, 200, 'Valid expectedUpdatedAt must succeed');
  const v2 = await update1Res.json();
  const v2UpdatedAt = v2.updatedAt;
  assert.equal(v2.title, 'Checklist Version 2');
  assert.notEqual(v2UpdatedAt, v1UpdatedAt, 'updatedAt must advance after successful update');

  // 3. Stale UPDATE returning HTTP 409 Conflict
  const staleRes = await fetch(`${baseUrl}/api/checklists/${created.id}`, {
    method: 'PATCH',
    headers: headers1,
    body: JSON.stringify({
      title: 'Stale Attempt with V1',
      expectedUpdatedAt: v1UpdatedAt
    })
  });
  assert.equal(staleRes.status, 409, 'Stale expectedUpdatedAt must return HTTP 409 Conflict');
  const staleJson = await staleRes.json();
  assert.ok(staleJson.error.includes('Conflict'));
  assert.equal(staleJson.currentUpdatedAt, v2UpdatedAt);
  assert.equal(staleJson.expectedUpdatedAt, v1UpdatedAt);

  // Verify database was NOT mutated by stale update
  const getAfterStale = await fetch(`${baseUrl}/api/checklists/${created.id}`, {
    method: 'GET',
    headers: headers1
  });
  const currentChecklist = await getAfterStale.json();
  assert.equal(currentChecklist.title, 'Checklist Version 2', 'Newer server data must be preserved');
  assert.equal(currentChecklist.updatedAt, v2UpdatedAt);

  // 4. Two concurrent UPDATE requests with same expectedUpdatedAt — exactly one succeeds
  const [resA, resB] = await Promise.all([
    fetch(`${baseUrl}/api/checklists/${created.id}`, {
      method: 'PATCH',
      headers: headers1,
      body: JSON.stringify({
        title: 'Concurrent Winner A',
        expectedUpdatedAt: v2UpdatedAt
      })
    }),
    fetch(`${baseUrl}/api/checklists/${created.id}`, {
      method: 'PATCH',
      headers: headers1,
      body: JSON.stringify({
        title: 'Concurrent Winner B',
        expectedUpdatedAt: v2UpdatedAt
      })
    })
  ]);

  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [200, 409], 'Exactly one concurrent request must succeed (200) and one must conflict (409)');

  const winnerRes = resA.status === 200 ? resA : resB;
  const loserRes = resA.status === 409 ? resA : resB;
  const winnerData = await winnerRes.json();
  const loserData = await loserRes.json();

  assert.ok(loserData.error.includes('Conflict'));
  const v3UpdatedAt = winnerData.updatedAt;

  // 5. Delayed in-flight UPDATE arriving after newer updates cannot overwrite data
  const delayedRes = await fetch(`${baseUrl}/api/checklists/${created.id}`, {
    method: 'PATCH',
    headers: headers1,
    body: JSON.stringify({
      title: 'Delayed In-Flight Old Update',
      expectedUpdatedAt: v1UpdatedAt
    })
  });
  assert.equal(delayedRes.status, 409);
  const verifyUnchanged = await fetch(`${baseUrl}/api/checklists/${created.id}`, {
    headers: headers1
  });
  const currentDoc = await verifyUnchanged.json();
  assert.equal(currentDoc.title, winnerData.title, 'Delayed update must not overwrite newer server data');

  // 6. Tenant isolation: Other user cannot modify or probe version via 409
  const crossUserRes = await fetch(`${baseUrl}/api/checklists/${created.id}`, {
    method: 'PATCH',
    headers: headers2,
    body: JSON.stringify({
      title: 'Attacker update',
      expectedUpdatedAt: v3UpdatedAt
    })
  });
  assert.equal(crossUserRes.status, 404, 'Cross-user update must return 404 without leaking existence or concurrency');

  // 7. Validation: Empty or non-string expectedUpdatedAt is rejected safely with 400
  const emptyVersionRes = await fetch(`${baseUrl}/api/checklists/${created.id}`, {
    method: 'PATCH',
    headers: headers1,
    body: JSON.stringify({
      title: 'Bad version',
      expectedUpdatedAt: '   '
    })
  });
  assert.equal(emptyVersionRes.status, 400);

  // 8. Backward compatibility: updates without expectedUpdatedAt continue working
  const backwardCompatRes = await fetch(`${baseUrl}/api/checklists/${created.id}`, {
    method: 'PATCH',
    headers: headers1,
    body: JSON.stringify({
      title: 'Backward Compatible Update'
    })
  });
  assert.equal(backwardCompatRes.status, 200);
  const finalChecklist = await backwardCompatRes.json();
  assert.equal(finalChecklist.title, 'Backward Compatible Update');
});

test('QAV-AUDIT-003: Prevent Unauthenticated CSRF Token Issuance & enforce session-bound token refresh', async () => {
  // 1. Unauthenticated GET /api/auth/csrf returns HTTP 401 and no Set-Cookie containing CSRF cookie
  const unauthRes = await fetch(`${baseUrl}/api/auth/csrf`);
  assert.equal(unauthRes.status, 401);
  const unauthRawSetCookie = unauthRes.headers.get('set-cookie') || '';
  assert.equal(unauthRawSetCookie.includes('qavora_csrf_token='), false, 'No CSRF cookie should be in raw Set-Cookie header');
  assert.equal(unauthRawSetCookie.includes('__Host-qavora_csrf_token='), false, 'No __Host CSRF cookie should be in raw Set-Cookie header');
  const unauthCookies = extractCookies(unauthRes);
  assert.equal(unauthCookies.qavora_csrf_token, undefined, 'No CSRF cookie should be issued for unauthenticated requests');
  const unauthBody = await unauthRes.json();
  assert.ok(unauthBody.error, 'Error message expected for unauthenticated request');
  assert.equal(unauthBody.csrfToken, undefined, 'No csrfToken field should be returned');

  // 2. Missing, empty, and whitespace authentication cookies return 401 and no CSRF cookie
  for (const emptyVal of ['', '   ', '%20']) {
    const emptyRes = await fetch(`${baseUrl}/api/auth/csrf`, {
      headers: { Cookie: `qavora_auth_token=${emptyVal}` }
    });
    assert.equal(emptyRes.status, 401);
    const emptySetCookie = emptyRes.headers.get('set-cookie') || '';
    assert.equal(emptySetCookie.includes('csrf_token'), false, 'Empty auth token must not issue CSRF cookie');
  }

  // 3. Malformed authentication cookies return 401 and no CSRF cookie
  const malformedValues = [
    'not-even-a-jwt',
    'header.payload', // missing signature
    'header.payload.signature.extra',
    '!!!###$$$%%%'
  ];
  for (const malformed of malformedValues) {
    const malformedRes = await fetch(`${baseUrl}/api/auth/csrf`, {
      headers: { Cookie: `qavora_auth_token=${malformed}` }
    });
    assert.equal(malformedRes.status, 401);
    const malformedCookies = extractCookies(malformedRes);
    assert.equal(malformedCookies.qavora_csrf_token, undefined, 'Malformed auth token must not issue CSRF cookie');
  }

  // 4. JWT with invalid/primitive payload or missing userId returns 401 and no CSRF cookie
  const stringPayloadToken = jwt.sign('string-payload', process.env.JWT_SECRET);
  const stringPayloadRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Cookie: `qavora_auth_token=${stringPayloadToken}` }
  });
  assert.equal(stringPayloadRes.status, 401);
  assert.equal(extractCookies(stringPayloadRes).qavora_csrf_token, undefined);

  const missingUserIdToken = jwt.sign(
    { email: 'nouserid@example.com', name: 'No UserId', role: 'QA Tester' },
    process.env.JWT_SECRET
  );
  const missingUserIdRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Cookie: `qavora_auth_token=${missingUserIdToken}` }
  });
  assert.equal(missingUserIdRes.status, 401);
  assert.equal(extractCookies(missingUserIdRes).qavora_csrf_token, undefined);

  // 5. Invalid signature (signed with different secret) returns 401 and no CSRF cookie
  const wrongSecretToken = jwt.sign(
    { userId: 'usr_audit_fake', email: 'fake@example.com', name: 'Fake', role: 'QA Tester' },
    'completely-wrong-jwt-secret-key-999999'
  );
  const wrongSecretRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Cookie: `qavora_auth_token=${wrongSecretToken}` }
  });
  assert.equal(wrongSecretRes.status, 401);
  assert.equal(extractCookies(wrongSecretRes).qavora_csrf_token, undefined);

  // 6. Token with non-existent user in MongoDB returns 401 and no CSRF cookie
  const nonExistentUserToken = jwt.sign(
    { userId: 'usr_ghost_user_999999', email: 'ghost@example.com', name: 'Ghost', role: 'QA Tester' },
    process.env.JWT_SECRET
  );
  const nonExistentRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Cookie: `qavora_auth_token=${nonExistentUserToken}` }
  });
  assert.equal(nonExistentRes.status, 401);
  assert.equal(extractCookies(nonExistentRes).qavora_csrf_token, undefined);

  // 7. Expired JWT authentication cookie returns 401 and no CSRF cookie
  const expiredToken = jwt.sign(
    { userId: 'usr_audit_expired', email: 'expired@example.com', name: 'Expired', role: 'QA Tester' },
    process.env.JWT_SECRET,
    { expiresIn: -10 }
  );
  const expiredRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Cookie: `qavora_auth_token=${expiredToken}` }
  });
  assert.equal(expiredRes.status, 401);
  assert.equal(extractCookies(expiredRes).qavora_csrf_token, undefined);

  // 8. Revoked sessions return 401 and no CSRF cookie
  const revokedUser = await registerAndLogin('Revoked User', 'revoked_test@example.com', 'Password123!', '10.0.9.10');
  const decodedRevoked = jwt.decode(revokedUser.authToken);
  assert.ok(decodedRevoked?.userId);

  // 8a. User marked status: 'revoked'
  await directDb.collection('users').updateOne(
    { userId: decodedRevoked.userId },
    { $set: { status: 'revoked' } }
  );
  const revokedStatusRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Cookie: `qavora_auth_token=${revokedUser.authToken}` }
  });
  assert.equal(revokedStatusRes.status, 401, 'User with status: revoked must return 401');
  assert.equal(extractCookies(revokedStatusRes).qavora_csrf_token, undefined);

  // 8b. User marked revoked: true
  await directDb.collection('users').updateOne(
    { userId: decodedRevoked.userId },
    { $set: { status: 'active', revoked: true } }
  );
  const revokedFlagRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Cookie: `qavora_auth_token=${revokedUser.authToken}` }
  });
  assert.equal(revokedFlagRes.status, 401, 'User with revoked: true must return 401');
  assert.equal(extractCookies(revokedFlagRes).qavora_csrf_token, undefined);

  // 8c. Stale and edge-case tokenVersion validation
  await directDb.collection('users').updateOne(
    { userId: decodedRevoked.userId },
    { $set: { revoked: false, tokenVersion: 99 } }
  );
  const staleVersionRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Cookie: `qavora_auth_token=${revokedUser.authToken}` }
  });
  assert.equal(staleVersionRes.status, 401, 'Stale tokenVersion session must return 401');
  assert.equal(extractCookies(staleVersionRes).qavora_csrf_token, undefined);

  // Missing tokenVersion on session when DB version > 1 must return 401
  const missingVerToken = jwt.sign(
    { userId: decodedRevoked.userId, email: 'revoked_test@example.com', name: 'Revoked', role: 'QA Tester' },
    process.env.JWT_SECRET
  );
  const missingVerRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Cookie: `qavora_auth_token=${missingVerToken}` }
  });
  assert.equal(missingVerRes.status, 401, 'Missing tokenVersion when DB version > 1 must return 401');
  assert.equal(extractCookies(missingVerRes).qavora_csrf_token, undefined);

  // Null, string, negative, zero, and fractional tokenVersions must return 401
  for (const badVer of [null, '99', 'invalid', -1, 0, 1.5]) {
    const badVerToken = jwt.sign(
      { userId: decodedRevoked.userId, email: 'revoked_test@example.com', name: 'Revoked', role: 'QA Tester', tokenVersion: badVer },
      process.env.JWT_SECRET
    );
    const badVerRes = await fetch(`${baseUrl}/api/auth/csrf`, {
      headers: { Cookie: `qavora_auth_token=${badVerToken}` }
    });
    assert.equal(badVerRes.status, 401, `Non-integer/invalid tokenVersion (${badVer}) must return 401`);
    assert.equal(extractCookies(badVerRes).qavora_csrf_token, undefined);
  }

  // Malformed database tokenVersion (string "99") safely handled and rejects version 1
  await directDb.collection('users').updateOne(
    { userId: decodedRevoked.userId },
    { $set: { tokenVersion: '99' } }
  );
  const malformedDbVerRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Cookie: `qavora_auth_token=${revokedUser.authToken}` }
  });
  assert.equal(malformedDbVerRes.status, 401, 'Malformed DB tokenVersion string must still enforce revocation');
  assert.equal(extractCookies(malformedDbVerRes).qavora_csrf_token, undefined);

  // 8d. User deleted from database
  await directDb.collection('users').deleteOne({ userId: decodedRevoked.userId });
  const deletedUserRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Cookie: `qavora_auth_token=${revokedUser.authToken}` }
  });
  assert.equal(deletedUserRes.status, 401, 'Deleted user session must return 401');
  assert.equal(extractCookies(deletedUserRes).qavora_csrf_token, undefined);

  // 9. Duplicate cookies & cookie tossing on GET /api/auth/csrf return 401
  const userA = await registerAndLogin('Audit User A', 'audita@example.com', 'Password123!', '10.0.9.1');
  const userB = await registerAndLogin('Audit User B', 'auditb@example.com', 'Password123!', '10.0.9.2');

  const dupAuthRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Cookie: `qavora_auth_token=${userA.authToken}; qavora_auth_token=${userB.authToken}` }
  });
  assert.equal(dupAuthRes.status, 401, 'Duplicate auth cookies must return 401');
  assert.equal(extractCookies(dupAuthRes).qavora_csrf_token, undefined);

  const dupCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Cookie: `qavora_auth_token=${userA.authToken}; qavora_csrf_token=tok1; qavora_csrf_token=tok2` }
  });
  assert.equal(dupCsrfRes.status, 401, 'Duplicate CSRF cookies must return 401');
  assert.equal(extractCookies(dupCsrfRes).qavora_csrf_token, undefined);

  // 10. Authorization header without auth cookie returns 401 (CSRF cookie issuance strictly requires auth cookie)
  const bearerOnlyRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Authorization: `Bearer ${userA.authToken}` }
  });
  assert.equal(bearerOnlyRes.status, 401, 'Authorization header without cookie must return 401 on /api/auth/csrf');
  assert.equal(extractCookies(bearerOnlyRes).qavora_csrf_token, undefined);

  // 10b. Valid cookie with mismatched Bearer token returns 401
  const mismatchedBearerRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: {
      Cookie: `qavora_auth_token=${userA.authToken}`,
      Authorization: `Bearer ${userB.authToken}`
    }
  });
  assert.equal(mismatchedBearerRes.status, 401, 'Mismatched Bearer token and cookie must return 401');
  assert.equal(extractCookies(mismatchedBearerRes).qavora_csrf_token, undefined);

  // 11. Authenticated session receives valid session-bound CSRF token
  const authCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Cookie: `qavora_auth_token=${userA.authToken}` }
  });
  assert.equal(authCsrfRes.status, 200);
  const authCookies = extractCookies(authCsrfRes);
  assert.ok(authCookies.qavora_csrf_token, 'CSRF cookie should be issued for authenticated user');
  const authBody = await authCsrfRes.json();
  assert.equal(authBody.success, true);
  assert.equal(authBody.csrfToken, authCookies.qavora_csrf_token);

  // Verify HMAC-SHA256 signature format
  const [nonce, sig] = authBody.csrfToken.split('.');
  assert.ok(nonce && nonce.length === 48, 'Nonce must be 24 bytes hex (48 chars)');
  assert.ok(sig && sig.length === 64, 'HMAC-SHA256 signature must be 64 chars hex');

  // Verify cookie security attributes in raw Set-Cookie header
  const rawSetCookie = authCsrfRes.headers.get('set-cookie') || '';
  assert.match(rawSetCookie, /Path=\//i, 'Path must be /');
  assert.match(rawSetCookie, /SameSite=Lax/i, 'SameSite must be Lax');
  assert.equal(rawSetCookie.toLowerCase().includes('httponly'), false, 'CSRF cookie must be readable by client script');

  // 12. Refreshed token works on state-changing requests for the authenticated session
  const postRes = await fetch(`${baseUrl}/api/checklists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl,
      Cookie: `qavora_auth_token=${userA.authToken}; qavora_csrf_token=${authBody.csrfToken}`,
      'X-CSRF-Token': authBody.csrfToken
    },
    body: JSON.stringify({ title: 'Refreshed CSRF Token Checklist' })
  });
  assert.equal(postRes.status, 201);

  // 13. Token issued for user A is rejected if used with user B's session (session binding)
  const crossRes = await fetch(`${baseUrl}/api/checklists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl,
      Cookie: `qavora_auth_token=${userB.authToken}; qavora_csrf_token=${authBody.csrfToken}`,
      'X-CSRF-Token': authBody.csrfToken
    },
    body: JSON.stringify({ title: 'Cross User Exploit' })
  });
  assert.equal(crossRes.status, 403);

  // 14. Tampered signature and tampered nonce are rejected on state-changing requests
  const tamperedSigToken = `${nonce}.${'0'.repeat(64)}`;
  const tamperedSigRes = await fetch(`${baseUrl}/api/checklists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl,
      Cookie: `qavora_auth_token=${userA.authToken}; qavora_csrf_token=${tamperedSigToken}`,
      'X-CSRF-Token': tamperedSigToken
    },
    body: JSON.stringify({ title: 'Tampered Signature' })
  });
  assert.equal(tamperedSigRes.status, 403);

  // 15. Subsequent refresh issues a new valid token that remains bound
  const refresh2Res = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Cookie: `qavora_auth_token=${userA.authToken}` }
  });
  assert.equal(refresh2Res.status, 200);
  const refresh2Body = await refresh2Res.json();
  assert.notEqual(refresh2Body.csrfToken, authBody.csrfToken, 'New refresh must generate fresh nonce');

  const post2Res = await fetch(`${baseUrl}/api/checklists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl,
      Cookie: `qavora_auth_token=${userA.authToken}; qavora_csrf_token=${refresh2Body.csrfToken}`,
      'X-CSRF-Token': refresh2Body.csrfToken
    },
    body: JSON.stringify({ title: 'Checklist with Second Refreshed Token' })
  });
  assert.equal(post2Res.status, 201);

  // 16. Logout clears cookies and renders old CSRF token invalid
  const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: {
      Origin: baseUrl,
      Cookie: `qavora_auth_token=${userA.authToken}; qavora_csrf_token=${refresh2Body.csrfToken}`,
      'X-CSRF-Token': refresh2Body.csrfToken
    }
  });
  assert.equal(logoutRes.status, 200);
  const logoutSetCookies = logoutRes.headers.get('set-cookie') || '';
  assert.match(logoutSetCookies, /qavora_auth_token=;/);
  assert.match(logoutSetCookies, /qavora_csrf_token=;/);

  // Subsequent GET /api/auth/csrf after logout (with no cookies) returns 401
  const postLogoutCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
  assert.equal(postLogoutCsrfRes.status, 401);
  assert.equal(extractCookies(postLogoutCsrfRes).qavora_csrf_token, undefined);

  // Subsequent state-changing request with old/cleared cookies returns 403
  const postLogoutStateRes = await fetch(`${baseUrl}/api/checklists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl,
      Cookie: `qavora_csrf_token=${refresh2Body.csrfToken}`,
      'X-CSRF-Token': refresh2Body.csrfToken
    },
    body: JSON.stringify({ title: 'Post-Logout Exploit Attempt' })
  });
  assert.equal(postLogoutStateRes.status, 403);

  // 17. Re-login succeeds and issues new valid CSRF token and session
  const reloginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl,
      'X-Forwarded-For': '10.0.9.1'
    },
    body: JSON.stringify({ email: 'audita@example.com', password: 'Password123!' })
  });
  assert.equal(reloginRes.status, 200);
  const reloginCookies = extractCookies(reloginRes);
  assert.ok(reloginCookies.qavora_auth_token, 'Login must set auth token cookie');
  assert.ok(reloginCookies.qavora_csrf_token, 'Login must set CSRF token cookie');

  // Authenticated state-changing request succeeds with new tokens
  const reloginPostRes = await fetch(`${baseUrl}/api/checklists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl,
      Cookie: `qavora_auth_token=${reloginCookies.qavora_auth_token}; qavora_csrf_token=${reloginCookies.qavora_csrf_token}`,
      'X-CSRF-Token': reloginCookies.qavora_csrf_token
    },
    body: JSON.stringify({ title: 'Post-Relogin Checklist' })
  });
  assert.equal(reloginPostRes.status, 201);

  // 18. Verify security side-effects: ensure failed requests did NOT create any anonymous sessions/users
  const anonUsers = await directDb.collection('users').find({
    $or: [
      { userId: { $regex: /anon/i } },
      { email: { $regex: /anon/i } },
      { name: { $regex: /anonymous/i } }
    ]
  }).toArray();
  assert.equal(anonUsers.length, 0, 'No anonymous users or sessions should exist in MongoDB');
});

