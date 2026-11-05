/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Durable IndexedDB-based Synchronization Queue for QA Checklists (DAT-001)
 *
 * Requirements:
 * 1. Persists pending checklist creation, updates, execution results, and deletions in IndexedDB.
 * 2. Preserves pending operations across page refreshes, browser closures, browser restarts, logout, and server restarts.
 * 3. Restores queue and cached checklists after reload.
 * 4. Synchronizes automatically when connectivity returns and the correct user is authenticated.
 * 5. Strictly associates operations with user IDs to prevent cross-account leakage.
 * 6. Never discards pending operations because of network errors, 5xx/503 errors, or auth expiration.
 * 7. Prevents duplicate operations during retries with mutex lock and idempotent fallback.
 * 8. Preserves operation ordering (monotonic seq) and handles conflicts safely.
 * 9. Never deletes pending operations on logout.
 */

import { ChecklistAPI } from './qaChecklistStore.js';
import { authController } from './authController.js';

export const DB_NAME = 'qavora_offline_db';
export const DB_VERSION = 1;
export const STORE_OPERATIONS = 'pending_checklist_operations';
export const STORE_CACHE = 'offline_checklists_cache';

let dbInstance = null;
let dbOpenPromise = null;
let isSyncing = false;
let globalSeqCounter = Date.now();

function getNextSeq() {
  globalSeqCounter += 1;
  return globalSeqCounter;
}

function generateOpId(prefix = 'op') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// In-Memory Storage Fallback (for Headless Node.js Test Environments)
// ============================================================================
const memoryOperations = new Map();
const memoryChecklistsCache = new Map();

function hasNativeIndexedDB() {
  return typeof globalThis !== 'undefined' &&
    typeof globalThis.indexedDB !== 'undefined' &&
    globalThis.indexedDB !== null;
}

/**
 * Open or initialize the IndexedDB database
 */
export async function openOfflineDatabase() {
  if (dbInstance) {
    return dbInstance;
  }
  if (dbOpenPromise) {
    return dbOpenPromise;
  }

  if (!hasNativeIndexedDB()) {
    // Headless / memory fallback driver for Node test runs
    dbInstance = {
      __isMemoryFallback: true,
      close() {
        dbInstance = null;
      }
    };
    return dbInstance;
  }

  dbOpenPromise = new Promise((resolve, reject) => {
    try {
      const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. Pending operations queue store
        if (!db.objectStoreNames.contains(STORE_OPERATIONS)) {
          const opStore = db.createObjectStore(STORE_OPERATIONS, { keyPath: 'id' });
          opStore.createIndex('userId', 'userId', { unique: false });
          opStore.createIndex('checklistId', 'checklistId', { unique: false });
          opStore.createIndex('seq', 'seq', { unique: false });
          opStore.createIndex('status', 'status', { unique: false });
        }

        // 2. Offline checklists cache store (durable client backup across reloads)
        if (!db.objectStoreNames.contains(STORE_CACHE)) {
          const cacheStore = db.createObjectStore(STORE_CACHE, { keyPath: 'id' });
          cacheStore.createIndex('userId', 'userId', { unique: false });
          cacheStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        dbOpenPromise = null;

        dbInstance.onversionchange = () => {
          dbInstance.close();
          dbInstance = null;
        };

        resolve(dbInstance);
      };

      request.onerror = (event) => {
        console.warn('Qavora Offline DB open failed, falling back to in-memory queue:', event.target.error);
        dbOpenPromise = null;
        dbInstance = { __isMemoryFallback: true, close() { dbInstance = null; } };
        resolve(dbInstance);
      };

      request.onblocked = () => {
        console.warn('Qavora Offline DB open blocked.');
      };
    } catch (err) {
      console.warn('Qavora Offline DB initialization exception:', err);
      dbOpenPromise = null;
      dbInstance = { __isMemoryFallback: true, close() { dbInstance = null; } };
      resolve(dbInstance);
    }
  });

  return dbOpenPromise;
}

// ============================================================================
// Low-Level IndexedDB CRUD Helpers
// ============================================================================

async function idbGet(storeName, key) {
  const db = await openOfflineDatabase();
  if (db.__isMemoryFallback) {
    const store = storeName === STORE_OPERATIONS ? memoryOperations : memoryChecklistsCache;
    const item = store.get(String(key));
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

async function idbPut(storeName, value) {
  const db = await openOfflineDatabase();
  if (db.__isMemoryFallback) {
    const store = storeName === STORE_OPERATIONS ? memoryOperations : memoryChecklistsCache;
    store.set(String(value.id), JSON.parse(JSON.stringify(value)));
    return value.id;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

async function idbDelete(storeName, key) {
  const db = await openOfflineDatabase();
  if (db.__isMemoryFallback) {
    const store = storeName === STORE_OPERATIONS ? memoryOperations : memoryChecklistsCache;
    store.delete(String(key));
    return true;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

async function idbGetAll(storeName) {
  const db = await openOfflineDatabase();
  if (db.__isMemoryFallback) {
    const store = storeName === STORE_OPERATIONS ? memoryOperations : memoryChecklistsCache;
    return Array.from(store.values()).map(v => JSON.parse(JSON.stringify(v)));
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

async function idbClear(storeName) {
  const db = await openOfflineDatabase();
  if (db.__isMemoryFallback) {
    const store = storeName === STORE_OPERATIONS ? memoryOperations : memoryChecklistsCache;
    store.clear();
    return true;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

// ============================================================================
// High-Level Sync Queue Operations (Queue + Durable Cache)
// ============================================================================

/**
 * Enqueue a checklist creation operation
 */
export async function queueChecklistCreate(checklist, userId) {
  if (!checklist || !checklist.id || !userId) return null;

  const checklistId = String(checklist.id).trim();
  const normalizedUserId = String(userId).trim();
  const nowIso = new Date().toISOString();

  // Save durable copy in offline checklists cache
  await idbPut(STORE_CACHE, {
    ...checklist,
    userId: normalizedUserId,
    _offlineCachedAt: nowIso
  });

  // Check if an existing CREATE or UPDATE is already pending for this checklist
  const allOps = await idbGetAll(STORE_OPERATIONS);
  const existingOp = allOps.find(op => op.userId === normalizedUserId && op.checklistId === checklistId);

  if (existingOp) {
    // Coalesce payload into existing operation
    existingOp.payload = JSON.parse(JSON.stringify(checklist));
    existingOp.updatedAt = nowIso;
    existingOp.status = 'pending';
    await idbPut(STORE_OPERATIONS, existingOp);
    return existingOp;
  }

  const op = {
    id: generateOpId('op_create'),
    seq: getNextSeq(),
    userId: normalizedUserId,
    checklistId,
    type: 'CREATE',
    payload: JSON.parse(JSON.stringify(checklist)),
    status: 'pending',
    retryCount: 0,
    lastError: null,
    createdAt: nowIso,
    updatedAt: nowIso
  };

  await idbPut(STORE_OPERATIONS, op);
  return op;
}

/**
 * Enqueue a checklist update operation (title change, test checkbox toggle, phase updates)
 */
export async function queueChecklistUpdate(checklist, userId) {
  if (!checklist || !checklist.id || !userId) return null;

  const checklistId = String(checklist.id).trim();
  const normalizedUserId = String(userId).trim();
  const nowIso = new Date().toISOString();

  // Update durable copy in offline checklists cache
  await idbPut(STORE_CACHE, {
    ...checklist,
    userId: normalizedUserId,
    _offlineCachedAt: nowIso
  });

  const allOps = await idbGetAll(STORE_OPERATIONS);
  const existingOp = allOps.find(op => op.userId === normalizedUserId && op.checklistId === checklistId);

  if (existingOp) {
    // If pending CREATE or UPDATE exists, coalesce the newest state in-place
    existingOp.payload = JSON.parse(JSON.stringify(checklist));
    existingOp.updatedAt = nowIso;
    existingOp.status = 'pending';
    await idbPut(STORE_OPERATIONS, existingOp);
    return existingOp;
  }

  const op = {
    id: generateOpId('op_update'),
    seq: getNextSeq(),
    userId: normalizedUserId,
    checklistId,
    type: 'UPDATE',
    payload: JSON.parse(JSON.stringify(checklist)),
    status: 'pending',
    retryCount: 0,
    lastError: null,
    createdAt: nowIso,
    updatedAt: nowIso
  };

  await idbPut(STORE_OPERATIONS, op);
  return op;
}

/**
 * Enqueue a checklist deletion operation
 */
export async function queueChecklistDelete(checklistId, userId, isKnownOnServer = true) {
  if (!checklistId || !userId) return null;

  const cleanId = String(checklistId).trim();
  const normalizedUserId = String(userId).trim();
  const nowIso = new Date().toISOString();

  // Remove from durable cache
  await idbDelete(STORE_CACHE, cleanId);

  const allOps = await idbGetAll(STORE_OPERATIONS);
  const existingOp = allOps.find(op => op.userId === normalizedUserId && op.checklistId === cleanId);

  if (existingOp && existingOp.type === 'CREATE' && !isKnownOnServer) {
    // If it was created purely offline and never pushed to the server, cancel the CREATE
    await idbDelete(STORE_OPERATIONS, existingOp.id);
    return null;
  }

  if (existingOp) {
    // Replace any pending UPDATE with DELETE
    existingOp.type = 'DELETE';
    existingOp.payload = null;
    existingOp.updatedAt = nowIso;
    existingOp.status = 'pending';
    await idbPut(STORE_OPERATIONS, existingOp);
    return existingOp;
  }

  const op = {
    id: generateOpId('op_delete'),
    seq: getNextSeq(),
    userId: normalizedUserId,
    checklistId: cleanId,
    type: 'DELETE',
    payload: null,
    status: 'pending',
    retryCount: 0,
    lastError: null,
    createdAt: nowIso,
    updatedAt: nowIso
  };

  await idbPut(STORE_OPERATIONS, op);
  return op;
}

/**
 * Get all pending operations for a specific user, sorted strictly by seq (FIFO)
 */
export async function getPendingOperations(userId) {
  if (!userId) return [];
  const normalizedUserId = String(userId).trim();
  const allOps = await idbGetAll(STORE_OPERATIONS);
  return allOps
    .filter(op => op.userId === normalizedUserId)
    .sort((a, b) => a.seq - b.seq);
}

/**
 * Get all cached offline checklists for a specific user
 */
export async function getCachedChecklistsForUser(userId) {
  if (!userId) return [];
  const normalizedUserId = String(userId).trim();
  const allCache = await idbGetAll(STORE_CACHE);
  return allCache.filter(item => item.userId === normalizedUserId);
}

/**
 * Remove an operation from the queue once successfully processed
 */
export async function dequeueOperation(opId) {
  if (!opId) return;
  await idbDelete(STORE_OPERATIONS, String(opId));
}

/**
 * Clear cached checklists and operations (used for testing or explicit reset)
 */
export async function clearAllOfflineData() {
  await idbClear(STORE_OPERATIONS);
  await idbClear(STORE_CACHE);
}

// ============================================================================
// Core Queue Processor: Automatic Synchronization
// ============================================================================

export async function processChecklistSyncQueue(targetUserId = null) {
  // Determine authenticated user
  const currentUser = typeof authController !== 'undefined' ? authController.getUser() : null;
  const authUserId = currentUser?.userId ? String(currentUser.userId).trim() : null;
  const activeUserId = targetUserId ? String(targetUserId).trim() : authUserId;

  if (!activeUserId) {
    return { ok: false, syncedCount: 0, reason: 'Unauthenticated' };
  }

  // Prevent cross-account synchronization
  if (authUserId && activeUserId !== authUserId) {
    console.warn(`Qavora SyncQueue: Blocked cross-account sync attempt for ${activeUserId} while logged in as ${authUserId}`);
    return { ok: false, syncedCount: 0, reason: 'Cross-account sync prevented' };
  }

  // Mutex lock to prevent duplicate overlapping sync passes
  if (isSyncing) {
    return { ok: false, syncedCount: 0, reason: 'Sync in progress' };
  }

  isSyncing = true;
  let syncedCount = 0;

  try {
    const pendingOps = await getPendingOperations(activeUserId);
    if (pendingOps.length === 0) {
      return { ok: true, syncedCount: 0 };
    }

    for (const op of pendingOps) {
      // Re-verify user authentication before processing each op
      const freshUser = typeof authController !== 'undefined' ? authController.getUser() : null;
      if (!freshUser || String(freshUser.userId).trim() !== activeUserId) {
        console.warn('Qavora SyncQueue: User session switched or terminated; halting queue.');
        break;
      }

      // Mark operation as syncing
      op.status = 'syncing';
      op.updatedAt = new Date().toISOString();
      await idbPut(STORE_OPERATIONS, op);

      let success = false;
      let shouldHaltQueue = false;

      try {
        if (op.type === 'CREATE') {
          let res = await ChecklistAPI.create(op.payload);
          // Idempotent retry: if 409 Conflict (already exists on server), gracefully update
          if (!res.ok && (res.status === 409 || (res.error && res.error.includes('already exists')))) {
            res = await ChecklistAPI.update(op.checklistId, op.payload);
          }

          if (res.ok) {
            success = true;
          } else if (res.status === 401) {
            op.lastError = 'Session expired (HTTP 401)';
            shouldHaltQueue = true;
          } else {
            op.lastError = res.error || `Server returned ${res.status}`;
            shouldHaltQueue = true;
          }
        } else if (op.type === 'UPDATE') {
          let res = await ChecklistAPI.update(op.checklistId, op.payload);
          // Idempotent fallback: if 404 (not found on server), create it
          if (!res.ok && res.status === 404) {
            res = await ChecklistAPI.create(op.payload);
          }

          if (res.ok) {
            success = true;
          } else if (res.status === 401) {
            op.lastError = 'Session expired (HTTP 401)';
            shouldHaltQueue = true;
          } else {
            op.lastError = res.error || `Server returned ${res.status}`;
            shouldHaltQueue = true;
          }
        } else if (op.type === 'DELETE') {
          const res = await ChecklistAPI.delete(op.checklistId);
          // 2xx or 404 means the item is successfully gone from the server
          if (res.ok || res.status === 404) {
            success = true;
          } else if (res.status === 401) {
            op.lastError = 'Session expired (HTTP 401)';
            shouldHaltQueue = true;
          } else {
            op.lastError = res.error || `Server returned ${res.status}`;
            shouldHaltQueue = true;
          }
        }
      } catch (networkErr) {
        op.lastError = networkErr?.message || 'Network request failed';
        shouldHaltQueue = true;
      }

      if (success) {
        await dequeueOperation(op.id);
        syncedCount += 1;
      } else {
        // NEVER discard pending operations because of network errors or server downtime
        op.status = 'pending';
        op.retryCount = (op.retryCount || 0) + 1;
        op.updatedAt = new Date().toISOString();
        await idbPut(STORE_OPERATIONS, op);

        if (shouldHaltQueue) {
          // Cease queue loop to maintain strict FIFO order and avoid thrashing offline server
          break;
        }
      }
    }

    return { ok: true, syncedCount };
  } finally {
    isSyncing = false;
  }
}

// ============================================================================
// Auto-Sync Event Listeners
// ============================================================================
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  // Sync automatically when network connectivity returns
  window.addEventListener('online', () => {
    processChecklistSyncQueue().catch((err) => {
      console.warn('Qavora SyncQueue: Auto-sync on online event warning:', err);
    });
  });

  // Sync automatically when window / tab regains focus
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        processChecklistSyncQueue().catch(() => {});
      }
    });
  }
}
