/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Portable Device-to-Device QA Checklist Transfer Engine
 *
 * Pure browser-native implementation using:
 *   - CompressionStream / DecompressionStream ('deflate-raw', with uncompressed fallback)
 *   - Web Crypto API (crypto.subtle.digest('SHA-256')) for cryptographic integrity validation
 *   - URL-safe Base64 encoding with self-identifying versioned envelope ("TPX1.")
 *
 * Never embeds API keys, credentials, or unrelated browser settings.
 * Never evaluates code or parses HTML; strictly normalizes through normalizeChecklistRecord.
 */

import {
  SCHEMA_VERSION,
  loadAllChecklists,
  saveAllChecklists,
  getActiveRunnerState,
  saveActiveRunnerState,
  normalizeChecklistRecord,
  calculateChecklistProgress,
  generateStableId
} from './qaChecklistStore.js';

export const TRANSFER_PREFIX = 'TPX1';
export const TRANSFER_FORMAT_VERSION = 1;
export const LARGE_CODE_WARNING_CHARS = 32768; // ~32 KB encoded string threshold for friendly size advisory
export const MAX_TRANSFER_CODE_CHARS = 8 * 1024 * 1024; // 8 MB safety ceiling against malformed memory bombs

// ============================================================================
// Binary, Base64URL, Compression & SHA-256 Helpers
// ============================================================================

function utf8Encode(str) {
  return new TextEncoder().encode(str);
}

function utf8Decode(bytes) {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function bytesToBase64Url(bytes) {
  const chunkSize = 0x8000;
  const parts = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...sub));
  }
  const base64 = btoa(parts.join(''));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(base64Url) {
  if (typeof base64Url !== 'string' || !base64Url) {
    throw new Error('Empty encoded segment.');
  }
  if (!/^[A-Za-z0-9\-_]+={0,2}$/.test(base64Url)) {
    throw new Error('Transfer code contains invalid characters.');
  }
  const normalized = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  if (padLen === 3) {
    throw new Error('Transfer code appears truncated or incomplete.');
  }
  const padded = normalized + '='.repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function computeSha256Hex(bytes) {
  if (
    typeof crypto === 'undefined' ||
    !crypto.subtle ||
    typeof crypto.subtle.digest !== 'function'
  ) {
    throw new Error('Web Crypto SHA-256 is unavailable in this browser environment.');
  }
  const digestBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = new Uint8Array(digestBuffer);
  let hex = '';
  for (let i = 0; i < hashArray.length; i += 1) {
    hex += hashArray[i].toString(16).padStart(2, '0');
  }
  return hex;
}

async function collectReadableStream(readable) {
  const reader = readable.getReader();
  const chunks = [];
  let totalLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      chunks.push(chunk);
      totalLength += chunk.byteLength;
    }
  }
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

async function compressPayloadBytes(rawBytes) {
  if (typeof CompressionStream === 'function') {
    try {
      const stream = new CompressionStream('deflate-raw');
      const writer = stream.writable.getWriter();
      const readPromise = collectReadableStream(stream.readable);
      await writer.write(rawBytes);
      await writer.close();
      const compressed = await readPromise;
      if (compressed.byteLength > 0 && compressed.byteLength < rawBytes.byteLength) {
        return { mode: 'd', bytes: compressed };
      }
    } catch (_err) {
      // Gracefully fall back to uncompressed UTF-8 bytes if deflate-raw is unsupported
    }
  }
  return { mode: 'u', bytes: rawBytes };
}

async function decompressPayloadBytes(mode, encodedBytes) {
  if (mode === 'u') {
    return encodedBytes;
  }
  if (mode === 'd') {
    if (typeof DecompressionStream !== 'function') {
      throw new Error(
        'This browser does not support compressed transfer codes. Please update your browser or use a newer version.'
      );
    }
    try {
      const stream = new DecompressionStream('deflate-raw');
      const writer = stream.writable.getWriter();
      const readPromise = collectReadableStream(stream.readable);
      const writePromise = writer
        .write(encodedBytes)
        .then(() => writer.close())
        .catch(err => {
          throw err;
        });
      const [decompressed] = await Promise.all([readPromise, writePromise]);
      return decompressed;
    } catch (_err) {
      throw new Error('Transfer code data is corrupted or incomplete and could not be decompressed.');
    }
  }
  throw new Error(`Unsupported transfer compression mode "${mode}".`);
}

// ============================================================================
// Sanitized Payload Construction (Strictly Checklist Data Only)
// ============================================================================

function sanitizeChecklistForTransfer(checklist, index = 0) {
  const normalized = normalizeChecklistRecord(checklist, index);
  if (!normalized) return null;

  // Explicitly pick only valid QA checklist fields so unrelated keys or secrets can never leak
  return {
    id: normalized.id,
    schemaVersion: SCHEMA_VERSION,
    title: normalized.title,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    documentNotes: normalized.documentNotes.map(note => ({
      id: note.id,
      kind: note.kind,
      text: note.text
    })),
    phases: normalized.phases.map(phase => ({
      id: phase.id,
      phaseLabel: phase.phaseLabel,
      phaseNumber: phase.phaseNumber,
      name: phase.name,
      isImplicit: Boolean(phase.isImplicit),
      description: phase.description,
      expanded: Boolean(phase.expanded),
      notes: phase.notes.map(note => ({
        id: note.id,
        kind: note.kind,
        text: note.text
      })),
      sections: phase.sections.map(sec => ({
        id: sec.id,
        type: sec.type,
        name: sec.name,
        notes: sec.notes.map(note => ({
          id: note.id,
          kind: note.kind,
          text: note.text
        })),
        tests: sec.tests.map(tc => ({
          id: tc.id,
          testId: tc.testId,
          priority: tc.priority,
          text: tc.text,
          status: tc.status,
          completed: Boolean(tc.completed)
        }))
      }))
    }))
  };
}

export function summarizeChecklistsCollection(checklists) {
  const list = Array.isArray(checklists) ? checklists : [];
  let totalPhases = 0;
  let totalTests = 0;
  let completedTests = 0;

  const items = list.map(chk => {
    const prog = calculateChecklistProgress(chk);
    totalPhases += prog.totalPhases;
    totalTests += prog.totalTests;
    completedTests += prog.completedTests;
    return {
      id: chk.id,
      title: chk.title,
      totalPhases: prog.totalPhases,
      totalTests: prog.totalTests,
      completedTests: prog.completedTests,
      percentage: prog.percentage
    };
  });

  return {
    totalChecklists: list.length,
    totalPhases,
    totalTests,
    completedTests,
    items
  };
}

// ============================================================================
// Generate & Validate Transfer Codes
// ============================================================================

/**
 * Generates a self-contained, integrity-protected transfer code for QA checklists.
 * Format: TPX1.<mode>.<sha256_hex_64>.<base64url_payload>
 */
export async function generateChecklistTransferCode(options = {}) {
  const sourceChecklists = Array.isArray(options.checklists)
    ? options.checklists
    : loadAllChecklists().checklists;

  const sanitizedChecklists = sourceChecklists
    .map((chk, idx) => sanitizeChecklistForTransfer(chk, idx))
    .filter(Boolean);

  if (sanitizedChecklists.length === 0) {
    return {
      ok: false,
      code: '',
      error: 'No saved QA checklists found to transfer. Create and start at least one QA checklist first.'
    };
  }

  const runnerState =
    options.activeChecklistId !== undefined
      ? { activeChecklistId: options.activeChecklistId }
      : getActiveRunnerState();

  const resolvedActiveId =
    runnerState.activeChecklistId &&
    sanitizedChecklists.some(c => c.id === runnerState.activeChecklistId)
      ? runnerState.activeChecklistId
      : sanitizedChecklists[0].id;

  const generatedAt = new Date().toISOString();
  const transferId = generateStableId('xfer');

  const payloadObject = {
    app: 'Qavora',
    kind: 'qa_checklist_transfer',
    transferVersion: TRANSFER_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    transferId,
    generatedAt,
    activeChecklistId: resolvedActiveId,
    checklists: sanitizedChecklists
  };

  const jsonString = JSON.stringify(payloadObject);
  const rawUtf8Bytes = utf8Encode(jsonString);
  const checksumHex = await computeSha256Hex(rawUtf8Bytes);
  const { mode, bytes: packedBytes } = await compressPayloadBytes(rawUtf8Bytes);
  const encodedBody = bytesToBase64Url(packedBytes);

  const transferCode = `${TRANSFER_PREFIX}.${mode}.${checksumHex}.${encodedBody}`;
  const summary = summarizeChecklistsCollection(sanitizedChecklists);

  return {
    ok: true,
    code: transferCode,
    transferId,
    generatedAt,
    compressionMode: mode === 'd' ? 'deflate-raw' : 'none',
    rawByteLength: rawUtf8Bytes.byteLength,
    codeLength: transferCode.length,
    isLargeCode: transferCode.length > LARGE_CODE_WARNING_CHARS,
    checksum: checksumHex,
    summary,
    error: null
  };
}

/**
 * Validates, verifies SHA-256 integrity, decompresses, and normalizes an incoming transfer code.
 * Never mutates storage; returns a validated preview ready for Merge or Replace confirmation.
 */
export async function validateChecklistTransferCode(rawCodeInput) {
  if (typeof rawCodeInput !== 'string') {
    return {
      ok: false,
      error: 'Please paste a transfer code before importing.'
    };
  }

  // Strip all whitespace/newlines introduced when copying across chat, email, or mobile clipboards
  const cleaned = rawCodeInput.replace(/\s+/g, '');
  if (!cleaned) {
    return {
      ok: false,
      error: 'Please enter a transfer code before clicking Import Checklists.'
    };
  }

  if (cleaned.length > MAX_TRANSFER_CODE_CHARS) {
    return {
      ok: false,
      error: 'Transfer code exceeds maximum supported size.'
    };
  }

  const segments = cleaned.split('.');

  // Detect unsupported future prefix versions cleanly (e.g., TPX2.*)
  if (/^TPX(\d+)$/i.test(segments[0] || '')) {
    const prefixVer = Number(segments[0].slice(3));
    if (prefixVer > TRANSFER_FORMAT_VERSION) {
      return {
        ok: false,
        error: `Unsupported transfer code version (${segments[0].toUpperCase()}). This version of Qavora supports ${TRANSFER_PREFIX}.`
      };
    }
  }

  if (segments[0] !== TRANSFER_PREFIX) {
    return {
      ok: false,
      error: `Invalid transfer code format. Expected a Qavora code starting with "${TRANSFER_PREFIX}."`
    };
  }

  if (segments.length !== 4) {
    return {
      ok: false,
      error: 'Incomplete or malformed transfer code. Make sure you copied the entire code from start to finish.'
    };
  }

  const [, mode, expectedChecksumRaw, encodedPayload] = segments;

  if (mode !== 'd' && mode !== 'u') {
    return {
      ok: false,
      error: 'Unsupported transfer code encoding mode.'
    };
  }

  if (!/^[a-fA-F0-9]{64}$/.test(expectedChecksumRaw)) {
    return {
      ok: false,
      error: 'Invalid transfer code integrity header. Checksum is missing or malformed.'
    };
  }

  if (!encodedPayload || encodedPayload.length < 4) {
    return {
      ok: false,
      error: 'Incomplete transfer code payload. Make sure the entire transfer code was copied.'
    };
  }

  let compressedOrRawBytes;
  try {
    compressedOrRawBytes = base64UrlToBytes(encodedPayload);
  } catch (decodeErr) {
    return {
      ok: false,
      error: decodeErr && decodeErr.message
        ? decodeErr.message
        : 'Transfer code contains corrupted encoding.'
    };
  }

  let rawUtf8Bytes;
  try {
    rawUtf8Bytes = await decompressPayloadBytes(mode, compressedOrRawBytes);
  } catch (decompErr) {
    return {
      ok: false,
      error: decompErr && decompErr.message
        ? decompErr.message
        : 'Transfer code appears corrupted or truncated.'
    };
  }

  let actualChecksum;
  try {
    actualChecksum = await computeSha256Hex(rawUtf8Bytes);
  } catch (cryptoErr) {
    return {
      ok: false,
      error: cryptoErr && cryptoErr.message
        ? cryptoErr.message
        : 'Unable to verify transfer code integrity.'
    };
  }

  if (actualChecksum.toLowerCase() !== expectedChecksumRaw.toLowerCase()) {
    return {
      ok: false,
      error: 'Integrity check failed: this transfer code was modified, truncated, or corrupted in transit.'
    };
  }

  let decodedText;
  try {
    decodedText = utf8Decode(rawUtf8Bytes);
  } catch (_utfErr) {
    return {
      ok: false,
      error: 'Transfer code contains invalid UTF-8 text data.'
    };
  }

  let parsedPayload;
  try {
    parsedPayload = JSON.parse(decodedText);
  } catch (_jsonErr) {
    return {
      ok: false,
      error: 'Transfer code payload is not valid JSON.'
    };
  }

  if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
    return {
      ok: false,
      error: 'Invalid transfer code structure.'
    };
  }

  if (
    (parsedPayload.app !== 'Qavora' && parsedPayload.app !== 'TestPilot') ||
    parsedPayload.kind !== 'qa_checklist_transfer'
  ) {
    return {
      ok: false,
      error: 'Unrecognized transfer payload. Only Qavora QA checklist transfer codes are supported.'
    };
  }

  if (
    typeof parsedPayload.transferVersion !== 'number' ||
    parsedPayload.transferVersion > TRANSFER_FORMAT_VERSION ||
    parsedPayload.transferVersion < 1
  ) {
    return {
      ok: false,
      error: `Unsupported transfer payload version (${parsedPayload.transferVersion}).`
    };
  }

  if (
    typeof parsedPayload.schemaVersion === 'number' &&
    parsedPayload.schemaVersion > SCHEMA_VERSION
  ) {
    return {
      ok: false,
      error: `Unsupported checklist schema version (${parsedPayload.schemaVersion}).`
    };
  }

  if (!Array.isArray(parsedPayload.checklists) || parsedPayload.checklists.length === 0) {
    return {
      ok: false,
      error: 'This transfer code does not contain any QA checklists to import.'
    };
  }

  const seenChecklistIds = new Set();
  const normalizedChecklists = [];

  for (let i = 0; i < parsedPayload.checklists.length; i += 1) {
    const rawItem = parsedPayload.checklists[i];
    if (!rawItem || typeof rawItem !== 'object' || !Array.isArray(rawItem.phases)) {
      return {
        ok: false,
        error: `Checklist #${i + 1} in the transfer code is missing required phase data.`
      };
    }

    const norm = sanitizeChecklistForTransfer(rawItem, i);
    if (!norm) {
      return {
        ok: false,
        error: `Checklist #${i + 1} in the transfer code could not be validated.`
      };
    }

    if (seenChecklistIds.has(norm.id)) {
      norm.id = generateStableId('chk');
    }
    seenChecklistIds.add(norm.id);
    normalizedChecklists.push(norm);
  }

  const summary = summarizeChecklistsCollection(normalizedChecklists);
  if (summary.totalTests === 0 && summary.totalPhases === 0) {
    return {
      ok: false,
      error: 'This transfer code contains empty checklists with no phases or test items.'
    };
  }

  const activeChecklistId =
    typeof parsedPayload.activeChecklistId === 'string' &&
    normalizedChecklists.some(c => c.id === parsedPayload.activeChecklistId)
      ? parsedPayload.activeChecklistId
      : normalizedChecklists[0].id;

  return {
    ok: true,
    error: null,
    payload: {
      transferVersion: parsedPayload.transferVersion,
      schemaVersion: SCHEMA_VERSION,
      transferId: typeof parsedPayload.transferId === 'string' ? parsedPayload.transferId : '',
      generatedAt:
        typeof parsedPayload.generatedAt === 'string' &&
        !Number.isNaN(Date.parse(parsedPayload.generatedAt))
          ? parsedPayload.generatedAt
          : null,
      checksum: actualChecksum,
      activeChecklistId,
      checklists: normalizedChecklists,
      summary
    }
  };
}

// ============================================================================
// Apply Validated Transfer Payload (Merge or Replace)
// ============================================================================

/**
 * Applies a previously validated transfer payload using either 'merge' (default) or 'replace'.
 *
 * - 'merge': Preserves all existing checklists untouched. Incoming checklists keep their IDs
 *   when there is no collision; if an ID or title collides with an existing checklist, a fresh
 *   unique checklist ID / "(Transferred)" title suffix is assigned so nothing is overwritten.
 * - 'replace': Replaces saved QA checklists with the transferred checklists (caller may capture
 *   a rollback snapshot beforehand).
 */
export function applyChecklistTransferPayload(validatedPayload, mode = 'merge') {
  if (
    !validatedPayload ||
    typeof validatedPayload !== 'object' ||
    !Array.isArray(validatedPayload.checklists) ||
    validatedPayload.checklists.length === 0
  ) {
    return {
      ok: false,
      error: 'No validated transfer checklists available to import.'
    };
  }

  const strategy = mode === 'replace' ? 'replace' : 'merge';
  const { checklists: existingChecklists } = loadAllChecklists();

  // Re-run normalization to guarantee clean deep copies and duplicate-ID safety
  const incomingNormalized = validatedPayload.checklists
    .map((chk, idx) => sanitizeChecklistForTransfer(chk, idx))
    .filter(Boolean);

  if (incomingNormalized.length === 0) {
    return {
      ok: false,
      error: 'No valid checklists remained after normalization.'
    };
  }

  if (strategy === 'replace') {
    const saveRes = saveAllChecklists(incomingNormalized);
    if (!saveRes.ok) {
      return {
        ok: false,
        error: saveRes.error || 'Failed to save transferred checklists.'
      };
    }

    const nextActiveId =
      validatedPayload.activeChecklistId &&
      incomingNormalized.some(c => c.id === validatedPayload.activeChecklistId)
        ? validatedPayload.activeChecklistId
        : incomingNormalized[0].id;

    saveActiveRunnerState({
      activeChecklistId: nextActiveId,
      lastQaView: 'my-checklists'
    });

    return {
      ok: true,
      mode: 'replace',
      importedCount: incomingNormalized.length,
      totalChecklists: incomingNormalized.length,
      reassignedIdsCount: 0,
      activeChecklistId: nextActiveId,
      error: null
    };
  }

  // MERGE Strategy (Default — Zero data loss)
  const existingIds = new Set(existingChecklists.map(c => c.id));
  const existingTitles = new Set(
    existingChecklists.map(c => (c.title || '').trim().toLowerCase())
  );

  let reassignedIdsCount = 0;
  let mappedActiveId = null;

  const preparedIncoming = incomingNormalized.map(chk => {
    const copy = { ...chk };
    const originalId = copy.id;

    if (!copy.id || existingIds.has(copy.id)) {
      let freshId = generateStableId('chk');
      while (existingIds.has(freshId)) {
        freshId = generateStableId('chk');
      }
      copy.id = freshId;
      reassignedIdsCount += 1;
    }
    existingIds.add(copy.id);

    if (copy.title && existingTitles.has(copy.title.trim().toLowerCase())) {
      let candidateTitle = `${copy.title} (Transferred)`;
      let suffixCounter = 2;
      while (existingTitles.has(candidateTitle.trim().toLowerCase())) {
        candidateTitle = `${copy.title} (Transferred ${suffixCounter})`;
        suffixCounter += 1;
      }
      copy.title = candidateTitle;
    }
    existingTitles.add((copy.title || '').trim().toLowerCase());

    if (originalId === validatedPayload.activeChecklistId) {
      mappedActiveId = copy.id;
    }

    return copy;
  });

  const combined = [...preparedIncoming, ...existingChecklists];
  const saveRes = saveAllChecklists(combined);
  if (!saveRes.ok) {
    return {
      ok: false,
      error: saveRes.error || 'Failed to save merged checklists.'
    };
  }

  const currentRunner = getActiveRunnerState();
  const nextActiveId =
    currentRunner.activeChecklistId &&
    combined.some(c => c.id === currentRunner.activeChecklistId)
      ? currentRunner.activeChecklistId
      : mappedActiveId || preparedIncoming[0].id;

  saveActiveRunnerState({
    activeChecklistId: nextActiveId
  });

  return {
    ok: true,
    mode: 'merge',
    importedCount: preparedIncoming.length,
    totalChecklists: combined.length,
    reassignedIdsCount,
    activeChecklistId: nextActiveId,
    error: null
  };
}
