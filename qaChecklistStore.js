/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — QA Checklists Persistence, Validation & Progress Store (Prompt 2)
 * Manages browser localStorage persistence under versioned keys completely
 * independent of unrelated Qavora project storage.
 */

export const CHECKLISTS_STORAGE_KEY = 'qavora_qa_checklists_v1';
export const ACTIVE_RUNNER_STORAGE_KEY = 'qavora_qa_active_runner_v1';
export const LEGACY_CHECKLISTS_STORAGE_KEY = 'testpilot_qa_checklists_v1';
export const LEGACY_ACTIVE_RUNNER_STORAGE_KEY = 'testpilot_qa_active_runner_v1';
export const SCHEMA_VERSION = 1;

export const TEST_STATUS = Object.freeze({
  NOT_STARTED: 'Not Started',
  COMPLETED: 'Completed'
});

let fallbackCounter = 1;

export function generateStableId(prefix = 'id') {
  fallbackCounter += 1;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}_${fallbackCounter}`;
}

/**
 * Memory fallback used only if browser localStorage is disabled/blocked or in headless tests.
 */
function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    }
  };
}

let memoryFallback = null;
let customStorageAdapter = null;

export function setStorageAdapterForTesting(adapterOrNull) {
  customStorageAdapter = adapterOrNull;
}

export function isQuotaExceededError(err) {
  if (!err) return false;
  return Boolean(
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.name === 'QUOTA_EXCEEDED_ERR' ||
    err.name === 'W3CException_DOM_QUOTA_EXCEEDED_ERR' ||
    err.code === 22 ||
    err.code === 1014 ||
    err.number === -2147024882 ||
    (typeof err.message === 'string' &&
      /quota.*(?:exceeded|reached)|(?:exceeded|reached).*quota|storage.*full|insufficient.*(?:storage|space|quota)/i.test(err.message))
  );
}

export function isSecurityError(err) {
  if (!err) return false;
  return Boolean(
    err.name === 'SecurityError' ||
    err.name === 'SECURITY_ERR' ||
    err.code === 18 ||
    (typeof err.message === 'string' &&
      /security|denied|insecure|permission|access.*denied|operation.*insecure/i.test(err.message))
  );
}

export function getStorageErrorMessage(err, context = 'saving data') {
  if (isQuotaExceededError(err)) {
    return 'Browser storage is full or has insufficient available space. The latest changes could not be saved. Previously saved data remains available. Please export a backup and free storage space before retrying.';
  }
  if (isSecurityError(err)) {
    return 'Storage access is restricted or denied by your browser security settings (e.g. strict private browsing mode). Changes cannot be saved to browser storage.';
  }
  if (err && typeof err.message === 'string' && err.message.trim()) {
    return `Storage write failed during ${context}: ${err.message}`;
  }
  return `Storage write failed during ${context}: Unable to save changes to browser storage.`;
}

export function getStorageBackend() {
  if (customStorageAdapter) {
    return { backend: customStorageAdapter, isFallback: false };
  }
  try {
    const storageCandidate = typeof window !== 'undefined' && window.localStorage
      ? window.localStorage
      : (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storageCandidate) {
      const probeKey = '__tp_qa_probe__';
      storageCandidate.setItem(probeKey, '1');
      storageCandidate.removeItem(probeKey);
      return { backend: storageCandidate, isFallback: false };
    }
  } catch (_err) {
    // localStorage blocked (e.g. strict privacy mode)
  }
  if (!memoryFallback) {
    memoryFallback = createMemoryStorage();
  }
  return { backend: memoryFallback, isFallback: true };
}

export function safeStorageWrite(key, serializedValue, context = 'saving data') {
  const { backend, isFallback } = getStorageBackend();
  try {
    backend.setItem(key, serializedValue);
    return {
      ok: true,
      isFallback,
      isQuota: false,
      isSecurity: false,
      error: null,
      valueOf() { return true; }
    };
  } catch (err) {
    const isQuota = isQuotaExceededError(err);
    const isSecurity = isSecurityError(err);
    const errorMsg = getStorageErrorMessage(err, context);
    console.error(`Qavora: Storage write failed during ${context}`, err);
    return {
      ok: false,
      isFallback,
      isQuota,
      isSecurity,
      error: errorMsg,
      valueOf() { return false; }
    };
  }
}

export function safeStorageRead(key) {
  const { backend, isFallback } = getStorageBackend();
  try {
    const raw = backend.getItem(key);
    return { ok: true, raw, value: raw, isFallback, error: null };
  } catch (err) {
    console.error(`Qavora: Storage read failed for key ${key}`, err);
    return { ok: false, raw: null, value: null, isFallback, error: err };
  }
}

export function safeStorageRemove(key) {
  const { backend, isFallback } = getStorageBackend();
  try {
    backend.removeItem(key);
    return { ok: true, isFallback };
  } catch (err) {
    console.error(`Qavora: Storage removal failed for key ${key}`, err);
    return { ok: false, isFallback, error: err };
  }
}

// ============================================================================
// Normalization & Schema Validation
// ============================================================================

function normalizeTestRecord(rawTest) {
  if (!rawTest || typeof rawTest !== 'object') return null;
  const text = typeof rawTest.text === 'string'
    ? rawTest.text.trim()
    : (rawTest.text !== undefined && rawTest.text !== null ? String(rawTest.text).trim() : '');
  const testId = typeof rawTest.testId === 'string'
    ? rawTest.testId.trim()
    : (rawTest.testId !== undefined && rawTest.testId !== null ? String(rawTest.testId).trim() : '');
  const priority = typeof rawTest.priority === 'string'
    ? rawTest.priority.trim()
    : (rawTest.priority !== undefined && rawTest.priority !== null ? String(rawTest.priority).trim() : '');

  const rawStatusStr = typeof rawTest.status === 'string' ? rawTest.status.trim() : '';
  const isRecognizedStatus =
    rawStatusStr.toLowerCase() === TEST_STATUS.COMPLETED.toLowerCase() ||
    rawStatusStr.toLowerCase() === TEST_STATUS.NOT_STARTED.toLowerCase();

  const isCompleted = isRecognizedStatus
    ? rawStatusStr.toLowerCase() === TEST_STATUS.COMPLETED.toLowerCase()
    : rawTest.completed === true;

  return {
    id: typeof rawTest.id === 'string' && rawTest.id.trim() ? rawTest.id.trim() : generateStableId('test'),
    testId,
    priority,
    text: text !== '' ? text : 'Untitled test item',
    status: isCompleted ? TEST_STATUS.COMPLETED : TEST_STATUS.NOT_STARTED,
    completed: isCompleted
  };
}

function normalizeNoteRecord(rawNote) {
  if (!rawNote || typeof rawNote !== 'object') return null;
  const text = typeof rawNote.text === 'string'
    ? rawNote.text.trim()
    : (rawNote.text !== undefined && rawNote.text !== null ? String(rawNote.text).trim() : '');
  if (!text) return null;
  const validKinds = ['environment', 'instruction', 'note'];
  return {
    id: typeof rawNote.id === 'string' && rawNote.id.trim() ? rawNote.id.trim() : generateStableId('note'),
    kind: validKinds.includes(rawNote.kind) ? rawNote.kind : 'note',
    text
  };
}

function normalizeSectionRecord(rawSec) {
  if (!rawSec || typeof rawSec !== 'object') return null;
  const type = rawSec.type === 'category' ? 'category' : 'direct';
  const name = type === 'category'
    ? (typeof rawSec.name === 'string' && rawSec.name.trim()
        ? rawSec.name.trim()
        : (rawSec.name !== undefined && rawSec.name !== null && String(rawSec.name).trim() !== ''
            ? String(rawSec.name).trim()
            : 'Category'))
    : '';

  const notes = Array.isArray(rawSec.notes)
    ? rawSec.notes.map(normalizeNoteRecord).filter(Boolean)
    : [];

  const seenTestIds = new Set();
  const tests = Array.isArray(rawSec.tests)
    ? rawSec.tests
        .map(normalizeTestRecord)
        .filter(Boolean)
        .map(tc => {
          if (seenTestIds.has(tc.id)) {
            return { ...tc, id: generateStableId('test') };
          }
          seenTestIds.add(tc.id);
          return tc;
        })
    : [];

  return {
    id: typeof rawSec.id === 'string' && rawSec.id.trim() ? rawSec.id.trim() : generateStableId('sec'),
    type,
    name,
    notes,
    tests
  };
}

export function derivePhaseNumberFromLabel(phaseLabel, fallbackNumber = '') {
  const lbl = typeof phaseLabel === 'string'
    ? phaseLabel.trim()
    : (phaseLabel !== undefined && phaseLabel !== null ? String(phaseLabel).trim() : '');
  const fallbackStr = typeof fallbackNumber === 'string'
    ? fallbackNumber.trim()
    : (typeof fallbackNumber === 'number' ? String(fallbackNumber) : '');
  if (!lbl) return fallbackStr;
  const cleaned = lbl.replace(/[:—–\-.]+$/, '').trim();
  const tokenMatch =
    cleaned.match(/(?:#|\s)([0-9]+(?:\.[0-9]+)*|[A-Za-z0-9]+)$/) ||
    cleaned.match(/^([0-9]+(?:\.[0-9]+)*)$/);
  if (tokenMatch) {
    const token = tokenMatch[1].trim();
    if (['phase', 'stage', 'testing', 'qa', 'unknown'].includes(token.toLowerCase())) {
      return fallbackStr;
    }
    return token;
  }
  return fallbackStr;
}

export function parsePhaseNumber(val) {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  const token = derivePhaseNumberFromLabel(trimmed, trimmed);
  const match = token.match(/^(\d+(?:\.\d+)?)/);
  if (match) {
    const parsed = parseFloat(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function comparePhaseNumbers(numA, numB) {
  const valA = parsePhaseNumber(numA);
  const valB = parsePhaseNumber(numB);

  if (valA !== null && valB !== null) {
    if (valA !== valB) {
      return valA - valB;
    }
    return String(numA ?? '').localeCompare(String(numB ?? ''), undefined, { numeric: true, sensitivity: 'base' });
  }

  if (valA !== null && valB === null) return -1;
  if (valA === null && valB !== null) return 1;

  return String(numA ?? '').localeCompare(String(numB ?? ''), undefined, { numeric: true, sensitivity: 'base' });
}

export function comparePhases(phaseA, phaseB) {
  if (!phaseA && !phaseB) return 0;
  if (!phaseA) return 1;
  if (!phaseB) return -1;

  if (typeof phaseA.order === 'number' && typeof phaseB.order === 'number' && phaseA.order !== phaseB.order) {
    return phaseA.order - phaseB.order;
  }

  const numA = (phaseA.phaseNumber !== undefined && phaseA.phaseNumber !== null && phaseA.phaseNumber !== '')
    ? String(phaseA.phaseNumber)
    : (typeof phaseA.phaseLabel === 'string' ? derivePhaseNumberFromLabel(phaseA.phaseLabel, '') : '');
  const numB = (phaseB.phaseNumber !== undefined && phaseB.phaseNumber !== null && phaseB.phaseNumber !== '')
    ? String(phaseB.phaseNumber)
    : (typeof phaseB.phaseLabel === 'string' ? derivePhaseNumberFromLabel(phaseB.phaseLabel, '') : '');

  if ((numA !== '' && numA !== undefined && numA !== null) || (numB !== '' && numB !== undefined && numB !== null)) {
    const comp = comparePhaseNumbers(numA, numB);
    if (comp !== 0) return comp;
  }

  const nameA = phaseA.name !== undefined && phaseA.name !== null ? String(phaseA.name) : '';
  const nameB = phaseB.name !== undefined && phaseB.name !== null ? String(phaseB.name) : '';
  return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
}

export function sortPhases(phases) {
  if (!Array.isArray(phases)) return [];
  return [...phases].sort(comparePhases);
}

function normalizePhaseRecord(rawPhase, idx = 0) {
  if (!rawPhase || typeof rawPhase !== 'object') return null;

  const phaseLabel = typeof rawPhase.phaseLabel === 'string'
    ? rawPhase.phaseLabel.trim()
    : (rawPhase.phaseLabel !== undefined && rawPhase.phaseLabel !== null ? String(rawPhase.phaseLabel).trim() : '');
  const rawPhaseNumber = typeof rawPhase.phaseNumber === 'string'
    ? rawPhase.phaseNumber.trim()
    : (typeof rawPhase.phaseNumber === 'number' ? String(rawPhase.phaseNumber) : '');
  const phaseNumber = phaseLabel ? derivePhaseNumberFromLabel(phaseLabel, rawPhaseNumber) : rawPhaseNumber;
  const name =
    rawPhase.name !== undefined && rawPhase.name !== null && String(rawPhase.name).trim()
      ? String(rawPhase.name).trim()
      : `Phase ${idx + 1}`;
  const description = typeof rawPhase.description === 'string' ? rawPhase.description.trim() : '';

  const notes = Array.isArray(rawPhase.notes)
    ? rawPhase.notes.map(normalizeNoteRecord).filter(Boolean)
    : [];

  const seenSectionIds = new Set();
  const sections = Array.isArray(rawPhase.sections)
    ? rawPhase.sections
        .map(normalizeSectionRecord)
        .filter(Boolean)
        .map(sec => {
          if (seenSectionIds.has(sec.id)) {
            return { ...sec, id: generateStableId('sec') };
          }
          seenSectionIds.add(sec.id);
          return sec;
        })
    : [];

  return {
    id: typeof rawPhase.id === 'string' && rawPhase.id.trim() ? rawPhase.id.trim() : generateStableId('phase'),
    phaseLabel,
    phaseNumber,
    name,
    isImplicit: Boolean(rawPhase.isImplicit),
    description,
    expanded: rawPhase.expanded !== false, // Expanded by default
    notes,
    sections
  };
}

export function normalizeChecklistRecord(rawChecklist) {
  if (!rawChecklist || typeof rawChecklist !== 'object') return null;

  const nowIso = new Date().toISOString();
  const createdAt =
    typeof rawChecklist.createdAt === 'string' && !Number.isNaN(Date.parse(rawChecklist.createdAt))
      ? rawChecklist.createdAt
      : nowIso;
  const updatedAt =
    typeof rawChecklist.updatedAt === 'string' && !Number.isNaN(Date.parse(rawChecklist.updatedAt))
      ? rawChecklist.updatedAt
      : createdAt;

  const title =
    rawChecklist.title !== undefined && rawChecklist.title !== null && String(rawChecklist.title).trim()
      ? String(rawChecklist.title).trim()
      : 'Untitled QA Checklist';

  const documentNotes = Array.isArray(rawChecklist.documentNotes)
    ? rawChecklist.documentNotes.map(normalizeNoteRecord).filter(Boolean)
    : [];

  const seenPhaseIds = new Set();
  const seenGlobalTestIds = new Set();

  const phases = Array.isArray(rawChecklist.phases)
    ? rawChecklist.phases
        .map((ph, idx) => normalizePhaseRecord(ph, idx))
        .filter(Boolean)
        .map(ph => {
          const safePhase = seenPhaseIds.has(ph.id) ? { ...ph, id: generateStableId('phase') } : ph;
          seenPhaseIds.add(safePhase.id);
          safePhase.sections = safePhase.sections.map(sec => ({
            ...sec,
            tests: sec.tests.map(tc => {
              if (seenGlobalTestIds.has(tc.id)) {
                const freshId = generateStableId('test');
                seenGlobalTestIds.add(freshId);
                return { ...tc, id: freshId };
              }
              seenGlobalTestIds.add(tc.id);
              return tc;
            })
          }));
          return safePhase;
        })
    : [];

  const promotedProjectId =
    typeof rawChecklist.promotedProjectId === 'string' && rawChecklist.promotedProjectId.trim()
      ? rawChecklist.promotedProjectId.trim()
      : null;

  const promotedAt =
    typeof rawChecklist.promotedAt === 'string' && !Number.isNaN(Date.parse(rawChecklist.promotedAt))
      ? rawChecklist.promotedAt
      : null;

  return {
    id:
      typeof rawChecklist.id === 'string' && rawChecklist.id.trim()
        ? rawChecklist.id.trim()
        : generateStableId('chk'),
    schemaVersion: SCHEMA_VERSION,
    title,
    createdAt,
    updatedAt,
    documentNotes,
    phases,
    promotedProjectId,
    promotedAt
  };
}

// ============================================================================
// Progress Calculations (Requirement 10)
// ============================================================================

function computeSafePercentage(completedCount, totalCount) {
  if (!totalCount || totalCount <= 0 || completedCount <= 0) {
    return 0;
  }
  if (completedCount >= totalCount) {
    return 100;
  }
  // Never round an incomplete checklist up to 100%, and never round non-zero progress down to 0%
  const rawPct = Math.round((completedCount / totalCount) * 100);
  return Math.min(99, Math.max(1, rawPct));
}

export function calculatePhaseProgress(phase) {
  if (!phase || !Array.isArray(phase.sections)) {
    return {
      totalTests: 0,
      completedTests: 0,
      remainingTests: 0,
      percentage: 0,
      isComplete: false
    };
  }

  let totalTests = 0;
  let completedTests = 0;

  for (const sec of phase.sections) {
    if (!Array.isArray(sec.tests)) continue;
    for (const tc of sec.tests) {
      totalTests += 1;
      if (tc.status === TEST_STATUS.COMPLETED || tc.completed === true) {
        completedTests += 1;
      }
    }
  }

  const remainingTests = Math.max(0, totalTests - completedTests);
  const percentage = computeSafePercentage(completedTests, totalTests);

  return {
    totalTests,
    completedTests,
    remainingTests,
    percentage,
    isComplete: totalTests > 0 && completedTests === totalTests
  };
}

export function calculateChecklistProgress(checklist) {
  if (!checklist || !Array.isArray(checklist.phases)) {
    return {
      totalPhases: 0,
      totalTests: 0,
      completedTests: 0,
      remainingTests: 0,
      percentage: 0,
      isComplete: false
    };
  }

  let totalTests = 0;
  let completedTests = 0;

  for (const phase of checklist.phases) {
    const pp = calculatePhaseProgress(phase);
    totalTests += pp.totalTests;
    completedTests += pp.completedTests;
  }

  const remainingTests = Math.max(0, totalTests - completedTests);
  const percentage = computeSafePercentage(completedTests, totalTests);

  return {
    totalPhases: checklist.phases.length,
    totalTests,
    completedTests,
    remainingTests,
    percentage,
    isComplete: totalTests > 0 && completedTests === totalTests
  };
}

// ============================================================================
// Title Derivation Helper
// ============================================================================

export function deriveDefaultChecklistTitle(parsedPlan) {
  if (parsedPlan) {
    if (parsedPlan.documentTitle !== undefined && parsedPlan.documentTitle !== null && String(parsedPlan.documentTitle).trim() !== '') {
      return String(parsedPlan.documentTitle).trim();
    }
    if (parsedPlan.title !== undefined && parsedPlan.title !== null && String(parsedPlan.title).trim() !== '') {
      return String(parsedPlan.title).trim();
    }
  }

  if (parsedPlan && Array.isArray(parsedPlan.phases) && parsedPlan.phases.length > 0) {
    const firstNamed = parsedPlan.phases.find(p => !p.isImplicit && p.name !== undefined && p.name !== null && String(p.name).trim() !== '');
    if (firstNamed) {
      const cleanName = String(firstNamed.name).trim();
      if (parsedPlan.phases.length === 1) {
        return `${cleanName} QA Checklist`;
      }
      return `QA Checklist — ${cleanName} (+${parsedPlan.phases.length - 1} more)`;
    }
  }

  const dateStr = new Date().toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  return `Manual QA Checklist (${dateStr})`;
}

// ============================================================================
// Storage Read / Write Operations & Safe Migration
// ============================================================================

/**
 * Performs a safe, one-time backward-compatible migration from legacy TestPilot
 * storage keys to Qavora storage keys. Existing Qavora data is never overwritten.
 * Old keys are removed only after verified successful write to the new key.
 */
export function migrateLegacyChecklistStorage() {
  const { backend } = getStorageBackend();
  try {
    // 1. Migrate Checklists Key
    const currentQavoraData = backend.getItem(CHECKLISTS_STORAGE_KEY);
    const legacyChecklistData = backend.getItem(LEGACY_CHECKLISTS_STORAGE_KEY);
    if (!currentQavoraData && legacyChecklistData) {
      try {
        const parsed = JSON.parse(legacyChecklistData);
        if (parsed) {
          const writeRes = safeStorageWrite(CHECKLISTS_STORAGE_KEY, legacyChecklistData, 'migrating QA checklists from legacy storage');
          if (writeRes && writeRes.ok) {
            const verified = backend.getItem(CHECKLISTS_STORAGE_KEY);
            if (verified === legacyChecklistData) {
              try {
                backend.removeItem(LEGACY_CHECKLISTS_STORAGE_KEY);
              } catch (_) {}
            }
          }
        }
      } catch (_parseErr) {
        // If malformed, let loadAllChecklists handle safe recovery
      }
    }

    // 2. Migrate Active Runner State Key
    const currentRunnerData = backend.getItem(ACTIVE_RUNNER_STORAGE_KEY);
    const legacyRunnerData = backend.getItem(LEGACY_ACTIVE_RUNNER_STORAGE_KEY);
    if (!currentRunnerData && legacyRunnerData) {
      try {
        const parsed = JSON.parse(legacyRunnerData);
        if (parsed && typeof parsed === 'object') {
          const writeRes = safeStorageWrite(ACTIVE_RUNNER_STORAGE_KEY, legacyRunnerData, 'migrating active runner state from legacy storage');
          if (writeRes && writeRes.ok) {
            const verified = backend.getItem(ACTIVE_RUNNER_STORAGE_KEY);
            if (verified === legacyRunnerData) {
              try {
                backend.removeItem(LEGACY_ACTIVE_RUNNER_STORAGE_KEY);
              } catch (_) {}
            }
          }
        }
      } catch (_) {}
    }
  } catch (err) {
    console.warn('Qavora: Error during legacy checklist storage migration', err);
  }
}

export function loadAllChecklists() {
  const { backend, isFallback } = getStorageBackend();
  try {
    migrateLegacyChecklistStorage();
    const raw = backend.getItem(CHECKLISTS_STORAGE_KEY);
    if (!raw) {
      return { checklists: [], warning: isFallback ? 'Local storage is restricted; using session memory.' : null };
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_parseErr) {
      console.warn(`Qavora: Malformed JSON in ${CHECKLISTS_STORAGE_KEY}; recovering safely.`);
      return {
        checklists: [],
        warning: 'Stored checklist data appeared corrupted and could not be parsed. Starting with a clean state.'
      };
    }

    const rawItems = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray(parsed.checklists)
        ? parsed.checklists
        : null;

    if (!rawItems) {
      return {
        checklists: [],
        warning: 'Stored checklist format was invalid and was safely ignored.'
      };
    }

    const seenChecklistIds = new Set();
    const checklists = rawItems
      .map(normalizeChecklistRecord)
      .filter(Boolean)
      .map(chk => {
        if (seenChecklistIds.has(chk.id)) {
          const repairedId = generateStableId('chk');
          seenChecklistIds.add(repairedId);
          return { ...chk, id: repairedId };
        }
        seenChecklistIds.add(chk.id);
        return chk;
      });

    return {
      checklists,
      warning: isFallback ? 'Browser localStorage is unavailable; changes will only persist for this tab session.' : null
    };
  } catch (err) {
    console.error('Qavora: Failed reading QA checklists', err);
    return {
      checklists: [],
      warning: 'Unable to access browser storage.'
    };
  }
}

export function saveAllChecklists(checklistsArray) {
  try {
    const normalized = Array.isArray(checklistsArray)
      ? checklistsArray.map(normalizeChecklistRecord).filter(Boolean)
      : [];

    const payload = JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      checklists: normalized
    });

    return safeStorageWrite(CHECKLISTS_STORAGE_KEY, payload, 'saving QA checklists');
  } catch (err) {
    const isQuota = isQuotaExceededError(err);
    const isSecurity = isSecurityError(err);
    const errorMsg = getStorageErrorMessage(err, 'saving QA checklists');
    console.error('Qavora: Failed saving QA checklists', err);
    return {
      ok: false,
      isFallback: false,
      isQuota,
      isSecurity,
      error: errorMsg,
      valueOf() { return false; }
    };
  }
}

export function getActiveRunnerState() {
  const { backend } = getStorageBackend();
  try {
    migrateLegacyChecklistStorage();
    const raw = backend.getItem(ACTIVE_RUNNER_STORAGE_KEY);
    if (!raw) return { activeChecklistId: null, lastQaView: null };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { activeChecklistId: null, lastQaView: null };
    }
    return {
      activeChecklistId: typeof parsed.activeChecklistId === 'string' ? parsed.activeChecklistId : null,
      lastQaView: typeof parsed.lastQaView === 'string' ? parsed.lastQaView : null
    };
  } catch (_err) {
    return { activeChecklistId: null, lastQaView: null };
  }
}

export function saveActiveRunnerState(partialState) {
  try {
    const current = getActiveRunnerState();
    const next = {
      activeChecklistId:
        partialState && 'activeChecklistId' in partialState
          ? partialState.activeChecklistId
          : current.activeChecklistId,
      lastQaView:
        partialState && 'lastQaView' in partialState
          ? partialState.lastQaView
          : current.lastQaView
    };
    if (
      next.activeChecklistId === current.activeChecklistId &&
      next.lastQaView === current.lastQaView
    ) {
      return { ok: true, isFallback: false, isQuota: false, isSecurity: false, error: null, valueOf() { return true; } };
    }
    return safeStorageWrite(ACTIVE_RUNNER_STORAGE_KEY, JSON.stringify(next), 'saving active runner state');
  } catch (err) {
    const isQuota = isQuotaExceededError(err);
    const isSecurity = isSecurityError(err);
    return {
      ok: false,
      isFallback: false,
      isQuota,
      isSecurity,
      error: getStorageErrorMessage(err, 'saving active runner state'),
      valueOf() { return false; }
    };
  }
}

export function getChecklistById(checklistId) {
  if (!checklistId) return null;
  const { checklists } = loadAllChecklists();
  return checklists.find(c => c.id === checklistId) || null;
}

// ============================================================================
// Checklist Lifecycle & Granular Runner Mutations
// ============================================================================

export function createChecklistFromParsedPlan(parsedPlan, customTitle = '') {
  if (!parsedPlan || !Array.isArray(parsedPlan.phases) || parsedPlan.phases.length === 0) {
    return {
      ok: false,
      checklist: null,
      error: 'Cannot start testing: the checklist contains no phases.'
    };
  }

  // Filter out completely blank placeholder test rows that user added and left empty, while preserving valid tests
  const cleanedPhases = parsedPlan.phases.map((ph, pIdx) => {
    const cleanedSections = (Array.isArray(ph.sections) ? ph.sections : [])
      .map(sec => {
        const validTests = (Array.isArray(sec.tests) ? sec.tests : [])
          .filter(t => t && (typeof t.text === 'string' ? t.text.trim().length > 0 : (t.text !== undefined && t.text !== null && String(t.text).trim().length > 0)))
          .map(t => ({
            id: generateStableId('test'),
            testId: typeof t.testId === 'string' ? t.testId.trim() : (t.testId !== undefined && t.testId !== null ? String(t.testId).trim() : ''),
            priority: typeof t.priority === 'string' ? t.priority.trim() : (t.priority !== undefined && t.priority !== null ? String(t.priority).trim() : ''),
            text: String(t.text).trim(),
            status: TEST_STATUS.NOT_STARTED,
            completed: false
          }));

        return {
          id: generateStableId('sec'),
          type: sec.type === 'category' ? 'category' : 'direct',
          name: sec.type === 'category' ? ((sec.name !== undefined && sec.name !== null && String(sec.name).trim() !== '') ? String(sec.name).trim() : 'Category') : '',
          notes: Array.isArray(sec.notes)
            ? sec.notes
                .filter(n => n && (typeof n.text === 'string' ? n.text.trim() : (n.text !== undefined && n.text !== null && String(n.text).trim())))
                .map(n => ({
                  id: generateStableId('note'),
                  kind: n.kind || 'note',
                  text: String(n.text).trim()
                }))
            : [],
          tests: validTests
        };
      })
      .filter(sec => sec.type === 'category' || sec.tests.length > 0 || sec.notes.length > 0);

    const cleanedLabel = typeof ph.phaseLabel === 'string'
      ? ph.phaseLabel.trim()
      : (ph.phaseLabel !== undefined && ph.phaseLabel !== null ? String(ph.phaseLabel).trim() : '');
    const cleanedNum = typeof ph.phaseNumber === 'string'
      ? ph.phaseNumber.trim()
      : (typeof ph.phaseNumber === 'number' ? String(ph.phaseNumber) : '');

    return {
      id: generateStableId('phase'),
      phaseLabel: cleanedLabel,
      phaseNumber: cleanedLabel ? derivePhaseNumberFromLabel(cleanedLabel, cleanedNum) : (cleanedNum !== '' ? cleanedNum : ''),
      name: (ph.name !== undefined && ph.name !== null && String(ph.name).trim()) ? String(ph.name).trim() : `Phase ${pIdx + 1}`,
      isImplicit: Boolean(ph.isImplicit),
      description: typeof ph.description === 'string' ? ph.description.trim() : '',
      expanded: true,
      notes: Array.isArray(ph.notes)
        ? ph.notes
            .filter(n => n && typeof n.text === 'string' && n.text.trim())
            .map(n => ({
              id: generateStableId('note'),
              kind: n.kind || 'note',
              text: n.text.trim()
            }))
        : [],
      sections: cleanedSections
    };
  });

  const totalValidTests = cleanedPhases.reduce(
    (sum, ph) => sum + ph.sections.reduce((sAcc, sec) => sAcc + sec.tests.length, 0),
    0
  );

  if (totalValidTests === 0) {
    return {
      ok: false,
      checklist: null,
      error: 'Add at least one test item before starting manual testing.'
    };
  }

  const nowIso = new Date().toISOString();
  const resolvedTitle =
    (customTitle !== undefined && customTitle !== null && String(customTitle).trim() !== '')
      ? String(customTitle).trim()
      : deriveDefaultChecklistTitle(parsedPlan);

  const newChecklist = normalizeChecklistRecord({
    id: generateStableId('chk'),
    schemaVersion: SCHEMA_VERSION,
    title: resolvedTitle,
    createdAt: nowIso,
    updatedAt: nowIso,
    documentNotes: Array.isArray(parsedPlan.documentNotes) ? parsedPlan.documentNotes : [],
    phases: cleanedPhases
  });

  const { checklists } = loadAllChecklists();
  // Prepend new checklist without overwriting any existing checklist
  const existingIds = new Set(checklists.map(c => c.id));
  while (existingIds.has(newChecklist.id)) {
    newChecklist.id = generateStableId('chk');
  }

  const nextList = [newChecklist, ...checklists];
  const saveRes = saveAllChecklists(nextList);
  if (!saveRes.ok) {
    return {
      ok: false,
      checklist: null,
      isQuota: saveRes.isQuota,
      isSecurity: saveRes.isSecurity,
      error: saveRes.error
    };
  }

  saveActiveRunnerState({
    activeChecklistId: newChecklist.id,
    lastQaView: 'qa-runner'
  });

  return {
    ok: true,
    checklist: newChecklist,
    isFallback: saveRes.isFallback,
    error: null
  };
}

function mutateChecklistById(checklistId, mutatorFn, touchUpdatedAt = true) {
  const { checklists } = loadAllChecklists();
  const idx = checklists.findIndex(c => c.id === checklistId);
  if (idx === -1) {
    return { ok: false, checklist: null, error: 'Checklist not found.' };
  }

  const targetOriginal = checklists[idx];
  const targetClone = JSON.parse(JSON.stringify(targetOriginal));
  const didMutate = mutatorFn(targetClone);
  if (didMutate === false) {
    return { ok: false, checklist: targetOriginal, error: 'Requested item could not be found.' };
  }

  if (touchUpdatedAt) {
    targetClone.updatedAt = new Date().toISOString();
  }

  const nextList = [...checklists];
  nextList[idx] = targetClone;

  const saveRes = saveAllChecklists(nextList);
  if (!saveRes.ok) {
    return {
      ok: false,
      checklist: targetOriginal,
      isQuota: saveRes.isQuota,
      isSecurity: saveRes.isSecurity,
      error: saveRes.error
    };
  }

  return { ok: true, checklist: targetClone, error: null };
}

export function toggleChecklistTest(checklistId, targetTestId, completedState) {
  let matchedPhaseId = null;
  let updatedTest = null;

  const res = mutateChecklistById(checklistId, checklist => {
    for (const phase of checklist.phases) {
      for (const sec of phase.sections) {
        const tc = sec.tests.find(t => t.id === targetTestId);
        if (tc) {
          const nextBool = typeof completedState === 'boolean' ? completedState : !tc.completed;
          tc.completed = nextBool;
          tc.status = nextBool ? TEST_STATUS.COMPLETED : TEST_STATUS.NOT_STARTED;
          matchedPhaseId = phase.id;
          updatedTest = tc;
          return true;
        }
      }
    }
    return false;
  });

  return {
    ...res,
    phaseId: matchedPhaseId,
    test: updatedTest
  };
}

export function setChecklistPhaseExpanded(checklistId, phaseId, expandedBool) {
  return mutateChecklistById(
    checklistId,
    checklist => {
      const ph = checklist.phases.find(p => p.id === phaseId);
      if (!ph) return false;
      ph.expanded = Boolean(expandedBool);
      return true;
    },
    false // Expanding/collapsing UI section shouldn't alter content updatedAt timestamp
  );
}

export function setAllChecklistPhasesExpanded(checklistId, expandedBool) {
  return mutateChecklistById(
    checklistId,
    checklist => {
      for (const ph of checklist.phases) {
        ph.expanded = Boolean(expandedBool);
      }
      return true;
    },
    false
  );
}

export function renameChecklistById(checklistId, newTitle) {
  const cleanTitle = typeof newTitle === 'string' ? newTitle.trim() : '';
  if (!cleanTitle) {
    return { ok: false, checklist: null, error: 'Checklist title cannot be empty.' };
  }
  return mutateChecklistById(checklistId, checklist => {
    checklist.title = cleanTitle;
    return true;
  });
}

export function deleteChecklistById(checklistId) {
  const { checklists } = loadAllChecklists();
  const nextList = checklists.filter(c => c.id !== checklistId);
  if (nextList.length === checklists.length) {
    return { ok: false, remaining: checklists, error: 'Checklist not found.' };
  }

  const saveRes = saveAllChecklists(nextList);
  if (!saveRes.ok) {
    return {
      ok: false,
      remaining: checklists,
      isQuota: saveRes.isQuota,
      isSecurity: saveRes.isSecurity,
      error: saveRes.error
    };
  }

  const activeState = getActiveRunnerState();
  if (activeState.activeChecklistId === checklistId) {
    saveActiveRunnerState({
      activeChecklistId: nextList.length > 0 ? nextList[0].id : null,
      lastQaView: nextList.length > 0 ? activeState.lastQaView : 'my-checklists'
    });
  }

  return { ok: true, remaining: nextList, error: null };
}

// ============================================================================
// Runner In-Place Editing Operations (Requirement 9 — Preserves Completion State)
// ============================================================================

export function updateDocumentNotesInChecklist(checklistId, nextNotesArray) {
  return mutateChecklistById(checklistId, checklist => {
    checklist.documentNotes = Array.isArray(nextNotesArray)
      ? nextNotesArray.map(normalizeNoteRecord).filter(Boolean)
      : [];
    return true;
  });
}

export function updatePhaseInChecklist(checklistId, phaseId, updates = {}) {
  return mutateChecklistById(checklistId, checklist => {
    const phase = checklist.phases.find(p => p.id === phaseId);
    if (!phase) return false;
    if (typeof updates.phaseLabel === 'string' || typeof updates.phaseLabel === 'number') {
      phase.phaseLabel = String(updates.phaseLabel).trim();
      phase.phaseNumber = phase.phaseLabel
        ? derivePhaseNumberFromLabel(phase.phaseLabel, phase.phaseNumber)
        : '';
      phase.isImplicit = false;
    }
    if (typeof updates.phaseNumber === 'string') {
      phase.phaseNumber = updates.phaseNumber.trim();
      phase.isImplicit = false;
    } else if (typeof updates.phaseNumber === 'number') {
      phase.phaseNumber = String(updates.phaseNumber);
      phase.isImplicit = false;
    }
    if (typeof updates.name === 'string' || typeof updates.name === 'number') {
      const trimmedName = String(updates.name).trim();
      if (trimmedName) {
        phase.name = trimmedName;
        phase.isImplicit = false;
      }
    }
    if (typeof updates.description === 'string') {
      phase.description = updates.description.trim();
    }
    if (Array.isArray(updates.notes)) {
      phase.notes = updates.notes.map(normalizeNoteRecord).filter(Boolean);
    }
    return true;
  });
}

export function addPhaseToChecklist(checklistId, { phaseLabel = '', name = 'New Phase', description = '' } = {}) {
  let createdPhase = null;
  const res = mutateChecklistById(checklistId, checklist => {
    const defaultLabel = `Phase ${checklist.phases.length + 1}`;
    const rawLabelStr = typeof phaseLabel === 'number' ? String(phaseLabel) : (typeof phaseLabel === 'string' ? phaseLabel : '');
    const assignedLabel = rawLabelStr.trim() !== '' ? rawLabelStr.trim() : defaultLabel;
    const assignedNum = rawLabelStr.trim() !== ''
      ? derivePhaseNumberFromLabel(assignedLabel, String(checklist.phases.length + 1))
      : String(checklist.phases.length + 1);
    createdPhase = {
      id: generateStableId('phase'),
      phaseLabel: assignedLabel,
      phaseNumber: assignedNum,
      name: (typeof name === 'number' ? String(name) : (typeof name === 'string' ? name : '')).trim() || 'New Phase',
      isImplicit: false,
      description: typeof description === 'string' ? description.trim() : '',
      expanded: true,
      notes: [],
      sections: []
    };
    checklist.phases.push(createdPhase);
    return true;
  });
  return { ...res, phase: createdPhase };
}

export function removePhaseFromChecklist(checklistId, phaseId) {
  return mutateChecklistById(checklistId, checklist => {
    const idx = checklist.phases.findIndex(p => p.id === phaseId);
    if (idx === -1) return false;
    checklist.phases.splice(idx, 1);
    return true;
  });
}

export function updateCategoryInChecklist(checklistId, phaseId, sectionId, newCategoryName) {
  const cleanName = typeof newCategoryName === 'string'
    ? newCategoryName.trim()
    : (typeof newCategoryName === 'number' ? String(newCategoryName).trim() : '');
  if (cleanName === '') {
    return { ok: false, checklist: null, error: 'Category name cannot be empty.' };
  }
  return mutateChecklistById(checklistId, checklist => {
    const phase = checklist.phases.find(p => p.id === phaseId);
    if (!phase) return false;
    const sec = phase.sections.find(s => s.id === sectionId && s.type === 'category');
    if (!sec) return false;
    sec.name = cleanName;
    return true;
  });
}

export function addCategoryToChecklistPhase(checklistId, phaseId, categoryName = 'New Category') {
  let createdSection = null;
  const res = mutateChecklistById(checklistId, checklist => {
    const phase = checklist.phases.find(p => p.id === phaseId);
    if (!phase) return false;
    const rawCatStr = typeof categoryName === 'number' ? String(categoryName) : (typeof categoryName === 'string' ? categoryName : '');
    createdSection = {
      id: generateStableId('sec'),
      type: 'category',
      name: rawCatStr.trim() !== '' ? rawCatStr.trim() : 'New Category',
      notes: [],
      tests: []
    };
    phase.sections.push(createdSection);
    phase.expanded = true;
    return true;
  });
  return { ...res, section: createdSection };
}

export function updateTestInChecklist(checklistId, targetTestId, updates = {}) {
  return mutateChecklistById(checklistId, checklist => {
    for (const phase of checklist.phases) {
      for (const sec of phase.sections) {
        const tc = sec.tests.find(t => t.id === targetTestId);
        if (tc) {
          if (typeof updates.text === 'string') {
            const cleanText = updates.text.trim();
            if (!cleanText) return false;
            tc.text = cleanText;
          }
          if (typeof updates.testId === 'string') {
            tc.testId = updates.testId.trim();
          } else if (typeof updates.testId === 'number') {
            tc.testId = String(updates.testId);
          }
          if (typeof updates.priority === 'string') {
            tc.priority = updates.priority.trim();
          } else if (typeof updates.priority === 'number') {
            tc.priority = String(updates.priority);
          }
          // Strictly preserve tc.completed & tc.status!
          return true;
        }
      }
    }
    return false;
  });
}

export function addTestToChecklistPhase(
  checklistId,
  phaseId,
  sectionIdOrNull = null,
  { testId = '', priority = '', text = '' } = {}
) {
  const cleanText = typeof text === 'string' ? text.trim() : (typeof text === 'number' ? String(text).trim() : '');
  if (cleanText === '') {
    return { ok: false, checklist: null, error: 'Test description cannot be empty.' };
  }

  let createdTest = null;

  const res = mutateChecklistById(checklistId, checklist => {
    const phase = checklist.phases.find(p => p.id === phaseId);
    if (!phase) return false;

    let targetSec = sectionIdOrNull
      ? phase.sections.find(s => s.id === sectionIdOrNull)
      : null;

    if (!targetSec) {
      targetSec = phase.sections.find(s => s.type === 'direct');
      if (!targetSec) {
        targetSec = {
          id: generateStableId('sec'),
          type: 'direct',
          name: '',
          notes: [],
          tests: []
        };
        phase.sections.push(targetSec);
      }
    }

    createdTest = {
      id: generateStableId('test'),
      testId: typeof testId === 'string' ? testId.trim() : (typeof testId === 'number' ? String(testId) : ''),
      priority: typeof priority === 'string' ? priority.trim() : (typeof priority === 'number' ? String(priority) : ''),
      text: cleanText,
      status: TEST_STATUS.NOT_STARTED,
      completed: false
    };

    targetSec.tests.push(createdTest);
    phase.expanded = true;
    return true;
  });

  return { ...res, test: createdTest };
}

export function removeTestFromChecklist(checklistId, targetTestId) {
  return mutateChecklistById(checklistId, checklist => {
    for (const phase of checklist.phases) {
      for (const sec of phase.sections) {
        const tIdx = sec.tests.findIndex(t => t.id === targetTestId);
        if (tIdx !== -1) {
          sec.tests.splice(tIdx, 1);
          return true;
        }
      }
    }
    return false;
  });
}

// ============================================================================
// Active Runner State Normalization & Full Backup / Rollback Support (QAV-ISS-013)
// ============================================================================

const VALID_QA_VIEWS = ['checklist-generator', 'my-checklists', 'qa-runner'];

export function normalizeActiveRunnerState(rawRunnerState, checklists = null) {
  let activeChecklistId = null;
  let lastQaView = null;

  if (rawRunnerState && typeof rawRunnerState === 'object' && !Array.isArray(rawRunnerState)) {
    if (typeof rawRunnerState.activeChecklistId === 'string' && rawRunnerState.activeChecklistId.trim()) {
      activeChecklistId = rawRunnerState.activeChecklistId.trim();
    }
    if (typeof rawRunnerState.lastQaView === 'string' && VALID_QA_VIEWS.includes(rawRunnerState.lastQaView.trim())) {
      lastQaView = rawRunnerState.lastQaView.trim();
    }
  }

  if (Array.isArray(checklists)) {
    const validIds = new Set(
      checklists
        .filter(c => c && typeof c.id === 'string' && c.id.trim())
        .map(c => c.id.trim())
    );
    if (activeChecklistId && !validIds.has(activeChecklistId)) {
      activeChecklistId = checklists.length > 0 ? checklists[0].id : null;
    } else if (!activeChecklistId && checklists.length > 0 && lastQaView === 'qa-runner') {
      activeChecklistId = checklists[0].id;
    }
    if (checklists.length === 0 && lastQaView === 'qa-runner') {
      lastQaView = null;
    }
  }

  return {
    activeChecklistId,
    lastQaView
  };
}

export function replaceActiveRunnerState(rawRunnerState, checklists = null) {
  try {
    const normalized = normalizeActiveRunnerState(rawRunnerState, checklists);
    const writeRes = safeStorageWrite(
      ACTIVE_RUNNER_STORAGE_KEY,
      JSON.stringify(normalized),
      'restoring active runner state'
    );
    return {
      ...writeRes,
      state: normalized
    };
  } catch (err) {
    const isQuota = isQuotaExceededError(err);
    const isSecurity = isSecurityError(err);
    return {
      ok: false,
      isFallback: false,
      isQuota,
      isSecurity,
      state: { activeChecklistId: null, lastQaView: null },
      error: getStorageErrorMessage(err, 'restoring active runner state'),
      valueOf() { return false; }
    };
  }
}

// ============================================================================
// Persistent Storage Footprint Calculation (QAV-ISS-009)
// ============================================================================

export const QAVORA_PERSISTENT_STORAGE_KEYS = Object.freeze([
  'qavora_projects_v1',
  'qavora_activities_v1',
  'qavora_theme_preference',
  CHECKLISTS_STORAGE_KEY,
  ACTIVE_RUNNER_STORAGE_KEY
]);

export function calculateQavoraStorageFootprint(quotaBytes = 5 * 1024 * 1024) {
  const { backend } = getStorageBackend();
  const keyBytes = {};
  let totalBytes = 0;

  for (const key of QAVORA_PERSISTENT_STORAGE_KEYS) {
    let raw = '';
    try {
      const val = backend.getItem(key);
      raw = typeof val === 'string' ? val : '';
    } catch (_err) {
      raw = '';
    }
    const bytes = raw.length * 2; // UTF-16 code units in browser Web Storage
    keyBytes[key] = bytes;
    totalBytes += bytes;
  }

  const kbNumeric = totalBytes / 1024;
  const formattedKB = totalBytes === 0 ? '0.0 KB' : `${kbNumeric.toFixed(1)} KB`;
  const rawPercent = quotaBytes > 0 ? (totalBytes / quotaBytes) * 100 : 0;
  const clampedPercent = totalBytes === 0 ? 0 : Math.min(100, Math.max(0.01, rawPercent));
  const formattedPercent =
    totalBytes === 0
      ? '0% used'
      : rawPercent < 1
        ? `< 1% used (${ kbNumeric.toFixed(1) } KB)`
        : `${Math.min(100, rawPercent).toFixed(2)}% used`;
  const barWidthPercent = totalBytes === 0 ? 0 : Math.min(100, Math.max(1, rawPercent));

  return {
    totalBytes,
    kbNumeric,
    formattedKB,
    rawPercent,
    clampedPercent,
    formattedPercent,
    barWidthPercent,
    keyBytes
  };
}

// ============================================================================
// Promote Saved QA Checklist to Formal Project (QAV-ISS-001)
// ============================================================================

const PROJECTS_STORAGE_KEY = 'qavora_projects_v1';

const FORMAL_SUITE_CATEGORIES = [
  'Functional',
  'UI/UX',
  'Security',
  'Performance',
  'Compatibility',
  'Integration',
  'Regression',
  'Accessibility',
  'Other'
];

function inferFormalSuiteCategory(sectionName) {
  if (!sectionName || typeof sectionName !== 'string') return 'Functional';
  const clean = sectionName.trim();
  const exact = FORMAL_SUITE_CATEGORIES.find(c => c.toLowerCase() === clean.toLowerCase());
  if (exact) return exact;

  const lower = clean.toLowerCase();
  if (lower.includes('ui') || lower.includes('ux') || lower.includes('visual') || lower.includes('design') || lower.includes('layout')) {
    return 'UI/UX';
  }
  if (lower.includes('secur') || lower.includes('auth') || lower.includes('permission') || lower.includes('xss') || lower.includes('csrf')) {
    return 'Security';
  }
  if (lower.includes('perf') || lower.includes('speed') || lower.includes('load') || lower.includes('latency')) {
    return 'Performance';
  }
  if (lower.includes('compat') || lower.includes('browser') || lower.includes('device') || lower.includes('mobile') || lower.includes('responsive')) {
    return 'Compatibility';
  }
  if (lower.includes('integrat') || lower.includes('api') || lower.includes('webhook') || lower.includes('sync')) {
    return 'Integration';
  }
  if (lower.includes('regress') || lower.includes('smoke') || lower.includes('sanity')) {
    return 'Regression';
  }
  if (lower.includes('accessib') || lower.includes('a11y') || lower.includes('wcag') || lower.includes('keyboard') || lower.includes('screen reader')) {
    return 'Accessibility';
  }
  return 'Functional';
}

function normalizeFormalCasePriority(rawPriority) {
  if (!rawPriority || typeof rawPriority !== 'string') return 'Medium';
  const p = rawPriority.trim().toLowerCase();
  if (p === 'critical' || p === 'p0' || p === 'blocker' || p === 'urgent') return 'Critical';
  if (p === 'high' || p === 'p1' || p === 'major') return 'High';
  if (p === 'low' || p === 'p3' || p === 'p4' || p === 'minor' || p === 'trivial') return 'Low';
  return 'Medium';
}

export function getChecklistPromotionPreview(checklist) {
  const normalized = normalizeChecklistRecord(checklist);
  if (!normalized) {
    return {
      valid: false,
      title: '',
      phasesCount: 0,
      suitesCount: 0,
      casesCount: 0,
      completedChecklistItemsCount: 0
    };
  }

  let phasesCount = 0;
  let suitesCount = 0;
  let casesCount = 0;
  let completedChecklistItemsCount = 0;

  for (const phase of normalized.phases) {
    phasesCount += 1;
    const sections = Array.isArray(phase.sections) ? phase.sections : [];
    const activeSections = sections.filter(sec => {
      const hasTests = Array.isArray(sec.tests) && sec.tests.length > 0;
      const hasNotes = Array.isArray(sec.notes) && sec.notes.length > 0;
      return sec.type === 'category' || hasTests || hasNotes;
    });

    if (activeSections.length === 0) {
      suitesCount += 1; // Default suite for empty phase so phase has a suite container
    } else {
      suitesCount += activeSections.length;
    }

    for (const sec of sections) {
      if (!Array.isArray(sec.tests)) continue;
      for (const tc of sec.tests) {
        casesCount += 1;
        if (tc.completed === true || tc.status === TEST_STATUS.COMPLETED) {
          completedChecklistItemsCount += 1;
        }
      }
    }
  }

  return {
    valid: phasesCount > 0,
    title: normalized.title,
    phasesCount,
    suitesCount,
    casesCount,
    completedChecklistItemsCount
  };
}

export function findPromotedProjectForChecklist(checklistOrId, projectsArray = null) {
  const checklist =
    typeof checklistOrId === 'string'
      ? getChecklistById(checklistOrId)
      : checklistOrId;
  if (!checklist || typeof checklist !== 'object') return null;

  let projects = projectsArray;
  if (!Array.isArray(projects)) {
    const readRes = safeStorageRead(PROJECTS_STORAGE_KEY);
    if (readRes.ok && readRes.value) {
      try {
        const parsed = JSON.parse(readRes.value);
        if (Array.isArray(parsed)) projects = parsed;
      } catch (_e) {
        projects = [];
      }
    } else {
      projects = [];
    }
  }

  return (
    projects.find(
      p =>
        p &&
        typeof p === 'object' &&
        ((checklist.id && p.sourceChecklistId === checklist.id) ||
          (checklist.promotedProjectId && p.id === checklist.promotedProjectId))
    ) || null
  );
}

export function buildProjectFromChecklist(checklist, options = {}) {
  const normalized = normalizeChecklistRecord(checklist);
  if (!normalized || !Array.isArray(normalized.phases) || normalized.phases.length === 0) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const projectId =
    typeof options.projectId === 'string' && options.projectId.trim()
      ? options.projectId.trim()
      : 'proj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

  const projectName =
    typeof options.projectName === 'string' && options.projectName.trim()
      ? options.projectName.trim()
      : normalized.title;

  const projectType =
    typeof options.projectType === 'string' && options.projectType.trim()
      ? options.projectType.trim()
      : 'Web Application';

  const docNotesText =
    Array.isArray(normalized.documentNotes) && normalized.documentNotes.length > 0
      ? normalized.documentNotes.map(n => n.text).filter(Boolean).join('\n')
      : '';

  const formalPhases = [];
  const formalSuites = [];
  let globalCaseSeq = 1;

  normalized.phases.forEach((ph, pIdx) => {
    const formalPhaseId = 'ph_' + generateStableId('p');
    const phaseNumber = Number.isFinite(Number(ph.phaseNumber)) ? Number(ph.phaseNumber) : pIdx + 1;
    const phaseName = ph.name || `Phase ${phaseNumber}`;
    const phaseNotesText = [
      ph.description || '',
      ...(Array.isArray(ph.notes) ? ph.notes.map(n => n.text).filter(Boolean) : [])
    ]
      .filter(Boolean)
      .join('\n');

    formalPhases.push({
      id: formalPhaseId,
      phaseNumber,
      name: phaseName,
      description: phaseNotesText || `Converted from QA Checklist phase "${phaseName}".`,
      order: pIdx + 1,
      sourceChecklistPhaseId: ph.id || null,
      createdAt: nowIso,
      updatedAt: nowIso
    });

    const rawSections = Array.isArray(ph.sections) ? ph.sections : [];
    const activeSections = rawSections.filter(sec => {
      const hasTests = Array.isArray(sec.tests) && sec.tests.length > 0;
      const hasNotes = Array.isArray(sec.notes) && sec.notes.length > 0;
      return sec.type === 'category' || hasTests || hasNotes;
    });

    const sectionsToConvert =
      activeSections.length > 0
        ? activeSections
        : [{ id: generateStableId('sec'), type: 'direct', name: `${phaseName} — General Tests`, notes: [], tests: [] }];

    sectionsToConvert.forEach((sec, sIdx) => {
      const suiteId = 'ts_' + generateStableId('s');
      const isDirect = sec.type === 'direct' || !sec.name || !String(sec.name).trim();
      const suiteName = isDirect
        ? sectionsToConvert.length === 1
          ? `${phaseName} — General Suite`
          : `${phaseName} — General Suite ${sIdx + 1}`
        : String(sec.name).trim();
      const suiteCategory = isDirect ? 'Functional' : inferFormalSuiteCategory(suiteName);
      const secNotesText = Array.isArray(sec.notes)
        ? sec.notes.map(n => n.text).filter(Boolean).join('\n')
        : '';

      const formalCases = (Array.isArray(sec.tests) ? sec.tests : []).map(tc => {
        const caseId = 'tc_' + generateStableId('c');
        const formattedCaseCode = `TC-${String(globalCaseSeq).padStart(3, '0')}`;
        globalCaseSeq += 1;

        const tags = [];
        if (tc.testId && String(tc.testId).trim()) {
          tags.push(String(tc.testId).trim());
        }
        if (!isDirect && suiteName) {
          tags.push(suiteName);
        }

        // CRITICAL STATUS RULE (QAV-ISS-001):
        // Checklist completion only indicates a checklist item was checked off in the lightweight runner.
        // It does NOT represent a formal test execution run with environment, tester, actual result, or pass verdict.
        // Therefore, BOTH Completed and Incomplete checklist items map to 'Not Run' with empty executions.
        return {
          id: caseId,
          testCaseId: formattedCaseCode,
          suiteId,
          title: tc.text && String(tc.text).trim() ? String(tc.text).trim() : 'Untitled Test Case',
          description: tc.testId
            ? `Promoted from checklist item [${tc.testId}] in "${normalized.title}".`
            : `Promoted from checklist "${normalized.title}".`,
          priority: normalizeFormalCasePriority(tc.priority),
          category: suiteCategory,
          tags,
          preconditions: '',
          steps: [],
          expectedResult: '',
          status: 'Not Run',
          lastExecutedAt: null,
          lastExecutionId: null,
          executions: [],
          defectIds: [],
          sourceChecklistTestId: tc.id || null,
          sourceChecklistCode: tc.testId || null,
          createdAt: nowIso,
          updatedAt: nowIso
        };
      });

      formalSuites.push({
        id: suiteId,
        phaseId: formalPhaseId,
        name: suiteName,
        category: suiteCategory,
        tags: !isDirect ? [suiteName] : [],
        description: secNotesText || `Test suite converted from "${suiteName}" in ${phaseName}.`,
        testCases: formalCases,
        sourceChecklistSectionId: sec.id || null,
        createdAt: nowIso,
        updatedAt: nowIso
      });
    });
  });

  const totalCases = globalCaseSeq - 1;

  return {
    id: projectId,
    name: projectName,
    type: projectType,
    status: 'Active',
    version: 'v1.0',
    description:
      docNotesText ||
      `Formal QA project promoted from saved QA Checklist "${normalized.title}".`,
    sourceChecklistId: normalized.id,
    promotedFromChecklistTitle: normalized.title,
    promotedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
    testPlan: {
      id: 'tp_' + projectId,
      name: `${projectName} — Master Test Plan`,
      objective: `Execute formal verification across ${formalPhases.length} phase(s) and ${totalCases} test case(s) promoted from QA Checklist "${normalized.title}".`,
      scope: `Covers ${formalPhases.length} testing phase(s) and ${formalSuites.length} test suite(s).`,
      description: docNotesText || `Test plan generated from QA Checklist "${normalized.title}".`,
      createdAt: nowIso,
      updatedAt: nowIso,
      phases: formalPhases
    },
    testSuites: formalSuites,
    executions: [],
    defects: [],
    testCaseCount: totalCases,
    executedTests: 0,
    passedTests: 0,
    failedTests: 0,
    blockedTests: 0,
    skippedTests: 0,
    notRunTests: totalCases,
    passRate: 0,
    totalDefects: 0,
    openDefects: 0,
    inProgressDefects: 0,
    resolvedDefects: 0,
    closedDefects: 0,
    criticalDefects: 0
  };
}

export function promoteChecklistToProject(checklistId, options = {}) {
  if (!checklistId || typeof checklistId !== 'string') {
    return {
      ok: false,
      error: 'A valid checklist ID is required for promotion.'
    };
  }

  // Capture raw snapshots before any mutation so we can roll back atomically on any failure
  const rawChecklistsSnap = safeStorageRead(CHECKLISTS_STORAGE_KEY);
  const rawProjectsSnap = safeStorageRead(PROJECTS_STORAGE_KEY);

  const restorePrePromotionStorage = () => {
    if (rawProjectsSnap.ok) {
      if (rawProjectsSnap.value === null) {
        safeStorageRemove(PROJECTS_STORAGE_KEY);
      } else {
        safeStorageWrite(PROJECTS_STORAGE_KEY, rawProjectsSnap.value, 'rolling back project promotion');
      }
    }
    if (rawChecklistsSnap.ok) {
      if (rawChecklistsSnap.value === null) {
        safeStorageRemove(CHECKLISTS_STORAGE_KEY);
      } else {
        safeStorageWrite(CHECKLISTS_STORAGE_KEY, rawChecklistsSnap.value, 'rolling back checklist promotion link');
      }
    }
  };

  try {
    const { checklists } = loadAllChecklists();
    const targetIdx = checklists.findIndex(c => c.id === checklistId);
    if (targetIdx === -1) {
      return {
        ok: false,
        error: 'The selected QA checklist could not be found in storage.'
      };
    }

    const targetChecklist = checklists[targetIdx];
    if (!Array.isArray(targetChecklist.phases) || targetChecklist.phases.length === 0) {
      return {
        ok: false,
        error: 'Cannot promote an empty checklist with no phases.'
      };
    }

    let existingProjects = [];
    if (rawProjectsSnap.ok && rawProjectsSnap.value) {
      try {
        const parsedProjects = JSON.parse(rawProjectsSnap.value);
        if (!Array.isArray(parsedProjects)) {
          return {
            ok: false,
            error: 'Existing formal projects storage is malformed; promotion aborted to protect workspace data.'
          };
        }
        existingProjects = parsedProjects;
      } catch (_parseErr) {
        return {
          ok: false,
          error: 'Existing formal projects storage could not be parsed; promotion aborted to protect workspace data.'
        };
      }
    }

    // Prevent accidental duplicate promotions if linked project already exists
    const alreadyLinkedProject = findPromotedProjectForChecklist(targetChecklist, existingProjects);
    if (alreadyLinkedProject) {
      return {
        ok: false,
        alreadyPromoted: true,
        project: alreadyLinkedProject,
        checklist: targetChecklist,
        error: `Checklist "${targetChecklist.title}" has already been promoted to project "${alreadyLinkedProject.name}".`
      };
    }

    const newProject = buildProjectFromChecklist(targetChecklist, options);
    if (!newProject) {
      return {
        ok: false,
        error: 'Failed to convert checklist structure into a formal project.'
      };
    }

    // Optional failure injection hook for deterministic rollback testing
    if (typeof options.beforeProjectWrite === 'function') {
      options.beforeProjectWrite(newProject);
    }

    // Step 1: Persist formal project to qavora_projects_v1
    const updatedProjects = [newProject, ...existingProjects];
    const writeProjRes = safeStorageWrite(
      PROJECTS_STORAGE_KEY,
      JSON.stringify(updatedProjects),
      'saving promoted project'
    );
    if (!writeProjRes.ok) {
      restorePrePromotionStorage();
      return {
        ok: false,
        rolledBack: true,
        isQuota: writeProjRes.isQuota,
        isSecurity: writeProjRes.isSecurity,
        error: writeProjRes.error || 'Failed to save promoted project to storage.'
      };
    }

    if (typeof options.afterProjectWriteBeforeChecklistLink === 'function') {
      options.afterProjectWriteBeforeChecklistLink(newProject);
    }

    // Step 2: Record promotedProjectId & promotedAt on the checklist WITHOUT modifying title, phases, tests, or completion states
    const updatedChecklist = {
      ...targetChecklist,
      promotedProjectId: newProject.id,
      promotedAt: newProject.promotedAt
    };
    const nextChecklists = [...checklists];
    nextChecklists[targetIdx] = updatedChecklist;

    const writeChkRes = saveAllChecklists(nextChecklists);
    if (!writeChkRes.ok) {
      restorePrePromotionStorage();
      return {
        ok: false,
        rolledBack: true,
        isQuota: writeChkRes.isQuota,
        isSecurity: writeChkRes.isSecurity,
        error: writeChkRes.error || 'Failed to link promoted project to checklist; changes were rolled back.'
      };
    }

    const preview = getChecklistPromotionPreview(updatedChecklist);

    return {
      ok: true,
      project: newProject,
      checklist: updatedChecklist,
      summary: {
        phasesCount: preview.phasesCount,
        suitesCount: preview.suitesCount,
        casesCount: preview.casesCount
      }
    };
  } catch (err) {
    restorePrePromotionStorage();
    const isQuota = isQuotaExceededError(err);
    const isSecurity = isSecurityError(err);
    return {
      ok: false,
      rolledBack: true,
      isQuota,
      isSecurity,
      error: getStorageErrorMessage(err, 'promoting checklist to formal project')
    };
  }
}

