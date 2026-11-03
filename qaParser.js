/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Generic Manual QA Plan Structural Parser
 * Pure ES6 module with zero external or AI dependencies.
 * Analyzes pasted plain-text or Markdown QA plans into Phases, Descriptions,
 * Categories, Individual Tests, Supporting Notes, and Unclassified items.
 */

let idCounter = 1;

function nextId(prefix) {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

export function createEmptyTestItem(overrides = {}) {
  return {
    id: nextId('test'),
    testId: '',
    priority: '',
    text: '',
    rawLine: '',
    lineNumber: 0,
    ...overrides
  };
}

export function createEmptyCategorySection(overrides = {}) {
  return {
    id: nextId('sec'),
    type: 'category',
    name: 'New Category',
    notes: [],
    tests: [],
    ...overrides
  };
}

export function createEmptyPhase(overrides = {}) {
  return {
    id: nextId('phase'),
    phaseLabel: 'Phase',
    phaseNumber: '',
    name: 'Untitled Phase',
    isImplicit: false,
    description: '',
    notes: [],
    sections: [],
    ...overrides
  };
}

export function formatPhaseHeading(phase) {
  if (!phase) return 'Untitled Phase';
  const label = typeof phase.phaseLabel === 'string'
    ? phase.phaseLabel.trim()
    : (phase.phaseLabel !== undefined && phase.phaseLabel !== null ? String(phase.phaseLabel).trim() : '');
  const name = typeof phase.name === 'string'
    ? phase.name.trim()
    : (phase.name !== undefined && phase.name !== null ? String(phase.name).trim() : '');
  if (label !== '' && name !== '') {
    return `${label} — ${name}`;
  }
  if (label !== '') return label;
  if (name !== '') return name;
  return 'Untitled Phase';
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

export function computeChecklistSummary(plan) {
  if (!plan || !Array.isArray(plan.phases)) {
    return {
      phaseCount: 0,
      categoryCount: 0,
      testCount: 0,
      noteCount: 0,
      unclassifiedCount: 0
    };
  }

  let categoryCount = 0;
  let testCount = 0;
  let noteCount = Array.isArray(plan.documentNotes) ? plan.documentNotes.length : 0;

  for (const phase of plan.phases) {
    if (Array.isArray(phase.notes)) {
      noteCount += phase.notes.length;
    }
    if (Array.isArray(phase.sections)) {
      for (const sec of phase.sections) {
        if (sec.type === 'category') {
          categoryCount += 1;
        }
        if (Array.isArray(sec.notes)) {
          noteCount += sec.notes.length;
        }
        if (Array.isArray(sec.tests)) {
          for (const t of sec.tests) {
            if (t && typeof t.text === 'string' && t.text.trim().length > 0) {
              testCount += 1;
            }
          }
        }
      }
    }
  }

  return {
    phaseCount: plan.phases.length,
    categoryCount,
    testCount,
    noteCount,
    unclassifiedCount: Array.isArray(plan.unclassified) ? plan.unclassified.length : 0
  };
}

// ============================================================================
// Pattern Definitions
// ============================================================================

// Pure decorative dividers (horizontal rules, ASCII borders)
const DIVIDER_RE = /^\s*(?:[-*_~=─━═┄┈]{3,})\s*$/;

// Leading decorative emojis/icons often placed in front of headings (excluding ☐/☑/✓ checkboxes on plain lines unless followed by Phase)
const LEADING_HEADING_DECORATION_RE = /^(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}✅🚀🧪📋🔍🛡️⚡🎯📌🔹🔸▶️]+\s*)+/u;

// Explicit Phase keywords:
// e.g. "PHASE 0 — Clean Test Environment", "Phase 1: Authentication", "## Phase 2 — Chat",
// "Testing Phase 3: Payment", "Phase #1: Setup", "[Phase 2] Dashboard", "Phase One — Intro"
const WORD_NUMBERS =
  'zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty';
const EXPLICIT_PHASE_RE = new RegExp(
  `^\\[?((?:testing\\s+phase|test\\s+phase|qa\\s+phase|phase|stage)\\s+#?(?:${WORD_NUMBERS}|[0-9]+(?:\\.[0-9]+)*|[IVXLC]{2,}|[A-Z]))\\]?(?:\\s*(?:[—–\\-:|•.]|\\)\\s*)\\s*(.*)|\\s+(.+))?$`,
  'i'
);

// Final regression / release / sign-off checklist top-level sections
const FINAL_CHECKLIST_PHASE_RE = /^(?:final\s+(?:regression|release|qa|testing|smoke|verification|launch|sign-off)?(?:\s*(?:and|&|\/)\s*(?:regression|release|qa|smoke|launch|sign-off))?\s*(?:checklist|checks|verification|phase|readiness|sign-off)|(?:pre-release|release|regression|production\s+readiness|launch\s+readiness)\s+(?:qa\s+|testing\s+)?checklist)\s*:?$/i;

// Description prefixes
const DESCRIPTION_PREFIX_RE = /^(?:phase\s+description|description|objective|goal|purpose|overview|summary)\s*:\s*(.+)$/i;
const DESCRIPTION_HEADER_ONLY_RE = /^(?:phase\s+description|description|objective|goal|purpose|overview|summary)\s*:$/i;

// Environment & setup metadata lines
const ENVIRONMENT_LINE_RE = /^(?:test\s+environment|environment|env|base\s+url|test\s+url|staging\s+url|app\s+url|url|endpoint|browsers?|devices?|operating\s+system|os|platform|build(?:\s+version)?|version|test\s+accounts?|accounts?|credentials?|test\s+users?)\s*:\s*(.+)$/i;

// Instruction / Precondition / Note lines
const INSTRUCTION_LINE_RE = /^(?:testing\s+instructions?|instructions?|pre-?conditions?|prerequisites?|setup\s+notes?|important|note|notes|tip|warning|caution|reminder|scope)\s*:\s*(.+)$/i;
const INSTRUCTION_HEADER_ONLY_RE = /^(?:testing\s+instructions?|instructions?|pre-?conditions?|prerequisites?|setup\s+notes?|notes?)\s*:$/i;

// Checkbox markers at start of a test line
const CHECKBOX_TEST_RE = /^(?:[-*•◦▪▸+]\s+)?(?:\[\s*[xX✓✔\- ]?\s*\]|[☐☑☒✓✔])\s+(.+)$/u;

// Bullet markers at start of a test line
const BULLET_TEST_RE = /^(?:[-*•◦▪▫▸▹►‣⁃→⇒➢➤+]|[–—](?=\s+\S))\s+(.+)$/u;

// Existing Test ID formats:
// "TEST-001 — Verify authentication."
// "AUTH-001: Verify login functionality."
// "API-001 [HIGH]: Verify successful response."
// "[TC-104] Check dashboard"
// "E2E_02 - Complete checkout"
const BRACKETED_TEST_ID_RE = /^\[([A-Za-z][A-Za-z0-9_]{0,14}[-_]\d{1,6})\]\s*(?:[:—–\-]\s*)?(.+)$/;
const INLINE_TEST_ID_WITH_PRIO_RE = /^([A-Za-z][A-Za-z0-9_]{1,14}[-_]\d{1,6})\s+(?:\[\s*(?:priority\s*:\s*)?(critical|high|medium|low|blocker|urgent|p[0-4])\s*\]|\(\s*(?:priority\s*:\s*)?(critical|high|medium|low|blocker|urgent|p[0-4])\s*\))\s*(?:[:—–\-]\s*)?(.+)$/i;
const INLINE_TEST_ID_RE = /^([A-Za-z][A-Za-z0-9_]{1,14}[-_]\d{1,6})\s*(?:[:—–]|\s+-\s+)\s*(.+)$/;

// Numbered line: "1. Test valid credentials." or "0. Environment Setup" or "2) Verify logout"
const NUMBERED_LINE_RE = /^(?:\((\d+)\)|(\d+)[.)])\s+(.+)$/;

// Lettered bullet list markers:
// "a) First test case", "a. Second test case", "(a) Third scenario",
// "A) First requirement", "A. Second requirement", "(A) Third scenario",
// with optional markdown bold/italic on the marker: "**a)**", "*a)*", "*A.*", etc.
export const LETTERED_BULLET_RE = /^(?:\*{1,2}|_{1,2})?(?:\(([a-zA-Z])\)|([a-zA-Z])([.)]))(?:\*{1,2}|_{1,2})?(?:\s*[:—–\-]\s*|\s+)(.+)$/;

export function isLetteredBulletLine(trimmed) {
  if (!trimmed || typeof trimmed !== 'string') return false;
  const m = trimmed.match(LETTERED_BULLET_RE);
  if (!m) return false;

  const letter = (m[1] || m[2] || '').toLowerCase();
  const delim = m[1] ? '()' : (m[3] || '');
  const body = (m[4] || '').trim();

  if (!body) return false;

  // Distinguish valid letter markers from false positives:
  // 1. Parenthesized markers "(a)" or ")" like "a)" / "A)" are unequivocally list markers.
  if (delim === '()' || delim === ')') {
    return true;
  }

  // 2. Delimiter is period ".": e.g. "a. First test", "A. First requirement"
  // Exclude circa dates: "c. 1920"
  if (letter === 'c' && /^\d{4}\b/.test(body)) {
    return false;
  }
  // Exclude page numbers: "p. 42", "p. 100"
  if (letter === 'p' && /^\d+\b/.test(body)) {
    return false;
  }
  // Exclude citation abbreviations like "v. Smith" (versus) if short proper noun
  if (letter === 'v' && /^[A-Z][a-z]+\b/.test(body) && body.split(/\s+/).length <= 3) {
    return false;
  }

  // Exclude single-letter initials in narrative prose:
  // e.g. "A. Johnson conducted preliminary testing."
  if (/^[A-Z][a-z]+\s+(?:was|were|reported|stated|said|wrote|noted|conducted|performed|attended|agreed|suggested)\b/i.test(body)) {
    return false;
  }

  return true;
}

// Decimal sub-section category: "1.1 Login Flow", "2.3 Edge Cases"
const DECIMAL_SUBHEADING_RE = /^(\d+\.\d+(?:\.\d+)?)\s*(?:[:—–\-.)]\s*)?(.+)$/;

// Priority tags inside test items: "[Critical]", "(High)", "[P1]", "(Priority: Medium)"
const LEADING_PRIORITY_RE = /^(?:\[\s*(?:priority\s*:\s*)?(critical|high|medium|low|blocker|urgent|p[0-4])\s*\]|\(\s*(?:priority\s*:\s*)?(critical|high|medium|low|blocker|urgent|p[0-4])\s*\))\s*(?:[:—–\-]\s*)?(.+)$/i;
const TRAILING_PRIORITY_RE = /^(.+?)\s+(?:\[\s*(?:priority\s*:\s*)?(critical|high|medium|low|blocker|urgent|p[0-4])\s*\]|\(\s*(?:priority\s*:\s*)?(critical|high|medium|low|blocker|urgent|p[0-4])\s*\))\.?$/i;

// Imperative test-case starter verbs (helps distinguish numbered test items from numbered section titles)
const TEST_ACTION_VERB_RE = /^(?:verify|test|check|ensure|confirm|validate|assert|open|click|tap|press|enter|type|input|submit|select|choose|toggle|upload|download|drag|drop|navigate|go\s+to|visit|log\s*in|log\s*out|sign\s*in|sign\s*out|sign\s*up|register|create|add|edit|update|modify|delete|remove|attempt|try|refresh|reload|resize|inspect|scroll|search|filter|sort)\b/i;

// Helper to clean outer Markdown bold/italic/banner wrappers on headings
function stripMarkdownFormatting(str) {
  let s = str.trim();
  // Strip outer === Heading === or --- Heading --- decorative banners
  const bannerMatch = s.match(/^(?:={2,}|-{2,}|~{2,})\s*(.+?)\s*(?:={2,}|-{2,}|~{2,})$/);
  if (bannerMatch) {
    s = bannerMatch[1].trim();
  }
  // Strip trailing Markdown hash markers e.g. "## Heading ##"
  s = s.replace(/\s+#+\s*$/, '');
  // Strip outer **bold** or __bold__
  if ((s.startsWith('**') && s.endsWith('**') && s.length > 4) ||
      (s.startsWith('__') && s.endsWith('__') && s.length > 4)) {
    s = s.slice(2, -2).trim();
  }
  return s;
}

function parseMarkdownHeading(trimmedLine) {
  const m = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
  if (!m) return null;
  return {
    level: m[1].length,
    text: stripMarkdownFormatting(m[2])
  };
}

function extractTestIdAndPriority(rawTestBody) {
  let working = rawTestBody.trim();
  let testId = '';
  let priority = '';
  let letterPrefix = '';

  // Check if line begins with a lettered bullet marker: preserve marker while allowing ID/priority extraction
  const letterMatch = working.match(LETTERED_BULLET_RE);
  if (letterMatch && isLetteredBulletLine(working)) {
    const rawMatch = letterMatch[0];
    const markerBody = letterMatch[4];
    const markerLength = rawMatch.length - markerBody.length;
    letterPrefix = rawMatch.slice(0, markerLength).trim().replace(/[:—–\-]$/, '').trim();
    working = markerBody.trim();
  }

  // 1. Check leading priority before Test ID e.g. "[Critical] AUTH-001: Verify login"
  const leadPrio1 = working.match(LEADING_PRIORITY_RE);
  if (leadPrio1) {
    priority = normalizePriorityLabel(leadPrio1[1] || leadPrio1[2]);
    working = leadPrio1[3].trim();
  }

  // 2. Check bracketed or inline Test ID (including Test ID + [Priority]: Text)
  const bracketId = working.match(BRACKETED_TEST_ID_RE);
  if (bracketId) {
    testId = bracketId[1].trim();
    working = bracketId[2].trim();
  } else {
    const inlineWithPrio = working.match(INLINE_TEST_ID_WITH_PRIO_RE);
    if (inlineWithPrio) {
      testId = inlineWithPrio[1].trim();
      if (!priority) {
        priority = normalizePriorityLabel(inlineWithPrio[2] || inlineWithPrio[3]);
      }
      working = inlineWithPrio[4].trim();
    } else {
      const inlineId = working.match(INLINE_TEST_ID_RE);
      if (inlineId) {
        testId = inlineId[1].trim();
        working = inlineId[2].trim();
      }
    }
  }

  // 3. Check leading priority right after Test ID e.g. "AUTH-001: [High] Verify login"
  if (!priority) {
    const leadPrio2 = working.match(LEADING_PRIORITY_RE);
    if (leadPrio2) {
      priority = normalizePriorityLabel(leadPrio2[1] || leadPrio2[2]);
      working = leadPrio2[3].trim();
    }
  }

  // 4. Check trailing priority e.g. "Verify login functionality [High]"
  if (!priority) {
    const trailPrio = working.match(TRAILING_PRIORITY_RE);
    if (trailPrio) {
      priority = normalizePriorityLabel(trailPrio[2] || trailPrio[3]);
      working = trailPrio[1].trim();
    }
  }

  const finalBody = working || rawTestBody.trim();
  const preservedText = letterPrefix ? `${letterPrefix} ${finalBody}` : finalBody;

  return {
    testId,
    priority,
    text: preservedText
  };
}

function normalizePriorityLabel(raw) {
  if (!raw) return '';
  const upper = raw.trim().toUpperCase();
  if (/^P[0-4]$/.test(upper)) return upper;
  return raw.trim().charAt(0).toUpperCase() + raw.trim().slice(1).toLowerCase();
}

/**
 * Checks whether a cleaned text string matches an explicit Phase heading
 * (e.g. "PHASE 0 — Clean Test Environment", "Phase 1: Auth", "Testing Phase 3: Payment",
 * or "Final Regression & Release Checklist").
 */
function matchExplicitPhaseText(text) {
  const cleaned = stripMarkdownFormatting(text);
  const withoutDecor = cleaned.replace(LEADING_HEADING_DECORATION_RE, '').trim();

  const expMatch = withoutDecor.match(EXPLICIT_PHASE_RE);
  if (expMatch) {
    const rawLabel = expMatch[1].replace(/\s+/g, ' ').trim();
    const idTokenMatch = rawLabel.match(/\s+#?([^\s#]+)$/);
    const phaseNumber = idTokenMatch ? idTokenMatch[1].trim() : '';
    const phaseName = stripMarkdownFormatting(expMatch[2] || expMatch[3] || '').replace(/^[:—–\-]\s*/, '').trim();
    return {
      phaseLabel: rawLabel,
      phaseNumber,
      name: phaseName || 'Untitled Phase',
      isFinalChecklist: false
    };
  }

  if (FINAL_CHECKLIST_PHASE_RE.test(withoutDecor)) {
    const cleanName = withoutDecor.replace(/:\s*$/, '').trim();
    return {
      phaseLabel: '',
      phaseNumber: '',
      name: cleanName,
      isFinalChecklist: true
    };
  }

  return null;
}

/**
 * Quick test to see if a line is an obvious test item (checkbox, bullet, or Test ID).
 */
function isObviousChildTestLine(trimmed) {
  if (!trimmed) return false;
  if (CHECKBOX_TEST_RE.test(trimmed)) return true;
  if (BULLET_TEST_RE.test(trimmed)) return true;
  if (BRACKETED_TEST_ID_RE.test(trimmed)) return true;
  if (INLINE_TEST_ID_WITH_PRIO_RE.test(trimmed)) return true;
  if (INLINE_TEST_ID_RE.test(trimmed)) return true;
  if (isLetteredBulletLine(trimmed)) return true;
  return false;
}

/**
 * Quick test to see if a line is a category-like colon header or markdown subheading.
 */
function isCategoryCandidateLine(trimmed) {
  if (!trimmed || trimmed.length > 90) return false;
  if (trimmed.startsWith('###') || trimmed.startsWith('####')) return true;
  if (DECIMAL_SUBHEADING_RE.test(trimmed)) return true;
  if (
    trimmed.endsWith(':') &&
    !DESCRIPTION_PREFIX_RE.test(trimmed) &&
    !DESCRIPTION_HEADER_ONLY_RE.test(trimmed) &&
    !ENVIRONMENT_LINE_RE.test(trimmed) &&
    !INSTRUCTION_LINE_RE.test(trimmed) &&
    !INSTRUCTION_HEADER_ONLY_RE.test(trimmed) &&
    !INLINE_TEST_ID_WITH_PRIO_RE.test(trimmed) &&
    !INLINE_TEST_ID_RE.test(trimmed)
  ) {
    return true;
  }
  return false;
}

/**
 * Determines whether an unindented numbered line like "0. Environment Setup"
 * is a Phase Heading rather than a numbered Test Case like "1. Test valid credentials."
 */
function detectNumberedPhaseIndices(linesMeta) {
  const numberedPhaseSet = new Set();
  const candidates = [];

  for (let i = 0; i < linesMeta.length; i += 1) {
    const meta = linesMeta[i];
    if (meta.isEmpty || meta.isDivider) continue;

    // Allow either plain unindented "0. Environment Setup" or Markdown "## 0. Environment Setup"
    const sourceText = meta.md ? meta.md.text : (meta.indent <= 1 ? stripMarkdownFormatting(meta.trimmed) : '');
    if (!sourceText) continue;

    const cleanNoEmoji = sourceText.replace(LEADING_HEADING_DECORATION_RE, '').trim();
    if (matchExplicitPhaseText(cleanNoEmoji)) continue;

    const numMatch = cleanNoEmoji.match(/^(\d+(?:\.\d+)*)[.)]?\s+(.+)$/);
    if (!numMatch) continue;

    const num = parseFloat(numMatch[1]);
    const title = stripMarkdownFormatting(numMatch[2]).trim();

    if (!title || title.length > 100) continue;
    // Exclude Test IDs after numbers e.g. "1. AUTH-001: Verify login"
    if (BRACKETED_TEST_ID_RE.test(title) || INLINE_TEST_ID_RE.test(title)) continue;
    // Exclude checkbox items e.g. "1. [ ] Verify login"
    if (CHECKBOX_TEST_RE.test(title)) continue;

    // If it's a top-level Markdown heading like "## 0. Environment Setup" or "# 1. Login", strong phase signal
    if (meta.md && meta.md.level <= 2) {
      numberedPhaseSet.add(i);
      candidates.push({ index: i, num, title, confirmed: true });
      continue;
    }

    // Must be preceded by start-of-doc, blank line, or divider to be a section heading
    const prevLine = i > 0 ? linesMeta[i - 1] : null;
    const precededByBreak = !prevLine || prevLine.isEmpty || prevLine.isDivider;
    if (!precededByBreak) continue;

    // Look ahead until next unindented peer number (num + 1), explicit phase, or EOF
    let hasChildTestsOrCategories = false;
    let restartsNumberingInside = false;
    let immediatePeerNext = false;
    let nonBlankSeen = 0;

    for (let j = i + 1; j < linesMeta.length; j += 1) {
      const next = linesMeta[j];
      if (next.isEmpty || next.isDivider) continue;

      const nextText = next.md ? next.md.text : next.trimmed;
      if (matchExplicitPhaseText(nextText)) break;
      if (next.md && next.md.level <= 2) break;

      const nextNumMatch = next.indent <= 1 ? next.trimmed.match(/^(\d+(?:\.\d+)*)[.)]?\s+(.+)$/) : null;
      if (nextNumMatch) {
        const nextNum = parseFloat(nextNumMatch[1]);
        if (!Number.isNaN(nextNum) && !Number.isNaN(num)) {
          if (nextNum > num && nextNum <= num + 1) {
            if (nonBlankSeen === 0) {
              immediatePeerNext = true;
            }
            break;
          }
          if (nextNum === 1 && num >= 1) {
            restartsNumberingInside = true;
            hasChildTestsOrCategories = true;
            break;
          }
        }
      }

      nonBlankSeen += 1;
      if (isObviousChildTestLine(next.trimmed) || isCategoryCandidateLine(next.trimmed)) {
        hasChildTestsOrCategories = true;
      }
    }

    // Avoid treating a sentence-like imperative test step as a phase unless it clearly parents nested children
    const looksLikeTestSentence =
      (title.endsWith('.') && TEST_ACTION_VERB_RE.test(title)) ||
      (immediatePeerNext && TEST_ACTION_VERB_RE.test(title));

    if (!looksLikeTestSentence && (hasChildTestsOrCategories || restartsNumberingInside || (num === 0 && !immediatePeerNext))) {
      numberedPhaseSet.add(i);
      candidates.push({ index: i, num, title, confirmed: true });
    } else {
      candidates.push({ index: i, num, title, confirmed: false, immediatePeerNext, looksLikeTestSentence });
    }
  }

  // Second pass over candidates: support empty numbered phases (e.g. "2. TBD Phase" with no tests yet)
  // when surrounded by confirmed numbered phases (e.g. 1. ... and 3. ...)
  for (let c = 0; c < candidates.length; c += 1) {
    const item = candidates[c];
    if (item.confirmed || item.looksLikeTestSentence) continue;
    const prevConfirmed = c > 0 && candidates[c - 1].confirmed && candidates[c - 1].num < item.num;
    const nextConfirmed = c + 1 < candidates.length && candidates[c + 1].confirmed && candidates[c + 1].num > item.num;
    if (prevConfirmed || nextConfirmed) {
      numberedPhaseSet.add(item.index);
      item.confirmed = true;
    }
  }

  return numberedPhaseSet;
}

/**
 * Main Reusable Parser Entry Point
 * @param {string} rawInput
 */
export function parseQAPlanText(rawInput) {
  if (rawInput === null || rawInput === undefined || typeof rawInput !== 'string') {
    return {
      status: 'empty',
      messages: [
        {
          type: 'warning',
          text: 'Please paste a manual QA testing plan before generating a checklist.'
        }
      ],
      documentTitle: '',
      documentNotes: [],
      phases: [],
      unclassified: [],
      stats: {
        totalLines: 0,
        nonEmptyLines: 0,
        phaseCount: 0,
        explicitPhaseCount: 0,
        categoryCount: 0,
        testCount: 0,
        noteCount: 0,
        unclassifiedCount: 0,
        duplicatesSkipped: 0
      }
    };
  }

  const normalizedText = rawInput
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');

  if (normalizedText.length === 0) {
    return {
      status: 'empty',
      messages: [
        {
          type: 'warning',
          text: 'The text area is empty. Paste a manual testing plan to generate your QA checklist.'
        }
      ],
      documentTitle: '',
      documentNotes: [],
      phases: [],
      unclassified: [],
      stats: {
        totalLines: 0,
        nonEmptyLines: 0,
        phaseCount: 0,
        explicitPhaseCount: 0,
        categoryCount: 0,
        testCount: 0,
        noteCount: 0,
        unclassifiedCount: 0,
        duplicatesSkipped: 0
      }
    };
  }

  if (normalizedText.trim().length === 0) {
    return {
      status: 'whitespace',
      messages: [
        {
          type: 'warning',
          text: 'The input contains only whitespace or blank lines. Paste your QA plan content to generate a checklist.'
        }
      ],
      documentTitle: '',
      documentNotes: [],
      phases: [],
      unclassified: [],
      stats: {
        totalLines: normalizedText.split('\n').length,
        nonEmptyLines: 0,
        phaseCount: 0,
        explicitPhaseCount: 0,
        categoryCount: 0,
        testCount: 0,
        noteCount: 0,
        unclassifiedCount: 0,
        duplicatesSkipped: 0
      }
    };
  }

  const rawLines = normalizedText.split('\n');

  // Pre-compute line metadata in O(N)
  const linesMeta = rawLines.map((raw, idx) => {
    const expandedIndent = raw.replace(/\t/g, '  ');
    const indentMatch = expandedIndent.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    const trimmed = raw.trim();
    const isEmpty = trimmed.length === 0;
    const isDivider = !isEmpty && DIVIDER_RE.test(trimmed);
    const md = !isEmpty && !isDivider ? parseMarkdownHeading(trimmed) : null;
    return {
      lineNumber: idx + 1,
      raw,
      trimmed,
      indent,
      isEmpty,
      isDivider,
      md
    };
  });

  const nonEmptyLines = linesMeta.filter(l => !l.isEmpty && !l.isDivider).length;

  // ==========================================================================
  // Pass 1: Document-Level Structure Discovery
  // ==========================================================================
  let hasExplicitKeywordPhases = false;
  const numberedPhaseIndices = detectNumberedPhaseIndices(linesMeta);

  const mdCounts = { 1: 0, 2: 0, 3: 0 };
  for (const meta of linesMeta) {
    if (meta.isEmpty || meta.isDivider) continue;
    const candidateText = meta.md ? meta.md.text : meta.trimmed;
    if (meta.indent <= 2 && matchExplicitPhaseText(candidateText)) {
      hasExplicitKeywordPhases = true;
    }
    if (meta.md && meta.md.level <= 3) {
      mdCounts[meta.md.level] += 1;
    }
  }

  // If no explicit "Phase X" or numbered "0. Setup" phases exist, check if Markdown H2 (or H1) headings define phases
  let markdownPhaseLevel = 0;
  if (!hasExplicitKeywordPhases && numberedPhaseIndices.size === 0) {
    if (mdCounts[2] >= 1) {
      markdownPhaseLevel = 2;
    } else if (mdCounts[1] >= 2) {
      markdownPhaseLevel = 1;
    }
  }

  // Helper to check if line i is a Phase Heading
  function parsePhaseHeadingAt(i) {
    const meta = linesMeta[i];
    if (meta.isEmpty || meta.isDivider) return null;

    // 1. Explicit Phase ("PHASE 0 — ...", "## Phase 2 — ...", "Testing Phase 3: ...", "Final Release Checklist")
    if (meta.md || meta.indent <= 2) {
      const targetText = meta.md ? meta.md.text : meta.trimmed;
      const exp = matchExplicitPhaseText(targetText);
      if (exp) {
        return exp;
      }
    }

    // 2. Structural Numbered Phase ("0. Environment Setup", "## 1. Authentication")
    if (numberedPhaseIndices.has(i)) {
      const sourceText = meta.md ? meta.md.text : stripMarkdownFormatting(meta.trimmed);
      const cleanNoEmoji = sourceText.replace(LEADING_HEADING_DECORATION_RE, '').trim();
      const m = cleanNoEmoji.match(/^(\d+(?:\.\d+)*)[.)]?\s+(.+)$/);
      if (m) {
        return {
          phaseLabel: `Phase ${m[1]}`,
          phaseNumber: m[1],
          name: stripMarkdownFormatting(m[2]).replace(/:\s*$/, '').trim() || 'Untitled Phase',
          isFinalChecklist: false
        };
      }
    }

    // 3. Markdown Section Phases (when document uses ## Section headings without "Phase" keyword)
    if (markdownPhaseLevel > 0 && meta.md && meta.md.level === markdownPhaseLevel) {
      const headingName = meta.md.text.replace(LEADING_HEADING_DECORATION_RE, '').replace(/:\s*$/, '').trim();
      if (headingName) {
        return {
          phaseLabel: '',
          phaseNumber: '',
          name: headingName,
          isFinalChecklist: false
        };
      }
    }

    return null;
  }

  // Pre-compute phase headings per line in O(N) so Pass 2 never rescans
  const phaseHeadingsByLine = new Array(linesMeta.length);
  let lastPhaseLineIndex = -1;
  for (let idx = 0; idx < linesMeta.length; idx += 1) {
    const ph = parsePhaseHeadingAt(idx);
    phaseHeadingsByLine[idx] = ph;
    if (ph !== null) {
      lastPhaseLineIndex = idx;
    }
  }

  function findNextNonEmptyLine(startIndex) {
    for (let k = startIndex; k < linesMeta.length; k += 1) {
      if (!linesMeta[k].isEmpty && !linesMeta[k].isDivider) {
        return linesMeta[k];
      }
    }
    return null;
  }

  // ==========================================================================
  // Pass 2: Sequential Structural Extraction
  // ==========================================================================
  let documentTitle = '';
  const documentNotes = [];
  const phases = [];
  const unclassified = [];
  let duplicatesSkipped = 0;

  let currentPhase = null;
  let currentCategorySection = null;
  let phaseHasStartedBodyItems = false; // True once a category or test has appeared in currentPhase
  let pendingInstructionHeaderMode = false;
  let pendingDescriptionHeaderMode = false;
  let lastAddedTest = null;

  // Track duplicate tests per (phaseId + sectionName) and duplicate explicit testIds
  const seenTestsInSection = new Map();
  const seenExplicitTestIdText = new Set();

  function ensureImplicitPhase() {
    if (!currentPhase) {
      currentPhase = createEmptyPhase({
        phaseLabel: '',
        phaseNumber: '',
        name: 'General QA Checklist',
        isImplicit: true
      });
      phases.push(currentPhase);
      currentCategorySection = null;
      phaseHasStartedBodyItems = false;
    }
    return currentPhase;
  }

  function getActiveTestSection(phase) {
    if (currentCategorySection) {
      return currentCategorySection;
    }
    const lastSec = phase.sections[phase.sections.length - 1];
    if (lastSec && lastSec.type === 'direct') {
      return lastSec;
    }
    const directSec = {
      id: nextId('sec'),
      type: 'direct',
      name: '',
      notes: [],
      tests: []
    };
    phase.sections.push(directSec);
    return directSec;
  }

  function addTestToCurrentContext(rawBody, meta, fallbackTestId = '') {
    const phase = ensureImplicitPhase();
    phaseHasStartedBodyItems = true;
    pendingInstructionHeaderMode = false;
    pendingDescriptionHeaderMode = false;

    const extracted = extractTestIdAndPriority(rawBody);
    const effectiveTestId = (extracted.testId !== undefined && extracted.testId !== null && String(extracted.testId).trim() !== '')
      ? String(extracted.testId)
      : fallbackTestId;
    const cleanText = extracted.text.trim();
    if (!cleanText) return;

    const targetSection = getActiveTestSection(phase);
    const sectionKey = `${phase.id}::${targetSection.type === 'category' ? targetSection.name.toLowerCase() : '__direct__'}`;
    const normalizedTestFingerprint = `${effectiveTestId.toLowerCase()}::${cleanText.toLowerCase().replace(/\s+/g, ' ')}`;

    if (!seenTestsInSection.has(sectionKey)) {
      seenTestsInSection.set(sectionKey, new Set());
    }
    const sectionSet = seenTestsInSection.get(sectionKey);

    if (sectionSet.has(normalizedTestFingerprint)) {
      duplicatesSkipped += 1;
      lastAddedTest = null;
      return;
    }

    if (extracted.testId) {
      const globalIdKey = `${extracted.testId.toLowerCase()}::${cleanText.toLowerCase().replace(/\s+/g, ' ')}`;
      if (seenExplicitTestIdText.has(globalIdKey)) {
        duplicatesSkipped += 1;
        lastAddedTest = null;
        return;
      }
      seenExplicitTestIdText.add(globalIdKey);
    }

    sectionSet.add(normalizedTestFingerprint);

    const testItem = createEmptyTestItem({
      testId: effectiveTestId,
      priority: extracted.priority,
      text: cleanText,
      rawLine: meta.trimmed,
      lineNumber: meta.lineNumber
    });

    targetSection.tests.push(testItem);
    lastAddedTest = testItem;
  }

  function addCategoryToCurrentContext(categoryName) {
    const cleanCat = stripMarkdownFormatting(categoryName)
      .replace(/:\s*$/, '')
      .trim();
    if (!cleanCat) return;

    const phase = ensureImplicitPhase();
    phaseHasStartedBodyItems = true;
    pendingInstructionHeaderMode = false;
    pendingDescriptionHeaderMode = false;
    lastAddedTest = null;

    // If the immediately preceding section is the exact same empty category, reuse it
    const prevSec = phase.sections[phase.sections.length - 1];
    if (prevSec && prevSec.type === 'category' && prevSec.name.toLowerCase() === cleanCat.toLowerCase()) {
      currentCategorySection = prevSec;
      return;
    }

    const catSec = createEmptyCategorySection({
      name: cleanCat
    });
    phase.sections.push(catSec);
    currentCategorySection = catSec;
  }

  function appendPhaseDescription(phase, textSegment) {
    const clean = textSegment.trim();
    if (!clean) return;
    if (phase.description) {
      phase.description = `${phase.description}\n${clean}`;
    } else {
      phase.description = clean;
    }
  }

  function addSupportingNote(kind, text, lineNumber) {
    const clean = text.trim();
    if (!clean) return;
    const noteObj = {
      id: nextId('note'),
      kind,
      text: clean,
      lineNumber
    };
    if (!currentPhase) {
      documentNotes.push(noteObj);
    } else if (currentCategorySection) {
      currentCategorySection.notes.push(noteObj);
    } else {
      currentPhase.notes.push(noteObj);
    }
  }

  for (let i = 0; i < linesMeta.length; i += 1) {
    const meta = linesMeta[i];

    if (meta.isEmpty || meta.isDivider) {
      lastAddedTest = null;
      pendingDescriptionHeaderMode = false;
      pendingInstructionHeaderMode = false;
      continue;
    }

    // 1. Check Phase Heading
    const phaseMatch = phaseHeadingsByLine[i];
    if (phaseMatch) {
      currentPhase = createEmptyPhase({
        phaseLabel: phaseMatch.phaseLabel,
        phaseNumber: phaseMatch.phaseNumber,
        name: phaseMatch.name,
        isImplicit: false
      });
      phases.push(currentPhase);
      currentCategorySection = null;
      phaseHasStartedBodyItems = false;
      pendingInstructionHeaderMode = false;
      pendingDescriptionHeaderMode = false;
      lastAddedTest = null;
      continue;
    }

    // 2. Document Title before any Phase (e.g. "# App Manual QA Testing Plan")
    if (!currentPhase && !documentTitle && meta.md && meta.md.level === 1) {
      documentTitle = meta.md.text;
      lastAddedTest = null;
      continue;
    }

    // 3. Explicit Description Prefix ("Description: Prepare the application...")
    const descPrefixMatch = meta.trimmed.match(DESCRIPTION_PREFIX_RE);
    if (descPrefixMatch) {
      lastAddedTest = null;
      if (currentPhase && !phaseHasStartedBodyItems) {
        appendPhaseDescription(currentPhase, descPrefixMatch[1]);
      } else {
        addSupportingNote('note', meta.trimmed, meta.lineNumber);
      }
      continue;
    }

    if (DESCRIPTION_HEADER_ONLY_RE.test(meta.trimmed)) {
      lastAddedTest = null;
      pendingDescriptionHeaderMode = true;
      pendingInstructionHeaderMode = false;
      continue;
    }

    // 4. Environment & Setup Metadata ("Environment: Staging Chrome 124", "URL: https://...")
    if (ENVIRONMENT_LINE_RE.test(meta.trimmed)) {
      lastAddedTest = null;
      addSupportingNote('environment', meta.trimmed, meta.lineNumber);
      continue;
    }

    // 5. Explicit Instructions / Preconditions / Notes ("Note: Use test account", "Preconditions: ...")
    if (INSTRUCTION_LINE_RE.test(meta.trimmed)) {
      lastAddedTest = null;
      addSupportingNote('instruction', meta.trimmed, meta.lineNumber);
      continue;
    }

    if (INSTRUCTION_HEADER_ONLY_RE.test(meta.trimmed)) {
      lastAddedTest = null;
      pendingInstructionHeaderMode = true;
      pendingDescriptionHeaderMode = false;
      continue;
    }

    // 6. Checkbox Test Items ("☐ Open the application.", "- [ ] Verify login")
    const checkboxMatch = meta.trimmed.match(CHECKBOX_TEST_RE);
    if (checkboxMatch) {
      addTestToCurrentContext(checkboxMatch[1], meta);
      continue;
    }

    // 7. Bullet Test Items ("- Verify login", "* Check dashboard", "• Validate modal")
    const bulletMatch = meta.trimmed.match(BULLET_TEST_RE);
    if (bulletMatch) {
      addTestToCurrentContext(bulletMatch[1], meta);
      continue;
    }

    // 8. Standalone Test ID Items ("TEST-001 — Verify authentication.", "API-001 [HIGH]: Verify response")
    if (
      BRACKETED_TEST_ID_RE.test(meta.trimmed) ||
      INLINE_TEST_ID_WITH_PRIO_RE.test(meta.trimmed) ||
      INLINE_TEST_ID_RE.test(meta.trimmed)
    ) {
      addTestToCurrentContext(meta.trimmed, meta);
      continue;
    }

    // 9. Decimal Subheadings ("1.1 Login Form" + child bullets) vs Decimal Test Items ("1.1 Open home page")
    const decSubMatch = meta.trimmed.match(DECIMAL_SUBHEADING_RE);
    if (decSubMatch) {
      const decNum = decSubMatch[1];
      const decBody = decSubMatch[2].trim();
      const nextMeta = findNextNonEmptyLine(i + 1);
      const nextIsPhase = Boolean(nextMeta && phaseHeadingsByLine[nextMeta.lineNumber - 1]);
      let nextHasNestedChildren = false;

      if (nextMeta && !nextIsPhase) {
        const nextDec = nextMeta.trimmed.match(DECIMAL_SUBHEADING_RE);
        if (nextDec && nextDec[1].startsWith(`${decNum}.`)) {
          nextHasNestedChildren = true;
        } else if (
          isObviousChildTestLine(nextMeta.trimmed) ||
          NUMBERED_LINE_RE.test(nextMeta.trimmed) ||
          ENVIRONMENT_LINE_RE.test(nextMeta.trimmed) ||
          INSTRUCTION_LINE_RE.test(nextMeta.trimmed)
        ) {
          nextHasNestedChildren = true;
        }
      }

      const isDecimalCategory =
        meta.indent <= 4 &&
        meta.trimmed.length <= 90 &&
        (decBody.endsWith(':') || nextHasNestedChildren);

      if (isDecimalCategory) {
        addCategoryToCurrentContext(`${decNum} ${decBody}`);
      } else {
        addTestToCurrentContext(decBody, meta, decNum);
      }
      continue;
    }

    // 10. Markdown Subheadings inside a Phase ("### Desktop", "#### Validation") -> Category
    if (meta.md) {
      if (currentPhase) {
        addCategoryToCurrentContext(meta.md.text);
      } else if (!documentTitle) {
        documentTitle = meta.md.text;
      } else {
        addCategoryToCurrentContext(meta.md.text);
      }
      continue;
    }

    // 11. Numbered Test Items ("1. Test valid credentials.", "2) Test invalid password.")
    const numTestMatch = meta.trimmed.match(NUMBERED_LINE_RE);
    if (numTestMatch) {
      addTestToCurrentContext(numTestMatch[3], meta);
      continue;
    }

    // 11b. Lettered Test Items ("a) First test case", "A. First requirement", "(a) First scenario")
    if (isLetteredBulletLine(meta.trimmed)) {
      const strippedFormatting = stripMarkdownFormatting(meta.trimmed);
      const nextMeta = findNextNonEmptyLine(i + 1);
      const nextIsPhase = Boolean(nextMeta && phaseHeadingsByLine[nextMeta.lineNumber - 1]);
      let nextHasNestedChildren = false;

      if (nextMeta && !nextIsPhase) {
        if (
          isObviousChildTestLine(nextMeta.trimmed) ||
          NUMBERED_LINE_RE.test(nextMeta.trimmed) ||
          ENVIRONMENT_LINE_RE.test(nextMeta.trimmed) ||
          INSTRUCTION_LINE_RE.test(nextMeta.trimmed)
        ) {
          nextHasNestedChildren = true;
        }
      }

      const isLetteredCategory =
        meta.indent <= 2 &&
        meta.trimmed.length <= 80 &&
        strippedFormatting.endsWith(':') &&
        nextHasNestedChildren;

      if (isLetteredCategory) {
        addCategoryToCurrentContext(strippedFormatting);
      } else {
        addTestToCurrentContext(meta.trimmed, meta);
      }
      continue;
    }

    // 12. Colon Subheadings / Bold Standalone Category Headings ("Desktop:", "**Mobile View**")
    const strippedFormatting = stripMarkdownFormatting(meta.trimmed);
    const isBoldStandalone =
      ((meta.trimmed.startsWith('**') && meta.trimmed.endsWith('**')) ||
        (meta.trimmed.startsWith('__') && meta.trimmed.endsWith('__'))) &&
      strippedFormatting.length > 0 &&
      strippedFormatting.length <= 75 &&
      !/[.!?]$/.test(strippedFormatting);

    const isColonSubheading =
      strippedFormatting.endsWith(':') &&
      strippedFormatting.length >= 2 &&
      strippedFormatting.length <= 80 &&
      !/[.!?]:$/.test(strippedFormatting);

    if (isColonSubheading || isBoldStandalone) {
      // Confirm via lookahead or active phase context that this isn't a lone random label
      addCategoryToCurrentContext(strippedFormatting);
      continue;
    }

    // 13. Indented Soft-Wrapped Continuation of Immediately Preceding Test Item
    if (
      lastAddedTest &&
      meta.indent >= 2 &&
      !meta.trimmed.endsWith(':') &&
      meta.trimmed.length <= 240
    ) {
      lastAddedTest.text = `${lastAddedTest.text} ${meta.trimmed}`;
      continue;
    }

    // 14. Pending Description or Instruction Header Continuation
    if (pendingDescriptionHeaderMode && currentPhase && !phaseHasStartedBodyItems) {
      appendPhaseDescription(currentPhase, strippedFormatting);
      continue;
    }

    if (pendingInstructionHeaderMode) {
      addSupportingNote('instruction', strippedFormatting, meta.lineNumber);
      continue;
    }

    // 15. Plain Text Classification (Phase Description vs Supporting Paragraph vs Document Preamble vs Unclassified)
    lastAddedTest = null;

    if (currentPhase && !phaseHasStartedBodyItems) {
      // Before any categories or tests in a phase: short unpunctuated title followed immediately by tests could be a category,
      // whereas descriptive prose is the Phase Description.
      const nextNonEmpty = findNextNonEmptyLine(i + 1);
      const wordCount = strippedFormatting.split(/\s+/).length;
      const hasSentencePunctuation = /[.,;!?]/.test(strippedFormatting);

      if (
        !hasSentencePunctuation &&
        wordCount <= 4 &&
        strippedFormatting.length <= 40 &&
        nextNonEmpty &&
        isObviousChildTestLine(nextNonEmpty.trimmed) &&
        currentPhase.description.length > 0
      ) {
        // Phase already has a description, and a short 1-4 word heading-like label ("Desktop", "Mobile Safari") precedes bullets
        addCategoryToCurrentContext(strippedFormatting);
      } else {
        appendPhaseDescription(currentPhase, strippedFormatting);
      }
      continue;
    }

    // Before any phase has started at top of document
    if (!currentPhase) {
      // Check in O(1) if there are phases later in the document -> treat top intro text as document title / preamble note
      const hasLaterPhases = lastPhaseLineIndex > i;
      if (hasLaterPhases) {
        if (!documentTitle && strippedFormatting.length <= 90 && !/[.!?]$/.test(strippedFormatting)) {
          documentTitle = strippedFormatting;
        } else {
          addSupportingNote('note', strippedFormatting, meta.lineNumber);
        }
        continue;
      }

      // No phases anywhere in document and line is not a recognizable test or category -> Unclassified
      unclassified.push({
        id: nextId('unc'),
        text: meta.trimmed,
        lineNumber: meta.lineNumber,
        nearestPhaseId: null,
        reason: 'Could not confidently identify as a phase heading, category, or test item.'
      });
      continue;
    }

    // Inside a phase AFTER categories/tests have started:
    // Distinguish genuine explanatory/instructional sentences from ambiguous/malformed lines
    const isTablePipeRow = /^\|.*\|$/.test(meta.trimmed);
    const wordCount = strippedFormatting.split(/\s+/).length;
    const looksLikeExplanatoryProse =
      !isTablePipeRow &&
      wordCount >= 4 &&
      (/[.!?:)]$/.test(strippedFormatting) ||
        /^(?:make\s+sure|please\s+|ensure\s+the\s+environment|run\s+these|all\s+tests|the\s+following|when\s+testing|before\s+running|after\s+completing|if\s+applicable|only\s+applicable|requires?\s+|tested\s+on)/i.test(strippedFormatting));

    if (looksLikeExplanatoryProse) {
      addSupportingNote('note', strippedFormatting, meta.lineNumber);
    } else {
      unclassified.push({
        id: nextId('unc'),
        text: meta.trimmed,
        lineNumber: meta.lineNumber,
        nearestPhaseId: currentPhase ? currentPhase.id : null,
        reason: isTablePipeRow
          ? 'Table row detected — review whether this should be converted into test items.'
          : 'Ambiguous line inside phase — review whether this is a category, test item, or note.'
      });
    }
  }

  // ==========================================================================
  // Post-Processing & Diagnostics Summary
  // ==========================================================================
  const explicitPhaseCount = phases.filter(p => !p.isImplicit).length;
  const summary = computeChecklistSummary({
    phases,
    documentNotes,
    unclassified
  });

  const messages = [];
  let status = 'ok';

  if (phases.length === 0 && summary.testCount === 0) {
    status = 'no_structure';
    messages.push({
      type: 'warning',
      text: 'No recognizable phases, categories, or test items were detected in the pasted text. Unclassified lines were preserved below so you can convert or edit them manually.'
    });
  } else if (explicitPhaseCount === 0 && summary.testCount > 0) {
    status = 'no_phases';
    messages.push({
      type: 'info',
      text: `No explicit phase headings were detected. Organized ${summary.testCount} test ${summary.testCount === 1 ? 'item' : 'items'}${summary.categoryCount > 0 ? ` across ${summary.categoryCount} ${summary.categoryCount === 1 ? 'category' : 'categories'}` : ''} into a default section that you can rename or split into phases below.`
    });
  } else if (summary.testCount === 0 && phases.length > 0) {
    status = 'no_tests';
    messages.push({
      type: 'warning',
      text: `Identified ${phases.length} ${phases.length === 1 ? 'phase' : 'phases'}, but no individual test cases were found. You can add test cases directly in the preview below.`
    });
  } else {
    const emptyPhasesCount = phases.filter(p => {
      const count = p.sections.reduce((acc, s) => acc + s.tests.length, 0);
      return count === 0;
    }).length;

    messages.push({
      type: 'success',
      text: `Successfully extracted ${phases.length} ${phases.length === 1 ? 'phase' : 'phases'}${summary.categoryCount > 0 ? `, ${summary.categoryCount} ${summary.categoryCount === 1 ? 'category' : 'categories'},` : ''} and ${summary.testCount} ${summary.testCount === 1 ? 'test case' : 'test cases'}.`
    });

    if (emptyPhasesCount > 0) {
      messages.push({
        type: 'info',
        text: `${emptyPhasesCount} ${emptyPhasesCount === 1 ? 'phase has' : 'phases have'} no test cases yet and ${emptyPhasesCount === 1 ? 'was' : 'were'} preserved in original order.`
      });
    }
  }

  if (duplicatesSkipped > 0) {
    messages.push({
      type: 'info',
      text: `Skipped ${duplicatesSkipped} duplicate test ${duplicatesSkipped === 1 ? 'entry' : 'entries'} within the same section.`
    });
  }

  if (unclassified.length > 0 && status !== 'no_structure') {
    messages.push({
      type: 'warning',
      text: `Preserved ${unclassified.length} unclassified ${unclassified.length === 1 ? 'line' : 'lines'} at the bottom of the preview for your review.`
    });
  }

  return {
    status,
    messages,
    documentTitle,
    documentNotes,
    phases,
    unclassified,
    stats: {
      totalLines: rawLines.length,
      nonEmptyLines,
      phaseCount: phases.length,
      explicitPhaseCount,
      categoryCount: summary.categoryCount,
      testCount: summary.testCount,
      noteCount: summary.noteCount,
      unclassifiedCount: unclassified.length,
      duplicatesSkipped
    }
  };
}
