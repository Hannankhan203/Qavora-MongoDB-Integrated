/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — QA Checklist Generator & Editable Preview Controller (Prompt 1)
 * Uses 100% safe DOM construction (createElement / textContent / value) —
 * never injects user-pasted content via innerHTML.
 */

import {
  parseQAPlanText,
  createEmptyPhase,
  createEmptyCategorySection,
  createEmptyTestItem,
  formatPhaseHeading,
  computeChecklistSummary
} from './qaParser.js';
import {
  createChecklistFromParsedPlan,
  deriveDefaultChecklistTitle,
  derivePhaseNumberFromLabel,
  getChecklistById
} from './qaChecklistStore.js';

const SAMPLE_QA_PLAN = `PHASE 0 — Clean Test Environment
Prepare the browser and staging workspace before executing functional checks.
Environment: Staging (Chrome, Firefox, Safari)

Desktop Setup:
☐ Clear browser cache, cookies, and local storage.
☐ Open the application and verify no console errors appear.
☐ Confirm main navigation and landing view render properly.

Phase 1: User Authentication
Verify account registration, sign-in flows, and session security.

Valid Credentials:
- AUTH-001: Register a new account with a valid email and strong password.
- AUTH-002: Log in with valid credentials and verify dashboard redirect.
- Verify session remains active after page refresh.

Negative & Edge Cases:
1. Attempt login with an incorrect password and verify clear error message.
2. Attempt registration with an already registered email address.
3. Submit empty login form and confirm required field validation.

## Phase 2 — Workspace & Document Management
Validate core CRUD workflows and search filtering.

* DOC-101 — Create a new workspace item with title and description [High]
* DOC-102 — Edit an existing item and confirm changes persist
* Filter items by keyword and verify matching results update immediately

Final Regression & Release Checklist
Verify critical release readiness gates prior to deployment.

- Confirm light and dark themes render with proper contrast.
- Verify mobile and tablet responsive layouts across viewports.
- Confirm production build completes with zero warnings or errors.`;

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
  plus: () =>
    createSvgIcon([
      { tag: 'line', attrs: { x1: '12', y1: '5', x2: '12', y2: '19' } },
      { tag: 'line', attrs: { x1: '5', y1: '12', x2: '19', y2: '12' } }
    ]),
  trash: () =>
    createSvgIcon([
      { tag: 'polyline', attrs: { points: '3 6 5 6 21 6' } },
      {
        tag: 'path',
        attrs: { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }
      }
    ]),
  close: () =>
    createSvgIcon([
      { tag: 'line', attrs: { x1: '18', y1: '6', x2: '6', y2: '18' } },
      { tag: 'line', attrs: { x1: '6', y1: '6', x2: '18', y2: '18' } }
    ]),
  edit: () =>
    createSvgIcon([
      { tag: 'path', attrs: { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' } },
      { tag: 'path', attrs: { d: 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' } }
    ]),
  eye: () =>
    createSvgIcon([
      { tag: 'path', attrs: { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' } },
      { tag: 'circle', attrs: { cx: '12', cy: '12', r: '3' } }
    ]),
  checkCircle: () =>
    createSvgIcon([
      { tag: 'path', attrs: { d: 'M22 11.08V12a10 10 0 1 1-5.93-9.14' } },
      { tag: 'polyline', attrs: { points: '22 4 12 14.01 9 11.01' } }
    ]),
  info: () =>
    createSvgIcon([
      { tag: 'circle', attrs: { cx: '12', cy: '12', r: '10' } },
      { tag: 'line', attrs: { x1: '12', y1: '16', x2: '12', y2: '12' } },
      { tag: 'line', attrs: { x1: '12', y1: '8', x2: '12.01', y2: '8' } }
    ]),
  alert: () =>
    createSvgIcon([
      {
        tag: 'path',
        attrs: { d: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' }
      },
      { tag: 'line', attrs: { x1: '12', y1: '9', x2: '12', y2: '13' } },
      { tag: 'line', attrs: { x1: '12', y1: '17', x2: '12.01', y2: '17' } }
    ]),
  folder: () =>
    createSvgIcon([
      { tag: 'path', attrs: { d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' } }
    ]),
  arrowUp: () =>
    createSvgIcon([
      { tag: 'line', attrs: { x1: '12', y1: '19', x2: '12', y2: '5' } },
      { tag: 'polyline', attrs: { points: '5 12 12 5 19 12' } }
    ]),
  arrowDown: () =>
    createSvgIcon([
      { tag: 'line', attrs: { x1: '12', y1: '5', x2: '12', y2: '19' } },
      { tag: 'polyline', attrs: { points: '19 12 12 19 5 12' } }
    ])
};

const STANDARD_PRIORITIES = ['', 'Critical', 'High', 'Medium', 'Low', 'P0', 'P1', 'P2', 'P3'];

export function initChecklistGenerator({ notify, onChecklistStarted } = {}) {
  const els = {
    textarea: document.getElementById('qa-plan-textarea'),
    inputStats: document.getElementById('qa-plan-input-stats'),
    generateBtn: document.getElementById('btn-generate-checklist'),
    clearBtn: document.getElementById('btn-clear-checklist-text'),
    loadSampleBtn: document.getElementById('btn-load-sample-plan'),
    alertsContainer: document.getElementById('qa-parser-alerts'),
    previewSection: document.getElementById('qa-checklist-preview-wrapper'),
    checklistTitleInput: document.getElementById('qa-preview-title-input'),
    startTestingTopBtn: document.getElementById('btn-start-testing-top'),
    startTestingBottomBtn: document.getElementById('btn-start-testing-bottom'),
    summaryPhaseCount: document.getElementById('qa-summary-phases'),
    summaryCategoryCount: document.getElementById('qa-summary-categories'),
    summaryTestCount: document.getElementById('qa-summary-tests'),
    summaryNoteCount: document.getElementById('qa-summary-notes'),
    modeFormattedBtn: document.getElementById('btn-preview-mode-formatted'),
    modeEditableBtn: document.getElementById('btn-preview-mode-editable'),
    addPhaseTopBtn: document.getElementById('btn-preview-add-phase-top'),
    addPhaseBottomBtn: document.getElementById('btn-preview-add-phase-bottom'),
    docMetaContainer: document.getElementById('qa-preview-doc-meta'),
    phasesRoot: document.getElementById('qa-preview-phases-root'),
    unclassifiedWrapper: document.getElementById('qa-unclassified-wrapper'),
    unclassifiedCountBadge: document.getElementById('qa-unclassified-count'),
    unclassifiedList: document.getElementById('qa-unclassified-list')
  };

  if (!els.textarea || !els.generateBtn) {
    return;
  }

  const GeneratorState = {
    parsedPlan: null,
    previewMode: 'editable', // 'editable' | 'formatted'
    isStarting: false,
    lastStartedSignature: null,
    lastStartedChecklistId: null
  };

  function showNotification(msg, type = 'success') {
    if (typeof notify === 'function') {
      notify(msg, type);
    }
  }

  function updateInputLineStats() {
    const val = els.textarea.value || '';
    if (!els.inputStats) return;
    if (!val.trim()) {
      els.inputStats.textContent = '0 lines • Ready for paste';
      return;
    }
    const lineCount = val.replace(/\r\n?/g, '\n').split('\n').length;
    const charCount = val.length.toLocaleString();
    els.inputStats.textContent = `${lineCount.toLocaleString()} ${lineCount === 1 ? 'line' : 'lines'} • ${charCount} chars`;
  }

  function clearAlerts() {
    if (!els.alertsContainer) return;
    while (els.alertsContainer.firstChild) {
      els.alertsContainer.removeChild(els.alertsContainer.firstChild);
    }
  }

  function renderAlerts(messages) {
    clearAlerts();
    if (!els.alertsContainer || !Array.isArray(messages) || messages.length === 0) return;

    for (const msg of messages) {
      const banner = document.createElement('div');
      const tone = msg.type || 'info';
      banner.className = `qa-parser-alert qa-alert-${tone}`;

      const iconWrap = document.createElement('span');
      iconWrap.className = 'qa-alert-icon';
      if (tone === 'success') {
        iconWrap.appendChild(ICONS.checkCircle());
      } else if (tone === 'warning' || tone === 'error') {
        iconWrap.appendChild(ICONS.alert());
      } else {
        iconWrap.appendChild(ICONS.info());
      }

      const textSpan = document.createElement('span');
      textSpan.className = 'qa-alert-text';
      textSpan.textContent = msg.text;

      banner.appendChild(iconWrap);
      banner.appendChild(textSpan);
      els.alertsContainer.appendChild(banner);
    }
  }

  function syncSummaryCounters() {
    const summary = computeChecklistSummary(GeneratorState.parsedPlan);
    if (els.summaryPhaseCount) els.summaryPhaseCount.textContent = String(summary.phaseCount);
    if (els.summaryCategoryCount) els.summaryCategoryCount.textContent = String(summary.categoryCount);
    if (els.summaryTestCount) els.summaryTestCount.textContent = String(summary.testCount);
    if (els.summaryNoteCount) {
      els.summaryNoteCount.textContent = String(summary.noteCount + summary.unclassifiedCount);
    }
  }

  function updateModeButtonsUI() {
    const isEditable = GeneratorState.previewMode === 'editable';
    if (els.modeEditableBtn) {
      els.modeEditableBtn.classList.toggle('active', isEditable);
      els.modeEditableBtn.setAttribute('aria-pressed', String(isEditable));
    }
    if (els.modeFormattedBtn) {
      els.modeFormattedBtn.classList.toggle('active', !isEditable);
      els.modeFormattedBtn.setAttribute('aria-pressed', String(!isEditable));
    }
    if (els.addPhaseTopBtn) {
      els.addPhaseTopBtn.style.display = isEditable ? '' : 'none';
    }
    if (els.addPhaseBottomBtn) {
      els.addPhaseBottomBtn.style.display = isEditable ? '' : 'none';
    }
  }

  // ==========================================================================
  // Safe DOM Renderers: Formatted Clean Preview Mode (Section 5)
  // ==========================================================================
  function renderFormattedPreview(plan) {
    while (els.phasesRoot.firstChild) {
      els.phasesRoot.removeChild(els.phasesRoot.firstChild);
    }

    if (plan.phases.length === 0) {
      const emptyBox = document.createElement('div');
      emptyBox.className = 'qa-preview-empty-card';
      const p = document.createElement('p');
      p.textContent =
        'No phases are currently defined in this checklist. Switch to "Edit & Review" or click "+ Add Phase" to create one.';
      emptyBox.appendChild(p);
      els.phasesRoot.appendChild(emptyBox);
      return;
    }

    for (const phase of plan.phases) {
      const card = document.createElement('article');
      card.className = 'qa-clean-phase-card';

      const heading = document.createElement('h3');
      heading.className = 'qa-clean-phase-title';
      heading.textContent = formatPhaseHeading(phase);
      card.appendChild(heading);

      if (phase.description && phase.description.trim()) {
        const descRow = document.createElement('p');
        descRow.className = 'qa-clean-phase-desc';

        const descLabel = document.createElement('strong');
        descLabel.textContent = 'Description: ';
        descRow.appendChild(descLabel);

        const descBody = document.createElement('span');
        descBody.textContent = phase.description.trim();
        descRow.appendChild(descBody);

        card.appendChild(descRow);
      }

      if (Array.isArray(phase.notes) && phase.notes.length > 0) {
        const notesList = document.createElement('div');
        notesList.className = 'qa-clean-notes-group';
        for (const note of phase.notes) {
          const noteItem = document.createElement('div');
          noteItem.className = `qa-clean-note qa-note-${note.kind || 'note'}`;
          noteItem.textContent = note.text;
          notesList.appendChild(noteItem);
        }
        card.appendChild(notesList);
      }

      const totalTestsInPhase = phase.sections.reduce((acc, s) => acc + s.tests.length, 0);
      if (phase.sections.length === 0 || (totalTestsInPhase === 0 && phase.sections.every(s => s.type === 'direct'))) {
        const noTestsMsg = document.createElement('p');
        noTestsMsg.className = 'qa-clean-empty-phase-hint';
        noTestsMsg.textContent = 'No individual test cases in this phase.';
        card.appendChild(noTestsMsg);
      } else {
        for (const section of phase.sections) {
          const secBlock = document.createElement('div');
          secBlock.className =
            section.type === 'category' ? 'qa-clean-category-block' : 'qa-clean-direct-block';

          if (section.type === 'category') {
            const catTitle = document.createElement('h4');
            catTitle.className = 'qa-clean-category-title';
            catTitle.textContent = `${section.name}:`;
            secBlock.appendChild(catTitle);
          }

          if (Array.isArray(section.notes) && section.notes.length > 0) {
            for (const sNote of section.notes) {
              const noteEl = document.createElement('div');
              noteEl.className = `qa-clean-note qa-note-${sNote.kind || 'note'}`;
              noteEl.textContent = sNote.text;
              secBlock.appendChild(noteEl);
            }
          }

          if (section.tests.length === 0 && section.type === 'category') {
            const catEmpty = document.createElement('p');
            catEmpty.className = 'qa-clean-empty-phase-hint';
            catEmpty.textContent = 'No test items under this category.';
            secBlock.appendChild(catEmpty);
          } else if (section.tests.length > 0) {
            const ul = document.createElement('ul');
            ul.className = 'qa-clean-test-list';
            for (const tc of section.tests) {
              const li = document.createElement('li');
              li.className = 'qa-clean-test-item';

              const bullet = document.createElement('span');
              bullet.className = 'qa-clean-bullet';
              bullet.textContent = '☐';
              bullet.setAttribute('aria-hidden', 'true');
              li.appendChild(bullet);

              const textWrap = document.createElement('div');
              textWrap.className = 'qa-clean-test-content';

              if (tc.testId !== undefined && tc.testId !== null && String(tc.testId).trim() !== '') {
                const idBadge = document.createElement('span');
                idBadge.className = 'qa-test-id-chip';
                idBadge.textContent = String(tc.testId);
                textWrap.appendChild(idBadge);
              }

              const bodySpan = document.createElement('span');
              bodySpan.className = 'qa-clean-test-text';
              bodySpan.textContent = tc.text;
              textWrap.appendChild(bodySpan);

              if (tc.priority !== undefined && tc.priority !== null && String(tc.priority).trim() !== '') {
                const prioBadge = document.createElement('span');
                prioBadge.className = 'qa-test-prio-chip';
                prioBadge.textContent = String(tc.priority);
                textWrap.appendChild(prioBadge);
              }

              li.appendChild(textWrap);
              ul.appendChild(li);
            }
            secBlock.appendChild(ul);
          }

          card.appendChild(secBlock);
        }
      }

      els.phasesRoot.appendChild(card);
    }
  }

  // ==========================================================================
  // Safe DOM Renderers: Editable Review Mode (Section 6)
  // ==========================================================================
  function renderEditablePreview(plan) {
    while (els.phasesRoot.firstChild) {
      els.phasesRoot.removeChild(els.phasesRoot.firstChild);
    }

    if (plan.phases.length === 0) {
      const emptyBox = document.createElement('div');
      emptyBox.className = 'qa-preview-empty-card';
      const p = document.createElement('p');
      p.textContent = 'No phases in checklist yet. Click "+ Add Phase" to create a phase.';
      emptyBox.appendChild(p);
      els.phasesRoot.appendChild(emptyBox);
      return;
    }

    plan.phases.forEach((phase, pIndex) => {
      const card = document.createElement('article');
      card.className = 'qa-edit-phase-card';
      card.dataset.phaseId = phase.id;

      // --- Phase Header ---
      const header = document.createElement('div');
      header.className = 'qa-edit-phase-header';

      const titleFields = document.createElement('div');
      titleFields.className = 'qa-edit-phase-title-fields';

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'qa-inline-input qa-phase-label-input';
      labelInput.placeholder = 'Phase # (optional)';
      labelInput.setAttribute('aria-label', 'Phase identifier or number');
      labelInput.value = phase.phaseLabel !== undefined && phase.phaseLabel !== null ? String(phase.phaseLabel) : '';
      labelInput.addEventListener('input', () => {
        phase.phaseLabel = labelInput.value;
        phase.phaseNumber = phase.phaseLabel.trim()
          ? derivePhaseNumberFromLabel(phase.phaseLabel, phase.phaseNumber)
          : '';
        phase.isImplicit = false;
      });

      const sepSpan = document.createElement('span');
      sepSpan.className = 'qa-phase-sep';
      sepSpan.textContent = '—';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'qa-inline-input qa-phase-name-input';
      nameInput.placeholder = 'Phase Name';
      nameInput.setAttribute('aria-label', 'Phase name');
      nameInput.value = phase.name !== undefined && phase.name !== null ? String(phase.name) : '';
      nameInput.addEventListener('input', () => {
        phase.name = nameInput.value;
        phase.isImplicit = false;
      });

      titleFields.appendChild(labelInput);
      titleFields.appendChild(sepSpan);
      titleFields.appendChild(nameInput);

      const headerActions = document.createElement('div');
      headerActions.className = 'qa-edit-phase-actions';

      const addCatBtn = document.createElement('button');
      addCatBtn.type = 'button';
      addCatBtn.className = 'btn btn-secondary btn-xs';
      addCatBtn.appendChild(ICONS.folder());
      const addCatTxt = document.createElement('span');
      addCatTxt.textContent = 'Add Category';
      addCatBtn.appendChild(addCatTxt);
      addCatBtn.addEventListener('click', () => {
        const newCat = createEmptyCategorySection({
          name: `Category ${phase.sections.filter(s => s.type === 'category').length + 1}`,
          tests: [createEmptyTestItem({ text: 'New test item' })]
        });
        phase.sections.push(newCat);
        renderPreview();
      });

      const addDirectTestBtn = document.createElement('button');
      addDirectTestBtn.type = 'button';
      addDirectTestBtn.className = 'btn btn-secondary btn-xs';
      addDirectTestBtn.appendChild(ICONS.plus());
      const addTestTxt = document.createElement('span');
      addTestTxt.textContent = 'Add Test';
      addDirectTestBtn.appendChild(addTestTxt);
      addDirectTestBtn.addEventListener('click', () => {
        let directSec = phase.sections.find(s => s.type === 'direct');
        if (!directSec) {
          directSec = {
            id: `sec_direct_${Date.now()}`,
            type: 'direct',
            name: '',
            notes: [],
            tests: []
          };
          phase.sections.unshift(directSec);
        }
        directSec.tests.push(createEmptyTestItem({ text: '' }));
        renderPreview();
      });

      const removePhaseBtn = document.createElement('button');
      removePhaseBtn.type = 'button';
      removePhaseBtn.className = 'qa-icon-action-btn qa-btn-danger-hover';
      removePhaseBtn.title = 'Remove Phase';
      removePhaseBtn.setAttribute('aria-label', 'Remove Phase');
      removePhaseBtn.appendChild(ICONS.trash());
      removePhaseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        plan.phases.splice(pIndex, 1);
        renderPreview();
        showNotification('Phase removed from preview.', 'info');
      });

      const addNoteBtn = document.createElement('button');
      addNoteBtn.type = 'button';
      addNoteBtn.className = 'btn btn-ghost btn-xs';
      addNoteBtn.appendChild(ICONS.info());
      const addNoteTxt = document.createElement('span');
      addNoteTxt.textContent = 'Add Note';
      addNoteBtn.appendChild(addNoteTxt);
      addNoteBtn.addEventListener('click', () => {
        if (!Array.isArray(phase.notes)) phase.notes = [];
        phase.notes.push({
          id: `note_${Date.now()}_${phase.notes.length}`,
          kind: 'note',
          text: 'Testing instruction or environment note'
        });
        renderPreview();
      });

      headerActions.appendChild(addCatBtn);
      headerActions.appendChild(addDirectTestBtn);
      headerActions.appendChild(addNoteBtn);
      headerActions.appendChild(removePhaseBtn);

      header.appendChild(titleFields);
      header.appendChild(headerActions);
      card.appendChild(header);

      // --- Phase Description ---
      const descWrap = document.createElement('div');
      descWrap.className = 'qa-edit-desc-wrap';

      const descLabel = document.createElement('label');
      descLabel.className = 'qa-field-micro-label';
      descLabel.textContent = 'Description:';

      const descInput = document.createElement('textarea');
      descInput.className = 'qa-inline-textarea';
      descInput.rows = phase.description && phase.description.includes('\n') ? 2 : 1;
      descInput.placeholder = 'Optional phase description or testing goal...';
      descInput.setAttribute('aria-label', 'Phase description');
      descInput.value = phase.description !== undefined && phase.description !== null ? String(phase.description) : '';
      descInput.addEventListener('input', () => {
        phase.description = descInput.value;
      });

      descWrap.appendChild(descLabel);
      descWrap.appendChild(descInput);
      card.appendChild(descWrap);

      // --- Phase-Level Supporting Instructions / Environment Info ---
      if (Array.isArray(phase.notes) && phase.notes.length > 0) {
        card.appendChild(renderEditableNotesList(phase.notes, phase, null));
      }

      // --- Sections (Direct Tests & Categories in Original Order) ---
      const sectionsContainer = document.createElement('div');
      sectionsContainer.className = 'qa-edit-sections-container';

      const hasAnyTestsOrCategories = phase.sections.some(
        s => s.type === 'category' || (Array.isArray(s.tests) && s.tests.length > 0)
      );

      if (!hasAnyTestsOrCategories) {
        const emptyHint = document.createElement('div');
        emptyHint.className = 'qa-empty-phase-box';
        const hintText = document.createElement('span');
        hintText.textContent = 'No categories or test cases in this phase yet.';
        emptyHint.appendChild(hintText);
        sectionsContainer.appendChild(emptyHint);
      } else {
        phase.sections.forEach((section, sIndex) => {
          if (section.type === 'direct' && section.tests.length === 0 && (!section.notes || section.notes.length === 0)) {
            return;
          }

          const secEl = document.createElement('div');
          secEl.className =
            section.type === 'category' ? 'qa-edit-category-box' : 'qa-edit-direct-box';

          if (section.type === 'category') {
            const catHeader = document.createElement('div');
            catHeader.className = 'qa-edit-category-header';

            const catNameGroup = document.createElement('div');
            catNameGroup.className = 'qa-edit-category-name-group';

            const catBadge = document.createElement('span');
            catBadge.className = 'qa-cat-tag';
            catBadge.textContent = 'Category';

            const catInput = document.createElement('input');
            catInput.type = 'text';
            catInput.className = 'qa-inline-input qa-category-name-input';
            catInput.placeholder = 'Category Name';
            catInput.setAttribute('aria-label', 'Category name');
            catInput.value = section.name !== undefined && section.name !== null ? String(section.name) : '';
            catInput.addEventListener('input', () => {
              section.name = catInput.value;
            });

            catNameGroup.appendChild(catBadge);
            catNameGroup.appendChild(catInput);

            const catActions = document.createElement('div');
            catActions.className = 'qa-edit-category-actions';

            const addCatTestBtn = document.createElement('button');
            addCatTestBtn.type = 'button';
            addCatTestBtn.className = 'btn btn-ghost btn-xs';
            addCatTestBtn.appendChild(ICONS.plus());
            const btnLbl = document.createElement('span');
            btnLbl.textContent = 'Add Test';
            addCatTestBtn.appendChild(btnLbl);
            addCatTestBtn.addEventListener('click', () => {
              section.tests.push(createEmptyTestItem({ text: '' }));
              renderPreview();
            });

            const ungroupCatBtn = document.createElement('button');
            ungroupCatBtn.type = 'button';
            ungroupCatBtn.className = 'btn btn-ghost btn-xs';
            ungroupCatBtn.title = 'Remove category heading but keep its tests';
            const ungroupTxt = document.createElement('span');
            ungroupTxt.textContent = 'Ungroup';
            ungroupCatBtn.appendChild(ungroupTxt);
            ungroupCatBtn.addEventListener('click', () => {
              section.type = 'direct';
              section.name = '';
              renderPreview();
            });

            const deleteCatBtn = document.createElement('button');
            deleteCatBtn.type = 'button';
            deleteCatBtn.className = 'qa-icon-action-btn qa-btn-danger-hover';
            deleteCatBtn.title = 'Delete category and its tests';
            deleteCatBtn.setAttribute('aria-label', 'Delete category');
            deleteCatBtn.appendChild(ICONS.trash());
            deleteCatBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              phase.sections.splice(sIndex, 1);
              renderPreview();
            });

            catActions.appendChild(addCatTestBtn);
            if (section.tests.length > 0) {
              catActions.appendChild(ungroupCatBtn);
            }
            catActions.appendChild(deleteCatBtn);

            catHeader.appendChild(catNameGroup);
            catHeader.appendChild(catActions);
            secEl.appendChild(catHeader);
          }

          if (Array.isArray(section.notes) && section.notes.length > 0) {
            secEl.appendChild(renderEditableNotesList(section.notes, phase, section));
          }

          // Tests list
          const testsList = document.createElement('div');
          testsList.className = 'qa-edit-tests-list';

          if (section.tests.length === 0 && section.type === 'category') {
            const noCatTests = document.createElement('div');
            noCatTests.className = 'qa-empty-cat-hint';
            noCatTests.textContent = 'No tests in this category yet. Click "+ Add Test" to add one.';
            testsList.appendChild(noCatTests);
          } else {
            section.tests.forEach((tc, tIndex) => {
              const row = document.createElement('div');
              row.className = 'qa-edit-test-row';

              const marker = document.createElement('span');
              marker.className = 'qa-edit-test-marker';
              marker.textContent = '☐';
              marker.setAttribute('aria-hidden', 'true');

              const idInput = document.createElement('input');
              idInput.type = 'text';
              idInput.className = 'qa-inline-input qa-test-id-input';
              idInput.placeholder = 'ID (opt)';
              idInput.title = 'Optional Test ID (e.g. AUTH-001)';
              idInput.setAttribute('aria-label', 'Test ID');
              idInput.value = tc.testId !== undefined && tc.testId !== null ? String(tc.testId) : '';
              idInput.addEventListener('input', () => {
                tc.testId = idInput.value.trim();
              });

              const textInput = document.createElement('input');
              textInput.type = 'text';
              textInput.className = 'qa-inline-input qa-test-text-input';
              textInput.placeholder = 'Describe the manual test verification...';
              textInput.setAttribute('aria-label', 'Test description');
              textInput.value = tc.text !== undefined && tc.text !== null ? String(tc.text) : '';
              textInput.addEventListener('input', () => {
                tc.text = textInput.value;
                syncSummaryCounters();
              });

              const prioSelect = document.createElement('select');
              prioSelect.className = 'qa-inline-input qa-test-prio-select';
              prioSelect.setAttribute('aria-label', 'Test priority');
              prioSelect.title = 'Optional test priority';
              const currentPrio = (tc.priority !== undefined && tc.priority !== null ? String(tc.priority) : '').trim();
              const prioOptions = STANDARD_PRIORITIES.includes(currentPrio)
                ? STANDARD_PRIORITIES
                : [...STANDARD_PRIORITIES, currentPrio];
              for (const optVal of prioOptions) {
                const opt = document.createElement('option');
                opt.value = optVal;
                opt.textContent = optVal !== '' ? optVal : 'Priority';
                if (optVal === currentPrio) opt.selected = true;
                prioSelect.appendChild(opt);
              }
              prioSelect.addEventListener('change', () => {
                tc.priority = prioSelect.value;
              });

              row.appendChild(marker);
              row.appendChild(idInput);
              row.appendChild(textInput);
              row.appendChild(prioSelect);

              if (section.tests.length > 1) {
                const moveUpBtn = document.createElement('button');
                moveUpBtn.type = 'button';
                moveUpBtn.className = 'qa-icon-action-btn';
                moveUpBtn.title = 'Move test up';
                moveUpBtn.setAttribute('aria-label', 'Move test up');
                moveUpBtn.disabled = tIndex === 0;
                moveUpBtn.appendChild(ICONS.arrowUp());
                moveUpBtn.addEventListener('click', () => {
                  if (tIndex <= 0) return;
                  const [moved] = section.tests.splice(tIndex, 1);
                  section.tests.splice(tIndex - 1, 0, moved);
                  renderPreview();
                });

                const moveDownBtn = document.createElement('button');
                moveDownBtn.type = 'button';
                moveDownBtn.className = 'qa-icon-action-btn';
                moveDownBtn.title = 'Move test down';
                moveDownBtn.setAttribute('aria-label', 'Move test down');
                moveDownBtn.disabled = tIndex === section.tests.length - 1;
                moveDownBtn.appendChild(ICONS.arrowDown());
                moveDownBtn.addEventListener('click', () => {
                  if (tIndex >= section.tests.length - 1) return;
                  const [moved] = section.tests.splice(tIndex, 1);
                  section.tests.splice(tIndex + 1, 0, moved);
                  renderPreview();
                });

                row.appendChild(moveUpBtn);
                row.appendChild(moveDownBtn);
              }

              // Reclassify test as category heading if misdetected
              const promoteCatBtn = document.createElement('button');
              promoteCatBtn.type = 'button';
              promoteCatBtn.className = 'btn btn-ghost btn-xs qa-row-subtle-btn';
              promoteCatBtn.title = 'Convert this line into a Category subheading';
              const promoteTxt = document.createElement('span');
              promoteTxt.textContent = '→ Category';
              promoteCatBtn.appendChild(promoteTxt);
              promoteCatBtn.addEventListener('click', () => {
                const labelText = (tc.text || '').replace(/:\s*$/, '').trim() || 'New Category';
                // Split any remaining tests after tIndex into the newly created category
                const trailingTests = section.tests.splice(tIndex + 1);
                section.tests.splice(tIndex, 1);
                const newCatSec = createEmptyCategorySection({
                  name: labelText,
                  tests: trailingTests
                });
                phase.sections.splice(sIndex + 1, 0, newCatSec);
                renderPreview();
              });

              const deleteTestBtn = document.createElement('button');
              deleteTestBtn.type = 'button';
              deleteTestBtn.className = 'qa-icon-action-btn qa-btn-danger-hover';
              deleteTestBtn.title = 'Remove test item';
              deleteTestBtn.setAttribute('aria-label', 'Remove test item');
              deleteTestBtn.appendChild(ICONS.close());
              deleteTestBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                section.tests.splice(tIndex, 1);
                renderPreview();
              });

              row.appendChild(promoteCatBtn);
              row.appendChild(deleteTestBtn);
              testsList.appendChild(row);
            });
          }

          secEl.appendChild(testsList);

          if (section.type === 'direct') {
            const directFooter = document.createElement('div');
            directFooter.className = 'qa-direct-footer';
            const quickAddBtn = document.createElement('button');
            quickAddBtn.type = 'button';
            quickAddBtn.className = 'btn btn-ghost btn-xs';
            quickAddBtn.appendChild(ICONS.plus());
            const qTxt = document.createElement('span');
            qTxt.textContent = 'Add Test Item';
            quickAddBtn.appendChild(qTxt);
            quickAddBtn.addEventListener('click', () => {
              section.tests.push(createEmptyTestItem({ text: '' }));
              renderPreview();
            });
            directFooter.appendChild(quickAddBtn);
            secEl.appendChild(directFooter);
          }

          sectionsContainer.appendChild(secEl);
        });
      }

      card.appendChild(sectionsContainer);
      els.phasesRoot.appendChild(card);
    });
  }

  function renderEditableNotesList(notesArray, phase, sectionOrNull) {
    const wrap = document.createElement('div');
    wrap.className = 'qa-supporting-notes-wrap';

    notesArray.forEach((note, nIdx) => {
      const row = document.createElement('div');
      row.className = `qa-supporting-note-row qa-note-${note.kind || 'note'}`;

      const badge = document.createElement('span');
      badge.className = 'qa-note-badge';
      badge.textContent =
        note.kind === 'environment'
          ? 'Environment'
          : note.kind === 'instruction'
            ? 'Instruction'
            : 'Supporting Note';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'qa-inline-input qa-note-input';
      input.value = note.text !== undefined && note.text !== null ? String(note.text) : '';
      input.setAttribute('aria-label', 'Supporting instruction or environment note');
      input.addEventListener('input', () => {
        note.text = input.value;
      });

      const toTestBtn = document.createElement('button');
      toTestBtn.type = 'button';
      toTestBtn.className = 'btn btn-ghost btn-xs qa-row-subtle-btn';
      toTestBtn.title = 'Convert this note into an executable test item';
      const toTestTxt = document.createElement('span');
      toTestTxt.textContent = '→ Make Test';
      toTestBtn.appendChild(toTestTxt);
      toTestBtn.addEventListener('click', () => {
        notesArray.splice(nIdx, 1);
        const targetSec =
          sectionOrNull ||
          phase.sections.find(s => s.type === 'direct') ||
          (() => {
            const ds = { id: `sec_${Date.now()}`, type: 'direct', name: '', notes: [], tests: [] };
            phase.sections.unshift(ds);
            return ds;
          })();
        targetSec.tests.push(createEmptyTestItem({ text: note.text }));
        renderPreview();
      });

      const removeNoteBtn = document.createElement('button');
      removeNoteBtn.type = 'button';
      removeNoteBtn.className = 'qa-icon-action-btn qa-btn-danger-hover';
      removeNoteBtn.title = 'Remove supporting note';
      removeNoteBtn.setAttribute('aria-label', 'Remove supporting note');
      removeNoteBtn.appendChild(ICONS.close());
      removeNoteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        notesArray.splice(nIdx, 1);
        renderPreview();
      });

      row.appendChild(badge);
      row.appendChild(input);
      row.appendChild(toTestBtn);
      row.appendChild(removeNoteBtn);
      wrap.appendChild(row);
    });

    return wrap;
  }

  function renderDocumentMeta(plan) {
    if (!els.docMetaContainer) return;
    while (els.docMetaContainer.firstChild) {
      els.docMetaContainer.removeChild(els.docMetaContainer.firstChild);
    }

    const hasTitle = Boolean(plan.documentTitle && plan.documentTitle.trim());
    const hasNotes = Array.isArray(plan.documentNotes) && plan.documentNotes.length > 0;

    if (!hasTitle && !hasNotes) {
      els.docMetaContainer.style.display = 'none';
      return;
    }

    els.docMetaContainer.style.display = 'block';

    if (hasTitle) {
      const titleRow = document.createElement('div');
      titleRow.className = 'qa-doc-title-banner';
      const badge = document.createElement('span');
      badge.className = 'panel-tag';
      badge.textContent = 'Detected Plan Title';
      const titleText = document.createElement('strong');
      titleText.className = 'qa-doc-title-text';
      titleText.textContent = plan.documentTitle;
      titleRow.appendChild(badge);
      titleRow.appendChild(titleText);
      els.docMetaContainer.appendChild(titleRow);
    }

    if (hasNotes) {
      const notesBox = document.createElement('div');
      notesBox.className = 'qa-doc-notes-box';
      plan.documentNotes.forEach((n, idx) => {
        const line = document.createElement('div');
        line.className = 'qa-supporting-note-row';

        const tag = document.createElement('span');
        tag.className = 'qa-note-badge';
        tag.textContent = n.kind === 'environment' ? 'Environment' : 'Plan Note';

        line.appendChild(tag);

        if (GeneratorState.previewMode === 'editable') {
          const noteInput = document.createElement('input');
          noteInput.type = 'text';
          noteInput.className = 'qa-inline-input qa-note-input';
          noteInput.value = n.text !== undefined && n.text !== null ? String(n.text) : '';
          noteInput.setAttribute('aria-label', 'Plan supporting note');
          noteInput.addEventListener('input', () => {
            n.text = noteInput.value;
          });
          line.appendChild(noteInput);

          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'qa-icon-action-btn qa-btn-danger-hover';
          delBtn.title = 'Dismiss note';
          delBtn.setAttribute('aria-label', 'Dismiss note');
          delBtn.appendChild(ICONS.close());
          delBtn.addEventListener('click', () => {
            plan.documentNotes.splice(idx, 1);
            renderPreview();
          });
          line.appendChild(delBtn);
        } else {
          const txt = document.createElement('span');
          txt.className = 'qa-doc-note-text';
          txt.textContent = n.text;
          line.appendChild(txt);
        }

        notesBox.appendChild(line);
      });
      els.docMetaContainer.appendChild(notesBox);
    }
  }

  function renderUnclassifiedSection(plan) {
    if (!els.unclassifiedWrapper || !els.unclassifiedList) return;
    while (els.unclassifiedList.firstChild) {
      els.unclassifiedList.removeChild(els.unclassifiedList.firstChild);
    }

    if (!Array.isArray(plan.unclassified) || plan.unclassified.length === 0) {
      els.unclassifiedWrapper.style.display = 'none';
      return;
    }

    els.unclassifiedWrapper.style.display = 'block';
    if (els.unclassifiedCountBadge) {
      els.unclassifiedCountBadge.textContent = `${plan.unclassified.length} ${plan.unclassified.length === 1 ? 'item' : 'items'}`;
    }

    plan.unclassified.forEach((item, uIdx) => {
      const card = document.createElement('div');
      card.className = 'qa-unclassified-item';

      const topRow = document.createElement('div');
      topRow.className = 'qa-unclassified-top';

      const lineBadge = document.createElement('span');
      lineBadge.className = 'qa-line-badge';
      lineBadge.textContent = (item.lineNumber !== undefined && item.lineNumber !== null && item.lineNumber !== '') ? `Line ${item.lineNumber}` : 'Unclassified';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'qa-inline-input qa-unclassified-input';
      input.value = item.text !== undefined && item.text !== null ? String(item.text) : '';
      input.setAttribute('aria-label', 'Unclassified content text');
      input.addEventListener('input', () => {
        item.text = input.value;
      });

      topRow.appendChild(lineBadge);
      topRow.appendChild(input);

      const reasonRow = document.createElement('div');
      reasonRow.className = 'qa-unclassified-reason';
      reasonRow.textContent = item.reason || 'preserved for manual review.';

      const actionsRow = document.createElement('div');
      actionsRow.className = 'qa-unclassified-actions';

      // Target phase picker for moving item into a phase
      const phaseSelect = document.createElement('select');
      phaseSelect.className = 'filter-select qa-unclassified-select';
      phaseSelect.setAttribute('aria-label', 'Target phase');

      if (plan.phases.length === 0) {
        const opt = document.createElement('option');
        opt.value = '__new__';
        opt.textContent = 'Create Default Phase';
        phaseSelect.appendChild(opt);
      } else {
        plan.phases.forEach(ph => {
          const opt = document.createElement('option');
          opt.value = ph.id;
          opt.textContent = formatPhaseHeading(ph);
          if (item.nearestPhaseId && ph.id === item.nearestPhaseId) {
            opt.selected = true;
          }
          phaseSelect.appendChild(opt);
        });
      }

      const asTestBtn = document.createElement('button');
      asTestBtn.type = 'button';
      asTestBtn.className = 'btn btn-secondary btn-xs';
      const asTestTxt = document.createElement('span');
      asTestTxt.textContent = 'Add as Test';
      asTestBtn.appendChild(asTestTxt);
      asTestBtn.addEventListener('click', () => {
        const cleanItemText = (item.text || '').trim();
        if (!cleanItemText) {
          showNotification('Unclassified item text cannot be empty.', 'warning');
          input.focus();
          return;
        }
        let targetPhase = plan.phases.find(p => p.id === phaseSelect.value);
        if (!targetPhase) {
          targetPhase = createEmptyPhase({
            phaseLabel: 'Phase 1',
            phaseNumber: '1',
            name: 'General QA Checks'
          });
          plan.phases.push(targetPhase);
        }
        let targetSec = targetPhase.sections[targetPhase.sections.length - 1];
        if (!targetSec) {
          targetSec = { id: `sec_${Date.now()}`, type: 'direct', name: '', notes: [], tests: [] };
          targetPhase.sections.push(targetSec);
        }
        targetSec.tests.push(createEmptyTestItem({ text: cleanItemText }));
        plan.unclassified.splice(uIdx, 1);
        renderPreview();
      });

      const asPhaseBtn = document.createElement('button');
      asPhaseBtn.type = 'button';
      asPhaseBtn.className = 'btn btn-secondary btn-xs';
      const asPhaseTxt = document.createElement('span');
      asPhaseTxt.textContent = 'Make Phase';
      asPhaseBtn.appendChild(asPhaseTxt);
      asPhaseBtn.addEventListener('click', () => {
        const nextNum = plan.phases.length + 1;
        plan.phases.push(
          createEmptyPhase({
            phaseLabel: `Phase ${nextNum}`,
            phaseNumber: String(nextNum),
            name: (item.text || '').trim() || 'Untitled Phase'
          })
        );
        plan.unclassified.splice(uIdx, 1);
        renderPreview();
      });

      const asDescBtn = document.createElement('button');
      asDescBtn.type = 'button';
      asDescBtn.className = 'btn btn-ghost btn-xs';
      const asDescTxt = document.createElement('span');
      asDescTxt.textContent = 'Add to Description';
      asDescBtn.appendChild(asDescTxt);
      asDescBtn.addEventListener('click', () => {
        const cleanDesc = (item.text || '').trim();
        if (!cleanDesc) return;
        let targetPhase = plan.phases.find(p => p.id === phaseSelect.value);
        if (!targetPhase) {
          targetPhase = createEmptyPhase({
            phaseLabel: 'Phase 1',
            phaseNumber: '1',
            name: 'General QA Checks'
          });
          plan.phases.push(targetPhase);
        }
        targetPhase.description = targetPhase.description
          ? `${targetPhase.description}\n${cleanDesc}`
          : cleanDesc;
        plan.unclassified.splice(uIdx, 1);
        renderPreview();
      });

      const dismissBtn = document.createElement('button');
      dismissBtn.type = 'button';
      dismissBtn.className = 'qa-icon-action-btn qa-btn-danger-hover';
      dismissBtn.title = 'Dismiss unclassified line';
      dismissBtn.setAttribute('aria-label', 'Dismiss unclassified line');
      dismissBtn.appendChild(ICONS.trash());
      dismissBtn.addEventListener('click', () => {
        plan.unclassified.splice(uIdx, 1);
        renderPreview();
      });

      actionsRow.appendChild(phaseSelect);
      actionsRow.appendChild(asTestBtn);
      actionsRow.appendChild(asPhaseBtn);
      actionsRow.appendChild(asDescBtn);
      actionsRow.appendChild(dismissBtn);

      card.appendChild(topRow);
      card.appendChild(reasonRow);
      card.appendChild(actionsRow);
      els.unclassifiedList.appendChild(card);
    });
  }

  function renderPreview() {
    const plan = GeneratorState.parsedPlan;
    if (!plan) {
      if (els.previewSection) els.previewSection.style.display = 'none';
      return;
    }

    if (els.previewSection) els.previewSection.style.display = 'block';
    syncSummaryCounters();
    updateModeButtonsUI();
    renderDocumentMeta(plan);

    if (GeneratorState.previewMode === 'formatted') {
      renderFormattedPreview(plan);
    } else {
      renderEditablePreview(plan);
    }

    renderUnclassifiedSection(plan);
  }

  function handleGenerateChecklist() {
    const rawValue = els.textarea.value;
    const result = parseQAPlanText(rawValue);

    renderAlerts(result.messages);

    if (result.status === 'empty' || result.status === 'whitespace') {
      GeneratorState.parsedPlan = null;
      if (els.previewSection) els.previewSection.style.display = 'none';
      els.textarea.focus();
      return;
    }

    GeneratorState.parsedPlan = result;
    GeneratorState.lastStartedSignature = null;
    GeneratorState.lastStartedChecklistId = null;
    if (els.checklistTitleInput) {
      els.checklistTitleInput.value = deriveDefaultChecklistTitle(result);
    }
    renderPreview();

    if (els.previewSection) {
      els.previewSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function computeLaunchSignature(plan, customTitle) {
    const resolvedTitle = (customTitle || '').trim() || deriveDefaultChecklistTitle(plan);
    return JSON.stringify({
      title: resolvedTitle,
      documentNotes: (plan.documentNotes || []).map(n => ({ kind: n.kind, text: (n.text !== undefined && n.text !== null ? String(n.text) : '').trim() })),
      phases: (plan.phases || []).map(p => ({
        phaseLabel: (p.phaseLabel !== undefined && p.phaseLabel !== null ? String(p.phaseLabel) : '').trim(),
        phaseNumber: (p.phaseNumber !== undefined && p.phaseNumber !== null ? String(p.phaseNumber) : '').trim(),
        name: (p.name !== undefined && p.name !== null ? String(p.name) : '').trim(),
        description: (p.description !== undefined && p.description !== null ? String(p.description) : '').trim(),
        notes: (p.notes || []).map(n => ({ kind: n.kind, text: (n.text !== undefined && n.text !== null ? String(n.text) : '').trim() })),
        sections: (p.sections || []).map(s => ({
          type: s.type,
          name: (s.name !== undefined && s.name !== null ? String(s.name) : '').trim(),
          notes: (s.notes || []).map(n => ({ kind: n.kind, text: (n.text !== undefined && n.text !== null ? String(n.text) : '').trim() })),
          tests: (s.tests || [])
            .filter(t => t && (typeof t.text === 'string' ? t.text.trim().length > 0 : (t.text !== undefined && t.text !== null && String(t.text).trim().length > 0)))
            .map(t => ({
              testId: (t.testId !== undefined && t.testId !== null ? String(t.testId) : '').trim(),
              priority: (t.priority !== undefined && t.priority !== null ? String(t.priority) : '').trim(),
              text: String(t.text).trim()
            }))
        }))
      }))
    });
  }

  function handleStartTesting() {
    if (GeneratorState.isStarting) return;

    if (!GeneratorState.parsedPlan) {
      showNotification('Generate a QA checklist first before starting testing.', 'warning');
      return;
    }

    const customTitle = els.checklistTitleInput ? els.checklistTitleInput.value : '';
    const currentSignature = computeLaunchSignature(GeneratorState.parsedPlan, customTitle);

    // Prevent accidental duplicate checklist creation if this exact reviewed plan was already launched
    if (
      GeneratorState.lastStartedSignature === currentSignature &&
      GeneratorState.lastStartedChecklistId
    ) {
      const existing = getChecklistById(GeneratorState.lastStartedChecklistId);
      if (existing) {
        showNotification(`Opening "${existing.title}" in QA Test Runner.`, 'info');
        if (typeof onChecklistStarted === 'function') {
          onChecklistStarted(existing);
        }
        return;
      }
    }

    GeneratorState.isStarting = true;
    try {
      const creation = createChecklistFromParsedPlan(GeneratorState.parsedPlan, customTitle);

      if (!creation.ok || !creation.checklist) {
        const errText = creation.error || 'Please ensure your checklist has at least one test item.';
        renderAlerts([{ type: 'error', text: errText }]);
        showNotification(errText, 'warning');
        return;
      }

      GeneratorState.lastStartedSignature = currentSignature;
      GeneratorState.lastStartedChecklistId = creation.checklist.id;

      showNotification(`Saved "${creation.checklist.title}" — ready for manual testing.`, 'success');
      if (typeof onChecklistStarted === 'function') {
        onChecklistStarted(creation.checklist);
      }
    } finally {
      GeneratorState.isStarting = false;
    }
  }

  function handleClearText() {
    els.textarea.value = '';
    if (els.checklistTitleInput) {
      els.checklistTitleInput.value = '';
    }
    GeneratorState.parsedPlan = null;
    GeneratorState.lastStartedSignature = null;
    GeneratorState.lastStartedChecklistId = null;
    clearAlerts();
    if (els.previewSection) els.previewSection.style.display = 'none';
    updateInputLineStats();
    els.textarea.focus();
  }

  function handleAddPhase() {
    if (!GeneratorState.parsedPlan) return;
    const nextNum = GeneratorState.parsedPlan.phases.length;
    const newPhase = createEmptyPhase({
      phaseLabel: `Phase ${nextNum}`,
      phaseNumber: String(nextNum),
      name: 'New Testing Phase',
      description: '',
      sections: [
        {
          id: `sec_${Date.now()}`,
          type: 'direct',
          name: '',
          notes: [],
          tests: [createEmptyTestItem({ text: '' })]
        }
      ]
    });
    GeneratorState.parsedPlan.phases.push(newPhase);
    GeneratorState.previewMode = 'editable';
    renderPreview();
  }

  // Event Bindings
  els.textarea.addEventListener('input', updateInputLineStats);
  els.generateBtn.addEventListener('click', handleGenerateChecklist);
  if (els.clearBtn) {
    els.clearBtn.addEventListener('click', handleClearText);
  }
  if (els.loadSampleBtn) {
    els.loadSampleBtn.addEventListener('click', () => {
      els.textarea.value = SAMPLE_QA_PLAN;
      updateInputLineStats();
      handleGenerateChecklist();
      showNotification('Sample QA testing plan loaded and parsed.', 'success');
    });
  }

  if (els.modeEditableBtn) {
    els.modeEditableBtn.addEventListener('click', () => {
      GeneratorState.previewMode = 'editable';
      renderPreview();
    });
  }

  if (els.modeFormattedBtn) {
    els.modeFormattedBtn.addEventListener('click', () => {
      GeneratorState.previewMode = 'formatted';
      renderPreview();
    });
  }

  if (els.addPhaseTopBtn) {
    els.addPhaseTopBtn.addEventListener('click', handleAddPhase);
  }
  if (els.addPhaseBottomBtn) {
    els.addPhaseBottomBtn.addEventListener('click', handleAddPhase);
  }

  if (els.startTestingTopBtn) {
    els.startTestingTopBtn.addEventListener('click', handleStartTesting);
  }
  if (els.startTestingBottomBtn) {
    els.startTestingBottomBtn.addEventListener('click', handleStartTesting);
  }

  updateInputLineStats();
}
