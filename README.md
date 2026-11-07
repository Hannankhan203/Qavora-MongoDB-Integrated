# Qavora — Manual QA Testing Manager

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![Vite](https://img.shields.io/badge/bundler-Vite_6.2-646CFF.svg?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Express](https://img.shields.io/badge/backend-Express_+_TypeScript-000000.svg?logo=express&logoColor=white)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/database-MongoDB_Atlas-47A248.svg?logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**Qavora** is a full-stack, multi-tenant manual software Quality Assurance (QA) management platform with durable **MongoDB Atlas** cloud persistence and an **offline-first IndexedDB synchronization engine**. It provides engineering teams, QA leads, and software testers with an integrated workspace to parse raw markdown test checklists, promote checklists into formal multi-phase QA projects, execute manual test suites, track defects, generate interactive analytics reports, and seamlessly continue working through network interruptions.

---

## 📋 Table of Contents

- [Project Overview](#-project-overview)
- [System Architecture](#-system-architecture)
  - [Express + TypeScript Backend](#1-express--typescript-backend-serverts--apiindexts)
  - [MongoDB Persistence & 11-Collection Data Architecture](#2-mongodb-persistence--11-collection-data-architecture)
  - [Authentication, Authorization, CSRF, CSP & Security Safeguards](#3-authentication-authorization-csrf-csp--security-safeguards)
  - [Frontend Workspace Modules & QA Checklist System](#4-frontend-workspace-modules--qa-checklist-system)
  - [Formal Project & Checklist Offline Synchronization (`QAV-OFFLINE-001`)](#5-formal-project--checklist-offline-synchronization-qav-offline-001)
- [End-to-End Workflow](#-end-to-end-workflow)
- [Directory Structure](#-directory-structure)
- [Getting Started & Installation](#-getting-started--installation)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Running the Application](#running-the-application)
- [QA Parser Input Format Reference](#-qa-parser-input-format-reference)
- [Testing & Verification](#-testing--verification)
- [Deployment](#-deployment)
  - [Render Web Service (`render.yaml`)](#1-render-web-service-renderyaml)
  - [Vercel Serverless + Static CDN (`vercel.json`)](#2-vercel-serverless--static-cdn-verceljson)
  - [CI/CD Pipeline (`.github/workflows/deploy.yml`)](#3-cicd-pipeline-githubworkflowsdeployyml)
- [License](#-license)
- [Author & Repository](#-author--repository)

---

## 🎯 Project Overview

Software testing frequently begins in ad-hoc text documents, spreadsheets, or markdown notes that are difficult to track across releases, lack multi-user tenant isolation, and provide no structured metrics. Conversely, heavyweight enterprise ALM tools introduce high configuration overhead for fast-moving manual QA teams.

**Qavora** bridges this gap with a dual-mode, cloud-persisted architecture:

1. **QA Checklist System (Rapid Ingestion & Execution)**: Paste or upload raw Markdown/plain-text test plans, parse them into structured **Phases → Sections → Test Items**, execute checks with instant pass/fail/blocked/skipped status toggles, generate standalone QA reports, and promote any checklist into a formal QA project with one click.
2. **Formal QA Workspace (8 Integrated Modules)**: Manage full-lifecycle software testing across **Dashboard**, **Projects**, **Test Plans & Suites**, **Test Execution Center**, **Defects / Bug Tracker**, **Reports & Analytics**, **Data Management (Export, Merge/Replace Import & Snapshot Rollback)**, and **Settings**.
3. **Offline-First Durability (`QAV-OFFLINE-001`)**: Both QA Checklists and Formal Projects (including Test Suites, Test Cases, Test Executions, and Defects) support durable IndexedDB queuing, multi-tab lock coordination, automatic background synchronization upon reconnection, and optimistic concurrency conflict resolution.

---

## 🏗️ System Architecture

### 1. Express + TypeScript Backend (`server.ts` & `api/index.ts`)

Qavora runs on a unified **Node.js + Express 4 + TypeScript** backend (`server.ts`) that supports both standalone container/VM execution (such as Render or Docker) and serverless function execution on Vercel (`api/index.ts`):

- **Development Mode**: Integrates Vite (`createViteServer` in middleware mode) directly into the Express server on port `3000` for unified API and frontend serving.
- **Production Mode**: Serves compiled static assets from `dist/` with dynamic per-response Content Security Policy (CSP) nonce injection into `index.html` for all SPA routes (`serveSpaHtmlWithNonce`), while strictly isolating `/api/*` routes so unknown API endpoints always return JSON `404` responses.
- **Database Lifecycle & Resilience**: Uses the official `mongodb` v7 `MongoClient` with connection pooling (`maxPoolSize: 20`, `serverSelectionTimeoutMS: 10000`), pre-connection DNS/TCP network diagnostics (`runMongoNetworkDiagnostics`), warm serverless connection reuse, and graceful `SIGTERM`/`SIGINT` shutdown handlers. When the database is unreachable, API routes fail closed with HTTP `503 Service Unavailable`.

---

### 2. MongoDB Persistence & 11-Collection Data Architecture

Qavora persists all user and workspace state in **MongoDB Atlas** (default database: `qavora`), enforcing strict per-user tenant isolation (`userId`) across all queries, updates, imports, and deletions.

#### The 11 MongoDB Collections & Domain Entities

| # | Collection / Entity | Storage Scope | Indexes & Purpose |
| :--- | :--- | :--- | :--- |
| **1** | `users` | Physical Collection | Stores user accounts, `bcrypt` (10-round) password hashes, roles, preferences, and `tokenVersion` counters. Indexed uniquely on `{ email: 1 }` and `{ userId: 1 }`. |
| **2** | `projects` | Physical Collection | Stores formal project metadata (`id`, `userId`, `name`, `type`, `version`, `status`, `environment`, `baseUrl`, `tags`), master `testPlan`, `phases`, and `activeRun`. Compound unique index on `{ userId: 1, id: 1 }`; auxiliary indexes on `{ userId: 1, status: 1 }` and `{ userId: 1 }`. |
| **3** | `project_artifacts` | Physical Collection | Dedicated split-storage collection for high-volume project arrays (`kind: "testSuites" \| "executions" \| "defects"`). Indexed with compound index `{ projectId: 1, userId: 1 }`. |
| **4** | `checklists` | Physical Collection | Stores parsed QA checklists (`id`, `userId`, `title`, `documentNotes`, `phases`, `promotedProjectId`, `promotedAt`). Compound unique index on `{ userId: 1, id: 1 }`; auxiliary index on `{ userId: 1 }`. |
| **5** | `recovery_snapshots` | Physical Collection | Stores pre-replacement workspace snapshots (`snapshotId`, `userId`, `createdAt`, hydrated `projects`, `checklists`, `metadata`) created prior to `replace` imports for one-click rollback. Indexed on `{ userId: 1, createdAt: -1 }` and `{ userId: 1, snapshotId: 1 }`. |
| **6** | `rate_limits` | Physical Collection | Stores distributed IP rate-limiting state (`_id`, `totalHits`, `expiresAt`) for login and registration endpoints. Configured with an automatic MongoDB TTL index on `{ expiresAt: 1 }` (`expireAfterSeconds: 0`). |
| **7** | `tests` | Physical Collection | Stores standalone user-owned test documents (`GET /api/tests`, `POST /api/tests`). Indexed on `{ userId: 1 }`. |
| **8** | `testPlans` | Project Domain Entity | Master test plan configurations (`id`, `name`, `objective`, `scope`, `phases`) persisted on each project document and normalized during workspace imports. |
| **9** | `testSuites` | Artifact Collection (`kind: "testSuites"`) | Functional test suite groupings (`id`, `phaseId`, `title`, `description`, `cases`, `tags`) extracted into `project_artifacts` and hydrated into project responses. |
| **10** | `testCases` | Suite Domain Entity | Individual manual test case definitions (`id`, `title`, `preconditions`, `steps`, `expectedResult`, `priority`, `severity`, `status`) stored within `testSuites` artifacts. |
| **11** | `executions` & `defects` | Artifact Collections (`kind: "executions"`, `kind: "defects"`) | Test execution history logs (`id`, `caseId`, `suiteId`, `status`, `actualResult`, `executedBy`, `timestamp`) and defect reports (`id`, `title`, `severity`, `priority`, `status`, ` linkedExecutionId`) persisted in `project_artifacts`. |

#### `project_artifacts` Split-Storage & Hydration Architecture

To prevent large QA projects with thousands of test cases, execution logs, and defect attachments from exceeding MongoDB's 16 MB BSON document limit (enforced at a safe 14 MB server threshold `MAX_BSON_DOC_BYTES`), Qavora implements a split-storage pattern:

- **Write Path (`PATCH /api/projects/:id/data` & `POST /api/data/import`)**: Large array fields (`testSuites`, `executions`, `defects`) are synchronized into dedicated documents in `project_artifacts` keyed by `{ projectId, userId, kind }`, while updating the parent project's `updatedAt` timestamp atomically.
- **Read & Mutation Hydration (`hydrateProjectWithArtifacts`)**: All project endpoints (`GET /api/projects`, `GET /api/projects/:id`, `PUT /api/projects/:id`, `PATCH /api/projects/:id`, `PATCH /api/projects/:id/status`, `PATCH /api/projects/:id/data`) automatically query `project_artifacts` using the `{ projectId: 1, userId: 1 }` compound index and return a fully hydrated project JSON payload to the client.
- **Transactional Import, Reset & Rollback**: `POST /api/data/import`, `POST /api/data/rollback`, and `POST /api/data/reset` synchronize `projects`, `project_artifacts`, and `checklists` within MongoDB multi-document transactions when supported by the topology, with an automatic snapshot-backed rescue fallback for standalone instances. Deleting a project by either business `id` or MongoDB `_id` cleans up all associated `project_artifacts` records.

---

### 3. Authentication, Authorization, CSRF, CSP & Security Safeguards

- **JWT Session Authentication & Exact `tokenVersion` Matching**:
  - User sessions are issued as signed JWTs stored in an `HttpOnly`, `SameSite=Lax` cookie (`qavora_auth_token`, plus `Secure` in production).
  - Every authenticated request (`requireAuth`) verifies the JWT signature, confirms the user exists in MongoDB, rejects conflicting `Cookie` vs `Authorization: Bearer` tokens, and enforces **exact integer `tokenVersion` matching** against the user's MongoDB record.
  - Logging out (`POST /api/auth/logout`) or changing a password (`POST /api/auth/change-password`) atomically increments `tokenVersion` in MongoDB via an aggregation update pipeline (`buildTokenVersionIncrementPipeline`), immediately invalidating all previously issued tokens across concurrent requests.
- **Session-Bound HMAC-SHA256 CSRF Protection**:
  - Implements Double-Submit Cookie CSRF protection cryptographically bound to the active JWT session (`HMAC-SHA256(jwtSecret, sha256(authToken) + "." + nonce)`).
  - Uses `__Host-qavora_csrf_token` in production HTTPS environments and `qavora_csrf_token` in development, paired with the `X-CSRF-Token` request header.
  - `GET /api/auth/csrf` requires an authenticated session (`requireAuth`) and never issues CSRF cookies to anonymous callers.
  - Rejects duplicate auth or CSRF cookies to prevent sibling-subdomain cookie-tossing attacks, and enforces strict `Origin` header validation on state-changing requests.
- **Content Security Policy (CSP) & HTTP Hardening**:
  - Generates a fresh 128-bit cryptographic nonce (`crypto.randomBytes(16).toString('base64')`) per HTTP response.
  - Enforces `script-src 'self' 'nonce-<random>'` with **zero `'unsafe-inline'`** in production, alongside `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
  - Dynamically injects the response nonce into `<script>` tags in `index.html` on both standalone Express and Vercel serverless SPA rewrites (`vercel.json` routes non-asset paths through `/api/index.ts`).
- **NoSQL Injection & Prototype Pollution Defense**:
  - Recursively inspects incoming JSON payloads (`findProhibitedPayloadKey`) to reject keys starting with `$`, keys containing `.`, prototype pollution vectors (`__proto__`, `constructor`, `prototype`), and unauthorized or immutable server fields (`_id`, `userId`, `createdAt`) with HTTP `400 Bad Request`.
- **Optimistic Concurrency Control (OCC)**:
  - `PATCH /api/checklists/:id`, `PATCH /api/projects/:id`, and `PATCH /api/projects/:id/data` accept `expectedUpdatedAt` and perform atomic conditional updates in MongoDB, returning `HTTP 409 Conflict` with `{ currentUpdatedAt, expectedUpdatedAt }` when a stale client attempts to overwrite newer server state.
- **Distributed Authentication Rate Limiting**:
  - Backed by the `rate_limits` MongoDB collection: enforces **3 registrations per hour per IP** (`POST /api/auth/register`) and **5 login attempts per 15 minutes per IP** (`POST /api/auth/login`).

---

### 4. Frontend Workspace Modules & QA Checklist System

#### Eight Formal Workspace Modules (`src/modules/`)

1. **`dashboardManager.js` (Dashboard)**: Aggregates cross-project KPIs, execution pass rates, defect severity distributions, recent activity feeds, and quick-action shortcuts.
2. **`projectManager.js` (Projects)**: Handles creation, editing, archiving, filtering, and deletion of formal QA projects with optimistic concurrency control and offline mutation queuing.
3. **`testPlanManager.js` (Test Plans & Suites)**: Manages project testing phases, test suites, and individual test cases (with dynamic step builders, preconditions, expected results, priority, and severity).
4. **`executionManager.js` (Test Execution Center)**: Provides interactive test run execution, status recording (`Passed`, `Failed`, `Blocked`, `Skipped`, `Not Run`), actual result notes, and one-click defect logging from failed test runs.
5. **`defectManager.js` (Defects / Bug Tracker)**: Tracks software defects with severity/priority badges, reproduction steps, environment metadata, lifecycle status transitions (`Open`, `In Progress`, `Resolved`, `Closed`), and linked execution traces.
6. **`reportsManager.js` (Reports & Analytics)**: Renders Chart.js visual analytics, phase-by-phase execution breakdowns, defect density metrics, and printable/exportable HTML and JSON quality reports.
7. **`dataManager.js` (Data Management)**: Provides full workspace JSON backup export, `merge` and `replace` workspace imports, pre-replacement recovery snapshot inspection, one-click workspace rollback, and real-time MongoDB Atlas storage footprint telemetry (`GET /api/data/storage-usage`).
8. **`settingsManager.js` (Settings & Account)**: Manages user profile details, QA role selection, password changes, UI theme/density preferences, and Danger Zone workspace reset.

#### Supporting Core Modules (`src/modules/`)
- **`apiClient.js`**: Unified HTTP client with automatic CSRF header injection, credentials handling, structured error normalization (`status`, `code`, `details`), and offline detection.
- **`authSession.js` & `authController.js`**: Client-side session state management, authentication modal workflows, and automatic CSRF token refresh.
- **`state.js`**: Reactive in-memory state container for active workspace projects, selections, and filters.
- **`uiRenderer.js` & `utils.js`**: Shared DOM rendering helpers, toast notifications, modal dialogs, offline sync status indicator bar, and HTML escaping utilities.

#### QA Checklist System (Root Modules)
- **`qaParser.js`**: Deterministic state-machine parser that converts raw Markdown or plain-text test lists into hierarchical `Phases → Sections → Tests`.
- **`checklistGeneratorUI.js`**: Interactive UI for pasting/uploading test plans, previewing parsed hierarchies, and saving checklists.
- **`qaChecklistStore.js`**: Persistence store coordinating MongoDB `/api/checklists` REST operations, IndexedDB caching, and promotion of checklists into formal projects (`promoteChecklistToProject`).
- **`qaRunnerUI.js`**: Interactive checklist execution runner with search, phase/status filtering, progress bars, and inline note editing.
- **`qaReportGenerator.js`**: Standalone QA checklist report generator with executive summaries and export capabilities.

---

### 5. Formal Project & Checklist Offline Synchronization (`QAV-OFFLINE-001`)

Implemented in `qaChecklistSyncQueue.js`, Qavora provides a unified, durable offline synchronization engine for both **QA Checklists** and **Formal Workspace Projects** (Projects, Test Suites, Test Cases, Test Executions, and Defects):

- **IndexedDB Persistence (`qavora_offline_db`, Version `2`)**:
  - `pending_checklist_operations`: Queued `CREATE`, `UPDATE`, and `DELETE` operations for QA checklists.
  - `offline_checklists_cache`: Durable client-side cache of checklists per user.
  - `pending_project_operations`: Queued formal project mutations (`CREATE_PROJECT`, `UPDATE_PROJECT`, `UPDATE_PROJECT_STATUS`, `UPDATE_PROJECT_DATA`, `DELETE_PROJECT`) covering projects, suites, cases, executions, and defects.
  - `offline_projects_cache`: Durable client-side cache of hydrated formal projects per user.
  - `sync_locks`: Cross-tab synchronization lease store with monotonic generation counters and TTL expiration.
- **Offline Mutation Coalescing & Dependent Entity Mapping**:
  - Offline creations assign a deterministic client ID (`offline_proj_<timestamp>_<rand>`) and allow immediate offline creation of child test suites, test cases, executions, and defects against that project.
  - Multiple offline updates to the same project coalesce safely in the queue while preserving baseline `expectedUpdatedAt` concurrency timestamps; queuing a delete for an unsynced offline-created project removes the pending creation without unnecessary server calls.
  - When a queued `CREATE_PROJECT` operation syncs and receives a canonical server ID, `remapDependentProjectOperations` automatically updates all dependent queued operations and local state references.
- **Automatic Synchronization & Multi-Tab Coordination**:
  - Automatically flushes both checklist and project queues when connectivity returns (`window` `online` event) or when the user clicks **Sync Now** in the offline status banner.
  - Coordinates across browser tabs using `BroadcastChannel` (`qavora_offline_sync_channel`), the Web Locks API (`navigator.locks`), and atomic IndexedDB lease locks (`acquireIndexedDbSyncLock` / `renewIndexedDbSyncLock` / `dequeueProjectOperationIfLockValid`) so two tabs never process the same operation concurrently.
- **Conflict Resolution (`HTTP 409`)**:
  - When the server returns `HTTP 409 Conflict` due to a stale `expectedUpdatedAt` timestamp, the sync engine fetches the latest server document and attempts an automatic structural merge (`mergeProjectDataForConflict`) across non-overlapping test suites, cases, executions, and defects.
  - If a direct field-level conflict requires user intervention, the operation is marked `status: 'conflict'` and surfaces **Merge Changes** (`merge`) and **Keep Server Version** (`keep_server`) actions in the UI banner.
- **Retry Backoff & Dead-Letter Recovery**:
  - Transient network errors and `5xx`/`503` responses increment `retryCount` with exponential backoff (`BASE_RETRY_DELAY_MS = 1000`, `MAX_RETRY_DELAY_MS = 30000`) and never discard user data.
  - Operations exceeding `DEFAULT_MAX_RETRIES` (5) transition to `status: 'failed'` (dead-letter state) so subsequent healthy operations continue syncing, with **Retry Failed** and **Discard Failed** controls available in the UI.

---

## 🔄 End-to-End Workflow

```text
  [ Raw Markdown / Text Input ]             [ Formal Project Creation ]
                │                                        │
                ▼                                        ▼
  ┌───────────────────────────┐            ┌───────────────────────────┐
  │       qaParser.js         │            │    projectManager.js      │
  │ (Phases → Sections → TCs) │            │  testPlan / execution /   │
  └─────────────┬─────────────┘            │      defectManager.js     │
                │                          └─────────────┬─────────────┘
                ▼                                        │
  ┌───────────────────────────┐    Promote Checklist     │
  │    qaChecklistStore.js    │ ────────────────────────►│
  └─────────────┬─────────────┘                          │
                │                                        │
                └───────────────────┬────────────────────┘
                                    │
                     Online?        ▼        Offline / 503?
                  ┌──────────────────────────────────┐
                  │     apiClient.js / Sync Engine   │
                  └────────┬────────────────┬────────┘
                           │                │
            ┌──────────────┘                └──────────────┐
            ▼ (REST + CSRF + OCC)                          ▼ (Durable Queue)
  ┌───────────────────────────┐              ┌───────────────────────────┐
  │   Express + TypeScript    │              │   IndexedDB Offline DB    │
  │        (server.ts)        │◄─────────────┤ (qaChecklistSyncQueue.js) │
  └─────────────┬─────────────┘  Auto-Sync   └───────────────────────────┘
                │                on Online
                ▼
  ┌───────────────────────────┐
  │       MongoDB Atlas       │
  │ (projects, checklists,    │
  │  project_artifacts, etc.) │
  └───────────────────────────┘
```

---

## 📂 Directory Structure

```text
Qavora-MongoDB-Integrated/
├── api/
│   └── index.ts                   # Vercel serverless function entry point
├── src/
│   └── modules/
│       ├── apiClient.js           # Unified HTTP client (CSRF, credentials, error normalization)
│       ├── authSession.js         # Client-side session & auth state helper
│       ├── dashboardManager.js    # Module 1: Dashboard KPIs & cross-project metrics
│       ├── projectManager.js      # Module 2: Formal Projects CRUD & offline queue integration
│       ├── testPlanManager.js     # Module 3: Test Plans, Phases, Suites & Test Cases
│       ├── executionManager.js    # Module 4: Test Execution Center & run recording
│       ├── defectManager.js       # Module 5: Defects / Bug Tracker lifecycle management
│       ├── reportsManager.js      # Module 6: Analytics charts & exportable project reports
│       ├── dataManager.js         # Module 7: Workspace Export, Import, Rollback & DB Storage stats
│       ├── settingsManager.js     # Module 8: User Profile, Security, Preferences & Reset
│       ├── state.js               # Shared reactive workspace state container
│       ├── uiRenderer.js          # Modals, toasts, navigation & offline sync status banner
│       └── utils.js               # Escaping, formatting & ID generation utilities
├── tests/
│   ├── apiClient.test.js          # Unit tests for unified HTTP client & CSRF headers
│   ├── browserConcurrency.test.js # Playwright Chromium multi-tab IndexedDB & CSP tests
│   ├── checklistStore.test.js     # Unit tests for checklist persistence, OCC & offline queue
│   ├── mongoIntegration.test.js   # Live MongoDB integration & security audit test suite
│   ├── offlineSync.test.js        # Formal project offline mutation & conflict resolution tests
│   ├── reportGenerator.test.js    # Unit tests for QA report generation & XSS sanitization
│   └── serverApi.test.js          # Backend API, CSP nonce, CSRF & offline fail-closed tests
├── .github/
│   └── workflows/
│       └── deploy.yml             # GitHub Actions CI/CD (Docker MongoDB 7, unit/browser tests, Pages)
├── index.html                     # Main SPA entry point & layout shell
├── style.css                      # Custom dark/light theme stylesheet & responsive design system
├── script.js                      # Application bootstrapper & event delegation controller
├── authController.js              # Authentication controller & CSRF cookie parser
├── qaParser.js                    # Markdown/text QA test plan parser
├── qaChecklistStore.js            # QA Checklist state & persistence manager
├── qaChecklistSyncQueue.js        # Unified IndexedDB offline sync queue (Checklists & Projects)
├── checklistGeneratorUI.js        # QA Checklist Generator view controller
├── qaRunnerUI.js                  # Interactive QA Checklist Runner view controller
├── qaReportGenerator.js           # Standalone QA Checklist report generator
├── server.ts                      # Express + TypeScript backend server & MongoDB API routes
├── vite.config.ts                 # Vite bundler configuration
├── tsconfig.json                  # TypeScript configuration
├── render.yaml                    # Render cloud deployment blueprint
├── vercel.json                    # Vercel serverless & static routing configuration
├── .env.example                   # Environment variable template
├── LICENSE                        # MIT License
└── package.json                   # Project dependencies and npm scripts
```

---

## 🚀 Getting Started & Installation

### Prerequisites

- **Node.js**: `v20.x` or higher recommended
- **npm**: `v9.x` or higher
- **MongoDB**: A **MongoDB Atlas** cluster URI or local MongoDB (`v7.0+`) instance

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Hannankhan203/Qavora-MongoDB-Integrated.git
   cd Qavora-MongoDB-Integrated
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   Copy `.env.example` to `.env` and populate your MongoDB connection string and JWT secret:
   ```bash
   cp .env.example .env
   ```

### Environment Variables

| Variable | Required | Default | Description |
| :--- | :---: | :---: | :--- |
| `MONGODB_URI` | **Yes** | — | MongoDB Atlas (`mongodb+srv://...`) or local (`mongodb://...`) connection string. |
| `MONGODB_DB` | No | `qavora` | Target MongoDB database name for application collections. |
| `JWT_SECRET` | **Yes** | — | Secret key (minimum 16 characters, 64-byte hex recommended) used to sign JWTs and session-bound CSRF tokens. |
| `JWT_EXPIRES_IN` | No | `7d` | JWT session token expiration window (e.g. `7d`, `24h`). |
| `CORS_ORIGIN` | **Yes (Prod)** | `http://localhost:3000` | Comma-separated list of allowed origins for CORS and `Origin` header validation. |
| `PORT` | No | `3000` | HTTP port on which the Express server listens. |
| `MONGODB_STORAGE_LIMIT_MB` | No | `512` | Reference storage capacity limit (in MB) used by `GET /api/data/storage-usage`. |
| `MONGODB_TEST_URI` | No (Tests) | — | Dedicated MongoDB URI used exclusively by `tests/mongoIntegration.test.js`. |
| `VITE_BASE_PATH` | No | `/` | Base public path when building frontend assets. |

### Running the Application

1. **Start the full-stack development server (Express + Vite middleware on port 3000)**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

2. **Build and run for production**:
   ```bash
   npm run build
   npm start
   ```

---

## 📝 QA Parser Input Format Reference

The **QA Checklist Generator** (`qaParser.js`) parses plain text or Markdown line-by-line into a 3-tier hierarchy: **Phases → Sections → Tests**.

```markdown
# Qavora Release v2.4 QA Plan
> Environment: Staging | Browser: Chrome 131

## Phase 1: Authentication & Session Security
### Login & CSRF Validation
- [ ] Verify login succeeds with valid credentials and sets HttpOnly session cookie
- [ ] Verify state-changing POST requests without X-CSRF-Token return HTTP 403
- [ ] Verify password change invalidates existing JWT sessions immediately

## Phase 2: Offline Resilience
### Project & Suite Queuing
1. Disconnect network and create a new formal project
2. Add a test suite and test case while offline
3. Reconnect network and verify automatic synchronization to MongoDB
```

---

## 🧪 Testing & Verification

Qavora uses Node.js's built-in test runner (`node:test`) executed via `tsx` alongside Playwright for real Chromium browser verification.

### Test Commands

| Command | Description |
| :--- | :--- |
| `npm run test:unit` | Runs all unit, API, offline sync, and MongoDB integration test suites (`tests/apiClient.test.js`, `tests/checklistStore.test.js`, `tests/reportGenerator.test.js`, `tests/serverApi.test.js`, `tests/offlineSync.test.js`, and `tests/mongoIntegration.test.js`). |
| `npm run test:browser` | Runs the Playwright headless Chromium multi-tab IndexedDB concurrency and CSP enforcement test suite (`tests/browserConcurrency.test.js`). |
| `npm test` | Runs both `npm run test:unit` and `npm run test:browser` sequentially. |
| `npm run build` | Compiles the production Vite frontend bundle into `dist/`. |
| `npm run lint` | Runs `tsc --noEmit` to type-check `server.ts` and TypeScript sources with zero errors. |

### Enabling Live MongoDB Integration Tests (`tests/mongoIntegration.test.js`)

By default, if `MONGODB_TEST_URI` is not set in the environment, `tests/mongoIntegration.test.js` gracefully skips its 13 live database integration tests so unit tests can run in environments without a local MongoDB daemon.

To execute all 13 live MongoDB integration tests locally or in CI:

```bash
# Option A: Using Docker
docker run -d --name qavora-mongo-test -p 27017:27017 mongo:7
export MONGODB_TEST_URI="mongodb://127.0.0.1:27017/qavora_integration_test"
npm run test:unit

# Option B: Using a dedicated MongoDB Atlas test database
export MONGODB_TEST_URI="mongodb+srv://<user>:<password>@<cluster>.mongodb.net/qavora_integration_test"
npm run test:unit
```

### Enabling Playwright Browser Concurrency Tests (`tests/browserConcurrency.test.js`)

Before running `npm run test:browser` for the first time in a fresh environment, install the Playwright Chromium headless browser binary:

```bash
npx playwright install chromium
npm run test:browser
```

---

## 🌐 Deployment

### 1. Render Web Service (`render.yaml`)

The repository includes a declarative `render.yaml` Blueprint for deploying Qavora as a unified Node.js web service:
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start` (`NODE_ENV=production tsx server.ts`)
- **Required Environment Variables on Render**: `MONGODB_URI`, `MONGODB_DB`, `JWT_SECRET`, `CORS_ORIGIN`.

### 2. Vercel Serverless + Static CDN (`vercel.json`)

The repository includes `vercel.json` and `api/index.ts` for deployment on Vercel:
- API requests (`/api/*`) and SPA HTML navigation requests are routed to `/api/index.ts` so every HTML page response receives a dynamically generated per-response CSP nonce matching its `Content-Security-Policy` header.
- Static build artifacts (`/assets/*`, `.css`, `.js`, icons, sourcemaps) are served directly from `dist/` with `X-Content-Type-Options: nosniff`.

### 3. CI/CD Pipeline (`.github/workflows/deploy.yml`)

The GitHub Actions workflow provisions a `mongo:7` service container, installs dependencies and Playwright Chromium, runs `npm test` with `MONGODB_TEST_URI` configured against the live `mongo:7` container, builds production assets (`npm run build`), and verifies that `dist/index.html` and hashed bundles are generated cleanly.

---

## 📄 License

This project is open-source and distributed under the **MIT License**. See the [LICENSE](./LICENSE) file in the repository root for full license text and terms.

---

## 👤 Author & Repository

- **GitHub Repository**: [https://github.com/Hannankhan203/Qavora-MongoDB-Integrated](https://github.com/Hannankhan203/Qavora-MongoDB-Integrated)
- **Author**: [@Hannankhan203](https://github.com/Hannankhan203)
