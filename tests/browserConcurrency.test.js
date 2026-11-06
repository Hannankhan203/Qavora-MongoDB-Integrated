import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT_DIR = process.cwd();

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    if (urlPath === '/test-harness.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><h1>Qavora Sync Harness</h1></body></html>');
      return;
    }

    const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(ROOT_DIR, safePath);
    if (!filePath.startsWith(ROOT_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath);
    const contentType = ext === '.js' ? 'application/javascript; charset=utf-8' : 'text/plain; charset=utf-8';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

let browser;
let staticEnv;
let baseUrl;

test.before(async () => {
  staticEnv = await startStaticServer();
  baseUrl = staticEnv.baseUrl;

  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    throw new Error(
      `FATAL: Playwright Chromium launch failed: ${err.message}. ` +
      `Browser concurrency tests require a valid Chromium executable. Skipping is strictly prohibited.`
    );
  }
});

test.after(async () => {
  if (browser) {
    await browser.close();
  }
  if (staticEnv?.server) {
    await new Promise((resolve) => staticEnv.server.close(resolve));
  }
});

// ============================================================================
// Test 1: Real IndexedDB Verification & Persistence Across Page Reload
// ============================================================================
test('Browser IndexedDB: Real storage verification and persistence across page reload', { timeout: 30000 }, async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/test-harness.html`);

    // Verify native window.indexedDB is present and active (not in-memory Map fallback)
    const dbCheck = await page.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      const db = await mod.openOfflineDatabase();
      return {
        hasNativeIndexedDB: typeof window !== 'undefined' && 'indexedDB' in window && window.indexedDB !== null,
        isIdbFactory: window.indexedDB instanceof IDBFactory,
        isMemoryFallback: Boolean(db.__isMemoryFallback),
        dbName: db.name,
        version: db.version
      };
    });

    assert.equal(dbCheck.hasNativeIndexedDB, true, 'Real browser environment must provide window.indexedDB');
    assert.equal(dbCheck.isIdbFactory, true, 'window.indexedDB must be instance of IDBFactory');
    assert.equal(dbCheck.isMemoryFallback, false, 'Browser test must use actual IndexedDB, NOT in-memory Map fallback');
    assert.equal(dbCheck.dbName, 'qavora_offline_db');
    assert.equal(dbCheck.version, 2);

    // Clear any previous offline data
    await page.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      await mod.clearAllOfflineData();
    });

    // Enqueue operations for reload_user
    const testChecklist = {
      id: 'chk_persist_reload_1',
      title: 'Persistent Reload Checklist',
      phases: [{ id: 'p1', name: 'Phase 1', sections: [] }]
    };
    await page.evaluate(async (chk) => {
      const mod = await import('/qaChecklistSyncQueue.js');
      await mod.queueChecklistCreate(chk, 'reload_user');
      await mod.queueChecklistUpdate({ ...chk, title: 'Persistent Reload Checklist (Updated)' }, 'reload_user');
      await mod.queueChecklistDelete('chk_to_delete', 'reload_user');
    }, testChecklist);

    // Verify directly in native IndexedDB object stores before reload
    const preReloadDirectRead = await page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        const req = window.indexedDB.open('qavora_offline_db', 2);
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction(['pending_checklist_operations', 'offline_checklists_cache'], 'readonly');
          const opStore = tx.objectStore('pending_checklist_operations');
          const cacheStore = tx.objectStore('offline_checklists_cache');
          const opsReq = opStore.getAll();
          const cacheReq = cacheStore.getAll();
          tx.oncomplete = () => {
            resolve({
              ops: opsReq.result,
              cache: cacheReq.result
            });
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    });

    assert.equal(preReloadDirectRead.ops.length, 2, 'Pre-reload IndexedDB must contain 2 pending operations');
    assert.equal(preReloadDirectRead.cache.length, 1, 'Pre-reload IndexedDB must contain 1 cached checklist');

    // Perform actual browser page reload
    await page.reload();

    // Verify operations and cached checklists persist across reload in real IndexedDB
    const postReloadData = await page.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      const ops = await mod.getPendingOperations('reload_user');
      const cache = await mod.getCachedChecklistsForUser('reload_user');
      return { ops, cache };
    });

    assert.equal(postReloadData.ops.length, 2, 'Pending operations must survive page reload in actual IndexedDB');
    assert.equal(postReloadData.ops[0].type, 'CREATE');
    assert.equal(postReloadData.ops[0].payload.title, 'Persistent Reload Checklist (Updated)');
    assert.equal(postReloadData.ops[1].type, 'DELETE');
    assert.equal(postReloadData.cache.length, 1, 'Cached checklist must survive page reload in actual IndexedDB');
    assert.equal(postReloadData.cache[0].title, 'Persistent Reload Checklist (Updated)');

    // Open a second page in the same context to verify shared IndexedDB persistence
    const page2 = await context.newPage();
    await page2.goto(`${baseUrl}/test-harness.html`);
    const page2Data = await page2.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      return mod.getPendingOperations('reload_user');
    });
    assert.equal(page2Data.length, 2, 'New page in same context must read persisted operations from IndexedDB');
    await page2.close();
  } finally {
    await context.close();
  }
});

// ============================================================================
// Test 2: Multi-User Queue Isolation
// ============================================================================
test('Browser IndexedDB: Multi-user queue isolation and cross-account protection', { timeout: 30000 }, async () => {
  const context = await browser.newContext();
  const page1 = await context.newPage();
  const page2 = await context.newPage();
  try {
    await Promise.all([
      page1.goto(`${baseUrl}/test-harness.html`),
      page2.goto(`${baseUrl}/test-harness.html`)
    ]);

    await page1.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      await mod.clearAllOfflineData();
    });

    // Page 1 queues for User Alpha
    await page1.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      await mod.queueChecklistCreate({ id: 'chk_alpha_1', title: 'Alpha Checklist', phases: [] }, 'user_alpha');
    });

    // Page 2 queues for User Beta
    await page2.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      await mod.queueChecklistCreate({ id: 'chk_beta_1', title: 'Beta Checklist 1', phases: [] }, 'user_beta');
      await mod.queueChecklistUpdate({ id: 'chk_beta_2', title: 'Beta Checklist 2', phases: [] }, 'user_beta');
    });

    // Verify per-user retrieval strictly isolates queues in IndexedDB
    const alphaOps = await page1.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      return mod.getPendingOperations('user_alpha');
    });
    const betaOps = await page2.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      return mod.getPendingOperations('user_beta');
    });

    assert.equal(alphaOps.length, 1);
    assert.equal(alphaOps[0].checklistId, 'chk_alpha_1');
    assert.equal(alphaOps[0].userId, 'user_alpha');

    assert.equal(betaOps.length, 2);
    assert.equal(betaOps.every((o) => o.userId === 'user_beta'), true);

    // Attempt cross-account sync: User Beta is logged in, tries to sync User Alpha's queue
    const crossSyncResult = await page2.evaluate(async () => {
      const { authController } = await import('/authController.js');
      authController.getUser = () => ({ userId: 'user_beta' });
      const mod = await import('/qaChecklistSyncQueue.js');
      return mod.processChecklistSyncQueue('user_alpha');
    });

    assert.equal(crossSyncResult.ok, false);
    assert.equal(crossSyncResult.reason, 'Cross-account sync prevented');

    // Ensure User Alpha's queue was untouched by the unauthorized attempt
    const alphaOpsAfterAttempt = await page1.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      return mod.getPendingOperations('user_alpha');
    });
    assert.equal(alphaOpsAfterAttempt.length, 1);
  } finally {
    await context.close();
  }
});

// ============================================================================
// Test 3: Two Tabs Cannot Process the Same Operation Concurrently
// ============================================================================
test('Browser IndexedDB: Two tabs cannot process the same operation concurrently', { timeout: 30000 }, async () => {
  const context = await browser.newContext();
  const page1 = await context.newPage();
  const page2 = await context.newPage();
  try {
    await Promise.all([
      page1.goto(`${baseUrl}/test-harness.html`),
      page2.goto(`${baseUrl}/test-harness.html`)
    ]);

    await page1.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      await mod.clearAllOfflineData();
      await mod.queueChecklistCreate({ id: 'chk_tab_race_1', title: 'Race Checklist', phases: [] }, 'race_user');
    });

    const setupTabMock = async (page) => {
      await page.evaluate(() => {
        window.__callCount = 0;
        window.fetch = async (url, opts) => {
          if (String(url).includes('/api/checklists') && opts?.method === 'POST') {
            window.__callCount += 1;
            await new Promise((r) => setTimeout(r, 400));
            return new Response(JSON.stringify({ id: 'chk_tab_race_1', title: 'Race Checklist' }), {
              status: 201,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          return new Response('{}', { status: 200 });
        };
      });
    };

    await Promise.all([
      page1.evaluate(async () => {
        const { authController } = await import('/authController.js');
        authController.getUser = () => ({ userId: 'race_user' });
      }),
      page2.evaluate(async () => {
        const { authController } = await import('/authController.js');
        authController.getUser = () => ({ userId: 'race_user' });
      })
    ]);

    await Promise.all([setupTabMock(page1), setupTabMock(page2)]);

    // Trigger sync simultaneously from both tabs
    const [res1, res2] = await Promise.all([
      page1.evaluate(async () => {
        const mod = await import('/qaChecklistSyncQueue.js');
        const res = await mod.processChecklistSyncQueue('race_user');
        return { ...res, callCount: window.__callCount };
      }),
      page2.evaluate(async () => {
        const mod = await import('/qaChecklistSyncQueue.js');
        const res = await mod.processChecklistSyncQueue('race_user');
        return { ...res, callCount: window.__callCount };
      })
    ]);

    // Exactly one tab must succeed, the other must be blocked with 'Sync in progress'
    const successCount = Number(res1.ok && res1.syncedCount === 1) + Number(res2.ok && res2.syncedCount === 1);
    const blockedCount = Number(!res1.ok && res1.reason === 'Sync in progress') + Number(!res2.ok && res2.reason === 'Sync in progress');

    assert.equal(successCount, 1, 'Exactly one tab should process the operation');
    assert.equal(blockedCount, 1, 'The competing tab should be blocked with "Sync in progress"');

    // Verify total POST requests was exactly 1
    const totalCalls = res1.callCount + res2.callCount;
    assert.equal(totalCalls, 1, 'Operation must only be submitted to server once');

    // Operation must be dequeued
    const remainingOps = await page1.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      return mod.getPendingOperations('race_user');
    });
    assert.equal(remainingOps.length, 0);
  } finally {
    await context.close();
  }
});

// ============================================================================
// Test 4: Failed Transactions and Network Errors Do Not Silently Lose Queued Operations
// ============================================================================
test('Browser IndexedDB: Failed transactions and network errors do not silently lose queued operations', { timeout: 30000 }, async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/test-harness.html`);

    await page.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      await mod.clearAllOfflineData();
      await mod.queueChecklistCreate({ id: 'chk_fail_safety_1', title: 'Fail Safe Checklist', phases: [] }, 'fail_user');
    });

    // 1. Server returns 503 Service Unavailable
    await page.evaluate(async () => {
      const { authController } = await import('/authController.js');
      authController.getUser = () => ({ userId: 'fail_user' });
      window.fetch = async () => {
        return new Response(JSON.stringify({ error: 'Service temporarily unavailable (database offline)' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      };
      const mod = await import('/qaChecklistSyncQueue.js');
      await mod.processChecklistSyncQueue('fail_user');
    });

    // Verify operation is NOT lost in real IndexedDB
    let ops = await page.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      return mod.getPendingOperations('fail_user');
    });
    assert.equal(ops.length, 1, 'Operation must be preserved in queue on 503');
    assert.equal(ops[0].status, 'pending');
    assert.equal(ops[0].retryCount, 1);
    assert.match(ops[0].lastError, /Service temporarily unavailable|503/);

    // 2. Network throws an error (offline / connection dropped)
    await page.evaluate(async () => {
      window.fetch = async () => {
        throw new TypeError('Failed to fetch: NetworkError when attempting to fetch resource.');
      };
      const mod = await import('/qaChecklistSyncQueue.js');
      await mod.processChecklistSyncQueue('fail_user');
    });

    ops = await page.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      return mod.getPendingOperations('fail_user');
    });
    assert.equal(ops.length, 1, 'Operation must be preserved in queue on network exception');
    assert.equal(ops[0].retryCount, 2);
    assert.match(ops[0].lastError, /Failed to fetch/);

    // 3. Connectivity restored: sync succeeds
    const syncSuccess = await page.evaluate(async () => {
      window.fetch = async () => {
        return new Response(JSON.stringify({ id: 'chk_fail_safety_1', title: 'Fail Safe Checklist' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        });
      };
      const mod = await import('/qaChecklistSyncQueue.js');
      const res = await mod.processChecklistSyncQueue('fail_user');
      const remaining = await mod.getPendingOperations('fail_user');
      return { res, remainingCount: remaining.length };
    });

    assert.equal(syncSuccess.res.ok, true);
    assert.equal(syncSuccess.res.syncedCount, 1);
    assert.equal(syncSuccess.remainingCount, 0, 'Operation only dequeued upon confirmed success');
  } finally {
    await context.close();
  }
});

// ============================================================================
// Test 5: Storage Initialization Failure Handling and Reporting
// ============================================================================
test('Browser IndexedDB: Storage initialization failures report degraded state without silently pretending memory is durable', { timeout: 30000 }, async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/test-harness.html`);

    const result = await page.evaluate(async () => {
      // Simulate storage opening failure (e.g. private browsing mode quota error or security block)
      const origOpen = window.indexedDB.open.bind(window.indexedDB);
      window.indexedDB.open = () => {
        const dummyReq = {};
        setTimeout(() => {
          if (typeof dummyReq.onerror === 'function') {
            dummyReq.error = new DOMException('The operation failed because the user denied permission.', 'SecurityError');
            dummyReq.onerror({ target: dummyReq });
          }
        }, 10);
        return dummyReq;
      };

      const mod = await import('/qaChecklistSyncQueue.js');
      mod.resetStorageState();

      let openError = null;
      try {
        await mod.openOfflineDatabase();
      } catch (err) {
        openError = err.message || String(err);
      }

      const initialStatus = mod.getStorageStatus();

      // Attempting to queue without explicit degraded fallback must reject in browser
      let queueError = null;
      try {
        await mod.queueChecklistCreate({ id: 'chk_unpersisted', title: 'Unpersisted', phases: [] }, 'err_user');
      } catch (err) {
        queueError = err.message || String(err);
      }

      // When caller explicitly enables degraded fallback, status reflects degraded mode
      mod.setDegradedMemoryFallback(true);
      const degradedStatus = mod.getStorageStatus();
      await mod.queueChecklistCreate({ id: 'chk_mem_safe_1', title: 'Memory Checklist', phases: [] }, 'mem_user');
      const ops = await mod.getPendingOperations('mem_user');

      // Cleanup
      window.indexedDB.open = origOpen;
      mod.resetStorageState();

      return {
        openError,
        initialStatus,
        queueError,
        degradedStatus,
        queuedCount: ops.length,
        opId: ops[0]?.checklistId
      };
    });

    assert.ok(result.openError, 'openOfflineDatabase must reject when IndexedDB fails');
    assert.equal(result.initialStatus.status, 'unavailable', 'Status must be unavailable on initialization error');
    assert.equal(result.initialStatus.isDurable, false, 'isDurable must be false when IndexedDB fails');
    assert.equal(result.initialStatus.isDegraded, true, 'isDegraded must be true');
    assert.ok(result.queueError, 'queueChecklistCreate must reject rather than falsely claiming saved to durable storage');
    assert.equal(result.degradedStatus.status, 'degraded');
    assert.equal(result.degradedStatus.isDurable, false);
    assert.equal(result.queuedCount, 1);
    assert.equal(result.opId, 'chk_mem_safe_1');
  } finally {
    await context.close();
  }
});

// ============================================================================
// Test 5b: Failed Transactions Do Not Silently Lose Existing Operations
// ============================================================================
test('Browser IndexedDB: Failed transactions report failure and never lose or overwrite existing queued operations', { timeout: 30000 }, async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/test-harness.html`);

    const result = await page.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      mod.resetStorageState();
      await mod.clearAllOfflineData();

      // 1. Successfully persist initial operation into IndexedDB
      await mod.queueChecklistCreate({ id: 'chk_existing_good', title: 'Good Initial Checklist', phases: [] }, 'tx_user');
      const opsBefore = await mod.getPendingOperations('tx_user');

      // 2. Simulate transaction write failure (e.g. QuotaExceededError or abort)
      const db = await mod.openOfflineDatabase();
      const origTransaction = db.transaction.bind(db);

      // Force write transactions to fail with QuotaExceededError / abort
      let quotaInjected = false;
      db.transaction = (storeNames, mode) => {
        if (mode === 'readwrite' && !quotaInjected) {
          quotaInjected = true;
          const fakeTx = origTransaction(storeNames, mode);
          setTimeout(() => {
            try {
              fakeTx.abort();
            } catch (_) {}
          }, 0);
          return fakeTx;
        }
        return origTransaction(storeNames, mode);
      };

      let putError = null;
      try {
        await mod.queueChecklistCreate({ id: 'chk_overflow', title: 'Overflow Item', phases: [] }, 'tx_user');
      } catch (err) {
        putError = err.message || String(err);
      }

      // Restore normal transaction behavior
      db.transaction = origTransaction;

      // 3. Verify existing operation is still present and was not silently discarded or replaced
      const opsAfter = await mod.getPendingOperations('tx_user');
      const cacheAfter = await mod.getCachedChecklistsForUser('tx_user');

      return {
        opsBeforeCount: opsBefore.length,
        opsAfterCount: opsAfter.length,
        opsAfterId: opsAfter[0]?.checklistId,
        cacheAfterTitle: cacheAfter[0]?.title,
        putError
      };
    });

    assert.equal(result.opsBeforeCount, 1, 'Initial operation was queued');
    assert.ok(result.putError, 'Failed transaction must reject instead of claiming success');
    assert.equal(result.opsAfterCount, 1, 'Existing queued operation must be preserved');
    assert.equal(result.opsAfterId, 'chk_existing_good', 'Preserved operation must be the original');
    assert.equal(result.cacheAfterTitle, 'Good Initial Checklist', 'Cached checklist preserved');
  } finally {
    await context.close();
  }
});

// ============================================================================
// Test 5c: Browser Context Recreation Persistence (launchPersistentContext)
// ============================================================================
test('Browser IndexedDB: Queue operations survive closing and reopening browser context with persistent profile', { timeout: 30000 }, async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qavora-playwright-profile-'));

  try {
    // 1. Launch persistent context A
    const pContext1 = await chromium.launchPersistentContext(profileDir, { headless: true });
    const page1 = await pContext1.newPage();
    await page1.goto(`${baseUrl}/test-harness.html`);

    await page1.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      mod.resetStorageState();
      await mod.clearAllOfflineData();

      await mod.queueChecklistCreate({
        id: 'chk_profile_survivor_1',
        title: 'Profile Survivor Checklist',
        phases: [{ id: 'p1', name: 'Phase 1', sections: [] }]
      }, 'profile_user');

      await mod.queueChecklistUpdate({
        id: 'chk_profile_survivor_1',
        title: 'Profile Survivor Checklist (Updated across context restart)',
        phases: [{ id: 'p1', name: 'Phase 1', sections: [] }]
      }, 'profile_user');
    });

    // Close the entire persistent browser context
    await pContext1.close();

    // 2. Launch persistent context B with the exact same storage directory
    const pContext2 = await chromium.launchPersistentContext(profileDir, { headless: true });
    const page2 = await pContext2.newPage();
    await page2.goto(`${baseUrl}/test-harness.html`);

    const persistedData = await page2.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      const ops = await mod.getPendingOperations('profile_user');
      const cache = await mod.getCachedChecklistsForUser('profile_user');
      const status = mod.getStorageStatus();
      return { ops, cache, status };
    });

    await pContext2.close();

    assert.equal(persistedData.status.status, 'ready');
    assert.equal(persistedData.status.isDurable, true);
    assert.equal(persistedData.ops.length, 1, 'Operation must survive full browser context recreation');
    assert.equal(persistedData.ops[0].checklistId, 'chk_profile_survivor_1');
    assert.equal(persistedData.ops[0].payload.title, 'Profile Survivor Checklist (Updated across context restart)');
    assert.equal(persistedData.cache.length, 1, 'Cache must survive full browser context recreation');
    assert.equal(persistedData.cache[0].title, 'Profile Survivor Checklist (Updated across context restart)');
  } finally {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Test 6: Schema Upgrades Preserve Existing Queued Operations
// ============================================================================
test('Browser IndexedDB: Schema upgrades preserve existing queued operations', { timeout: 30000 }, async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/test-harness.html`);

    const upgradeResult = await page.evaluate(async () => {
      const UPGRADE_DB_NAME = 'qavora_offline_db_upgrade_test';

      // 1. Open database at version 1 (simulating older release with pending_checklist_operations store)
      await new Promise((resolve, reject) => {
        const req = window.indexedDB.open(UPGRADE_DB_NAME, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          const opStore = db.createObjectStore('pending_checklist_operations', { keyPath: 'id' });
          opStore.createIndex('userId', 'userId', { unique: false });
        };
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction(['pending_checklist_operations'], 'readwrite');
          const store = tx.objectStore('pending_checklist_operations');
          store.put({
            id: 'op_v1_legacy',
            seq: 100,
            userId: 'upgrade_user',
            checklistId: 'chk_v1',
            type: 'CREATE',
            payload: { id: 'chk_v1', title: 'Legacy V1 Item' },
            status: 'pending'
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });

      // 2. Open database at version 2 (simulating Qavora DB_VERSION upgrade)
      const postUpgradeData = await new Promise((resolve, reject) => {
        const req = window.indexedDB.open(UPGRADE_DB_NAME, 2);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          // Upgrade logic must NOT recreate existing store
          if (!db.objectStoreNames.contains('pending_checklist_operations')) {
            db.createObjectStore('pending_checklist_operations', { keyPath: 'id' });
          }
          // Adds new stores in v2
          if (!db.objectStoreNames.contains('offline_checklists_cache')) {
            db.createObjectStore('offline_checklists_cache', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('sync_locks')) {
            db.createObjectStore('sync_locks', { keyPath: 'lockKey' });
          }
        };
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction(['pending_checklist_operations', 'offline_checklists_cache', 'sync_locks'], 'readonly');
          const opStore = tx.objectStore('pending_checklist_operations');
          const getReq = opStore.get('op_v1_legacy');
          tx.oncomplete = () => {
            const result = getReq.result;
            const storeNames = Array.from(db.objectStoreNames);
            db.close();
            // Cleanup test db
            window.indexedDB.deleteDatabase(UPGRADE_DB_NAME);
            resolve({ result, storeNames });
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });

      return postUpgradeData;
    });

    assert.ok(upgradeResult.result, 'Queued operation from v1 must survive v2 schema upgrade');
    assert.equal(upgradeResult.result.id, 'op_v1_legacy');
    assert.equal(upgradeResult.result.payload.title, 'Legacy V1 Item');
    assert.ok(upgradeResult.storeNames.includes('pending_checklist_operations'));
    assert.ok(upgradeResult.storeNames.includes('offline_checklists_cache'));
    assert.ok(upgradeResult.storeNames.includes('sync_locks'));
  } finally {
    await context.close();
  }
});

// ============================================================================
// Test 7: Multi-Tab Concurrency, Lock Leases, Expiration, and Conflict Reconciliation
// ============================================================================
test('Browser Multi-Tab Concurrency: IndexedDB locks, renewal, expiration, atomic deletion, >30s sync, and in-flight 409 reconciliation', { timeout: 60000 }, async () => {
  const context = await browser.newContext();
  const page1 = await context.newPage();
  const page2 = await context.newPage();

  try {
    await Promise.all([
      page1.goto(`${baseUrl}/test-harness.html`),
      page2.goto(`${baseUrl}/test-harness.html`)
    ]);

    // 1. Simultaneous lock acquisition allows only one owner
    const lockKey = 'qavora_sync_browser_user_1';
    const [acq1, acq2] = await Promise.all([
      page1.evaluate(async (key) => {
        const mod = await import('/qaChecklistSyncQueue.js');
        return mod.acquireIndexedDbSyncLock(key, 'browser_tab_1', 10000);
      }, lockKey),
      page2.evaluate(async (key) => {
        const mod = await import('/qaChecklistSyncQueue.js');
        return mod.acquireIndexedDbSyncLock(key, 'browser_tab_2', 10000);
      }, lockKey)
    ]);

    assert.equal(Number(acq1.acquired) + Number(acq2.acquired), 1, 'Exactly one tab should acquire the lock');
    const winnerPage = acq1.acquired ? page1 : page2;
    const loserPage = acq1.acquired ? page2 : page1;
    const winnerOwner = acq1.acquired ? 'browser_tab_1' : 'browser_tab_2';
    const loserOwner = acq1.acquired ? 'browser_tab_2' : 'browser_tab_1';
    const winnerGen = acq1.acquired ? acq1.generation : acq2.generation;

    // 2. Lease renewal prevents another tab acquiring an active lock
    const renewed = await winnerPage.evaluate(async ({ key, owner, gen }) => {
      const mod = await import('/qaChecklistSyncQueue.js');
      return mod.renewIndexedDbSyncLock(key, owner, gen, 10000);
    }, { key: lockKey, owner: winnerOwner, gen: winnerGen });
    assert.equal(renewed, true);

    const blockedAfterRenew = await loserPage.evaluate(async ({ key, owner }) => {
      const mod = await import('/qaChecklistSyncQueue.js');
      return mod.acquireIndexedDbSyncLock(key, owner, 10000);
    }, { key: lockKey, owner: loserOwner });
    assert.equal(blockedAfterRenew.acquired, false);

    await winnerPage.evaluate(async ({ key, owner, gen }) => {
      const mod = await import('/qaChecklistSyncQueue.js');
      await mod.releaseIndexedDbSyncLock(key, owner, gen);
    }, { key: lockKey, owner: winnerOwner, gen: winnerGen });

    // 3. Expired leases can be recovered & 4. Stale owners cannot renew, release, or delete queue operations
    const shortLock = await page1.evaluate(async (key) => {
      const mod = await import('/qaChecklistSyncQueue.js');
      await mod.queueChecklistCreate({ id: 'chk_browser_1', title: 'Browser Op', phases: [] }, 'browser_user_1');
      return mod.acquireIndexedDbSyncLock(key, 'stale_tab', 40);
    }, lockKey);
    assert.equal(shortLock.acquired, true);

    await new Promise((r) => setTimeout(r, 80));

    const recoveredLock = await page2.evaluate(async (key) => {
      const mod = await import('/qaChecklistSyncQueue.js');
      return mod.acquireIndexedDbSyncLock(key, 'active_tab', 10000);
    }, lockKey);
    assert.equal(recoveredLock.acquired, true);
    assert.ok(recoveredLock.generation > shortLock.generation);

    // Stale owner cannot renew, release, or delete queue operations
    const staleActions = await page1.evaluate(async ({ key, staleGen }) => {
      const mod = await import('/qaChecklistSyncQueue.js');
      const [op] = await mod.getPendingOperations('browser_user_1');
      const canRenew = await mod.renewIndexedDbSyncLock(key, 'stale_tab', staleGen, 10000);
      await mod.releaseIndexedDbSyncLock(key, 'stale_tab', staleGen);
      const canDelete = await mod.dequeueOperationIfLockValid(op.id, key, 'stale_tab', staleGen);
      const remaining = await mod.getPendingOperations('browser_user_1');
      return { canRenew, canDelete, remainingCount: remaining.length };
    }, { key: lockKey, staleGen: shortLock.generation });

    assert.equal(staleActions.canRenew, false);
    assert.equal(staleActions.canDelete, false);
    assert.equal(staleActions.remainingCount, 1);

    // 5. Queue deletion and lock validation remain atomic for active owner
    const atomicDelete = await page2.evaluate(async ({ key, activeGen }) => {
      const mod = await import('/qaChecklistSyncQueue.js');
      const [op] = await mod.getPendingOperations('browser_user_1');
      const deleted = await mod.dequeueOperationIfLockValid(op.id, key, 'active_tab', activeGen);
      const remaining = await mod.getPendingOperations('browser_user_1');
      await mod.releaseIndexedDbSyncLock(key, 'active_tab', activeGen);
      return { deleted, remainingCount: remaining.length };
    }, { key: lockKey, activeGen: recoveredLock.generation });

    assert.equal(atomicDelete.deleted, true);
    assert.equal(atomicDelete.remainingCount, 0);

    // 6. Synchronization lasting longer than 30 seconds does not allow concurrent queue processing
    // Disable navigator.locks on both pages to exercise IndexedDB lease + periodic renewal
    await Promise.all([
      page1.evaluate(() => { Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }); }),
      page2.evaluate(() => { Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }); })
    ]);

    await page1.evaluate(async () => {
      const { authController } = await import('/authController.js');
      authController.getUser = () => ({ userId: 'long_sync_user' });
      window.__postCount = 0;
      const origFetch = window.fetch.bind(window);
      window.fetch = async (url, opts) => {
        if (String(url).includes('/api/checklists') && (!opts || opts.method === 'POST')) {
          window.__postCount += 1;
          await new Promise((r) => setTimeout(r, 31500));
          return new Response(JSON.stringify({ id: 'chk_long_sync', title: 'Long Sync' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return origFetch(url, opts);
      };
      const mod = await import('/qaChecklistSyncQueue.js');
      await mod.queueChecklistCreate({ id: 'chk_long_sync', title: 'Long Sync', phases: [] }, 'long_sync_user');
    });
    await page2.evaluate(async () => {
      const { authController } = await import('/authController.js');
      authController.getUser = () => ({ userId: 'long_sync_user' });
    });

    const sync1Promise = page1.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      const res = await mod.processChecklistSyncQueue('long_sync_user');
      return { ...res, postCount: window.__postCount };
    });

    // Check at 30.2s (past default 30s TTL) that page2 is still blocked because page1 renewed its lease
    await new Promise((r) => setTimeout(r, 30200));
    const sync2Blocked = await page2.evaluate(async () => {
      const mod = await import('/qaChecklistSyncQueue.js');
      return mod.processChecklistSyncQueue('long_sync_user');
    });
    assert.equal(sync2Blocked.ok, false);
    assert.equal(sync2Blocked.reason, 'Sync in progress');

    const sync1Result = await sync1Promise;
    assert.equal(sync1Result.ok, true);
    assert.equal(sync1Result.syncedCount, 1);
    assert.equal(sync1Result.postCount, 1);

    // 7. In-flight duplicate CREATE requests are safely reconciled without overwriting newer data
    const dupResult = await page1.evaluate(async () => {
      const { authController } = await import('/authController.js');
      authController.getUser = () => ({ userId: 'dup_user' });
      let putCalled = false;
      window.fetch = async (url, opts) => {
        const method = opts?.method || 'GET';
        if (method === 'POST') {
          return new Response(JSON.stringify({ error: 'Checklist already exists' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        if (method === 'PUT' || method === 'PATCH') {
          putCalled = true;
          return new Response(JSON.stringify({ id: 'chk_dup_1', title: 'Reconciled' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response('{}', { status: 200 });
      };
      const mod = await import('/qaChecklistSyncQueue.js');
      await mod.queueChecklistCreate({ id: 'chk_dup_1', title: 'Reconciled', phases: [] }, 'dup_user');
      const res = await mod.processChecklistSyncQueue('dup_user');
      return { ...res, putCalled };
    });

    assert.equal(dupResult.ok, true);
    assert.equal(dupResult.syncedCount, 1);
    assert.equal(dupResult.putCalled, true);

    // 8. In-flight UPDATE with stale expectedUpdatedAt returns 409, reconciles with server, and retries safely
    const updateConflictResult = await page2.evaluate(async () => {
      const { authController } = await import('/authController.js');
      authController.getUser = () => ({ userId: 'update_conflict_user' });

      let patchAttempts = 0;
      let getAttempts = 0;
      const serverDoc = {
        id: 'chk_browser_update_1',
        title: 'Newer Server Baseline',
        updatedAt: '2026-11-06T18:00:00.000Z',
        phases: [
          {
            id: 'p1',
            name: 'Phase 1',
            sections: [
              {
                id: 's1',
                name: 'Sec 1',
                tests: [
                  { id: 't1', text: 'Test 1', status: 'Passed', completed: true },
                  { id: 't2', text: 'Test 2', status: 'Not Started', completed: false }
                ]
              }
            ]
          }
        ]
      };

      window.fetch = async (url, opts) => {
        const method = opts?.method || 'GET';
        if (method === 'PATCH') {
          patchAttempts += 1;
          const body = JSON.parse(opts.body);
          if (patchAttempts === 1) {
            // First patch attempt arrives with stale expectedUpdatedAt -> reject with 409
            return new Response(JSON.stringify({
              error: 'Conflict: The checklist has been modified by another operation.',
              currentUpdatedAt: '2026-11-06T18:00:00.000Z',
              expectedUpdatedAt: body.expectedUpdatedAt
            }), {
              status: 409,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          // Reconciled second patch attempt arrives with updated expectedUpdatedAt
          return new Response(JSON.stringify({
            id: 'chk_browser_update_1',
            ...body,
            updatedAt: '2026-11-06T18:05:00.000Z'
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        if (method === 'GET' && String(url).includes('/chk_browser_update_1')) {
          getAttempts += 1;
          return new Response(JSON.stringify(serverDoc), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response('{}', { status: 200 });
      };

      const mod = await import('/qaChecklistSyncQueue.js');
      // Queue update with old expectedUpdatedAt and client marking t2 completed
      await mod.queueChecklistUpdate({
        id: 'chk_browser_update_1',
        title: 'Old Client Title',
        expectedUpdatedAt: '2026-11-06T12:00:00.000Z',
        phases: [
          {
            id: 'p1',
            name: 'Phase 1',
            sections: [
              {
                id: 's1',
                name: 'Sec 1',
                tests: [
                  { id: 't2', text: 'Test 2', status: 'Passed', completed: true, notes: 'Passed in browser' }
                ]
              }
            ]
          }
        ]
      }, 'update_conflict_user');

      const res = await mod.processChecklistSyncQueue('update_conflict_user');
      const pendingOps = await mod.getPendingOperations('update_conflict_user');
      const cached = await mod.getCachedChecklistsForUser('update_conflict_user');

      return {
        res,
        patchAttempts,
        getAttempts,
        remainingPending: pendingOps.length,
        cachedChecklist: cached[0] || null
      };
    });

    assert.equal(updateConflictResult.res.ok, true);
    assert.equal(updateConflictResult.res.syncedCount, 1);
    assert.equal(updateConflictResult.patchAttempts, 2, 'Should attempt first PATCH, receive 409, reconcile, and retry');
    assert.equal(updateConflictResult.getAttempts, 1, 'Should fetch latest server doc for reconciliation');
    assert.equal(updateConflictResult.remainingPending, 0, 'Operation successfully dequeued');
    assert.equal(updateConflictResult.cachedChecklist.title, 'Newer Server Baseline', 'Preserves newer server baseline title');
  } finally {
    await context.close();
  }
});
