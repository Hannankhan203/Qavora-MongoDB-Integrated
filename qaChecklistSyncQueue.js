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
export const DB_VERSION = 2;
export const STORE_OPERATIONS = 'pending_checklist_operations';
export const STORE_CACHE = 'offline_checklists_cache';
export const STORE_SYNC_LOCKS = 'sync_locks';

let dbInstance = null;
let dbOpenPromise = null;
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

const TAB_LOCK_OWNER_ID = generateOpId('tab');
const SYNC_LOCK_TTL_MS = 30000;

// ============================================================================
// In-Memory Storage Fallback (for Headless Node.js Test Environments)
// ============================================================================
const memoryOperations = new Map();
const memoryChecklistsCache = new Map();
const memorySyncLocks = new Map();

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

        // 3. Cross-tab synchronization lease/lock store
        if (!db.objectStoreNames.contains(STORE_SYNC_LOCKS)) {
          db.createObjectStore(STORE_SYNC_LOCKS, { keyPath: 'lockKey' });
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

  const expectedUpdatedAt = checklist.expectedUpdatedAt || checklist.updatedAt || null;

  if (existingOp) {
    // If pending CREATE or UPDATE exists, coalesce the newest state in-place
    existingOp.payload = JSON.parse(JSON.stringify(checklist));
    existingOp.updatedAt = nowIso;
    existingOp.status = 'pending';
    // Preserve original expectedUpdatedAt across retries if already present, or initialize if missing
    if (!existingOp.expectedUpdatedAt && expectedUpdatedAt) {
      existingOp.expectedUpdatedAt = expectedUpdatedAt;
    }
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
    expectedUpdatedAt,
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

  const lockKey = `qavora_sync_${activeUserId}`;

  if (
    typeof navigator !== 'undefined' &&
    navigator.locks &&
    typeof navigator.locks.request === 'function'
  ) {
    return navigator.locks.request(
      lockKey,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          return { ok: false, syncedCount: 0, reason: 'Sync in progress' };
        }
        return runSyncPass(activeUserId);
      }
    );
  }

  const lockResult = await acquireIndexedDbSyncLock(lockKey, TAB_LOCK_OWNER_ID, SYNC_LOCK_TTL_MS);
  if (!lockResult.acquired) {
    return { ok: false, syncedCount: 0, reason: 'Sync in progress' };
  }

  const { generation } = lockResult;
  const renewIntervalMs = Math.max(1000, Math.floor(SYNC_LOCK_TTL_MS / 3));
  const renewTimer = setInterval(() => {
    renewIndexedDbSyncLock(lockKey, TAB_LOCK_OWNER_ID, generation, SYNC_LOCK_TTL_MS).catch(() => {});
  }, renewIntervalMs);
  if (typeof renewTimer.unref === 'function') {
    renewTimer.unref();
  }

  try {
    return await runSyncPass(
      activeUserId,
      () => verifyIndexedDbSyncLock(lockKey, TAB_LOCK_OWNER_ID, generation),
      { lockKey, ownerId: TAB_LOCK_OWNER_ID, generation }
    );
  } finally {
    clearInterval(renewTimer);
    await releaseIndexedDbSyncLock(lockKey, TAB_LOCK_OWNER_ID, generation);
  }
}

export async function acquireIndexedDbSyncLock(
  lockKey,
  ownerId = TAB_LOCK_OWNER_ID,
  ttlMs = SYNC_LOCK_TTL_MS
) {
  const db = await openOfflineDatabase();
  const now = Date.now();

  if (db.__isMemoryFallback) {
    const existing = memorySyncLocks.get(lockKey);
    if (!existing || existing.expiresAt <= now || existing.ownerId === ownerId) {
      const nextGen = (existing?.generation || 0) + 1;
      memorySyncLocks.set(lockKey, {
        lockKey,
        ownerId,
        generation: nextGen,
        acquiredAt: now,
        expiresAt: now + ttlMs
      });
      return { acquired: true, generation: nextGen };
    }
    return { acquired: false, generation: 0 };
  }

  return new Promise((resolve) => {
    const tx = db.transaction([STORE_SYNC_LOCKS], 'readwrite');
    const store = tx.objectStore(STORE_SYNC_LOCKS);
    const getReq = store.get(lockKey);

    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing || existing.expiresAt <= now || existing.ownerId === ownerId) {
        const nextGen = (existing?.generation || 0) + 1;
        const putReq = store.put({
          lockKey,
          ownerId,
          generation: nextGen,
          acquiredAt: now,
          expiresAt: now + ttlMs
        });
        putReq.onsuccess = () => resolve({ acquired: true, generation: nextGen });
        putReq.onerror = () => resolve({ acquired: false, generation: 0 });
      } else {
        resolve({ acquired: false, generation: 0 });
      }
    };
    getReq.onerror = () => resolve({ acquired: false, generation: 0 });
  });
}

export async function renewIndexedDbSyncLock(
  lockKey,
  ownerId = TAB_LOCK_OWNER_ID,
  generation,
  ttlMs = SYNC_LOCK_TTL_MS
) {
  const db = await openOfflineDatabase();
  const now = Date.now();

  if (db.__isMemoryFallback) {
    const existing = memorySyncLocks.get(lockKey);
    if (
      existing &&
      existing.ownerId === ownerId &&
      existing.generation === generation &&
      existing.expiresAt > now
    ) {
      existing.expiresAt = now + ttlMs;
      return true;
    }
    return false;
  }

  return new Promise((resolve) => {
    const tx = db.transaction([STORE_SYNC_LOCKS], 'readwrite');
    const store = tx.objectStore(STORE_SYNC_LOCKS);
    const getReq = store.get(lockKey);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (
        existing &&
        existing.ownerId === ownerId &&
        existing.generation === generation &&
        existing.expiresAt > now
      ) {
        const putReq = store.put({
          ...existing,
          expiresAt: now + ttlMs
        });
        putReq.onsuccess = () => resolve(true);
        putReq.onerror = () => resolve(false);
      } else {
        resolve(false);
      }
    };
    getReq.onerror = () => resolve(false);
  });
}

export async function verifyIndexedDbSyncLock(
  lockKey,
  ownerId = TAB_LOCK_OWNER_ID,
  generation
) {
  const db = await openOfflineDatabase();
  const now = Date.now();

  if (db.__isMemoryFallback) {
    const existing = memorySyncLocks.get(lockKey);
    return Boolean(
      existing &&
      existing.ownerId === ownerId &&
      existing.generation === generation &&
      existing.expiresAt > now
    );
  }

  return new Promise((resolve) => {
    const tx = db.transaction([STORE_SYNC_LOCKS], 'readonly');
    const store = tx.objectStore(STORE_SYNC_LOCKS);
    const getReq = store.get(lockKey);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      resolve(
        Boolean(
          existing &&
          existing.ownerId === ownerId &&
          existing.generation === generation &&
          existing.expiresAt > now
        )
      );
    };
    getReq.onerror = () => resolve(false);
  });
}

export async function releaseIndexedDbSyncLock(
  lockKey,
  ownerId = TAB_LOCK_OWNER_ID,
  generation
) {
  const db = await openOfflineDatabase();

  if (db.__isMemoryFallback) {
    const existing = memorySyncLocks.get(lockKey);
    if (
      existing &&
      existing.ownerId === ownerId &&
      (generation === undefined || existing.generation === generation)
    ) {
      memorySyncLocks.set(lockKey, {
        lockKey,
        ownerId: null,
        generation: existing.generation,
        expiresAt: 0
      });
    }
    return;
  }

  return new Promise((resolve) => {
    const tx = db.transaction([STORE_SYNC_LOCKS], 'readwrite');
    const store = tx.objectStore(STORE_SYNC_LOCKS);
    const getReq = store.get(lockKey);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (
        existing &&
        existing.ownerId === ownerId &&
        (generation === undefined || existing.generation === generation)
      ) {
        const putReq = store.put({
          lockKey,
          ownerId: null,
          generation: existing.generation,
          expiresAt: 0
        });
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => resolve();
      } else {
        resolve();
      }
    };
    getReq.onerror = () => resolve();
  });
}

export async function dequeueOperationIfLockValid(
  opId,
  lockKey,
  ownerId = TAB_LOCK_OWNER_ID,
  generation
) {
  const db = await openOfflineDatabase();
  const now = Date.now();

  if (db.__isMemoryFallback) {
    const lock = memorySyncLocks.get(lockKey);
    if (
      !lock ||
      lock.ownerId !== ownerId ||
      lock.expiresAt <= now ||
      (generation !== undefined && lock.generation !== generation)
    ) {
      return false;
    }
    memoryOperations.delete(String(opId));
    return true;
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_SYNC_LOCKS, STORE_OPERATIONS], 'readwrite');
    const lockStore = tx.objectStore(STORE_SYNC_LOCKS);
    const opStore = tx.objectStore(STORE_OPERATIONS);
    let deleted = false;

    const getReq = lockStore.get(lockKey);
    getReq.onsuccess = () => {
      const lock = getReq.result;
      if (
        !lock ||
        lock.ownerId !== ownerId ||
        lock.expiresAt <= now ||
        (generation !== undefined && lock.generation !== generation)
      ) {
        deleted = false;
        return;
      }
      opStore.delete(opId);
      deleted = true;
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve(deleted);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => resolve(false);
  });
}

/**
 * Safely reconciles a conflicting client update payload with the latest server state (409 Conflict).
 * Ensures newer server data is preserved while client changes (e.g. test results, new sections, updated fields)
 * are not silently discarded.
 */
export function reconcileChecklistUpdate(clientPayload, serverChecklist) {
  if (!serverChecklist || typeof serverChecklist !== 'object') {
    return null;
  }
  if (!clientPayload || typeof clientPayload !== 'object') {
    return null;
  }

  // Clone server state as base to preserve newer server data
  const reconciled = JSON.parse(JSON.stringify(serverChecklist));
  delete reconciled._id;
  delete reconciled.userId;
  delete reconciled.id;

  // 1. Title reconciliation:
  // If server title is empty or default, adopt client's title; otherwise preserve newer server title
  if (clientPayload.title && (!reconciled.title || reconciled.title === 'Untitled QA Checklist')) {
    reconciled.title = clientPayload.title;
  }

  // 2. Document notes reconciliation:
  if (Array.isArray(clientPayload.documentNotes)) {
    const existingTexts = new Set(
      (reconciled.documentNotes || []).map(n => (typeof n === 'string' ? n : n?.text || ''))
    );
    const mergedNotes = [...(reconciled.documentNotes || [])];
    for (const note of clientPayload.documentNotes) {
      const txt = typeof note === 'string' ? note : note?.text || '';
      if (txt && !existingTexts.has(txt)) {
        mergedNotes.push(note);
        existingTexts.add(txt);
      }
    }
    reconciled.documentNotes = mergedNotes;
  }

  // 3. Phases, sections, and test case execution results:
  if (Array.isArray(clientPayload.phases) && clientPayload.phases.length > 0) {
    if (!Array.isArray(reconciled.phases) || reconciled.phases.length === 0) {
      reconciled.phases = JSON.parse(JSON.stringify(clientPayload.phases));
    } else {
      const serverPhaseMap = new Map();
      reconciled.phases.forEach((ph, idx) => {
        const key = ph.id || ph.name || `ph_${idx}`;
        serverPhaseMap.set(key, ph);
      });

      for (const clientPhase of clientPayload.phases) {
        const pKey = clientPhase.id || clientPhase.name;
        const matchingServerPhase = pKey ? serverPhaseMap.get(pKey) : null;

        if (!matchingServerPhase) {
          // Client created a new phase: preserve it
          reconciled.phases.push(JSON.parse(JSON.stringify(clientPhase)));
        } else {
          // Merge sections within matching phase
          const serverSecMap = new Map();
          (matchingServerPhase.sections || []).forEach((sec, idx) => {
            const sKey = sec.id || sec.name || `sec_${idx}`;
            serverSecMap.set(sKey, sec);
          });

          for (const clientSec of (clientPhase.sections || [])) {
            const sKey = clientSec.id || clientSec.name;
            const matchingServerSec = sKey ? serverSecMap.get(sKey) : null;

            if (!matchingServerSec) {
              if (!matchingServerPhase.sections) matchingServerPhase.sections = [];
              matchingServerPhase.sections.push(JSON.parse(JSON.stringify(clientSec)));
            } else {
              // Merge tests within matching section
              const serverTestMap = new Map();
              (matchingServerSec.tests || []).forEach((t, idx) => {
                const tKey = t.id || t.testId || t.text || `test_${idx}`;
                serverTestMap.set(tKey, t);
              });

              for (const clientTest of (clientSec.tests || [])) {
                const tKey = clientTest.id || clientTest.testId || clientTest.text;
                const matchingServerTest = tKey ? serverTestMap.get(tKey) : null;

                if (!matchingServerTest) {
                  if (!matchingServerSec.tests) matchingServerSec.tests = [];
                  matchingServerSec.tests.push(JSON.parse(JSON.stringify(clientTest)));
                } else {
                  // Both have the test:
                  // If client marked test completed or changed status and server test is not completed, keep client result
                  const serverNotCompleted = !matchingServerTest.completed || matchingServerTest.status === 'Not Started';
                  if (clientTest.completed || (clientTest.status && clientTest.status !== 'Not Started')) {
                    if (serverNotCompleted) {
                      matchingServerTest.status = clientTest.status;
                      matchingServerTest.completed = Boolean(clientTest.completed);
                      if (clientTest.notes) matchingServerTest.notes = clientTest.notes;
                      if (clientTest.executedAt) matchingServerTest.executedAt = clientTest.executedAt;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // 4. Metadata fields
  if (clientPayload.promotedProjectId && !reconciled.promotedProjectId) {
    reconciled.promotedProjectId = clientPayload.promotedProjectId;
  }
  if (clientPayload.promotedAt && !reconciled.promotedAt) {
    reconciled.promotedAt = clientPayload.promotedAt;
  }
  if (clientPayload.completedAt && !reconciled.completedAt) {
    reconciled.completedAt = clientPayload.completedAt;
  }
  if (clientPayload.completedBy && !reconciled.completedBy) {
    reconciled.completedBy = clientPayload.completedBy;
  }

  return reconciled;
}

async function runSyncPass(activeUserId, verifyLock = null, lockContext = null) {
  let syncedCount = 0;

  const pendingOps = await getPendingOperations(activeUserId);
    if (pendingOps.length === 0) {
      return { ok: true, syncedCount: 0 };
    }

    for (const op of pendingOps) {
      if (verifyLock && !(await verifyLock())) {
        console.warn('Qavora SyncQueue: Lost sync lock ownership; halting queue.');
        break;
      }
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
            const createPatch = { ...op.payload };
            delete createPatch._id;
            delete createPatch.userId;
            delete createPatch.id;
            delete createPatch.updatedAt;
            if (op.expectedUpdatedAt) {
              createPatch.expectedUpdatedAt = op.expectedUpdatedAt;
            }
            res = await ChecklistAPI.update(op.checklistId, createPatch);
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
          // Prepare PATCH payload without server-controlled/immutable fields
          const patchPayload = { ...op.payload };
          delete patchPayload._id;
          delete patchPayload.userId;
          delete patchPayload.id;

          // Include expected server version if available
          const versionToSend = op.expectedUpdatedAt || patchPayload.expectedUpdatedAt || patchPayload.updatedAt || null;
          if (versionToSend) {
            if (!op.expectedUpdatedAt) {
              op.expectedUpdatedAt = versionToSend;
            }
            patchPayload.expectedUpdatedAt = versionToSend;
          }
          delete patchPayload.updatedAt;

          let res = await ChecklistAPI.update(op.checklistId, patchPayload);

          // Handle HTTP 409 Conflict: in-flight concurrent update race condition
          if (!res.ok && res.status === 409) {
            console.warn(`Qavora SyncQueue: 409 Conflict detected for checklist ${op.checklistId}. Fetching latest server state for reconciliation.`);
            const serverRes = await ChecklistAPI.get(op.checklistId);

            if (serverRes.ok && serverRes.data) {
              const serverChecklist = serverRes.data;
              const reconciled = reconcileChecklistUpdate(op.payload, serverChecklist);

              if (reconciled) {
                // Update queue operation with reconciled payload and update expectedUpdatedAt to latest server version
                op.payload = reconciled;
                op.expectedUpdatedAt = serverChecklist.updatedAt || null;
                op.updatedAt = new Date().toISOString();
                await idbPut(STORE_OPERATIONS, op);

                // Update durable offline cache with reconciled data
                await idbPut(STORE_CACHE, {
                  ...reconciled,
                  id: op.checklistId,
                  userId: activeUserId,
                  _offlineCachedAt: new Date().toISOString()
                });

                // Retry update request with reconciled payload and latest server expectedUpdatedAt
                const retryPayload = { ...reconciled };
                delete retryPayload._id;
                delete retryPayload.userId;
                delete retryPayload.id;
                delete retryPayload.updatedAt;
                if (op.expectedUpdatedAt) {
                  retryPayload.expectedUpdatedAt = op.expectedUpdatedAt;
                }

                res = await ChecklistAPI.update(op.checklistId, retryPayload);
              } else {
                op.lastError = 'Conflict reconciliation failed: invalid data structure';
                shouldHaltQueue = true;
              }
            } else {
              // Failed to fetch latest server state -> retain operation in queue for next sync
              op.lastError = serverRes?.error || 'Conflict (409): unable to retrieve latest server state';
              shouldHaltQueue = true;
            }
          }

          // Idempotent fallback: if 404 (not found on server), create it
          if (!res.ok && res.status === 404) {
            const createPayload = { ...op.payload, id: op.checklistId };
            delete createPayload.expectedUpdatedAt;
            res = await ChecklistAPI.create(createPayload);
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
        if (lockContext) {
          const dequeued = await dequeueOperationIfLockValid(
            op.id,
            lockContext.lockKey,
            lockContext.ownerId,
            lockContext.generation
          );
          if (!dequeued) {
            console.warn('Qavora SyncQueue: Lost sync lock ownership before queue deletion; halting queue.');
            break;
          }
        } else {
          await dequeueOperation(op.id);
        }
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
