import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const SHOTS_DIR = path.resolve('.audit-tmp/shots');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const VIEWPORTS = [
  // A. Small Mobile Phones
  { cat: 'A. Small Mobile', w: 320, h: 568 },
  { cat: 'A. Small Mobile', w: 360, h: 640 },
  { cat: 'A. Small Mobile', w: 360, h: 780 },
  { cat: 'A. Small Mobile', w: 375, h: 812 },
  // B. Standard & Large Mobile Phones
  { cat: 'B. Standard/Large Mobile', w: 390, h: 844 },
  { cat: 'B. Standard/Large Mobile', w: 393, h: 873 },
  { cat: 'B. Standard/Large Mobile', w: 414, h: 896 },
  { cat: 'B. Standard/Large Mobile', w: 430, h: 932 },
  { cat: 'B. Standard/Large Mobile', w: 412, h: 915 },
  // C. Tablet Portrait
  { cat: 'C. Tablet Portrait', w: 600, h: 960 },
  { cat: 'C. Tablet Portrait', w: 768, h: 1024 },
  { cat: 'C. Tablet Portrait', w: 820, h: 1180 },
  { cat: 'C. Tablet Portrait', w: 834, h: 1194 },
  { cat: 'C. Tablet Portrait', w: 900, h: 1200 },
  { cat: 'C. Tablet Portrait', w: 1024, h: 1366 },
  // D. Tablet & Mobile Landscape
  { cat: 'D. Landscape', w: 640, h: 360 },
  { cat: 'D. Landscape', w: 667, h: 375 },
  { cat: 'D. Landscape', w: 740, h: 360 },
  { cat: 'D. Landscape', w: 800, h: 600 },
  { cat: 'D. Landscape / E. Hybrid', w: 1024, h: 768 },
  { cat: 'D. Landscape / E. Hybrid', w: 1180, h: 820 },
  { cat: 'D. Landscape', w: 1194, h: 834 },
  // E. Intermediate / Hybrid Layouts
  { cat: 'E. Hybrid', w: 1024, h: 800 },
  { cat: 'E. Hybrid', w: 1100, h: 700 },
  { cat: 'E. Hybrid', w: 1279, h: 800 },
  // F. Desktop Preservation
  { cat: 'F. Desktop', w: 1280, h: 720 },
  { cat: 'F. Desktop', w: 1366, h: 768 },
  { cat: 'F. Desktop', w: 1440, h: 900 },
  { cat: 'F. Desktop', w: 1600, h: 900 },
  { cat: 'F. Desktop', w: 1920, h: 1080 },
  { cat: 'F. Desktop', w: 2560, h: 1440 }
];

const SEED_PROJECTS = [
  {
    id: 'proj_audit_1',
    name: 'Qavora Cloud Checkout & Billing Portal v2.4',
    type: 'SaaS Platform',
    status: 'Active',
    version: 'v2.4.1-rc2',
    description: 'End-to-end manual regression suite covering checkout flows, 3DS2 card verification, subscription proration, and webhook retries.',
    createdAt: '2026-10-15T10:00:00.000Z',
    updatedAt: '2026-11-01T14:30:00.000Z',
    testPlan: {
      id: 'plan_audit_1',
      name: 'Q4 Release Readiness Master Test Plan',
      objective: 'Validate zero critical payment regressions across mobile Safari, Android Chrome, and desktop browsers.',
      scope: 'Stripe 3DS2 checkout, invoice PDF downloads, coupon stacking, tax calculation, and refund workflows.',
      description: 'Execute all P0/P1 suites before production cutover.',
      createdAt: '2026-10-15T10:00:00.000Z',
      updatedAt: '2026-11-01T14:30:00.000Z',
      phases: [
        { id: 'ph_1', name: 'Phase 1: Core Checkout & Payment Flows', phaseNumber: '1', description: 'Primary credit card, Apple Pay, and 3DS2 verification.', order: 0 },
        { id: 'ph_2', name: 'Phase 2: Subscription Lifecycle & Webhooks', phaseNumber: '2', description: 'Upgrades, downgrades, invoice retries, and dunning.', order: 1 }
      ]
    },
    testSuites: [
      {
        id: 'suite_1',
        phaseId: 'ph_1',
        name: '3DS2 Card & Express Wallet Checkout',
        description: 'Verify frictionless and challenge 3DS2 flows plus Apple Pay fallback.',
        category: 'Functional',
        tags: ['payments', '3ds2', 'checkout'],
        order: 0,
        createdAt: '2026-10-16T10:00:00.000Z',
        updatedAt: '2026-11-01T12:00:00.000Z',
        testCases: [
          {
            id: 'TC-001',
            title: 'Verify 3DS2 challenge modal completes payment and redirects to receipt screen',
            description: 'Ensure bank OTP challenge resolves cleanly without duplicate charge.',
            preconditions: 'Staging Stripe test card 4000002760003184 configured; cart has Pro Annual plan.',
            steps: [
              { id: 'st_1', action: 'Navigate to /checkout and enter billing address + 3DS2 test card', testData: 'Card: 4000 0027 6000 3184, ZIP: 94107', order: 0 },
              { id: 'st_2', action: 'Submit payment and complete 3DS2 bank OTP challenge frame', testData: 'OTP: 123456', order: 1 },
              { id: 'st_3', action: 'Verify receipt screen displays invoice number and active subscription badge', testData: 'Expected status: Active', order: 2 }
            ],
            expectedResult: 'Order succeeds with single charge, receipt PDF downloads, and webhook updates entitlement.',
            priority: 'Critical',
            category: 'Functional',
            tags: ['p0', 'stripe', '3ds2'],
            status: 'Pass',
            lastExecutedAt: '2026-11-01T11:20:00.000Z',
            defectIds: [],
            createdAt: '2026-10-16T10:00:00.000Z',
            updatedAt: '2026-11-01T11:20:00.000Z'
          },
          {
            id: 'TC-002',
            title: 'Verify expired promo code displays inline error without clearing card inputs',
            description: 'Applying expired coupon EXPIRED2025 must preserve entered card holder details.',
            preconditions: 'Coupon EXPIRED2025 expired in admin portal.',
            steps: [
              { id: 'st_21', action: 'Fill customer email and billing fields on checkout page', testData: 'qa@example.com', order: 0 },
              { id: 'st_22', action: 'Enter EXPIRED2025 in discount box and tap Apply', testData: 'Code: EXPIRED2025', order: 1 }
            ],
            expectedResult: 'Inline validation message shown; existing form inputs remain intact.',
            priority: 'High',
            category: 'UI/UX',
            tags: ['coupons', 'validation'],
            status: 'Fail',
            lastExecutedAt: '2026-11-01T13:15:00.000Z',
            defectIds: ['DEF-001'],
            createdAt: '2026-10-17T10:00:00.000Z',
            updatedAt: '2026-11-01T13:15:00.000Z'
          },
          {
            id: 'TC-003',
            title: 'Verify proration preview when upgrading mid-cycle from Starter to Enterprise',
            description: 'Line-item credit and prorated charge must match billing preview.',
            preconditions: 'User logged in with active Starter monthly plan.',
            steps: [
              { id: 'st_31', action: 'Open Billing Settings > Change Plan and select Enterprise', testData: 'Plan: Enterprise', order: 0 }
            ],
            expectedResult: 'Exact prorated subtotal displayed prior to confirmation.',
            priority: 'Medium',
            category: 'Functional',
            tags: ['proration'],
            status: 'Blocked',
            lastExecutedAt: '2026-11-01T14:00:00.000Z',
            defectIds: [],
            createdAt: '2026-10-18T10:00:00.000Z',
            updatedAt: '2026-11-01T14:00:00.000Z'
          }
        ]
      }
    ],
    executions: [
      {
        id: 'exec_1',
        testCaseId: 'TC-001',
        testCaseTitle: 'Verify 3DS2 challenge modal completes payment and redirects to receipt screen',
        suiteId: 'suite_1',
        phaseId: 'ph_1',
        status: 'Pass',
        actualResult: 'Payment succeeded and invoice INV-2094 generated.',
        notes: 'Verified on mobile Safari and Chrome.',
        tester: 'Alex Rivera',
        environment: 'Staging',
        browserDevice: 'iPhone 15 / iOS 18 Safari',
        buildVersion: 'v2.4.1-rc2',
        stepResults: [],
        defectIds: [],
        executedAt: '2026-11-01T11:20:00.000Z'
      },
      {
        id: 'exec_2',
        testCaseId: 'TC-002',
        testCaseTitle: 'Verify expired promo code displays inline error without clearing card inputs',
        suiteId: 'suite_1',
        phaseId: 'ph_1',
        status: 'Fail',
        actualResult: 'Applying expired coupon triggered full form reset on narrow viewports.',
        notes: 'Logged DEF-001.',
        tester: 'Alex Rivera',
        environment: 'Staging',
        browserDevice: 'Pixel 8 / Chrome 130',
        buildVersion: 'v2.4.1-rc2',
        stepResults: [],
        defectIds: ['DEF-001'],
        executedAt: '2026-11-01T13:15:00.000Z'
      }
    ],
    defects: [
      {
        id: 'DEF-001',
        testCaseId: 'TC-002',
        executionId: 'exec_2',
        title: 'Applying expired discount code resets billing address fields on mobile checkout',
        description: 'Form state resets unexpectedly when coupon endpoint returns HTTP 422.',
        priority: 'Critical',
        severity: 'Critical',
        status: 'Open',
        stepsToReproduce: '1. Open /checkout\n2. Fill billing address\n3. Apply EXPIRED2025',
        expectedResult: 'Billing fields remain populated and inline coupon error appears.',
        actualResult: 'Billing fields clear completely.',
        externalIssueUrl: 'https://github.com/Hannankhan203/Qavora/issues/42',
        createdAt: '2026-11-01T13:16:00.000Z',
        updatedAt: '2026-11-01T13:16:00.000Z'
      }
    ]
  },
  {
    id: 'proj_audit_2',
    name: 'Mobile Companion App Offline Sync',
    type: 'Mobile Application',
    status: 'Completed',
    version: 'v1.8.0',
    description: 'Offline queue persistence, conflict resolution, and background delta sync tests.',
    createdAt: '2026-10-05T09:00:00.000Z',
    updatedAt: '2026-10-28T17:00:00.000Z',
    testPlan: { id: 'plan_audit_2', name: 'Offline Sync Plan', phases: [] },
    testSuites: [],
    executions: [],
    defects: []
  }
];

const SAMPLE_RAW_PLAN = `Release 2.4 Manual QA Plan
Environment: Staging https://staging.example.com

Phase 1: Authentication & Session Security
Verify login, MFA, and session timeout behaviors across mobile and tablet browsers.

Login & MFA:
- [AUTH-001] [Critical] Verify email + password login redirects to dashboard
- [AUTH-002] [High] Verify TOTP 6-digit MFA code validation and backup code recovery
- [AUTH-003] [Medium] Verify session lock banner appears after 30 minutes of inactivity

Random ambiguous line without bullet for unclassified review

Phase 2: Responsive Checkout Verification
- [CHK-001] [High] Verify sticky order summary collapses cleanly on 320px width`;

async function navigateState(page, stateName) {
  switch (stateName) {
    case 'checklist-edit':
      await page.evaluate(() => {
        document.querySelector('[data-view="checklist-generator"]').click();
        const editBtn = document.querySelector('.qa-mode-btn[data-mode="edit"]');
        if (editBtn) editBtn.click();
      });
      break;
    case 'checklist-clean':
      await page.evaluate(() => {
        document.querySelector('[data-view="checklist-generator"]').click();
        const cleanBtn = document.querySelector('.qa-mode-btn[data-mode="clean"]');
        if (cleanBtn) cleanBtn.click();
      });
      break;
    case 'my-checklists':
    case 'dashboard':
    case 'projects':
    case 'execution':
    case 'defects':
    case 'reports':
    case 'settings':
      await page.evaluate((v) => document.querySelector(`[data-view="${v}"]`).click(), stateName);
      break;
    case 'qa-runner':
      await page.evaluate(() => {
        document.querySelector('[data-view="qa-runner"]').click();
        const doneEdit = Array.from(document.querySelectorAll('#view-qa-runner button')).find(b => b.textContent.includes('Done Editing'));
        if (doneEdit) doneEdit.click();
      });
      break;
    case 'qa-runner-edit':
      await page.evaluate(() => {
        document.querySelector('[data-view="qa-runner"]').click();
        const editBtn = Array.from(document.querySelectorAll('#view-qa-runner button')).find(b => b.textContent.includes('Edit Structure'));
        if (editBtn) editBtn.click();
      });
      break;
    case 'project-details':
      await page.evaluate(() => {
        document.querySelector('[data-view="projects"]').click();
      });
      await page.click('.btn-open-project');
      break;
    case 'plans':
      await page.evaluate(() => {
        document.querySelector('[data-view="plans"]').click();
        const backBtn = document.getElementById('cases-back-to-phases-btn');
        if (backBtn && backBtn.offsetParent !== null) backBtn.click();
      });
      break;
    case 'plans-cases':
      await page.evaluate(() => {
        document.querySelector('[data-view="plans"]').click();
        const backBtn = document.getElementById('cases-back-to-phases-btn');
        if (backBtn && backBtn.offsetParent !== null) backBtn.click();
        const openBtn = document.querySelector('#plans-phases-subview .btn-open-suite');
        if (openBtn) openBtn.click();
      });
      break;
    case 'data-export':
    case 'data-import':
    case 'data-backup':
    case 'data-info': {
      const tab = stateName.replace('data-', '');
      await page.evaluate((t) => {
        document.querySelector('[data-view="data"]').click();
        const tabBtn = document.querySelector(`.data-tab-btn[data-tab="${t}"]`);
        if (tabBtn) tabBtn.click();
      }, tab);
      break;
    }
  }
  await page.waitForTimeout(20);
}

async function checkGeometry(page, vw, vh) {
  return page.evaluate(({ vw, vh }) => {
    const docOverflow = document.documentElement.scrollWidth - vw;
    const bodyOverflow = document.body.scrollWidth - vw;
    const badEls = [];

    const all = document.querySelectorAll('.top-nav, .view-section.active *');
    for (const el of all) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      let p = el.parentElement;
      let insideScrollX = false;
      while (p && p !== document.body) {
        const ps = getComputedStyle(p);
        if (ps.overflowX === 'auto' || ps.overflowX === 'scroll') {
          insideScrollX = true;
          break;
        }
        p = p.parentElement;
      }
      if (insideScrollX) continue;

      if (r.right > vw + 1.5 || r.left < -1.5) {
        badEls.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width)
        });
        if (badEls.length >= 4) break;
      }
    }

    const navLeft = document.querySelector('.top-nav-left')?.getBoundingClientRect();
    const navRight = document.querySelector('.top-nav-right')?.getBoundingClientRect();
    const navCenter = document.querySelector('.top-nav-center');
    const centerVisible = navCenter && getComputedStyle(navCenter).display !== 'none';
    const centerRect = centerVisible ? navCenter.getBoundingClientRect() : null;

    let headerOverlap = false;
    if (navLeft && navRight && navLeft.right > navRight.left + 1) headerOverlap = true;
    if (centerRect && navLeft && navLeft.right > centerRect.left + 1) headerOverlap = true;
    if (centerRect && navRight && centerRect.right > navRight.left + 1) headerOverlap = true;

    return { docOverflow, bodyOverflow, headerOverlap, badEls };
  }, { vw, vh });
}

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });

  await page.evaluate((projects) => {
    localStorage.setItem('qavora_projects_v1', JSON.stringify(projects));
    localStorage.setItem('qavora_activities_v1', JSON.stringify([
      { id: 'a1', action: 'Executed test case', target: 'TC-002 (Fail)', timestamp: new Date().toISOString() },
      { id: 'a2', action: 'Created defect', target: 'DEF-001: Applying expired discount code resets billing address fields', timestamp: new Date().toISOString() }
    ]));
  }, SEED_PROJECTS);

  await page.reload({ waitUntil: 'networkidle' });

  // Create saved checklist + transfer code + re-populate generator preview
  await page.fill('#qa-plan-textarea', SAMPLE_RAW_PLAN);
  await page.click('#btn-generate-checklist');
  await page.click('#btn-start-testing-top');
  // Check 1 test item in QA runner so progress bar & completed styling are rendered
  await page.click('.qa-runner-checkbox');

  await page.evaluate(() => document.querySelector('[data-view="data"]').click());
  await page.click('#btn-generate-transfer-code');
  await page.waitForTimeout(100);

  await page.evaluate(() => document.querySelector('[data-view="checklist-generator"]').click());
  await page.fill('#qa-plan-textarea', SAMPLE_RAW_PLAN);
  await page.click('#btn-generate-checklist');

  const STATES = [
    'checklist-edit',
    'checklist-clean',
    'my-checklists',
    'qa-runner',
    'qa-runner-edit',
    'dashboard',
    'projects',
    'project-details',
    'plans',
    'plans-cases',
    'execution',
    'defects',
    'reports',
    'data-export',
    'data-import',
    'data-backup',
    'data-info',
    'settings'
  ];

  // Ensure qa-runner returns to normal mode after qa-runner-edit
  const viewIssues = [];
  const matrixResults = [];

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.waitForTimeout(30);
    let vpPass = true;
    const failedViews = [];

    for (const st of STATES) {
      await navigateState(page, st);
      const res = await checkGeometry(page, vp.w, vp.h);
      if (res.docOverflow > 1 || res.bodyOverflow > 1 || res.headerOverlap || res.badEls.length > 0) {
        vpPass = false;
        failedViews.push(st);
        viewIssues.push({ vp: `${vp.w}x${vp.h}`, cat: vp.cat, state: st, ...res });
      }
    }

    // Reset qa-runner to testing mode
    await navigateState(page, 'qa-runner');

    matrixResults.push({
      vp: `${vp.w}x${vp.h}`,
      cat: vp.cat,
      passed: vpPass,
      statesChecked: STATES.length,
      failedViews
    });
  }

  // Test ALL 14 Modals across 5 representative resolutions (Small Mobile, Compact Phone, Short Landscape, Tablet Portrait, Desktop)
  const MODAL_VPS = [
    { w: 320, h: 568 },
    { w: 360, h: 640 },
    { w: 640, h: 360 },
    { w: 768, h: 1024 },
    { w: 1366, h: 768 }
  ];

  const ALL_14_MODALS = [
    {
      id: 'project-modal',
      open: async () => { await page.evaluate(() => document.getElementById('header-create-btn').click()); },
      close: async () => { await page.evaluate(() => document.getElementById('modal-close-btn').click()); }
    },
    {
      id: 'testplan-modal',
      open: async () => {
        await navigateState(page, 'plans');
        await page.evaluate(() => document.getElementById('plans-edit-plan-btn').click());
      },
      close: async () => { await page.evaluate(() => document.getElementById('testplan-modal-close').click()); }
    },
    {
      id: 'phase-modal',
      open: async () => {
        await navigateState(page, 'plans');
        await page.evaluate(() => document.getElementById('plans-add-phase-btn').click());
      },
      close: async () => { await page.evaluate(() => document.getElementById('phase-modal-close').click()); }
    },
    {
      id: 'suite-modal',
      open: async () => {
        await navigateState(page, 'plans');
        await page.evaluate(() => document.querySelector('.btn-add-suite-phase').click());
      },
      close: async () => { await page.evaluate(() => document.getElementById('suite-modal-close').click()); }
    },
    {
      id: 'testcase-modal',
      open: async () => {
        await navigateState(page, 'plans-cases');
        await page.evaluate(() => document.getElementById('suite-add-case-btn').click());
      },
      close: async () => { await page.evaluate(() => document.getElementById('case-modal-close').click()); }
    },
    {
      id: 'testcase-view-modal',
      open: async () => {
        await navigateState(page, 'plans-cases');
        await page.evaluate(() => document.querySelector('.btn-view-case').click());
      },
      close: async () => { await page.evaluate(() => document.getElementById('view-case-close').click()); }
    },
    {
      id: 'delete-modal',
      open: async () => {
        await navigateState(page, 'projects');
        await page.evaluate(() => document.querySelector('.btn-delete-project').click());
      },
      close: async () => { await page.evaluate(() => document.getElementById('delete-close-btn').click()); }
    },
    {
      id: 'execution-modal',
      open: async () => {
        await navigateState(page, 'execution');
        await page.evaluate(() => document.querySelector('.btn-run-case').click());
      },
      close: async () => { await page.evaluate(() => document.getElementById('exec-modal-close').click()); }
    },
    {
      id: 'execution-history-modal',
      open: async () => {
        await navigateState(page, 'execution');
        await page.evaluate(() => document.querySelector('.btn-history-case').click());
      },
      close: async () => { await page.evaluate(() => document.getElementById('history-modal-close').click()); }
    },
    {
      id: 'defect-modal',
      open: async () => {
        await navigateState(page, 'defects');
        await page.evaluate(() => document.getElementById('btn-create-defect').click());
      },
      close: async () => { await page.evaluate(() => document.getElementById('defect-modal-close').click()); }
    },
    {
      id: 'defect-view-modal',
      open: async () => {
        await navigateState(page, 'defects');
        await page.evaluate(() => document.querySelector('.btn-view-defect').click());
      },
      close: async () => { await page.evaluate(() => document.getElementById('view-defect-close').click()); }
    },
    {
      id: 'import-preview-modal',
      open: async () => {
        await navigateState(page, 'data-import');
        const payload = JSON.stringify({
          application: 'Qavora',
          backupVersion: 1,
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          projects: SEED_PROJECTS
        });
        await page.setInputFiles('#import-file-input', {
          name: 'Qavora_Full_Backup_Test.json',
          mimeType: 'application/json',
          buffer: Buffer.from(payload, 'utf-8')
        });
      },
      close: async () => { await page.evaluate(() => document.getElementById('import-preview-close').click()); }
    },
    {
      id: 'reset-confirm-modal',
      open: async () => {
        await navigateState(page, 'data-backup');
        await page.evaluate(() => document.getElementById('btn-trigger-reset-modal').click());
      },
      close: async () => { await page.evaluate(() => document.getElementById('reset-modal-close').click()); }
    },
    {
      id: 'qa-checklist-delete-modal',
      open: async () => {
        await navigateState(page, 'my-checklists');
        await page.evaluate(() => document.querySelector('.qa-mychk-actions .btn-danger-outline').click());
      },
      close: async () => { await page.evaluate(() => document.getElementById('qa-chk-delete-cancel').click()); }
    }
  ];

  const modalIssues = [];
  const modalSummary = [];

  for (const vp of MODAL_VPS) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.waitForTimeout(30);
    for (const mc of ALL_14_MODALS) {
      await mc.open();
      await page.waitForTimeout(45);
      const mRes = await page.evaluate(({ vw, vh, mId }) => {
        const backdrop = document.getElementById(mId);
        const isOpen = backdrop && backdrop.classList.contains('open');
        const card = backdrop?.querySelector('.modal-dialog');
        if (!isOpen || !card) return { notOpen: true };
        const cr = card.getBoundingClientRect();
        const overRight = cr.right - vw;
        const overLeft = -cr.left;
        const overBottom = cr.bottom - vh;
        const overTop = -cr.top;
        const scrollLocked = getComputedStyle(document.body).overflow === 'hidden' || getComputedStyle(document.documentElement).overflow === 'hidden';
        const badInner = [];
        for (const el of card.querySelectorAll('*')) {
          const st = getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden') continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0) continue;
          let p = el.parentElement;
          let scrollX = false;
          while (p && p !== card) {
            const ps = getComputedStyle(p);
            if (ps.overflowX === 'auto' || ps.overflowX === 'scroll') { scrollX = true; break; }
            p = p.parentElement;
          }
          if (!scrollX && (r.right > cr.right + 2 || r.left < cr.left - 2)) {
            badInner.push({
              tag: el.tagName.toLowerCase(),
              id: el.id,
              cls: (typeof el.className === 'string' ? el.className : '').slice(0, 50),
              right: Math.round(r.right),
              cardRight: Math.round(cr.right)
            });
            if (badInner.length >= 3) break;
          }
        }
        return {
          notOpen: false,
          cardW: Math.round(cr.width),
          cardH: Math.round(cr.height),
          overRight: Math.round(overRight),
          overLeft: Math.round(overLeft),
          overBottom: Math.round(overBottom),
          overTop: Math.round(overTop),
          scrollLocked,
          badInner
        };
      }, { vw: vp.w, vh: vp.h, mId: mc.id });

      if (!mRes || mRes.notOpen || mRes.overRight > 1 || mRes.overLeft > 1 || mRes.overBottom > 1 || mRes.overTop > 1 || !mRes.scrollLocked || mRes.badInner.length > 0) {
        modalIssues.push({ vp: `${vp.w}x${vp.h}`, modal: mc.id, ...mRes });
      } else {
        modalSummary.push({ vp: `${vp.w}x${vp.h}`, modal: mc.id, cardW: mRes.cardW, cardH: mRes.cardH, scrollLocked: mRes.scrollLocked });
      }
      await mc.close();
      await page.waitForTimeout(25);
    }
  }

  // Test Mobile & Tablet Drawer Navigation Interactions
  const drawerChecks = [];
  for (const vp of [{ w: 320, h: 568 }, { w: 375, h: 812 }, { w: 640, h: 360 }, { w: 768, h: 1024 }]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.waitForTimeout(30);
    await page.click('#sidebar-toggle-btn');
    await page.waitForTimeout(80);
    const openedState = await page.evaluate(() => {
      const sb = document.getElementById('sidebar');
      const r = sb.getBoundingClientRect();
      return {
        open: sb.classList.contains('open'),
        width: Math.round(r.width),
        scrollLocked: getComputedStyle(document.body).overflow === 'hidden'
      };
    });
    // Close via close button
    await page.click('#sidebar-close-btn');
    await page.waitForTimeout(80);
    const closedViaBtn = await page.evaluate(() => !document.getElementById('sidebar').classList.contains('open'));

    // Reopen and close via backdrop click
    await page.click('#sidebar-toggle-btn');
    await page.waitForTimeout(80);
    await page.mouse.click(vp.w - 15, Math.floor(vp.h / 2));
    await page.waitForTimeout(80);
    const closedViaBackdrop = await page.evaluate(() => !document.getElementById('sidebar').classList.contains('open'));

    // Reopen and click nav item -> auto closes
    await page.click('#sidebar-toggle-btn');
    await page.waitForTimeout(80);
    await page.click('#nav-dashboard');
    await page.waitForTimeout(80);
    const closedViaNav = await page.evaluate(() => !document.getElementById('sidebar').classList.contains('open'));

    drawerChecks.push({
      vp: `${vp.w}x${vp.h}`,
      ...openedState,
      closedViaBtn,
      closedViaBackdrop,
      closedViaNav
    });
  }

  // Orientation transition test (Portrait <-> Landscape)
  const orientationChecks = [];
  for (const pair of [
    [{ w: 360, h: 640 }, { w: 640, h: 360 }],
    [{ w: 375, h: 812 }, { w: 812, h: 375 }],
    [{ w: 768, h: 1024 }, { w: 1024, h: 768 }]
  ]) {
    await navigateState(page, 'qa-runner');
    await page.setViewportSize({ width: pair[0].w, height: pair[0].h });
    await page.waitForTimeout(40);
    const pGeom = await checkGeometry(page, pair[0].w, pair[0].h);
    await page.setViewportSize({ width: pair[1].w, height: pair[1].h });
    await page.waitForTimeout(40);
    const lGeom = await checkGeometry(page, pair[1].w, pair[1].h);
    orientationChecks.push({
      from: `${pair[0].w}x${pair[0].h}`,
      to: `${pair[1].w}x${pair[1].h}`,
      portraitOk: pGeom.docOverflow <= 1 && pGeom.bodyOverflow <= 1 && !pGeom.headerOverlap && pGeom.badEls.length === 0,
      landscapeOk: lGeom.docOverflow <= 1 && lGeom.bodyOverflow <= 1 && !lGeom.headerOverlap && lGeom.badEls.length === 0
    });
  }

  // Desktop Preservation Checks across all 6 desktop sizes
  const desktopPreservation = [];
  for (const vp of [
    { w: 1280, h: 720 },
    { w: 1366, h: 768 },
    { w: 1440, h: 900 },
    { w: 1600, h: 900 },
    { w: 1920, h: 1080 },
    { w: 2560, h: 1440 }
  ]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await navigateState(page, 'dashboard');
    const dCheck = await page.evaluate(() => {
      const sb = document.getElementById('sidebar').getBoundingClientRect();
      const toggleHidden = getComputedStyle(document.getElementById('sidebar-toggle-btn')).display === 'none';
      const cv = getComputedStyle(document.querySelector('.content-viewport'));
      const btnH = Math.round(document.getElementById('header-create-btn').getBoundingClientRect().height);
      return {
        sidebarWidth: Math.round(sb.width),
        toggleHidden,
        contentMaxWidth: cv.maxWidth,
        headerBtnHeight: btnH
      };
    });
    desktopPreservation.push({ vp: `${vp.w}x${vp.h}`, ...dCheck });
  }

  // Touchscreen Target Measurements at 375x812
  await page.setViewportSize({ width: 375, height: 812 });
  const touchMeasurements = {};
  await navigateState(page, 'checklist-edit');
  touchMeasurements.checklistGenerator = await page.evaluate(() => ({
    sidebarToggle: (() => { const r = document.getElementById('sidebar-toggle-btn').getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; })(),
    generateBtn: (() => { const r = document.getElementById('btn-generate-checklist').getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; })(),
    modeToggleBtn: (() => { const r = document.querySelector('.qa-mode-btn').getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; })(),
    inlineActionIcon: (() => { const r = document.querySelector('.qa-icon-action-btn').getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; })()
  }));
  await navigateState(page, 'qa-runner');
  touchMeasurements.qaRunner = await page.evaluate(() => ({
    testRowHeight: Math.round(document.querySelector('.qa-runner-test-row').getBoundingClientRect().height),
    checkboxSize: (() => { const r = document.querySelector('.qa-runner-checkbox').getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; })(),
    phaseToggleSize: (() => { const r = document.querySelector('.qa-runner-phase-toggle').getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; })(),
    switcherSelectHeight: Math.round(document.querySelector('.qa-runner-select').getBoundingClientRect().height)
  }));

  // Capture Comprehensive Visual Inspection Screenshots (Dark & Light Themes)
  // 1. Small Mobile 320x568
  await page.setViewportSize({ width: 320, height: 568 });
  await navigateState(page, 'checklist-edit');
  await page.screenshot({ path: path.join(SHOTS_DIR, '01-320x568-checklist-generator.png') });
  await navigateState(page, 'qa-runner');
  await page.screenshot({ path: path.join(SHOTS_DIR, '02-320x568-qa-runner.png') });
  await navigateState(page, 'dashboard');
  await page.screenshot({ path: path.join(SHOTS_DIR, '03-320x568-dashboard.png') });
  await navigateState(page, 'reports');
  await page.screenshot({ path: path.join(SHOTS_DIR, '04-320x568-reports.png') });
  await page.click('#sidebar-toggle-btn');
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(SHOTS_DIR, '05-320x568-drawer-open.png') });
  await page.click('#sidebar-close-btn');
  await page.waitForTimeout(80);

  // 2. Small Mobile 360x640 Modal & Data Management
  await page.setViewportSize({ width: 360, height: 640 });
  await navigateState(page, 'data-export');
  await page.screenshot({ path: path.join(SHOTS_DIR, '06-360x640-data-transfer.png') });
  await navigateState(page, 'defects');
  await page.evaluate(() => document.querySelector('.btn-view-defect').click());
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(SHOTS_DIR, '07-360x640-defect-view-modal.png') });
  await page.evaluate(() => document.getElementById('view-defect-close').click());
  await page.waitForTimeout(60);

  // 3. Standard Mobile 390x844 Projects, Plans, Execution Modal
  await page.setViewportSize({ width: 390, height: 844 });
  await navigateState(page, 'projects');
  await page.screenshot({ path: path.join(SHOTS_DIR, '08-390x844-projects.png') });
  await navigateState(page, 'plans');
  await page.screenshot({ path: path.join(SHOTS_DIR, '09-390x844-plans.png') });
  await navigateState(page, 'execution');
  await page.evaluate(() => document.querySelector('.btn-run-case').click());
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(SHOTS_DIR, '10-390x844-execution-modal.png') });
  await page.evaluate(() => document.getElementById('exec-modal-close').click());
  await page.waitForTimeout(60);

  // 4. Short Landscape 640x360 & 740x360
  await page.setViewportSize({ width: 640, height: 360 });
  await navigateState(page, 'checklist-edit');
  await page.screenshot({ path: path.join(SHOTS_DIR, '11-640x360-landscape-generator.png') });
  await page.evaluate(() => document.getElementById('header-create-btn').click());
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(SHOTS_DIR, '12-640x360-landscape-project-modal.png') });
  await page.evaluate(() => document.getElementById('modal-close-btn').click());
  await page.waitForTimeout(60);

  await page.setViewportSize({ width: 740, height: 360 });
  await navigateState(page, 'qa-runner');
  await page.screenshot({ path: path.join(SHOTS_DIR, '13-740x360-landscape-runner.png') });

  // 5. Tablet Portrait 768x1024 & 820x1180
  await page.setViewportSize({ width: 768, height: 1024 });
  await navigateState(page, 'dashboard');
  await page.screenshot({ path: path.join(SHOTS_DIR, '14-768x1024-tablet-dashboard.png') });
  await navigateState(page, 'my-checklists');
  await page.screenshot({ path: path.join(SHOTS_DIR, '15-768x1024-tablet-my-checklists.png') });

  await page.setViewportSize({ width: 820, height: 1180 });
  await navigateState(page, 'execution');
  await page.screenshot({ path: path.join(SHOTS_DIR, '16-820x1180-tablet-execution.png') });

  // 6. Hybrid / Tablet Landscape 1024x768 & 1279x800
  await page.setViewportSize({ width: 1024, height: 768 });
  await navigateState(page, 'reports');
  await page.screenshot({ path: path.join(SHOTS_DIR, '17-1024x768-hybrid-reports.png') });

  await page.setViewportSize({ width: 1279, height: 800 });
  await navigateState(page, 'dashboard');
  await page.screenshot({ path: path.join(SHOTS_DIR, '18-1279x800-hybrid-dashboard.png') });

  // 7. Light Theme Verification Sweep + Screenshots
  await page.click('#theme-toggle-btn');
  await page.waitForTimeout(80);
  const lightThemeIssues = [];
  for (const vp of [{ w: 320, h: 568 }, { w: 390, h: 844 }, { w: 640, h: 360 }, { w: 768, h: 1024 }, { w: 1024, h: 768 }, { w: 1366, h: 768 }]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    for (const st of ['checklist-edit', 'qa-runner', 'dashboard', 'reports', 'data-export']) {
      await navigateState(page, st);
      const res = await checkGeometry(page, vp.w, vp.h);
      if (res.docOverflow > 1 || res.bodyOverflow > 1 || res.headerOverlap || res.badEls.length > 0) {
        lightThemeIssues.push({ vp: `${vp.w}x${vp.h}`, state: st, ...res });
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await navigateState(page, 'dashboard');
  await page.screenshot({ path: path.join(SHOTS_DIR, '19-390x844-light-dashboard.png') });
  await page.setViewportSize({ width: 768, height: 1024 });
  await navigateState(page, 'reports');
  await page.screenshot({ path: path.join(SHOTS_DIR, '20-768x1024-light-reports.png') });

  // Switch back to dark theme for Desktop Preservation Screenshots
  await page.click('#theme-toggle-btn');
  await page.waitForTimeout(60);
  await page.setViewportSize({ width: 1366, height: 768 });
  await navigateState(page, 'dashboard');
  await page.screenshot({ path: path.join(SHOTS_DIR, '21-1366x768-desktop-preserved.png') });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await navigateState(page, 'reports');
  await page.screenshot({ path: path.join(SHOTS_DIR, '22-1920x1080-desktop-reports-preserved.png') });

  // Additional Section 23 View Coverage Screenshots
  await page.setViewportSize({ width: 430, height: 932 });
  await navigateState(page, 'checklist-clean');
  await page.screenshot({ path: path.join(SHOTS_DIR, '23-430x932-clean-preview.png') });
  await navigateState(page, 'project-details');
  await page.screenshot({ path: path.join(SHOTS_DIR, '24-430x932-project-details.png') });
  await navigateState(page, 'plans-cases');
  await page.screenshot({ path: path.join(SHOTS_DIR, '25-430x932-plans-cases.png') });
  await navigateState(page, 'defects');
  await page.screenshot({ path: path.join(SHOTS_DIR, '26-430x932-defects.png') });
  await navigateState(page, 'settings');
  await page.screenshot({ path: path.join(SHOTS_DIR, '27-430x932-settings.png') });

  const report = {
    totalViewports: VIEWPORTS.length,
    totalStatesPerViewport: STATES.length,
    totalCombinationsChecked: VIEWPORTS.length * STATES.length,
    viewIssuesCount: viewIssues.length,
    viewIssues,
    modalIssuesCount: modalIssues.length,
    modalIssues,
    lightThemeIssuesCount: lightThemeIssues.length,
    lightThemeIssues,
    drawerChecks,
    orientationChecks,
    desktopPreservation,
    touchMeasurements,
    matrixResults
  };

  fs.writeFileSync('.audit-tmp/verify-report.json', JSON.stringify(report, null, 2));
  console.log(`VERIFY COMPLETE: viewIssues=${viewIssues.length}, modalIssues=${modalIssues.length}, lightThemeIssues=${lightThemeIssues.length}`);

  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
