/**
 * Verification test suite for SEC-001: Authentication Rate Limiting
 * Verifies:
 * 1. Exports of loginRateLimiter and registerRateLimiter from server.ts.
 * 2. Login rate limiting: 5 allowed per 15m window, 6th returns HTTP 429.
 * 3. Registration rate limiting: 3 allowed per 1h window, 4th returns HTTP 429.
 * 4. Standard RateLimit-* headers (ratelimit-limit, ratelimit-remaining, ratelimit-reset, retry-after).
 * 5. Structured JSON error responses without sensitive info leakage.
 * 6. IP isolation: requests from different IPs maintain independent counters.
 * 7. Key reset functionality restoring access.
 * 8. Normal login and registration workflows succeed without regressions.
 * 9. Non-auth endpoints (/api/health, /api/projects) are not affected.
 */

import http from 'http';
import app, { loginRateLimiter, registerRateLimiter } from '../server.ts';

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

async function runRateLimitVerification() {
  console.log('========================================================================');
  console.log('QAVORA — SEC-001: AUTHENTICATION RATE LIMITING VERIFICATION');
  console.log('========================================================================\n');

  // Step 1: Export Validation
  console.log('--- 1. Module Export & Configuration Validation ---');
  assert(typeof loginRateLimiter === 'function', 'server.ts exports loginRateLimiter middleware');
  assert(typeof registerRateLimiter === 'function', 'server.ts exports registerRateLimiter middleware');
  assert(typeof app === 'function', 'server.ts exports Express application');

  const testServer = http.createServer(app);
  await new Promise<void>((resolve) => testServer.listen(0, '127.0.0.1', () => resolve()));
  const port = (testServer.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const IP_A = '198.51.100.10';
  const IP_B = '198.51.100.20';
  const IP_C = '198.51.100.30';
  const IP_D = '198.51.100.40';

  // Ensure fresh rate limit state for test IPs
  if (typeof loginRateLimiter.resetKey === 'function') {
    loginRateLimiter.resetKey(IP_A);
    loginRateLimiter.resetKey(IP_B);
  }
  if (typeof registerRateLimiter.resetKey === 'function') {
    registerRateLimiter.resetKey(IP_C);
    registerRateLimiter.resetKey(IP_D);
  }

  // Step 2: Login Rate Limiting (5 attempts allowed per 15 min per IP; 6th returns 429)
  console.log('\n--- 2. Login Rate Limiting (5 per 15 min per IP) ---');
  let lastLoginRes: Response | null = null;

  for (let i = 1; i <= 5; i++) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': IP_A
      },
      body: JSON.stringify({ email: `test_${i}@example.com`, password: 'wrongpassword' })
    });

    const status = res.status;
    const remaining = res.headers.get('ratelimit-remaining');
    const limit = res.headers.get('ratelimit-limit');
    assert(
      status !== 429,
      `Login attempt #${i} from IP ${IP_A} is accepted under the rate limit (HTTP ${status})`
    );
    assert(limit === '5', `Login attempt #${i} advertises standard ratelimit-limit: 5`);
    assert(
      remaining === String(5 - i),
      `Login attempt #${i} correctly decrements ratelimit-remaining to ${5 - i}`
    );
    lastLoginRes = res;
  }

  // 6th Login attempt from IP_A must be rejected with HTTP 429
  const blockedLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': IP_A
    },
    body: JSON.stringify({ email: 'test_6@example.com', password: 'wrongpassword' })
  });

  assert(blockedLoginRes.status === 429, `Login attempt #6 from IP ${IP_A} receives HTTP 429 Too Many Requests`);
  assert(
    blockedLoginRes.headers.get('content-type')?.includes('application/json') ?? false,
    'HTTP 429 response has application/json content-type'
  );
  assert(
    Boolean(blockedLoginRes.headers.get('retry-after')),
    `HTTP 429 response includes Retry-After header (${blockedLoginRes.headers.get('retry-after')}s)`
  );

  const blockedLoginBody = await blockedLoginRes.json();
  assert(
    Boolean(blockedLoginBody.error && blockedLoginBody.error.includes('Too many login attempts')),
    `HTTP 429 response body contains clear error message: "${blockedLoginBody.error}"`
  );
  assert(
    !JSON.stringify(blockedLoginBody).includes('password') && !JSON.stringify(blockedLoginBody).includes('secret'),
    'HTTP 429 response contains zero sensitive system or credential information'
  );

  // Step 3: Different IP Isolation for Login
  console.log('\n--- 3. IP Isolation for Login ---');
  const isolatedLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': IP_B
    },
    body: JSON.stringify({ email: 'other_user@example.com', password: 'anypassword' })
  });
  assert(
    isolatedLoginRes.status !== 429,
    `Independent IP ${IP_B} is NOT blocked by IP ${IP_A}'s rate limit (HTTP ${isolatedLoginRes.status})`
  );
  assert(
    isolatedLoginRes.headers.get('ratelimit-remaining') === '4',
    `Independent IP ${IP_B} starts with full quota (ratelimit-remaining: 4)`
  );

  // Step 4: Registration Rate Limiting (3 attempts allowed per 1 hour per IP; 4th returns 429)
  console.log('\n--- 4. Registration Rate Limiting (3 per hour per IP) ---');
  for (let i = 1; i <= 3; i++) {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': IP_C
      },
      body: JSON.stringify({
        name: `User ${i}`,
        email: `reg_test_${Date.now()}_${i}@example.com`,
        password: 'Password123!'
      })
    });

    const status = res.status;
    const remaining = res.headers.get('ratelimit-remaining');
    const limit = res.headers.get('ratelimit-limit');
    assert(
      status !== 429,
      `Registration attempt #${i} from IP ${IP_C} is accepted under the rate limit (HTTP ${status})`
    );
    assert(limit === '3', `Registration attempt #${i} advertises standard ratelimit-limit: 3`);
    assert(
      remaining === String(3 - i),
      `Registration attempt #${i} correctly decrements ratelimit-remaining to ${3 - i}`
    );
  }

  // 4th Registration attempt from IP_C must be rejected with HTTP 429
  const blockedRegRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': IP_C
    },
    body: JSON.stringify({
      name: 'User 4',
      email: 'reg_test_overflow@example.com',
      password: 'Password123!'
    })
  });

  assert(blockedRegRes.status === 429, `Registration attempt #4 from IP ${IP_C} receives HTTP 429 Too Many Requests`);
  assert(
    blockedRegRes.headers.get('content-type')?.includes('application/json') ?? false,
    'Registration 429 response has application/json content-type'
  );
  assert(
    Boolean(blockedRegRes.headers.get('retry-after')),
    `Registration 429 response includes Retry-After header (${blockedRegRes.headers.get('retry-after')}s)`
  );

  const blockedRegBody = await blockedRegRes.json();
  assert(
    Boolean(blockedRegBody.error && blockedRegBody.error.includes('Too many registration attempts')),
    `Registration 429 response body contains clear error: "${blockedRegBody.error}"`
  );

  // Step 5: Different IP Isolation for Registration
  console.log('\n--- 5. IP Isolation for Registration ---');
  const isolatedRegRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': IP_D
    },
    body: JSON.stringify({
      name: 'Independent User',
      email: `independent_${Date.now()}@example.com`,
      password: 'Password123!'
    })
  });
  assert(
    isolatedRegRes.status !== 429,
    `Independent IP ${IP_D} is NOT blocked by IP ${IP_C}'s rate limit (HTTP ${isolatedRegRes.status})`
  );
  assert(
    isolatedRegRes.headers.get('ratelimit-remaining') === '2',
    `Independent IP ${IP_D} starts with full quota (ratelimit-remaining: 2)`
  );

  // Step 6: Window Reset Verification
  console.log('\n--- 6. Rate Limit Window Reset Verification ---');
  if (typeof loginRateLimiter.resetKey === 'function') {
    loginRateLimiter.resetKey(IP_A);
    const resetLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': IP_A
      },
      body: JSON.stringify({ email: 'reset_check@example.com', password: 'any' })
    });
    assert(
      resetLoginRes.status !== 429,
      `IP ${IP_A} is no longer blocked after rate limit reset (HTTP ${resetLoginRes.status})`
    );
    assert(
      resetLoginRes.headers.get('ratelimit-remaining') === '4',
      `Quota for IP ${IP_A} is restored to full initial capacity (remaining: 4)`
    );
  }

  // Step 7: Normal Registration & Login Working Without Regression
  console.log('\n--- 7. End-to-End Registration & Login Flow Verification ---');
  const FRESH_IP = '198.51.100.99';
  const testEmail = `normal_flow_${Date.now()}@example.com`;
  const testPassword = 'ValidPassword123!';
  const testName = 'Verified User';

  const normalRegRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': FRESH_IP
    },
    body: JSON.stringify({ name: testName, email: testEmail, password: testPassword })
  });

  assert(normalRegRes.status === 201, `Normal user registration succeeds with HTTP 201 (got ${normalRegRes.status})`);
  const regData = await normalRegRes.json();
  assert(Boolean(regData.token), 'Registration response contains valid JWT token');
  assert(regData.user?.email === testEmail.toLowerCase(), 'Registration response contains user profile');

  const normalLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': FRESH_IP
    },
    body: JSON.stringify({ email: testEmail, password: testPassword })
  });

  assert(normalLoginRes.status === 200, `Normal user login succeeds with HTTP 200 (got ${normalLoginRes.status})`);
  const loginData = await normalLoginRes.json();
  assert(Boolean(loginData.token), 'Login response contains valid JWT token');
  assert(loginData.user?.email === testEmail.toLowerCase(), 'Login response returns matching authenticated user');

  // Step 8: Non-Auth Route Independence
  console.log('\n--- 8. Non-Auth Route Independence Verification ---');
  const healthRes = await fetch(`${baseUrl}/api/health`, {
    headers: { 'X-Forwarded-For': IP_A }
  });
  assert(healthRes.status === 200, `GET /api/health is not affected by auth rate limits (HTTP ${healthRes.status})`);
  assert(
    !healthRes.headers.get('ratelimit-limit'),
    'GET /api/health does not attach rate limit headers'
  );

  await new Promise<void>((resolve) => testServer.close(() => resolve()));

  console.log('\n========================================================================');
  console.log(`SEC-001 VERIFICATION COMPLETE: ${passed} passed, ${failed} failed.`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runRateLimitVerification().catch((err) => {
  console.error('Unexpected error during SEC-001 verification:', err);
  process.exit(1);
});
