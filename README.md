# Qavora

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen.svg)](https://hannankhan203.github.io/Qavora/)
[![Vite](https://img.shields.io/badge/bundler-vite-646CFF.svg)](https://vitejs.dev/)
[![JavaScript](https://img.shields.io/badge/language-vanilla%20ES6+-F7DF1E.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./script.js)

**Qavora** is a browser-based, client-side manual QA and testing management application. It provides software development and testing teams with a structured, generic, no-code environment to organize test plans, parse raw specifications into interactive checklists, execute test runs, track manual verification progress, log defects, and maintain testing health metrics without requiring external servers, third-party databases, or automated runners.

---

## Live Demo

**Official Live Deployment:** [https://hannankhan203.github.io/Qavora/](https://hannankhan203.github.io/Qavora/)

---

## Workflow Overview

```text
┌─────────────────────────────────┐
│     Create / Import QA Plan     │
│ (Raw text, Markdown, bulleted)  │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│         Parse & Review          │
│   (Phases, Categories, Tests)   │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│     Edit & Review / Preview     │
│   (Inline edits & Clean View)   │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│       Generate Checklist        │
│   (Saved into Local Storage)    │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│       QA Test Execution         │
│   (Interactive Manual Runner)   │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│   Record Results & Log Defects  │
│    (Pass / Fail / Block / Skip) │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│     Review Reports & Metrics    │
│   (Pass rate, trends, velocity) │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│     Backup & Device Transfer    │
│  (JSON Backups & Portable TPX1) │
└─────────────────────────────────┘
```

---

## Key Features

### 1. QA Plan Parsing (`qaParser.js`)
- **Structure Recognition**: Parses raw plain-text or Markdown testing plans into hierarchical phases, phase descriptions, testing categories, individual test cases, and supporting notes.
- **Phase Detection**: Identifies standard naming patterns (e.g., `PHASE 0 — Setup`, `Phase 1: Authentication`, `## Phase 2`, `0. Environment Setup`, `Final Regression Checklist`).
- **Test Case Extraction**: Parses bulleted lists (`-`, `*`, `•`, `[ ]`, `☐`), numbered checks (`1.`, `2)`), and lettered items (`a)`, `b)`).
- **Test Metadata Extraction**: Preserves existing test IDs (e.g., `AUTH-001`, `[TC-104]`, `TEST_01`) and priority tags (`Critical`, `High`, `Medium`, `Low`, `P0`–`P4`).
- **Description & Note Preservation**: Distinguishes introductory objectives, environment instructions, and prerequisites from executable test items.
- **Unclassified Item Isolation**: Any ambiguous lines that cannot be deterministically classified are isolated in an interactive review panel so nothing is silently discarded.

### 2. Edit & Review Mode
- **Inline Editing**: Modify phase titles, descriptions, category groupings, test IDs, priorities, and descriptions directly before saving.
- **Structural Reorganization**: Add, rename, or delete phases, categories, and test cases inline.
- **Priority Assignment**: Assign or adjust test priorities (`Critical`, `High`, `Medium`, `Low`, `No Prio`) via native dropdown selectors.

### 3. Clean Preview Mode
- **Standardized Presentation**: View parsed testing plans formatted with clean typographic hierarchy, priority pills, and category tags without edit inputs.
- **Pre-Execution Inspection**: Verify plan completeness, phase counts, category structures, and total test counts prior to launching execution.

### 4. Interactive Manual QA Test Runner (`qaRunnerUI.js`)
- **Execution Tracking**: Click or tap anywhere on a test case row to toggle completion between `Not Started` and `Completed`.
- **Live Progress Analytics**: Real-time progress percentage bar, completed vs. remaining counters, and phase-level completion ratios.
- **Expand / Collapse Controls**: Global "Expand All" and "Collapse All" controls plus per-phase accordion toggles to navigate large test suites.
- **Inline Runner Editing**: Toggle "Edit Checklist" inside the active runner to adjust test IDs, descriptions, and priorities on the fly without resetting test completion status.
- **Active Runner State**: Remembers the currently active checklist across sessions and view switches.

### 5. Multi-Checklist Workspace (`qaChecklistStore.js`)
- **Independent Checklists**: Create and store multiple distinct checklists simultaneously in browser storage.
- **Checklist Management**: Open, resume, rename, or delete saved checklists from the "My QA Checklists" view.
- **Progress Badges**: Immediate visual indicators (`Not Started`, `In Progress`, `Completed`) with completion timestamps and test counts.
- **Quick Resume**: Contextual banners in the checklist generator allow resuming active test sessions in one click.

### 6. Project & Workspace Management
- **Testing Workspaces**: Organize test efforts by application type (`Website`, `Web Application`, `Mobile Application`, `Desktop Application`, `SaaS Platform`, `Chatbot / AI Application`, `E-commerce`, `Other`).
- **Project Lifecycle Tracking**: Filter and categorize projects by active status (`Active`, `Completed`, `Archived`).
- **Project Details**: Dedicated project dashboard displaying test plans, test suites, execution history, and defects associated with the project.

### 7. Test Plans, Suites & Test Cases
- **Hierarchical Structuring**: Structure testing into Test Plans, Phases, Test Suites, and granular Test Cases.
- **Granular Test Case Authoring**: Define preconditions, step-by-step verification instructions, test data inputs, and expected results.
- **Filtering & Search**: Filter test cases by priority, category, or search keywords across project suites.

### 8. Defect Management
- **Defect Tracking**: Log defects found during test executions with severity (`Critical`, `High`, `Medium`, `Low`) and status (`Open`, `In Progress`, `Resolved`, `Closed`, `Reopened`).
- **Traceability**: Link defects directly to failing test cases and projects.
- **Defect KPI Ribbon**: Monitor total, open, in-progress, resolved, and critical defect counts in real time.

### 9. Reports & Analytics
- **Quality Health Metrics**: Track cross-project pass rates, total executions, active defects, and unique case coverage.
- **Execution Distribution Donut Chart**: Visual breakdown of Passed, Failed, Blocked, and Skipped outcomes.
- **Velocity Trend Chart**: SVG-rendered timeline chart displaying execution volume and pass/fail distributions.
- **Printable QA Reports**: Built-in CSS print engine (`@media print`) format to export clean executive PDF test reports directly from the browser print dialog.

---

## Data Management & Persistence

Qavora is an **offline-first, browser-local application**. All user projects, checklists, execution logs, and defect records are stored locally in the user's browser using the Web Storage API (`localStorage`).

### Persistence Features
- **Deterministic Storage Keys**: Checklists and projects are stored under isolated, versioned keys.
- **Quota Error Handling**: Automatically detects `QuotaExceededError` and Firefox `NS_ERROR_DOM_QUOTA_REACHED` during persistence operations, rolling back state to prevent corrupted records and alerting the user.
- **SecurityError Graceful Degradation**: Protects execution in restrictive iframe environments (e.g., third-party storage blocks) via in-memory storage fallbacks.
- **JSON Application Backups**: Export all application data into a single `.json` file for offline archival and disaster recovery.
- **Restore & Merge Operations**:
  - **Replace Mode**: Completely restores the application state from a JSON backup, automatically preserving an emergency recovery snapshot in `qavora_rollback_v1`.
  - **Merge Mode**: Intelligently appends imported test plans, suites, cases, and checklists while resolving ID collisions using `crypto.randomUUID` or cryptographic timestamp fallbacks.
- **Rollback Facility**: One-click rollback button in Data Management to recover data if an accidental replace import occurs.

---

## Portable Device-to-Device Transfer (`TPX1`)

Qavora includes a proprietary, zero-cloud transfer engine (`qaChecklistTransfer.js`) allowing users to move manual checklists between mobile phones, tablets, and desktop computers without creating accounts or transmitting data to external servers.

### TPX1 Transfer Protocol
1. **Export**: The user generates a transfer payload for all checklists or a selected checklist.
2. **Compression**: Payloads are compressed using browser-native `CompressionStream('deflate-raw')` (with uncompressed JSON fallback for environments lacking stream compression).
3. **Integrity Checksum**: A cryptographic SHA-256 hash is computed via `crypto.subtle.digest('SHA-256')`, and an 8-byte checksum is attached.
4. **Envelope Encoding**: Encoded as a URL-safe Base64 string prefixed with the `TPX1` envelope identifier:
   ```text
   TPX1.<method>.<checksum>.<payload>
   ```
5. **Portability**: Payloads can be copied to the clipboard or downloaded as a `.txt` transfer file.
6. **Import & Verification**: On the receiving device, the string or `.txt` file is decoded, decompressed, verified against the checksum, and normalized through schema validation before being merged or restored.

---

## Storage Architecture

Qavora uses the following versioned keys in browser `localStorage`:

| Key | Scope & Purpose |
|---|---|
| `qavora_qa_checklists_v1` | Array of saved manual QA checklists, phases, categories, tests, and completion statuses |
| `qavora_qa_active_runner_v1` | Metadata and ID of the active checklist loaded in the QA Test Runner |
| `qavora_projects_v1` | Registered projects, test plans, test suites, test cases, and defects |
| `qavora_activities_v1` | Activity audit log tracking user actions and timestamped testing events |
| `qavora_theme_preference` | User interface color theme preference (`dark` or `light`) |
| `qavora_rollback_v1` | Pre-import recovery snapshot for disaster recovery rollback |

### Backward Compatibility & Legacy Migration
The storage store automatically detects and safely migrates legacy keys (`testpilot_qa_checklists_v1`, `testpilot_projects_v1`, `testpilot_activities_v1`, `testpilot_theme_preference`, `testpilot_rollback_v1`) to their corresponding `qavora_*` locations upon initial load, preserving all historical test records without user intervention.

---

## Technical Architecture

Qavora is engineered as a **pure client-side single page application (SPA)** with zero runtime server-side dependencies.

```text
┌────────────────────────────────────────────────────────┐
│                   index.html                           │
│        (Semantic DOM Structure, Modals & Views)        │
└───────────────────────────┬────────────────────────────┘
                            │
       ┌────────────────────┼───────────────────┐
       ▼                    ▼                   ▼
┌──────────────┐     ┌──────────────┐    ┌──────────────┐
│  style.css   │     │  script.js   │    │  qaRunnerUI  │
│ (Design Sys) │     │ (App Core)   │    │ (Test Exec)  │
└──────────────┘     └──────┬───────┘    └──────┬───────┘
                            │                   │
             ┌──────────────┴─────────┬─────────┴────────────┐
             ▼                        ▼                      ▼
      ┌──────────────┐         ┌──────────────┐       ┌──────────────┐
      │ qaParser.js  │         │qaChecklist-  │       │qaChecklist-  │
      │(Plan Parser) │         │  Store.js    │       │ Transfer.js  │
      └──────────────┘         └──────────────┘       └──────────────┘
```

- **Markup (`index.html`)**: Semantic HTML5 structure providing 14 distinct workspace views and accessible dialogs.
- **Styling (`style.css`)**: Vanilla CSS3 design system using CSS Custom Properties (variables), CSS Grid, and Flexbox with responsive breakpoints covering 320px to 2560px.
- **Core Controller (`script.js`)**: Coordinates project management, test suites, case authoring, step execution, defect tracking, and analytics.
- **Parser Engine (`qaParser.js`)**: Pure ES6 structural text parsing using regular expressions and deterministic AST line analysis.
- **Persistence Layer (`qaChecklistStore.js`)**: Encapsulates all read/write/delete operations for checklists with quota safety and schema normalization.
- **Execution Controller (`qaRunnerUI.js`)**: Manages the interactive test runner DOM, completion toggles, and checklist management views.
- **Transfer Engine (`qaChecklistTransfer.js`)**: Browser-native cryptographic hashing, compression, and format encoding for portable data transfer.

---

## Repository Structure

```text
Test-Pilot/
├── .github/
│   └── workflows/
│       └── deploy.yml              # GitHub Actions deployment to GitHub Pages
├── .audit-tmp/                     # Audit and verification scripts
├── public/
│   ├── .nojekyll                   # Bypasses Jekyll processing on GitHub Pages
│   ├── favicon.svg                 # SVG brand favicon
│   ├── favicon.ico                 # Fallback ICO favicon
│   ├── favicon-16x16.png           # 16x16 PNG favicon
│   ├── favicon-32x32.png           # 32x32 PNG favicon
│   ├── apple-touch-icon.png        # iOS touch icon (180x180)
│   ├── icon-192.png                # PWA manifest icon (192x192)
│   ├── icon-512.png                # PWA manifest icon (512x512)
│   └── site.webmanifest            # Web App Manifest for PWA compliance
├── checklistGeneratorUI.js         # UI controller for QA plan paste & preview
├── index.html                      # Primary HTML entry point and application shell
├── metadata.json                   # AI Studio applet configuration metadata
├── package.json                    # Project dependencies and script declarations
├── qaChecklistStore.js             # Local storage persistence and validation engine
├── qaChecklistTransfer.js          # TPX1 compression, SHA-256 verification & transfer
├── qaChecklistTransferUI.js        # Transfer modal and import/export UI controller
├── qaParser.js                     # Plain-text & Markdown QA plan structural parser
├── qaRunnerUI.js                   # Interactive manual QA test runner and cards UI
├── script.js                       # Main application workspace controller
├── style.css                       # Complete CSS design system and media queries
├── test-issue-010.js               # Modal interactions and project deletion test suite
├── test-issue-011.js               # Storage quota error, rollback & migration test suite
├── test-issue-delete-checklist.js  # Checklist deletion and modal lifecycle test suite
├── test-issue-transfer-import.js   # TPX1 transfer format and file import test suite
├── tsconfig.json                   # TypeScript compiler configuration (type checking)
└── vite.config.ts                  # Vite development and production build configuration
```

---

## Technology Stack

| Layer | Technology | Purpose in Qavora |
|---|---|---|
| **Structure** | HTML5 | Application shell, accessible modals, responsive views |
| **Styling** | CSS3 & Custom Properties | Theming, CSS Grid/Flexbox layouts, responsive design system |
| **Logic** | Vanilla JavaScript (ES6+ Modules) | Modular client-side application logic and state controllers |
| **Tooling & Bundling** | Vite 8 | Fast local development server and optimized production packaging |
| **Static Typing Check** | TypeScript | Type validation across JavaScript and configuration files |
| **Persistence** | Browser localStorage | Offline-first, browser-local client-side persistence |
| **Compression** | `CompressionStream` API | Raw deflate compression for compact transfer strings |
| **Integrity** | Web Crypto API (`crypto.subtle`) | Cryptographic SHA-256 checksums for imported transfer files |
| **Deployment** | GitHub Pages & GitHub Actions | Automated static hosting from the repository's `main` branch |

---

## UI & Responsive Design System

Qavora features a modern SaaS design system inspired by tools like Linear and Notion, using a slate color palette, clean typography, and subtle border delineations.

### Supported & Verified Resolutions

#### Laptop & Desktop Viewports
- **1280 × 720** (Standard 720p Laptop)
- **1366 × 768** (Common WXGA Laptop)
- **1440 × 900** (MacBook Display)
- **1600 × 900** (HD+ Desktop Display)
- **1920 × 1080** (Full HD Desktop)
- **2560 × 1440** (QHD / 2K Ultra-Wide, centered max-width 1640px)

#### Tablet & Small-Screen Viewports
- **Portrait Tablets**: 600 × 960, 768 × 1024 (iPad), 820 × 1180 (iPad Air), 834 × 1194 (iPad Pro 11"), 900 × 1200, 1024 × 1366 (iPad Pro 12.9")
- **Landscape Tablets & Mobiles**: 640 × 360, 667 × 375, 740 × 360, 800 × 600, 1024 × 768, 1180 × 820, 1194 × 834
- **Mobile Phones**: 320 × 568 (Compact), 360 × 640, 360 × 780, 375 × 812 (iPhone X/12 Mini), 390 × 844 (iPhone 14/15), 393 × 873, 412 × 915, 414 × 896, 430 × 932 (iPhone Pro Max)

### Touchscreen & Mobile Ergonomics
- **Touch Targets**: All primary interactive elements (buttons, inputs, toggles, selectors) meet or exceed 40–48px interactive heights on screens under 1024px.
- **Drawer Navigation**: The sidebar converts to an off-canvas slide-out drawer on viewports under 1024px, toggled via a hamburger button and closed by tapping the backdrop or any navigation link.
- **Scroll Lock**: Opening modals or the mobile drawer locks background page scrolling (`overflow: hidden`) to prevent scroll drift.
- **iOS Zoom Prevention**: Form controls enforce `font-size: 16px !important` on mobile viewports to avoid automatic iOS Safari zoom-in on input focus.
- **Short Landscape Optimization**: Compacts headers and uses 4-column horizontal metrics on short landscape viewports (`max-height: 500px`).

---

## Themes

- **Dark Theme (Default)**: Deep blue-slate surfaces (`#0b0f19`, `#131b2e`), indigo accents (`#6366f1`), and high-contrast typography (`#f8fafc`).
- **Light Theme**: Clean slate-white surfaces (`#f8fafc`, `#ffffff`) with deep slate typography (`#0f172a`).
- **Persistence**: Theme selection is toggled via the sun/moon button in the top navigation header and persisted across browser sessions in `qavora_theme_preference`.

---

## Accessibility Patterns

- **Semantic HTML**: Proper button, input, label, section, article, and aside tags.
- **ARIA Labeling**: Appropriate `aria-label`, `aria-hidden`, `aria-modal`, `aria-labelledby`, and `role="dialog"` attributes on modals and icon buttons.
- **Modal Focus Management**: Focus traps, initial autofocus on primary form fields, and return of focus on dialog dismissal.
- **Keyboard Navigation**: Full support for `Escape` key dialog closing, `Tab` focus ordering, and `Enter` form submissions.
- **Reduced Motion**: Respects `prefers-reduced-motion: reduce`, dropping animation durations to near-zero for users with motion sensitivity.

---

## Installation & Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (version 20 or higher recommended)
- `npm` (bundled with Node.js)

### Clone the Repository
```bash
git clone https://github.com/Hannankhan203/Test-Pilot.git
cd Test-Pilot
```

### Install Dependencies
```bash
npm install
```

---

## Development

To launch the local Vite development server:
```bash
npm run dev
```

The application will be served at `http://localhost:3000` with host binding on `0.0.0.0:3000`.

---

## Linting & Type Checking

To validate syntax, type definitions, and codebase integrity:
```bash
npm run lint
```
*Note: This command runs `tsc --noEmit`, performing comprehensive static type checking without generating output files.*

---

## Production Build

To build the static distribution bundle:
```bash
npm run build
```

This compiles the application assets into the `./dist` directory:
- `dist/index.html` — Minified HTML document
- `dist/assets/*.css` — Optimized, minified stylesheet bundle
- `dist/assets/*.js` — Bundled, minified JavaScript modules
- `dist/site.webmanifest` & icons — Copied static public assets

---

## Deployment Configuration

Qavora is hosted as a static web application on GitHub Pages.

- **Base Path**: The production build uses `/Qavora/` as the base asset URL when deployed via GitHub Actions, configured in `vite.config.ts`:
  ```typescript
  base: process.env.VITE_BASE_PATH || (process.env.GITHUB_ACTIONS === 'true' ? '/Qavora/' : '/')
  ```
- **Automated Workflow**: `.github/workflows/deploy.yml` triggers on pushes to `main` or `master`, building the project via Node.js 20 and publishing the `./dist` directory using GitHub Actions Pages deployment (`actions/deploy-pages@v4`).
- **Jekyll Bypass**: The `public/.nojekyll` file ensures GitHub Pages serves files with underscores or modern asset directories without Jekyll interference.

---

## Testing & Verification Suites

The repository contains four standalone regression test suites executed via Node.js:

```bash
node test-issue-010.js
node test-issue-011.js
node test-issue-delete-checklist.js
node test-issue-transfer-import.js
```

### Test Suite Coverage
1. **`test-issue-010.js`**: Universal confirmation modal DOM structures, modal focus trapping, double-click protection, and phase/test deletion cascades.
2. **`test-issue-011.js`** (17 tests): Comprehensive storage resilience testing:
   - `QuotaExceededError` and Firefox `NS_ERROR_DOM_QUOTA_REACHED` handling.
   - `SecurityError` handling and graceful degradation.
   - Corrupt JSON isolation without destructive auto-deletion.
   - Multi-operation rollback snapshots.
   - Legacy key migration (`testpilot_*` → `qavora_*`).
   - Clean initial boot on uninitialized storage.
3. **`test-issue-delete-checklist.js`** (5 tests): Checklist deletion modal lifecycle, backdrop independence, scrollbar lock/unlock events, and active runner synchronization.
4. **`test-issue-transfer-import.js`** (14 tests): TPX1 code generation, format validation, file picker `.txt` and `.json` imports, merge mode ID collision avoidance, replace mode, corrupt/tampered payload rejection, and legacy transfer compatibility.

### Verification Status
- **Type Checking (`npm run lint`)**: Passed (0 errors).
- **Production Build (`npm run build`)**: Passed (clean build in `./dist`).
- **Regression Suites (`node test-*.js`)**: 100% passing across all 4 suites (36+ automated checks).

---

## Data Privacy & Architecture

- **No Remote Database**: Qavora transmits zero test plans, checklist records, defect descriptions, or activity logs to any remote server.
- **Client-Side Execution**: All structural text parsing, compression, and cryptographic validation occur exclusively inside the client's browser engine.
- **User-Controlled Data**: Backups and data transfers occur solely when explicitly initiated by the user.

---

## Known Limitations

- **Manual QA Tool**: Qavora is designed specifically for organizing and tracking manual testing; it does not execute automated browser tests (e.g., Selenium, Playwright, Cypress).
- **Browser-Local Storage**: Data persistence depends on the browser's localStorage. Clearing browser website data will remove local records unless exported via JSON backup or TPX1 transfer code.
- **No Real-Time Cloud Sync**: Checklists do not automatically synchronize in real time across devices; moving data between machines requires the user to generate and import a portable transfer code or backup file.
- **No External Issue Tracker Sync**: Defect logging is maintained locally within the Qavora workspace and does not automatically synchronize with Jira, GitHub Issues, or Linear.

---

## Intended Use Cases

- **Manual Web & Mobile QA**: Organizing smoke, sanity, and regression testing suites for software releases.
- **Product Managers & QA Leads**: Structuring release readiness checklists and reviewing test completion metrics.
- **Independent Developers**: Tracking test coverage and logging bug verifications without setting up complex testing infrastructure.
- **Student & Academic Projects**: Demonstrating structured software quality assurance, verification methodologies, and test management.

---

## Application Screens & Views

1. **Create QA Checklist**: Textarea editor and syntax guidance to paste testing specifications and parse them into structured phases.
2. **Edit & Review**: Interactive review workspace to edit phases, categories, tests, and priorities before saving.
3. **Clean Preview**: Formatted typographic preview of the parsed plan.
4. **My QA Checklists**: Library of saved checklists with completion rates, status badges, rename, delete, and device transfer access.
5. **QA Test Runner**: Full-screen manual test runner with completion checkboxes, progress bar, and accordion phase sections.
6. **Dashboard**: High-level overview displaying registered projects, total test cases, pass/fail counts, and recent activity logs.
7. **My Projects**: Multi-project management workspace with status and application type filters.
8. **Project Details**: Deep-dive project view containing related test plans, suites, test cases, and execution history.
9. **Test Plans**: Authoring environment for structured test plans, phases, test suites, and individual test cases.
10. **Test Execution**: Execution workspace for running formal project test cases, tracking step verification, and logging outcomes.
11. **Defects**: Defect tracking table with status, severity, and project filters.
12. **Reports & Analytics**: Visual quality insights, status distribution donut chart, velocity trend lines, and printable executive reports.
13. **Data Management**: JSON backup creation, restore/merge controls, rollback recovery, and TPX1 device transfer panel.
14. **Settings**: Workspace configuration, category presets, and quick navigation to data management.

---

## Browser Compatibility

Qavora is engineered for modern desktop and mobile browsers supporting standard web APIs:
- `localStorage` Web Storage API
- `CompressionStream` & `DecompressionStream` APIs (with uncompressed JSON fallback)
- Web Crypto API (`crypto.subtle.digest`)
- ES6 JavaScript Modules (`import` / `export`)
- Modern CSS Flexbox & CSS Grid

Recommended browsers:
- Google Chrome / Chromium (version 80+)
- Mozilla Firefox (version 75+)
- Apple Safari (version 14+)
- Microsoft Edge (version 80+)

---

## Contributing

1. Fork the repository on GitHub.
2. Create a feature branch:
   ```bash
   git checkout -b feature/my-feature
   ```
3. Implement your changes adhering to the existing vanilla JavaScript and CSS architectural guidelines.
4. Run static type checking and regression test suites:
   ```bash
   npm run lint
   node test-issue-010.js
   node test-issue-011.js
   node test-issue-delete-checklist.js
   node test-issue-transfer-import.js
   ```
5. Build the production distribution:
   ```bash
   npm run build
   ```
6. Commit your changes and open a Pull Request.

---

## License

Source code files in this repository include the **Apache-2.0** SPDX license header. Note that no separate standalone `LICENSE` text file is currently included in the root repository.

---

## Repository & Links

- **GitHub Repository**: [https://github.com/Hannankhan203/Qavora](https://github.com/Hannankhan203/Qavora)
- **Live Demo Application**: [https://hannankhan203.github.io/Qavora/](https://hannankhan203.github.io/Qavora/)
