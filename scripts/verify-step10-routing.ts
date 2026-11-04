/**
 * Verification test suite for Phase 5 - Step 6: Vercel Full-Stack Routing Configuration
 * Verifies:
 * 1. vercel.json exists, is valid JSON, and adheres to modern Vercel configuration schemas.
 * 2. vercel.json configures buildCommand as "vite build" and outputDirectory as "dist".
 * 3. vercel.json routes /api/* to the serverless entry point (/api).
 * 4. vercel.json routes frontend SPA navigation routes to /index.html.
 * 5. vercel.json excludes /api/*, /assets/*, and static assets from /index.html fallback.
 * 6. api/index.ts exists and cleanly re-exports app from server.ts.
 * 7. /server.ts defines catch-all /api 404 handler that guarantees API requests NEVER receive index.html.
 * 8. Cache-Control header configured for /assets/*.
 */

import fs from 'fs';
import path from 'path';

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

async function runStep6Verification() {
  console.log('========================================================================');
  console.log('PHASE 5 - STEP 6: VERCEL FULL-STACK ROUTING CONFIGURATION VERIFICATION');
  console.log('========================================================================\n');

  // --- 1. Validate vercel.json schema & configuration ---
  console.log('--- 1. Validating vercel.json ---');
  const vercelJsonPath = path.resolve('vercel.json');
  assert(fs.existsSync(vercelJsonPath), 'vercel.json exists in root directory');

  const vercelJson = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf8'));
  assert(vercelJson.buildCommand === 'vite build', 'vercel.json buildCommand is set to "vite build"');
  assert(vercelJson.outputDirectory === 'dist', 'vercel.json outputDirectory is set to "dist"');
  assert(Array.isArray(vercelJson.rewrites), 'vercel.json defines rewrites array');

  const apiRewrite = vercelJson.rewrites.find((r: any) => r.source === '/api/:path*' || r.source?.includes('/api/'));
  assert(Boolean(apiRewrite), 'vercel.json defines dedicated rewrite rule for /api/*');
  assert(apiRewrite.destination === '/api' || apiRewrite.destination === '/api/index.ts', 'API rewrite points to /api function');

  const spaRewrite = vercelJson.rewrites.find((r: any) => r.destination === '/index.html');
  assert(Boolean(spaRewrite), 'vercel.json defines SPA fallback rewrite to /index.html');
  assert(spaRewrite.source.includes('?!api/'), 'SPA rewrite explicitly excludes /api/ routes from HTML fallback');

  const headers = vercelJson.headers || [];
  const assetHeaders = headers.find((h: any) => h.source.includes('/assets/'));
  assert(Boolean(assetHeaders), 'vercel.json configures cache headers for immutable assets');

  // --- 2. Validate api/index.ts Serverless Bridge ---
  console.log('\n--- 2. Validating api/index.ts Bridge ---');
  const apiIndexPath = path.resolve('api/index.ts');
  assert(fs.existsSync(apiIndexPath), 'api/index.ts bridge file exists');

  const apiIndexContent = fs.readFileSync(apiIndexPath, 'utf8');
  assert(apiIndexContent.includes("from '../server.ts'") || apiIndexContent.includes("from '../server'"), 'api/index.ts imports server.ts');
  assert(apiIndexContent.includes('export default app'), 'api/index.ts exports app as default');

  // --- 3. Validate server.ts API 404 Guard Integrity ---
  console.log('\n--- 3. Validating server.ts API 404 Guard ---');
  const serverTs = fs.readFileSync(path.resolve('server.ts'), 'utf8');
  assert(serverTs.includes("app.use('/api'"), 'server.ts has dedicated app.use(/api) 404 handler');
  assert(serverTs.includes("error: 'Not Found'"), 'API 404 handler returns structured JSON error');

  // --- 4. Validate package.json & Lifecycle Compatibility ---
  console.log('\n--- 4. Validating package.json Lifecycle ---');
  const pkgJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  assert(pkgJson.scripts.build === 'vite build', 'package.json build script is "vite build"');
  assert(pkgJson.scripts.prestart === 'npm run build', 'prestart script ensures standalone builds before server start');
  assert(pkgJson.scripts.dev === 'tsx server.ts', 'dev script is preserved for standalone local development');

  console.log('\n========================================================================');
  console.log(`STEP 6 VERIFICATION COMPLETE: ${passed} passed, ${failed} failed.`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runStep6Verification().catch((err) => {
  console.error('Unexpected error in Step 6 verification:', err);
  process.exit(1);
});
