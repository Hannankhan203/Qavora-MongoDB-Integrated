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
import { apiFetch, apiJson } from './src/modules/apiClient.js';

export const DB_NAME = 'qavora_offline_db';
export const DB_VERSION = 2;
export const STORE_OPERATIONS = 'pending_checklist_operations';
export const STORE_CACHE = 'offline_checklists_cache';
export const STORE_PROJECT_OPERATIONS = 'pending_project_operations';
export const STORE_PROJECTS_CACHE = 'offline_projects_cache';
export const STORE_SYNC_LOCKS = 'sync_locks';

export const BASE_RETRY_DELAY_MS = 1000;
export const MAX_RETRY_DELAY_MS = 30000;
export const DEFAULT_MAX_RETRIES = 5;

let dbInstance = null;
let dbOpenPromise = null;
let globalSeqCounter = Date.now();
let lastStorageError = null;
let storageDegradedMode = false;
let forcedOfflineMode = false;
let activeSyncInProgressCount = 0;

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
const memoryProjectOperations = new Map();
const memoryProjectsCache = new Map();
const memorySyncLocks = new Map();

function getMemoryStore(storeName) {
  switch (storeName) {
    case STORE_OPERATIONS:
      return memoryOperations;
    case STORE_CACHE:
      return memoryChecklistsCache;
    case STORE_PROJECT_OPERATIONS:
      return memoryProjectOperations;
    case STORE_PROJECTS_CACHE:
      return memoryProjectsCache;
    case STORE_SYNC_LOCKS:
      return memorySyncLocks;
    default:
      return memoryChecklistsCache;
  }
}

export function setOfflineModeForTesting(isOffline) {
  forcedOfflineMode = Boolean(isOffline);
  notifyOfflineSyncListeners({ type: forcedOfflineMode ? 'OFFLINE' : 'ONLINE' });
}

export function isClientOffline() {
  if (forcedOfflineMode) return true;
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return !navigator.onLine;
  }
  return false;
}

export function resolveActiveUserId(explicitUserId = null) {
  if (explicitUserId && String(explicitUserId).trim()) {
    return String(explicitUserId).trim();
  }
  const directUser = typeof authController !== 'undefined' && authController && typeof authController.getUser === 'function'
    ? authController.getUser()
    : null;
  if (directUser) {
    const uid = directUser.userId || directUser.id || directUser.email;
    if (uid) return String(uid).trim();
  }
  const winAuth = typeof globalThis !== 'undefined' && globalThis.window && globalThis.window.authController;
  if (winAuth && typeof winAuth.getUser === 'function') {
    const winUser = winAuth.getUser();
    const uid = winUser?.userId || winUser?.id || winUser?.email;
    if (uid) return String(uid).trim();
  }
  return null;
}

// ============================================================================
// Cross-Tab BroadcastChannel & UI Sync State Listeners
// ============================================================================
const syncStateListeners = new Set();
let syncBroadcastChannel = null;
const inMemoryBroadcastSubscribers = new Set();

function getSyncBroadcastChannel() {
  if (
    syncBroadcastChannel &&
    typeof BroadcastChannel !== 'undefined' &&
    syncBroadcastChannel instanceof BroadcastChannel
  ) {
    return syncBroadcastChannel;
  }
  if (syncBroadcastChannel && typeof syncBroadcastChannel.close === 'function') {
    try { syncBroadcastChannel.close(); } catch (_) {}
    syncBroadcastChannel = null;
  }
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      syncBroadcastChannel = new BroadcastChannel('qavora_offline_sync_channel');
      if (typeof syncBroadcastChannel.unref === 'function') {
        syncBroadcastChannel.unref();
      }
      syncBroadcastChannel.onmessage = (event) => {
        const data = event?.data;
        if (!data || data.senderTabId === TAB_LOCK_OWNER_ID) return;
        for (const sub of inMemoryBroadcastSubscribers) {
          try { sub(data); } catch (_) {}
        }
        for (const listener of syncStateListeners) {
          try { listener(data); } catch (_) {}
        }
      };
    } catch (_) {
      syncBroadcastChannel = null;
    }
  }
  return syncBroadcastChannel;
}

export function broadcastSyncEvent(type, payload = {}) {
  const message = {
    type,
    senderTabId: TAB_LOCK_OWNER_ID,
    timestamp: new Date().toISOString(),
    ...payload
  };
  const ch = getSyncBroadcastChannel();
  if (ch) {
    try {
      ch.postMessage(message);
    } catch (_) {}
  }
  for (const sub of inMemoryBroadcastSubscribers) {
    try { sub(message); } catch (_) {}
  }
  notifyOfflineSyncListeners(message);
  return message;
}

export function subscribeToSyncBroadcast(callback) {
  if (typeof callback !== 'function') return () => {};
  getSyncBroadcastChannel();
  inMemoryBroadcastSubscribers.add(callback);
  return () => {
    inMemoryBroadcastSubscribers.delete(callback);
  };
}

export function onOfflineSyncStateChange(listener) {
  if (typeof listener !== 'function') return () => {};
  getSyncBroadcastChannel();
  syncStateListeners.add(listener);
  return () => {
    syncStateListeners.delete(listener);
  };
}

function notifyOfflineSyncListeners(event = {}) {
  for (const listener of syncStateListeners) {
    try {
      listener(event);
    } catch (_) {}
  }
}

export function isBrowserEnvironment() {
  return typeof window !== 'undefined' && typeof window.document !== 'undefined';
}

export function hasNativeIndexedDB() {
  return typeof globalThis !== 'undefined' &&
    typeof globalThis.indexedDB !== 'undefined' &&
    globalThis.indexedDB !== null;
}

/**
 * Expose storage status to browser callers
 */
export function getStorageStatus() {
  if (!isBrowserEnvironment()) {
    return {
      status: 'memory_fallback',
      driver: 'memory',
      isDurable: false,
      isDegraded: false,
      error: null
    };
  }

  if (!hasNativeIndexedDB()) {
    if (storageDegradedMode) {
      return {
        status: 'degraded',
        driver: 'memory',
        isDurable: false,
        isDegraded: true,
        error: lastStorageError ? (lastStorageError.message || String(lastStorageError)) : 'Operating in degraded in-memory mode'
      };
    }
    return {
      status: 'unavailable',
      driver: 'none',
      isDurable: false,
      isDegraded: true,
      error: lastStorageError ? (lastStorageError.message || String(lastStorageError)) : 'IndexedDB is not supported or unavailable in this browser environment'
    };
  }

  if (storageDegradedMode) {
    return {
      status: 'degraded',
      driver: 'memory',
      isDurable: false,
      isDegraded: true,
      error: lastStorageError ? (lastStorageError.message || String(lastStorageError)) : 'Operating in degraded in-memory mode'
    };
  }

  if (lastStorageError) {
    return {
      status: 'unavailable',
      driver: dbInstance && !dbInstance.__isMemoryFallback ? 'indexeddb' : 'none',
      isDurable: false,
      isDegraded: true,
      error: lastStorageError.message || String(lastStorageError)
    };
  }

  if (!dbInstance) {
    return {
      status: 'uninitialized',
      driver: 'indexeddb',
      isDurable: true,
      isDegraded: false,
      error: null
    };
  }

  if (dbInstance.__isMemoryFallback) {
    return {
      status: 'degraded',
      driver: 'memory',
      isDurable: false,
      isDegraded: true,
      error: 'Operating in degraded in-memory fallback'
    };
  }

  return {
    status: 'ready',
    driver: 'indexeddb',
    isDurable: true,
    isDegraded: false,
    error: null
  };
}

export function setDegradedMemoryFallback(enabled) {
  storageDegradedMode = Boolean(enabled);
}

export function closeOfflineDatabase() {
  if (dbInstance && typeof dbInstance.close === 'function') {
    try {
      dbInstance.close();
    } catch (_) {}
  }
  dbInstance = null;
  dbOpenPromise = null;
}

export function resetStorageState() {
  closeOfflineDatabase();
  lastStorageError = null;
  storageDegradedMode = false;
  forcedOfflineMode = false;
  memoryOperations.clear();
  memoryChecklistsCache.clear();
  memoryProjectOperations.clear();
  memoryProjectsCache.clear();
  memorySyncLocks.clear();
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

  if (!isBrowserEnvironment()) {
    // Headless / memory fallback driver for Node test runs
    dbInstance = {
      __isMemoryFallback: true,
      close() {
        dbInstance = null;
      }
    };
    return dbInstance;
  }

  if (!hasNativeIndexedDB()) {
    if (storageDegradedMode) {
      dbInstance = {
        __isMemoryFallback: true,
        close() {
          dbInstance = null;
        }
      };
      return dbInstance;
    }
    const err = new Error('IndexedDB is not supported or unavailable in this browser environment');
    lastStorageError = err;
    throw err;
  }

  dbOpenPromise = new Promise((resolve, reject) => {
    let settled = false;
    const safeResolve = (val) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };
    const safeReject = (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    try {
      const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. Pending checklist operations queue store
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

        // 3. Pending formal project operations queue store
        if (!db.objectStoreNames.contains(STORE_PROJECT_OPERATIONS)) {
          const projOpStore = db.createObjectStore(STORE_PROJECT_OPERATIONS, { keyPath: 'id' });
          projOpStore.createIndex('userId', 'userId', { unique: false });
          projOpStore.createIndex('projectId', 'projectId', { unique: false });
          projOpStore.createIndex('entityType', 'entityType', { unique: false });
          projOpStore.createIndex('entityId', 'entityId', { unique: false });
          projOpStore.createIndex('seq', 'seq', { unique: false });
          projOpStore.createIndex('status', 'status', { unique: false });
        }

        // 4. Offline formal projects cache store (durable client backup across reloads)
        if (!db.objectStoreNames.contains(STORE_PROJECTS_CACHE)) {
          const projCacheStore = db.createObjectStore(STORE_PROJECTS_CACHE, { keyPath: 'id' });
          projCacheStore.createIndex('userId', 'userId', { unique: false });
          projCacheStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // 5. Cross-tab synchronization lease/lock store
        if (!db.objectStoreNames.contains(STORE_SYNC_LOCKS)) {
          db.createObjectStore(STORE_SYNC_LOCKS, { keyPath: 'lockKey' });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        dbOpenPromise = null;
        lastStorageError = null;

        dbInstance.onversionchange = () => {
          try {
            dbInstance.close();
          } catch (_) {}
          dbInstance = null;
        };

        dbInstance.onclose = () => {
          dbInstance = null;
        };

        dbInstance.onerror = (e) => {
          console.warn('Qavora Offline DB database error:', e?.target?.error);
        };

        safeResolve(dbInstance);
      };

      request.onerror = (event) => {
        const error = event.target.error || new Error('Failed to open IndexedDB database');
        console.warn('Qavora Offline DB open failed:', error);
        dbOpenPromise = null;
        lastStorageError = error;
        if (storageDegradedMode) {
          dbInstance = { __isMemoryFallback: true, close() { dbInstance = null; } };
          safeResolve(dbInstance);
        } else {
          // In real browser, never silently mask failure with volatile memory
          safeReject(error);
        }
      };

      request.onblocked = () => {
        console.warn('Qavora Offline DB open blocked.');
      };
    } catch (err) {
      console.warn('Qavora Offline DB initialization exception:', err);
      dbOpenPromise = null;
      lastStorageError = err;
      if (storageDegradedMode) {
        dbInstance = { __isMemoryFallback: true, close() { dbInstance = null; } };
        safeResolve(dbInstance);
      } else {
        safeReject(err);
      }
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
    if (isBrowserEnvironment() && !storageDegradedMode) {
      throw new Error('Durable offline storage unavailable: operating in browser without persistent IndexedDB');
    }
    const store = getMemoryStore(storeName);
    const item = store.get(String(key));
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let result = null;
    const safeResolve = (val) => { if (!settled) { settled = true; resolve(val); } };
    const safeReject = (err) => { if (!settled) { settled = true; reject(err); } };

    try {
      const tx = db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => { result = req.result || null; };
      req.onerror = () => safeReject(req.error || new Error('IndexedDB get request failed'));
      tx.oncomplete = () => safeResolve(result);
      tx.onerror = () => safeReject(tx.error || req.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => safeReject(tx.error || new Error('IndexedDB transaction aborted'));
    } catch (err) {
      safeReject(err);
    }
  });
}

async function idbPut(storeName, value) {
  const db = await openOfflineDatabase();
  if (db.__isMemoryFallback) {
    if (isBrowserEnvironment() && !storageDegradedMode) {
      throw new Error('Durable offline storage unavailable: operating in browser without persistent IndexedDB');
    }
    const store = getMemoryStore(storeName);
    const recordKey = value?.id !== undefined ? String(value.id) : String(value?.lockKey || '');
    store.set(recordKey, JSON.parse(JSON.stringify(value)));
    return value?.id !== undefined ? value.id : value?.lockKey;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let result = value?.id;
    const safeResolve = (val) => { if (!settled) { settled = true; resolve(val); } };
    const safeReject = (err) => { if (!settled) { settled = true; reject(err); } };

    try {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(value);
      req.onsuccess = () => { result = req.result; };
      req.onerror = () => safeReject(req.error || new Error('IndexedDB put request failed'));
      tx.oncomplete = () => safeResolve(result);
      tx.onerror = () => safeReject(tx.error || req.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => safeReject(tx.error || new Error('IndexedDB transaction aborted'));
    } catch (err) {
      safeReject(err);
    }
  });
}

async function idbDelete(storeName, key) {
  const db = await openOfflineDatabase();
  if (db.__isMemoryFallback) {
    if (isBrowserEnvironment() && !storageDegradedMode) {
      throw new Error('Durable offline storage unavailable: operating in browser without persistent IndexedDB');
    }
    const store = getMemoryStore(storeName);
    store.delete(String(key));
    return true;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const safeResolve = (val) => { if (!settled) { settled = true; resolve(val); } };
    const safeReject = (err) => { if (!settled) { settled = true; reject(err); } };

    try {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onerror = () => safeReject(req.error || new Error('IndexedDB delete request failed'));
      tx.oncomplete = () => safeResolve(true);
      tx.onerror = () => safeReject(tx.error || req.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => safeReject(tx.error || new Error('IndexedDB transaction aborted'));
    } catch (err) {
      safeReject(err);
    }
  });
}

async function idbGetAll(storeName) {
  const db = await openOfflineDatabase();
  if (db.__isMemoryFallback) {
    if (isBrowserEnvironment() && !storageDegradedMode) {
      throw new Error('Durable offline storage unavailable: operating in browser without persistent IndexedDB');
    }
    const store = getMemoryStore(storeName);
    return Array.from(store.values()).map(v => JSON.parse(JSON.stringify(v)));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let result = [];
    const safeResolve = (val) => { if (!settled) { settled = true; resolve(val); } };
    const safeReject = (err) => { if (!settled) { settled = true; reject(err); } };

    try {
      const tx = db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => { result = req.result || []; };
      req.onerror = () => safeReject(req.error || new Error('IndexedDB getAll request failed'));
      tx.oncomplete = () => safeResolve(result);
      tx.onerror = () => safeReject(tx.error || req.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => safeReject(tx.error || new Error('IndexedDB transaction aborted'));
    } catch (err) {
      safeReject(err);
    }
  });
}

async function idbClear(storeName) {
  const db = await openOfflineDatabase();
  if (db.__isMemoryFallback) {
    if (isBrowserEnvironment() && !storageDegradedMode) {
      throw new Error('Durable offline storage unavailable: operating in browser without persistent IndexedDB');
    }
    const store = getMemoryStore(storeName);
    store.clear();
    return true;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const safeResolve = (val) => { if (!settled) { settled = true; resolve(val); } };
    const safeReject = (err) => { if (!settled) { settled = true; reject(err); } };

    try {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onerror = () => safeReject(req.error || new Error('IndexedDB clear request failed'));
      tx.oncomplete = () => safeResolve(true);
      tx.onerror = () => safeReject(tx.error || req.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => safeReject(tx.error || new Error('IndexedDB transaction aborted'));
    } catch (err) {
      safeReject(err);
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
  await idbClear(STORE_PROJECT_OPERATIONS);
  await idbClear(STORE_PROJECTS_CACHE);
  await idbClear(STORE_SYNC_LOCKS);
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
    let settled = false;
    const safeResolve = (val) => { if (!settled) { settled = true; resolve(val); } };

    try {
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
          putReq.onsuccess = () => safeResolve({ acquired: true, generation: nextGen });
          putReq.onerror = () => safeResolve({ acquired: false, generation: 0 });
        } else {
          safeResolve({ acquired: false, generation: 0 });
        }
      };
      getReq.onerror = () => safeResolve({ acquired: false, generation: 0 });
      tx.onerror = () => safeResolve({ acquired: false, generation: 0 });
      tx.onabort = () => safeResolve({ acquired: false, generation: 0 });
    } catch (_err) {
      safeResolve({ acquired: false, generation: 0 });
    }
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
    let settled = false;
    const safeResolve = (val) => { if (!settled) { settled = true; resolve(val); } };

    try {
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
          putReq.onsuccess = () => safeResolve(true);
          putReq.onerror = () => safeResolve(false);
        } else {
          safeResolve(false);
        }
      };
      getReq.onerror = () => safeResolve(false);
      tx.onerror = () => safeResolve(false);
      tx.onabort = () => safeResolve(false);
    } catch (_err) {
      safeResolve(false);
    }
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
    let settled = false;
    const safeResolve = (val) => { if (!settled) { settled = true; resolve(val); } };

    try {
      const tx = db.transaction([STORE_SYNC_LOCKS], 'readonly');
      const store = tx.objectStore(STORE_SYNC_LOCKS);
      const getReq = store.get(lockKey);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        safeResolve(
          Boolean(
            existing &&
            existing.ownerId === ownerId &&
            existing.generation === generation &&
            existing.expiresAt > now
          )
        );
      };
      getReq.onerror = () => safeResolve(false);
      tx.onerror = () => safeResolve(false);
      tx.onabort = () => safeResolve(false);
    } catch (_err) {
      safeResolve(false);
    }
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
    let settled = false;
    const safeResolve = () => { if (!settled) { settled = true; resolve(); } };

    try {
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
          putReq.onsuccess = () => safeResolve();
          putReq.onerror = () => safeResolve();
        } else {
          safeResolve();
        }
      };
      getReq.onerror = () => safeResolve();
      tx.onerror = () => safeResolve();
      tx.onabort = () => safeResolve();
    } catch (_err) {
      safeResolve();
    }
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
    let settled = false;
    const safeResolve = (val) => { if (!settled) { settled = true; resolve(val); } };
    const safeReject = (err) => { if (!settled) { settled = true; reject(err); } };

    try {
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
      getReq.onerror = () => safeReject(getReq.error);
      tx.oncomplete = () => safeResolve(deleted);
      tx.onerror = () => safeReject(tx.error);
      tx.onabort = () => safeResolve(false);
    } catch (err) {
      safeReject(err);
    }
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

  try {
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
  } catch (syncPassErr) {
    console.warn('Qavora SyncQueue: sync pass encountered error:', syncPassErr);
    return { ok: false, syncedCount, error: syncPassErr?.message || String(syncPassErr) };
  }
}

// ============================================================================
// Formal Project Mutations Offline Queue & Durable Cache (QAV-OFFLINE-001)
// ============================================================================

const DEPENDENCY_RANKS = {
  'project:CREATE': 10,
  'project:UPDATE': 20,
  'project:STATUS_CHANGE': 21,
  'testPlan:CREATE': 30,
  'testPlan:UPDATE': 31,
  'phase:CREATE': 32,
  'phase:UPDATE': 33,
  'phase:DELETE': 34,
  'suite:CREATE': 40,
  'suite:UPDATE': 41,
  'suite:DELETE': 42,
  'testCase:CREATE': 50,
  'testCase:DUPLICATE': 51,
  'testCase:UPDATE': 52,
  'testCase:DELETE': 53,
  'executionRun:CREATE': 58,
  'executionRun:UPDATE': 59,
  'executionRun:STATUS_CHANGE': 59,
  'execution:CREATE': 60,
  'execution:EXECUTE': 60,
  'execution:UPDATE': 61,
  'execution:STATUS_CHANGE': 61,
  'execution:DELETE': 62,
  'defect:CREATE': 70,
  'defect:UPDATE': 71,
  'defect:STATUS_CHANGE': 72,
  'defect:DELETE': 73,
  'data:UPDATE': 80,
  'project:DELETE': 90
};

export function getOperationDependencyRank(op) {
  if (!op) return 80;
  const entityType = String(op.entityType || 'data').trim();
  const opType = String(op.operationType || op.type || 'UPDATE').trim().toUpperCase();
  const key = `${entityType}:${opType}`;
  if (DEPENDENCY_RANKS[key] !== undefined) {
    return DEPENDENCY_RANKS[key];
  }
  if (entityType === 'project' && opType === 'CREATE') return 10;
  if (entityType === 'project' && opType === 'DELETE') return 90;
  if (entityType === 'project') return 20;
  if (entityType === 'suite') return 41;
  if (entityType === 'testCase') return 52;
  if (entityType === 'execution' || entityType === 'executionRun') return 60;
  if (entityType === 'defect') return 71;
  return 80;
}

export function sortProjectOperationsByDependency(ops = []) {
  return [...ops].sort((a, b) => {
    // Sort by dependency rank within the same project, or globally if ranks differ for dependent entities
    const rankA = getOperationDependencyRank(a);
    const rankB = getOperationDependencyRank(b);
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return (a.seq || 0) - (b.seq || 0);
  });
}

export function computeBackoffDelayMs(
  retryCount,
  baseDelayMs = BASE_RETRY_DELAY_MS,
  maxDelayMs = MAX_RETRY_DELAY_MS
) {
  const exponent = Math.max(0, Number(retryCount || 1) - 1);
  return Math.min(maxDelayMs, baseDelayMs * Math.pow(2, exponent));
}

/**
 * Cache a single formal project in durable IndexedDB storage for a specific user
 */
export async function cacheProjectOffline(project, userId = null) {
  const resolvedUser = resolveActiveUserId(userId || project?.userId);
  if (!project || !project.id || !resolvedUser) return null;

  const projectId = String(project.id).trim();
  const existing = await idbGet(STORE_PROJECTS_CACHE, projectId);
  const nowIso = new Date().toISOString();

  const record = {
    ...(existing && existing.userId === resolvedUser ? existing : {}),
    ...JSON.parse(JSON.stringify(project)),
    id: projectId,
    userId: resolvedUser,
    _serverUpdatedAt: project._serverUpdatedAt || project.updatedAt || existing?._serverUpdatedAt || null,
    _offlineCachedAt: nowIso
  };

  await idbPut(STORE_PROJECTS_CACHE, record);
  return record;
}

/**
 * Cache a list of formal projects in durable IndexedDB storage for a specific user
 */
export async function cacheProjectsListOffline(projects = [], userId = null) {
  const resolvedUser = resolveActiveUserId(userId);
  if (!resolvedUser || !Array.isArray(projects)) return [];

  const pendingOps = await getPendingProjectOperations(resolvedUser);
  const pendingDeletedProjectIds = new Set(
    pendingOps
      .filter(op => op.entityType === 'project' && (op.operationType === 'DELETE' || op.type === 'DELETE'))
      .map(op => op.projectId)
  );

  const saved = [];
  for (const proj of projects) {
    if (!proj || !proj.id) continue;
    if (pendingDeletedProjectIds.has(String(proj.id).trim())) continue;
    const record = await cacheProjectOffline(
      { ...proj, _serverUpdatedAt: proj.updatedAt || proj._serverUpdatedAt || null },
      resolvedUser
    );
    if (record) saved.push(record);
  }
  return saved;
}

/**
 * Remove a cached project from IndexedDB
 */
export async function removeCachedProjectOffline(projectId, userId = null) {
  if (!projectId) return false;
  const cleanId = String(projectId).trim();
  const resolvedUser = resolveActiveUserId(userId);
  const existing = await idbGet(STORE_PROJECTS_CACHE, cleanId);
  if (existing && resolvedUser && existing.userId && existing.userId !== resolvedUser) {
    return false;
  }
  await idbDelete(STORE_PROJECTS_CACHE, cleanId);
  return true;
}

/**
 * Get all cached formal projects for a specific user, with any pending offline mutations applied
 */
export async function getCachedProjectsForUser(userId = null, applyPending = true) {
  const resolvedUser = resolveActiveUserId(userId);
  if (!resolvedUser) return [];

  const allCached = await idbGetAll(STORE_PROJECTS_CACHE);
  const userProjectsMap = new Map();

  for (const item of allCached) {
    if (item && item.userId === resolvedUser && item.id) {
      userProjectsMap.set(String(item.id), JSON.parse(JSON.stringify(item)));
    }
  }

  if (applyPending) {
    const pendingOps = await getPendingProjectOperations(resolvedUser);
    const orderedOps = sortProjectOperationsByDependency(pendingOps);
    for (const op of orderedOps) {
      if (op.status === 'failed') continue;
      const projId = String(op.projectId || op.entityId || '').trim();
      if (!projId) continue;

      const opType = String(op.operationType || op.type || '').toUpperCase();
      if (op.entityType === 'project' && opType === 'DELETE') {
        userProjectsMap.delete(projId);
        continue;
      }

      let currentProj = userProjectsMap.get(projId);
      if (!currentProj && op.entityType === 'project' && opType === 'CREATE') {
        const seedProj = op.payload?.project || op.payload?.projectSnapshot || op.payload;
        if (seedProj && typeof seedProj === 'object') {
          currentProj = {
            ...JSON.parse(JSON.stringify(seedProj)),
            id: projId,
            userId: resolvedUser
          };
        }
      }

      if (currentProj) {
        currentProj = applyOperationToProjectState(currentProj, op);
        currentProj._hasPendingOfflineMutations = true;
        userProjectsMap.set(projId, currentProj);
      }
    }
  }

  return Array.from(userProjectsMap.values()).sort((a, b) => {
    const tA = Date.parse(a.createdAt || a.updatedAt || 0) || 0;
    const tB = Date.parse(b.createdAt || b.updatedAt || 0) || 0;
    return tB - tA;
  });
}

export async function getCachedProjectById(projectId, userId = null, applyPending = true) {
  if (!projectId) return null;
  const cleanId = String(projectId).trim();
  const projects = await getCachedProjectsForUser(userId, applyPending);
  return projects.find(p => String(p.id) === cleanId) || null;
}

/**
 * Structurally applies a queued mutation operation onto a project object without
 * overwriting unrelated suites, test cases, executions, or defects.
 */
export function applyOperationToProjectState(baseProject, op) {
  if (!baseProject || typeof baseProject !== 'object' || !op) {
    return baseProject;
  }

  const project = JSON.parse(JSON.stringify(baseProject));
  const entityType = String(op.entityType || 'data').trim();
  const opType = String(op.operationType || op.type || 'UPDATE').trim().toUpperCase();
  const payload = op.payload ? JSON.parse(JSON.stringify(op.payload)) : {};
  const delta = payload.delta !== undefined ? payload.delta : payload;

  if (!Array.isArray(project.testSuites)) project.testSuites = [];
  if (!Array.isArray(project.executions)) project.executions = [];
  if (!Array.isArray(project.defects)) project.defects = [];
  if (!Array.isArray(project.executionRuns)) project.executionRuns = [];
  if (!project.testPlan || typeof project.testPlan !== 'object') {
    project.testPlan = {
      id: `plan_${project.id}`,
      name: `${project.name || 'Project'} Master Test Plan`,
      description: '',
      objective: '',
      scope: '',
      notes: '',
      phases: []
    };
  }
  if (!Array.isArray(project.testPlan.phases)) {
    project.testPlan.phases = [];
  }

  if (entityType === 'project') {
    if (opType === 'CREATE') {
      const createdProj = payload.project || delta;
      if (createdProj && typeof createdProj === 'object') {
        Object.assign(project, createdProj);
      }
    } else if (opType === 'UPDATE' || opType === 'STATUS_CHANGE') {
      const updates = payload.updates || delta;
      if (updates && typeof updates === 'object') {
        if (updates.name !== undefined) project.name = updates.name;
        if (updates.type !== undefined) project.type = updates.type;
        if (updates.projectType !== undefined && updates.type === undefined) project.type = updates.projectType;
        if (updates.description !== undefined) project.description = updates.description;
        if (updates.status !== undefined) project.status = updates.status;
        if (updates.version !== undefined) project.version = updates.version;
        if (updates.promotedFromChecklistId !== undefined) {
          project.promotedFromChecklistId = updates.promotedFromChecklistId;
        }
      }
    }
    return project;
  }

  if (entityType === 'suite') {
    const targetSuiteId = String(op.entityId || delta?.suite?.id || delta?.id || payload?.suiteId || '').trim();
    if (opType === 'DELETE') {
      project.testSuites = project.testSuites.filter(s => String(s.id) !== targetSuiteId);
    } else {
      const suiteObj = delta?.suite || (delta?.id ? delta : null) || payload?.suite;
      if (suiteObj && suiteObj.id) {
        const idx = project.testSuites.findIndex(s => String(s.id) === String(suiteObj.id));
        if (idx >= 0) {
          const existingCases = project.testSuites[idx].cases || [];
          project.testSuites[idx] = {
            ...project.testSuites[idx],
            ...suiteObj,
            cases: Array.isArray(suiteObj.cases) ? suiteObj.cases : existingCases
          };
        } else {
          project.testSuites.push({
            cases: [],
            ...suiteObj
          });
        }
      }
    }
    return project;
  }

  if (entityType === 'testCase') {
    const targetCaseId = String(op.entityId || delta?.testCase?.id || delta?.id || payload?.caseId || '').trim();
    const targetSuiteId = String(delta?.suiteId || payload?.suiteId || delta?.testCase?.suiteId || '').trim();

    if (opType === 'DELETE') {
      for (const suite of project.testSuites) {
        if (!targetSuiteId || String(suite.id) === targetSuiteId) {
          if (Array.isArray(suite.cases)) {
            suite.cases = suite.cases.filter(c => String(c.id) !== targetCaseId);
          }
        }
      }
    } else {
      const caseObj = delta?.testCase || (delta?.id ? delta : null) || payload?.testCase;
      if (caseObj && caseObj.id) {
        let suite = targetSuiteId
          ? project.testSuites.find(s => String(s.id) === targetSuiteId)
          : project.testSuites.find(s => Array.isArray(s.cases) && s.cases.some(c => String(c.id) === String(caseObj.id)));

        if (!suite && targetSuiteId) {
          suite = {
            id: targetSuiteId,
            name: delta?.suiteName || 'Default Suite',
            description: '',
            createdAt: new Date().toISOString(),
            cases: []
          };
          project.testSuites.push(suite);
        }

        if (suite) {
          if (!Array.isArray(suite.cases)) suite.cases = [];
          const cIdx = suite.cases.findIndex(c => String(c.id) === String(caseObj.id));
          if (cIdx >= 0) {
            suite.cases[cIdx] = { ...suite.cases[cIdx], ...caseObj };
          } else {
            suite.cases.push({ ...caseObj });
          }
        }
      }
    }
    return project;
  }

  if (entityType === 'execution' || entityType === 'executionRun') {
    const targetId = String(op.entityId || delta?.execution?.id || delta?.id || '').trim();
    if (opType === 'DELETE' && entityType === 'execution') {
      project.executions = project.executions.filter(e => String(e.id) !== targetId);
    } else {
      const execObj = delta?.execution || (entityType === 'execution' && delta?.id ? delta : null) || payload?.execution;
      if (execObj && execObj.id) {
        const eIdx = project.executions.findIndex(e => String(e.id) === String(execObj.id));
        if (eIdx >= 0) {
          project.executions[eIdx] = { ...project.executions[eIdx], ...execObj };
        } else {
          project.executions.push({ ...execObj });
        }
      }

      // Also sync linked defect if execution failure auto-created one in delta
      const linkedDefect = delta?.defect || payload?.defect;
      if (linkedDefect && linkedDefect.id) {
        const dIdx = project.defects.findIndex(d => String(d.id) === String(linkedDefect.id));
        if (dIdx >= 0) {
          project.defects[dIdx] = { ...project.defects[dIdx], ...linkedDefect };
        } else {
          project.defects.push({ ...linkedDefect });
        }
      }

      const runObj = delta?.executionRun || (entityType === 'executionRun' && delta?.id ? delta : null) || payload?.executionRun;
      if (runObj && runObj.id) {
        const rIdx = project.executionRuns.findIndex(r => String(r.id) === String(runObj.id));
        if (rIdx >= 0) {
          project.executionRuns[rIdx] = { ...project.executionRuns[rIdx], ...runObj };
        } else {
          project.executionRuns.push({ ...runObj });
        }
      }

      if (delta?.activeRun !== undefined) {
        project.activeRun = delta.activeRun;
      } else if (payload?.activeRun !== undefined) {
        project.activeRun = payload.activeRun;
      }
    }
    return project;
  }

  if (entityType === 'defect') {
    const targetDefectId = String(op.entityId || delta?.defect?.id || delta?.id || payload?.defectId || '').trim();
    if (opType === 'DELETE') {
      project.defects = project.defects.filter(d => String(d.id) !== targetDefectId);
    } else {
      const defectObj = delta?.defect || (delta?.id ? delta : null) || payload?.defect;
      if (defectObj && defectObj.id) {
        const dIdx = project.defects.findIndex(d => String(d.id) === String(defectObj.id));
        if (dIdx >= 0) {
          project.defects[dIdx] = { ...project.defects[dIdx], ...defectObj };
        } else {
          project.defects.push({ ...defectObj });
        }
      }
    }
    return project;
  }

  if (entityType === 'phase') {
    const targetPhaseId = String(op.entityId || delta?.phase?.id || delta?.id || '').trim();
    if (opType === 'DELETE') {
      project.testPlan.phases = project.testPlan.phases.filter(p => String(p.id) !== targetPhaseId);
    } else {
      const phaseObj = delta?.phase || (delta?.id ? delta : null) || payload?.phase;
      if (phaseObj && phaseObj.id) {
        const pIdx = project.testPlan.phases.findIndex(p => String(p.id) === String(phaseObj.id));
        if (pIdx >= 0) {
          project.testPlan.phases[pIdx] = { ...project.testPlan.phases[pIdx], ...phaseObj };
        } else {
          project.testPlan.phases.push({ ...phaseObj });
        }
      }
    }
    return project;
  }

  if (entityType === 'testPlan') {
    const planObj = delta?.testPlan || payload?.testPlan || delta;
    if (planObj && typeof planObj === 'object') {
      project.testPlan = {
        ...project.testPlan,
        ...planObj,
        phases: Array.isArray(planObj.phases) ? planObj.phases : project.testPlan.phases
      };
    }
    return project;
  }

  // Fallback for general project data snapshot
  const snap = payload.projectSnapshot || delta;
  if (snap && typeof snap === 'object') {
    const dataFields = [
      'testPlan', 'testSuites', 'executions', 'defects', 'executionRuns',
      'activeRun', 'environment', 'environments', 'baseUrl', 'tags',
      'checklist', 'customChecklist', 'report', 'status'
    ];
    for (const key of dataFields) {
      if (snap[key] !== undefined) {
        project[key] = JSON.parse(JSON.stringify(snap[key]));
      }
    }
  }

  return project;
}

/**
 * Enqueue a formal project mutation operation into IndexedDB
 */
export async function queueProjectMutation(mutationSpec, userId = null) {
  if (!mutationSpec || typeof mutationSpec !== 'object') return null;

  const resolvedUser = resolveActiveUserId(userId || mutationSpec.userId);
  if (!resolvedUser) return null;

  const projectId = String(mutationSpec.projectId || mutationSpec.entityId || mutationSpec.payload?.id || '').trim();
  if (!projectId) return null;

  const entityType = String(mutationSpec.entityType || 'project').trim();
  const operationType = String(mutationSpec.operationType || mutationSpec.type || 'UPDATE').trim().toUpperCase();
  const entityId = String(mutationSpec.entityId || projectId).trim();
  const nowIso = new Date().toISOString();

  const allOps = await idbGetAll(STORE_PROJECT_OPERATIONS);
  const userOps = allOps.filter(op => op.userId === resolvedUser);

  // 1. Check explicit idempotency key or operation ID to prevent duplicate submissions
  if (mutationSpec.id || mutationSpec.idempotencyKey) {
    const targetOpId = mutationSpec.id ? String(mutationSpec.id) : null;
    const targetIdemKey = mutationSpec.idempotencyKey ? String(mutationSpec.idempotencyKey) : null;
    const existingById = userOps.find(op =>
      (targetOpId && op.id === targetOpId) ||
      (targetIdemKey && op.idempotencyKey === targetIdemKey)
    );
    if (existingById) {
      return existingById;
    }
  }

  // 2. Check if identical pending/syncing mutation already exists in queue
  const serializedPayload = JSON.stringify(mutationSpec.payload || {});
  const duplicatePending = userOps.find(op =>
    (op.status === 'pending' || op.status === 'syncing') &&
    op.projectId === projectId &&
    op.entityType === entityType &&
    op.entityId === entityId &&
    (op.operationType === operationType || op.type === operationType) &&
    JSON.stringify(op.payload || {}) === serializedPayload
  );
  if (duplicatePending) {
    return duplicatePending;
  }

  // 3. Determine expectedUpdatedAt from mutationSpec or cached project
  const cachedProject = await idbGet(STORE_PROJECTS_CACHE, projectId);
  const expectedUpdatedAt = mutationSpec.expectedUpdatedAt !== undefined
    ? mutationSpec.expectedUpdatedAt
    : (cachedProject?._serverUpdatedAt || cachedProject?.updatedAt || null);

  // 4. Handle project deletion: clean up cache and any obsolete pending child operations
  if (entityType === 'project' && operationType === 'DELETE') {
    await removeCachedProjectOffline(projectId, resolvedUser);

    const hadPendingProjectCreate = userOps.some(
      existing =>
        existing.projectId === projectId &&
        existing.entityType === 'project' &&
        (existing.operationType === 'CREATE' || existing.type === 'CREATE') &&
        existing.status === 'pending'
    );

    for (const existing of userOps) {
      if (existing.projectId === projectId && existing.id) {
        await idbDelete(STORE_PROJECT_OPERATIONS, existing.id);
      }
    }

    if (hadPendingProjectCreate && mutationSpec.forceServerDelete !== true) {
      broadcastSyncEvent('MUTATION_QUEUED', { userId: resolvedUser, projectId, entityType, operationType });
      return null;
    }
  } else if (entityType !== 'project' || operationType !== 'DELETE') {
    // Coalesce repeated updates to the exact same entity if a pending UPDATE/CREATE exists
    const existingSameEntityOp = userOps.find(op =>
      op.status === 'pending' &&
      op.projectId === projectId &&
      op.entityType === entityType &&
      op.entityId === entityId
    );

    if (existingSameEntityOp) {
      if (operationType === 'DELETE') {
        if (existingSameEntityOp.operationType === 'CREATE' && mutationSpec.cancelIfCreatedOffline === true) {
          await idbDelete(STORE_PROJECT_OPERATIONS, existingSameEntityOp.id);
          if (cachedProject) {
            const updatedProj = applyOperationToProjectState(cachedProject, {
              entityType,
              entityId,
              operationType: 'DELETE',
              payload: mutationSpec.payload || {}
            });
            await cacheProjectOffline(updatedProj, resolvedUser);
          }
          broadcastSyncEvent('MUTATION_QUEUED', { userId: resolvedUser, projectId, entityType, operationType });
          return null;
        }
        // Replace pending CREATE/UPDATE on child entity with DELETE
        existingSameEntityOp.operationType = 'DELETE';
        existingSameEntityOp.type = 'DELETE';
        existingSameEntityOp.payload = JSON.parse(serializedPayload);
        existingSameEntityOp.updatedAt = nowIso;
        await idbPut(STORE_PROJECT_OPERATIONS, existingSameEntityOp);
        if (cachedProject) {
          const updatedProj = applyOperationToProjectState(cachedProject, existingSameEntityOp);
          await cacheProjectOffline(updatedProj, resolvedUser);
        }
        broadcastSyncEvent('MUTATION_QUEUED', { userId: resolvedUser, projectId, entityType, operationType, opId: existingSameEntityOp.id });
        return existingSameEntityOp;
      }

      if (
        existingSameEntityOp.entityType === 'project' &&
        existingSameEntityOp.operationType === 'CREATE' &&
        (operationType === 'UPDATE' || operationType === 'STATUS_CHANGE')
      ) {
        const updates = mutationSpec.payload?.updates || mutationSpec.payload?.delta || mutationSpec.payload || {};
        const currentProjPayload = existingSameEntityOp.payload?.project || existingSameEntityOp.payload || {};
        const mergedProj = {
          ...currentProjPayload,
          ...updates,
          updatedAt: nowIso
        };
        existingSameEntityOp.payload = existingSameEntityOp.payload?.project
          ? { ...existingSameEntityOp.payload, project: mergedProj, ...updates }
          : mergedProj;
        existingSameEntityOp.updatedAt = nowIso;
        await idbPut(STORE_PROJECT_OPERATIONS, existingSameEntityOp);
        if (cachedProject) {
          const updatedProj = applyOperationToProjectState(cachedProject, {
            entityType: 'project',
            entityId: projectId,
            operationType,
            payload: { updates }
          });
          await cacheProjectOffline(updatedProj, resolvedUser);
        }
        broadcastSyncEvent('MUTATION_QUEUED', { userId: resolvedUser, projectId, entityType, operationType, opId: existingSameEntityOp.id });
        return existingSameEntityOp;
      }

      if (
        (existingSameEntityOp.operationType === 'UPDATE' || existingSameEntityOp.operationType === 'STATUS_CHANGE') &&
        (operationType === 'UPDATE' || operationType === 'STATUS_CHANGE')
      ) {
        existingSameEntityOp.operationType = operationType;
        existingSameEntityOp.type = operationType;
        existingSameEntityOp.payload = {
          ...(existingSameEntityOp.payload || {}),
          ...JSON.parse(serializedPayload),
          delta: {
            ...(existingSameEntityOp.payload?.delta || {}),
            ...(mutationSpec.payload?.delta || mutationSpec.payload || {})
          }
        };
        existingSameEntityOp.updatedAt = nowIso;
        if (!existingSameEntityOp.expectedUpdatedAt && expectedUpdatedAt) {
          existingSameEntityOp.expectedUpdatedAt = expectedUpdatedAt;
        }
        await idbPut(STORE_PROJECT_OPERATIONS, existingSameEntityOp);
        if (cachedProject) {
          const updatedProj = applyOperationToProjectState(cachedProject, existingSameEntityOp);
          await cacheProjectOffline(updatedProj, resolvedUser);
        }
        broadcastSyncEvent('MUTATION_QUEUED', { userId: resolvedUser, projectId, entityType, operationType, opId: existingSameEntityOp.id });
        return existingSameEntityOp;
      }
    }
  }

  const op = {
    id: mutationSpec.id ? String(mutationSpec.id) : generateOpId(`proj_op_${entityType.toLowerCase()}`),
    idempotencyKey: mutationSpec.idempotencyKey || null,
    seq: getNextSeq(),
    userId: resolvedUser,
    projectId,
    entityType,
    entityId,
    operationType,
    type: operationType,
    payload: JSON.parse(serializedPayload),
    expectedUpdatedAt: expectedUpdatedAt || null,
    createdAt: nowIso,
    updatedAt: nowIso,
    retryCount: 0,
    maxRetries: mutationSpec.maxRetries ?? DEFAULT_MAX_RETRIES,
    backoffDelayMs: 0,
    nextRetryAt: null,
    status: 'pending',
    requiresManualResolution: false,
    conflictDetails: null,
    lastError: null
  };

  await idbPut(STORE_PROJECT_OPERATIONS, op);

  // Keep offline project cache in sync with the queued mutation
  if (entityType === 'project' && operationType === 'CREATE') {
    const projSeed = op.payload?.project || op.payload?.projectSnapshot || op.payload;
    if (projSeed && typeof projSeed === 'object') {
      await cacheProjectOffline({ ...projSeed, id: projectId, _isOfflineCreated: true }, resolvedUser);
    }
  } else if (cachedProject && !(entityType === 'project' && operationType === 'DELETE')) {
    const updatedProj = applyOperationToProjectState(cachedProject, op);
    await cacheProjectOffline(updatedProj, resolvedUser);
  } else if (op.payload?.projectSnapshot && !(entityType === 'project' && operationType === 'DELETE')) {
    const updatedProj = applyOperationToProjectState(op.payload.projectSnapshot, op);
    await cacheProjectOffline(updatedProj, resolvedUser);
  }

  broadcastSyncEvent('MUTATION_QUEUED', {
    userId: resolvedUser,
    projectId,
    entityType,
    entityId,
    operationType,
    opId: op.id
  });

  return op;
}

/**
 * Get all queued formal project operations for a specific user
 */
export async function getPendingProjectOperations(userId = null, options = {}) {
  const resolvedUser = resolveActiveUserId(userId);
  if (!resolvedUser) return [];

  const allOps = await idbGetAll(STORE_PROJECT_OPERATIONS);
  let filtered = allOps.filter(op => op.userId === resolvedUser);

  if (options.projectId) {
    filtered = filtered.filter(op => op.projectId === String(options.projectId).trim());
  }
  if (options.status) {
    filtered = filtered.filter(op => op.status === options.status);
  }

  if (options.sortByDependency) {
    return sortProjectOperationsByDependency(filtered);
  }

  return filtered.sort((a, b) => (a.seq || 0) - (b.seq || 0));
}

export async function dequeueProjectOperation(opId) {
  if (!opId) return;
  await idbDelete(STORE_PROJECT_OPERATIONS, String(opId));
}

export async function dequeueProjectOperationIfLockValid(
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
    memoryProjectOperations.delete(String(opId));
    return true;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const safeResolve = (val) => { if (!settled) { settled = true; resolve(val); } };
    const safeReject = (err) => { if (!settled) { settled = true; reject(err); } };

    try {
      const tx = db.transaction([STORE_SYNC_LOCKS, STORE_PROJECT_OPERATIONS], 'readwrite');
      const lockStore = tx.objectStore(STORE_SYNC_LOCKS);
      const opStore = tx.objectStore(STORE_PROJECT_OPERATIONS);
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
      getReq.onerror = () => safeReject(getReq.error);
      tx.oncomplete = () => safeResolve(deleted);
      tx.onerror = () => safeReject(tx.error);
      tx.onabort = () => safeResolve(false);
    } catch (err) {
      safeReject(err);
    }
  });
}

/**
 * Returns a comprehensive synchronization status summary for the UI
 */
export async function getProjectSyncStatus(userId = null) {
  const resolvedUser = resolveActiveUserId(userId);
  const isOffline = isClientOffline();

  if (!resolvedUser) {
    return {
      online: !isOffline,
      isSyncing: activeSyncInProgressCount > 0,
      pendingCount: 0,
      syncingCount: 0,
      conflictCount: 0,
      failedCount: 0,
      totalQueuedCount: 0,
      requiresManualResolution: false,
      operations: [],
      checklistOperations: []
    };
  }

  const [projectOps, checklistOps] = await Promise.all([
    getPendingProjectOperations(resolvedUser),
    getPendingOperations(resolvedUser)
  ]);

  const pendingCount = projectOps.filter(op => op.status === 'pending').length +
    checklistOps.filter(op => op.status === 'pending').length;
  const syncingCount = projectOps.filter(op => op.status === 'syncing').length +
    checklistOps.filter(op => op.status === 'syncing').length;
  const conflictCount = projectOps.filter(op => op.status === 'conflict').length;
  const failedCount = projectOps.filter(op => op.status === 'failed').length;
  const requiresManualResolution = projectOps.some(
    op => op.requiresManualResolution || op.status === 'conflict' || op.status === 'failed'
  );

  return {
    online: !isOffline,
    isSyncing: activeSyncInProgressCount > 0 || syncingCount > 0,
    pendingCount,
    syncingCount,
    conflictCount,
    failedCount,
    totalQueuedCount: projectOps.length + checklistOps.length,
    requiresManualResolution,
    operations: projectOps,
    checklistOperations: checklistOps
  };
}

const activeProjectSyncUsers = new Set();

/**
 * Synchronize all pending formal project mutations for the authenticated user
 */
export async function processProjectSyncQueue(targetUserId = null, options = {}) {
  const authUserId = resolveActiveUserId(null);
  const activeUserId = targetUserId ? String(targetUserId).trim() : authUserId;

  if (!activeUserId) {
    return { ok: false, syncedCount: 0, reason: 'Unauthenticated' };
  }

  // Prevent cross-account synchronization
  if (authUserId && activeUserId !== authUserId) {
    console.warn(`Qavora ProjectSyncQueue: Blocked cross-account sync attempt for ${activeUserId} while logged in as ${authUserId}`);
    return { ok: false, syncedCount: 0, reason: 'Cross-account sync prevented' };
  }

  if (isClientOffline() && !options.ignoreOfflineState) {
    return { ok: false, syncedCount: 0, reason: 'Client is offline' };
  }

  if (!options.lockOwnerId && activeProjectSyncUsers.has(activeUserId)) {
    return { ok: false, syncedCount: 0, reason: 'Sync in progress' };
  }

  const lockKey = `qavora_project_sync_${activeUserId}`;
  const lockOwnerId = options.lockOwnerId || TAB_LOCK_OWNER_ID;

  if (
    !options.disableNavigatorLocks &&
    !options.lockOwnerId &&
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
        activeProjectSyncUsers.add(activeUserId);
        try {
          return await runProjectSyncPass(activeUserId, null, null, options);
        } finally {
          activeProjectSyncUsers.delete(activeUserId);
        }
      }
    );
  }

  const lockResult = await acquireIndexedDbSyncLock(lockKey, lockOwnerId, SYNC_LOCK_TTL_MS);
  if (!lockResult.acquired) {
    return { ok: false, syncedCount: 0, reason: 'Sync in progress' };
  }

  const { generation } = lockResult;
  const renewIntervalMs = Math.max(1000, Math.floor(SYNC_LOCK_TTL_MS / 3));
  const renewTimer = setInterval(() => {
    renewIndexedDbSyncLock(lockKey, lockOwnerId, generation, SYNC_LOCK_TTL_MS).catch(() => {});
  }, renewIntervalMs);
  if (typeof renewTimer.unref === 'function') {
    renewTimer.unref();
  }

  activeProjectSyncUsers.add(activeUserId);
  try {
    return await runProjectSyncPass(
      activeUserId,
      () => verifyIndexedDbSyncLock(lockKey, lockOwnerId, generation),
      { lockKey, ownerId: lockOwnerId, generation },
      options
    );
  } finally {
    activeProjectSyncUsers.delete(activeUserId);
    clearInterval(renewTimer);
    await releaseIndexedDbSyncLock(lockKey, lockOwnerId, generation);
  }
}

async function executeProjectOperationRequest(op, currentProjectState, effectiveExpectedUpdatedAt, transport) {
  const entityType = String(op.entityType || 'data').trim();
  const opType = String(op.operationType || op.type || 'UPDATE').trim().toUpperCase();
  const projectId = String(op.projectId || op.entityId).trim();

  if (entityType === 'project' && opType === 'CREATE') {
    const baseProj = op.payload?.project || currentProjectState || op.payload || {};
    const createBody = {
      ...baseProj,
      id: projectId,
      name: baseProj.name || 'Untitled Project',
      type: baseProj.type || baseProj.projectType || 'Web Application',
      description: baseProj.description || '',
      status: baseProj.status || 'Active'
    };
    delete createBody._id;
    delete createBody.userId;
    delete createBody._offlineCachedAt;
    delete createBody._serverUpdatedAt;
    delete createBody._isOfflineCreated;
    delete createBody._hasPendingOfflineMutations;

    return transport('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody)
    });
  }

  if (entityType === 'project' && (opType === 'UPDATE' || opType === 'STATUS_CHANGE')) {
    const rawUpdates = op.payload?.updates || op.payload?.delta || op.payload || {};
    const patchBody = {};
    if (rawUpdates.name !== undefined) patchBody.name = rawUpdates.name;
    if (rawUpdates.type !== undefined) patchBody.type = rawUpdates.type;
    if (rawUpdates.projectType !== undefined && patchBody.type === undefined) {
      patchBody.type = rawUpdates.projectType;
    }
    if (rawUpdates.version !== undefined) patchBody.version = rawUpdates.version;
    if (rawUpdates.description !== undefined) patchBody.description = rawUpdates.description;
    if (rawUpdates.status !== undefined) patchBody.status = rawUpdates.status;
    if (rawUpdates.environment !== undefined) patchBody.environment = rawUpdates.environment;
    if (rawUpdates.baseUrl !== undefined) patchBody.baseUrl = rawUpdates.baseUrl;
    if (rawUpdates.tags !== undefined) patchBody.tags = rawUpdates.tags;
    if (rawUpdates.promotedFromChecklistId !== undefined) {
      patchBody.promotedFromChecklistId = rawUpdates.promotedFromChecklistId;
    }
    if (effectiveExpectedUpdatedAt) {
      patchBody.expectedUpdatedAt = effectiveExpectedUpdatedAt;
    }

    return transport(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody)
    });
  }

  if (entityType === 'project' && opType === 'DELETE') {
    return transport(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE'
    });
  }

  // Suite, TestCase, Execution, Defect, TestPlan, Phase mutations -> PATCH /api/projects/:id/data
  const stateToSend = currentProjectState || {};
  const patchDataBody = {
    testPlan: stateToSend.testPlan || { phases: [] },
    testSuites: Array.isArray(stateToSend.testSuites) ? stateToSend.testSuites : [],
    executions: Array.isArray(stateToSend.executions) ? stateToSend.executions : [],
    defects: Array.isArray(stateToSend.defects) ? stateToSend.defects : []
  };

  const optionalKeys = [
    'executionRuns', 'activeRun', 'environment', 'environments',
    'baseUrl', 'tags', 'checklist', 'customChecklist', 'report', 'status'
  ];
  for (const k of optionalKeys) {
    if (stateToSend[k] !== undefined) {
      patchDataBody[k] = stateToSend[k];
    }
  }

  if (effectiveExpectedUpdatedAt) {
    patchDataBody.expectedUpdatedAt = effectiveExpectedUpdatedAt;
  }

  return transport(`/api/projects/${encodeURIComponent(projectId)}/data`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patchDataBody)
  });
}

async function runProjectSyncPass(activeUserId, verifyLock = null, lockContext = null, options = {}) {
  let syncedCount = 0;
  let conflictCount = 0;
  let failedCount = 0;
  const transport = typeof options.transport === 'function' ? options.transport : apiJson;

  activeSyncInProgressCount += 1;
  broadcastSyncEvent('SYNC_STARTED', { userId: activeUserId });

  try {
    const rawOps = await getPendingProjectOperations(activeUserId);
    const orderedOps = sortProjectOperationsByDependency(rawOps);

    if (orderedOps.length === 0) {
      return { ok: true, syncedCount: 0, conflictCount: 0, failedCount: 0 };
    }

    const blockedProjectIds = new Set();
    const projectVersionTracker = new Map(); // projectId -> { previousVersion, latestVersion }
    const projectStateTracker = new Map();   // projectId -> project state

    for (const op of orderedOps) {
      if (op.status === 'conflict') {
        blockedProjectIds.add(op.projectId);
        conflictCount += 1;
        continue;
      }
      if (op.status === 'failed' && !options.includeFailed) {
        blockedProjectIds.add(op.projectId);
        failedCount += 1;
        continue;
      }
      if (blockedProjectIds.has(op.projectId)) {
        continue;
      }
      if (options.respectBackoff && op.nextRetryAt) {
        const nextRetryMs = Date.parse(op.nextRetryAt);
        if (!Number.isNaN(nextRetryMs) && Date.now() < nextRetryMs) {
          blockedProjectIds.add(op.projectId);
          continue;
        }
      }

      if (verifyLock && !(await verifyLock())) {
        console.warn('Qavora ProjectSyncQueue: Lost sync lock ownership; halting queue.');
        break;
      }

      const freshAuthUserId = resolveActiveUserId(null);
      if (freshAuthUserId && freshAuthUserId !== activeUserId) {
        console.warn('Qavora ProjectSyncQueue: User session switched; halting queue.');
        break;
      }
      if (!freshAuthUserId && !options.allowImplicitUserInTests) {
        // Check if authController exists and explicitly logged out
        const ctrlUser = typeof authController !== 'undefined' && authController.getUser ? authController.getUser() : null;
        if (!ctrlUser && typeof window !== 'undefined' && window.authController) {
          console.warn('Qavora ProjectSyncQueue: User session terminated; halting queue.');
          break;
        }
      }

      // Mark operation as syncing
      op.status = 'syncing';
      op.updatedAt = new Date().toISOString();
      await idbPut(STORE_PROJECT_OPERATIONS, op);
      notifyOfflineSyncListeners({ type: 'OPERATION_SYNCING', opId: op.id, projectId: op.projectId });

      // Prepare current project state by applying this operation onto base project
      let baseProject = projectStateTracker.get(op.projectId);
      if (!baseProject) {
        baseProject = await idbGet(STORE_PROJECTS_CACHE, op.projectId);
      }
      if (!baseProject && op.payload?.projectSnapshot) {
        baseProject = JSON.parse(JSON.stringify(op.payload.projectSnapshot));
      }
      if (!baseProject) {
        baseProject = {
          id: op.projectId,
          userId: activeUserId,
          name: op.payload?.project?.name || op.payload?.name || 'Untitled Project',
          type: op.payload?.project?.type || op.payload?.type || 'Web Application',
          status: 'Active',
          testPlan: { phases: [] },
          testSuites: [],
          executions: [],
          defects: []
        };
      }

      const nextProjectState = applyOperationToProjectState(baseProject, op);

      // Resolve effective expectedUpdatedAt (advancing if an earlier op in this pass updated the same project)
      let effectiveExpectedUpdatedAt = op.expectedUpdatedAt || null;
      const versionInfo = projectVersionTracker.get(op.projectId);
      if (versionInfo && versionInfo.latestVersion) {
        effectiveExpectedUpdatedAt = versionInfo.latestVersion;
      }

      let res = null;
      let networkException = null;

      try {
        res = await executeProjectOperationRequest(
          op,
          nextProjectState,
          effectiveExpectedUpdatedAt,
          transport
        );

        // Idempotent handling for project CREATE if project already exists on server (409)
        const opType = String(op.operationType || op.type || '').toUpperCase();
        if (
          res &&
          !res.ok &&
          res.status === 409 &&
          op.entityType === 'project' &&
          opType === 'CREATE'
        ) {
          const existingServerVer = res.data?.currentUpdatedAt || res.data?.updatedAt || null;
          res = {
            ok: true,
            status: 200,
            data: {
              id: op.projectId,
              updatedAt: existingServerVer || baseProject.updatedAt || new Date().toISOString()
            }
          };
        }
      } catch (err) {
        networkException = err;
      }

      if (!networkException && res && (res.ok || (op.entityType === 'project' && (op.operationType === 'DELETE' || op.type === 'DELETE') && res.status === 404))) {
        // Success!
        const returnedUpdatedAt = res.data?.updatedAt || new Date().toISOString();
        const prevVersion = effectiveExpectedUpdatedAt || baseProject._serverUpdatedAt || baseProject.updatedAt || null;
        const existingTracker = projectVersionTracker.get(op.projectId) || {
          previousVersion: prevVersion,
          latestVersion: returnedUpdatedAt,
          knownVersions: new Set()
        };
        if (prevVersion) existingTracker.knownVersions.add(prevVersion);
        if (op.expectedUpdatedAt) existingTracker.knownVersions.add(op.expectedUpdatedAt);
        existingTracker.previousVersion = prevVersion;
        existingTracker.latestVersion = returnedUpdatedAt;
        projectVersionTracker.set(op.projectId, existingTracker);

        if (op.entityType === 'project' && (op.operationType === 'DELETE' || op.type === 'DELETE')) {
          projectStateTracker.delete(op.projectId);
          await removeCachedProjectOffline(op.projectId, activeUserId);
        } else {
          nextProjectState.updatedAt = returnedUpdatedAt;
          nextProjectState._serverUpdatedAt = returnedUpdatedAt;
          delete nextProjectState._isOfflineCreated;
          projectStateTracker.set(op.projectId, nextProjectState);
          await cacheProjectOffline(nextProjectState, activeUserId);
        }

        // Advance expectedUpdatedAt on remaining queued operations for the same project
        const remainingSameProjectOps = orderedOps.filter(
          other => other.id !== op.id && other.projectId === op.projectId && other.status === 'pending'
        );
        for (const nextOp of remainingSameProjectOps) {
          nextOp.expectedUpdatedAt = returnedUpdatedAt;
          await idbPut(STORE_PROJECT_OPERATIONS, nextOp);
        }

        if (lockContext) {
          const dequeued = await dequeueProjectOperationIfLockValid(
            op.id,
            lockContext.lockKey,
            lockContext.ownerId,
            lockContext.generation
          );
          if (!dequeued) {
            console.warn('Qavora ProjectSyncQueue: Lost sync lock ownership before dequeue; halting queue.');
            break;
          }
        } else {
          await dequeueProjectOperation(op.id);
        }

        syncedCount += 1;
      } else if (!networkException && res && res.status === 401) {
        // Authentication expired during synchronization -> preserve operation as pending and halt queue
        op.status = 'pending';
        op.lastError = 'Authentication session expired (HTTP 401)';
        op.updatedAt = new Date().toISOString();
        await idbPut(STORE_PROJECT_OPERATIONS, op);
        broadcastSyncEvent('SYNC_AUTH_EXPIRED', { userId: activeUserId, opId: op.id });
        return {
          ok: false,
          syncedCount,
          conflictCount,
          failedCount,
          authExpired: true,
          reason: 'Session expired (HTTP 401)'
        };
      } else if (!networkException && res && res.status === 409) {
        // Optimistic concurrency control conflict (HTTP 409)
        const serverUpdatedAt = res.data?.currentUpdatedAt || res.data?.updatedAt || null;
        op.status = 'conflict';
        op.requiresManualResolution = true;
        op.lastError = res.error || res.data?.error || 'Conflict (HTTP 409): Server record was modified by another session';
        op.conflictDetails = {
          expectedUpdatedAt: effectiveExpectedUpdatedAt || op.expectedUpdatedAt || null,
          currentUpdatedAt: serverUpdatedAt,
          message: op.lastError,
          detectedAt: new Date().toISOString()
        };
        op.updatedAt = new Date().toISOString();
        await idbPut(STORE_PROJECT_OPERATIONS, op);

        blockedProjectIds.add(op.projectId);
        conflictCount += 1;

        broadcastSyncEvent('SYNC_CONFLICT', {
          userId: activeUserId,
          projectId: op.projectId,
          opId: op.id,
          conflictDetails: op.conflictDetails
        });
      } else {
        // Determine whether failure is a permanent 4xx error or transient 5xx/network error
        const status = res?.status || 0;
        const isPermanentClientError =
          !networkException &&
          status >= 400 &&
          status < 500 &&
          status !== 401 &&
          status !== 404 &&
          status !== 408 &&
          status !== 409 &&
          status !== 429;

        op.retryCount = (op.retryCount || 0) + 1;
        const maxRetries = op.maxRetries ?? DEFAULT_MAX_RETRIES;
        const errorMessage = networkException
          ? (networkException.message || 'Network request failed')
          : (res?.error || res?.data?.error || `Server returned HTTP ${status}`);

        op.lastError = errorMessage;
        op.updatedAt = new Date().toISOString();

        if (isPermanentClientError || op.retryCount > maxRetries) {
          // Dead-letter state: requires manual recovery or discard
          op.status = 'failed';
          op.requiresManualResolution = true;
          op.failedAt = op.updatedAt;
          op.nextRetryAt = null;
          await idbPut(STORE_PROJECT_OPERATIONS, op);

          blockedProjectIds.add(op.projectId);
          failedCount += 1;

          broadcastSyncEvent('SYNC_FAILED', {
            userId: activeUserId,
            projectId: op.projectId,
            opId: op.id,
            error: errorMessage
          });
        } else {
          // Transient error: exponential backoff retry
          const delayMs = computeBackoffDelayMs(op.retryCount);
          op.status = 'pending';
          op.backoffDelayMs = delayMs;
          op.nextRetryAt = new Date(Date.now() + delayMs).toISOString();
          await idbPut(STORE_PROJECT_OPERATIONS, op);

          blockedProjectIds.add(op.projectId);
          // Halt queue pass on transient network/server outage to preserve ordering
          break;
        }
      }
    }

    const result = {
      ok: conflictCount === 0 && failedCount === 0,
      syncedCount,
      conflictCount,
      failedCount
    };

    broadcastSyncEvent('SYNC_COMPLETED', {
      userId: activeUserId,
      ...result
    });

    return result;
  } catch (err) {
    console.warn('Qavora ProjectSyncQueue: sync pass error:', err);
    return {
      ok: false,
      syncedCount,
      conflictCount,
      failedCount,
      error: err?.message || String(err)
    };
  } finally {
    activeSyncInProgressCount = Math.max(0, activeSyncInProgressCount - 1);
    notifyOfflineSyncListeners({ type: 'SYNC_IDLE', userId: activeUserId });
  }
}

/**
 * Resolve an HTTP 409 conflict on a queued project operation.
 * Strategies:
 * - 'merge' / 'keep_local' / 'force_local': Fetches latest server state, applies the user's mutation onto it,
 *   updates expectedUpdatedAt to the server's currentUpdatedAt, and synchronizes immediately.
 * - 'keep_server' / 'discard_local': Discards the conflicting local mutation and refreshes cache from server.
 */
export async function resolveProjectConflict(
  opId,
  strategy = 'merge',
  targetUserId = null,
  options = {}
) {
  if (!opId) return { ok: false, error: 'Missing operation ID' };
  const activeUserId = resolveActiveUserId(targetUserId);
  if (!activeUserId) return { ok: false, error: 'Unauthenticated' };

  const op = await idbGet(STORE_PROJECT_OPERATIONS, String(opId));
  if (!op) return { ok: false, error: 'Operation not found' };
  if (op.userId !== activeUserId) {
    return { ok: false, error: 'Cross-account conflict resolution prevented' };
  }

  const transport = typeof options.transport === 'function' ? options.transport : apiJson;
  const normalizedStrategy = String(strategy || 'merge').trim().toLowerCase();

  // Fetch latest server projects to get authoritative server record & timestamp
  let serverProject = options.serverProject || null;
  if (!serverProject) {
    try {
      const listRes = await transport('/api/projects', { method: 'GET' });
      if (listRes && listRes.ok && Array.isArray(listRes.data?.data || listRes.data)) {
        const list = Array.isArray(listRes.data?.data) ? listRes.data.data : listRes.data;
        serverProject = list.find(p => String(p.id) === String(op.projectId)) || null;
      }
    } catch (_) {}
  }

  if (normalizedStrategy === 'keep_server' || normalizedStrategy === 'discard_local' || normalizedStrategy === 'discard') {
    await idbDelete(STORE_PROJECT_OPERATIONS, String(opId));
    if (serverProject) {
      await cacheProjectOffline(serverProject, activeUserId);
    }
    broadcastSyncEvent('CONFLICT_RESOLVED', {
      userId: activeUserId,
      projectId: op.projectId,
      opId: op.id,
      strategy: normalizedStrategy
    });
    return { ok: true, resolved: true, strategy: normalizedStrategy, serverProject };
  }

  // Default: 'merge' / 'keep_local'
  const latestServerTimestamp =
    serverProject?.updatedAt ||
    op.conflictDetails?.currentUpdatedAt ||
    null;

  if (serverProject) {
    const mergedProject = applyOperationToProjectState(serverProject, op);
    mergedProject.updatedAt = latestServerTimestamp;
    mergedProject._serverUpdatedAt = latestServerTimestamp;
    await cacheProjectOffline(mergedProject, activeUserId);
    op.payload = {
      ...(op.payload || {}),
      projectSnapshot: mergedProject
    };
  }

  op.expectedUpdatedAt = latestServerTimestamp;
  op.status = 'pending';
  op.requiresManualResolution = false;
  op.conflictDetails = null;
  op.lastError = null;
  op.retryCount = 0;
  op.nextRetryAt = null;
  op.updatedAt = new Date().toISOString();

  await idbPut(STORE_PROJECT_OPERATIONS, op);

  broadcastSyncEvent('CONFLICT_RESOLVED', {
    userId: activeUserId,
    projectId: op.projectId,
    opId: op.id,
    strategy: normalizedStrategy
  });

  if (!isClientOffline() || options.ignoreOfflineState) {
    const syncResult = await processProjectSyncQueue(activeUserId, options);
    return { ok: syncResult.ok, resolved: true, strategy: normalizedStrategy, syncResult };
  }

  return { ok: true, resolved: true, strategy: normalizedStrategy };
}

/**
 * Retry a single failed/conflicted operation by resetting its status to 'pending'
 */
export async function retryProjectOperation(opId, targetUserId = null, options = {}) {
  if (!opId) return { ok: false, error: 'Missing operation ID' };
  const activeUserId = resolveActiveUserId(targetUserId);
  if (!activeUserId) return { ok: false, error: 'Unauthenticated' };

  const op = await idbGet(STORE_PROJECT_OPERATIONS, String(opId));
  if (!op) return { ok: false, error: 'Operation not found' };
  if (op.userId !== activeUserId) {
    return { ok: false, error: 'Cross-account retry prevented' };
  }

  op.status = 'pending';
  op.requiresManualResolution = false;
  op.retryCount = 0;
  op.backoffDelayMs = 0;
  op.nextRetryAt = null;
  op.lastError = null;
  op.updatedAt = new Date().toISOString();
  await idbPut(STORE_PROJECT_OPERATIONS, op);

  notifyOfflineSyncListeners({ type: 'OPERATION_RETRIED', opId: op.id, projectId: op.projectId });

  if (!isClientOffline() || options.ignoreOfflineState) {
    return processProjectSyncQueue(activeUserId, options);
  }
  return { ok: true, queued: true };
}

/**
 * Retry all failed operations for the current user
 */
export async function retryFailedProjectOperations(targetUserId = null, options = {}) {
  const activeUserId = resolveActiveUserId(targetUserId);
  if (!activeUserId) return { ok: false, error: 'Unauthenticated' };

  const ops = await getPendingProjectOperations(activeUserId);
  const failedOps = ops.filter(op => op.status === 'failed');

  for (const op of failedOps) {
    op.status = 'pending';
    op.requiresManualResolution = false;
    op.retryCount = 0;
    op.backoffDelayMs = 0;
    op.nextRetryAt = null;
    op.lastError = null;
    op.updatedAt = new Date().toISOString();
    await idbPut(STORE_PROJECT_OPERATIONS, op);
  }

  notifyOfflineSyncListeners({ type: 'FAILED_OPERATIONS_RETRIED', userId: activeUserId, count: failedOps.length });

  if (!isClientOffline() || options.ignoreOfflineState) {
    return processProjectSyncQueue(activeUserId, options);
  }
  return { ok: true, retriedCount: failedOps.length };
}

/**
 * Discard a failed or conflicting operation from the queue
 */
export async function discardProjectOperation(opId, targetUserId = null) {
  if (!opId) return { ok: false, error: 'Missing operation ID' };
  const activeUserId = resolveActiveUserId(targetUserId);
  if (!activeUserId) return { ok: false, error: 'Unauthenticated' };

  const op = await idbGet(STORE_PROJECT_OPERATIONS, String(opId));
  if (!op) return { ok: false, error: 'Operation not found' };
  if (op.userId !== activeUserId) {
    return { ok: false, error: 'Cross-account discard prevented' };
  }

  await idbDelete(STORE_PROJECT_OPERATIONS, String(opId));
  broadcastSyncEvent('OPERATION_DISCARDED', {
    userId: activeUserId,
    projectId: op.projectId,
    opId: op.id
  });
  return { ok: true, discardedId: op.id };
}

/**
 * Synchronize both QA Checklists and Formal Projects offline queues
 */
export async function syncAllOfflineQueues(targetUserId = null, options = {}) {
  const [checklistRes, projectRes] = await Promise.all([
    processChecklistSyncQueue(targetUserId),
    processProjectSyncQueue(targetUserId, options)
  ]);
  return {
    ok: Boolean(checklistRes?.ok && projectRes?.ok),
    checklistSync: checklistRes,
    projectSync: projectRes,
    totalSynced: (checklistRes?.syncedCount || 0) + (projectRes?.syncedCount || 0)
  };
}

// ============================================================================
// Auto-Sync Event Listeners
// ============================================================================
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  // Sync automatically when network connectivity returns
  window.addEventListener('online', () => {
    notifyOfflineSyncListeners({ type: 'ONLINE' });
    processChecklistSyncQueue().catch((err) => {
      console.warn('Qavora SyncQueue: Auto-sync checklists on online event warning:', err);
    });
    processProjectSyncQueue().catch((err) => {
      console.warn('Qavora SyncQueue: Auto-sync projects on online event warning:', err);
    });
  });

  window.addEventListener('offline', () => {
    notifyOfflineSyncListeners({ type: 'OFFLINE' });
  });

  // Sync automatically when window / tab regains focus
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        processChecklistSyncQueue().catch(() => {});
        processProjectSyncQueue().catch(() => {});
      }
    });
  }
}
