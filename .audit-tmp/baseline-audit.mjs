import { chromium } from 'playwright';

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
  { cat: 'D. Landscape', w: 1024, h: 768 },
  { cat: 'D. Landscape', w: 1180, h: 820 },
  { cat: 'D. Landscape', w: 1194, h: 834 },
  // E. Intermediate / Hybrid Layouts (unique sizes added: 1024x800, 1100x700, 1279x800)
  { cat: 'E. Hybrid', w: 1024, h: 800 },
  { cat: 'E. Hybrid', w: 1100, h: 700 },
  { cat: 'E. Hybrid', w: 1279, h: 800 },
  // F. Desktop Preservation
  { cat: 'F. Desktop', w: 1280, h: 720 },
  { cat: 'F. Desktop', w: 1366, h: 768 },
  { cat: 'F. Desktop', w: 1920, h: 1080 },
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

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });

  // Seed data & generate a checklist + start testing once so both generator & runner have rich content
  await page.evaluate((projects) => {
    localStorage.setItem('qavora_projects_v1', JSON.stringify(projects));
    localStorage.setItem('qavora_activities_v1', JSON.stringify([
      { id: 'a1', action: 'Executed test case', target: 'TC-002 (Fail)', timestamp: new Date().toISOString() },
      { id: 'a2', action: 'Created defect', target: 'DEF-001: Applying expired discount code resets billing address fields', timestamp: new Date().toISOString() }
    ]));
  }, SEED_PROJECTS);

  await page.reload({ waitUntil: 'networkidle' });

  // Populate checklist generator & create 1 saved checklist + re-populate generator preview for Edit & Review
  await page.fill('#qa-plan-textarea', SAMPLE_RAW_PLAN);
  await page.click('#btn-generate-checklist');
  await page.click('#btn-start-testing-top');
  // Also generate transfer code in Data Management so transfer code output panel is visible!
  await page.evaluate(() => {
    document.querySelector('[data-view="data"]').click();
  });
  await page.click('#btn-generate-transfer-code');
  await page.waitForTimeout(150);

  // Also re-populate generator preview so Edit & Review is active when we visit checklist-generator
  await page.evaluate(() => {
    document.querySelector('[data-view="checklist-generator"]').click();
  });
  await page.fill('#qa-plan-textarea', SAMPLE_RAW_PLAN);
  await page.click('#btn-generate-checklist');

  const VIEWS = [
    'checklist-generator',
    'my-checklists',
    'qa-runner',
    'dashboard',
    'projects',
    'project-details',
    'plans',
    'plans-cases',
    'execution',
    'defects',
    'reports',
    'data',
    'settings'
  ];

  const issues = [];

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.waitForTimeout(40);

    for (const view of VIEWS) {
      if (view === 'project-details') {
        await page.evaluate(() => {
          document.querySelector('[data-view="projects"]').click();
        });
        await page.click('.btn-open-project');
      } else if (view === 'plans-cases') {
        await page.evaluate(() => {
          document.querySelector('[data-view="plans"]').click();
          const backBtn = document.getElementById('cases-back-to-phases-btn');
          if (backBtn && backBtn.offsetParent !== null) backBtn.click();
          const openBtn = document.querySelector('#plans-phases-subview .btn-open-suite');
          if (openBtn) openBtn.click();
        });
      } else {
        await page.evaluate((v) => {
          document.querySelector(`[data-view="${v}"]`).click();
          if (v === 'plans') {
            const backBtn = document.getElementById('cases-back-to-phases-btn');
            if (backBtn && backBtn.offsetParent !== null) backBtn.click();
          }
        }, view);
      }
      await page.waitForTimeout(25);

      const res = await page.evaluate(({ vw, vh, viewName }) => {
        const docOverflow = document.documentElement.scrollWidth - vw;
        const bodyOverflow = document.body.scrollWidth - vw;
        const badEls = [];

        // Check visible elements extending past right edge of viewport (excluding inside intentional horizontal scroll containers)
        const all = document.querySelectorAll('.top-nav, .view-section.active *');
        for (const el of all) {
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;

          // Skip elements inside an ancestor with overflow-x: auto or scroll
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

        // Check header overlap
        const navLeft = document.querySelector('.top-nav-left')?.getBoundingClientRect();
        const navRight = document.querySelector('.top-nav-right')?.getBoundingClientRect();
        const headerOverlap = navLeft && navRight && navLeft.right > navRight.left + 1;

        return {
          docOverflow,
          bodyOverflow,
          headerOverlap,
          badEls
        };
      }, { vw: vp.w, vh: vp.h, viewName: view });

      if (res.docOverflow > 1 || res.bodyOverflow > 1 || res.headerOverlap || res.badEls.length > 0) {
        issues.push({
          vp: `${vp.w}x${vp.h}`,
          cat: vp.cat,
          view,
          ...res
        });
      }
    }
  }

  // Also test modals at 320x568, 360x640, 640x360, 768x1024
  const MODAL_VPS = [
    { w: 320, h: 568 },
    { w: 360, h: 640 },
    { w: 640, h: 360 },
    { w: 768, h: 1024 }
  ];

  const modalIssues = [];
  for (const vp of MODAL_VPS) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    // Test Defect View Modal, Execution Modal, Test Case Modal, Import Preview, Reset Confirm, Project Modal, QA Delete Modal
    const modalChecks = [
      {
        name: 'project-modal',
        open: () => document.getElementById('header-create-btn').click(),
        close: () => document.getElementById('modal-close-btn').click()
      },
      {
        name: 'execution-modal',
        open: () => {
          document.querySelector('[data-view="execution"]').click();
          document.querySelector('.btn-run-case').click();
        },
        close: () => document.getElementById('exec-modal-close').click()
      },
      {
        name: 'defect-view-modal',
        open: () => {
          document.querySelector('[data-view="defects"]').click();
          document.querySelector('.btn-view-defect').click();
        },
        close: () => document.getElementById('view-defect-close').click()
      },
      {
        name: 'defect-modal',
        open: () => {
          document.querySelector('[data-view="defects"]').click();
          document.getElementById('btn-create-defect').click();
        },
        close: () => document.getElementById('defect-modal-close').click()
      },
      {
        name: 'testcase-modal',
        open: () => {
          document.querySelector('[data-view="plans"]').click();
          const sBtn = document.querySelector('.btn-open-suite');
          if (sBtn) sBtn.click();
          document.getElementById('suite-add-case-btn').click();
        },
        close: () => document.getElementById('case-modal-close').click()
      },
      {
        name: 'reset-confirm-modal',
        open: () => {
          document.querySelector('[data-view="settings"]').click();
          document.getElementById('btn-trigger-reset-modal').click();
        },
        close: () => document.getElementById('reset-modal-close').click()
      },
      {
        name: 'qa-checklist-delete-modal',
        open: () => {
          document.querySelector('[data-view="my-checklists"]').click();
          document.querySelector('.qa-mychk-actions .btn-danger-outline').click();
        },
        close: () => document.getElementById('qa-chk-delete-cancel').click()
      }
    ];

    for (const mc of modalChecks) {
      await page.evaluate(mc.open);
      await page.waitForTimeout(40);
      const mRes = await page.evaluate(({ vw, vh, mId }) => {
        const backdrop = document.getElementById(mId);
        const card = backdrop?.querySelector('.modal-dialog');
        if (!card) return null;
        const cr = card.getBoundingClientRect();
        const overRight = cr.right - vw;
        const overBottom = cr.bottom - vh;
        const overTop = -cr.top;
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
            badInner.push({ tag: el.tagName.toLowerCase(), id: el.id, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 50), right: Math.round(r.right), cardRight: Math.round(cr.right) });
            if (badInner.length >= 3) break;
          }
        }
        return {
          cardW: Math.round(cr.width),
          cardH: Math.round(cr.height),
          overRight: Math.round(overRight),
          overBottom: Math.round(overBottom),
          overTop: Math.round(overTop),
          badInner
        };
      }, { vw: vp.w, vh: vp.h, mId: mc.name });

      if (mRes && (mRes.overRight > 1 || mRes.overBottom > 1 || mRes.overTop > 1 || mRes.badInner.length > 0)) {
        modalIssues.push({ vp: `${vp.w}x${vp.h}`, modal: mc.name, ...mRes });
      }
      await page.evaluate(mc.close);
      await page.waitForTimeout(20);
    }
  }

  // Touch target size audit at 375x812
  await page.setViewportSize({ width: 375, height: 812 });
  const smallTargets = [];
  for (const view of ['checklist-generator', 'qa-runner', 'my-checklists', 'projects', 'plans', 'execution', 'defects', 'data']) {
    await page.evaluate((v) => document.querySelector(`[data-view="${v}"]`).click(), view);
    await page.waitForTimeout(30);
    const small = await page.evaluate((v) => {
      const found = [];
      const seen = new Set();
      for (const el of document.querySelectorAll('.top-nav button, .view-section.active button, .view-section.active input[type="checkbox"], .view-section.active select')) {
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < 38 || r.width < 38) {
          const key = `${el.tagName}.${(typeof el.className === 'string' ? el.className : '').trim()}`;
          if (!seen.has(key)) {
            seen.add(key);
            found.push({ view: v, key, w: Math.round(r.width), h: Math.round(r.height) });
          }
        }
      }
      return found;
    }, view);
    smallTargets.push(...small);
  }

  console.log('=== VIEW OVERFLOW / GEOMETRY ISSUES ===');
  console.log(JSON.stringify(issues, null, 2));
  console.log('=== MODAL ISSUES ===');
  console.log(JSON.stringify(modalIssues, null, 2));
  console.log('=== SMALL TOUCH TARGETS (<38px) AT 375x812 ===');
  console.log(JSON.stringify(smallTargets, null, 2));

  await browser.close();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
