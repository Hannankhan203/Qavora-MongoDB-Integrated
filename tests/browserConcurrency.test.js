import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
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

test('Browser Multi-Tab Concurrency: IndexedDB locks, renewal, expiration, atomic deletion, >30s sync, and in-flight 409 reconciliation', { timeout: 60000 }, async () => {
  const { server, baseUrl } = await startStaticServer();
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();

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
  } finally {
    await browser.close();
    server.close();
  }
});
