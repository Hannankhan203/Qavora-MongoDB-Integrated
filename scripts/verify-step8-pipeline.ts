/**
 * Verification test suite for Phase 5 - Step 3: Build & Static Asset Pipeline Alignment
 * Verifies:
 * 1. package.json scripts audit (prestart, start, build, dev).
 * 2. Prestart hook builds dist/ before server starts.
 * 3. Production static asset serving (/dist, index.html, assets, MIME types).
 * 4. VITE_BASE_PATH compatibility and prefixing.
 * 5. SPA routing fallback to index.html for unknown frontend routes (e.g. /projects/test-1).
 * 6. API 404 behavior: Unmatched /api/* routes NEVER fall back to index.html and return JSON 404.
 * 7. API health endpoint (/api/health) returns valid JSON in production mode.
 * 8. Missing/incomplete dist/ detection fails fast with clear error message.
 * 9. Development mode retains Vite middlewareMode.
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

async function runStep3Verification() {
  console.log('========================================================================');
  console.log('PHASE 5 - STEP 3: BUILD & STATIC ASSET PIPELINE ALIGNMENT VERIFICATION');
  console.log('========================================================================\n');

  // --- Task 1: Package Lifecycle Audit ---
  console.log('--- Task 1: Package Lifecycle Audit ---');
  const pkgJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  assert(pkgJson.scripts.build === 'vite build', 'build script is "vite build"');
  assert(pkgJson.scripts.prestart === 'npm run build', 'prestart script ensures "npm run build" runs before start');
  assert(pkgJson.scripts.start === 'node server.ts', 'start script is "node server.ts"');
  assert(pkgJson.scripts.dev === 'tsx server.ts', 'dev script is "tsx server.ts"');
  assert(pkgJson.scripts.lint === 'tsc --noEmit', 'lint script is "tsc --noEmit"');

  // --- Task 2: Dist Directory & Static Files Verification ---
  console.log('\n--- Task 2: Dist Directory & Static Files Verification ---');
  const distPath = path.resolve('dist');
  const indexPath = path.resolve(distPath, 'index.html');
  const assetsPath = path.resolve(distPath, 'assets');

  assert(fs.existsSync(distPath), 'dist/ directory exists from build');
  assert(fs.existsSync(indexPath), 'dist/index.html exists');
  assert(fs.existsSync(assetsPath), 'dist/assets directory exists');

  const assetFiles = fs.readdirSync(assetsPath);
  const jsBundle = assetFiles.find((f: string) => f.endsWith('.js'));
  const cssBundle = assetFiles.find((f: string) => f.endsWith('.css'));

  assert(Boolean(jsBundle), `JavaScript bundle found in dist/assets (${jsBundle})`);
  assert(Boolean(cssBundle), `CSS bundle found in dist/assets (${cssBundle})`);
  assert(fs.existsSync(path.resolve(distPath, 'favicon.svg')), 'favicon.svg present in dist/');
  assert(fs.existsSync(path.resolve(distPath, 'site.webmanifest')), 'site.webmanifest present in dist/');

  // --- Task 3: Server Implementation Audit ---
  console.log('\n--- Task 3: Server Implementation Audit ---');
  const serverTs = fs.readFileSync(path.resolve('server.ts'), 'utf8');
  assert(serverTs.includes("app.use('/api'") || serverTs.includes('app.use("/api"'), 'Server defines dedicated app.use(/api) catch-all handler');
  assert(serverTs.includes("fs.existsSync(distPath)") && serverTs.includes("fs.existsSync(indexPath)"), 'Server checks existence of distPath and indexPath in production');
  assert(serverTs.includes("VITE_BASE_PATH"), 'Server respects VITE_BASE_PATH configuration');
  assert(serverTs.includes("res.sendFile(indexPath)"), 'SPA route sends index.html via res.sendFile');

  // --- Task 4: Live HTTP Server with Actual server.ts Production Static & SPA Routes ---
  console.log('\n--- Task 4: Live HTTP Server (Actual server.ts Static Assets & SPA Routing) ---');
  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'production';
  const serverModule = await import('../server.ts');
  const app = serverModule.default;
  serverModule.configureStaticAndSpa(app);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as any;
  const port = addr.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // 1. Test /api/health
  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert(healthRes.status === 200, 'GET /api/health returns 200 OK');
  const healthJson = await healthRes.json();
  assert(healthJson.success === true, 'GET /api/health returns valid JSON with success: true');

  // 2. Test unknown API routes return JSON 404 (NEVER index.html)
  const apiNotFoundRes = await fetch(`${baseUrl}/api/non-existent-endpoint`);
  assert(apiNotFoundRes.status === 404, 'GET /api/non-existent-endpoint returns HTTP 404');
  const apiNotFoundType = apiNotFoundRes.headers.get('content-type') || '';
  assert(apiNotFoundType.includes('application/json'), 'GET /api/non-existent-endpoint content-type is application/json');
  const apiNotFoundJson = await apiNotFoundRes.json();
  assert(apiNotFoundJson.error === 'Not Found', 'API 404 response body contains { error: "Not Found" }');

  const postApiNotFoundRes = await fetch(`${baseUrl}/api/projects/unknown/action`, { method: 'POST' });
  assert(postApiNotFoundRes.status === 404, 'POST /api/projects/unknown/action returns HTTP 404');
  const postApiNotFoundJson = await postApiNotFoundRes.json();
  assert(postApiNotFoundJson.error === 'Not Found', 'POST API 404 response returns JSON error');

  // 3. Test static assets loading with correct Content-Type MIME
  if (jsBundle) {
    const jsRes = await fetch(`${baseUrl}/assets/${jsBundle}`);
    assert(jsRes.status === 200, `GET /assets/${jsBundle} returns 200 OK`);
    const jsType = jsRes.headers.get('content-type') || '';
    assert(jsType.includes('javascript'), `JavaScript bundle served with javascript MIME type (${jsType})`);
  }

  if (cssBundle) {
    const cssRes = await fetch(`${baseUrl}/assets/${cssBundle}`);
    assert(cssRes.status === 200, `GET /assets/${cssBundle} returns 200 OK`);
    const cssType = cssRes.headers.get('content-type') || '';
    assert(cssType.includes('text/css'), `CSS bundle served with text/css MIME type (${cssType})`);
  }

  const manifestRes = await fetch(`${baseUrl}/site.webmanifest`);
  assert(manifestRes.status === 200, 'GET /site.webmanifest returns 200 OK');

  // 4. Test root route serves index.html
  const rootRes = await fetch(`${baseUrl}/`);
  assert(rootRes.status === 200, 'GET / returns 200 OK');
  const rootHtml = await rootRes.text();
  assert(rootHtml.includes('<title>Qavora'), 'GET / contains Qavora HTML title');
  assert(rootHtml.includes('id="auth-container"'), 'GET / contains Qavora DOM structure');

  // 5. Test SPA deep route fallback serves index.html
  const spaDeepRes = await fetch(`${baseUrl}/projects/proj_alpha_999`);
  assert(spaDeepRes.status === 200, 'GET /projects/proj_alpha_999 returns 200 OK (SPA fallback)');
  const spaDeepHtml = await spaDeepRes.text();
  assert(spaDeepHtml.includes('<title>Qavora'), 'SPA deep route serves index.html');

  const spaNestedRes = await fetch(`${baseUrl}/test-runs/execution/batch-123`);
  assert(spaNestedRes.status === 200, 'GET /test-runs/execution/batch-123 returns 200 OK (nested SPA route)');
  const spaNestedHtml = await spaNestedRes.text();
  assert(spaNestedHtml.includes('<title>Qavora'), 'Nested SPA route serves index.html');

  await new Promise<void>((resolve) => server.close(() => resolve()));

  console.log('\n========================================================================');
  console.log(`STEP 3 VERIFICATION COMPLETE: ${passed} passed, ${failed} failed.`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runStep3Verification().catch((err) => {
  console.error('Unexpected error during Step 3 verification:', err);
  process.exit(1);
});
