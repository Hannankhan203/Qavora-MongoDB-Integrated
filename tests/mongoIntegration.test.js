import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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

test.before(async () => {
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

  // 4. Anonymous CSRF token cannot be used on state-changing endpoints
  const anonCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
  const anonCookies = extractCookies(anonCsrfRes);
  const anonPostRes = await fetch(`${baseUrl}/api/checklists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `qavora_csrf_token=${anonCookies.qavora_csrf_token}`,
      'X-CSRF-Token': anonCookies.qavora_csrf_token
    },
    body: JSON.stringify({ title: 'Anon CSRF' })
  });
  assert.equal(anonPostRes.status, 403);

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
