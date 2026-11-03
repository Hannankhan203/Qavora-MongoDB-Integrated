/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Transfer Between Devices UI Controller
 * Uses 100% safe DOM construction (createElement / textContent / value / checked) —
 * zero innerHTML usage.
 */

import { loadAllChecklists } from './qaChecklistStore.js';
import {
  generateChecklistTransferCode,
  validateChecklistTransferCode,
  applyChecklistTransferPayload,
  summarizeChecklistsCollection
} from './qaChecklistTransfer.js';

function clearElement(el) {
  if (!el) return;
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

function formatByteLength(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1048576) {
    return `${(bytes / 1048576).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function formatDateTimeDisplay(isoStr) {
  if (!isoStr) return 'Recently';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return 'Recently';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

async function copyTextSafe(text, fallbackTextareaEl = null) {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_err) {
      // Fall through to selection copy fallback
    }
  }

  try {
    if (fallbackTextareaEl && typeof fallbackTextareaEl.select === 'function') {
      const prevReadOnly = fallbackTextareaEl.readOnly;
      fallbackTextareaEl.readOnly = false;
      fallbackTextareaEl.focus();
      fallbackTextareaEl.select();
      const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
      fallbackTextareaEl.readOnly = prevReadOnly;
      return Boolean(copied);
    }
  } catch (_err) {
    // Ignore
  }
  return false;
}

function downloadTextAsFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 150);
}

export function initQAChecklistTransferUI({
  notify,
  onBeforeReplaceSnapshot,
  onAfterTransferImport,
  onOpenChecklistsView
} = {}) {
  const els = {
    // Send Checklists controls
    sendReadySummary: document.getElementById('transfer-send-ready-summary'),
    generateBtn: document.getElementById('btn-generate-transfer-code'),
    sendErrorBox: document.getElementById('transfer-send-error'),
    sendErrorText: document.getElementById('transfer-send-error-text'),
    outputPanel: document.getElementById('transfer-generated-panel'),
    codeOutputTextarea: document.getElementById('transfer-generated-code'),
    copyCodeBtn: document.getElementById('btn-copy-transfer-code'),
    copyCodeBtnLabel: document.getElementById('copy-transfer-code-label'),
    downloadCodeBtn: document.getElementById('btn-download-transfer-code'),
    codeMetaText: document.getElementById('transfer-code-meta'),
    largeCodeNotice: document.getElementById('transfer-large-code-notice'),
    largeDownloadBtn: document.getElementById('btn-large-download-transfer-code'),

    // Receive Checklists controls
    codeInputTextarea: document.getElementById('transfer-receive-input'),
    loadCodeFileBtn: document.getElementById('btn-load-transfer-code-file'),
    loadCodeFileInput: document.getElementById('transfer-code-file-input'),
    clearInputBtn: document.getElementById('btn-clear-transfer-input'),
    importValidateBtn: document.getElementById('btn-import-transfer-code'),
    receiveErrorBox: document.getElementById('transfer-receive-error'),
    receiveErrorText: document.getElementById('transfer-receive-error-text'),
    receiveSuccessBox: document.getElementById('transfer-receive-success'),
    receiveSuccessText: document.getElementById('transfer-receive-success-text'),
    openImportedChecklistsBtn: document.getElementById('btn-transfer-open-checklists'),

    // Strategy & Preview Confirmation Panel (shown after successful validation)
    confirmPanel: document.getElementById('transfer-confirm-panel'),
    previewSummaryStats: document.getElementById('transfer-preview-stats'),
    previewMetaLine: document.getElementById('transfer-preview-meta'),
    previewChecklistItems: document.getElementById('transfer-preview-list'),
    modeMergeRadio: document.getElementById('transfer-mode-merge'),
    modeReplaceRadio: document.getElementById('transfer-mode-replace'),
    replaceWarningBanner: document.getElementById('transfer-replace-warning'),
    cancelImportBtn: document.getElementById('btn-cancel-transfer-import'),
    confirmImportBtn: document.getElementById('btn-confirm-transfer-import'),
    confirmImportBtnLabel: document.getElementById('transfer-confirm-btn-label')
  };

  if (!els.generateBtn || !els.importValidateBtn) {
    return {
      refreshTransferWorkspace() {}
    };
  }

  const TransferUIState = {
    generatedCode: '',
    generatedTransferMeta: null,
    validatedPayload: null,
    isGenerating: false,
    isValidating: false,
    copyResetTimer: null
  };

  function showToastMessage(message, type = 'success') {
    if (typeof notify === 'function') {
      notify(message, type);
    }
  }

  function hideSendError() {
    if (els.sendErrorBox) {
      els.sendErrorBox.style.display = 'none';
    }
  }

  function showSendError(message) {
    if (els.sendErrorBox && els.sendErrorText) {
      els.sendErrorText.textContent = message;
      els.sendErrorBox.style.display = 'flex';
    }
    showToastMessage(message, 'warning');
  }

  function hideReceiveAlerts() {
    if (els.receiveErrorBox) {
      els.receiveErrorBox.style.display = 'none';
    }
    if (els.receiveSuccessBox) {
      els.receiveSuccessBox.style.display = 'none';
    }
  }

  function showReceiveError(message) {
    if (els.receiveSuccessBox) {
      els.receiveSuccessBox.style.display = 'none';
    }
    if (els.receiveErrorBox && els.receiveErrorText) {
      els.receiveErrorText.textContent = message;
      els.receiveErrorBox.style.display = 'flex';
    }
    showToastMessage(message, 'error');
  }

  function closeConfirmationPanel() {
    TransferUIState.validatedPayload = null;
    if (els.confirmPanel) {
      els.confirmPanel.style.display = 'none';
    }
    if (els.modeMergeRadio) {
      els.modeMergeRadio.checked = true;
    }
    if (els.replaceWarningBanner) {
      els.replaceWarningBanner.style.display = 'none';
    }
    syncStrategyButtonAppearance();
  }

  function syncStrategyButtonAppearance() {
    const isReplace = Boolean(els.modeReplaceRadio && els.modeReplaceRadio.checked);
    if (els.replaceWarningBanner) {
      els.replaceWarningBanner.style.display = isReplace ? 'flex' : 'none';
    }
    if (els.confirmImportBtnLabel) {
      els.confirmImportBtnLabel.textContent = isReplace
        ? 'Confirm & Replace Existing Checklists'
        : 'Confirm & Merge Checklists';
    }
    if (els.confirmImportBtn) {
      els.confirmImportBtn.className = isReplace ? 'btn btn-danger' : 'btn btn-primary';
    }
  }

  function refreshSendSummary() {
    const { checklists } = loadAllChecklists();
    const summary = summarizeChecklistsCollection(checklists);

    if (els.sendReadySummary) {
      if (summary.totalChecklists === 0) {
        els.sendReadySummary.textContent =
          '0 saved QA checklists on this device. Create a QA checklist first to generate a transfer code.';
      } else {
        const chkNoun = summary.totalChecklists === 1 ? 'checklist' : 'checklists';
        const phaseNoun = summary.totalPhases === 1 ? 'phase' : 'phases';
        const testNoun = summary.totalTests === 1 ? 'test' : 'tests';
        els.sendReadySummary.textContent =
          `Ready to send: ${summary.totalChecklists} QA ${chkNoun} · ${summary.totalPhases} ${phaseNoun} · ${summary.completedTests}/${summary.totalTests} ${testNoun} completed`;
      }
    }
  }

  // ==========================================================================
  // A. Send Checklists Handlers
  // ==========================================================================

  async function handleGenerateTransferCode() {
    if (TransferUIState.isGenerating) return;
    hideSendError();
    refreshSendSummary();

    TransferUIState.isGenerating = true;
    els.generateBtn.disabled = true;

    try {
      const result = await generateChecklistTransferCode();
      if (!result.ok) {
        if (els.outputPanel) {
          els.outputPanel.style.display = 'none';
        }
        showSendError(result.error || 'Could not generate transfer code.');
        return;
      }

      TransferUIState.generatedCode = result.code;
      TransferUIState.generatedTransferMeta = result;

      if (els.codeOutputTextarea) {
        els.codeOutputTextarea.value = result.code;
      }

      if (els.codeMetaText) {
        const s = result.summary;
        const shortHash = result.checksum.slice(0, 12);
        els.codeMetaText.textContent =
          `Format ${result.code.slice(0, 4)} · ${s.totalChecklists} checklist(s), ${s.totalPhases} phase(s), ${s.completedTests}/${s.totalTests} completed · ${result.codeLength.toLocaleString()} chars (${formatByteLength(result.rawByteLength)} raw) · SHA-256 ${shortHash}…`;
      }

      if (els.largeCodeNotice) {
        els.largeCodeNotice.style.display = result.isLargeCode ? 'flex' : 'none';
      }

      if (els.outputPanel) {
        els.outputPanel.style.display = 'flex';
      }

      if (els.copyCodeBtnLabel) {
        els.copyCodeBtnLabel.textContent = 'Copy Code';
      }

      showToastMessage('Transfer code generated. Copy it and paste it on your other device.', 'success');
    } catch (err) {
      showSendError(
        err && err.message
          ? `Failed to generate transfer code: ${err.message}`
          : 'Failed to generate transfer code.'
      );
    } finally {
      TransferUIState.isGenerating = false;
      els.generateBtn.disabled = false;
    }
  }

  async function handleCopyTransferCode() {
    const code = TransferUIState.generatedCode || (els.codeOutputTextarea ? els.codeOutputTextarea.value : '');
    if (!code) {
      showSendError('Generate a transfer code first before copying.');
      return;
    }

    const copied = await copyTextSafe(code, els.codeOutputTextarea);
    if (copied) {
      if (els.copyCodeBtnLabel) {
        els.copyCodeBtnLabel.textContent = 'Copied!';
      }
      if (TransferUIState.copyResetTimer) {
        clearTimeout(TransferUIState.copyResetTimer);
      }
      TransferUIState.copyResetTimer = setTimeout(() => {
        if (els.copyCodeBtnLabel) {
          els.copyCodeBtnLabel.textContent = 'Copy Code';
        }
      }, 2200);
      showToastMessage('Transfer code copied to clipboard.', 'success');
    } else {
      if (els.codeOutputTextarea) {
        els.codeOutputTextarea.focus();
        els.codeOutputTextarea.select();
      }
      showToastMessage('Transfer code selected — press Ctrl+C / Cmd+C to copy.', 'info');
    }
  }

  function handleDownloadTransferCodeFile() {
    const code = TransferUIState.generatedCode || (els.codeOutputTextarea ? els.codeOutputTextarea.value : '');
    if (!code) {
      showSendError('Generate a transfer code first.');
      return;
    }
    const dateStamp = new Date().toISOString().split('T')[0];
    downloadTextAsFile(code, `Qavora_Transfer_Code_${dateStamp}.txt`);
    showToastMessage('Saved transfer code file for easy sharing.', 'success');
  }

  // ==========================================================================
  // B. Receive Checklists Handlers
  // ==========================================================================

  function renderValidationPreview(payload) {
    const { summary, generatedAt, checksum } = payload;

    if (els.previewSummaryStats) {
      const chkLabel = summary.totalChecklists === 1 ? 'Checklist' : 'Checklists';
      const phLabel = summary.totalPhases === 1 ? 'Phase' : 'Phases';
      const tstLabel = summary.totalTests === 1 ? 'Test' : 'Tests';
      els.previewSummaryStats.textContent =
        `${summary.totalChecklists} ${chkLabel} · ${summary.totalPhases} ${phLabel} · ${summary.totalTests} ${tstLabel} (${summary.completedTests} Completed)`;
    }

    if (els.previewMetaLine) {
      const timeStr = generatedAt ? formatDateTimeDisplay(generatedAt) : 'Verified just now';
      els.previewMetaLine.textContent =
        `Integrity verified (SHA-256 ${checksum.slice(0, 12)}…) · Generated ${timeStr}`;
    }

    if (els.previewChecklistItems) {
      clearElement(els.previewChecklistItems);
      for (const item of summary.items) {
        const row = document.createElement('div');
        row.className = 'transfer-preview-item-row';

        const titleEl = document.createElement('span');
        titleEl.className = 'transfer-preview-item-title';
        titleEl.textContent = item.title;

        const metaEl = document.createElement('span');
        metaEl.className = 'transfer-preview-item-meta';
        metaEl.textContent =
          `${item.totalPhases} phases · ${item.completedTests}/${item.totalTests} completed (${item.percentage}%)`;

        row.appendChild(titleEl);
        row.appendChild(metaEl);
        els.previewChecklistItems.appendChild(row);
      }
    }

    // Always default to Merge to protect existing data against accidental loss
    if (els.modeMergeRadio) {
      els.modeMergeRadio.checked = true;
    }
    if (els.modeReplaceRadio) {
      els.modeReplaceRadio.checked = false;
    }
    syncStrategyButtonAppearance();

    if (els.confirmPanel) {
      els.confirmPanel.style.display = 'flex';
    }
  }

  async function handleValidateIncomingCode() {
    if (TransferUIState.isValidating) return;
    hideReceiveAlerts();
    closeConfirmationPanel();

    const rawInput = els.codeInputTextarea ? els.codeInputTextarea.value : '';
    TransferUIState.isValidating = true;
    els.importValidateBtn.disabled = true;

    try {
      const validation = await validateChecklistTransferCode(rawInput);
      if (!validation.ok) {
        showReceiveError(validation.error || 'Invalid transfer code.');
        return;
      }

      TransferUIState.validatedPayload = validation.payload;
      renderValidationPreview(validation.payload);
      showToastMessage(
        'Transfer code verified. Choose Merge or Replace below to complete import.',
        'info'
      );
    } catch (err) {
      showReceiveError(
        err && err.message
          ? `Validation error: ${err.message}`
          : 'Unable to validate transfer code.'
      );
    } finally {
      TransferUIState.isValidating = false;
      els.importValidateBtn.disabled = false;
    }
  }

  function handleConfirmTransferImport() {
    if (!TransferUIState.validatedPayload) {
      showReceiveError('Please validate a transfer code first.');
      return;
    }

    const mode = els.modeReplaceRadio && els.modeReplaceRadio.checked ? 'replace' : 'merge';

    if (mode === 'replace' && typeof onBeforeReplaceSnapshot === 'function') {
      onBeforeReplaceSnapshot();
    }

    const importRes = applyChecklistTransferPayload(TransferUIState.validatedPayload, mode);
    if (!importRes.ok) {
      showReceiveError(importRes.error || 'Failed to import checklists from transfer code.');
      return;
    }

    const importedCount = importRes.importedCount;
    const chkNoun = importedCount === 1 ? 'QA checklist' : 'QA checklists';
    const successMsg =
      mode === 'replace'
        ? `Replaced local QA checklists with ${importedCount} transferred ${chkNoun}. A pre-replace recovery snapshot was saved.`
        : `Successfully merged ${importedCount} transferred ${chkNoun} with your existing data (${importRes.totalChecklists} total saved).`;

    closeConfirmationPanel();
    if (els.codeInputTextarea) {
      els.codeInputTextarea.value = '';
    }

    if (els.receiveSuccessBox && els.receiveSuccessText) {
      els.receiveSuccessText.textContent = successMsg;
      els.receiveSuccessBox.style.display = 'flex';
    }

    refreshSendSummary();

    if (typeof onAfterTransferImport === 'function') {
      onAfterTransferImport({
        mode,
        importedCount,
        totalChecklists: importRes.totalChecklists,
        activeChecklistId: importRes.activeChecklistId
      });
    }

    showToastMessage(successMsg, 'success');
  }

  function handleLoadTransferCodeFile(file) {
    if (!file) return;
    hideReceiveAlerts();
    closeConfirmationPanel();

    if (file.size > 10 * 1024 * 1024) {
      showReceiveError('Selected transfer code file is too large.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result.trim() : '';
      if (els.codeInputTextarea) {
        els.codeInputTextarea.value = content;
      }
      if (content) {
        handleValidateIncomingCode();
      } else {
        showReceiveError('The selected transfer code file is empty.');
      }
    };
    reader.onerror = () => {
      showReceiveError('Could not read the selected transfer code file.');
    };
    reader.readAsText(file);
  }

  // ==========================================================================
  // Event Listeners
  // ==========================================================================

  els.generateBtn.addEventListener('click', handleGenerateTransferCode);

  if (els.copyCodeBtn) {
    els.copyCodeBtn.addEventListener('click', handleCopyTransferCode);
  }

  if (els.downloadCodeBtn) {
    els.downloadCodeBtn.addEventListener('click', handleDownloadTransferCodeFile);
  }

  if (els.largeDownloadBtn) {
    els.largeDownloadBtn.addEventListener('click', handleDownloadTransferCodeFile);
  }

  els.importValidateBtn.addEventListener('click', handleValidateIncomingCode);

  if (els.clearInputBtn) {
    els.clearInputBtn.addEventListener('click', () => {
      if (els.codeInputTextarea) {
        els.codeInputTextarea.value = '';
      }
      hideReceiveAlerts();
      closeConfirmationPanel();
    });
  }

  if (els.codeInputTextarea) {
    els.codeInputTextarea.addEventListener('input', () => {
      if (TransferUIState.validatedPayload) {
        closeConfirmationPanel();
      }
      if (els.receiveErrorBox && els.receiveErrorBox.style.display !== 'none') {
        els.receiveErrorBox.style.display = 'none';
      }
    });
  }

  if (els.loadCodeFileBtn && els.loadCodeFileInput) {
    els.loadCodeFileBtn.addEventListener('click', () => {
      els.loadCodeFileInput.value = '';
      els.loadCodeFileInput.click();
    });
    els.loadCodeFileInput.addEventListener('change', e => {
      const file = e.target && e.target.files ? e.target.files[0] : null;
      if (file) {
        handleLoadTransferCodeFile(file);
      }
    });
  }

  if (els.modeMergeRadio) {
    els.modeMergeRadio.addEventListener('change', syncStrategyButtonAppearance);
  }
  if (els.modeReplaceRadio) {
    els.modeReplaceRadio.addEventListener('change', syncStrategyButtonAppearance);
  }

  if (els.cancelImportBtn) {
    els.cancelImportBtn.addEventListener('click', () => {
      closeConfirmationPanel();
    });
  }

  if (els.confirmImportBtn) {
    els.confirmImportBtn.addEventListener('click', handleConfirmTransferImport);
  }

  if (els.openImportedChecklistsBtn) {
    els.openImportedChecklistsBtn.addEventListener('click', () => {
      if (typeof onOpenChecklistsView === 'function') {
        onOpenChecklistsView();
      }
    });
  }

  refreshSendSummary();

  return {
    refreshTransferWorkspace() {
      refreshSendSummary();
    }
  };
}
