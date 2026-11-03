/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Manual QA Test Runner & Saved Checklists UI Controller (Prompt 2)
 * 100% safe DOM construction (createElement / textContent / value / checked) —
 * zero innerHTML usage.
 */

import { formatPhaseHeading } from './qaParser.js';
import {
  CHECKLISTS_STORAGE_KEY,
  ACTIVE_RUNNER_STORAGE_KEY,
  TEST_STATUS,
  loadAllChecklists,
  getChecklistById,
  getActiveRunnerState,
  saveActiveRunnerState,
  calculatePhaseProgress,
  calculateChecklistProgress,
  toggleChecklistTest,
  setChecklistPhaseExpanded,
  setAllChecklistPhasesExpanded,
  renameChecklistById,
  deleteChecklistById,
  updatePhaseInChecklist,
  updateDocumentNotesInChecklist,
  addPhaseToChecklist,
  removePhaseFromChecklist,
  updateCategoryInChecklist,
  addCategoryToChecklistPhase,
  updateTestInChecklist,
  addTestToChecklistPhase,
  removeTestFromChecklist,
  getChecklistPromotionPreview,
  findPromotedProjectForChecklist,
  promoteChecklistToProject
} from './qaChecklistStore.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgIcon(paths, viewBox = '0 0 24 24') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  for (const item of paths) {
    const el = document.createElementNS(SVG_NS, item.tag);
    for (const [k, v] of Object.entries(item.attrs)) {
      el.setAttribute(k, v);
    }
    svg.appendChild(el);
  }
  return svg;
}

const ICONS = {
  chevronDown: () => createSvgIcon([{ tag: 'polyline', attrs: { points: '6 9 12 15 18 9' } }]),
  plus: () =>
    createSvgIcon([
      { tag: 'line', attrs: { x1: '12', y1: '5', x2: '12', y2: '19' } },
      { tag: 'line', attrs: { x1: '5', y1: '12', x2: '19', y2: '12' } }
    ]),
  edit: () =>
    createSvgIcon([
      { tag: 'path', attrs: { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' } },
      { tag: 'path', attrs: { d: 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' } }
    ]),
  trash: () =>
    createSvgIcon([
      { tag: 'polyline', attrs: { points: '3 6 5 6 21 6' } },
      {
        tag: 'path',
        attrs: { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }
      }
    ]),
  play: () => createSvgIcon([{ tag: 'polygon', attrs: { points: '5 3 19 12 5 21 5 3' } }]),
  check: () => createSvgIcon([{ tag: 'polyline', attrs: { points: '20 6 9 17 4 12' } }]),
  close: () =>
    createSvgIcon([
      { tag: 'line', attrs: { x1: '18', y1: '6', x2: '6', y2: '18' } },
      { tag: 'line', attrs: { x1: '6', y1: '6', x2: '18', y2: '18' } }
    ]),
  folder: () =>
    createSvgIcon([
      { tag: 'path', attrs: { d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' } }
    ]),
  clipboard: () =>
    createSvgIcon([
      { tag: 'path', attrs: { d: 'M9 11l3 3L22 4' } },
      { tag: 'path', attrs: { d: 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' } }
    ]),
  promote: () =>
    createSvgIcon([
      { tag: 'path', attrs: { d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' } },
      { tag: 'line', attrs: { x1: '12', y1: '11', x2: '12', y2: '17' } },
      { tag: 'polyline', attrs: { points: '9 14 12 11 15 14' } }
    ])
};

function formatDateTimeShort(isoStr) {
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

function clearElement(el) {
  if (!el) return;
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

export function initQARunnerAndChecklists({
  navigateTo,
  notify,
  onChecklistPromoted,
  onOpenPromotedProject
} = {}) {
  const els = {
    // Sidebar & Quick Resume Badges
    navChecklistsCount: document.getElementById('nav-checklists-count'),
    navRunnerActiveDot: document.getElementById('nav-runner-active-dot'),
    generatorSavedBanner: document.getElementById('qa-gen-saved-banner'),
    generatorSavedBannerText: document.getElementById('qa-gen-saved-banner-text'),
    generatorResumeBtn: document.getElementById('btn-gen-resume-runner'),
    generatorOpenListBtn: document.getElementById('btn-gen-open-saved-list'),

    // My QA Checklists View
    listTransferDevicesBtn: document.getElementById('btn-mychk-transfer-devices'),
    listCreateNewBtn: document.getElementById('btn-mychk-create-new'),
    listResumeActiveBtn: document.getElementById('btn-mychk-resume-active'),
    listStatTotal: document.getElementById('mychk-stat-total'),
    listStatInProgress: document.getElementById('mychk-stat-inprogress'),
    listStatCompleted: document.getElementById('mychk-stat-completed'),
    listSearchInput: document.getElementById('mychk-search-input'),
    listContainer: document.getElementById('mychk-cards-container'),

    // Manual QA Test Runner View
    runnerBackToListBtn: document.getElementById('btn-runner-back-list'),
    runnerCreateNewBtn: document.getElementById('btn-runner-create-new'),
    runnerChecklistSelect: document.getElementById('runner-checklist-select'),
    runnerEmptyState: document.getElementById('runner-empty-state'),
    runnerEmptyCreateBtn: document.getElementById('btn-runner-empty-create'),
    runnerEmptyListBtn: document.getElementById('btn-runner-empty-list'),
    runnerWorkspace: document.getElementById('runner-active-workspace'),

    // Runner Header & Rename
    runnerTitleDisplayWrap: document.getElementById('runner-title-display-wrap'),
    runnerTitleHeading: document.getElementById('runner-checklist-title'),
    runnerStatusPill: document.getElementById('runner-checklist-status-pill'),
    runnerStartRenameBtn: document.getElementById('btn-runner-rename-title'),
    runnerTitleEditWrap: document.getElementById('runner-title-edit-wrap'),
    runnerTitleInput: document.getElementById('runner-title-input'),
    runnerSaveRenameBtn: document.getElementById('btn-runner-save-title'),
    runnerCancelRenameBtn: document.getElementById('btn-runner-cancel-title'),
    runnerCreatedMeta: document.getElementById('runner-created-meta'),
    runnerUpdatedMeta: document.getElementById('runner-updated-meta'),

    // Runner Overall Progress
    runnerStatPhases: document.getElementById('runner-stat-phases'),
    runnerStatTotal: document.getElementById('runner-stat-total'),
    runnerStatCompleted: document.getElementById('runner-stat-completed'),
    runnerStatRemaining: document.getElementById('runner-stat-remaining'),
    runnerStatPercent: document.getElementById('runner-stat-percent'),
    runnerOverallBar: document.getElementById('runner-overall-progress-bar'),

    // Runner Toolbar Controls
    runnerExpandAllBtn: document.getElementById('btn-runner-expand-all'),
    runnerCollapseAllBtn: document.getElementById('btn-runner-collapse-all'),
    runnerPromoteBtn: document.getElementById('btn-runner-promote-project'),
    runnerPromoteBtnText: document.getElementById('runner-promote-btn-text'),
    runnerToggleEditModeBtn: document.getElementById('btn-runner-toggle-edit'),
    runnerAddPhaseBtn: document.getElementById('btn-runner-add-phase'),
    runnerPhasesContainer: document.getElementById('runner-phases-container'),

    // Promote Checklist to Project Modal (QAV-ISS-001)
    promoteModal: document.getElementById('qa-checklist-promote-modal'),
    promoteModalClose: document.getElementById('qa-chk-promote-close'),
    promoteModalCancel: document.getElementById('qa-chk-promote-cancel'),
    promoteModalConfirm: document.getElementById('qa-chk-promote-confirm'),
    promoteModalConfirmText: document.getElementById('qa-chk-promote-confirm-text'),
    promoteModalSourceTitle: document.getElementById('qa-chk-promote-source-title'),
    promoteModalProjectName: document.getElementById('qa-chk-promote-project-name'),
    promoteModalProjectType: document.getElementById('qa-chk-promote-project-type'),
    promoteModalPhasesCnt: document.getElementById('qa-chk-promote-phases-cnt'),
    promoteModalSuitesCnt: document.getElementById('qa-chk-promote-suites-cnt'),
    promoteModalCasesCnt: document.getElementById('qa-chk-promote-cases-cnt'),
    promoteModalError: document.getElementById('qa-chk-promote-error'),
    promoteModalErrorText: document.getElementById('qa-chk-promote-error-text'),

    // Delete Checklist Confirmation Modal
    deleteModal: document.getElementById('qa-checklist-delete-modal'),
    deleteModalHeading: document.getElementById('qa-chk-delete-heading'),
    deleteModalSubtitle: document.getElementById('qa-chk-delete-subtitle'),
    deleteModalClose: document.getElementById('qa-chk-delete-close'),
    deleteModalCancel: document.getElementById('qa-chk-delete-cancel'),
    deleteModalConfirm: document.getElementById('qa-chk-delete-confirm'),
    deleteModalConfirmText: document.getElementById('qa-chk-delete-confirm-text') || document.querySelector('#qa-chk-delete-confirm span'),
    deleteModalTitleSpan: document.getElementById('qa-chk-delete-name'),
    deleteModalScopeNote: document.getElementById('qa-chk-delete-scope-note')
  };

  const UIState = {
    activeChecklistId: null,
    runnerEditMode: false,
    renamingCardId: null,
    pendingDeleteChecklistId: null,
    pendingDelete: null, // { type: 'checklist' | 'phase' | 'test', checklistId, phaseId, testId, title }
    pendingPromoteChecklistId: null,
    pendingAddTestTarget: null, // { phaseId, sectionId }
    listSearchQuery: '',
    lastFocusedElement: null
  };

  function showMsg(message, type = 'success') {
    if (typeof notify === 'function') {
      notify(message, type);
    }
  }

  function goView(viewName, checklistId = null) {
    if (checklistId) {
      UIState.activeChecklistId = checklistId;
      saveActiveRunnerState({ activeChecklistId: checklistId, lastQaView: viewName });
    } else if (['checklist-generator', 'my-checklists', 'qa-runner'].includes(viewName)) {
      saveActiveRunnerState({ lastQaView: viewName });
    }

    if (typeof navigateTo === 'function') {
      navigateTo(viewName);
    }
  }

  // Restore saved active checklist reference on boot
  const savedRunnerState = getActiveRunnerState();
  if (savedRunnerState.activeChecklistId) {
    UIState.activeChecklistId = savedRunnerState.activeChecklistId;
  }

  function refreshGlobalBadgesAndBanners() {
    const { checklists, warning } = loadAllChecklists();
    if (warning && !UIState._warnedOnce) {
      UIState._warnedOnce = true;
      showMsg(warning, 'warning');
    }

    if (els.navChecklistsCount) {
      els.navChecklistsCount.textContent = String(checklists.length);
    }

    const activeExists = Boolean(
      UIState.activeChecklistId && checklists.some(c => c.id === UIState.activeChecklistId)
    );
    if (!activeExists && checklists.length > 0) {
      UIState.activeChecklistId = checklists[0].id;
    } else if (checklists.length === 0) {
      UIState.activeChecklistId = null;
    }

    if (els.navRunnerActiveDot) {
      els.navRunnerActiveDot.style.display = UIState.activeChecklistId ? 'inline-block' : 'none';
    }

    // Generator view quick-resume banner
    if (els.generatorSavedBanner) {
      if (checklists.length === 0) {
        els.generatorSavedBanner.style.display = 'none';
      } else {
        els.generatorSavedBanner.style.display = 'flex';
        const activeChk = checklists.find(c => c.id === UIState.activeChecklistId) || checklists[0];
        const prog = calculateChecklistProgress(activeChk);
        if (els.generatorSavedBannerText) {
          els.generatorSavedBannerText.textContent = `Saved checklists: ${checklists.length} • Recent: "${activeChk.title}" (${prog.completedTests}/${prog.totalTests} completed — ${prog.percentage}%)`;
        }
      }
    }
  }

  // ==========================================================================
  // My QA Checklists View Rendering (Section 8)
  // ==========================================================================
  function renderMyChecklistsView() {
    refreshGlobalBadgesAndBanners();
    const { checklists } = loadAllChecklists();

    let inProgressCount = 0;
    let completedCount = 0;
    for (const c of checklists) {
      const p = calculateChecklistProgress(c);
      if (p.isComplete) {
        completedCount += 1;
      } else if (p.completedTests > 0) {
        inProgressCount += 1;
      }
    }

    if (els.listStatTotal) els.listStatTotal.textContent = String(checklists.length);
    if (els.listStatInProgress) els.listStatInProgress.textContent = String(inProgressCount);
    if (els.listStatCompleted) els.listStatCompleted.textContent = String(completedCount);

    if (els.listResumeActiveBtn) {
      els.listResumeActiveBtn.style.display = UIState.activeChecklistId ? '' : 'none';
    }

    if (!els.listContainer) return;
    clearElement(els.listContainer);

    const query = UIState.listSearchQuery.trim().toLowerCase();
    const filtered = query
      ? checklists.filter(c => c.title.toLowerCase().includes(query))
      : checklists;

    if (checklists.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state qa-mychk-empty';

      const iconWrap = document.createElement('div');
      iconWrap.className = 'empty-state-icon';
      iconWrap.appendChild(ICONS.clipboard());

      const h3 = document.createElement('h3');
      h3.className = 'empty-state-title';
      h3.textContent = 'No Saved QA Checklists Yet';

      const desc = document.createElement('p');
      desc.className = 'empty-state-desc';
      desc.textContent =
        'Paste a manual QA testing plan in Create QA Checklist, review the structure, and click "Start Testing" to save and track your progress.';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary';
      btn.appendChild(ICONS.plus());
      const btnSpan = document.createElement('span');
      btnSpan.textContent = 'Create QA Checklist';
      btn.appendChild(btnSpan);
      btn.addEventListener('click', () => goView('checklist-generator'));

      empty.appendChild(iconWrap);
      empty.appendChild(h3);
      empty.appendChild(desc);
      empty.appendChild(btn);
      els.listContainer.appendChild(empty);
      return;
    }

    if (filtered.length === 0) {
      const noMatch = document.createElement('div');
      noMatch.className = 'qa-preview-empty-card';
      noMatch.textContent = `No saved checklists match "${UIState.listSearchQuery.trim()}".`;
      els.listContainer.appendChild(noMatch);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'qa-mychk-grid';

    for (const chk of filtered) {
      const prog = calculateChecklistProgress(chk);
      const card = document.createElement('article');
      card.className = 'qa-mychk-card';
      if (chk.id === UIState.activeChecklistId) {
        card.classList.add('qa-mychk-card-active');
      }

      // Card Top: Title (or inline rename) + Status Badge
      const topRow = document.createElement('div');
      topRow.className = 'qa-mychk-card-top';

      if (UIState.renamingCardId === chk.id) {
        const renameForm = document.createElement('form');
        renameForm.className = 'qa-mychk-rename-form';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'qa-inline-input qa-mychk-rename-input';
        input.value = chk.title;
        input.setAttribute('aria-label', 'Rename checklist title');
        input.addEventListener('keydown', e => {
          if (e.key === 'Escape') {
            e.preventDefault();
            UIState.renamingCardId = null;
            renderMyChecklistsView();
          }
        });

        const saveBtn = document.createElement('button');
        saveBtn.type = 'submit';
        saveBtn.className = 'btn btn-primary btn-xs';
        saveBtn.textContent = 'Save';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-ghost btn-xs';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => {
          UIState.renamingCardId = null;
          renderMyChecklistsView();
        });

        renameForm.addEventListener('submit', e => {
          e.preventDefault();
          const res = renameChecklistById(chk.id, input.value);
          if (!res.ok) {
            showMsg(res.error || 'Unable to rename checklist.', 'error');
            return;
          }
          UIState.renamingCardId = null;
          renderMyChecklistsView();
          showMsg('Checklist renamed.', 'success');
        });

        renameForm.appendChild(input);
        renameForm.appendChild(saveBtn);
        renameForm.appendChild(cancelBtn);
        topRow.appendChild(renameForm);
        setTimeout(() => input.focus(), 0);
      } else {
        const titleBtn = document.createElement('h3');
        titleBtn.className = 'qa-mychk-card-title';
        titleBtn.textContent = chk.title;
        topRow.appendChild(titleBtn);

        const badge = document.createElement('span');
        badge.className = prog.isComplete
          ? 'qa-status-pill qa-pill-completed'
          : prog.completedTests > 0
            ? 'qa-status-pill qa-pill-progress'
            : 'qa-status-pill qa-pill-notstarted';
        badge.textContent = prog.isComplete
          ? 'Completed'
          : prog.completedTests > 0
            ? 'In Progress'
            : 'Not Started';
        topRow.appendChild(badge);
      }

      card.appendChild(topRow);

      // Dates Metadata
      const datesRow = document.createElement('div');
      datesRow.className = 'qa-mychk-dates';

      const createdSpan = document.createElement('span');
      createdSpan.textContent = `Created: ${formatDateTimeShort(chk.createdAt)}`;
      const updatedSpan = document.createElement('span');
      updatedSpan.textContent = `Updated: ${formatDateTimeShort(chk.updatedAt)}`;

      datesRow.appendChild(createdSpan);
      datesRow.appendChild(updatedSpan);
      card.appendChild(datesRow);

      // Progress Summary Strip
      const metricsRow = document.createElement('div');
      metricsRow.className = 'qa-mychk-metrics';

      const statsLeft = document.createElement('span');
      statsLeft.className = 'qa-mychk-stats-text';
      statsLeft.textContent = `${prog.completedTests} of ${prog.totalTests} ${prog.totalTests === 1 ? 'test' : 'tests'} completed (${prog.totalPhases} ${prog.totalPhases === 1 ? 'phase' : 'phases'})`;

      const pctRight = document.createElement('strong');
      pctRight.className = 'qa-mychk-pct';
      pctRight.textContent = `${prog.percentage}%`;

      metricsRow.appendChild(statsLeft);
      metricsRow.appendChild(pctRight);
      card.appendChild(metricsRow);

      const barTrack = document.createElement('div');
      barTrack.className = 'progress-bar-track qa-mychk-bar-track';
      const barFill = document.createElement('div');
      barFill.className = 'progress-bar-fill';
      barFill.style.width = `${prog.percentage}%`;
      barTrack.appendChild(barFill);
      card.appendChild(barTrack);

      // Card Actions: Open Checklist | Promote to Project / Open Project | Rename Checklist | Delete Checklist
      const actionsRow = document.createElement('div');
      actionsRow.className = 'qa-mychk-actions';

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn btn-primary btn-sm';
      openBtn.appendChild(ICONS.play());
      const openTxt = document.createElement('span');
      openTxt.textContent = 'Open Checklist';
      openBtn.appendChild(openTxt);
      openBtn.addEventListener('click', () => {
        openChecklistInRunner(chk.id);
      });

      const linkedProject = findPromotedProjectForChecklist(chk);
      const promoteBtn = document.createElement('button');
      promoteBtn.type = 'button';
      promoteBtn.className = 'btn btn-secondary btn-sm';
      promoteBtn.setAttribute('data-action', linkedProject ? 'open-promoted-project' : 'promote-checklist');
      promoteBtn.setAttribute('data-checklist-id', chk.id);
      promoteBtn.appendChild(linkedProject ? ICONS.folder() : ICONS.promote());
      const promoteTxt = document.createElement('span');
      promoteTxt.textContent = linkedProject ? 'Open Project' : 'Promote to Project';
      promoteBtn.appendChild(promoteTxt);
      promoteBtn.addEventListener('click', e => {
        e.stopPropagation();
        const currentLinked = findPromotedProjectForChecklist(chk);
        if (currentLinked) {
          if (typeof onOpenPromotedProject === 'function') {
            onOpenPromotedProject(currentLinked.id);
          } else {
            goView('plans');
          }
          return;
        }
        openPromoteChecklistModal(chk);
      });

      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'btn btn-secondary btn-sm';
      renameBtn.appendChild(ICONS.edit());
      const renTxt = document.createElement('span');
      renTxt.textContent = 'Rename Checklist';
      renameBtn.appendChild(renTxt);
      renameBtn.addEventListener('click', () => {
        UIState.renamingCardId = chk.id;
        renderMyChecklistsView();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-danger-outline btn-sm';
      deleteBtn.appendChild(ICONS.trash());
      const delTxt = document.createElement('span');
      delTxt.textContent = 'Delete Checklist';
      deleteBtn.appendChild(delTxt);
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDeleteChecklistModal(chk);
      });

      actionsRow.appendChild(openBtn);
      actionsRow.appendChild(promoteBtn);
      actionsRow.appendChild(renameBtn);
      actionsRow.appendChild(deleteBtn);
      card.appendChild(actionsRow);

      grid.appendChild(card);
    }

    els.listContainer.appendChild(grid);
  }

  // ==========================================================================
  // Delete Confirmation Modal
  // ==========================================================================
  function openDeleteChecklistModal(checklist) {
    UIState.lastFocusedElement = document.activeElement;
    UIState.pendingDelete = {
      type: 'checklist',
      checklistId: checklist.id,
      title: checklist.title
    };
    UIState.pendingDeleteChecklistId = checklist.id;

    if (els.deleteModalHeading) {
      els.deleteModalHeading.textContent = 'Delete QA Checklist';
    }
    if (els.deleteModalSubtitle) {
      els.deleteModalSubtitle.textContent = 'Confirm checklist removal';
    }
    if (els.deleteModalTitleSpan) {
      els.deleteModalTitleSpan.textContent = checklist.title;
    }
    if (els.deleteModalScopeNote) {
      els.deleteModalScopeNote.textContent = 'Other saved checklists and Qavora projects will not be affected.';
    }
    const confirmSpan = els.deleteModalConfirmText || document.querySelector('#qa-chk-delete-confirm span');
    if (confirmSpan) {
      confirmSpan.textContent = 'Delete Checklist';
    }
    if (els.deleteModalConfirm) {
      els.deleteModalConfirm.disabled = false;
    }
    if (els.deleteModal) {
      els.deleteModal.classList.add('open');
      els.deleteModal.setAttribute('aria-hidden', 'false');
    }
    if (document.body) {
      document.body.classList.add('modal-open');
    }
    setTimeout(() => {
      if (els.deleteModalCancel) {
        els.deleteModalCancel.focus();
      }
    }, 0);
  }

  function openDeletePhaseModal(checklistId, phase) {
    UIState.lastFocusedElement = document.activeElement;
    const phaseLabel = phase.name || phase.phaseLabel || 'this phase';
    const totalTests = (phase.sections || []).reduce((sum, s) => sum + (s.tests ? s.tests.length : 0), 0);
    UIState.pendingDelete = {
      type: 'phase',
      checklistId,
      phaseId: phase.id,
      title: phaseLabel
    };
    UIState.pendingDeleteChecklistId = null;

    if (els.deleteModalHeading) {
      els.deleteModalHeading.textContent = 'Delete Testing Phase';
    }
    if (els.deleteModalSubtitle) {
      els.deleteModalSubtitle.textContent = 'Confirm phase removal';
    }
    if (els.deleteModalTitleSpan) {
      els.deleteModalTitleSpan.textContent = `phase "${phaseLabel}"`;
    }
    if (els.deleteModalScopeNote) {
      els.deleteModalScopeNote.textContent = totalTests > 0
        ? `This will permanently remove this phase along with its ${totalTests} test case${totalTests > 1 ? 's' : ''} and execution progress.`
        : 'This will permanently remove this phase.';
    }
    const confirmSpan = els.deleteModalConfirmText || document.querySelector('#qa-chk-delete-confirm span');
    if (confirmSpan) {
      confirmSpan.textContent = 'Delete Phase';
    }
    if (els.deleteModalConfirm) {
      els.deleteModalConfirm.disabled = false;
    }
    if (els.deleteModal) {
      els.deleteModal.classList.add('open');
      els.deleteModal.setAttribute('aria-hidden', 'false');
    }
    if (document.body) {
      document.body.classList.add('modal-open');
    }
    setTimeout(() => {
      if (els.deleteModalCancel) {
        els.deleteModalCancel.focus();
      }
    }, 0);
  }

  function openDeleteTestModal(checklistId, tc) {
    UIState.lastFocusedElement = document.activeElement;
    const testDisplay = tc.testId ? `${tc.testId}: ${tc.text || 'Test Item'}` : (tc.text || 'Test Item');
    UIState.pendingDelete = {
      type: 'test',
      checklistId,
      testId: tc.id,
      title: testDisplay
    };
    UIState.pendingDeleteChecklistId = null;

    if (els.deleteModalHeading) {
      els.deleteModalHeading.textContent = 'Delete Test Item';
    }
    if (els.deleteModalSubtitle) {
      els.deleteModalSubtitle.textContent = 'Confirm test removal';
    }
    if (els.deleteModalTitleSpan) {
      els.deleteModalTitleSpan.textContent = testDisplay;
    }
    if (els.deleteModalScopeNote) {
      els.deleteModalScopeNote.textContent = 'This test item and its execution status will be permanently removed.';
    }
    const confirmSpan = els.deleteModalConfirmText || document.querySelector('#qa-chk-delete-confirm span');
    if (confirmSpan) {
      confirmSpan.textContent = 'Delete Test';
    }
    if (els.deleteModalConfirm) {
      els.deleteModalConfirm.disabled = false;
    }
    if (els.deleteModal) {
      els.deleteModal.classList.add('open');
      els.deleteModal.setAttribute('aria-hidden', 'false');
    }
    if (document.body) {
      document.body.classList.add('modal-open');
    }
    setTimeout(() => {
      if (els.deleteModalCancel) {
        els.deleteModalCancel.focus();
      }
    }, 0);
  }

  function closeDeleteChecklistModal() {
    UIState.pendingDelete = null;
    UIState.pendingDeleteChecklistId = null;
    if (els.deleteModalConfirm) {
      els.deleteModalConfirm.disabled = false;
    }
    if (els.deleteModal) {
      els.deleteModal.classList.remove('open');
      els.deleteModal.setAttribute('aria-hidden', 'true');
    }
    if (document.body) {
      document.body.classList.remove('modal-open');
      document.body.style.overflow = '';
    }
    if (document.documentElement) {
      document.documentElement.style.overflow = '';
    }
    const prevFocus = UIState.lastFocusedElement;
    UIState.lastFocusedElement = null;
    if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) {
      prevFocus.focus();
    }
  }

  function confirmDeleteChecklist() {
    const pending = UIState.pendingDelete;
    const type = pending ? pending.type : (UIState.pendingDeleteChecklistId ? 'checklist' : null);
    if (!type) return;

    if (els.deleteModalConfirm) {
      els.deleteModalConfirm.disabled = true;
    }

    try {
      if (type === 'checklist') {
        const targetId = pending ? pending.checklistId : UIState.pendingDeleteChecklistId;
        const res = deleteChecklistById(targetId);
        closeDeleteChecklistModal();

        if (!res.ok) {
          showMsg(res.error || 'Could not delete checklist.', 'error');
          return;
        }

        if (UIState.activeChecklistId === targetId) {
          UIState.activeChecklistId = res.remaining.length > 0 ? res.remaining[0].id : null;
        }

        refreshGlobalBadgesAndBanners();
        renderMyChecklistsView();
        renderRunnerView();
        showMsg('Checklist deleted.', 'info');
      } else if (type === 'phase') {
        const { checklistId, phaseId } = pending;
        const res = removePhaseFromChecklist(checklistId, phaseId);
        closeDeleteChecklistModal();

        if (!res.ok) {
          showMsg(res.error || 'Could not delete phase.', 'error');
          return;
        }

        renderRunnerView();
        refreshGlobalBadgesAndBanners();
        showMsg('Phase removed and progress updated.', 'info');
      } else if (type === 'test') {
        const { checklistId, testId } = pending;
        const res = removeTestFromChecklist(checklistId, testId);
        closeDeleteChecklistModal();

        if (!res.ok) {
          showMsg(res.error || 'Could not remove test.', 'error');
          return;
        }

        renderRunnerView();
        refreshGlobalBadgesAndBanners();
        showMsg('Test removed and progress recalculated.', 'info');
      }
    } finally {
      if (els.deleteModalConfirm) {
        els.deleteModalConfirm.disabled = false;
      }
    }
  }

  // ==========================================================================
  // Promote QA Checklist to Formal Project Modal (QAV-ISS-001)
  // ==========================================================================
  function openPromoteChecklistModal(checklist) {
    if (!checklist) return;

    const alreadyLinked = findPromotedProjectForChecklist(checklist);
    if (alreadyLinked) {
      showMsg(`Checklist "${checklist.title}" is already promoted to project "${alreadyLinked.name}".`, 'info');
      if (typeof onOpenPromotedProject === 'function') {
        onOpenPromotedProject(alreadyLinked.id);
      }
      return;
    }

    UIState.lastFocusedElement = document.activeElement;
    UIState.pendingPromoteChecklistId = checklist.id;

    const preview = getChecklistPromotionPreview(checklist);

    if (els.promoteModalSourceTitle) {
      els.promoteModalSourceTitle.textContent = `"${checklist.title}"`;
    }
    if (els.promoteModalProjectName) {
      els.promoteModalProjectName.value = checklist.title;
    }
    if (els.promoteModalProjectType) {
      els.promoteModalProjectType.value = 'Web Application';
    }
    if (els.promoteModalPhasesCnt) {
      els.promoteModalPhasesCnt.textContent = String(preview.phasesCount);
    }
    if (els.promoteModalSuitesCnt) {
      els.promoteModalSuitesCnt.textContent = String(preview.suitesCount);
    }
    if (els.promoteModalCasesCnt) {
      els.promoteModalCasesCnt.textContent = String(preview.casesCount);
    }
    if (els.promoteModalError) {
      els.promoteModalError.style.display = 'none';
    }

    if (els.promoteModal) {
      els.promoteModal.classList.add('open');
      els.promoteModal.setAttribute('aria-hidden', 'false');
      if (els.promoteModalProjectName) {
        setTimeout(() => els.promoteModalProjectName.focus(), 0);
      }
    }
  }

  function closePromoteChecklistModal() {
    UIState.pendingPromoteChecklistId = null;
    if (els.promoteModal) {
      els.promoteModal.classList.remove('open');
      els.promoteModal.setAttribute('aria-hidden', 'true');
    }
    if (els.promoteModalError) {
      els.promoteModalError.style.display = 'none';
    }
    const prevFocus = UIState.lastFocusedElement;
    UIState.lastFocusedElement = null;
    if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) {
      prevFocus.focus();
    }
  }

  function confirmPromoteChecklist() {
    const targetId = UIState.pendingPromoteChecklistId;
    if (!targetId) return;

    const projectName = els.promoteModalProjectName ? els.promoteModalProjectName.value.trim() : '';
    const projectType = els.promoteModalProjectType ? els.promoteModalProjectType.value : 'Web Application';

    if (!projectName) {
      if (els.promoteModalError && els.promoteModalErrorText) {
        els.promoteModalErrorText.textContent = 'Please provide a formal project name.';
        els.promoteModalError.style.display = 'flex';
      } else {
        showMsg('Please provide a formal project name.', 'warning');
      }
      if (els.promoteModalProjectName) els.promoteModalProjectName.focus();
      return;
    }

    if (els.promoteModalConfirm) {
      els.promoteModalConfirm.disabled = true;
    }

    try {
      const res = promoteChecklistToProject(targetId, {
        projectName,
        projectType
      });

      if (!res.ok) {
        if (res.alreadyPromoted && res.project) {
          closePromoteChecklistModal();
          renderMyChecklistsView();
          renderRunnerView();
          showMsg(res.error || 'Checklist has already been promoted.', 'info');
          if (typeof onOpenPromotedProject === 'function') {
            onOpenPromotedProject(res.project.id);
          }
          return;
        }

        if (els.promoteModalError && els.promoteModalErrorText) {
          els.promoteModalErrorText.textContent = res.error || 'Failed to promote checklist.';
          els.promoteModalError.style.display = 'flex';
        }
        showMsg(res.error || 'Failed to promote checklist.', 'error');
        return;
      }

      closePromoteChecklistModal();
      refreshGlobalBadgesAndBanners();
      renderMyChecklistsView();
      renderRunnerView();

      if (typeof onChecklistPromoted === 'function') {
        onChecklistPromoted(res);
      } else {
        showMsg(
          `Promoted "${res.checklist.title}" to project "${res.project.name}" (${res.summary.phasesCount} phases, ${res.summary.suitesCount} suites, ${res.summary.casesCount} test cases — all initialized as Not Run).`,
          'success'
        );
      }
    } finally {
      if (els.promoteModalConfirm) {
        els.promoteModalConfirm.disabled = false;
      }
    }
  }

  // ==========================================================================
  // Manual QA Test Runner View Rendering & Instant Checkbox Updates
  // ==========================================================================
  function syncChecklistSwitcherDropdown(checklists, activeId) {
    if (!els.runnerChecklistSelect) return;
    clearElement(els.runnerChecklistSelect);

    if (checklists.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No saved checklists';
      els.runnerChecklistSelect.appendChild(opt);
      els.runnerChecklistSelect.disabled = true;
      return;
    }

    els.runnerChecklistSelect.disabled = false;
    for (const c of checklists) {
      const prog = calculateChecklistProgress(c);
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.title} (${prog.percentage}%)`;
      if (c.id === activeId) {
        opt.selected = true;
      }
      els.runnerChecklistSelect.appendChild(opt);
    }
  }

  function updateRunnerOverallDOM(checklist) {
    const overall = calculateChecklistProgress(checklist);

    if (els.runnerTitleHeading) {
      els.runnerTitleHeading.textContent = checklist.title;
    }
    if (els.runnerCreatedMeta) {
      els.runnerCreatedMeta.textContent = `Created ${formatDateTimeShort(checklist.createdAt)}`;
    }
    if (els.runnerUpdatedMeta) {
      els.runnerUpdatedMeta.textContent = `Saved ${formatDateTimeShort(checklist.updatedAt)}`;
    }

    if (els.runnerStatusPill) {
      els.runnerStatusPill.className = overall.isComplete
        ? 'qa-status-pill qa-pill-completed'
        : overall.completedTests > 0
          ? 'qa-status-pill qa-pill-progress'
          : 'qa-status-pill qa-pill-notstarted';
      els.runnerStatusPill.textContent = overall.isComplete
        ? 'Completed'
        : overall.completedTests > 0
          ? 'In Progress'
          : 'Not Started';
    }

    if (els.runnerStatPhases) els.runnerStatPhases.textContent = String(overall.totalPhases);
    if (els.runnerStatTotal) els.runnerStatTotal.textContent = String(overall.totalTests);
    if (els.runnerStatCompleted) els.runnerStatCompleted.textContent = String(overall.completedTests);
    if (els.runnerStatRemaining) els.runnerStatRemaining.textContent = String(overall.remainingTests);
    if (els.runnerStatPercent) els.runnerStatPercent.textContent = `${overall.percentage}%`;
    if (els.runnerOverallBar) {
      els.runnerOverallBar.style.width = `${overall.percentage}%`;
    }

    if (els.runnerPromoteBtnText) {
      const linkedProj = findPromotedProjectForChecklist(checklist);
      els.runnerPromoteBtnText.textContent = linkedProj ? 'Open Promoted Project' : 'Promote to Project';
    }
  }

  function updateSinglePhaseProgressDOM(phaseCardEl, phase) {
    if (!phaseCardEl || !phase) return;
    const pp = calculatePhaseProgress(phase);

    const countsEl = phaseCardEl.querySelector('[data-role="phase-counts"]');
    const pctEl = phaseCardEl.querySelector('[data-role="phase-pct"]');
    const barEl = phaseCardEl.querySelector('[data-role="phase-bar"]');

    if (countsEl) {
      countsEl.textContent = `${pp.completedTests} / ${pp.totalTests} completed`;
    }
    if (pctEl) {
      pctEl.textContent = `${pp.percentage}%`;
      pctEl.classList.toggle('qa-phase-pct-done', pp.isComplete);
    }
    if (barEl) {
      barEl.style.width = `${pp.percentage}%`;
    }
    phaseCardEl.classList.toggle('qa-runner-phase-complete', pp.isComplete);
  }

  function handleRunnerCheckboxChange(checklistId, testId, isChecked, rowEl, statusBadgeEl, phaseCardEl) {
    const res = toggleChecklistTest(checklistId, testId, isChecked);
    if (!res.ok || !res.checklist) {
      showMsg(res.error || 'Failed to save test progress.', 'error');
      const chkInput = rowEl ? rowEl.querySelector('input[type="checkbox"]') : null;
      if (chkInput) {
        chkInput.checked = !isChecked;
      }
      return;
    }

    // Immediate in-place row update without rebuilding scroll container
    rowEl.classList.toggle('qa-runner-test-completed', isChecked);
    if (statusBadgeEl) {
      statusBadgeEl.textContent = isChecked ? TEST_STATUS.COMPLETED : TEST_STATUS.NOT_STARTED;
      statusBadgeEl.className = isChecked
        ? 'qa-runner-state-tag state-completed'
        : 'qa-runner-state-tag state-not-started';
    }

    const updatedPhase = res.checklist.phases.find(p => p.id === res.phaseId);
    updateSinglePhaseProgressDOM(phaseCardEl, updatedPhase);
    updateRunnerOverallDOM(res.checklist);

    const { checklists } = loadAllChecklists();
    syncChecklistSwitcherDropdown(checklists, checklistId);
    refreshGlobalBadgesAndBanners();
  }

  function buildQuickAddTestBar(checklistId, phaseId, sectionIdOrNull) {
    const form = document.createElement('form');
    form.className = 'qa-runner-add-test-form';

    const idInput = document.createElement('input');
    idInput.type = 'text';
    idInput.className = 'qa-inline-input qa-runner-new-id';
    idInput.placeholder = 'Test ID (optional)';
    idInput.setAttribute('aria-label', 'Optional Test ID');

    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'qa-inline-input qa-runner-new-text';
    textInput.placeholder = 'Enter new manual test item...';
    textInput.setAttribute('aria-label', 'New test description');

    const prioSelect = document.createElement('select');
    prioSelect.className = 'qa-inline-input qa-test-prio-select';
    prioSelect.setAttribute('aria-label', 'Optional test priority');
    for (const optVal of ['', 'Critical', 'High', 'Medium', 'Low']) {
      const opt = document.createElement('option');
      opt.value = optVal;
      opt.textContent = optVal ? optVal : 'Priority (opt)';
      prioSelect.appendChild(opt);
    }

    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'btn btn-primary btn-xs';
    saveBtn.textContent = 'Add Test';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-ghost btn-xs';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      UIState.pendingAddTestTarget = null;
      renderRunnerView();
    });

    form.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        UIState.pendingAddTestTarget = null;
        renderRunnerView();
      }
    });

    form.addEventListener('submit', e => {
      e.preventDefault();
      const res = addTestToChecklistPhase(checklistId, phaseId, sectionIdOrNull, {
        testId: idInput.value,
        text: textInput.value,
        priority: prioSelect.value
      });
      if (!res.ok) {
        showMsg(res.error || 'Please enter a test description.', 'warning');
        textInput.focus();
        return;
      }
      UIState.pendingAddTestTarget = null;
      renderRunnerView();
      refreshGlobalBadgesAndBanners();
      showMsg('New test added as Not Started.', 'success');
    });

    form.appendChild(idInput);
    form.appendChild(textInput);
    form.appendChild(prioSelect);
    form.appendChild(saveBtn);
    form.appendChild(cancelBtn);

    setTimeout(() => textInput.focus(), 0);
    return form;
  }

  function renderRunnerTestRow(checklist, phase, tc, phaseCardEl) {
    const row = document.createElement('div');
    row.className = 'qa-runner-test-row';
    if (tc.completed) {
      row.classList.add('qa-runner-test-completed');
    }
    row.dataset.testId = tc.id;

    const checkboxId = `chkbox_${tc.id}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = checkboxId;
    checkbox.className = 'qa-runner-checkbox';
    checkbox.checked = Boolean(tc.completed);
    checkbox.setAttribute('aria-label', tc.text);

    const statusTag = document.createElement('span');
    statusTag.className = tc.completed
      ? 'qa-runner-state-tag state-completed'
      : 'qa-runner-state-tag state-not-started';
    statusTag.textContent = tc.completed ? TEST_STATUS.COMPLETED : TEST_STATUS.NOT_STARTED;

    checkbox.addEventListener('change', () => {
      handleRunnerCheckboxChange(checklist.id, tc.id, checkbox.checked, row, statusTag, phaseCardEl);
    });

    row.appendChild(checkbox);

    if (UIState.runnerEditMode) {
      // Editable mode inside runner: preserves completion state while editing ID or description!
      const idInput = document.createElement('input');
      idInput.type = 'text';
      idInput.className = 'qa-inline-input qa-test-id-input';
      idInput.placeholder = 'ID (opt)';
      idInput.value = tc.testId !== undefined && tc.testId !== null ? String(tc.testId) : '';
      idInput.setAttribute('aria-label', 'Edit Test ID');
      idInput.addEventListener('input', () => {
        const res = updateTestInChecklist(checklist.id, tc.id, { testId: idInput.value });
        if (res.ok) {
          tc.testId = idInput.value.trim();
          updateRunnerOverallDOM(res.checklist);
        } else {
          showMsg(res.error || 'Storage is full: Test ID changes could not be saved.', 'error');
        }
      });

      const textInput = document.createElement('input');
      textInput.type = 'text';
      textInput.className = 'qa-inline-input qa-test-text-input';
      textInput.value = tc.text !== undefined && tc.text !== null ? String(tc.text) : '';
      textInput.setAttribute('aria-label', 'Edit test description');
      textInput.addEventListener('input', () => {
        const trimmed = textInput.value.trim();
        if (!trimmed) return;
        const res = updateTestInChecklist(checklist.id, tc.id, { text: trimmed });
        if (res.ok) {
          tc.text = trimmed;
          updateRunnerOverallDOM(res.checklist);
        } else {
          showMsg(res.error || 'Storage is full: Test description changes could not be saved.', 'error');
        }
      });
      textInput.addEventListener('blur', () => {
        if (!textInput.value.trim()) {
          textInput.value = tc.text;
          showMsg('Test description cannot be empty.', 'warning');
        }
      });

      const prioSelect = document.createElement('select');
      prioSelect.className = 'qa-inline-input qa-test-prio-select';
      prioSelect.setAttribute('aria-label', 'Edit test priority');
      const prioChoices = ['', 'Critical', 'High', 'Medium', 'Low'];
      const rawPrio = tc.priority !== undefined && tc.priority !== null ? String(tc.priority).trim() : '';
      if (rawPrio !== '' && !prioChoices.includes(rawPrio)) {
        prioChoices.push(rawPrio);
      }
      for (const optVal of prioChoices) {
        const opt = document.createElement('option');
        opt.value = optVal;
        opt.textContent = optVal !== '' ? optVal : 'No Prio';
        if (rawPrio === optVal) {
          opt.selected = true;
        }
        prioSelect.appendChild(opt);
      }
      prioSelect.addEventListener('change', () => {
        const prevPrio = tc.priority;
        const res = updateTestInChecklist(checklist.id, tc.id, { priority: prioSelect.value });
        if (res.ok) {
          tc.priority = prioSelect.value;
          updateRunnerOverallDOM(res.checklist);
        } else {
          prioSelect.value = prevPrio !== undefined && prevPrio !== null ? String(prevPrio) : '';
          showMsg(res.error || 'Storage is full: Priority change could not be saved.', 'error');
        }
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'qa-icon-action-btn qa-btn-danger-hover';
      removeBtn.title = 'Remove this test';
      removeBtn.setAttribute('aria-label', 'Remove test');
      removeBtn.appendChild(ICONS.trash());
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDeleteTestModal(checklist.id, tc);
      });

      row.appendChild(idInput);
      row.appendChild(textInput);
      row.appendChild(prioSelect);
      row.appendChild(statusTag);
      row.appendChild(removeBtn);
    } else {
      // Standard Testing Mode: generous clickable label for rapid manual execution
      const label = document.createElement('label');
      label.htmlFor = checkboxId;
      label.className = 'qa-runner-test-label';

      if (tc.testId !== undefined && tc.testId !== null && String(tc.testId).trim() !== '') {
        const idChip = document.createElement('span');
        idChip.className = 'qa-test-id-chip';
        idChip.textContent = String(tc.testId);
        label.appendChild(idChip);
      }

      const textSpan = document.createElement('span');
      textSpan.className = 'qa-runner-test-text';
      textSpan.textContent = tc.text;
      label.appendChild(textSpan);

      if (tc.priority !== undefined && tc.priority !== null && String(tc.priority).trim() !== '') {
        const prioChip = document.createElement('span');
        prioChip.className = 'qa-test-prio-chip';
        prioChip.textContent = String(tc.priority);
        label.appendChild(prioChip);
      }

      row.appendChild(label);
      row.appendChild(statusTag);
    }

    return row;
  }

  function renderRunnerView() {
    refreshGlobalBadgesAndBanners();
    const { checklists } = loadAllChecklists();

    let activeChecklist = UIState.activeChecklistId
      ? checklists.find(c => c.id === UIState.activeChecklistId)
      : null;

    if (!activeChecklist && checklists.length > 0) {
      activeChecklist = checklists[0];
      UIState.activeChecklistId = activeChecklist.id;
      saveActiveRunnerState({ activeChecklistId: activeChecklist.id });
    }

    syncChecklistSwitcherDropdown(checklists, activeChecklist ? activeChecklist.id : null);

    if (!activeChecklist) {
      if (els.runnerEmptyState) els.runnerEmptyState.style.display = 'flex';
      if (els.runnerWorkspace) els.runnerWorkspace.style.display = 'none';
      return;
    }

    if (els.runnerEmptyState) els.runnerEmptyState.style.display = 'none';
    if (els.runnerWorkspace) els.runnerWorkspace.style.display = 'block';

    updateRunnerOverallDOM(activeChecklist);

    if (els.runnerToggleEditModeBtn) {
      els.runnerToggleEditModeBtn.classList.toggle('btn-primary', UIState.runnerEditMode);
      els.runnerToggleEditModeBtn.classList.toggle('btn-secondary', !UIState.runnerEditMode);
      const span = els.runnerToggleEditModeBtn.querySelector('span');
      if (span) {
        span.textContent = UIState.runnerEditMode ? 'Done Editing' : 'Edit Checklist';
      }
    }

    if (els.runnerAddPhaseBtn) {
      els.runnerAddPhaseBtn.style.display = UIState.runnerEditMode ? '' : 'none';
    }

    if (!els.runnerPhasesContainer) return;
    clearElement(els.runnerPhasesContainer);

    // Top-level document/plan notes transferred from Prompt 1
    const docNotes = Array.isArray(activeChecklist.documentNotes) ? activeChecklist.documentNotes : [];
    if (docNotes.length > 0 || UIState.runnerEditMode) {
      const docNotesCard = document.createElement('div');
      docNotesCard.className = 'qa-runner-doc-notes-card';

      const docHeader = document.createElement('div');
      docHeader.className = 'qa-runner-doc-notes-header';

      const docBadge = document.createElement('span');
      docBadge.className = 'qa-note-badge';
      docBadge.textContent = 'Plan Notes & Context';
      docHeader.appendChild(docBadge);

      if (UIState.runnerEditMode) {
        const addDocNoteBtn = document.createElement('button');
        addDocNoteBtn.type = 'button';
        addDocNoteBtn.className = 'btn btn-ghost btn-xs';
        addDocNoteBtn.appendChild(ICONS.plus());
        const btnLbl = document.createElement('span');
        btnLbl.textContent = 'Add Plan Note';
        addDocNoteBtn.appendChild(btnLbl);
        addDocNoteBtn.addEventListener('click', () => {
          const nextNotes = [...docNotes, { text: 'New testing context or environment note' }];
          const res = updateDocumentNotesInChecklist(activeChecklist.id, nextNotes);
          if (res.ok) {
            renderRunnerView();
          }
        });
        docHeader.appendChild(addDocNoteBtn);
      }

      docNotesCard.appendChild(docHeader);

      if (docNotes.length > 0) {
        const listWrap = document.createElement('div');
        listWrap.className = UIState.runnerEditMode ? 'qa-supporting-notes-wrap' : 'qa-clean-notes-group';
        docNotes.forEach((dn, dnIdx) => {
          if (UIState.runnerEditMode) {
            const noteRow = document.createElement('div');
            noteRow.className = 'qa-supporting-note-row';

            const noteIn = document.createElement('input');
            noteIn.type = 'text';
            noteIn.className = 'qa-inline-input qa-note-input';
            noteIn.value = dn.text || '';
            noteIn.setAttribute('aria-label', 'Edit plan note');
            noteIn.addEventListener('input', () => {
              dn.text = noteIn.value;
              const res = updateDocumentNotesInChecklist(activeChecklist.id, docNotes);
              if (res.ok) updateRunnerOverallDOM(res.checklist);
            });

            const rmNoteBtn = document.createElement('button');
            rmNoteBtn.type = 'button';
            rmNoteBtn.className = 'qa-icon-action-btn qa-btn-danger-hover';
            rmNoteBtn.title = 'Remove plan note';
            rmNoteBtn.setAttribute('aria-label', 'Remove plan note');
            rmNoteBtn.appendChild(ICONS.close());
            rmNoteBtn.addEventListener('click', () => {
              const nextNotes = docNotes.filter((_, idx) => idx !== dnIdx);
              const res = updateDocumentNotesInChecklist(activeChecklist.id, nextNotes);
              if (res.ok) renderRunnerView();
            });

            noteRow.appendChild(noteIn);
            noteRow.appendChild(rmNoteBtn);
            listWrap.appendChild(noteRow);
          } else {
            const noteDiv = document.createElement('div');
            noteDiv.className = 'qa-clean-note';
            noteDiv.textContent = dn.text;
            listWrap.appendChild(noteDiv);
          }
        });
        docNotesCard.appendChild(listWrap);
      }

      if (docNotes.length > 0 || UIState.runnerEditMode) {
        els.runnerPhasesContainer.appendChild(docNotesCard);
      }
    }

    if (activeChecklist.phases.length === 0) {
      const emptyPhases = document.createElement('div');
      emptyPhases.className = 'qa-preview-empty-card';
      emptyPhases.textContent = 'This checklist currently has no phases. Click "Edit Checklist" to add a phase.';
      els.runnerPhasesContainer.appendChild(emptyPhases);
      return;
    }

    for (const phase of activeChecklist.phases) {
      const pp = calculatePhaseProgress(phase);
      const isExpanded = phase.expanded !== false;

      const phaseCard = document.createElement('section');
      phaseCard.className = 'qa-runner-phase-card';
      if (pp.isComplete) {
        phaseCard.classList.add('qa-runner-phase-complete');
      }
      if (!isExpanded) {
        phaseCard.classList.add('qa-runner-phase-collapsed');
      }
      phaseCard.dataset.phaseId = phase.id;

      // --- Phase Header ---
      const header = document.createElement('div');
      header.className = 'qa-runner-phase-header';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'qa-runner-phase-toggle';
      toggleBtn.setAttribute('aria-expanded', String(isExpanded));
      toggleBtn.setAttribute('aria-label', `Toggle ${formatPhaseHeading(phase)}`);

      const chevronWrap = document.createElement('span');
      chevronWrap.className = 'qa-runner-chevron';
      chevronWrap.appendChild(ICONS.chevronDown());
      toggleBtn.appendChild(chevronWrap);

      const headerTitleBlock = document.createElement('div');
      headerTitleBlock.className = 'qa-runner-phase-title-block';

      if (UIState.runnerEditMode) {
        const editRow = document.createElement('div');
        editRow.className = 'qa-runner-phase-edit-fields';

        const lblIn = document.createElement('input');
        lblIn.type = 'text';
        lblIn.className = 'qa-inline-input qa-phase-label-input';
        lblIn.placeholder = 'Phase #';
        lblIn.value = phase.phaseLabel !== undefined && phase.phaseLabel !== null ? String(phase.phaseLabel) : '';
        lblIn.addEventListener('input', () => {
          const res = updatePhaseInChecklist(activeChecklist.id, phase.id, { phaseLabel: lblIn.value });
          if (res.ok) {
            phase.phaseLabel = lblIn.value.trim();
            updateRunnerOverallDOM(res.checklist);
          } else {
            showMsg(res.error || 'Storage is full: Phase label changes could not be saved.', 'error');
          }
        });

        const nameIn = document.createElement('input');
        nameIn.type = 'text';
        nameIn.className = 'qa-inline-input qa-phase-name-input';
        nameIn.placeholder = 'Phase name';
        nameIn.value = phase.name !== undefined && phase.name !== null ? String(phase.name) : '';
        nameIn.addEventListener('input', () => {
          const trimmed = nameIn.value.trim();
          if (!trimmed) return;
          const res = updatePhaseInChecklist(activeChecklist.id, phase.id, { name: trimmed });
          if (res.ok) {
            phase.name = trimmed;
            updateRunnerOverallDOM(res.checklist);
          } else {
            showMsg(res.error || 'Storage is full: Phase name changes could not be saved.', 'error');
          }
        });
        nameIn.addEventListener('blur', () => {
          if (!nameIn.value.trim()) {
            nameIn.value = phase.name;
          }
        });

        editRow.appendChild(lblIn);
        editRow.appendChild(nameIn);
        headerTitleBlock.appendChild(editRow);
      } else {
        const titleEl = document.createElement('h3');
        titleEl.className = 'qa-runner-phase-title';
        titleEl.textContent = formatPhaseHeading(phase);
        titleEl.addEventListener('click', () => {
          const nextExp = !phaseCard.classList.contains('qa-runner-phase-collapsed') ? false : true;
          setChecklistPhaseExpanded(activeChecklist.id, phase.id, nextExp);
          renderRunnerView();
        });
        headerTitleBlock.appendChild(titleEl);

        if (phase.description) {
          const descPreview = document.createElement('p');
          descPreview.className = 'qa-runner-phase-desc';
          descPreview.textContent = phase.description;
          headerTitleBlock.appendChild(descPreview);
        }
      }

      toggleBtn.addEventListener('click', () => {
        const nextExpanded = !isExpanded;
        setChecklistPhaseExpanded(activeChecklist.id, phase.id, nextExpanded);
        renderRunnerView();
      });

      const headerLeft = document.createElement('div');
      headerLeft.className = 'qa-runner-phase-header-left';
      headerLeft.appendChild(toggleBtn);
      headerLeft.appendChild(headerTitleBlock);

      // Phase Right Metrics (Tests count, Completed count, Phase %)
      const headerRight = document.createElement('div');
      headerRight.className = 'qa-runner-phase-metrics';

      const countsSpan = document.createElement('span');
      countsSpan.className = 'qa-runner-phase-counts';
      countsSpan.dataset.role = 'phase-counts';
      countsSpan.textContent = `${pp.completedTests} / ${pp.totalTests} completed`;

      const pctSpan = document.createElement('span');
      pctSpan.className = 'qa-runner-phase-pct';
      if (pp.isComplete) pctSpan.classList.add('qa-phase-pct-done');
      pctSpan.dataset.role = 'phase-pct';
      pctSpan.textContent = `${pp.percentage}%`;

      const miniTrack = document.createElement('div');
      miniTrack.className = 'qa-runner-phase-mini-track';
      const miniFill = document.createElement('div');
      miniFill.className = 'qa-runner-phase-mini-fill';
      miniFill.dataset.role = 'phase-bar';
      miniFill.style.width = `${pp.percentage}%`;
      miniTrack.appendChild(miniFill);

      headerRight.appendChild(countsSpan);
      headerRight.appendChild(miniTrack);
      headerRight.appendChild(pctSpan);

      if (UIState.runnerEditMode) {
        const addCatBtn = document.createElement('button');
        addCatBtn.type = 'button';
        addCatBtn.className = 'btn btn-secondary btn-xs';
        addCatBtn.appendChild(ICONS.folder());
        const addCatTxt = document.createElement('span');
        addCatTxt.textContent = 'Add Category';
        addCatBtn.appendChild(addCatTxt);
        addCatBtn.addEventListener('click', () => {
          addCategoryToChecklistPhase(activeChecklist.id, phase.id, 'New Category');
          renderRunnerView();
        });
        headerRight.appendChild(addCatBtn);

        const delPhaseBtn = document.createElement('button');
        delPhaseBtn.type = 'button';
        delPhaseBtn.className = 'qa-icon-action-btn qa-btn-danger-hover';
        delPhaseBtn.title = 'Remove Phase';
        delPhaseBtn.setAttribute('aria-label', 'Remove Phase');
        delPhaseBtn.appendChild(ICONS.trash());
        delPhaseBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openDeletePhaseModal(activeChecklist.id, phase);
        });
        headerRight.appendChild(delPhaseBtn);
      }

      header.appendChild(headerLeft);
      header.appendChild(headerRight);
      phaseCard.appendChild(header);

      // --- Collapsible Phase Body ---
      if (isExpanded) {
        const body = document.createElement('div');
        body.className = 'qa-runner-phase-body';

        if (UIState.runnerEditMode) {
          const descEditWrap = document.createElement('div');
          descEditWrap.className = 'qa-edit-desc-wrap';
          const descLbl = document.createElement('label');
          descLbl.className = 'qa-field-micro-label';
          descLbl.textContent = 'Description:';
          const descArea = document.createElement('textarea');
          descArea.className = 'qa-inline-textarea';
          descArea.rows = 1;
          descArea.placeholder = 'Optional phase description...';
          descArea.value = phase.description !== undefined && phase.description !== null ? String(phase.description) : '';
          descArea.addEventListener('input', () => {
            const res = updatePhaseInChecklist(activeChecklist.id, phase.id, { description: descArea.value });
            if (res.ok) {
              phase.description = descArea.value.trim();
              updateRunnerOverallDOM(res.checklist);
            }
          });
          const addPhaseNoteBtn = document.createElement('button');
          addPhaseNoteBtn.type = 'button';
          addPhaseNoteBtn.className = 'btn btn-ghost btn-xs';
          addPhaseNoteBtn.appendChild(ICONS.plus());
          const addNoteSpan = document.createElement('span');
          addNoteSpan.textContent = 'Add Phase Note';
          addPhaseNoteBtn.appendChild(addNoteSpan);
          addPhaseNoteBtn.addEventListener('click', () => {
            const currentNotes = Array.isArray(phase.notes) ? phase.notes : [];
            const nextNotes = [...currentNotes, { text: 'Supporting note or precondition' }];
            const res = updatePhaseInChecklist(activeChecklist.id, phase.id, { notes: nextNotes });
            if (res.ok) renderRunnerView();
          });

          descEditWrap.appendChild(descLbl);
          descEditWrap.appendChild(descArea);
          descEditWrap.appendChild(addPhaseNoteBtn);
          body.appendChild(descEditWrap);
        }

        // Supporting notes inside phase
        if (Array.isArray(phase.notes) && phase.notes.length > 0) {
          if (UIState.runnerEditMode) {
            const notesWrap = document.createElement('div');
            notesWrap.className = 'qa-supporting-notes-wrap';
            phase.notes.forEach((n, nIdx) => {
              const noteRow = document.createElement('div');
              noteRow.className = 'qa-supporting-note-row';

              const badge = document.createElement('span');
              badge.className = 'qa-note-badge';
              badge.textContent = 'Note';

              const noteIn = document.createElement('input');
              noteIn.type = 'text';
              noteIn.className = 'qa-inline-input qa-note-input';
              noteIn.value = n.text !== undefined && n.text !== null ? String(n.text) : '';
              noteIn.setAttribute('aria-label', 'Edit phase note');
              noteIn.addEventListener('input', () => {
                n.text = noteIn.value;
                const res = updatePhaseInChecklist(activeChecklist.id, phase.id, { notes: phase.notes });
                if (res.ok) updateRunnerOverallDOM(res.checklist);
              });

              const rmBtn = document.createElement('button');
              rmBtn.type = 'button';
              rmBtn.className = 'qa-icon-action-btn qa-btn-danger-hover';
              rmBtn.title = 'Remove phase note';
              rmBtn.setAttribute('aria-label', 'Remove phase note');
              rmBtn.appendChild(ICONS.close());
              rmBtn.addEventListener('click', () => {
                const nextNotes = phase.notes.filter((_, idx) => idx !== nIdx);
                const res = updatePhaseInChecklist(activeChecklist.id, phase.id, { notes: nextNotes });
                if (res.ok) renderRunnerView();
              });

              noteRow.appendChild(badge);
              noteRow.appendChild(noteIn);
              noteRow.appendChild(rmBtn);
              notesWrap.appendChild(noteRow);
            });
            body.appendChild(notesWrap);
          } else {
            const notesWrap = document.createElement('div');
            notesWrap.className = 'qa-clean-notes-group';
            for (const n of phase.notes) {
              const noteDiv = document.createElement('div');
              noteDiv.className = 'qa-clean-note';
              noteDiv.textContent = n.text;
              notesWrap.appendChild(noteDiv);
            }
            body.appendChild(notesWrap);
          }
        }

        if (pp.totalTests === 0 && phase.sections.every(s => s.type !== 'category')) {
          const zeroBox = document.createElement('div');
          zeroBox.className = 'qa-empty-phase-box';
          zeroBox.textContent = 'No individual test items in this phase yet.';
          body.appendChild(zeroBox);
        } else {
          for (const sec of phase.sections) {
            if (sec.type === 'direct' && sec.tests.length === 0 && (!sec.notes || sec.notes.length === 0)) {
              continue;
            }

            const secBlock = document.createElement('div');
            secBlock.className =
              sec.type === 'category' ? 'qa-runner-category-block' : 'qa-runner-direct-block';

            if (sec.type === 'category') {
              const catHeader = document.createElement('div');
              catHeader.className = 'qa-runner-category-header';

              if (UIState.runnerEditMode) {
                const catIn = document.createElement('input');
                catIn.type = 'text';
                catIn.className = 'qa-inline-input qa-category-name-input';
                catIn.value = sec.name;
                catIn.setAttribute('aria-label', 'Edit category name');
                catIn.addEventListener('input', () => {
                  const trimmed = catIn.value.trim();
                  if (!trimmed) return;
                  const res = updateCategoryInChecklist(activeChecklist.id, phase.id, sec.id, trimmed);
                  if (res.ok) {
                    sec.name = trimmed;
                    updateRunnerOverallDOM(res.checklist);
                  }
                });
                catIn.addEventListener('blur', () => {
                  if (!catIn.value.trim()) {
                    catIn.value = sec.name;
                  }
                });
                catHeader.appendChild(catIn);
              } else {
                const catTitle = document.createElement('h4');
                catTitle.className = 'qa-runner-category-title';
                catTitle.textContent = `${sec.name}:`;
                catHeader.appendChild(catTitle);
              }

              const addInCatBtn = document.createElement('button');
              addInCatBtn.type = 'button';
              addInCatBtn.className = 'btn btn-ghost btn-xs';
              addInCatBtn.appendChild(ICONS.plus());
              const addTxt = document.createElement('span');
              addTxt.textContent = 'Add Test';
              addInCatBtn.appendChild(addTxt);
              addInCatBtn.addEventListener('click', () => {
                UIState.pendingAddTestTarget = { phaseId: phase.id, sectionId: sec.id };
                renderRunnerView();
              });
              catHeader.appendChild(addInCatBtn);

              secBlock.appendChild(catHeader);
            }

            if (Array.isArray(sec.notes) && sec.notes.length > 0) {
              for (const sn of sec.notes) {
                const snDiv = document.createElement('div');
                snDiv.className = 'qa-clean-note';
                snDiv.textContent = sn.text;
                secBlock.appendChild(snDiv);
              }
            }

            const listEl = document.createElement('div');
            listEl.className = 'qa-runner-tests-list';

            if (sec.tests.length === 0 && sec.type === 'category') {
              const emptyCat = document.createElement('div');
              emptyCat.className = 'qa-empty-cat-hint';
              emptyCat.textContent = 'No tests in this category.';
              listEl.appendChild(emptyCat);
            } else {
              for (const tc of sec.tests) {
                listEl.appendChild(renderRunnerTestRow(activeChecklist, phase, tc, phaseCard));
              }
            }

            secBlock.appendChild(listEl);

            if (
              UIState.pendingAddTestTarget &&
              UIState.pendingAddTestTarget.phaseId === phase.id &&
              UIState.pendingAddTestTarget.sectionId === sec.id
            ) {
              secBlock.appendChild(buildQuickAddTestBar(activeChecklist.id, phase.id, sec.id));
            }

            body.appendChild(secBlock);
          }
        }

        // Phase-level quick "+ Add Test" control
        if (
          UIState.pendingAddTestTarget &&
          UIState.pendingAddTestTarget.phaseId === phase.id &&
          UIState.pendingAddTestTarget.sectionId === null
        ) {
          body.appendChild(buildQuickAddTestBar(activeChecklist.id, phase.id, null));
        } else {
          const footerBar = document.createElement('div');
          footerBar.className = 'qa-runner-phase-footer';

          const addPhaseTestBtn = document.createElement('button');
          addPhaseTestBtn.type = 'button';
          addPhaseTestBtn.className = 'btn btn-ghost btn-xs';
          addPhaseTestBtn.appendChild(ICONS.plus());
          const addLbl = document.createElement('span');
          addLbl.textContent = 'Add Test to Phase';
          addPhaseTestBtn.appendChild(addLbl);
          addPhaseTestBtn.addEventListener('click', () => {
            UIState.pendingAddTestTarget = { phaseId: phase.id, sectionId: null };
            renderRunnerView();
          });

          footerBar.appendChild(addPhaseTestBtn);
          body.appendChild(footerBar);
        }

        phaseCard.appendChild(body);
      }

      els.runnerPhasesContainer.appendChild(phaseCard);
    }
  }

  function openChecklistInRunner(checklistId) {
    const chk = getChecklistById(checklistId);
    if (!chk) {
      showMsg('Selected checklist could not be found.', 'error');
      return;
    }
    UIState.activeChecklistId = chk.id;
    UIState.runnerEditMode = false;
    UIState.pendingAddTestTarget = null;
    saveActiveRunnerState({ activeChecklistId: chk.id, lastQaView: 'qa-runner' });
    goView('qa-runner', chk.id);
    if (typeof navigateTo !== 'function') {
      renderRunnerView();
    }
  }

  // ==========================================================================
  // Runner Title Rename Controls
  // ==========================================================================
  function openRunnerTitleRename() {
    const chk = getChecklistById(UIState.activeChecklistId);
    if (!chk || !els.runnerTitleEditWrap || !els.runnerTitleDisplayWrap) return;
    els.runnerTitleDisplayWrap.style.display = 'none';
    els.runnerTitleEditWrap.style.display = 'flex';
    if (els.runnerTitleInput) {
      els.runnerTitleInput.value = chk.title;
      els.runnerTitleInput.focus();
      els.runnerTitleInput.select();
    }
  }

  function closeRunnerTitleRename() {
    if (els.runnerTitleEditWrap) els.runnerTitleEditWrap.style.display = 'none';
    if (els.runnerTitleDisplayWrap) els.runnerTitleDisplayWrap.style.display = 'flex';
  }

  function commitRunnerTitleRename() {
    if (!UIState.activeChecklistId || !els.runnerTitleInput) return;
    const res = renameChecklistById(UIState.activeChecklistId, els.runnerTitleInput.value);
    if (!res.ok) {
      showMsg(res.error || 'Title cannot be empty.', 'warning');
      els.runnerTitleInput.focus();
      return;
    }
    closeRunnerTitleRename();
    renderRunnerView();
    refreshGlobalBadgesAndBanners();
    showMsg('Checklist title saved.', 'success');
  }

  // ==========================================================================
  // Event Listeners
  // ==========================================================================
  if (els.generatorResumeBtn) {
    els.generatorResumeBtn.addEventListener('click', () => {
      if (UIState.activeChecklistId) {
        openChecklistInRunner(UIState.activeChecklistId);
      } else {
        goView('my-checklists');
      }
    });
  }

  if (els.generatorOpenListBtn) {
    els.generatorOpenListBtn.addEventListener('click', () => goView('my-checklists'));
  }

  if (els.listTransferDevicesBtn) {
    els.listTransferDevicesBtn.addEventListener('click', () => {
      goView('data');
      const transferSection = document.getElementById('transfer-between-devices-section');
      if (transferSection && typeof transferSection.scrollIntoView === 'function') {
        transferSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  if (els.listCreateNewBtn) {
    els.listCreateNewBtn.addEventListener('click', () => goView('checklist-generator'));
  }

  if (els.listResumeActiveBtn) {
    els.listResumeActiveBtn.addEventListener('click', () => {
      if (UIState.activeChecklistId) {
        openChecklistInRunner(UIState.activeChecklistId);
      }
    });
  }

  if (els.listSearchInput) {
    els.listSearchInput.addEventListener('input', () => {
      UIState.listSearchQuery = els.listSearchInput.value;
      renderMyChecklistsView();
    });
  }

  if (els.runnerBackToListBtn) {
    els.runnerBackToListBtn.addEventListener('click', () => goView('my-checklists'));
  }

  if (els.runnerCreateNewBtn) {
    els.runnerCreateNewBtn.addEventListener('click', () => goView('checklist-generator'));
  }

  if (els.runnerEmptyCreateBtn) {
    els.runnerEmptyCreateBtn.addEventListener('click', () => goView('checklist-generator'));
  }

  if (els.runnerEmptyListBtn) {
    els.runnerEmptyListBtn.addEventListener('click', () => goView('my-checklists'));
  }

  if (els.runnerChecklistSelect) {
    els.runnerChecklistSelect.addEventListener('change', () => {
      const nextId = els.runnerChecklistSelect.value;
      if (nextId) {
        UIState.activeChecklistId = nextId;
        UIState.pendingAddTestTarget = null;
        saveActiveRunnerState({ activeChecklistId: nextId, lastQaView: 'qa-runner' });
        renderRunnerView();
      }
    });
  }

  if (els.runnerStartRenameBtn) {
    els.runnerStartRenameBtn.addEventListener('click', openRunnerTitleRename);
  }
  if (els.runnerSaveRenameBtn) {
    els.runnerSaveRenameBtn.addEventListener('click', commitRunnerTitleRename);
  }
  if (els.runnerCancelRenameBtn) {
    els.runnerCancelRenameBtn.addEventListener('click', closeRunnerTitleRename);
  }
  if (els.runnerTitleInput) {
    els.runnerTitleInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRunnerTitleRename();
      } else if (e.key === 'Escape') {
        closeRunnerTitleRename();
      }
    });
  }

  if (els.runnerExpandAllBtn) {
    els.runnerExpandAllBtn.addEventListener('click', () => {
      if (!UIState.activeChecklistId) return;
      setAllChecklistPhasesExpanded(UIState.activeChecklistId, true);
      renderRunnerView();
    });
  }

  if (els.runnerCollapseAllBtn) {
    els.runnerCollapseAllBtn.addEventListener('click', () => {
      if (!UIState.activeChecklistId) return;
      setAllChecklistPhasesExpanded(UIState.activeChecklistId, false);
      renderRunnerView();
    });
  }

  if (els.runnerToggleEditModeBtn) {
    els.runnerToggleEditModeBtn.addEventListener('click', () => {
      UIState.runnerEditMode = !UIState.runnerEditMode;
      UIState.pendingAddTestTarget = null;
      renderRunnerView();
    });
  }

  if (els.runnerAddPhaseBtn) {
    els.runnerAddPhaseBtn.addEventListener('click', () => {
      if (!UIState.activeChecklistId) return;
      const res = addPhaseToChecklist(UIState.activeChecklistId, { name: 'Additional Testing Phase' });
      if (!res.ok) {
        showMsg(res.error || 'Failed to add phase.', 'error');
        return;
      }
      renderRunnerView();
      refreshGlobalBadgesAndBanners();
      showMsg('Added new phase to checklist.', 'success');
    });
  }

  if (els.runnerPromoteBtn) {
    els.runnerPromoteBtn.addEventListener('click', () => {
      if (!UIState.activeChecklistId) return;
      const chk = getChecklistById(UIState.activeChecklistId);
      if (!chk) return;
      const linkedProj = findPromotedProjectForChecklist(chk);
      if (linkedProj) {
        if (typeof onOpenPromotedProject === 'function') {
          onOpenPromotedProject(linkedProj.id);
        } else {
          goView('plans');
        }
        return;
      }
      openPromoteChecklistModal(chk);
    });
  }

  // Promote Confirmation Modal Events
  if (els.promoteModalClose) els.promoteModalClose.addEventListener('click', closePromoteChecklistModal);
  if (els.promoteModalCancel) els.promoteModalCancel.addEventListener('click', closePromoteChecklistModal);
  if (els.promoteModalConfirm) els.promoteModalConfirm.addEventListener('click', confirmPromoteChecklist);
  if (els.promoteModal) {
    els.promoteModal.addEventListener('click', e => {
      if (e.target === els.promoteModal) closePromoteChecklistModal();
    });
  }
  if (els.promoteModalProjectName) {
    els.promoteModalProjectName.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmPromoteChecklist();
      }
    });
  }

  // Delete Confirmation Modal Events
  if (els.deleteModalClose) els.deleteModalClose.addEventListener('click', closeDeleteChecklistModal);
  if (els.deleteModalCancel) els.deleteModalCancel.addEventListener('click', closeDeleteChecklistModal);
  if (els.deleteModalConfirm) els.deleteModalConfirm.addEventListener('click', confirmDeleteChecklist);
  if (els.deleteModal) {
    els.deleteModal.addEventListener('click', e => {
      if (e.target === els.deleteModal) closeDeleteChecklistModal();
    });
  }

  document.addEventListener('keydown', e => {
    if (els.promoteModal && els.promoteModal.classList.contains('open')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePromoteChecklistModal();
      }
      return;
    }
    if (!els.deleteModal || !els.deleteModal.classList.contains('open')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDeleteChecklistModal();
      return;
    }
    if (e.key === 'Tab') {
      const focusable = Array.from(
        els.deleteModal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', e => {
      if (e.key === CHECKLISTS_STORAGE_KEY || e.key === ACTIVE_RUNNER_STORAGE_KEY) {
        const prevActiveId = UIState.activeChecklistId;
        const { checklists } = loadAllChecklists();
        const activeWasDeleted = Boolean(prevActiveId && !checklists.some(c => c.id === prevActiveId));

        if (activeWasDeleted) {
          if (UIState.pendingDeleteChecklistId === prevActiveId) {
            closeDeleteChecklistModal();
          }
          closeRunnerTitleRename();
          UIState.pendingAddTestTarget = null;
          UIState.activeChecklistId = checklists.length > 0 ? checklists[0].id : null;
          showMsg('Active checklist was removed in another tab.', 'info');
        }

        refreshGlobalBadgesAndBanners();
        const myChkSection = document.getElementById('view-my-checklists');
        const runnerSection = document.getElementById('view-qa-runner');
        if (myChkSection && myChkSection.classList.contains('active')) {
          renderMyChecklistsView();
        }
        if (runnerSection && runnerSection.classList.contains('active')) {
          const isEditingActiveChecklist = Boolean(
            !activeWasDeleted &&
              UIState.runnerEditMode &&
              els.runnerPhasesContainer &&
              els.runnerPhasesContainer.contains(document.activeElement)
          );
          if (isEditingActiveChecklist && UIState.activeChecklistId) {
            const latestActive = checklists.find(c => c.id === UIState.activeChecklistId);
            if (latestActive) {
              syncChecklistSwitcherDropdown(checklists, latestActive.id);
              updateRunnerOverallDOM(latestActive);
            }
          } else {
            renderRunnerView();
          }
        }
      }
    });
  }

  refreshGlobalBadgesAndBanners();

  return {
    openChecklistInRunner,
    openPromoteChecklistModal,
    renderMyChecklistsView,
    renderRunnerView,
    refreshGlobalBadgesAndBanners,
    syncFromStorage() {
      const st = getActiveRunnerState();
      const { checklists } = loadAllChecklists();
      if (st.activeChecklistId && checklists.some(c => c.id === st.activeChecklistId)) {
        UIState.activeChecklistId = st.activeChecklistId;
      } else {
        UIState.activeChecklistId = checklists.length > 0 ? checklists[0].id : null;
      }
      refreshGlobalBadgesAndBanners();
      const myChkSection = document.getElementById('view-my-checklists');
      const runnerSection = document.getElementById('view-qa-runner');
      if (myChkSection && myChkSection.classList.contains('active')) {
        renderMyChecklistsView();
      }
      if (runnerSection && runnerSection.classList.contains('active')) {
        renderRunnerView();
      }
    },
    recordLastQaView(viewName) {
      if (['checklist-generator', 'my-checklists', 'qa-runner'].includes(viewName)) {
        saveActiveRunnerState({ lastQaView: viewName });
      }
    },
    getRestoredInitialView() {
      const st = getActiveRunnerState();
      if (st.lastQaView === 'qa-runner' && st.activeChecklistId && getChecklistById(st.activeChecklistId)) {
        return 'qa-runner';
      }
      if (st.lastQaView === 'my-checklists') {
        return 'my-checklists';
      }
      return null;
    }
  };
}
