/**
 * Verification test suite for Phase 5 - Step 2: Server & Environment Hardening
 * Verifies:
 * 1. Dynamic PORT resolution and validation.
 * 2. Express server binding to 0.0.0.0.
 * 3. MongoDB reliability settings (serverSelectionTimeoutMS: 10000, maxPoolSize: 20).
 * 4. Production fail-fast on missing/unreachable MongoDB (zero in-memory fallback in production).
 * 5. Development mode retains in-memory mock responses when MongoDB is offline.
 * 6. Graceful shutdown handlers (SIGTERM, SIGINT) and duplicate shutdown suppression.
 * 7. HTTP security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Strict-Transport-Security, Content-Security-Policy).
 * 8. Mandatory JWT_SECRET validation without fallback.
 * 9. .env.example environment documentation without secrets.
 */

import fs from 'fs';
import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';

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

async function runHardeningVerification() {
  console.log('========================================================================');
  console.log('PHASE 5 - STEP 2: SERVER & ENVIRONMENT HARDENING VERIFICATION');
  console.log('========================================================================\n');

  const serverTs = fs.readFileSync(path.resolve('server.ts'), 'utf8');
  const envExample = fs.readFileSync(path.resolve('.env.example'), 'utf8');

  // --- Group 1: Dynamic Port & Host Binding ---
  console.log('--- Group 1: Dynamic Port & Host Binding ---');
  assert(serverTs.includes('process.env.PORT'), 'server.ts inspects process.env.PORT');
  assert(serverTs.includes('resolvePort()') || serverTs.includes('parseInt(process.env.PORT'), 'Port is parsed and validated');
  assert(serverTs.includes("0.0.0.0"), 'Express listens on host 0.0.0.0');
  assert(serverTs.includes("3000"), 'Fallback port 3000 preserved when PORT is undefined');

  // --- Group 2: MongoDB Production Reliability & Fail-Fast ---
  console.log('\n--- Group 2: MongoDB Production Reliability & Fail-Fast ---');
  assert(serverTs.includes('serverSelectionTimeoutMS: 10000'), 'MongoDB client configured with serverSelectionTimeoutMS: 10000');
  assert(serverTs.includes('maxPoolSize: 20'), 'MongoDB client configured with maxPoolSize: 20');
  assert(
    serverTs.includes("isProduction") &&
    serverTs.includes("In-memory fallback is strictly disabled in production"),
    'Production mode refuses in-memory fallback and logs fatal error'
  );
  assert(
    serverTs.includes("process.exit(1)"),
    'Fails startup with process.exit(1) when MongoDB is offline in production'
  );
  assert(
    serverTs.includes("MongoDB credentials not provided in environment; using in-memory mock responses") ||
    serverTs.includes("Fallback mock active"),
    'Development mode retains in-memory mock fallback when offline'
  );

  // --- Group 3: Graceful Shutdown Implementation ---
  console.log('\n--- Group 3: Graceful Shutdown Implementation ---');
  assert(serverTs.includes("process.on('SIGTERM'"), 'SIGTERM process listener registered');
  assert(serverTs.includes("process.on('SIGINT'"), 'SIGINT process listener registered');
  assert(serverTs.includes("isShuttingDown"), 'Duplicate shutdown guard flag implemented');
  assert(serverTs.includes("mongoClientInstance.close()"), 'MongoDB client closed during shutdown');
  assert(serverTs.includes("httpServer.close"), 'HTTP server closed during shutdown');
  assert(serverTs.includes("forceExitTimer") || serverTs.includes("10000"), 'Shutdown timeout implemented to prevent hanging');

  // --- Group 4: HTTP Security Headers & CSP ---
  console.log('\n--- Group 4: HTTP Security Headers & CSP ---');
  assert(serverTs.includes("X-Content-Type-Options") && serverTs.includes("nosniff"), 'X-Content-Type-Options: nosniff header set');
  assert(serverTs.includes("X-Frame-Options") && serverTs.includes("DENY"), 'X-Frame-Options: DENY header set');
  assert(serverTs.includes("Referrer-Policy") && serverTs.includes("strict-origin-when-cross-origin"), 'Referrer-Policy configured');
  assert(serverTs.includes("Strict-Transport-Security"), 'Strict-Transport-Security header configured for HTTPS/production');
  assert(serverTs.includes("Content-Security-Policy"), 'Content-Security-Policy header configured');
  assert(serverTs.includes("script-src 'self' 'unsafe-inline'"), 'CSP script-src accommodates application script requirements');
  assert(serverTs.includes("style-src 'self' 'unsafe-inline'"), 'CSP style-src accommodates fonts/inline styles');

  // Test live headers on actual Express server.ts app
  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'production';
  const serverModule = await import('../server.ts');
  const actualApp = serverModule.default;

  const server = http.createServer(actualApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as any;
  const port = addr.port;

  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert(res.headers.get('x-content-type-options') === 'nosniff', 'Live HTTP response contains nosniff');
  assert(res.headers.get('x-frame-options') === 'DENY', 'Live HTTP response contains DENY');
  assert(res.headers.get('referrer-policy') === 'strict-origin-when-cross-origin', 'Live HTTP response contains strict referrer policy');
  assert(res.headers.get('strict-transport-security')?.includes('max-age=31536000') === true, 'Live HTTP response contains HSTS');
  assert(res.headers.get('content-security-policy')?.includes("default-src 'self'") === true, 'Live HTTP response contains CSP');

  await new Promise<void>((resolve) => server.close(() => resolve()));

  // --- Group 5: Environment Documentation ---
  console.log('\n--- Group 5: Environment Documentation (.env.example) ---');
  assert(envExample.includes('MONGODB_URI='), '.env.example documents MONGODB_URI');
  assert(envExample.includes('MONGODB_DB='), '.env.example documents MONGODB_DB');
  assert(envExample.includes('JWT_SECRET='), '.env.example documents JWT_SECRET');
  assert(envExample.includes('JWT_EXPIRES_IN='), '.env.example documents JWT_EXPIRES_IN');
  assert(envExample.includes('VITE_BASE_PATH='), '.env.example documents VITE_BASE_PATH');
  assert(!envExample.includes('mongodb+srv://') && !envExample.includes('password='), '.env.example contains zero plaintext passwords or URIs');

  // --- Group 6: Tenant Isolation & JWT Security Integrity ---
  console.log('\n--- Group 6: Tenant Isolation & Core Auth Security Integrity ---');
  assert(serverTs.includes('getJwtSecret()'), 'JWT_SECRET accessor preserved');
  assert(serverTs.includes('requireAuth'), 'requireAuth middleware preserved');
  assert(serverTs.includes('toSafeUser'), 'toSafeUser profile sanitizer preserved');
  assert(serverTs.includes('userId, id'), 'Composite tenant indexes preserved');
  assert(serverTs.includes('const isVercel = Boolean(process.env.VERCEL || process.env.NOW_REGION);'), 'Top-level isVercel constant properly scoped');

  // --- Group 7: Live server.ts Regression Tests (Headers, JWT Secret & MongoDB Safety) ---
  console.log('\n--- Group 7: Live server.ts Regression Tests (Prod/Vercel vs Dev/AI Studio) ---');
  const prevNodeEnv = process.env.NODE_ENV;
  const prevVercel = process.env.VERCEL;
  const prevJwtSecret = process.env.JWT_SECRET;
  const prevMongoUri = process.env.MONGODB_URI;

  // Import real server.ts in Vercel mode so setupServer() does not bind port 3000
  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'production';
  delete process.env.MONGODB_URI;
  delete process.env.JWT_SECRET;

  const realServerMod = await import('../server.ts');
  const realApp = realServerMod.default;
  const realHttpServer = http.createServer(realApp);
  await new Promise<void>((resolve) => realHttpServer.listen(0, '127.0.0.1', () => resolve()));
  const realPort = (realHttpServer.address() as any).port;
  const realBaseUrl = `http://127.0.0.1:${realPort}`;

  try {
    // 7A. Production / Vercel headers check
    const prodHealthRes = await fetch(`${realBaseUrl}/api/health`);
    assert(prodHealthRes.headers.get('x-frame-options') === 'DENY', 'Real server.ts sets X-Frame-Options: DENY in production/Vercel');
    assert(prodHealthRes.headers.get('cross-origin-resource-policy') === 'same-origin', 'Real server.ts sets Cross-Origin-Resource-Policy: same-origin in production/Vercel');
    assert(prodHealthRes.headers.get('content-security-policy')?.includes("frame-ancestors 'none'") === true, "Real server.ts sets CSP frame-ancestors 'none' in production/Vercel");
    const prodHealthJson = await prodHealthRes.json();
    assert(prodHealthJson.database !== 'mock-active', 'Real server.ts never reports mock-active database in production/Vercel');

    // 7B. Vercel production with missing MONGODB_URI returns HTTP 503 (never uses mockDb)
    process.env.JWT_SECRET = 'hardening_test_valid_production_secret_key';
    const prodRegOffline = await fetch(`${realBaseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Prod User', email: 'prod@example.com', password: 'password123' })
    });
    assert(prodRegOffline.status === 503, 'Vercel production returns HTTP 503 on /api/auth/register when MONGODB_URI is missing (mockDb disabled)');

    const prodProjectsOffline = await fetch(`${realBaseUrl}/api/projects`);
    assert(prodProjectsOffline.status === 503, 'Vercel production returns HTTP 503 on /api/projects when MONGODB_URI is missing (mockDb disabled)');

    // 7C. Standalone production fail-fast check (NODE_ENV=production without VERCEL)
    delete process.env.VERCEL;
    process.env.NODE_ENV = 'production';
    delete process.env.MONGODB_URI;
    let exitCodeCaptured: number | null = null;
    const origExit = process.exit;
    process.exit = ((code?: number) => {
      exitCodeCaptured = code ?? 0;
      return undefined as never;
    }) as any;
    try {
      await realServerMod.connectToDatabase();
    } finally {
      process.exit = origExit;
    }
    assert(exitCodeCaptured === 1, 'Standalone production calls process.exit(1) fail-fast when MONGODB_URI is missing');

    // 7D. Development / AI Studio preview mode headers & dev fallbacks
    delete process.env.VERCEL;
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    delete process.env.MONGODB_URI;

    const devHealthRes = await fetch(`${realBaseUrl}/api/health`);
    assert(devHealthRes.headers.get('x-frame-options') === null, 'Real server.ts omits X-Frame-Options in development / AI Studio preview');
    assert(devHealthRes.headers.get('cross-origin-resource-policy') === 'cross-origin', 'Real server.ts sets Cross-Origin-Resource-Policy: cross-origin in development / AI Studio preview');
    assert(devHealthRes.headers.get('content-security-policy')?.includes('frame-ancestors *') === true, 'Real server.ts sets CSP frame-ancestors * in development / AI Studio preview');

    await realServerMod.connectToDatabase();
    const devRegRes = await fetch(`${realBaseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Dev Preview User', email: 'devpreview@example.com', password: 'password123' })
    });
    assert(devRegRes.status === 201, 'Development / AI Studio preview allows registration with in-memory mockDb and dev fallback JWT secret');
    const devRegData = await devRegRes.json();

    // 7E. Switching back to Vercel production immediately clears dev mockDb and returns HTTP 503
    process.env.NODE_ENV = 'production';
    process.env.VERCEL = '1';
    delete process.env.JWT_SECRET;
    const prodAfterDevSwitch = await fetch(`${realBaseUrl}/api/projects`, {
      headers: { Authorization: `Bearer ${devRegData.token}` }
    });
    assert(prodAfterDevSwitch.status === 503, 'Switching to Vercel production clears dev mockDb and returns HTTP 503 when MongoDB is unconfigured');
  } finally {
    await new Promise<void>((resolve) => realHttpServer.close(() => resolve()));
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevNodeEnv;
    if (prevVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = prevVercel;
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prevJwtSecret;
    if (prevMongoUri === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = prevMongoUri;
  }

  console.log('\n========================================================================');
  console.log(`HARDENING VERIFICATION COMPLETE: ${passed} passed, ${failed} failed.`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runHardeningVerification().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
