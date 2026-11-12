# QAVORA WEB — COMPLETE UI INVENTORY & REFERENCE AUDIT

**Repository:** `Hannankhan203/Qavora-MongoDB-Integrated`  
**Audit Scope:** Full read-only, source-code-verified UI and UX inventory of the Qavora Web application (`index.html`, `style.css`, `script.js`, `authController.js`, `authUI.js`, `checklistGeneratorUI.js`, `qaRunnerUI.js`, `qaChecklistStore.js`, `qaChecklistSyncQueue.js`, `qaParser.js`, `qaReportGenerator.js`, `src/modules/*.js`, and `server.ts`).

---

## 1. Application Overview

### 1.1 Purpose & Core Value Proposition
**Qavora** is a full-stack, offline-capable **Manual QA Testing Management Platform** designed with a modern dark/light SaaS aesthetic (modeled after Linear and Notion). It provides two complementary QA workflows within a single Single-Page Application (SPA):

1. **Formal Structured QA Workspace (`Projects` -> `Test Plans & Phases` -> `Test Suites` -> `Test Cases` -> `Test Execution & Runs` -> `Defects` -> `Reports & Analytics`):**
   - Organizes software testing around formal **Projects** (`Web Application`, `Mobile App`, `API / Backend`, `Desktop App`, `SaaS Platform`, `E-Commerce`, `Microservices`, `Other`).
   - Supports hierarchical **Test Plans** containing ordered **Execution Phases** (e.g., Smoke, Regression, UAT), modular **Test Suites**, and step-by-step **Test Cases** with priority (`Critical`, `High`, `Medium`, `Low`), type (`Functional`, `UI / UX`, `Smoke`, `Regression`, `Security`, `API`, `Performance`, `Edge Case`, `Accessibility`), preconditions, and expected outcomes.
   - Provides a **Test Execution & Results** engine with named **Test Runs / Cycles** (`In Progress`, `Completed`, `Discarded`), step-level verification (`Pass`, `Fail`, `Skip`), quick 1-click Pass/Fail actions, per-case execution history timelines, and inline **Defect** logging directly from failed executions.
   - Includes a dedicated **Defects & Issues** tracker (`Critical`, `High`, `Medium`, `Low` severity; `Open`, `In Progress`, `Resolved`, `Closed`, `Reopened` status) linked to projects, suites, test cases, and execution records.
   - Generates real-time **Reports & Analytics** (11 KPI cards, automated QA Health Insights, SVG Test Execution Status Donut Chart, SVG Execution Velocity & Pass Trend Chart, Phase Coverage, Priority Breakdown, Suite Quality, and Defect Distribution tables).

2. **Rapid Plain-Text / Markdown QA Checklist Engine (`QA Checklist Generator` -> `My QA Checklists` -> `Manual QA Test Runner`):**
   - Converts raw, unstructured plain-text or Markdown QA plans (including AI-generated plans from ChatGPT/Claude, bullet lists, numbered steps, or phase headers) into structured, interactive checklists via a deterministic client-side parser (`/qaParser.js`).
   - Allows inline editing of parsed phases, categories, test items, supporting notes, and unclassified lines before saving.
   - Provides a dedicated **Manual QA Test Runner** (`#view-qa-runner`) with interactive checkboxes, click-to-cycle status badges (`Not Started` -> `Passed` -> `Failed` -> `Skipped`), phase collapse/expand, inline CRUD, completion workflows, downloadable Markdown/Text reports (`/qaReportGenerator.js`), and 1-click **Promotion of a QA Checklist into a Formal QA Project**.

### 1.2 Technical & Runtime Architecture
- **Frontend Architecture:** Vanilla ES Modules (`type="module"` in `/index.html` loading `/script.js`) bundled with Vite (`^8.3.0`). All application screens and modals live inside a single HTML document (`/index.html`, 6,033 lines) and are styled by a single comprehensive stylesheet (`/style.css`, 12,676 lines).
- **Routing:** Client-side HTML5 History API router (`navigateTo`, `resolveInitialRoute`, `window.addEventListener('popstate')` in `/src/modules/uiRenderer.js` lines 155–265) using clean pathname slugs (`/dashboard`, `/projects`, `/project-details`, `/plans`, `/execution`, `/defects`, `/reports`, `/checklist-generator`, `/my-checklists`, `/qa-runner`, `/data`, `/settings`) plus query parameters (`?projectId=...`, `?checklistId=...`, `?subview=cases&suiteId=...`).
- **Authentication & Session Security:** JWT session stored in `HttpOnly` cookies (`/authController.js`, `/server.ts`), paired with an in-memory CSRF token sent via the `X-CSRF-Token` request header (`/src/modules/apiClient.js` lines 25–35) and user-scoped data isolation (`userId` on all MongoDB documents and IndexedDB records).
- **Persistence & Offline-First Synchronization:**
  - **Primary Backend:** Express 5 + MongoDB Atlas (`/server.ts`, `/api/index.ts`).
  - **Offline Sync Engine:** IndexedDB database `qavora_offline_db` (version 2) managed by `/qaChecklistSyncQueue.js` (3,009 lines), with 5 object stores (`pending_checklist_operations`, `offline_checklists_cache`, `pending_project_operations`, `offline_projects_cache`, `sync_locks`), cross-tab `BroadcastChannel('qavora_offline_sync_channel')`, Web Locks API coordination, dependency-ordered operation replay (`DEPENDENCY_RANKS`), exponential backoff retry, and HTTP 409 optimistic concurrency conflict resolution UI (`#offline-sync-modal`).
  - **Checklist Local Fallback:** Dual persistence in `localStorage` (`qavora_saved_checklists_v1`, `qavora_active_checklist_id_v1`) and MongoDB (`/api/checklists`) via `/qaChecklistStore.js`.

---

## 2. Complete Screen Inventory

### 2.1 Top-Level Root Containers (`/index.html`)

| Container ID | DOM Element / Class | Purpose | Visibility Control | Source Reference |
| :--- | :--- | :--- | :--- | :--- |
| `#sidebar-overlay` | `<div class="sidebar-overlay">` | Mobile/tablet backdrop overlay behind slide-out navigation drawer | `.active` class toggled by `openMobileSidebar()` / `closeMobileSidebar()` | `/index.html:26`, `/src/modules/uiRenderer.js:304-322` |
| `#auth-loading-overlay` | `<div class="auth-loading-overlay">` | Full-viewport z-index `99999` splash spinner shown during initial `/api/auth/me` session check | Hidden via `.auth-hidden` & `display: none` once auth state resolves | `/index.html:29-48`, `/authUI.js:126-152` |
| `#auth-container` | `<div class="auth-container">` | Unauthenticated full-screen authentication gate (Sign In & Create Account tabs) | Shown when `state === 'unauthenticated'`; sets `body.auth-view-active` | `/index.html:51-323`, `/authUI.js:154-205` |
| `#app-container` | `<div class="app-container">` | Main authenticated application shell containing `#app-sidebar`, `.main-wrapper`, `.top-nav`, and `#main-content` | Shown when `state === 'authenticated'`; hidden via `.app-hidden` when logged out | `/index.html:326-4090`, `/authUI.js:154-205` |
| `#toast-container` | `<div class="toast-container">` | Fixed bottom-right stack for transient toast notifications (`success`, `danger`, `warning`, `info`) | Populated dynamically by `showToast()` (3.5s auto-dismiss) | `/index.html:5538`, `/src/modules/uiRenderer.js:46-95` |
| `#printable-report-container` | `<div class="printable-report-container">` | Hidden print container in DOM (`display: none` on screen, `display: block` in `@media print`) | Unused by JS (`generatePrintableReport` opens a new print window instead) | `/index.html:5541`, `/style.css:6126-6128`, `/src/modules/dataManager.js:715-725` |

### 2.2 Global Shell Components (Persistent in `#app-container`)

| Component | DOM Selector | Purpose | Source Reference |
| :--- | :--- | :--- | :--- |
| **Left Navigation Sidebar** | `#app-sidebar` (`<aside class="sidebar">`) | Fixed 256px left navigation panel (slide-out drawer `<1024px`) with brand header, 3 navigation groups (11 links), DB status indicator, and user profile/logout footer | `/index.html:329-473`, `/src/modules/uiRenderer.js:295-327` |
| **Top Header Bar** | `<header class="top-nav">` | Sticky 64px top bar with mobile hamburger button, dynamic view title/subtitle, quick search box, offline sync badge, "+ New Project" CTA, theme toggle, notifications bell, user profile trigger, and Sign Out button | `/index.html:479-670`, `/src/modules/uiRenderer.js:120-153` |
| **Notification Center Panel** | `#notification-panel` (`<div class="notification-panel">`) | Dropdown popover anchored to `#notification-btn` displaying notification items or empty state | `/index.html:553-581`, `/src/modules/uiRenderer.js:330-404` |
| **Account Profile Dropdown** | `#account-dropdown-menu` (`<div class="account-dropdown-menu">`) | Dropdown menu anchored to `#header-user-profile` showing user avatar, name, email, role badge, navigation shortcuts, and Sign Out action | `/index.html:596-652`, `/src/modules/uiRenderer.js:406-484` |

### 2.3 Primary Application Views (`<section class="view-section">` inside `#main-content`)

| # | Route Key | URL Path | DOM Section ID | Top Bar Title (`VIEW_META`) | Primary Controller Module | Source Reference |
| :- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `dashboard` | `/dashboard` (or `/`) | `#view-dashboard` | `Dashboard` | `/src/modules/dashboardManager.js` | `/index.html:1428-1652` |
| 2 | `projects` | `/projects` | `#view-projects` | `Projects` | `/src/modules/projectManager.js` | `/index.html:1657-1780` |
| 3 | `project-details` | `/project-details?projectId=<id>` | `#view-project-details` | `<Project Name>` (or `Project Details`) | `/src/modules/projectManager.js` | `/index.html:1785-1990` |
| 4 | `plans` | `/plans?projectId=<id>` | `#view-plans` | `Test Plans & Suites` | `/src/modules/testPlanManager.js` | `/index.html:1995-2320` |
| 4a | `plans` (Sub-view A) | `/plans?projectId=<id>` | `#plans-phases-subview` | `Test Plans & Suites` (Phases & Suites Overview) | `/src/modules/testPlanManager.js` | `/index.html:2063-2191` |
| 4b | `plans` (Sub-view B) | `/plans?projectId=<id>&subview=cases&suiteId=<id>` | `#plans-cases-subview` | `Test Plans & Suites` (Suite Explorer & Test Cases) | `/src/modules/testPlanManager.js` | `/index.html:2194-2318` |
| 5 | `execution` | `/execution?projectId=<id>` | `#view-execution` | `Test Execution` | `/src/modules/executionManager.js` | `/index.html:2323-2589` |
| 6 | `defects` | `/defects` | `#view-defects` | `Defects & Issues` | `/src/modules/defectManager.js` | `/index.html:2593-2745` |
| 7 | `reports` | `/reports` | `#view-reports` | `Reports & Analytics` | `/src/modules/reportsManager.js` | `/index.html:2749-2916` |
| 8 | `settings` | `/settings` | `#view-settings` | `Settings` | `/src/modules/settingsManager.js` | `/index.html:2919-3259` |
| 9 | `checklist-generator` | `/checklist-generator` | `#view-checklist-generator` | `QA Checklist Generator` | `/checklistGeneratorUI.js` | `/index.html:3264-3465` |
| 10 | `my-checklists` | `/my-checklists` | `#view-my-checklists` | `My QA Checklists` | `/qaRunnerUI.js` | `/index.html:3468-3579` |
| 11 | `qa-runner` | `/qa-runner?checklistId=<id>` | `#view-qa-runner` | `<Checklist Title>` (or `QA Test Runner`) | `/qaRunnerUI.js` | `/index.html:3582-3701` |
| 12 | `data` | `/data` | `#view-data` | `Data Management` | `/src/modules/dataManager.js` | `/index.html:3706-4087` |

### 2.4 Modal Dialogs Inventory (20 Modals in `/index.html`)

| # | Modal DOM ID | Dialog Size Class | Title / Purpose | Triggered By | Controller Module | Source Reference |
| :- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `#offline-sync-modal` | `.modal-dialog-lg` | **Offline Sync Queue & Conflict Resolution** (Pending, Failed, Conflicted operations, Sync Now, Retry All, Keep My Changes vs Use Server Version) | `#offline-sync-status-btn` in top nav | `/src/modules/uiRenderer.js` + `/qaChecklistSyncQueue.js` | `/index.html:673-1421` |
| 2 | `#project-modal` | `.modal-dialog` | **Create New Project / Edit Project** (Name, Type, Version, Status, Environment, Base URL, Description, Tags) | `+ New Project` buttons (`#header-create-btn`, `#welcome-create-btn`, `#projects-view-create-btn`, etc.) or `Edit` on project | `/src/modules/uiRenderer.js` + `/src/modules/projectManager.js` | `/index.html:4095-4243` |
| 3 | `#delete-confirm-modal` | `.modal-dialog-sm` | **Universal Delete Confirmation** (Deletes Project, Execution Phase, Test Suite, Test Case, or Defect) | Delete buttons across Projects, Plans, Suites, Cases, Defects | `/src/modules/uiRenderer.js` (`confirmPendingDelete`) | `/index.html:4246-4293` |
| 4 | `#testplan-modal` | `.modal-dialog-lg` | **Create / Edit Test Plan** (Title, Version, Target Release, Status, Objective, Scope & Out-of-Scope, Environment/Browsers, Entry/Exit Criteria) | `#btn-edit-testplan`, `#empty-create-plan-btn`, `#btn-detail-edit-plan` | `/src/modules/testPlanManager.js` | `/index.html:4298-4427` |
| 5 | `#phase-modal` | `.modal-dialog` | **Create / Edit Execution Phase** (Phase Name, Sequence Order, Entry Gate/Focus, Description) | `#btn-add-phase`, `#btn-empty-add-phase`, `.btn-edit-phase` | `/src/modules/testPlanManager.js` | `/index.html:4430-4510` |
| 6 | `#suite-modal` | `.modal-dialog` | **Create / Edit Test Suite** (Suite Name, Module/Feature Tag, Execution Phase assignment, Priority, Description) | `#btn-add-suite`, `.btn-add-suite-phase`, `.btn-edit-suite`, `#btn-explorer-edit-suite` | `/src/modules/testPlanManager.js` | `/index.html:4513-4616` |
| 7 | `#testcase-modal` | `.modal-dialog-lg` | **Create / Edit Test Case** (Title, Target Suite, Priority, Type, Est. Time, Requirement ID, Preconditions, Dynamic Step Builder, Expected Result, Test Data) | `#btn-add-testcase`, `#btn-explorer-add-case`, `.btn-edit-case`, `#btn-view-case-edit` | `/src/modules/testPlanManager.js` | `/index.html:4619-4779` |
| 8 | `#testcase-view-modal` | `.modal-dialog-lg` | **Test Case Specification Read-Only Inspector** (Badges, Metadata Grid, Preconditions, Test Data, Steps Table, Overall Expected Result, Edit CTA) | Clicking a test case row/view button in `#plans-cases-subview` | `/src/modules/testPlanManager.js` | `/index.html:4782-4880` |
| 9 | `#execution-modal` | `.modal-dialog-lg` | **Execute Test Case Runner** (4 Status Radio Cards, Tester Name, Environment, Duration, Build Version, Step-by-Step Pass/Fail/Skip verifier, Notes, Evidence URL, Inline Defect Creator) | `Execute` / `Re-run` button on any test case in `#view-execution` or `#plans-cases-subview` | `/src/modules/executionManager.js` | `/index.html:4885-5092` |
| 10 | `#execution-history-modal` | `.modal-dialog-lg` | **Test Case Execution History Timeline** (Summary stats + chronological execution log with step outcomes, notes, evidence links, linked defects) | `History` button on any test case row in `#view-execution` | `/src/modules/executionManager.js` | `/index.html:5095-5162` |
| 11 | `#defect-modal` | `.modal-dialog-lg` | **Report New Defect / Edit Defect** (Title, Project, Severity, Priority, Status, Environment, Assigned To, Linked Suite, Linked Case, Steps to Reproduce, Expected vs Actual Result, Evidence URL) | `#btn-report-defect`, `#btn-empty-report-defect`, Edit defect button | `/src/modules/defectManager.js` | `/index.html:5167-5335` |
| 12 | `#defect-view-modal` | `.modal-dialog-lg` | **Defect Detail Inspector** (Severity/Priority/Status badges, Quick Status Selector dropdown, 8-cell Metadata Grid, Linked Test Case banner, Description/Steps, Expected vs Actual comparison, Edit CTA) | Clicking defect title or View icon in `#view-defects` or `#execution-history-modal` | `/src/modules/defectManager.js` | `/index.html:5338-5474` |
| 13 | `#qa-checklist-delete-modal` | `.modal-dialog-sm` | **Delete QA Checklist Confirmation** | Delete button on a checklist card in `#view-my-checklists` | `/qaRunnerUI.js` | `/index.html:5479-5525` |
| 14 | `#qa-checklist-promote-modal` | `.modal-dialog` | **Promote QA Checklist to Formal Project** (Project Name, Type, Description, Environment, Mapping Preview showing Phases -> Suites -> Test Cases reset to `Not Run`) | `Promote to Project` button in `#view-my-checklists` or `#view-qa-runner` | `/qaRunnerUI.js` + `/qaChecklistStore.js` | `/index.html:5546-5650` |
| 15 | `#qa-complete-testing-modal` | `.modal-dialog` | **Complete Checklist Testing Confirmation** (Live counts of Passed/Failed/Skipped/Remaining, Warning banner if incomplete items remain, Optional Tester Notes) | `#btn-runner-complete-testing` in `#view-qa-runner` | `/qaRunnerUI.js` | `/index.html:5653-5745` |
| 16 | `#qa-completion-report-modal` | `.modal-dialog-xl` | **Test Completion Report Viewer & Exporter** (Visual Report, Markdown Preview, Plain Text Preview tabs; AI Follow-Up Prompt generator; Copy & Download `.md`/`.txt` actions) | Automatically opened after completing checklist testing, or via `#btn-runner-view-report` / `Report` button in `#view-my-checklists` | `/qaRunnerUI.js` + `/qaReportGenerator.js` | `/index.html:5748-5865` |
| 17 | `#import-preview-modal` | `.modal-dialog-lg` | **Validate & Preview JSON Workspace Import** (File metadata, 5 entity counts, Validation warnings, Conflict Resolution Strategy radio buttons: Smart Merge vs Replace Entire Workspace) | Uploading/dropping a `.json` file in `#view-data` (`#import-file-input`) | `/src/modules/dataManager.js` | `/index.html:5870-5978` |
| 18 | `#reset-confirm-modal` | `.modal-dialog-sm` | **Reset Workspace / Clear All QA Data Confirmation** (Optional auto-download backup checkbox `#reset-auto-backup-checkbox`, dynamically injected `#btn-confirm-reset-workspace`) | `#btn-trigger-reset-modal` in `#view-data` (Danger Zone) | `/src/modules/dataManager.js` | `/index.html:5981-6028` |
| 19 | `#execution-run-modal` | `.modal-dialog` | **Start New Test Run / Cycle** (Run Name, Target Environment, Build/Release Version, Tester Name, Run Notes) — *Dynamically injected into `document.body` on demand* | `#btn-start-exec-run` in `#view-execution` | `/src/modules/executionManager.js` (`ensureRunModalsInDOM`) | `/src/modules/executionManager.js:154-244` |
| 20 | `#project-runs-history-modal` | `.modal-dialog-lg` | **Project Test Runs / Cycles History** (Chronological table of active and past execution runs with Pass Rate, Passed/Failed/Blocked/Skipped counts) — *Dynamically injected into `document.body` on demand* | `#btn-view-exec-runs` in `#view-execution` | `/src/modules/executionManager.js` (`ensureRunModalsInDOM`) | `/src/modules/executionManager.js:247-293` |

*(Note: 18 modals are statically declared in `/index.html`, and 2 additional modals — `#execution-run-modal` and `#project-runs-history-modal` — are dynamically created and appended to `document.body` by `ensureRunModalsInDOM()` in `/src/modules/executionManager.js` lines 154–294, bringing the total modal count to **20**.)*

---

## 3. Screen-by-Screen UI Documentation

### 3.1 Session Restoration Loading Overlay (`#auth-loading-overlay`)
- **Screen Name & Purpose:** Full-viewport loading screen displayed while Qavora verifies the user's `HttpOnly` session cookie against `GET /api/auth/me` during application startup.
- **How Users Navigate To It:** Automatically displayed on initial page load (`initializing` state in `/authController.js`).
- **Main Layout & Structure:** Fixed full-screen flex container (`z-index: 99999`, background `#0b0f19`) centered vertically and horizontally.
- **Visible UI Components:**
  - `.auth-loading-logo`: Brand icon (`44x44px` indigo-blue gradient cube SVG) + `Qavora` title + `Manual QA` tag.
  - `.auth-loading-spinner`: `36x36px` animated circular border spinner (`@keyframes authSpin`).
  - `.auth-loading-text`: Status copy `"Verifying session..."`.
- **Available Actions & Interactions:** None (blocks pointer events until `/api/auth/me` responds or times out).
- **Responsive Behavior:** Centered across all viewports (`100vw` x `100dvh`).
- **Source Files:** `/index.html:29-48`, `/authUI.js:126-152`, `/authController.js:186-254`, `/style.css:9031-9095`.

---

### 3.2 Authentication Screen — Sign In & Create Account (`#auth-container`)
- **Screen Name & Purpose:** Unified authentication gate providing **Sign In** (`#auth-login-panel`) and **Create Account** (`#auth-register-panel`) workflows.
- **How Users Navigate To It:** Shown automatically whenever `authController` transitions to `'unauthenticated'` (initial load without valid session, clicking any Sign Out button, or receiving an unrecoverable `401 Unauthorized` when not in offline mode).
- **Main Layout & Structure:**
  - Centered `.auth-card-wrapper` (`max-width: 440px` on desktop, `480px` on tablet) over a radial indigo-glow dark background.
  - `.auth-brand-header`: Large Qavora layered-cube SVG icon, `h1.auth-brand-title` (`"Qavora"`), and `.auth-brand-subtitle` (`"Manual QA Testing Platform"`).
  - `.auth-card`: Surface card containing `.auth-tabs` segmented switcher, shared error/success alert banners, and the active form panel.
- **Visible UI Components & Forms:**
  1. **Auth View Switcher Tabs (`.auth-tabs`, `role="tablist"`):**
     - `#auth-tab-login` (`"Sign In"`) — activates `#auth-login-panel`.
     - `#auth-tab-register` (`"Create Account"`) — activates `#auth-register-panel`.
  2. **Feedback Alert Banners:**
     - `#auth-error-alert` (`.auth-alert-error`): Red alert box with exclamation icon and `#auth-error-message`.
     - `#auth-success-alert` (`.auth-alert-success`): Green alert box with checkmark icon and `#auth-success-message`.
  3. **Sign In Form (`#auth-login-form` inside `#auth-login-panel`):**
     - Heading: `"Welcome back"` / Subheading: `"Sign in to access your QA projects, test plans, and checklists."`
     - **Email Address (`#login-email-input`):** `<input type="email" required autocomplete="email">`, placeholder `"name@company.com"`, inline error `#login-email-error`.
     - **Password (`#login-password-input`):** `<input type="password" required autocomplete="current-password">`, placeholder `"Enter your password"`, eye/eye-off visibility toggle button `#login-password-toggle`, inline error `#login-password-error`.
     - **Submit Button (`#login-submit-btn`):** Primary full-width button with `#login-submit-text` (`"Sign In"`) and hidden spinner `#login-submit-spinner` (changes text to `"Signing in..."` while in flight).
     - **Footer Switch Link:** `"Don't have an account?"` + `#auth-switch-to-register` (`"Create one now"`).
  4. **Create Account Form (`#auth-register-form` inside `#auth-register-panel`):**
     - Heading: `"Create your account"` / Subheading: `"Start organizing manual QA test plans, executions, and defect tracking."`
     - **Full Name (`#register-name-input`):** `<input type="text" required maxlength="100" autocomplete="name">`, placeholder `"Alex Morgan"`, inline error `#register-name-error`.
     - **Email Address (`#register-email-input`):** `<input type="email" required autocomplete="email">`, placeholder `"alex@company.com"`, inline error `#register-email-error`.
     - **Role / Title (`#register-role-input`):** `<input type="text" maxlength="60">`, optional (`"Optional"` hint), placeholder `"e.g. QA Lead, Manual Tester, Product Manager"`. Defaults to `"QA Engineer"` in `authUI.js:405` (or `"QA Tester"` on backend) if left blank.
     - **Password (`#register-password-input`):** `<input type="password" required minlength="8" autocomplete="new-password">`, hint `"Min. 8 characters"`, placeholder `"Create a strong password"`, visibility toggle `#register-password-toggle`, inline error `#register-password-error`.
     - **Confirm Password (`#register-confirm-password-input`):** `<input type="password" required minlength="8" autocomplete="new-password">`, placeholder `"Repeat your password"`, visibility toggle `#register-confirm-password-toggle`, inline error `#register-confirm-password-error`.
     - **Submit Button (`#register-submit-btn`):** Primary full-width button with `#register-submit-text` (`"Create Account"`) and spinner `#register-submit-spinner` (changes text to `"Creating account..."` while in flight).
     - **Footer Switch Link:** `"Already have an account?"` + `#auth-switch-to-login` (`"Sign in"`).
- **Available Actions & Validation Behavior (`/authUI.js`):**
  - Client-side validation runs before network calls: checks email regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, password non-empty on login, name >= 2 chars on registration, password >= 8 chars on registration, and password === confirmPassword.
  - Typing in any field automatically clears its field-level error (`#*-error`) and `.input-error` border class.
  - Submitting calls `authController.login()` (`POST /api/auth/login`) or `authController.register()` (`POST /api/auth/register`).
  - **Password Reset / Forgot Password:** *Not present.* There is no "Forgot Password" link or password recovery screen on the unauthenticated login view (password changing is only available to authenticated users inside `#view-settings`).
- **Responsive Behavior:**
  - On desktop (`>=1024px`) and tablet (`600px–1023px`), `.auth-card` renders as an elevated surface card with border and shadow.
  - On mobile (`<=599px`), `.auth-card` strips its background/border/shadow (`background: transparent; border: none`) for an edge-to-edge native mobile form feel, with `46px` tall inputs and `44x44px` password toggle buttons.
- **Source Files:** `/index.html:51-323`, `/authUI.js:1-673`, `/authController.js:1-468`, `/style.css:9098-9430`, `/style.css:10155-10196`, `/style.css:11286-11321`.

---

### 3.3 Global Navigation Shell (Sidebar, Top Header, Dropdowns)

#### 3.3.1 Left Navigation Sidebar (`#app-sidebar`)
- **Structure & Sections (`/index.html:329-473`):**
  - **Sidebar Header (`.sidebar-header`):**
    - Brand logo (`.brand-icon` + `.brand-title` `"Qavora"` + `.brand-tag` `"Manual QA"`).
    - Mobile close button `#sidebar-close-btn` (`✕`, visible only `<1024px`).
  - **Navigation Group 1 — `WORKSPACE`:**
    1. **Dashboard** (`data-route="dashboard"`): Grid icon + label `"Dashboard"`.
    2. **Projects** (`data-route="projects"`): Folder icon + label `"Projects"` + counter badge `#nav-projects-count` (`0`).
    3. **Test Plans & Suites** (`data-route="plans"`): Clipboard icon + label `"Test Plans & Suites"`.
    4. **Test Execution** (`data-route="execution"`): Play-circle icon + label `"Test Execution"`.
    5. **Defects & Issues** (`data-route="defects"`): Alert-circle icon + label `"Defects & Issues"` + counter badge `#nav-defects-count` (`0`, displays count of open/active defects where `status !== 'Closed' && status !== 'Resolved'`).
    6. **Reports & Analytics** (`data-route="reports"`): Bar-chart icon + label `"Reports & Analytics"`.
  - **Navigation Group 2 — `CHECKLIST TOOLS`:**
    7. **QA Checklist Generator** (`data-route="checklist-generator"`): File-plus icon + label `"QA Checklist Generator"`.
    8. **My QA Checklists** (`data-route="my-checklists"`): Check-square icon + label `"My QA Checklists"` + counter badge `#nav-checklists-count` (`0`).
    9. **QA Test Runner** (`data-route="qa-runner"`, `#nav-link-qa-runner`): Play icon + label `"QA Test Runner"` + green glowing dot `#nav-runner-active-dot` (visible when an active checklist ID exists in `qaChecklistStore`).
  - **Navigation Group 3 — `SYSTEM`:**
    10. **Data Management** (`data-route="data"`): Database icon + label `"Data Management"`.
    11. **Settings** (`data-route="settings"`): Gear icon + label `"Settings"`.
  - **Sidebar Footer (`.sidebar-footer`):**
    - **Storage Status Badge (`#sidebar-db-badge`):** Status dot `#sidebar-db-dot` (`.connected` green, `.disconnected` red, `.connecting` pulsing amber) + `#sidebar-db-text` (`"MongoDB Connected"`, `"Offline (Local Mode)"`, or `"Checking MongoDB..."`). Clicking `#sidebar-db-badge` triggers a live `/api/health` ping and shows a toast with the connection state (`/src/modules/uiRenderer.js:907-923`).
    - **Version Label:** `"v1.0.0 — Cloud Sync"` (`.version-label`).
    - **Authenticated User Card (`#sidebar-user-card`):** Displays `#sidebar-user-name` (`"QA Tester"`), `#sidebar-user-role` (`"Authenticated"` or user's role), and `#sidebar-logout-btn` (`"Sign Out"` button with spinner `#sidebar-logout-spinner`).

#### 3.3.2 Top Navigation Bar (`<header class="top-nav">`)
- **Left Group (`.top-nav-left`):**
  - `#sidebar-open-btn`: Hamburger menu button (visible `<1024px`).
  - `#top-page-title` (`h1.page-title`) & `#top-page-subtitle` (`p.page-subtitle`): Dynamically updated on every route change by `navigateTo()` using `VIEW_META` (`/src/modules/uiRenderer.js:18-77`).
- **Center Group (`.top-nav-center`):**
  - `.search-box`: Magnifying glass icon + `<input type="text" id="top-quick-search" placeholder="Quick search test cases, suites, defects...">` + `<kbd class="search-kbd">⌘K</kbd>`.
  - **Audit Verification Note:** `#top-quick-search` is **visual-only** — no JavaScript module attaches an event listener to `#top-quick-search` or implements global `⌘K` search. Hidden below `768px`.
- **Right Group (`.top-nav-right`):**
  1. **Offline Sync Status Button (`#offline-sync-status-btn`):**
     - Displays cloud/sync icon (`#offline-sync-icon-cloud` or spinning `#offline-sync-icon-spin`), label `#offline-sync-status-label` (`"Synced"`, `"Offline"`, `"Syncing..."`, `"Pending"`, `"Conflict"`, `"Failed"`), and numeric counter badge `#offline-sync-pending-badge`.
     - Clicking opens `#offline-sync-modal`.
  2. **`+ New Project` Button (`#header-create-btn`):**
     - Opens `#project-modal` in Create mode. On mobile (`<=599px`), collapses to a `40x40px` icon-only `+` button.
  3. **Theme Toggle Button (`#theme-toggle-btn`):**
     - Toggles `data-theme="dark"` / `data-theme="light"` on `<html>`, swaps `.theme-icon-moon` and `.theme-icon-sun`, syncs `#settings-theme-select`, and persists to `PATCH /api/auth/preferences`.
  4. **Notifications Bell (`#notification-btn` & `#notification-panel`):**
     - Toggles `#notification-panel` dropdown. Contains header (`"Notifications"`, unread pill `#notification-unread-text`, `#notification-mark-all-btn` `"Mark all read"`, `#notification-clear-all-btn` `"Clear"`) and `#notification-list` with `#notification-empty-state` (`"No notifications — Important workspace alerts, failed tests, and critical defects will appear here."`).
     - **Audit Verification Note:** While the dropdown toggle, Mark All Read, and Clear handlers are implemented in `/src/modules/uiRenderer.js:330-404`, no code in the repository ever adds notification items to `#notification-list`.
  5. **User Profile Trigger (`#header-user-profile` & `#account-dropdown-menu`):**
     - Shows avatar initials `#header-user-avatar`, `#header-user-name`, `#header-user-role`, and rotating caret.
     - Clicking toggles `#account-dropdown-menu`, which displays:
       - Header with `#account-dropdown-avatar`, `#account-dropdown-name`, `#account-dropdown-email`, and role badge `#account-dropdown-role`.
       - `#account-menu-profile` (`"Profile & Account"` -> navigates to `settings` and focuses `#settings-profile-name`).
       - `#account-menu-preferences` (`"Workspace Preferences"` -> navigates to `settings`).
       - `#account-menu-data` (`"Data & Storage"` -> navigates to `data`).
       - `#account-menu-logout` (`"Sign Out"` in red -> logs out session).
  6. **Header Sign Out Button (`#header-logout-btn`):**
     - Direct Sign Out button in top bar (hidden on small phones `<=380px` where sidebar/account dropdown Sign Out remains accessible).

---

### 3.4 Screen 1: Main Dashboard (`#view-dashboard`)
- **Screen Name & Purpose:** Executive workspace overview aggregating metrics across all formal projects, test suites, test cases, executions, and defects.
- **How Users Navigate To It:** Default landing screen after login (`/dashboard` or `/`); clicking **Dashboard** in the sidebar (`data-route="dashboard"`).
- **Main Layout & Structure (`/index.html:1428-1652`, `/src/modules/dashboardManager.js:126-327`):**
  1. **Welcome Banner (`.welcome-banner`):**
     - Left accent border, `.welcome-badge` (`"Manual QA Workspace"` with pulsing dot), `h2.welcome-heading` (`"Welcome to Qavora Testing Manager"`), description copy, and `+ Create First Project` button (`#welcome-create-btn`).
  2. **Primary 4-Card KPI Row (`.stats-grid`):**
     - **Card 1 — Total Projects:** `#stat-total-projects` (numeric value) + `#stat-active-projects-sub` (`"<N> Active"`).
     - **Card 2 — Test Cases:** `#stat-total-test-cases` + `#stat-total-suites-sub` (`"Across <N> Test Suites"`).
     - **Card 3 — Pass Rate:** `#stat-pass-rate` (`"<N>%"`, green) + `#stat-executed-count-sub` (`"<N> Executed"`).
     - **Card 4 — Open Defects:** `#stat-open-defects` (red) + `#stat-critical-defects-sub` (`"<N> Critical Severity"`).
  3. **Overall Execution Progress Card (`.progress-card`):**
     - Header with title `"Overall Test Execution Progress"`, percentage `#overall-progress-percentage` (`"<N>%"`), subtext `#overall-progress-subtext` (`"<executed> of <total> test cases executed"`), and gradient progress bar `#overall-progress-bar`.
  4. **QA Analytics & Status Snapshot Panel (`.panel`):**
     - Header with `"QA Analytics & Status Snapshot"` + `"Live Metrics"` tag + `"Open Full Reports →"` button (`#dash-open-reports-btn` -> navigates to `reports`).
     - **8 Analytics Chips (`.dash-analytics-stats`):**
       - `#dash-chip-passed` (`Passed`, green)
       - `#dash-chip-failed` (`Failed`, red)
       - `#dash-chip-blocked` (`Blocked`, amber)
       - `#dash-chip-skipped` (`Skipped`, slate)
       - `#dash-chip-notrun` (`Not Run`, muted)
       - `#dash-chip-passrate` (`Pass Rate %`)
       - `#dash-chip-execrate` (`Coverage %`)
       - `#dash-chip-defects` (`Total Bugs`)
     - **4-Segment Proportional Distribution Bar (`.dash-status-bar-track`):**
       - `#dash-bar-passed`, `#dash-bar-failed`, `#dash-bar-blocked`, `#dash-bar-skipped` width-scaled by execution count, with a 5-item color legend below.
  5. **Bottom Split Grid (`.dashboard-sections-grid`):**
     - **Left Panel — Recent Projects (`#recent-projects-container`):**
       - Header counter `#recent-projects-counter` (`"0 projects"` or `"<N> total"`) and `+ New` button (`#panel-create-project-btn`).
       - Displays up to 5 most recently updated/created projects (`.project-item`), showing project title, status pill (`Active`, `Draft`, `Completed`, `Archived`), type badge, environment badge, description snippet, suites/cases/executed/open-defects counts, mini progress bar, and quick action buttons (`Open Details`, `Test Plan`, `Execute`).
       - Empty State (`#recent-projects-empty`): Folder icon + `"No Projects Created Yet"` + `"Create Your First Project"` button (`#empty-state-create-btn`).
     - **Right Panel — Recent Activity (`#recent-activity-container`):**
       - Header with `"Live Log"` tag and `"Clear"` button (`#clear-activity-btn`).
       - **Audit Verification Note:** `renderDashboard()` in `/src/modules/dashboardManager.js:309-325` always renders a static empty state: *"No Recent Activity Recorded — Activity audit logging is currently not implemented on the backend server."* Clicking `#clear-activity-btn` displays an `"info"` toast: `"Activity log is empty."` (`/src/modules/uiRenderer.js:717-719`).
- **Source Files:** `/index.html:1428-1652`, `/src/modules/dashboardManager.js:1-327`, `/style.css:898-1459`.

---

### 3.5 Screen 2: Projects Directory (`#view-projects`)
- **Screen Name & Purpose:** Filterable, sortable directory of all formal QA testing projects belonging to the authenticated user, with aggregate project KPIs and full CRUD controls.
- **How Users Navigate To It:** Clicking **Projects** in the sidebar (`data-route="projects"`).
- **Main Layout & Structure (`/index.html:1657-1780`, `/src/modules/projectManager.js:731-935`):**
  1. **Section Hero (`.section-hero`):**
     - Heading `"QA Testing Projects"`, subtitle, and `+ New Project` button (`#projects-view-create-btn`).
  2. **4-Card Project Summary Strip (`.project-stats-grid`):**
     - `#proj-stat-total` (`Total Projects`)
     - `#proj-stat-active` (`Active`, green)
     - `#proj-stat-completed` (`Completed`, blue)
     - `#proj-stat-archived` (`Draft / Archived`, muted)
  3. **Search, Filter & Sort Toolbar (`.filter-toolbar`):**
     - **Search Input (`#project-search-input`):** Debounced (`180ms`) real-time filter matching project name, description, environment, version, type, or tags. Includes clear `✕` button `#project-search-clear`.
     - **Status Filter (`#project-filter-status`):** `ALL` (`All Statuses`), `Active`, `Draft`, `Completed`, `Archived`.
     - **Type Filter (`#project-filter-type`):** `ALL` (`All Types`), `Web Application`, `Mobile App`, `API / Backend`, `Desktop App`, `SaaS Platform`, `E-Commerce`, `Microservices`, `Other`.
     - **Sort Selector (`#project-sort-by`):** `newest` (`Newest First`), `updated` (`Recently Updated`), `oldest` (`Oldest First`), `name-asc` (`Name (A → Z)`), `name-desc` (`Name (Z → A)`), `progress-desc` (`Highest Progress`).
     - **Reset Button (`#project-filters-reset`):** Appears when any filter/search is active; resets all controls to default.
     - **Results Meta Bar:** `#projects-results-meta` (`"Showing X of Y projects"`).
  4. **Projects Card Grid (`#projects-grid-container`, `.projects-grid`):**
     - Each `.project-card` displays:
       - Top row: Status pill (`Active`, `Draft`, `Completed`, `Archived`), Project Type badge, Version chip, Environment chip.
       - Title (`.project-card-title`, clickable -> opens `project-details`) and 2-line clamped description.
       - Optional Base URL link (sanitized via `sanitizeUrl()`) and Tag pills (up to 4 tags).
       - 4-column QA metrics box: `Suites`, `Test Cases`, `Pass Rate %`, `Open Bugs`.
       - Execution progress bar with `<executed>/<total> executed (<pct>%)`.
       - Footer actions:
         - Primary `Open Project` button (`.btn-open-project` -> navigates to `project-details?projectId=<id>`).
         - Quick status selector or action icons: `Test Plan` (`.btn-card-plan`), `Execute` (`.btn-card-exec`), `Edit` (`.btn-edit-project` -> opens `#project-modal`), and `Delete` (`.btn-delete-project` -> opens `#delete-confirm-modal`).
  5. **Empty States:**
     - `#projects-empty-state`: Shown when the user has 0 projects; includes `+ Create New Project` CTA (`#projects-empty-create-btn`).
     - `#projects-no-results-state`: Shown when projects exist but none match the active search/filter criteria; includes `Clear All Filters` button (`#projects-no-results-reset-btn`).
- **Source Files:** `/index.html:1657-1780`, `/src/modules/projectManager.js:731-935`.

---

### 3.6 Screen 3: Project Details Workspace (`#view-project-details`)
- **Screen Name & Purpose:** Deep-dive overview for a single formal QA project, displaying its metadata, 6-card QA metrics strip, Test Plan summary, Test Suites breakdown, and recent defects.
- **How Users Navigate To It:** Clicking `Open Project` / `Open Details` on any project card in `#view-dashboard` or `#view-projects`, or via URL `/project-details?projectId=<id>`.
- **Main Layout & Structure (`/index.html:1785-1990`, `/src/modules/projectManager.js:937-1088`):**
  1. **Breadcrumb Bar (`.breadcrumb-bar`):**
     - `#back-to-projects-btn` (`"← Back to Projects"`) + `/ Project Overview`.
  2. **Project Detail Header Card (`.detail-header-card`):**
     - Badges row: `#detail-project-status-badge`, `#detail-project-type-badge`, `#detail-project-version-badge`, `#detail-project-env-badge`.
     - Title `#detail-project-name` and description `#detail-project-description`.
     - Metadata Grid (`.detail-meta-grid`): Created Date (`#detail-created-date`), Last Updated (`#detail-updated-date`), Target URL (`#detail-base-url`, rendered as clickable external link if valid `http/https`), and Tags (`#detail-tags-wrapper` / `#detail-tags-list`).
     - Action Toolbar (`.detail-header-actions`):
       - **Quick Status Dropdown (`#detail-status-quick-select`):** Immediately updates project status (`Active`, `Draft`, `Completed`, `Archived`) via `saveProjectData()`.
       - **`Edit Project` (`#detail-edit-project-btn`):** Opens `#project-modal` populated with the current project.
       - **`Delete` (`#detail-delete-project-btn`):** Opens `#delete-confirm-modal` for project deletion.
  3. **6-Card Project QA Metrics Strip (`.detail-qa-stats-grid`):**
     - `#detail-stat-phases` (`Plan Phases`)
     - `#detail-stat-suites` (`Test Suites`)
     - `#detail-stat-cases` (`Test Cases`)
     - `#detail-stat-executed` (`Executed`, blue)
     - `#detail-stat-passrate` (`Pass Rate`, green)
     - `#detail-stat-defects` (`Open Defects`, red)
  4. **Two-Column Detail Layout Grid (`.detail-layout-grid`):**
     - **Left Column — Test Plan & Suites Breakdown Panel:**
       - Header with `"Test Plan & Suites Breakdown"`, `"Manage Plan & Cases →"` button (`#detail-goto-plans-btn` -> navigates to `plans`), and `"Run Tests"` button (`#detail-goto-exec-btn` -> navigates to `execution`).
       - `#detail-suites-breakdown-container`: Lists each Test Suite with its phase badge, priority badge, test case count, pass/fail breakdown, and click-through to open that suite in `#view-plans`. Shows empty state with `+ Create Test Plan / Suite` if none exist.
     - **Right Column — Project Health & Recent Defects Panel:**
       - Header with `"Project Health & Execution Summary"` and `"View Defects →"` button (`#detail-goto-defects-btn` -> navigates to `defects`).
       - `#detail-health-summary-container`: Shows execution status breakdown bars (`Passed`, `Failed`, `Blocked`, `Skipped`, `Not Run`), Test Plan objective/scope summary, and up to 5 recent defects for this project.
- **Source Files:** `/index.html:1785-1990`, `/src/modules/projectManager.js:937-1088`.

---

### 3.7 Screen 4: Test Plans, Phases, Test Suites & Test Cases (`#view-plans`)
- **Screen Name & Purpose:** Hierarchical test design workspace where users author the project's **Test Plan Strategy**, organize **Execution Phases**, group tests into **Test Suites**, and build detailed step-by-step **Test Cases**.
- **How Users Navigate To It:** Clicking **Test Plans & Suites** in the sidebar (`data-route="plans"`), or clicking `"Manage Plan & Cases →"` from Project Details.
- **Top Project Selector Bar (`.plans-top-bar`, `/index.html:1998-2044`):**
  - **Active Project Dropdown (`#plans-project-selector`):** Populated by `populateProjectsDropdown()`. Switching projects updates `appState.activeProjectId` and re-renders the workspace.
  - **Top Action Buttons (`#plans-top-actions`):**
    - `#btn-edit-testplan` (`"Edit Test Plan"` -> opens `#testplan-modal`)
    - `#btn-add-phase` (`"+ Add Phase"` -> opens `#phase-modal`)
    - `#btn-add-suite` (`"+ New Test Suite"` -> opens `#suite-modal`)
    - `#btn-add-testcase` (`"+ New Test Case"` -> opens `#testcase-modal`)
- **Empty State when No Project Exists (`#plans-no-project-state`):**
  - Shown when the workspace has 0 projects; includes `+ Create Project` button (`#plans-create-project-btn`).

#### 3.7.1 Sub-View A: Test Plan Overview, Phases & Suites (`#plans-phases-subview`)
- **Test Plan Strategy Overview Card (`#testplan-overview-card`, `/index.html:2066-2166`):**
  - Displays `#plan-card-version-badge`, `#plan-card-status-badge` (`Draft`, `Active / Approved`, `In Execution`, `Completed`), `#plan-card-release-badge`, `#plan-card-title`, and `#plan-card-objective`.
  - **Collapsible Strategy Details (`#plan-details-collapsible`):** Toggled by `#btn-toggle-plan-details` (`"Show Plan Details"` / `"Hide Plan Details"`). Reveals 4 cards:
    1. Scope & Features (`#plan-detail-scope`)
    2. Test Environment & Browsers (`#plan-detail-env`)
    3. Entry Criteria (`#plan-detail-entry`)
    4. Exit Criteria & Sign-off (`#plan-detail-exit`)
  - **Metrics Footer Bar (`.plan-metrics-bar`):**
    - `#plan-metric-phases` (`Execution Phases`), `#plan-metric-suites` (`Test Suites`), `#plan-metric-cases` (`Total Test Cases`), `#plan-metric-time` (`Est. Duration` in mins/hrs), and priority breakdown pills (`#plan-prio-critical`, `#plan-prio-high`, `#plan-prio-medium`, `#plan-prio-low`).
- **Execution Phases & Test Suites Container (`#phases-list-container`):**
  - Renders each Execution Phase card (`.phase-card`) sorted by `order` (`Phase 1`, `Phase 2`, etc.), showing phase title, entry gate badge, description, Edit/Delete phase buttons, `+ Add Suite to Phase` button (`.btn-add-suite-phase`), and a `.suites-grid` of assigned Test Suite cards.
  - Any suites not assigned to a phase are rendered in an `"Unassigned / General Test Suites"` section.
  - Each **Test Suite Card (`.suite-card`)** displays:
    - Module tag, priority badge, suite title, description, test case count, estimated duration, mini execution status bar, and actions: `Explore Cases →` (`.btn-open-suite` -> switches to Sub-View B `#plans-cases-subview`), `+ Add Case` (`.btn-suite-add-case`), `Edit` (`.btn-edit-suite`), and `Delete` (`.btn-delete-suite`).
  - **Empty State (`#phases-empty-state`):** Shown when no phases or suites exist, offering `+ Create First Execution Phase` (`#btn-empty-add-phase`) and `+ Create Test Suite` (`#btn-empty-add-suite`).

#### 3.7.2 Sub-View B: Suite Explorer & Test Cases Table (`#plans-cases-subview`)
- **How Users Enter Sub-View B:** Clicking any Test Suite card or `Explore Cases →` button in Sub-View A (sets `plansViewState.subview = 'cases'` and updates URL with `?subview=cases&suiteId=<id>`).
- **Breadcrumb & Suite Switcher Bar (`/index.html:2197-2222`):**
  - `#btn-back-to-phases` (`"← Back to Phases & Suites"` -> returns to Sub-View A).
  - `#explorer-suite-switcher`: Dropdown allowing instant switching between all Test Suites in the project (or `"All Suites in Project"`).
- **Suite Header Card (`.suite-header-card`, `/index.html:2225-2252`):**
  - Displays `#explorer-suite-module-badge`, `#explorer-suite-phase-badge`, `#explorer-suite-priority-badge`, `#explorer-suite-name`, `#explorer-suite-desc`, and action buttons:
    - `#btn-explorer-edit-suite` (`"Edit Suite"`)
    - `#btn-explorer-run-suite` (`"Go to Execution"` -> navigates to `execution` filtered to that suite)
    - `#btn-explorer-add-case` (`"+ Add Test Case"`)
- **Test Cases Filter Toolbar (`/index.html:2255-2300`):**
  - Search input `#case-search-input` (filters by ID, title, requirement ID, preconditions) + clear button `#case-search-clear`.
  - Priority filter `#case-filter-priority` (`ALL`, `Critical`, `High`, `Medium`, `Low`).
  - Type filter `#case-filter-type` (`ALL`, `Functional`, `UI / UX`, `Smoke`, `Regression`, `Security`, `API`, `Performance`, `Edge Case`, `Accessibility`).
  - Execution status filter `#case-filter-status` (`ALL`, `Not Run`, `Passed`, `Failed`, `Blocked`, `Skipped`).
  - Reset button `#case-filters-reset`.
- **Test Cases Table (`#cases-table-container`):**
  - Renders `.cases-table` with columns: `Case ID` (e.g., `TC-101`), `Test Case Title & Preconditions`, `Suite` (when viewing All Suites), `Priority`, `Type`, `Steps`, `Est. Time`, `Latest Status`, and `Actions` (`View` -> opens `#testcase-view-modal`, `Execute` -> opens `#execution-modal`, `Edit` -> opens `#testcase-modal`, `Delete` -> opens `#delete-confirm-modal`).
- **Source Files:** `/index.html:1995-2320`, `/src/modules/testPlanManager.js:1-1440`.

---

### 3.8 Screen 5: Test Execution & Results Workspace (`#view-execution`)
- **Screen Name & Purpose:** Interactive test execution console for running test cases, managing formal Test Runs / Cycles, recording step-by-step or 1-click Pass/Fail outcomes, and inspecting execution history.
- **How Users Navigate To It:** Clicking **Test Execution** in the sidebar (`data-route="execution"`), clicking `"Run Tests"` in Project Details, or clicking `"Go to Execution"` in the Suite Explorer.
- **Main Layout & Structure (`/index.html:2323-2589`, `/src/modules/executionManager.js:840-1285`):**
  1. **Top Execution Selector & Action Bar (`.exec-top-bar`):**
     - **Project Dropdown (`#exec-project-selector`):** Selects active project.
     - **Suite Scope Dropdown (`#exec-suite-selector`):** Filters execution queue to `"All Suites in Project"` or a specific Test Suite.
     - **Top Actions (`#exec-top-actions`):**
       - `#btn-start-exec-run`: Dynamically toggles between `"+ Start Test Run"` (when no run is active -> opens `#execution-run-modal`) and `"✓ Complete Active Run"` (when a run is active -> calls `completeExecutionRun()`).
       - `#btn-view-exec-runs`: `"Run History (N)"` button (opens `#project-runs-history-modal`).
       - `#btn-exec-goto-plans` (`"Manage Cases"` -> navigates to `plans`).
       - `#btn-exec-report-defect` (`"Report Defect"` -> opens `#defect-modal`).
  2. **Active Execution Run Banner (`#exec-active-run-banner`):**
     - Dynamically injected/updated by `updateExecutionRunControlsUI()` (`/src/modules/executionManager.js:296-391`) when `project.activeRun` exists.
     - Displays pulsing `"ACTIVE TEST RUN"` badge, Run Name, Environment, Build Version, Tester Name, Started timestamp, live progress counter (`<executed>/<total> cases executed (<pct>%)`), `"Complete Run"` button (`#btn-banner-complete-run`), and `"Discard"` button (`#btn-banner-discard-run`).
  3. **8-Metric Execution Summary Bar (`.exec-metrics-bar`):**
     - `#exec-stat-total` (`Total Cases`)
     - `#exec-stat-executed` (`Executed`, blue)
     - `#exec-stat-passed` (`Passed`, green)
     - `#exec-stat-failed` (`Failed`, red)
     - `#exec-stat-blocked` (`Blocked`, amber)
     - `#exec-stat-skipped` (`Skipped`, slate)
     - `#exec-stat-notrun` (`Not Run`, muted)
     - `#exec-stat-passrate` (`Pass Rate %`, indigo)
  4. **Multi-Segment Execution Distribution Bar (`#exec-distribution-card`):**
     - Header with `"Execution Coverage & Status Distribution"`, `#exec-coverage-label` (`"<N>% Executed (<executed> / <total>)"`), and `#exec-last-run-label`.
     - 4-color proportional bar (`#exec-bar-passed`, `#exec-bar-failed`, `#exec-bar-blocked`, `#exec-bar-skipped`) + 5-item legend.
  5. **Execution Filter & Search Toolbar (`/index.html:2497-2550`):**
     - Search input `#exec-search-input` + clear `#exec-search-clear`.
     - Status filter `#exec-filter-status` (`ALL`, `Not Run`, `Passed`, `Failed`, `Blocked`, `Skipped`).
     - Priority filter `#exec-filter-priority` (`ALL`, `Critical`, `High`, `Medium`, `Low`).
     - Phase filter `#exec-filter-phase` (`ALL` or specific phases).
     - Sort selector `#exec-sort-by` (`suite-order`, `status-pending`, `failed-first`, `priority-desc`, `recent-run`).
     - Reset button `#exec-filters-reset` and results count `#exec-results-meta`.
  6. **Execution Test Cases Queue (`#exec-cases-container`):**
     - Groups test cases by Test Suite (`.exec-suite-group`) with suite header showing suite name, phase badge, and suite pass rate.
     - Each test case row (`.exec-case-row`) displays:
       - Case ID (`TC-101`), Priority badge, Type badge, Title, Preconditions snippet, Step count, Latest execution status badge (`Passed`, `Failed`, `Blocked`, `Skipped`, `Not Run`), Last run timestamp/tester/environment/notes preview, and Linked Defect pills.
       - **Row Action Buttons:**
         - **Quick Pass (`✓`, `.btn-quick-pass`):** Immediately records a `"Passed"` execution outcome via `quickRecordOutcome()` without opening a modal.
         - **Quick Fail (`✕`, `.btn-quick-fail`):** Immediately records a `"Failed"` execution outcome via `quickRecordOutcome()`.
         - **`Execute` / `Re-run` (`.btn-open-exec-modal`):** Opens the full step-by-step `#execution-modal`.
         - **`History` (`.btn-open-exec-history`):** Opens `#execution-history-modal` (shows badge count of past runs for this test case).
  7. **Empty States:**
     - `#exec-no-project-state` (0 projects in workspace).
     - `#exec-empty-cases-state` (selected project has 0 test cases; button `#btn-exec-empty-add-case` navigates to `plans`).
- **Source Files:** `/index.html:2323-2589`, `/src/modules/executionManager.js:1-1610`.

---

### 3.9 Screen 6: Defects & Issues Tracker (`#view-defects`)
- **Screen Name & Purpose:** Centralized bug and defect management workspace across all projects or a single selected project, supporting severity/status filtering, quick status updates, and full defect lifecycle tracking.
- **How Users Navigate To It:** Clicking **Defects & Issues** in the sidebar (`data-route="defects"`), clicking `"View Defects →"` in Project Details, or clicking `"Report Defect"` in Test Execution.
- **Main Layout & Structure (`/index.html:2593-2745`, `/src/modules/defectManager.js:485-775`):**
  1. **Section Hero & Project Scope Bar (`.defects-top-bar`):**
     - Heading `"Defects & Issue Tracker"`, Project Scope selector `#defects-project-selector` (`"All Projects (Workspace)"` or a specific project), and `+ Report Defect` button (`#btn-report-defect`).
  2. **5-Card Defect KPI Row (`.stats-grid`):**
     - `#defect-stat-total` (`Total Defects`, caption `"Across selected scope"`)
     - `#defect-stat-open` (`Open / Active`, red, `#defect-stat-reopened-sub` `"0 Reopened"`)
     - `#defect-stat-critical` (`Critical & High`, amber, `#defect-stat-critical-sub` `"0 Critical Severity"`)
     - `#defect-stat-inprogress` (`In Progress`, blue)
     - `#defect-stat-resolved` (`Resolved / Closed`, green, `#defect-stat-resolution-rate` `"0% Resolution Rate"`)
  3. **Filter & Sort Toolbar (`.filter-toolbar`):**
     - Search input `#defect-search-input` (searches defect ID `DEF-101`, title, description, environment, assignee, or linked case ID) + clear `#defect-search-clear`.
     - Status filter `#defect-filter-status` (`ALL`, `ACTIVE_ONLY` `"All Active (Unresolved)"`, `Open`, `In Progress`, `Reopened`, `Resolved`, `Closed`).
     - Severity filter `#defect-filter-severity` (`ALL`, `Critical`, `High`, `Medium`, `Low`).
     - Priority filter `#defect-filter-priority` (`ALL`, `P1 - Urgent`, `P2 - High`, `P3 - Medium`, `P4 - Low`).
     - Sort selector `#defect-sort-by` (`newest`, `severity-desc`, `priority-desc`, `updated`, `status`).
     - Reset button `#defect-filters-reset` and counter `#defects-results-meta`.
  4. **Defects List / Table (`#defects-list-container`):**
     - Renders `.defect-card` / `.cases-table` rows displaying:
       - Defect ID (`DEF-101`), Severity badge (`Critical`, `High`, `Medium`, `Low`), Priority badge (`P1 - Urgent` .. `P4 - Low`), Status badge, Defect Title (clickable -> opens `#defect-view-modal`), Project name pill, Linked Test Case chip (`TC-xxx`), Environment, Assignee, and Created/Updated timestamp.
       - **Inline Actions:** Quick Status dropdown (`.defect-quick-status-select` -> immediately updates defect status), `View` button (`.btn-view-defect`), `Edit` button (`.btn-edit-defect`), and `Delete` button (`.btn-delete-defect`).
  5. **Empty States:**
     - `#defects-empty-state` (`"No Defects Reported"` + `#btn-empty-report-defect`).
     - `#defects-no-results-state` (`"No Matching Defects Found"` + `#btn-defects-clear-filters`).
- **Source Files:** `/index.html:2593-2745`, `/src/modules/defectManager.js:1-1028`.

---

### 3.10 Screen 7: Reports, Analytics & QA Insights (`#view-reports`)
- **Screen Name & Purpose:** Comprehensive QA intelligence dashboard providing 11 KPIs, automated release readiness health insights, interactive SVG charts, and 7 granular breakdown tables.
- **How Users Navigate To It:** Clicking **Reports & Analytics** in the sidebar (`data-route="reports"`), or clicking `"Open Full Reports →"` on the Dashboard.
- **Main Layout & Structure (`/index.html:2749-2916`, `/src/modules/reportsManager.js:1-1084`):**
  1. **Scope & Date Range Filter Bar (`.reports-top-bar`):**
     - **Project Scope (`#reports-project-selector`):** `"All Projects (Global Workspace)"` or any individual project.
     - **Date Range (`#reports-date-range`):** `ALL` (`All Time`), `7D` (`Last 7 Days`), `30D` (`Last 30 Days`), `90D` (`Last 90 Days`), `CUSTOM` (`Custom Range`).
     - **Custom Date Pickers (`#reports-custom-dates`):** Shown when `CUSTOM` is selected; includes `#reports-date-from`, `#reports-date-to`, and `#btn-apply-custom-dates` (`"Apply"`).
     - **Quick Export Shortcuts:** `#btn-reports-goto-export` (`"Export CSV / JSON"` -> navigates to `data`) and `#btn-reports-print-now` (`"Print / Save PDF"` -> invokes `generatePrintableReport()`).
  2. **11-Card KPI Metrics Grid (`.reports-kpi-grid`):**
     - `#rep-kpi-projects` (`Total Projects` + `#rep-kpi-projects-sub` active count)
     - `#rep-kpi-suites` (`Test Suites` + `#rep-kpi-phases-sub` phases count)
     - `#rep-kpi-cases` (`Total Test Cases` + `#rep-kpi-steps-sub` total test steps)
     - `#rep-kpi-executed` (`Executed Cases`, blue + `#rep-kpi-coverage-sub` coverage %)
     - `#rep-kpi-passed` (`Passed`, green + `#rep-kpi-passrate-sub` pass rate %)
     - `#rep-kpi-failed` (`Failed`, red + `#rep-kpi-failrate-sub` fail rate %)
     - `#rep-kpi-blocked` (`Blocked`, amber + `#rep-kpi-skipped-sub` skipped count)
     - `#rep-kpi-notrun` (`Not Run / Pending`, muted + `#rep-kpi-remaining-sub` remaining %)
     - `#rep-kpi-runs` (`Total Execution Runs`, purple + `#rep-kpi-avg-runs-sub` avg runs per case)
     - `#rep-kpi-defects` (`Total Defects` + `#rep-kpi-open-defects-sub` open/active count)
     - `#rep-kpi-critical-bugs` (`Critical & High Bugs`, red + `#rep-kpi-resolution-sub` resolution rate %)
  3. **Automated QA Health & Release Readiness Insights (`#reports-insights-container`):**
     - Generated by `renderHealthInsights()` (`/src/modules/reportsManager.js:465-550`): evaluates pass rate, execution coverage, blocked tests, and open critical/high defects to render contextual cards (`.health-good` green, `.health-warning` amber, `.health-danger` red).
  4. **Primary Visual Charts Grid (`.charts-grid`):**
     - **Chart 1 — Test Execution Status Distribution Donut Chart:**
       - SVG `#rep-donut-svg` (`viewBox="0 0 220 220"`) with dynamically calculated `stroke-dasharray` / `stroke-dashoffset` arcs for Passed, Failed, Blocked, Skipped, and Not Run.
       - Center label showing `#rep-donut-center-val` (`"<N>%"` Pass Rate) and `#rep-donut-legend` with counts and percentages.
     - **Chart 2 — Execution Velocity & Pass Trend Chart:**
       - SVG `#rep-trend-svg` (`viewBox="0 0 560 220"`) plotting daily total executions vs. passed executions over the active date window (`#rep-trend-range-tag`), with footer stats `#rep-trend-peak-label` and `#rep-trend-total-label`.
  5. **Detailed Breakdown Panels & Tables:**
     - **Daily Execution Log Table (`#rep-daily-table-container`):** Date, Total Runs, Passed, Failed, Blocked/Skipped, Daily Pass Rate %.
     - **Execution Coverage by Test Phase (`#rep-phase-coverage-container`):** Phase name, Suites, Total Cases, Executed, Passed, Failed, Coverage %, Pass Rate %.
     - **Test Cases & Pass Rate by Priority (`#rep-priority-breakdown-container`):** `Critical`, `High`, `Medium`, `Low` horizontal progress bars and pass rates.
     - **Test Suite Quality & Execution Breakdown (`#rep-suites-table-container`):** Suite Name, Project, Phase, Priority, Total Cases, Passed, Failed, Blocked, Coverage %, Pass Rate %, Open Bugs.
     - **Defect Analytics (`#rep-defect-severity-bars` & `#rep-defect-status-pills`):** Severity distribution bars (`Critical`, `High`, `Medium`, `Low`) and Status summary pills (`Open`, `In Progress`, `Reopened`, `Resolved`, `Closed`).
     - **Recent Defects Log (`#rep-recent-defects-container`):** Up to 10 recent defects with `"Manage All Defects →"` button (`#btn-rep-goto-defects`).
     - **Recent Execution Activity Log (`#rep-recent-executions-container`):** Up to 15 latest test execution runs across all projects with `"Open Execution Workspace →"` button (`#btn-rep-goto-execution`).
- **Source Files:** `/index.html:2749-2916`, `/src/modules/reportsManager.js:1-1084`, `/style.css:4981-6280`.

---

### 3.11 Screen 8: Workspace Settings & User Profile (`#view-settings`)
- **Screen Name & Purpose:** Centralized configuration screen for user profile identity, password security, visual theme/density preferences, QA workflow defaults, and MongoDB storage diagnostics.
- **How Users Navigate To It:** Clicking **Settings** in the sidebar (`data-route="settings"`), or clicking `"Profile & Account"` / `"Workspace Preferences"` in `#account-dropdown-menu`.
- **Main Layout & Structure (`/index.html:2919-3259`, `/src/modules/settingsManager.js:1-495`):**
  - Header bar with `"Workspace Settings"` title, `#settings-save-indicator` (`"Preferences Saved"` pill that flashes for 2.2s on change), and `"Reset to Defaults"` button (`#btn-reset-settings-defaults`).
  - **5 Settings Cards (`.settings-cards-grid`):**
    1. **Card 1 — Appearance & Display:**
       - **Color Theme (`#settings-theme-select`):** `dark` (`Dark Mode (Default — Slate & Indigo)`), `light` (`Light Mode (High Contrast Daylight)`). Immediately updates `<html data-theme="...">` and persists to `PATCH /api/auth/preferences`.
       - **Table & List Density (`#settings-density-select`):** `comfortable` (`Comfortable (Standard Spacing)`), `compact` (`Compact (High-Density Rows)`).
         - *Audit Verification Finding:* `settingsManager.js` toggles `document.body.classList.add('density-compact')`, whereas `style.css:8720` targets `[data-density="compact"]`. Consequently, changing this dropdown saves to the backend but does not alter table row padding on screen.
    2. **Card 2 — Default Tester Profile:**
       - **Default Tester Name (`#settings-tester-name-input`):** Text input (`maxlength="60"`), placeholder `"e.g., QA Lead, Alex Rivera"`, pre-fills `#exec-tester-input` when executing test cases.
       - **Default Test Environment (`#settings-default-env-select`):** `Staging`, `QA / Test`, `Development`, `Production`, `UAT`, `Localhost`.
       - **Save Profile Button (`#btn-save-tester-profile`):** Saves `testerName` and `defaultEnv` to `PATCH /api/auth/preferences`.
    3. **Card 3 — Account & Security:**
       - Displays read-only `#settings-account-email-display` and role badge `#settings-account-role-badge`.
       - **Update Profile Form:**
         - `#settings-profile-name` (`Display Name`, `maxlength="80"`)
         - `#settings-profile-role` (`Role / Job Title`, `maxlength="60"`)
         - `#btn-update-account-profile` (`"Update Profile"` -> calls `PATCH /api/auth/profile` and updates sidebar/header user UI).
       - **Change Password Form:**
         - `#settings-current-password` (`Current Password`)
         - `#settings-new-password` (`New Password`, min 8 chars)
         - `#settings-confirm-new-password` (`Confirm New Password`)
         - Inline feedback alert `#settings-password-feedback`
         - `#btn-change-password` (`"Change Password"` -> calls `POST /api/auth/change-password`).
    4. **Card 4 — QA Workflow & Defaults:**
       - **Default Project Sort Order (`#settings-project-sort-select`):** `updated-desc`, `created-desc`, `name-asc`, `progress-desc`.
       - **Default New Test Case Priority (`#settings-case-priority-select`):** `Critical`, `High`, `Medium`, `Low`.
       - **Auto-Pass All Steps on Quick Pass (`#settings-autopass-steps-toggle`):** Checkbox toggle (checked by default).
       - **Show Action Toast Notifications (`#settings-action-toasts-toggle`):** Checkbox toggle (checked by default).
       - *Audit Verification Finding:* All 4 controls in Card 4 persist their values to `PATCH /api/auth/preferences`, but `projectManager.js`, `testPlanManager.js`, `executionManager.js`, and `uiRenderer.js` (`showToast`) do not read these 4 preference fields at runtime.
    5. **Card 5 — Local Storage & Data Health:**
       - **4 Mini Stat Boxes (`.settings-storage-stats-row`):**
         - `#settings-stat-storage-used` (`Storage Used` in KB + `#settings-stat-storage-pct` `"<N>% of 5 MB quota"`)
         - `#settings-stat-projects-count` (`Projects`)
         - `#settings-stat-cases-count` (`Test Cases` + `#settings-stat-executions-sub` `"<N> Executions"`)
         - `#settings-stat-checklists-count` (`QA Checklists`)
       - **Action Buttons (`.settings-storage-actions`):**
         - `#btn-settings-open-data-mgmt` (`"Open Data Management & Backups"` -> navigates to `data`).
         - `#btn-settings-quick-export` (`"Download Quick Backup (.json)"` -> downloads full workspace JSON backup).
         - `#btn-settings-test-mongodb` (`"Test MongoDB Connection"` -> queries `GET /api/tests` and updates `#settings-mongodb-result` with document count).
- **Source Files:** `/index.html:2919-3259`, `/src/modules/settingsManager.js:1-495`, `/style.css:8549-8734`.

---

### 3.12 Screen 9: QA Checklist Generator (`#view-checklist-generator`)
- **Screen Name & Purpose:** Plain-text/Markdown QA test plan parser and interactive structure editor that transforms raw unstructured test plans into executable QA checklists.
- **How Users Navigate To It:** Clicking **QA Checklist Generator** in the sidebar (`data-route="checklist-generator"`), or clicking `"+ Create New Checklist"` from `#view-my-checklists` or `#view-qa-runner`.
- **Main Layout & Structure (`/index.html:3264-3465`, `/checklistGeneratorUI.js:1-1369`, `/qaParser.js:1-1359`):**
  1. **Hero Banner (`.qa-gen-hero`):**
     - Badge `"Smart QA Plan Parser"` + heading `"QA Checklist Generator"` + description copy.
  2. **Saved Checklists Quick Resume Banner (`#qa-gen-saved-banner`):**
     - Shown automatically when saved checklists exist in `qaChecklistStore`. Displays `#qa-gen-saved-count-label`, `"Resume Active Runner"` button (`#btn-gen-resume-active` -> navigates to `qa-runner`), and `"View My Checklists"` button (`#btn-gen-open-my-checklists` -> navigates to `my-checklists`).
  3. **Two-Column Input & Formatting Guide Layout (`.qa-gen-input-layout`):**
     - **Left Card — Raw QA Test Plan Input (`.qa-gen-editor-card`):**
       - Header with label `"Raw QA Test Plan Input"` and live counter pill `#qa-gen-input-stats` (`"0 lines • 0 chars"`).
       - Monospace `<textarea id="qa-raw-plan-input" rows="14">` accepting Phase headers (`Phase 1: ...`, `### Phase 1`), Category headers (`Category:`, `Module:`, `**Authentication**`), Test items (`- [ ] TC-101: ... [High]`, numbered lists, bullet items), and Notes (`Goal:`, `Focus:`, `Note:`).
       - Action Bar (`.qa-gen-editor-actions`):
         - `#btn-generate-checklist` (`"Generate Interactive Checklist"` -> runs `parseRawQAPlan()` and opens preview workspace).
         - `#btn-load-sample-plan` (`"Load Sample QA Plan"` -> populates a realistic multi-phase e-commerce QA plan and parses it).
         - `#btn-clear-raw-plan` (`"Clear"` -> clears textarea and hides preview).
     - **Right Card — Supported Plan Formats (`.qa-gen-guidance-card`):**
       - Reference card explaining Phase Headers, Categories/Sub-sections, Individual Test Items, and Unclassified Content Preservation.
  4. **Parser Diagnostics & Alert Banners (`#qa-parser-alerts`):**
     - Renders contextual `.qa-parser-alert` banners (success summary of parsed phases/categories/tests, warning banner if unclassified lines were detected, or error banner if input is empty).
  5. **Structured Preview & Interactive Editor Workspace (`#qa-preview-workspace`):**
     - **Confirm & Start Testing Action Bar (`.qa-confirm-start-bar`):**
       - Checklist Title input `#qa-checklist-title-input` (pre-filled with detected document title or `"Manual QA Checklist — <Date>"`).
       - Primary CTA `#btn-start-testing-top` (`"Confirm & Start Testing"` -> saves checklist via `createAndSaveChecklistFromDraft()`, sets it active, and navigates to `#view-qa-runner`).
     - **Preview Toolbar (`.qa-preview-toolbar`):**
       - Live stat chips (`#qa-chip-phases`, `#qa-chip-categories`, `#qa-chip-tests`, `#qa-chip-notes`, and conditional `#qa-chip-unclassified`).
       - **View Mode Segmented Switcher (`.qa-mode-segmented`):**
         - `#btn-mode-editable` (`"Editable Review"` — default interactive editing mode).
         - `#btn-mode-clean` (`"Formatted Preview"` — clean read-only document view matching hierarchical Markdown layout).
       - `#btn-preview-add-phase-top` (`"+ Add Phase"`).
     - **Detected Plan Title & Preamble Notes (`#qa-preview-doc-meta`):**
       - Displays `#qa-preview-doc-title-banner` and preamble notes `#qa-preview-doc-notes`.
     - **Parsed Phases & Categories Tree (`#qa-preview-phases-container`):**
       - In **Editable Review Mode**, users can inline-edit Phase labels (`Phase 1`), Phase titles, Phase descriptions/goals, Supporting Notes, Category names, and individual Test Items (Test ID e.g. `TC-101`, Test description text, Priority dropdown `None`/`Critical`/`High`/`Medium`/`Low`), add/delete phases, categories, notes, and tests, or move a direct test into a category.
       - In **Formatted Preview Mode**, renders `.qa-clean-phase-card` blocks with bold phase headers, accented note callouts, indigo category headings, and bulleted test items with monospace ID chips and priority badges.
     - **Unclassified Content Review Panel (`#qa-unclassified-panel`):**
       - Shown whenever `draftPlan.unclassified.length > 0`. Lists each ambiguous line with its original line number badge (`Line N`), editable text input, classification reason, target Phase selector dropdown, and 4 resolution buttons:
         1. `"Add as Test Item"` (`data-action="promote-unclassified-test"`)
         2. `"Add as Supporting Note"` (`data-action="promote-unclassified-note"`)
         3. `"Convert to New Phase"` (`data-action="convert-unclassified-phase"`)
         4. `"Discard"` (`data-action="discard-unclassified"`)
         - Plus `"Dismiss All"` button (`#btn-dismiss-all-unclassified`).
     - **Bottom Footer Actions (`.qa-preview-footer-actions`):**
       - `#btn-preview-add-phase-bottom` (`"+ Add Another Phase"`) and `#btn-start-testing-bottom` (`"Confirm & Start Testing"`).
- **Source Files:** `/index.html:3264-3465`, `/checklistGeneratorUI.js:1-1369`, `/qaParser.js:1-1359`, `/style.css:6455-7574`.

---

### 3.13 Screen 10: My QA Checklists (`#view-my-checklists`)
- **Screen Name & Purpose:** Personal library of all saved interactive QA checklists created via the Checklist Generator, with progress tracking, inline renaming, promotion to formal projects, and completion report viewing.
- **How Users Navigate To It:** Clicking **My QA Checklists** in the sidebar (`data-route="my-checklists"`), or clicking `"← All Checklists"` from `#view-qa-runner`.
- **Main Layout & Structure (`/index.html:3468-3579`, `/qaRunnerUI.js:244-685`):**
  1. **Hero Banner (`.qa-gen-hero`):**
     - Heading `"My QA Checklists"`, description, `"Resume Active Checklist"` button (`#btn-mychk-resume-last`), and `"+ Create New Checklist"` button (`#btn-mychk-create-new` -> navigates to `checklist-generator`).
  2. **3-Card Summary Strip (`.qa-mychk-stats-grid`):**
     - `#mychk-stat-total` (`Saved Checklists` + `#mychk-stat-phases-sub` `"Across <N> Phases"`)
     - `#mychk-stat-completed-tests` (`Completed Tests`, green + `#mychk-stat-total-tests-sub` `"of <N> Total Tests"`)
     - `#mychk-stat-avg-progress` (`Overall Progress %`, blue + `#mychk-stat-inprogress-sub` `"<N> In Progress, <M> Completed"`)
  3. **Search & Status Filter Toolbar (`.qa-mychk-toolbar`):**
     - Search input `#mychk-search-input` (filters by checklist title or phase/test text).
     - Status filter `#mychk-filter-status` (`ALL` `"All Statuses"`, `Not Started`, `In Progress`, `Completed`).
  4. **Checklists Card Grid (`#mychk-grid-container`, `.qa-mychk-grid`):**
     - Each `.qa-mychk-card` displays:
       - Top row: Checklist title (or inline rename input `.qa-mychk-rename-input` when renaming), Status pill (`Not Started`, `In Progress`, `Completed`), and `"Active"` badge if currently loaded in the runner.
       - Promoted Project link badge (if `checklist.promotedToProjectId` is set -> clicking navigates to `project-details` for that project).
       - Timestamps (`Created: ...`, `Last Updated: ...`, `Completed: ...`).
       - Metrics row (`<completed> / <total> tests completed • <phases> phases`) + completion percentage (`<pct>%`) + progress bar.
       - Status breakdown chips (`Passed`, `Failed`, `Skipped`, `Remaining`).
       - **Card Footer Action Buttons (`.qa-mychk-actions`):**
         - `Open / Resume` (`data-action="open-checklist"` -> opens `#view-qa-runner` with this checklist).
         - `View Report` (`data-action="view-checklist-report"`, shown when completed or has progress -> opens `#qa-completion-report-modal`).
         - `Promote to Project` (`data-action="promote-checklist"` -> opens `#qa-checklist-promote-modal`; or `"Open Project"` if already promoted).
         - `Rename` (`data-action="start-rename"` -> toggles inline rename form).
         - `Delete` (`data-action="delete-checklist"` -> opens `#qa-checklist-delete-modal`).
  5. **Empty State (`#mychk-empty-state`):**
     - Shown when 0 checklists exist or none match filters. Includes `"Go to Checklist Generator"` (`#btn-mychk-empty-generate`) and `"Load & Save Sample Checklist"` (`#btn-mychk-empty-sample` -> generates, saves, and opens the sample checklist in `#view-qa-runner`).
- **Source Files:** `/index.html:3468-3579`, `/qaRunnerUI.js:244-685`, `/style.css:7604-7747`.

---

### 3.14 Screen 11: Manual QA Test Runner (`#view-qa-runner`)
- **Screen Name & Purpose:** Interactive checklist execution workspace where testers check off test items, cycle execution states (`Passed`, `Failed`, `Skipped`, `Not Started`), inline-edit phases/categories/tests on the fly, complete testing sessions, generate AI-ready completion reports, or promote the checklist to a formal QA project.
- **How Users Navigate To It:** Clicking **QA Test Runner** in the sidebar (`data-route="qa-runner"`), clicking `"Confirm & Start Testing"` in `#view-checklist-generator`, or clicking `"Open / Resume"` on any checklist card in `#view-my-checklists`.
- **Main Layout & Structure (`/index.html:3582-3701`, `/qaRunnerUI.js:687-1620`):**
  1. **Top Navigation & Checklist Switcher Bar (`.qa-runner-top-nav`):**
     - Left: `#btn-runner-back-list` (`"← All Checklists"` -> navigates to `my-checklists`) + Active Checklist Switcher dropdown `#qa-runner-checklist-switcher`.
     - Right:
       - `#btn-runner-view-report` (`"View Completion Report"`, visible when `isCompleted === true` -> opens `#qa-completion-report-modal`).
       - `#btn-runner-complete-testing` (`"Complete Testing"` -> opens `#qa-complete-testing-modal`).
       - `#btn-runner-promote-project` (`"Promote to Project"` -> opens `#qa-checklist-promote-modal`, or `"View Formal Project"` if already promoted).
       - `#btn-runner-create-new` (`"+ New Checklist"` -> navigates to `checklist-generator`).
  2. **Checklist Header Card (`.qa-runner-header-card`):**
     - Title display `#qa-runner-title-display` with `h2#qa-runner-title-text`, status badge `#qa-runner-status-badge`, and `"Rename"` button `#btn-runner-edit-title` (toggles `#qa-runner-title-edit` inline input `#qa-runner-title-input` + Save/Cancel buttons).
     - Timestamps row (`#qa-runner-created-at`, `#qa-runner-updated-at`).
  3. **Overall QA Testing Progress Panel (`.qa-runner-progress-panel`):**
     - Header with `"QA Testing Progress"`, `#qa-runner-progress-subtext` (`"X of Y tests completed"`), overall percentage `#qa-runner-overall-pct` (`"<N>%"`), and main progress bar `#qa-runner-overall-bar`.
     - **4-Card Runner Metrics Grid (`.qa-runner-metrics-grid`):**
       - `#qa-runner-metric-total` (`Total Tests`)
       - `#qa-runner-metric-completed` (`Completed`, green)
       - `#qa-runner-metric-remaining` (`Remaining`, amber)
       - `#qa-runner-metric-phases` (`Phases Done`, blue, `"X / Y"`)
  4. **Runner Controls Bar (`.qa-runner-controls-bar`):**
     - Left: `#btn-runner-expand-all` (`"Expand All Phases"`), `#btn-runner-collapse-all` (`"Collapse All Phases"`).
     - Right: `#btn-runner-add-phase` (`"+ Add Phase"`), `#btn-runner-reset-progress` (`"Reset All Checkboxes"` -> resets all test items to unchecked / `Not Started`).
  5. **Expandable Phase Cards & Interactive Test Rows (`#qa-runner-phases-container`):**
     - Optional Document Notes card (`.qa-runner-doc-notes-card`) at top if preamble notes exist, with `+ Add Note` and inline note editing.
     - Each **Phase Card (`.qa-runner-phase-card`)** includes:
       - Collapse/Expand chevron button (`.qa-runner-phase-toggle`), Phase label & title (`Phase 1: ...`), phase completion counter (`X / Y done`), mini progress bar, phase completion percentage (`<N>%`), and action icons: `+ Category`, `+ Test`, `+ Note`, `Edit Phase`, `Delete Phase`.
       - Phase Body (`.qa-runner-phase-body`):
         - Phase description/goal block and supporting notes list.
         - Category blocks (`.qa-runner-category-block`) with category title, `+ Test`, `Rename Category`, and `Delete Category` controls.
         - **Interactive Test Rows (`.qa-runner-test-row`):**
           - Checkbox (`<input type="checkbox" class="qa-runner-checkbox">`): Checking sets `completed = true` and `status = 'Passed'`; unchecking sets `completed = false` and `status = 'Not Started'`.
           - Test ID chip (`.qa-test-id-chip`), Test text (`.qa-runner-test-text`, struck through when completed), Priority chip (`.qa-test-prio-chip`).
           - **Clickable Status Pill Button (`.qa-runner-state-btn` -> `.qa-runner-state-tag`):** Clicking the status badge cycles through `Not Started` -> `Passed` -> `Failed` -> `Skipped` -> `Not Started` (`cycleChecklistTestStatus()` in `/qaChecklistStore.js:1875-1935`), allowing testers to record explicit `Failed` or `Skipped` states in addition to simple checkbox completion.
           - Inline `Edit` and `Delete` icon buttons for each test item.
- **Source Files:** `/index.html:3582-3701`, `/qaRunnerUI.js:687-1620`, `/qaChecklistStore.js:1810-2090`, `/style.css:7749-8546`.

---

### 3.15 Screen 12: Data Management, Backups & Portability (`#view-data`)
- **Screen Name & Purpose:** Workspace data governance hub providing MongoDB storage quota visualization, full JSON workspace backup/restore, 4 Excel-compatible CSV exports, printable QA summary reports, automatic pre-destructive rollback recovery, and workspace reset.
- **How Users Navigate To It:** Clicking **Data Management** in the sidebar (`data-route="data"`), clicking `"Data & Storage"` in `#account-dropdown-menu`, or clicking `"Open Data Management & Backups"` in `#view-settings`.
- **Main Layout & Structure (`/index.html:3706-4087`, `/src/modules/dataManager.js:1-1310`):**
  1. **Section Hero:**
     - Heading `"Data Management, Backups & Portability"`, subtitle, and `"Download Full Backup (.json)"` button (`#btn-hero-quick-backup`).
  2. **MongoDB Storage Quota & Entity KPI Strip (`.data-stats-grid`):**
     - **Full-Width Card — MongoDB Database Storage Quota:**
       - Shows `#data-stat-storage-size` (`"<used> MB / <limit> MB"`, default limit `50 MB`), status badge `#data-storage-health-badge` (`Healthy` green `<70%`, `Moderate` amber `70–89%`, `Near Limit` red `>=90%`, or `Warning — Limit Exceeded` `>=100%`), progress bar `#data-storage-quota-bar`, and `#data-stat-storage-sub`.
       - **Storage Warning Banner (`#storage-quota-warning-banner`):** Shown automatically when storage reaches `>=80%` of the MongoDB storage limit.
     - **6 Entity Counter Cards:**
       - `#data-stat-projects` (`Projects`)
       - `#data-stat-phases` (`Plan Phases`)
       - `#data-stat-suites` (`Test Suites`)
       - `#data-stat-cases` (`Test Cases`)
       - `#data-stat-executions` (`Executions`)
       - `#data-stat-defects` (`Defects`)
  3. **3-Tab Data Management Navigation (`.data-tabs-bar`, `role="tablist"`):**
     - **Tab 1 — `Backup, Restore & Recovery` (`#data-tab-backup` -> `#data-tabpanel-backup`):**
       - **Left Panel — Full JSON Workspace Backup & Restore:**
         - Export Scope selector `#backup-export-scope` (`ALL` `"Entire Workspace (All Projects)"` or a single project).
         - `"Export JSON Backup File"` button (`#btn-export-json-backup` -> downloads `qavora-backup-<scope>-<date>.json`).
         - Drag-and-drop file upload zone `#import-dropzone` (`<input type="file" id="import-file-input" accept=".json,application/json">`). Selecting/dropping a `.json` file validates schema structure and opens `#import-preview-modal`.
       - **Right Column — Automatic Recovery Point & Danger Zone:**
         - **Automatic Recovery Snapshot Panel:** Displays `#rollback-Active-container` (when a server-side recovery snapshot exists on `GET /api/data/recovery-snapshot`, showing `#rollback-reason-text`, `#rollback-timestamp-text`, `#rollback-counts-text`, and `"Restore Recovery Snapshot"` button `#btn-execute-rollback` which calls `POST /api/data/rollback`) or `#rollback-empty-container` (`"No recovery snapshot recorded yet."`).
         - **Danger Zone — Reset Workspace Panel (`.panel-danger`):** Warning copy + `"Reset Workspace..."` button (`#btn-trigger-reset-modal` -> opens `#reset-confirm-modal`).
     - **Tab 2 — `CSV Exports & Printable Reports` (`#data-tab-export` -> `#data-tabpanel-export`):**
       - **CSV Spreadsheet Exports Panel:**
         - Scope selector `#csv-export-scope` (`ALL` or single project).
         - 4 CSV Export Cards (`.csv-export-grid`), all sanitized against CSV formula injection (`=`, `+`, `-`, `@`) and prefixed with UTF-8 BOM `\uFEFF`:
           1. **Test Cases Specification CSV** (`#btn-export-csv-cases`)
           2. **Test Execution History CSV** (`#btn-export-csv-executions`)
           3. **Defects & Issue Tracker CSV** (`#btn-export-csv-defects`)
           4. **Projects & Suites Summary CSV** (`#btn-export-csv-projects`)
       - **Printable QA Report & PDF Dossier Panel:**
         - Project scope selector `#print-report-scope`, Report Type selector `#print-report-type-select` (`qa-summary`, `test-plan-spec`, `execution-audit`, `defect-log`, `full-dossier`), and `"Print / Save as PDF"` button (`#btn-print-qa-report` -> opens formatted print window via `window.open('', '_blank')`).
     - **Tab 3 — `Data Architecture & Privacy` (`#data-tab-info` -> `#data-tabpanel-info`):**
       - Displays two informational panels: `"100% Client-Side Privacy Architecture"` and `"JSON Backup Schema Specification"` (`qavora-workspace-backup` v1.0).
- **Source Files:** `/index.html:3706-4087`, `/src/modules/dataManager.js:1-1310`.

---

### 3.16 Complete Documentation of All 20 Modal Dialogs

#### Modal 1: Offline Sync Queue & Conflict Resolution (`#offline-sync-modal`)
- **Purpose:** Inspects queued offline operations stored in IndexedDB (`qavora_offline_db`), triggers manual synchronization, retries failed operations, and resolves HTTP 409 optimistic concurrency conflicts.
- **Header:** Cloud icon, title `"Offline Sync & Queue Status"`, subtitle `#offline-modal-subtitle`, close button `#offline-sync-modal-close`.
- **Body Components (`/index.html:673-1421`, `/src/modules/uiRenderer.js:1015-1455`):**
  - **Connection Status Banner (`#offline-modal-conn-banner`):** Shows live network & MongoDB reachability, plus counts of Pending, Conflicted, and Failed operations.
  - **Conflicted Operations Section (`#offline-modal-conflicts-section`):** Lists operations with `status === 'conflict'` (HTTP 409), displaying expected vs. server timestamps and two resolution buttons per conflict:
    - `"Keep My Changes (Force Overwrite)"` (`data-conflict-action="merge"` -> calls `resolveProjectConflict(opId, 'merge')` or checklist equivalent).
    - `"Use Server Version (Discard Local)"` (`data-conflict-action="keep_server"` -> calls `resolveProjectConflict(opId, 'keep_server')`).
  - **Failed Operations Section (`#offline-modal-failed-section`):** Lists dead-letter operations (`status === 'failed'`) with error reason and per-item `"Retry"` / `"Discard"` buttons, plus bulk `"Retry All Failed"` button (`#btn-offline-retry-failed`).
  - **Pending Operations Queue (`#offline-modal-pending-list`):** Chronological/dependency-ordered list of pending mutations waiting for connectivity.
- **Footer:** `"Close"` (`#btn-offline-modal-close`) and `"Sync Now"` (`#btn-offline-sync-now` -> calls `syncAllOfflineQueues()`).

#### Modal 2: Create / Edit Project (`#project-modal`)
- **Form (`#create-project-form`, `/index.html:4095-4243`, `/src/modules/uiRenderer.js:735-895`):**
  - Hidden `#project-edit-id` (empty for Create, project ID for Edit).
  - `#project-name-input` (Text, required, `maxlength="80"`).
  - `#project-type-input` (Select, required: `Web Application`, `Mobile App`, `API / Backend`, `Desktop App`, `SaaS Platform`, `E-Commerce`, `Microservices`, `Other`).
  - `#project-version-input` (Text, optional, `maxlength="30"`, e.g. `v1.0.0`).
  - `#project-status-input` (Select: `Active`, `Draft`, `Completed`, `Archived`).
  - `#project-env-input` (Text, optional, `maxlength="60"`, e.g. `Staging / Chrome 124`).
  - `#project-url-input` (URL, optional, `maxlength="200"`).
  - `#project-desc-input` (Textarea, optional, `maxlength="500"`).
  - `#project-tags-input` (Comma-separated text, optional, `maxlength="120"`).
  - Validation banner `#project-form-error`.
  - Footer: `#modal-cancel-btn` (`"Cancel"`) and `#project-modal-submit-btn` (`"Save Project"`).

#### Modal 3: Universal Delete Confirmation (`#delete-confirm-modal`)
- **Structure (`/index.html:4246-4293`, `/src/modules/uiRenderer.js:615-715`):**
  - Red warning triangle icon, dynamic title `#delete-modal-title`, target name `#delete-project-target-name`, dynamic impact warning message `#delete-modal-warning-text` (warns about cascading deletion of suites, cases, executions, or defects), `#delete-cancel-btn`, and red `#delete-confirm-btn` (`"Delete Permanently"`).

#### Modal 4: Create / Edit Test Plan (`#testplan-modal`)
- **Form (`#testplan-form`, `/index.html:4298-4427`, `/src/modules/testPlanManager.js:970-1065`):**
  - `#testplan-title-input` (Required, `maxlength="100"`).
  - `#testplan-version-input` (`maxlength="30"`, default `v1.0`).
  - `#testplan-release-input` (`maxlength="60"`).
  - `#testplan-status-input` (`Draft`, `Active / Approved`, `In Execution`, `Completed`).
  - `#testplan-objective-input` (Textarea, required, `maxlength="600"`).
  - `#testplan-scope-input` (Textarea, optional, `maxlength="800"`).
  - `#testplan-env-input` (Textarea, optional, `maxlength="500"`).
  - `#testplan-entry-input` (Textarea, optional, `maxlength="500"`).
  - `#testplan-exit-input` (Textarea, optional, `maxlength="500"`).

#### Modal 5: Create / Edit Execution Phase (`#phase-modal`)
- **Form (`#phase-form`, `/index.html:4430-4510`, `/src/modules/testPlanManager.js:1067-1155`):**
  - `#phase-edit-id` (Hidden).
  - `#phase-name-input` (Required, `maxlength="80"`).
  - `#phase-order-input` (Number, `min="1"`, `max="99"`).
  - `#phase-gate-input` (Text, optional, `maxlength="60"`, e.g. `Pre-Deployment`).
  - `#phase-desc-input` (Textarea, optional, `maxlength="400"`).

#### Modal 6: Create / Edit Test Suite (`#suite-modal`)
- **Form (`#suite-form`, `/index.html:4513-4616`, `/src/modules/testPlanManager.js:1157-1260`):**
  - `#suite-edit-id` (Hidden).
  - `#suite-name-input` (Required, `maxlength="90"`).
  - `#suite-module-input` (Text, optional, `maxlength="50"`).
  - `#suite-phase-select` (Select: `"Unassigned (General Suite)"` or any project phase).
  - `#suite-priority-select` (`Critical`, `High`, `Medium`, `Low`).
  - `#suite-desc-input` (Textarea, optional, `maxlength="500"`).

#### Modal 7: Create / Edit Test Case (`#testcase-modal`)
- **Form (`#testcase-form`, `/index.html:4619-4779`, `/src/modules/testPlanManager.js:1262-1440`):**
  - `#testcase-edit-id` (Hidden).
  - `#testcase-title-input` (Required, `maxlength="140"`).
  - `#testcase-suite-select` (Required: target Test Suite).
  - `#testcase-priority-select` (`Critical`, `High`, `Medium`, `Low`).
  - `#testcase-type-select` (`Functional`, `UI / UX`, `Smoke`, `Regression`, `Security`, `API`, `Performance`, `Edge Case`, `Accessibility`).
  - `#testcase-time-input` (Number, Est. Time in mins, `1–480`).
  - `#testcase-req-input` (Text, Requirement / Jira ID, `maxlength="50"`).
  - `#testcase-preconditions-input` (Textarea, `maxlength="500"`).
  - **Dynamic Test Steps Builder (`#testcase-steps-builder`):**
    - `+ Add Step` button (`#btn-add-step-row`).
    - Each `.step-row` contains step number badge (`#1`, `#2`...), Action input (`.step-action-input`), Expected Step Result input (`.step-expected-input`), Move Up (`↑`), Move Down (`↓`), and Remove (`✕`) buttons.
  - `#testcase-expected-input` (Overall Expected Result, required, `maxlength="600"`).
  - `#testcase-testdata-input` (Test Data / Inputs, optional, `maxlength="400"`).

#### Modal 8: Test Case Specification Read-Only Inspector (`#testcase-view-modal`)
- **Structure (`/index.html:4782-4880`, `/src/modules/testPlanManager.js:840-968`):**
  - Header with `#view-case-id-badge`, `#view-case-title`, `#view-case-suite-subtitle`.
  - Badge strip (`#view-case-priority-badge`, `#view-case-type-badge`, `#view-case-status-badge`, `#view-case-req-badge`, `#view-case-time-badge`, `#view-case-updated-meta`).
  - Preconditions (`#view-case-preconditions`), Test Data (`#view-case-testdata-section`), Steps Table (`#view-case-steps-tbody`), and Overall Expected Result (`#view-case-expected`).
  - Footer: `"Close"` (`#view-case-footer-close`) and `"Edit Test Case"` (`#btn-view-case-edit` -> switches to `#testcase-modal`).

#### Modal 9: Execute Test Case Runner (`#execution-modal`)
- **Form (`#execution-form`, `/index.html:4885-5092`, `/src/modules/executionManager.js:1287-1515`):**
  - Context banner showing `#exec-modal-priority-badge`, `#exec-modal-type-badge`, `#exec-modal-suite-badge`, `#exec-modal-prev-status-badge`, `#exec-modal-preconditions`, and `#exec-modal-testdata`.
  - **Step-by-Step Verification Runner (`#exec-modal-steps-list`):**
    - Lists each test step with individual `Pass`, `Fail`, and `Skip` toggle buttons (`.step-status-btn`) and an optional per-step actual observation input (`.step-actual-note-input`).
    - Bulk convenience buttons: `#btn-exec-pass-all-steps` (`"✓ Pass All Steps"`) and `#btn-exec-reset-steps` (`"Reset Steps"`).
    - **Auto-Status Sync:** Clicking `Fail` on any individual step automatically selects the overall `Failed` radio button and reveals the inline defect logging prompt; if all steps are marked `Pass`, overall status automatically selects `Passed`.
  - **Overall Execution Outcome Radio Cards (`.exec-status-grid`):**
    - `Passed`, `Failed`, `Blocked`, `Skipped` (`input[name="execStatus"]`).
  - **Execution Metadata Fields:**
    - `#exec-tester-input` (`Executed By / Tester`, defaults to user's saved Tester Name).
    - `#exec-env-input` (`Environment / Browser`, defaults to project environment).
    - `#exec-duration-input` (`Actual Duration (mins)`).
    - `#exec-build-input` (`Build / Release Version`).
    - `#exec-notes-input` (`Actual Result / Execution Notes`, required when status is `Failed` or `Blocked`).
    - `#exec-evidence-input` (`Screenshot / Evidence URL`).
  - **Inline Defect Creation Box (`#exec-inline-defect-box`):**
    - Shown when overall status is `Failed` or `Blocked`. Checking `#exec-log-defect-toggle` (`"Automatically create a linked Defect in Defect Tracker"`) reveals `#exec-inline-defect-fields`:
      - `#exec-defect-title-input` (pre-filled with `"[Failed] <Case ID>: <Case Title>"`)
      - `#exec-defect-severity-select` (`Critical`, `High`, `Medium`, `Low`)
      - `#exec-defect-priority-select` (`P1 - Urgent`, `P2 - High`, `P3 - Medium`, `P4 - Low`).

#### Modal 10: Test Case Execution History Timeline (`#execution-history-modal`)
- **Structure (`/index.html:5095-5162`, `/src/modules/executionManager.js:1517-1610`):**
  - Summary strip (`#history-total-runs`, `#history-pass-count`, `#history-fail-count`, `#history-latest-status`).
  - Chronological timeline `#execution-history-timeline` showing each execution's status badge, timestamp, tester, environment, build, duration, notes, step-level outcomes, evidence link, and clickable linked defect badges.
  - Footer: `"Close"` and `"Run Test Case Again"` (`#btn-history-run-again` -> opens `#execution-modal`).

#### Modal 11: Report / Edit Defect (`#defect-modal`)
- **Form (`#defect-form`, `/index.html:5167-5335`, `/src/modules/defectManager.js:777-915`):**
  - `#defect-edit-id` (Hidden).
  - `#defect-title-input` (Required, `maxlength="150"`).
  - `#defect-project-select` (Required: target Project).
  - `#defect-severity-select` (`Critical`, `High`, `Medium`, `Low`).
  - `#defect-priority-select` (`P1 - Urgent`, `P2 - High`, `P3 - Medium`, `P4 - Low`).
  - `#defect-status-select` (`Open`, `In Progress`, `Resolved`, `Closed`, `Reopened`).
  - `#defect-env-input` (`Environment / Browser / OS`, `maxlength="100"`).
  - `#defect-assignee-input` (`Assigned To / Owner`, `maxlength="60"`).
  - `#defect-suite-select` (`Linked Test Suite`, optional, dynamically filtered by selected project).
  - `#defect-case-select` (`Linked Test Case`, optional, dynamically filtered by selected project/suite).
  - `#defect-steps-input` (`Description & Steps to Reproduce`, required, `maxlength="1200"`).
  - `#defect-expected-input` (`Expected Result`, optional, `maxlength="500"`).
  - `#defect-actual-input` (`Actual Result / Observation`, required, `maxlength="500"`).
  - `#defect-evidence-input` (`Evidence / Screenshot / Issue URL`, optional, `maxlength="250"`).

#### Modal 12: Defect Detail Inspector (`#defect-view-modal`)
- **Structure (`/index.html:5338-5474`, `/src/modules/defectManager.js:917-1028`):**
  - Header with `#view-defect-id-badge`, `#view-defect-title`, `#view-defect-project-subtitle`.
  - **Quick Status Bar:** Badges (`#view-defect-severity-badge`, `#view-defect-priority-badge`, `#view-defect-status-badge`) + Quick Update Status dropdown `#view-defect-quick-status` (`Open`, `In Progress`, `Resolved`, `Closed`, `Reopened`).
  - 8-cell Metadata Grid (Project, Environment, Assigned To, Reported By, Linked Test Suite, Linked Test Case, Created Date, Last Updated).
  - Conditional Linked Test Case Card (`#view-defect-linked-case-card`) with `"View Execution History"` button (`#btn-defect-view-linked-case` -> opens `#execution-history-modal`).
  - Description & Steps to Reproduce (`#view-defect-steps`), Expected (`#view-defect-expected`) vs. Actual (`#view-defect-actual`) comparison boxes, and External Evidence Link (`#view-defect-evidence-link`).
  - Footer: `"Close"` and `"Edit Defect"` (`#btn-view-defect-edit` -> opens `#defect-modal`).

#### Modal 13: Delete QA Checklist Confirmation (`#qa-checklist-delete-modal`)
- **Structure (`/index.html:5479-5525`, `/qaRunnerUI.js`):**
  - Displays target checklist title `#qa-delete-checklist-name`, warning copy, `#qa-delete-cancel-btn`, and `#qa-delete-confirm-btn` (`"Delete Checklist"`).

#### Modal 14: Promote QA Checklist to Formal Project (`#qa-checklist-promote-modal`)
- **Form (`#qa-checklist-promote-form`, `/index.html:5546-5650`, `/qaRunnerUI.js:1622-1820`, `/qaChecklistStore.js:2110-2315`):**
  - `#qa-promote-checklist-id` (Hidden).
  - `#qa-promote-name-input` (Project Name, required, pre-filled from checklist title).
  - `#qa-promote-type-select` (Project Type, default `Web Application`).
  - `#qa-promote-env-input` (Target Environment, optional, default `Staging`).
  - `#qa-promote-desc-input` (Project Description, optional).
  - **Promotion Mapping Preview Box (`#qa-promote-preview-box`):** Shows exact counts of Phases -> Execution Phases, Categories -> Test Suites, and Checklist Items -> Formal Test Cases.
  - **Critical Business Rule Verified in `/qaChecklistStore.js:2165-2195`:** During promotion (`buildProjectFromChecklist`), **both completed and incomplete checklist items are created as formal Test Cases with `status: 'Not Run'`** and `executions: []`, so the newly promoted formal project starts with a clean execution slate while preserving the original checklist's progress in `#view-my-checklists`.

#### Modal 15: Complete Checklist Testing Confirmation (`#qa-complete-testing-modal`)
- **Form (`#qa-complete-testing-form`, `/index.html:5653-5745`, `/qaRunnerUI.js:1822-1940`):**
  - 4-pill live breakdown: `#qa-complete-passed-count` (Passed), `#qa-complete-failed-count` (Failed), `#qa-complete-skipped-count` (Skipped), `#qa-complete-remaining-count` (Remaining).
  - Conditional Warning Banner (`#qa-complete-incomplete-warning`): Shown if `remaining > 0`, warning that unchecked items will be recorded as `"Not Started / Remaining"` in the final report.
  - Optional Tester Summary / Notes (`#qa-complete-tester-notes`).
  - Submit button `#qa-complete-confirm-btn` (`"Mark Completed & Generate Report"` -> marks checklist `Completed` and immediately opens `#qa-completion-report-modal`).

#### Modal 16: Test Completion Report Viewer & Exporter (`#qa-completion-report-modal`)
- **Structure (`/index.html:5748-5865`, `/qaRunnerUI.js:1942-2350`, `/qaReportGenerator.js:1-289`):**
  - Header with title `#qa-report-modal-title`, subtitle `#qa-report-modal-subtitle`, and 3 export buttons:
    - `#btn-report-copy-text` (`"Copy Report"` -> copies Markdown report to clipboard)
    - `#btn-report-download-md` (`"Download .MD"` -> downloads `<slug>-qa-report.md`)
    - `#btn-report-download-txt` (`"Download .TXT"` -> downloads `<slug>-qa-report.txt`)
  - **3 View Tabs (`.qa-report-tabs-bar`):**
    1. `Visual Report` (`#qa-report-tab-visual` -> `#qa-report-panel-visual`):
       - Summary KPI cards (`#qa-report-summary-cards`: Total, Passed, Failed, Skipped, Not Started, Completion %).
       - **AI Follow-Up Prompt Box (`.qa-report-prompt-box`):** Pre-formatted prompt `#qa-report-ai-prompt` summarizing failed/skipped/remaining tests for pasting into an AI coding assistant, with `"Copy AI Follow-Up Prompt"` button (`#btn-report-copy-prompt`).
       - Detailed Breakdown Sections (`#qa-report-visual-sections`): Failed Tests table, Skipped Tests table, Remaining / Not Started Tests table, and Phase-by-Phase Passed summary.
    2. `Markdown Preview` (`#qa-report-tab-markdown` -> `#qa-report-panel-markdown`): Raw Markdown in `<pre id="qa-report-markdown-code">`.
    3. `Plain Text Preview` (`#qa-report-tab-text` -> `#qa-report-panel-text`): Raw ASCII report in `<pre id="qa-report-text-code">`.

#### Modal 17: Validate & Preview JSON Workspace Import (`#import-preview-modal`)
- **Structure (`/index.html:5870-5978`, `/src/modules/dataManager.js:730-980`):**
  - File metadata grid (`#import-meta-filename`, `#import-meta-version`, `#import-meta-exported-at`).
  - 5-column entity counter grid (`#import-count-projects`, `#import-count-suites`, `#import-count-cases`, `#import-count-executions`, `#import-count-defects`).
  - Validation warnings banner `#import-validation-warnings`.
  - **Conflict Resolution Strategy Radio Group (`input[name="importStrategy"]`):**
    - `merge` (`"Smart Merge with Existing Workspace"` — Recommended default; updates matching IDs and appends new projects).
    - `replace` (`"Replace Entire Workspace"` — Overwrites all existing projects; automatically creates a server-side recovery snapshot first).
  - Submit button `#btn-confirm-import` (`"Import Workspace Data"` -> calls `POST /api/data/import`).

#### Modal 18: Reset Workspace Confirmation (`#reset-confirm-modal`)
- **Structure (`/index.html:5981-6028`, `/src/modules/dataManager.js:1080-1215`):**
  - Red danger alert explaining that resetting deletes all projects, test plans, suites, cases, executions, and defects, while automatically saving a Rollback Recovery Snapshot on the server.
  - Checkbox `#reset-auto-backup-checkbox` (checked by default: `"Automatically download a safety .json backup file before clearing"`).
  - Footer: `#btn-cancel-reset-modal` (`"Cancel"`) and dynamically injected `#btn-confirm-reset-workspace` (`"Permanently Clear Workspace"` -> calls `POST /api/data/reset`).

#### Modal 19: Start New Test Run / Cycle (`#execution-run-modal`)
- **Structure (`/src/modules/executionManager.js:154-244`):**
  - Dynamically injected into `document.body` by `ensureRunModalsInDOM()`.
  - Form `#execution-run-form`:
    - `#exec-run-name-input` (Required, pre-filled with `"Test Run #<N> — <Date>"`).
    - `#exec-run-env-input` (`Target Environment`, pre-filled from project environment).
    - `#exec-run-build-input` (`Build / Release Version`, pre-filled from project version).
    - `#exec-run-tester-input` (`Lead Tester / Executed By`, pre-filled from user profile).
    - `#exec-run-notes-input` (`Run Scope / Notes`).
  - Submit button `#exec-run-submit-btn` (`"Start Test Run"` -> creates `project.activeRun` and logs run in `project.executionRuns`).

#### Modal 20: Project Test Runs / Cycles History (`#project-runs-history-modal`)
- **Structure (`/src/modules/executionManager.js:247-293`):**
  - Dynamically injected into `document.body` by `ensureRunModalsInDOM()`.
  - Displays `#project-runs-history-body`: a table/list of all active and completed test runs (`project.executionRuns`) showing Run ID, Name, Status badge (`In Progress`, `Completed`), Environment, Build, Tester, Start/Completed timestamps, Total Executed, Passed, Failed, Blocked, Skipped, and Pass Rate %.

---

## 4. Navigation Architecture

### 4.1 Complete User Journey & Screen Transition Map

```
[Initial Page Load]
       │
       ▼
#auth-loading-overlay ("Verifying session..." -> GET /api/auth/me)
       │
       ├── Unauthenticated ──► #auth-container
       │                         ├── Tab: Sign In (#auth-login-panel -> POST /api/auth/login)
       │                         └── Tab: Create Account (#auth-register-panel -> POST /api/auth/register)
       │
       └── Authenticated ────► #app-container (Resolves initial URL route or defaults to /dashboard)
                                 │
                                 ├─► [WORKSPACE GROUP]
                                 │     ├── 1. /dashboard (#view-dashboard)
                                 │     │        ├── Click Project Card ──────────────► /project-details?projectId=<id>
                                 │     │        ├── Click "Test Plan" ───────────────► /plans?projectId=<id>
                                 │     │        ├── Click "Execute" ─────────────────► /execution?projectId=<id>
                                 │     │        └── Click "Open Full Reports →" ─────► /reports
                                 │     │
                                 │     ├── 2. /projects (#view-projects)
                                 │     │        └── Click "Open Project" / Title ────► /project-details?projectId=<id>
                                 │     │
                                 │     ├── 3. /project-details?projectId=<id> (#view-project-details)
                                 │     │        ├── "← Back to Projects" ────────────► /projects
                                 │     │        ├── "Manage Plan & Cases →" ─────────► /plans?projectId=<id>
                                 │     │        ├── Click Suite Breakdown Row ───────► /plans?projectId=<id>&subview=cases&suiteId=<id>
                                 │     │        ├── "Run Tests" ─────────────────────► /execution?projectId=<id>
                                 │     │        └── "View Defects →" ────────────────► /defects
                                 │     │
                                 │     ├── 4. /plans (#view-plans)
                                 │     │        ├── Sub-View A: Phases & Suites (#plans-phases-subview)
                                 │     │        │     └── Click Suite / "Explore Cases" ──► Sub-View B (#plans-cases-subview)
                                 │     │        └── Sub-View B: Suite Explorer (#plans-cases-subview)
                                 │     │              ├── "← Back to Phases & Suites" ────► Sub-View A
                                 │     │              └── "Go to Execution" ──────────────► /execution?projectId=<id>
                                 │     │
                                 │     ├── 5. /execution (#view-execution)
                                 │     │        ├── "Manage Cases" ──────────────────► /plans?projectId=<id>
                                 │     │        └── "Report Defect" / Inline Defect ─► #defect-modal / /defects
                                 │     │
                                 │     ├── 6. /defects (#view-defects)
                                 │     │        └── Click Linked Case in Defect View ► #execution-history-modal
                                 │     │
                                 │     └── 7. /reports (#view-reports)
                                 │              ├── "Export CSV / JSON" ─────────────► /data
                                 │              ├── "Manage All Defects →" ──────────► /defects
                                 │              └── "Open Execution Workspace →" ────► /execution
                                 │
                                 ├─► [CHECKLIST TOOLS GROUP]
                                 │     ├── 8. /checklist-generator (#view-checklist-generator)
                                 │     │        ├── "Confirm & Start Testing" ───────► /qa-runner?checklistId=<id>
                                 │     │        ├── "Resume Active Runner" ──────────► /qa-runner
                                 │     │        └── "View My Checklists" ────────────► /my-checklists
                                 │     │
                                 │     ├── 9. /my-checklists (#view-my-checklists)
                                 │     │        ├── "Open / Resume" ─────────────────► /qa-runner?checklistId=<id>
                                 │     │        ├── "Promote to Project" ────────────► #qa-checklist-promote-modal ──► /project-details
                                 │     │        └── "View Report" ───────────────────► #qa-completion-report-modal
                                 │     │
                                 │     └── 10. /qa-runner (#view-qa-runner)
                                 │              ├── "← All Checklists" ──────────────► /my-checklists
                                 │              ├── "+ New Checklist" ───────────────► /checklist-generator
                                 │              ├── "Complete Testing" ──────────────► #qa-complete-testing-modal ──► #qa-completion-report-modal
                                 │              └── "Promote to Project" ────────────► #qa-checklist-promote-modal ──► /project-details
                                 │
                                 └─► [SYSTEM GROUP]
                                       ├── 11. /data (#view-data)
                                       │        ├── Tab 1: Backup, Restore & Recovery (#data-tabpanel-backup)
                                       │        ├── Tab 2: CSV Exports & Printable Reports (#data-tabpanel-export)
                                       │        └── Tab 3: Data Architecture & Privacy (#data-tabpanel-info)
                                       │
                                       └── 12. /settings (#view-settings)
                                                └── "Open Data Management & Backups" ► /data
```

### 4.2 Routing & History API Mechanics (`/src/modules/uiRenderer.js:155-265`)
- **Supported Route Keys (`VIEW_META`):** `dashboard`, `projects`, `project-details`, `plans`, `execution`, `defects`, `reports`, `checklist-generator`, `my-checklists`, `qa-runner`, `data`, `settings`.
- **URL Path & Query Parameter Synchronization (`buildUrlForRoute`):**
  - Supports deployment under an optional base path (`import.meta.env.VITE_BASE_PATH` or `/Qavora` prefix auto-detection).
  - Project-scoped routes (`project-details`, `plans`, `execution`) append `?projectId=<appState.activeProjectId>` to the browser URL.
  - Checklist runner route (`qa-runner`) appends `?checklistId=<activeChecklistId>`.
  - Browser Back/Forward buttons trigger `window.addEventListener('popstate')`, which calls `resolveInitialRoute()` and `navigateTo(route, { updateHistory: false })`.
- **Sidebar Active Link Highlighting:**
  - `navigateTo()` toggles `.active` on the matching `.nav-link[data-route="<route>"]`.
  - Special rule: when viewing `project-details`, the `projects` sidebar link is highlighted as `.active` (`/src/modules/uiRenderer.js:187`).

---

## 5. Global Design System (`/style.css`)

### 5.1 Color Palette & Theme Tokens (`:root` vs. `[data-theme="light"]`)

| CSS Custom Property | Dark Theme Default (`:root`, lines 6–73) | Light Theme Override (`[data-theme="light"]`, lines 76–114) | Usage |
| :--- | :--- | :--- | :--- |
| `--bg-app` / `--bg-base` | `#0b0f19` | `#f8fafc` | Root page & viewport background |
| `--bg-sidebar` | `#0e1422` | `#ffffff` | Left navigation sidebar surface |
| `--bg-surface` | `#131b2e` | `#ffffff` | Top nav bar, dropdowns, settings cards |
| `--bg-surface-hover` | `#19233c` | `#f1f5f9` | Hover state for interactive rows/buttons |
| `--bg-card` | `#131b2e` | `#ffffff` | KPI cards, panels, project/suite cards |
| `--bg-card-hover` | `#1a253e` | `#f8fafc` | Hover elevation for cards |
| `--bg-input` | `#0e1422` | `#f8fafc` | Form inputs, selects, textareas, code blocks |
| `--bg-modal` | `#131b2e` | `#ffffff` | Modal dialog surface |
| `--bg-backdrop` | `rgba(5, 8, 15, 0.75)` | `rgba(15, 23, 42, 0.45)` | Modal & mobile drawer backdrop overlay |
| `--border-subtle` | `#1e293b` | `#e2e8f0` | Default card, panel, and table cell borders |
| `--border-medium` | `#2e3e5c` | `#cbd5e1` | Emphasized input, modal, and hover borders |
| `--border-focus` | `#6366f1` | `#4f46e5` | Keyboard focus ring and input focus border |
| `--text-primary` | `#f8fafc` | `#0f172a` | Headings, primary body text, active labels |
| `--text-secondary` | `#94a3b8` | `#475569` | Subtitles, descriptions, table body text |
| `--text-muted` | `#64748b` | `#94a3b8` (`#64748b` on `.text-muted`) | Captions, timestamps, placeholders, hints |
| `--accent-primary` | `#6366f1` (Indigo 500) | `#4f46e5` (Indigo 600) | Primary brand buttons, active links, progress |
| `--accent-primary-hover` | `#4f46e5` | `#4338ca` | Primary button hover state |
| `--accent-primary-subtle`| `rgba(99, 102, 241, 0.12)` | `rgba(79, 70, 229, 0.08)` | Active nav pill fill, badge backgrounds |
| `--color-green` | `#10b981` (Emerald 500) | `#059669` (Emerald 600) | `Passed`, `Active`, `Resolved`, `Connected` |
| `--color-red` | `#ef4444` (Red 500) | `#dc2626` (Red 600) | `Failed`, `Critical`, `Open Bugs`, `Danger` |
| `--color-amber` | `#f59e0b` (Amber 500) | `#d97706` (Amber 600) | `Blocked`, `Skipped`, `High`, `Warning` |
| `--color-blue` | `#3b82f6` (Blue 500) | `#3b82f6` | `In Progress`, `Executed`, `Info` |
| `--color-purple` | `#8b5cf6` (Violet 500) | `#8b5cf6` | `Mobile App`, `Execution Runs` |

### 5.2 Typography & Font Scale
- **Font Stacks:**
  - `--font-sans`: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
  - `--font-mono`: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` (used for KPI values `.stat-value` with `font-variant-numeric: tabular-nums`, test case IDs `TC-101`, defect IDs `DEF-101`, version tags, and raw plan input).
- **Typographic Hierarchy:**
  - Auth Brand Title (`.auth-brand-title`): `1.65rem` (`26.4px`), weight `800`, tracking `-0.025em`.
  - Hero / Welcome Heading (`.welcome-heading`, `.qa-gen-title`): `1.45rem` (`23.2px`), weight `700`, tracking `-0.02em`.
  - KPI Stat Value (`.stat-value`): `1.75rem–1.85rem`, weight `700–800`, monospace tabular-nums.
  - Top Header Page Title (`.page-title`): `1.15rem` (`18.4px`), weight `700`.
  - Modal & Card Titles (`.modal-title`, `.settings-card-title`): `1.05rem` (`16.8px`), weight `600–700`.
  - Panel Titles (`.panel-title`): `0.95rem` (`15.2px`), weight `700`.
  - Standard Body / Inputs / Buttons: `0.85rem–0.88rem` (`13.6px–14px`), line-height `1.5`.
  - Micro Badges / Section Headers (`.nav-section-title`, `.stat-label`): `0.68rem–0.75rem` (`11px–12px`), uppercase, weight `600–700`, tracking `0.04em–0.08em`.

### 5.3 Layout, Spacing, Border Radius & Shadows
- **Structural Dimensions:** `--sidebar-width: 256px` (`224px` at `1024–1279px`, `240px` at `1280–1439px`, `260px` at `1440–1919px`, `270px` at `>=1920px`); `--header-height: 64px` (`60px` on tablet, `56px` on mobile, `48px` on landscape mobile); `.content-viewport` max-width `1680px` (`1740px` at `>=1920px`).
- **Border Radius Tokens:** `--radius-xs: 4px`, `--radius-sm: 6px`, `--radius-md: 10px`, `--radius-lg: 14px`, `--radius-xl: 18px`, `--radius-full: 9999px`.
- **Shadow Tokens:** `--shadow-sm`, `--shadow-md`, `--shadow-lg` (dark theme uses deeper alpha `0.25–0.5`, light theme uses subtle alpha `0.05–0.10`).

### 5.4 Component Primitives
- **Buttons (`.btn`):**
  - Sizes: Default (`padding: 8px 16px`, `0.88rem`), `.btn-sm` (`6px 12px`, `0.82rem`), `.btn-xs` (`4px 8px`, `0.75rem`), `.btn-lg` (`10px 20px`, `0.94rem`), `.icon-btn` (`36x36px` desktop, `40x40px` tablet, `44x44px` mobile).
  - Variants: `.btn-primary` (indigo fill + glow shadow), `.btn-secondary` (input surface + medium border), `.btn-ghost` (transparent, hover fill), `.btn-danger` (red fill/border for destructive actions).
- **Form Controls (`.form-control`, `.filter-select`, `.auth-input`):**
  - Styled with `--bg-input`, `1px solid var(--border-medium)`, `--radius-sm`, and a `3px` indigo focus ring (`box-shadow: 0 0 0 3px var(--accent-primary-subtle)`). Invalid state adds `.is-invalid` / `.input-error` (`--color-red`).
- **Cards, Panels & Tables:**
  - `.stat-card`, `.panel`, `.project-card`, `.suite-card`, `.qa-mychk-card`: `1px solid var(--border-subtle)`, `--bg-card`, `--radius-md`, subtle hover lift (`translateY(-2px)`).
  - `.cases-table`: Full-width data table inside `.cases-table-wrapper` (`overflow-x: auto`) with uppercase `0.72rem` `<th>` headers and hover-highlighted `<tr>` rows.
- **Icons:** 100% inline Feather/Lucide-style SVG icons (`stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`).
- **Modals (`.modal-backdrop` + `.modal-dialog`):**
  - Backdrop uses `backdrop-filter: blur(4px)` and locks page scroll via `html:has(.modal-backdrop.open) { overflow: hidden !important; }`.
  - Dialogs scale in (`translateY(12px) scale(0.98)` -> `translateY(0) scale(1)`) across 4 width tiers: `.modal-dialog-sm` (`460px`), default `.modal-dialog` (`580px`), `.modal-dialog-md` (`660px`), `.modal-dialog-lg` (`840px`), and `.modal-dialog-xl` (`980px`).

---

## 6. Functional Interaction Inventory

Every user-facing UI element in Qavora Web has been audited against its underlying JavaScript event listeners and backend API calls.

### 6.1 Summary Classification Matrix

| Status Classification | Feature / UI Component | DOM Selector(s) | Verification Evidence & Actual Behavior |
| :--- | :--- | :--- | :--- |
| **Fully Functional** | Authentication (Sign In, Register, Session Restore, Sign Out) | `#auth-login-form`, `#auth-register-form`, `#header-logout-btn`, `#sidebar-logout-btn`, `#account-menu-logout` | Wired in `/authUI.js` & `/authController.js` to `/api/auth/login`, `/api/auth/register`, `/api/auth/me`, `/api/auth/logout`. |
| **Fully Functional** | Client-Side Routing & History Navigation | `.nav-link[data-route]`, `popstate`, breadcrumb buttons | Wired in `/src/modules/uiRenderer.js:155-265`. Updates URL path, query params, active sidebar item, and view title. |
| **Fully Functional** | Theme Switching (Dark / Light) | `#theme-toggle-btn`, `#settings-theme-select` | Wired in `/src/modules/uiRenderer.js:489-535` & `/src/modules/settingsManager.js:317-330`. Updates `html[data-theme]` and persists to `PATCH /api/auth/preferences`. |
| **Fully Functional** | Formal Projects CRUD, Filtering, Sorting & Quick Status | `#project-modal`, `#view-projects`, `#view-project-details` | Wired in `/src/modules/projectManager.js` to `GET/POST /api/projects`, `PATCH/DELETE /api/projects/:id`, plus offline queue fallback. |
| **Fully Functional** | Test Plan, Execution Phases, Test Suites & Test Cases CRUD | `#view-plans`, `#testplan-modal`, `#phase-modal`, `#suite-modal`, `#testcase-modal`, `#testcase-view-modal` | Wired in `/src/modules/testPlanManager.js` to `PATCH /api/projects/:id/data` and IndexedDB offline queue. |
| **Fully Functional** | Test Execution, Test Runs/Cycles, Step Verification, Quick Pass/Fail & Inline Defect Creation | `#view-execution`, `#execution-modal`, `#execution-history-modal`, `#execution-run-modal`, `#project-runs-history-modal` | Wired in `/src/modules/executionManager.js`. Supports step-level Pass/Fail/Skip, 1-click Pass/Fail, run lifecycle, and auto-defect creation. |
| **Fully Functional** | Defect Tracker CRUD, Filtering, Quick Status Update | `#view-defects`, `#defect-modal`, `#defect-view-modal` | Wired in `/src/modules/defectManager.js`. Syncs with project defects array and updates sidebar badge `#nav-defects-count`. |
| **Fully Functional** | Reports & Analytics (11 KPIs, Health Insights, Donut & Velocity SVG Charts, 7 Breakdown Tables) | `#view-reports` | Wired in `/src/modules/reportsManager.js`. Dynamically recomputes on project scope or date range (`ALL`, `7D`, `30D`, `90D`, `CUSTOM`) change. |
| **Fully Functional** | QA Checklist Generator, Parser, Inline Editor & Unclassified Line Resolution | `#view-checklist-generator` | Wired in `/checklistGeneratorUI.js` & `/qaParser.js`. Parses raw text/Markdown, toggles Editable vs Clean preview, and saves to `qaChecklistStore`. |
| **Fully Functional** | My QA Checklists & Manual QA Test Runner (Checkboxes, Status Cycling, Complete Testing, Markdown/TXT Reports, Promote to Project) | `#view-my-checklists`, `#view-qa-runner`, `#qa-checklist-promote-modal`, `#qa-complete-testing-modal`, `#qa-completion-report-modal` | Wired in `/qaRunnerUI.js`, `/qaChecklistStore.js`, and `/qaReportGenerator.js`. Persists to `localStorage`, IndexedDB, and `/api/checklists`. |
| **Fully Functional** | Offline Sync Queue, Auto-Sync, Retry & HTTP 409 Conflict Resolution Modal | `#offline-sync-status-btn`, `#offline-sync-modal` | Wired in `/qaChecklistSyncQueue.js` & `/src/modules/uiRenderer.js:1015-1455`. Full IndexedDB queueing, cross-tab locks, and merge/discard conflict resolution. |
| **Fully Functional** | Data Management: JSON Backup/Import, 4 CSV Exports, Rollback Snapshot Restore, Workspace Reset | `#view-data`, `#import-preview-modal`, `#reset-confirm-modal` | Wired in `/src/modules/dataManager.js` to `/api/data/storage-usage`, `/api/data/import`, `/api/data/recovery-snapshot`, `/api/data/rollback`, `/api/data/reset`. |
| **Fully Functional** | Settings: User Profile Name/Role Update, Password Change, Default Tester Name/Env, MongoDB Connection Test | `#view-settings` (Cards 2, 3, 5) | Wired in `/src/modules/settingsManager.js` to `PATCH /api/auth/profile`, `POST /api/auth/change-password`, `PATCH /api/auth/preferences`, and `GET /api/tests`. |
| **Partially Implemented** | **Settings — Table & List Density (`#settings-density-select`)** | `#settings-density-select` in `#view-settings` | `settingsManager.js:62,337` toggles class `body.density-compact` and saves `density` to `/api/auth/preferences`, **but** `/style.css:8720` targets `[data-density="compact"]`. Thus compact density CSS rules never activate visually. |
| **Partially Implemented** | **Settings — QA Workflow & Defaults (Card 4)** | `#settings-project-sort-select`, `#settings-case-priority-select`, `#settings-autopass-steps-toggle`, `#settings-action-toasts-toggle` | Changing these 4 controls saves `projectSort`, `casePriority`, `autoPassSteps`, and `actionToasts` to `/api/auth/preferences` (`/src/modules/settingsManager.js:346-372`), **but** no feature module reads these 4 preference values at runtime (`testPlanManager.js:1293` hardcodes `'High'`, `showToast()` always shows toasts, etc.). |
| **Partially Implemented** | **Notifications Dropdown Panel (`#notification-btn`, `#notification-panel`)** | `#notification-btn`, `#notification-panel`, `#notification-mark-all-btn`, `#notification-clear-all-btn` | Opening/closing the panel, marking all read, and clearing are wired in `/src/modules/uiRenderer.js:330-404`, **but** no code anywhere in the app ever pushes notification items into `#notification-list` or increments `#notification-count-badge`. |
| **Partially Implemented** | **Printable QA Report Type Selector (`#print-report-type-select`)** | `#print-report-type-select`, `#btn-print-qa-report` in `#view-data` | Dropdown offers 5 report types (`qa-summary`, `test-plan-spec`, `execution-audit`, `defect-log`, `full-dossier`), **but** `generatePrintableReport()` (`/src/modules/dataManager.js:603-726`) outputs the same Executive Summary table for all 5 options (only changing the subtitle string). |
| **Disabled / Unimplemented Backend Feature** | **Dashboard Recent Activity Log (`#recent-activity-container`, `#clear-activity-btn`)** | `#recent-activity-container`, `#clear-activity-btn` in `#view-dashboard` | Explicitly displays static empty state in `/src/modules/dashboardManager.js:309-325`: *"Activity audit logging is currently not implemented on the backend server."* Clicking `Clear` shows toast `"Activity log is empty."`. |
| **Visual-Only** | **Top Header Quick Search Input (`#top-quick-search`) & `⌘K` Badge** | `#top-quick-search`, `.search-kbd` in `<header class="top-nav">` | Purely visual HTML element in `/index.html:494-501`. Zero event listeners or keyboard shortcuts (`⌘K` / `Ctrl+K`) are bound to `#top-quick-search` in any JS file. |
| **Unused DOM Element** | **In-DOM Printable Report Container (`#printable-report-container`)** | `#printable-report-container` in `/index.html:5541` | Styled for `@media print` in `/style.css:6285-6452`, but `generatePrintableReport()` in `/src/modules/dataManager.js:715` opens a standalone `window.open('', '_blank')` document instead of populating `#printable-report-container`. |

---

## 7. Responsive Behavior

Qavora Web implements a multi-tier responsive system in `/style.css` (lines 3816–4979 and 9477–12463) spanning from `320px` small phones up to `1920px+` ultrawide monitors, plus short landscape viewports.

### 7.1 Breakpoint Architecture Matrix

| Breakpoint Range | Target Device Class | Sidebar Behavior | Top Nav (`<header class="top-nav">`) | Grid & Card Adaptations | Modal & Form Adaptations |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`>= 1920px`** (`/style.css:12110`) | Ultrawide Desktop | Fixed left, `270px` wide | `64px` tall, `44px` horizontal padding; search max-width `500px` | Content max-width `1740px`; Reports KPI grid `6 cols`; Data stats `6 cols`; Defects KPI `5 cols` | Large modals up to `900px` wide |
| **`1440px – 1919px`** (`/style.css:12041`) | Large Desktop Monitor | Fixed left, `260px` wide | `64px` tall, `36px` padding; search max-width `440px` | Dashboard KPIs `4 cols`; Data stats `6 cols`; Execution metrics `8 cols` (single row); Dashboard analytics `8 chips` (single row) | Large modals `860px` wide |
| **`1280px – 1439px`** (`/style.css:11978`) | Large Laptop | Fixed left, `240px` wide | `64px` tall, `30px` padding; search max-width `340px` | Defects KPI `5 cols`; Execution metrics `8 cols`; Reports KPI `4 cols`; Data stats `3x2 grid` | Large modals `820px` wide |
| **`1024px – 1279px`** (`/style.css:11901`) | Standard Laptop / Landscape Pro Tablet | Fixed left, `224px` wide | `64px` tall, `24px` padding; `.user-meta` & `.search-kbd` hidden `<1140px` | Defects KPI `5 cols` (compact); Execution metrics `4x2 grid`; Dashboard analytics `4x2 grid` | Standard modals `580px`, large `760px`; height-constrained `<820px` reduces vertical padding |
| **`600px – 1023px`** (`/style.css:10480-11592`) | Tablets (Small `600–767px`, Standard `768–899px`, Large `900–1023px`) | Off-canvas slide-out drawer (`290px`, `z-index: 999`) with blurred `#sidebar-overlay`; hamburger `#sidebar-open-btn` shown | `60px` tall; `#top-nav-center` search hidden `<768px`, visible `768–1023px` (`240–300px` wide) | Touch targets `>=40–44px`; `600–767px` uses 2-col KPI/project grids; `768–1023px` uses 4-col KPI grids & 2-col project/suite grids | Modals `calc(100vw - 48px)` max-width; `.form-row-2` stays 2-col on tablet |
| **`<= 599px`** (`/style.css:9482-10320`) | Standard & Large Mobile Phones | Off-canvas drawer (`min(85vw, 300px)`) with safe-area insets | `56px` tall; subtitle & search hidden; `+ New Project` and `Sign Out` collapse to `40x40px` icon-only buttons; `.user-meta` hidden | Zero horizontal overflow (`max-width: 100vw; overflow-x: hidden`); KPI grids `2 cols`; Projects, Suites, and Checklists stack in `1 col`; `.cases-table` scrolls horizontally inside `.cases-table-wrapper` (`min-width: 580px`) | All inputs forced to `font-size: 16px !important` (prevents iOS auto-zoom); all buttons `min-height: 44px`; `.form-row-2` & `.form-row-3` collapse to `1 col`; modal footer buttons stack full-width; `.auth-card` becomes edge-to-edge transparent |
| **`<= 380px` & `<= 335px`** (`/style.css:10323-10401`) | Compact / Small Mobile (`320px–380px`) | Off-canvas drawer | `#header-logout-btn` hidden `<=380px` (accessible in drawer/dropdown); `.user-profile-caret` hidden `<=335px` | All KPI grids (`.stats-grid`, `.reports-kpi-grid`, `.qa-runner-metrics-grid`) collapse from 2 columns to **1 single column** | Modals expand to `calc(100vw - 8px)` with compact `10px` padding |
| **`max-height: 500px` & `landscape`** (`/style.css:4888, 10404`) | Mobile Landscape Viewports | Off-canvas drawer | `48px` tall; `.page-subtitle` hidden | Compact vertical padding on banners and progress cards | Modal max-height `calc(100dvh - 8px)` with horizontal footer buttons and scrollable `.exec-steps-list` (`max-height: 140px`) |

---

## 8. Loading, Empty, Error, and Offline States

### 8.1 Loading States
1. **Initial Session Verification (`#auth-loading-overlay`):** Full-screen spinner (`"Verifying session..."`) shown while `authController.init()` calls `GET /api/auth/me`.
2. **Auth Form Submission Spinners:** `#login-submit-spinner` (`"Signing in..."`) and `#register-submit-spinner` (`"Creating account..."`) disable form inputs and show inline button spinners (`/authUI.js:245-295`).
3. **Logout Button Spinners:** `#header-logout-spinner` and `#sidebar-logout-spinner` replace the logout icon with a spinning SVG during `POST /api/auth/logout`.
4. **Sidebar MongoDB Connection Pulse (`#sidebar-db-dot.connecting`):** Pulsing amber dot (`@keyframes storage-dot-pulse`) with `"Checking MongoDB..."` while checking `/api/health`.
5. **Top Bar Offline Sync Spinner (`#offline-sync-icon-spin`):** Spinning arrows icon with `"Syncing..."` label in `#offline-sync-status-btn` while `processChecklistSyncQueue()` or `processProjectSyncQueue()` is actively replaying operations.

### 8.2 Empty & No-Results States
Every collection view implements dedicated empty states (when 0 items exist) and filter no-results states (when items exist but 0 match active filters):
- **Dashboard (`#view-dashboard`):**
  - `#recent-projects-empty`: `"No Projects Created Yet"` + `#empty-state-create-btn`.
  - `#recent-activity-container`: Static `"No Recent Activity Recorded"` card.
- **Projects (`#view-projects`):**
  - `#projects-empty-state`: `"No QA Projects Found"` + `#projects-empty-create-btn`.
  - `#projects-no-results-state`: `"No Matching Projects"` + `#projects-no-results-reset-btn`.
- **Test Plans & Suites (`#view-plans`):**
  - `#plans-no-project-state`: `"No Active Project Selected"` + `#plans-create-project-btn`.
  - `#phases-empty-state`: `"No Execution Phases or Test Suites Yet"` + `#btn-empty-add-phase` & `#btn-empty-add-suite`.
  - Suite Explorer empty table state when a suite has 0 test cases or 0 filter matches.
- **Test Execution (`#view-execution`):**
  - `#exec-no-project-state`: `"No Active Project Available"` + `#btn-exec-create-project`.
  - `#exec-empty-cases-state`: `"No Test Cases Ready for Execution"` + `#btn-exec-empty-add-case`.
- **Defects (`#view-defects`):**
  - `#defects-empty-state`: `"No Defects Reported"` + `#btn-empty-report-defect`.
  - `#defects-no-results-state`: `"No Matching Defects Found"` + `#btn-defects-clear-filters`.
- **Reports (`#view-reports`):**
  - `#rep-donut-empty`: Shown over the Donut SVG when 0 test cases exist.
  - Table-level empty messages inside Daily Execution Log, Phase Coverage, Priority Breakdown, Suite Quality, Recent Defects, and Recent Executions when no data matches the selected project/date filter.
- **Checklists (`#view-my-checklists` & `#view-qa-runner`):**
  - `#mychk-empty-state`: `"No Saved QA Checklists Yet"` + `#btn-mychk-empty-generate` & `#btn-mychk-empty-sample`.
  - `#qa-runner-phases-container`: Renders empty state card if no checklist is active, with buttons to open `my-checklists` or `checklist-generator`.
- **Data Management (`#view-data`):**
  - `#rollback-empty-container`: `"No recovery snapshot recorded yet."` when `GET /api/data/recovery-snapshot` returns `null`.
- **Notifications (`#notification-panel`):**
  - `#notification-empty-state`: `"No notifications"`.

### 8.3 Error & Validation Feedback States
1. **Inline Form Error Banners (`.alert-banner.alert-danger`):**
   - Present inside every modal form (`#project-form-error`, `#testplan-form-error`, `#phase-form-error`, `#suite-form-error`, `#testcase-form-error`, `#execution-form-error`, `#defect-form-error`, `#qa-promote-form-error`) and auth panel (`#auth-error-alert`).
2. **Field-Level Validation Highlighting:**
   - Invalid fields receive `.is-invalid` (in workspace modals) or `.input-error` (in auth forms) with red border and focus ring, accompanied by inline error text (`#login-email-error`, etc.).
3. **Parser Diagnostic Alerts (`#qa-parser-alerts`):**
   - Color-coded `.qa-alert-success`, `.qa-alert-warning` (unclassified lines found), and `.qa-alert-error` (empty input) banners in `#view-checklist-generator`.
4. **Storage Quota Warning Banner (`#storage-quota-warning-banner`):**
   - Amber/red warning banner in `#view-data` when MongoDB usage reaches `>=80%` of `MONGODB_STORAGE_LIMIT_MB`.
5. **Toast Notification Stack (`#toast-container`):**
   - Rendered by `showToast(message, type)` (`/src/modules/uiRenderer.js:46-95`) with 4 visual variants: `success` (green check), `danger` / `error` (red alert), `warning` (amber triangle), and `info` (indigo info circle). Auto-dismisses after `3500ms` or on clicking `.toast-close`.

### 8.4 Offline Functionality & Synchronization States (`/qaChecklistSyncQueue.js`)
- **Offline Detection & Local Fallback:**
  - When `navigator.onLine === false` or an API request fails with a network error / `503 Service Unavailable`, Qavora transitions to Offline Mode:
    - Sidebar badge `#sidebar-db-badge` switches to red dot `.disconnected` with label `"Offline (Local Mode)"`.
    - Top bar `#offline-sync-status-btn` displays `"Offline"` or `"Pending (N)"`.
    - Reads fall back to IndexedDB stores `offline_projects_cache` and `offline_checklists_cache` (scoped strictly to the authenticated `userId`).
    - All mutations (Project Create/Update/Delete, Test Plan/Phase/Suite/Case/Execution/Defect updates, Checklist Create/Update/Delete) are applied optimistically to in-memory state + IndexedDB cache and queued in `pending_project_operations` or `pending_checklist_operations`.
- **Automatic & Manual Queue Replay:**
  - Triggered automatically on `window` `'online'` event, `document` `'visibilitychange'` (when tab becomes visible), login/session restoration, or manually via `"Sync Now"` (`#btn-offline-sync-now`) in `#offline-sync-modal`.
  - Operations are sorted by entity dependency rank (`DEPENDENCY_RANKS`: Project Create `10` -> Phase `20` -> Suite `30` -> Test Case `40` -> Execution `50` -> Defect `60` -> Project Update `70` -> Delete `90`) and coalesced where appropriate.
- **Cross-Tab Coordination:**
  - Uses `navigator.locks.request` (Web Locks API) with an IndexedDB lease lock fallback (`sync_locks` store, 15s TTL with heartbeat renewal) and `BroadcastChannel('qavora_offline_sync_channel')` so multiple open tabs never replay the same queue concurrently.
- **Conflict (`HTTP 409`) & Dead-Letter (`failed`) States:**
  - If the server returns `409 Conflict` (optimistic concurrency `expectedUpdatedAt` mismatch), the operation is marked `status: 'conflict'`, `requiresManualResolution: true`, and surfaced in `#offline-sync-modal` (`#offline-modal-conflicts-section`) with `"Keep My Changes"` (`merge`) vs. `"Use Server Version"` (`keep_server`) buttons.
  - Permanent `4xx` errors or operations exceeding `DEFAULT_MAX_RETRIES` (`5` retries with exponential backoff `1000ms * 2^retry`) enter `status: 'failed'` and appear in `#offline-modal-failed-section` with `"Retry"` and `"Discard"` controls.
  - If `401 Unauthorized` occurs mid-sync, the operation is preserved as `'pending'` and queue replay halts cleanly until the user re-authenticates.

---

## 9. Role-Based UI Differences

A thorough inspection of both the frontend modules (`/authUI.js`, `/authController.js`, `/src/modules/authSession.js`, `/src/modules/settingsManager.js`) and the backend API (`/server.ts`) confirms the following regarding roles and permissions:

1. **No Role-Based Access Control (RBAC) or UI Restrictions:**
   - Every authenticated user has identical access to all 12 screens, 20 modals, CRUD operations, exports, imports, and workspace reset features.
   - No navigation links, buttons, form fields, or views are hidden or disabled based on `user.role`.
2. **`user.role` is a Free-Text Display Title:**
   - During registration (`#register-role-input` in `/index.html:248`) and in Settings (`#settings-profile-role` in `/index.html:3025`), `role` is a free-form text input (`maxlength="60"`, placeholder `"e.g. QA Lead, Manual Tester, Product Manager"`).
   - If omitted during registration, `/authUI.js:405` defaults it to `"QA Engineer"` and `/server.ts:1411` defaults it to `"QA Tester"`.
   - The `user.role` string is displayed purely as a profile badge in 4 UI locations:
     1. `#sidebar-user-role` (Sidebar footer user card)
     2. `#header-user-role` (Top nav bar user profile button)
     3. `#account-dropdown-role` (Account dropdown menu badge)
     4. `#settings-account-role-badge` & `#settings-profile-role` (Settings -> Account & Security card)
3. **Strict Multi-Tenant User Isolation (`userId` Scoping):**
   - While there is no intra-workspace RBAC, strict data isolation is enforced per user account: every MongoDB query (`/server.ts`) and every IndexedDB cache/queue operation (`/qaChecklistSyncQueue.js`) filters by the authenticated `user.id` (`userId`), preventing cross-account data leakage on shared browsers.

---

## 10. Source File Reference Index

| File Path | Lines | Role & Responsibilities in Qavora Web |
| :--- | :--- | :--- |
| `/index.html` | 6,033 | Complete SPA HTML document containing `#auth-loading-overlay`, `#auth-container`, `#app-container` (sidebar, top header, 12 `.view-section` screens), 18 static modals, `#toast-container`, and `#printable-report-container`. |
| `/style.css` | 12,676 | Master stylesheet defining dark/light CSS variables, typography, layout shell, component primitives, print styles (`@media print`), compact density rules, and responsive breakpoints (`320px` to `1920px+`). |
| `/script.js` | 308 | Application entry point: initializes `authController`, `authUI`, `uiRenderer`, `checklistGeneratorUI`, `qaRunnerUI`, global bridge callbacks (`__qavoraOnProjectPromoted`, `__qavoraGetActiveProjects`), and post-login data hydration. |
| `/authController.js` | 468 | Authentication state machine (`initializing`, `authenticated`, `unauthenticated`), session verification (`GET /api/auth/me`), login, registration, logout, and CSRF token management. |
| `/authUI.js` | 673 | DOM bindings, tab switching, password visibility toggles, client-side validation, loading spinners, and view transitions for `#auth-loading-overlay` and `#auth-container`. |
| `/checklistGeneratorUI.js` | 1,369 | Controller for `#view-checklist-generator`: raw plan textarea stats, sample plan loader, parser invocation, Editable vs. Formatted Preview rendering, inline CRUD on draft plan, unclassified item resolution, and `"Confirm & Start Testing"`. |
| `/qaRunnerUI.js` | 2,724 | Controller for `#view-my-checklists`, `#view-qa-runner`, and 4 checklist modals (`#qa-checklist-delete-modal`, `#qa-checklist-promote-modal`, `#qa-complete-testing-modal`, `#qa-completion-report-modal`). |
| `/qaChecklistStore.js` | 2,525 | Checklist state & persistence layer (`localStorage` + `/api/checklists` + IndexedDB queue), status cycling (`Not Started`/`Passed`/`Failed`/`Skipped`), completion workflow, report data builder, and formal project promotion (`promoteChecklistToProject`). |
| `/qaChecklistSyncQueue.js` | 3,009 | Offline-first synchronization engine using IndexedDB (`qavora_offline_db` v2), Web Locks + IndexedDB lease locks, `BroadcastChannel`, dependency sorting, exponential backoff, and HTTP 409 conflict resolution for both checklists and formal projects. |
| `/qaParser.js` | 1,359 | Deterministic regex/structural parser converting plain-text and Markdown QA test plans into structured phases, categories, test items (with IDs and priorities), supporting notes, and unclassified items. |
| `/qaReportGenerator.js` | 289 | Generates formatted Markdown (`.md`) and Plain Text (`.txt`) QA completion reports and triggers browser file downloads. |
| `/src/modules/state.js` | 56 | Centralized in-memory `_appState` store (`projects`, `activeProjectId`, `currentRoute`, `isBackendAvailable`, `isSyncing`, `pendingDelete`) with getters/setters. |
| `/src/modules/apiClient.js` | 107 | `apiFetch`, `apiJson`, and `checkBackendHealth` wrappers injecting `credentials: 'include'`, `X-CSRF-Token` header on mutating requests, and 401/503 status handling. |
| `/src/modules/authSession.js` | 80 | `updateUserProfileUI()` helper synchronizing authenticated user name, email, role, and avatar initials across sidebar, top bar, and account dropdown. |
| `/src/modules/utils.js` | 71 | Shared utilities: `escapeHtml`, `deepClone`, `debounce`, `formatDate`, `formatDateTime`, and `sanitizeUrl`. |
| `/src/modules/uiRenderer.js` | 1,938 | Router (`navigateTo`, `resolveInitialRoute`), `showToast`, mobile drawer, theme toggle, notifications dropdown, account dropdown, universal delete modal, project modal bindings, and `#offline-sync-modal` controller. |
| `/src/modules/dashboardManager.js` | 327 | Computes workspace-wide metrics (`getDashboardMetrics`) and renders `#view-dashboard` (KPIs, progress bar, 8 analytics chips, distribution bar, recent projects, and static activity log empty state). |
| `/src/modules/projectManager.js` | 1,088 | Project data hydration (`loadProjectsFromBackend`), project CRUD (`createProject`, `updateProjectMetadata`, `saveProjectData`, `deleteProjectById`), sidebar counter updates, `#view-projects` grid, and `#view-project-details`. |
| `/src/modules/testPlanManager.js` | 1,440 | Renders `#view-plans` (Sub-View A `#plans-phases-subview` and Sub-View B `#plans-cases-subview`) and manages CRUD modals for Test Plans, Execution Phases, Test Suites, and Test Cases (including dynamic step builder and `#testcase-view-modal`). |
| `/src/modules/executionManager.js` | 1,610 | Renders `#view-execution`, manages Test Runs / Cycles (`#execution-run-modal`, `#project-runs-history-modal`), step-by-step execution (`#execution-modal`), 1-click Quick Pass/Fail, inline defect creation, and `#execution-history-modal`. |
| `/src/modules/defectManager.js` | 1,028 | Renders `#view-defects` and manages defect CRUD, filtering, quick status updates, `#defect-modal`, and `#defect-view-modal`. |
| `/src/modules/reportsManager.js` | 1,084 | Renders `#view-reports`: scope/date filtering, 11 KPIs, automated QA Health Insights, SVG Donut chart, SVG Velocity Trend chart, and 7 analytics breakdown tables. |
| `/src/modules/settingsManager.js` | 495 | Renders `#view-settings`: theme/density preferences, default tester profile, account name/role update, password change, workflow defaults, storage health stats, and MongoDB connection test. |
| `/src/modules/dataManager.js` | 1,310 | Renders `#view-data`: MongoDB storage quota bar, JSON backup export/import (`#import-preview-modal`), 4 CSV exporters, printable report generator, rollback snapshot restore, and workspace reset (`#reset-confirm-modal`). |
| `/server.ts` & `/api/index.ts` | 4,145 / 4 | Express 5 + MongoDB Atlas backend server providing `/api/health`, `/api/auth/*`, `/api/projects/*`, `/api/checklists/*`, `/api/data/*`, and `/api/tests` endpoints. |

---

## 11. Limitations, Discrepancies & Verified Audit Findings

The following concrete implementation discrepancies and limitations were verified directly from the source code and should be factored into any Web-to-Android parity planning:

1. **Top Navigation Quick Search (`#top-quick-search`) is Unbound (Visual-Only):**
   - Rendered in `/index.html:494-501` with placeholder `"Quick search test cases, suites, defects..."` and a `<kbd>⌘K</kbd>` badge, but no event listener is attached in any JavaScript module. (Search inputs inside individual views — `#project-search-input`, `#case-search-input`, `#exec-search-input`, `#defect-search-input`, `#mychk-search-input` — are all 100% functional).
2. **Notification Center (`#notification-panel`) has UI Shell Handlers Only:**
   - `/src/modules/uiRenderer.js:330-404` implements opening/closing the bell popover, `"Mark all read"`, and `"Clear"`, but no producer function exists to create notification items when tests fail or defects are logged. The panel permanently displays `#notification-empty-state`.
3. **Dashboard "Recent Activity" Panel (`#recent-activity-container`) is Explicitly Unimplemented:**
   - `/src/modules/dashboardManager.js:309-325` hardcodes an empty state explaining: *"Activity audit logging is currently not implemented on the backend server."*
4. **Settings "Table & List Density" (`#settings-density-select`) Selector Mismatch:**
   - `/src/modules/settingsManager.js:62,337` toggles class `document.body.classList.add('density-compact')`, whereas `/style.css:8720-8733` scopes compact table/card rules under `[data-density="compact"]`. Because `data-density` is never set on `<html>` or `<body>`, selecting `"Compact"` in Settings persists to MongoDB but does not visually compact tables or cards.
5. **Settings "QA Workflow & Defaults" (Card 4) Persists to Backend Only:**
   - Changing `#settings-project-sort-select`, `#settings-case-priority-select`, `#settings-autopass-steps-toggle`, and `#settings-action-toasts-toggle` saves to `PATCH /api/auth/preferences`, but the feature modules (`projectManager.js`, `testPlanManager.js`, `executionManager.js`, `uiRenderer.js`) do not read `user.preferences` for those 4 settings.
6. **Printable Report Type Dropdown (`#print-report-type-select`) Renders Identical Body:**
   - Selecting any of the 5 report types in `#view-data` (`qa-summary`, `test-plan-spec`, `execution-audit`, `defect-log`, `full-dossier`) calls `generatePrintableReport()` (`/src/modules/dataManager.js:603-726`), which always generates the same Executive Summary table and only changes the `Report Type:` header metadata text. Furthermore, it opens a popup print window (`window.open('', '_blank')`) rather than using the in-DOM `#printable-report-container` (`/index.html:5541`).
7. **Legacy Static Copy in Data Architecture & Privacy Tab (`#data-tabpanel-info`):**
   - `/index.html:3900-3944` contains static documentation from an earlier local-only phase stating *"100% Client-Side Privacy Architecture... Zero Network Telemetry: No tracking scripts, server databases, or external API requests are ever made"*, whereas the application now uses MongoDB Atlas (`/api/*`) as its primary persistence layer with IndexedDB offline caching.
8. **No Unauthenticated "Forgot Password" Flow:**
   - `#auth-login-panel` does not have a password reset or forgot-password flow; users can only change their password while authenticated inside `#view-settings` (`POST /api/auth/change-password`).
