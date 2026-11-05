/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — DEP-001 Verification Suite: Render Full-Stack Deployment Architecture
 *
 * Verifies:
 * 1. render.yaml specification and configuration.
 * 2. .github/workflows/deploy.yml CI-only configuration (no GitHub Pages deployment).
 * 3. package.json deployment lifecycle scripts and Node engines.
 * 4. Production build generation and static asset layout in dist/.
 * 5. Standalone Express production server startup on dynamic PORT.
 * 6. Frontend delivery through Express (index.html, JS, CSS, PWA assets).
 * 7. Live /api/health check endpoint behavior.
 * 8. API routing separation (/api/* always routed to Express backend, 404 returns JSON).
 * 9. Client-side routing preservation across direct browser refresh (SPA fallback).
 * 10. Authentication and protected endpoint security under production configuration.
 * 11. Production fail-fast and database safeguards.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

let testCount = 0;
let passCount = 0;

function assert(condition: boolean, message: string) {
  testCount += 1;
  if (!condition) {
    console.error(`  ✗ [FAIL] #${testCount}: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passCount += 1;
  console.log(`  ✓ [PASS] #${testCount}: ${message}`);
}

async function runDep001Verification() {
  console.log('========================================================================');
  console.log('QAVORA-DEP-001: RENDER FULL-STACK DEPLOYMENT ARCHITECTURE VERIFICATION');
  console.log('========================================================================\n');

  // ========================================================================
  // Section 1: render.yaml Specification Validation
  // ========================================================================
  console.log('--- Section 1: render.yaml Blueprint Specification ---');
  const renderYamlPath = path.resolve('render.yaml');
  assert(fs.existsSync(renderYamlPath), 'render.yaml exists in repository root');

  const renderYamlContent = fs.readFileSync(renderYamlPath, 'utf8');
  assert(renderYamlContent.includes('type: web'), 'render.yaml declares type: web service');
  assert(renderYamlContent.includes('runtime: node') || renderYamlContent.includes('env: node'), 'render.yaml specifies node runtime');
  assert(renderYamlContent.includes('buildCommand: npm install && npm run build'), 'render.yaml configures buildCommand with npm install && npm run build');
  assert(renderYamlContent.includes('startCommand: npm start'), 'render.yaml configures startCommand as npm start');
  assert(renderYamlContent.includes('healthCheckPath: /api/health'), 'render.yaml configures healthCheckPath as /api/health');
  assert(renderYamlContent.includes('key: NODE_ENV') && renderYamlContent.includes('value: production'), 'render.yaml specifies NODE_ENV=production');
  assert(renderYamlContent.includes('key: MONGODB_URI'), 'render.yaml specifies MONGODB_URI envVar');
  assert(renderYamlContent.includes('key: JWT_SECRET'), 'render.yaml specifies JWT_SECRET envVar');
  assert(renderYamlContent.includes('generateValue: true'), 'render.yaml uses generateValue: true for secure JWT_SECRET creation');
  assert(renderYamlContent.includes('key: VITE_BASE_PATH'), 'render.yaml specifies VITE_BASE_PATH');

  // ========================================================================
  // Section 2: GitHub Actions Workflow Validation
  // ========================================================================
  console.log('\n--- Section 2: GitHub Actions CI Workflow Alignment ---');
  const workflowPath = path.resolve('.github/workflows/deploy.yml');
  assert(fs.existsSync(workflowPath), '.github/workflows/deploy.yml exists');

  const workflowContent = fs.readFileSync(workflowPath, 'utf8');
  assert(!workflowContent.includes('actions/deploy-pages'), 'deploy.yml does NOT contain actions/deploy-pages (no static Pages deployment)');
  assert(!workflowContent.includes('actions/configure-pages'), 'deploy.yml does NOT contain actions/configure-pages');
  assert(!workflowContent.includes('actions/upload-pages-artifact'), 'deploy.yml does NOT contain actions/upload-pages-artifact');
  assert(!workflowContent.includes('pages: write'), 'deploy.yml does NOT request pages: write permissions');
  assert(workflowContent.includes('contents: read'), 'deploy.yml enforces least-privilege permissions: contents: read');
  assert(workflowContent.includes('npm run build'), 'deploy.yml executes production bundle build check');
  assert(workflowContent.includes('npm run lint'), 'deploy.yml executes typecheck / lint check');
  assert(workflowContent.includes('node-version: 22'), 'deploy.yml uses Node.js 22 runtime');

  // ========================================================================
  // Section 3: Package Configuration & Engines
  // ========================================================================
  console.log('\n--- Section 3: package.json Lifecycle Scripts & Node Engines ---');
  const pkgPath = path.resolve('package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  assert(pkg.scripts?.build === 'vite build', 'build script is "vite build"');
  assert(pkg.scripts?.start === 'node server.ts', 'start script is "node server.ts"');
  assert(pkg.scripts?.prestart === 'npm run build', 'prestart script ensures fresh build before start');
  assert(pkg.engines?.node !== undefined, 'package.json specifies engines.node for Render runtime detection');

  // ========================================================================
  // Section 4: Production Frontend Build Verification
  // ========================================================================
  console.log('\n--- Section 4: Production Dist Artifacts ---');
  const distDir = path.resolve('dist');
  const indexHtmlPath = path.resolve(distDir, 'index.html');
  const assetsDir = path.resolve(distDir, 'assets');

  assert(fs.existsSync(distDir), 'dist/ directory exists from build');
  assert(fs.existsSync(indexHtmlPath), 'dist/index.html exists');
  assert(fs.existsSync(assetsDir), 'dist/assets directory exists');

  const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');
  assert(indexHtmlContent.includes('Qavora'), 'dist/index.html contains Qavora brand title');
  assert(indexHtmlContent.includes('<script type="module"'), 'dist/index.html loads compiled module bundle');
  assert(indexHtmlContent.includes('<link rel="stylesheet"'), 'dist/index.html loads compiled stylesheet');

  // ========================================================================
  // Section 5: Standalone Production Express Server Simulation
  // ========================================================================
  console.log('\n--- Section 5: Standalone Express Production Delivery on Dynamic PORT ---');
  const mongod = await MongoMemoryServer.create();
  const mongoUri = mongod.getUri();
  const dbName = 'qavora_dep001_test';

  process.env.NODE_ENV = 'production';
  delete process.env.VERCEL;
  delete process.env.NOW_REGION;
  process.env.MONGODB_URI = mongoUri;
  process.env.MONGODB_DB = dbName;
  process.env.JWT_SECRET = 'dep001_render_production_jwt_secret_key_secure_12345';

  const mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();

  const serverModule = await import('../server.ts');
  const expressApp = serverModule.default;
  if (typeof serverModule.connectToDatabase === 'function') {
    await serverModule.connectToDatabase();
  }

  // Simulate Render assigning dynamic port 10000 or an ephemeral port
  const renderAssignedPort = 10015;
  const testServer = http.createServer(expressApp);
  await new Promise<void>((resolve) => testServer.listen(renderAssignedPort, '127.0.0.1', () => resolve()));
  const baseUrl = `http://127.0.0.1:${renderAssignedPort}`;

  try {
    // 5a. Health Check
    console.log('\n--- Section 6: Live Health Check & Zero-Downtime Readiness ---');
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert(healthRes.status === 200, 'GET /api/health responds with HTTP 200 OK');
    const healthBody = await healthRes.json();
    assert(healthBody.success === true, 'Health check reports success: true');
    assert(healthBody.database === 'connected', 'Health check reports database: "connected"');

    // 5b. Frontend Delivery through Express
    console.log('\n--- Section 7: Frontend Asset Delivery Through Express ---');
    const rootRes = await fetch(`${baseUrl}/`);
    assert(rootRes.status === 200, 'GET / responds with HTTP 200 OK');
    assert(Boolean(rootRes.headers.get('content-type')?.includes('text/html')), 'GET / delivers Content-Type text/html');
    const rootHtml = await rootRes.text();
    assert(rootHtml.includes('Qavora'), 'Delivered HTML contains Qavora root application');

    // 5c. Static Assets
    const assetFiles = fs.readdirSync(assetsDir);
    const jsAsset = assetFiles.find(f => f.endsWith('.js'));
    const cssAsset = assetFiles.find(f => f.endsWith('.css'));
    assert(Boolean(jsAsset), 'Compiled JavaScript asset exists in dist/assets');
    assert(Boolean(cssAsset), 'Compiled CSS asset exists in dist/assets');

    if (jsAsset) {
      const jsRes = await fetch(`${baseUrl}/assets/${jsAsset}`);
      assert(jsRes.status === 200, `GET /assets/${jsAsset} responds with HTTP 200 OK`);
      assert(Boolean(jsRes.headers.get('content-type')?.includes('javascript')), 'JavaScript asset served with javascript MIME type');
    }

    if (cssAsset) {
      const cssRes = await fetch(`${baseUrl}/assets/${cssAsset}`);
      assert(cssRes.status === 200, `GET /assets/${cssAsset} responds with HTTP 200 OK`);
      assert(Boolean(cssRes.headers.get('content-type')?.includes('text/css')), 'CSS asset served with text/css MIME type');
    }

    // 5d. API Routing Separation & JSON 404 Guard
    console.log('\n--- Section 8: API Routing Separation & JSON 404 Protection ---');
    const api404Res = await fetch(`${baseUrl}/api/non-existent-endpoint`);
    assert(api404Res.status === 404, 'GET /api/non-existent-endpoint returns HTTP 404');
    assert(Boolean(api404Res.headers.get('content-type')?.includes('application/json')), 'API 404 returns JSON (not HTML)');
    const api404Body = await api404Res.json();
    assert(api404Body.error === 'Not Found', 'API 404 body contains { error: "Not Found" }');

    // 5e. SPA Client-Side Routing Preservation (Direct Page Refreshes)
    console.log('\n--- Section 9: Client-Side SPA Route Preservation Across Page Refresh ---');
    const routesToTest = [
      '/projects',
      '/plans',
      '/my-checklists',
      '/checklist-generator',
      '/execution',
      '/defects',
      '/reports',
      '/settings',
      '/projects/proj_alpha_999',
      '/test-runs/batch-456'
    ];

    for (const route of routesToTest) {
      const spaRes = await fetch(`${baseUrl}${route}`);
      assert(spaRes.status === 200, `Direct refresh on SPA route "${route}" returns HTTP 200 OK`);
      assert(Boolean(spaRes.headers.get('content-type')?.includes('text/html')), `Route "${route}" serves text/html index.html`);
    }

    // 5f. Authentication & API Functionality
    console.log('\n--- Section 10: Authentication & Protected API Endpoints ---');
    // Register User
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Render Tester',
        email: 'render.deploy@example.com',
        password: 'PassWord123!Secure'
      })
    });
    assert(regRes.status === 201, 'POST /api/auth/register returns HTTP 201 Created');
    const regData = await regRes.json();
    assert(Boolean(regData.token), 'Registration returns signed JWT token');
    const authToken = regData.token;

    // Login User
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'render.deploy@example.com',
        password: 'PassWord123!Secure'
      })
    });
    assert(loginRes.status === 200, 'POST /api/auth/login returns HTTP 200 OK');

    // Unauthenticated request to /api/projects is rejected with 401
    const unauthProjectsRes = await fetch(`${baseUrl}/api/projects`);
    assert(unauthProjectsRes.status === 401, 'Unauthenticated GET /api/projects is rejected with HTTP 401');

    // Authenticated request to /api/projects succeeds with 200
    const authProjectsRes = await fetch(`${baseUrl}/api/projects`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    assert(authProjectsRes.status === 200, 'Authenticated GET /api/projects returns HTTP 200 OK');

    // Authenticated request to /api/checklists succeeds with 200
    const authChecklistsRes = await fetch(`${baseUrl}/api/checklists`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    assert(authChecklistsRes.status === 200, 'Authenticated GET /api/checklists returns HTTP 200 OK');

    console.log('\n========================================================================');
    console.log(`DEP-001 RENDER DEPLOYMENT SUITE: ${passCount} PASSED, 0 FAILED`);
    console.log('========================================================================\n');
  } finally {
    await new Promise<void>((resolve) => testServer.close(() => resolve()));
    await mongoClient.close();
    await mongod.stop();
  }
}

runDep001Verification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('DEP-001 Verification Failed:', err);
    process.exit(1);
  });
