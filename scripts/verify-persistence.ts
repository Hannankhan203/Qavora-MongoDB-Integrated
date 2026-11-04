/**
 * QAVORA-PERSISTENCE-001 — Automated Verification Suite
 *
 * Verifies MongoDB project persistence, state reference isolation, nested mutations,
 * hydration normalization, cache-busting, multi-tenant isolation, and API failure rollback
 * using the real Express backend (server.ts), real MongoDB (MongoMemoryServer), and real
 * frontend controller modules (script.js, authController.js, qaChecklistStore.js).
 *
 * Scenarios covered:
 *  1. Creating a project sends POST /api/projects & Storage.getProjects() isolates references.
 *  2. Backend stores the project in MongoDB with authenticated user ownership.
 *  3. Editing a project sends PATCH /api/projects/:id/data and updates MongoDB.
 *  4. All nested project mutations (test plans, phases, phase movement, suites, cases,
 *     case duplication, executions, defects, quick status, cross-project defect move,
 *     checklist promotion, and deletions) synchronize to MongoDB.
 *  5. Unchanged projects are not unnecessarily updated (0 redundant API calls on clone/other-project edit).
 *  6. Browser refresh restores projects from MongoDB (no stale 304 cache, cache: 'no-store').
 *  7. Project data is cleared on logout and restored from MongoDB on re-login.
 *  8. Derived KPI metrics are accurately recomputed during hydration and save.
 *  9. Authentication and tenant isolation remain intact across accounts and unauthenticated calls.
 * 10. API failures roll back optimistic state and report errors without false success toasts.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passedCount++;
    console.log(`  ✓ [PASS] #${passedCount}: ${message}`);
  } else {
    failedCount++;
    console.error(`  ✗ [FAIL] ${message}`);
  }
}

// ============================================================================
// Lightweight Browser & DOM Harness for Real Frontend Module Execution
// ============================================================================

class MockLocalStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  get length(): number {
    return this.store.size;
  }
}

interface ToastEntry {
  type: string;
  message: string;
}

const toastLog: ToastEntry[] = [];

class MockClassList {
  private tokens = new Set<string>();
  private owner: MockElement;

  constructor(owner: MockElement) {
    this.owner = owner;
  }

  syncFromString(cls: string): void {
    this.tokens.clear();
    String(cls || '')
      .split(/\s+/)
      .filter(Boolean)
      .forEach((t) => this.tokens.add(t));
  }

  private syncToOwner(): void {
    this.owner._rawClassName = Array.from(this.tokens).join(' ');
  }

  add(...items: string[]): void {
    items.forEach((t) => {
      if (t) this.tokens.add(t);
    });
    this.syncToOwner();
  }

  remove(...items: string[]): void {
    items.forEach((t) => this.tokens.delete(t));
    this.syncToOwner();
  }

  toggle(token: string, force?: boolean): boolean {
    if (force !== undefined) {
      if (force) {
        this.tokens.add(token);
        this.syncToOwner();
        return true;
      }
      this.tokens.delete(token);
      this.syncToOwner();
      return false;
    }
    if (this.tokens.has(token)) {
      this.tokens.delete(token);
      this.syncToOwner();
      return false;
    }
    this.tokens.add(token);
    this.syncToOwner();
    return true;
  }

  contains(token: string): boolean {
    return this.tokens.has(token);
  }

  has(token: string): boolean {
    return this.tokens.has(token);
  }
}

class MockElement {
  public tagName: string;
  public id: string = '';
  public _rawClassName: string = '';
  public classList: MockClassList;
  public style: Record<string, any>;
  public attributes = new Map<string, string>();
  public dataset: Record<string, string>;
  public value: string = '';
  public checked: boolean = false;
  public disabled: boolean = false;
  public type: string = 'text';
  public name: string = '';
  public href: string = '';
  public placeholder: string = '';
  public title: string = '';
  public children: MockElement[] = [];
  public parentNode: MockElement | null = null;
  public onclick: ((e?: any) => any) | null = null;
  public onchange: ((e?: any) => any) | null = null;
  private _innerHTML: string = '';
  private _textContent: string = '';
  private listeners = new Map<string, Function[]>();
  private registry: Map<string, MockElement>;

  constructor(tagName: string, registry: Map<string, MockElement>, id: string = '') {
    this.tagName = String(tagName || 'DIV').toUpperCase();
    this.registry = registry;
    this.classList = new MockClassList(this);
    this.style = {
      setProperty: (k: string, v: string) => {
        this.style[k] = v;
      },
      removeProperty: (k: string) => {
        delete this.style[k];
      }
    };
    const self = this;
    this.dataset = new Proxy(
      {},
      {
        get(_target, prop: string) {
          const attr = 'data-' + prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
          return self.attributes.get(attr);
        },
        set(_target, prop: string, val: string) {
          const attr = 'data-' + prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
          self.attributes.set(attr, String(val));
          return true;
        }
      }
    );
    if (id) {
      this.id = id;
      this.attributes.set('id', id);
      this.registry.set(id, this);
    }
  }

  get className(): string {
    return this._rawClassName;
  }

  set className(val: string) {
    this._rawClassName = String(val || '');
    this.classList.syncFromString(this._rawClassName);
  }

  get innerHTML(): string {
    return this._innerHTML;
  }

  set innerHTML(val: string) {
    this._innerHTML = String(val ?? '');
    this.children = [];
    this._textContent = this._innerHTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  get textContent(): string {
    if (this.children.length > 0) {
      return this.children.map((c) => c.textContent).join('');
    }
    return this._textContent;
  }

  set textContent(val: string) {
    this._textContent = String(val ?? '');
    this._innerHTML = this._textContent;
    this.children = [];
  }

  get firstChild(): MockElement | null {
    return this.children[0] ?? null;
  }

  get childNodes(): MockElement[] {
    return this.children;
  }

  get parentElement(): MockElement | null {
    return this.parentNode;
  }

  setAttribute(name: string, val: string): void {
    const str = String(val);
    this.attributes.set(name, str);
    if (name === 'id') {
      this.id = str;
      if (str) this.registry.set(str, this);
    } else if (name === 'class') {
      this.className = str;
    } else if (name === 'type') {
      this.type = str;
    } else if (name === 'href') {
      this.href = str;
    }
  }

  getAttribute(name: string): string | null {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this._rawClassName || null;
    return this.attributes.has(name) ? this.attributes.get(name)! : null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === 'href') this.href = '';
  }

  appendChild(child: MockElement): MockElement {
    if (!child) return child;
    child.parentNode = this;
    this.children.push(child);
    if (child.id) {
      this.registry.set(child.id, child);
    }
    if (this.id === 'toast-container') {
      const cls = child.className || '';
      const typeMatch = cls.match(/toast-(success|error|warning|info)/);
      toastLog.push({
        type: typeMatch ? typeMatch[1] : 'info',
        message: child.textContent.trim()
      });
    }
    return child;
  }

  removeChild(child: MockElement): MockElement {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  insertBefore(newNode: MockElement, refNode: MockElement | null): MockElement {
    newNode.parentNode = this;
    if (!refNode) {
      this.children.push(newNode);
      return newNode;
    }
    const idx = this.children.indexOf(refNode);
    if (idx === -1) {
      this.children.push(newNode);
    } else {
      this.children.splice(idx, 0, newNode);
    }
    return newNode;
  }

  replaceChildren(...nodes: MockElement[]): void {
    this.children = [];
    nodes.forEach((n) => this.appendChild(n));
  }

  remove(): void {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  addEventListener(event: string, fn: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(fn);
  }

  removeEventListener(event: string, fn: Function): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx !== -1) arr.splice(idx, 1);
  }

  dispatchEvent(event: any): boolean {
    const evt = event || { type: '' };
    if (!evt.target) evt.target = this;
    if (!evt.preventDefault) evt.preventDefault = () => {};
    if (!evt.stopPropagation) evt.stopPropagation = () => {};
    const arr = this.listeners.get(evt.type) || [];
    for (const fn of arr) {
      fn(evt);
    }
    return true;
  }

  click(): void {
    if (typeof this.onclick === 'function') {
      this.onclick({ target: this, preventDefault() {}, stopPropagation() {} });
    }
    this.dispatchEvent({ type: 'click', target: this });
  }

  focus(): void {}
  blur(): void {}
  select(): void {}
  scrollIntoView(): void {}

  reset(): void {
    if (this.tagName === 'INPUT' || this.tagName === 'TEXTAREA') {
      this.value = '';
      if (this.type === 'checkbox' || this.type === 'radio') {
        this.checked = false;
      }
    }
    for (const c of this.children) {
      c.reset();
    }
  }

  contains(other: MockElement | null): boolean {
    if (!other) return false;
    if (other === this) return true;
    return this.children.some((c) => c.contains(other));
  }

  closest(selector: string): MockElement | null {
    let cur: MockElement | null = this;
    while (cur) {
      if (matchesSimpleSelector(cur, selector)) return cur;
      cur = cur.parentNode;
    }
    return null;
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const visit = (node: MockElement) => {
      for (const child of node.children) {
        if (matchesSimpleSelector(child, selector)) {
          results.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return results;
  }
}

function matchesSimpleSelector(el: MockElement, selector: string): boolean {
  if (selector.includes(',')) {
    return selector
      .split(',')
      .some((part) => matchesSimpleSelector(el, part.trim()));
  }
  const trimmed = selector.trim().replace(/:not\([^)]*\)/g, '');
  if (!trimmed) return false;
  if (trimmed.includes(' ')) {
    const parts = trimmed.split(/\s+/);
    const last = parts[parts.length - 1];
    if (!matchesSimpleSelector(el, last)) return false;
    let parent = el.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (parent && !matchesSimpleSelector(parent, parts[i])) {
        parent = parent.parentNode;
      }
      if (!parent) return false;
      parent = parent.parentNode;
    }
    return true;
  }
  if (trimmed.startsWith('#')) {
    return el.id === trimmed.slice(1);
  }
  if (trimmed.startsWith('.')) {
    return el.classList.contains(trimmed.slice(1));
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1);
    const eqIdx = inner.indexOf('=');
    if (eqIdx === -1) return el.hasAttribute(inner);
    const attr = inner.slice(0, eqIdx).trim();
    const val = inner.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    return el.getAttribute(attr) === val;
  }
  return el.tagName === trimmed.toUpperCase();
}

function setupBrowserEnvironment(baseUrl: string) {
  const registry = new Map<string, MockElement>();
  const documentElement = new MockElement('html', registry);
  const head = new MockElement('head', registry);
  const body = new MockElement('body', registry);
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  // Parse index.html to register every real element with an id or class
  const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
  const tagRegex = /<([a-zA-Z0-9-]+)([^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(indexHtml)) !== null) {
    const tag = match[1];
    const attrs = match[2] || '';
    const idMatch = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i);
    const classMatch = attrs.match(/\bclass\s*=\s*["']([^"']+)["']/i);
    const typeMatch = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i);
    const valMatch = attrs.match(/\bvalue\s*=\s*["']([^"']+)["']/i);
    const checkedMatch = /\bchecked\b/i.test(attrs);

    if (idMatch || classMatch) {
      const el = new MockElement(tag, registry, idMatch ? idMatch[1] : '');
      if (classMatch) el.className = classMatch[1];
      if (typeMatch) el.type = typeMatch[1];
      if (valMatch) el.value = valMatch[1];
      if (checkedMatch) el.checked = true;
      body.appendChild(el);
    }
  }

  const docListeners = new Map<string, Function[]>();
  const winListeners = new Map<string, Function[]>();
  const mockDocument: any = {
    readyState: 'complete',
    documentElement,
    head,
    body,
    activeElement: body,
    getElementById(id: string) {
      return registry.get(id) ?? null;
    },
    createElement(tag: string) {
      return new MockElement(tag, registry);
    },
    createElementNS(_ns: string, tag: string) {
      return new MockElement(tag, registry);
    },
    createTextNode(text: string) {
      const node = new MockElement('#text', registry);
      node.textContent = text;
      return node;
    },
    querySelector(sel: string) {
      if (sel.startsWith('#') && !sel.includes(' ') && !sel.includes(',')) {
        return registry.get(sel.slice(1)) ?? null;
      }
      return documentElement.querySelector(sel);
    },
    querySelectorAll(sel: string) {
      return documentElement.querySelectorAll(sel);
    },
    contains(_el: any) {
      return true;
    },
    addEventListener(event: string, fn: Function) {
      if (!docListeners.has(event)) docListeners.set(event, []);
      docListeners.get(event)!.push(fn);
    },
    removeEventListener(event: string, fn: Function) {
      const arr = docListeners.get(event);
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i !== -1) arr.splice(i, 1);
    }
  };

  const mockLocalStorage = new MockLocalStorage();
  const mockSessionStorage = new MockLocalStorage();

  (globalThis as any).document = mockDocument;
  (globalThis as any).localStorage = mockLocalStorage;
  (globalThis as any).sessionStorage = mockSessionStorage;
  (globalThis as any).window = globalThis;
  (globalThis as any).addEventListener = (event: string, fn: Function) => {
    if (!winListeners.has(event)) winListeners.set(event, []);
    winListeners.get(event)!.push(fn);
  };
  (globalThis as any).removeEventListener = (event: string, fn: Function) => {
    const arr = winListeners.get(event);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i !== -1) arr.splice(i, 1);
  };
  (globalThis as any).dispatchEvent = (evt: any) => {
    const arr = winListeners.get(evt?.type || '') || [];
    arr.forEach((fn) => fn(evt));
    return true;
  };
  (globalThis as any).location = {
    origin: baseUrl,
    href: `${baseUrl}/`,
    pathname: '/',
    protocol: 'http:',
    host: baseUrl.replace(/^https?:\/\//, '')
  };
  (globalThis as any).matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {}
  });
  (globalThis as any).requestAnimationFrame = (cb: Function) => setTimeout(cb, 0);
  (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
  (globalThis as any).scrollTo = () => {};

  return { mockDocument, mockLocalStorage, registry };
}

interface RecordedRequest {
  method: string;
  path: string;
  cache?: string;
  status: number;
  responseHeaders: Record<string, string>;
  body: any;
}

function makeSubmitEvent() {
  return {
    type: 'submit',
    preventDefault() {},
    stopPropagation() {}
  };
}

// ============================================================================
// Main Verification Suite
// ============================================================================

async function runPersistenceVerification() {
  console.log('========================================================================');
  console.log('QAVORA-PERSISTENCE-001: MONGODB PROJECT PERSISTENCE & ALIASING SUITE');
  console.log('========================================================================\n');

  // 1. Start MongoMemoryServer and real Express backend from server.ts
  const mongod = await MongoMemoryServer.create();
  const mongoUri = mongod.getUri();
  const dbName = 'qavora_persistence_001_test';

  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'production';
  process.env.MONGODB_URI = mongoUri;
  process.env.MONGODB_DB = dbName;
  process.env.JWT_SECRET = 'qavora_persistence_001_jwt_secret_key_secure_987654321';

  const serverModule = await import('../server.ts');
  const expressApp = serverModule.default;

  const httpServer = http.createServer(expressApp);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const port = (httpServer.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const directMongo = new MongoClient(mongoUri);
  await directMongo.connect();
  const db = directMongo.db(dbName);

  // Set up browser globals & fetch interceptor before importing frontend modules
  const { mockLocalStorage } = setupBrowserEnvironment(baseUrl);
  const realFetch = globalThis.fetch;
  const recordedRequests: RecordedRequest[] = [];
  let faultInjectionRule: ((method: string, reqPath: string) => { status: number; body: any } | null) | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const fullUrl = rawUrl.startsWith('/') ? `${baseUrl}${rawUrl}` : rawUrl;
    const parsedUrl = new URL(fullUrl);
    const method = (init?.method || 'GET').toUpperCase();
    const reqPath = parsedUrl.pathname + parsedUrl.search;

    let parsedBody: any = null;
    if (typeof init?.body === 'string' && init.body.length > 0) {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }

    if (faultInjectionRule) {
      const injected = faultInjectionRule(method, parsedUrl.pathname);
      if (injected) {
        recordedRequests.push({
          method,
          path: reqPath,
          cache: init?.cache,
          status: injected.status,
          responseHeaders: { 'content-type': 'application/json' },
          body: parsedBody
        });
        return new Response(JSON.stringify(injected.body), {
          status: injected.status,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    const res = await realFetch(fullUrl, init);
    const headersObj: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headersObj[k.toLowerCase()] = v;
    });

    recordedRequests.push({
      method,
      path: reqPath,
      cache: init?.cache,
      status: res.status,
      responseHeaders: headersObj,
      body: parsedBody
    });

    return res;
  }) as typeof fetch;

  // Import real frontend modules
  const checklistStore = await import('../qaChecklistStore.js');
  await import('../script.js');

  const app = (globalThis as any).__qavoraApp;
  assert(Boolean(app && app.Storage && app.ProjectsAPI && app.ProjectsPersistence), 'Frontend Qavora controller initialized cleanly');

  // Wait briefly for initial unauthenticated authController.init() to settle
  await new Promise((r) => setTimeout(r, 50));

  try {
    // ========================================================================
    // SCENARIO 1 & 2: Project Creation -> POST /api/projects, MongoDB Storage,
    //                 and Shared Reference Aliasing Isolation
    // ========================================================================
    console.log('\n--- Scenario 1 & 2: Project Creation, Reference Isolation & MongoDB Storage ---');

    const regARes = await app.authController.register(
      'Alice QA Lead',
      'alice.persistence@example.com',
      'SecurePass123!'
    );
    assert(regARes.ok === true && Boolean(regARes.user?.userId), 'Registered & authenticated User A');
    const userAId = regARes.user.userId;

    await app.hydrateProjectsFromBackend();
    assert(app.State.projectsHydrated === true, 'Initial hydration succeeded for User A');

    recordedRequests.length = 0;
    toastLog.length = 0;

    // Populate Create Project form inputs exactly as a user does in the modal
    app.openProjectModal(null);
    app.DOM.projectIdInput.value = '';
    app.DOM.projectNameInput.value = 'Qavora Checkout Portal';
    app.DOM.projectTypeInput.value = 'Web Application';
    app.DOM.projectStatusInput.value = 'Active';
    app.DOM.projectVersionInput.value = 'v2.4.0';
    app.DOM.projectDescInput.value = 'End-to-end payment and checkout regression suite';

    await app.handleCreateOrEditProjectSubmit(makeSubmitEvent());

    const createPostReqs = recordedRequests.filter(
      (r) => r.method === 'POST' && r.path === '/api/projects'
    );
    assert(createPostReqs.length === 1, 'Creating a project sends exactly 1 POST /api/projects request');
    assert(createPostReqs[0].status === 201, 'POST /api/projects responded with HTTP 201 Created');
    assert(createPostReqs[0].cache === 'no-store', 'ProjectsAPI._request sets cache: "no-store"');

    const activeProjectsAfterCreate = app.Storage.getProjects();
    assert(activeProjectsAfterCreate.length === 1, 'Storage.getProjects() contains the newly created project');
    const proj1Id = activeProjectsAfterCreate[0].id;
    assert(proj1Id.startsWith('proj_'), 'Created project has a valid generated project ID');
    assert(
      app.ProjectsPersistence.isPersisted(proj1Id),
      'ProjectsPersistence marks newly created project ID as persisted in MongoDB'
    );

    // Verify Scenario 2: Stored directly in MongoDB with user ownership
    const mongoProj1 = await db.collection('projects').findOne({ id: proj1Id });
    assert(Boolean(mongoProj1), 'MongoDB projects collection stores the newly created project document');
    assert(mongoProj1?.userId === userAId, 'MongoDB project document enforces authenticated userId ownership');
    assert(mongoProj1?.name === 'Qavora Checkout Portal', 'MongoDB project document stores exact project name');
    assert(mongoProj1?.version === 'v2.4.0', 'MongoDB project document stores exact project version');

    // Verify Shared Reference Aliasing Fix: mutating Storage.getProjects() does NOT mutate State.projects!
    const callerCopy = app.Storage.getProjects();
    assert(callerCopy !== app.State.projects, 'Storage.getProjects() never returns the internal State.projects array reference');
    assert(callerCopy[0] !== app.State.projects[0], 'Storage.getProjects() returns deep-cloned project objects');
    callerCopy[0].name = 'MUTATED_BY_CALLER_WITHOUT_SAVE';
    callerCopy[0].testPlan.name = 'MUTATED_NESTED_PLAN';
    callerCopy.push({ id: 'rogue_unpersisted' } as any);

    assert(
      app.State.projects.length === 1 &&
        app.State.projects[0].name === 'Qavora Checkout Portal' &&
        app.State.projects[0].testPlan.name === 'Qavora Checkout Portal Test Plan',
      'Caller mutations on Storage.getProjects() array or nested objects cannot corrupt internal State.projects'
    );

    // Also verify caller mutating Storage.getProjects() BEFORE calling Storage.saveProjects() IS detected!
    recordedRequests.length = 0;
    const directMutateList = app.Storage.getProjects();
    directMutateList[0].description = 'Updated via Storage.getProjects() + Storage.saveProjects()';
    directMutateList[0].updatedAt = new Date().toISOString();
    const directSaveRes = app.Storage.saveProjects(directMutateList);
    if (directSaveRes.syncPromise) {
      await directSaveRes.syncPromise;
    }
    const patchFromDirectSave = recordedRequests.filter(
      (r) => r.method === 'PATCH' && r.path === `/api/projects/${proj1Id}/data`
    );
    assert(
      patchFromDirectSave.length === 1 && patchFromDirectSave[0].status === 200,
      'Mutating array returned by Storage.getProjects() and passing to Storage.saveProjects() reliably detects delta and syncs to MongoDB'
    );

    // ========================================================================
    // SCENARIO 3: Editing a Project Sends PATCH /api/projects/:id/data
    // ========================================================================
    console.log('\n--- Scenario 3: Project Editing Synchronization ---');
    recordedRequests.length = 0;

    app.openProjectModal(proj1Id);
    app.DOM.projectNameInput.value = 'Qavora Checkout Portal Pro';
    app.DOM.projectTypeInput.value = 'SaaS Platform';
    app.DOM.projectStatusInput.value = 'Completed';
    app.DOM.projectVersionInput.value = 'v2.5.0';
    app.DOM.projectDescInput.value = 'Upgraded enterprise checkout verification workspace';

    await app.handleCreateOrEditProjectSubmit(makeSubmitEvent());

    const editPatchReqs = recordedRequests.filter(
      (r) => r.method === 'PATCH' && r.path === `/api/projects/${proj1Id}/data`
    );
    const editPostReqs = recordedRequests.filter((r) => r.method === 'POST' && r.path === '/api/projects');
    assert(editPatchReqs.length === 1 && editPatchReqs[0].status === 200, 'Editing a project sends PATCH /api/projects/:id/data (HTTP 200)');
    assert(editPostReqs.length === 0, 'Editing an existing project does NOT send POST /api/projects');

    const mongoAfterEdit = await db.collection('projects').findOne({ id: proj1Id });
    assert(
      mongoAfterEdit?.name === 'Qavora Checkout Portal Pro' &&
        mongoAfterEdit?.type === 'SaaS Platform' &&
        mongoAfterEdit?.status === 'Completed' &&
        mongoAfterEdit?.version === 'v2.5.0' &&
        mongoAfterEdit?.userId === userAId,
      'MongoDB document reflects edited project name, type, status, version, and preserved ownership'
    );

    // ========================================================================
    // SCENARIO 4: All Nested Project Mutations Synchronize to MongoDB
    // ========================================================================
    console.log('\n--- Scenario 4: All Nested Project Mutations Synchronization ---');
    app.State.activePlanProjectId = proj1Id;

    // 4a. Test Plan update
    recordedRequests.length = 0;
    app.DOM.planNameInput.value = 'Release v2.5 Master Test Plan';
    app.DOM.planObjectiveInput.value = 'Zero P0 payment regressions';
    app.DOM.planScopeInput.value = 'Stripe, Apple Pay, Refunds';
    app.DOM.planDescInput.value = 'Full PCI-compliant checkout coverage';
    await app.handleSaveTestPlanSubmit(makeSubmitEvent());

    let dbProj = await db.collection('projects').findOne({ id: proj1Id });
    assert(
      recordedRequests.some((r) => r.method === 'PATCH' && r.path === `/api/projects/${proj1Id}/data` && r.status === 200) &&
        dbProj?.testPlan?.name === 'Release v2.5 Master Test Plan' &&
        dbProj?.testPlan?.objective === 'Zero P0 payment regressions',
      'Test Plan configuration update synchronizes to MongoDB'
    );

    // 4b. Testing Phase creation (Phase 1 & Phase 2) + Phase editing
    recordedRequests.length = 0;
    app.DOM.phaseIdInput.value = '';
    app.DOM.phaseNameInput.value = 'Phase 1: Smoke Verification';
    app.DOM.phaseDescInput.value = 'Core payment gateway reachability';
    await app.handleSavePhaseSubmit(makeSubmitEvent());

    app.DOM.phaseIdInput.value = '';
    app.DOM.phaseNameInput.value = 'Phase 2: Edge & Refund Flows';
    app.DOM.phaseDescInput.value = 'Partial & multi-currency refunds';
    await app.handleSavePhaseSubmit(makeSubmitEvent());

    dbProj = await db.collection('projects').findOne({ id: proj1Id });
    assert(dbProj?.testPlan?.phases?.length === 2, 'Both created testing phases are stored in MongoDB');
    const phase1Id = dbProj!.testPlan.phases[0].id;
    const phase2Id = dbProj!.testPlan.phases[1].id;

    // Edit Phase 1
    app.DOM.phaseIdInput.value = phase1Id;
    app.DOM.phaseNameInput.value = 'Phase 1: Core Smoke & Auth';
    app.DOM.phaseDescInput.value = 'Updated smoke scope';
    await app.handleSavePhaseSubmit(makeSubmitEvent());

    dbProj = await db.collection('projects').findOne({ id: proj1Id });
    assert(
      dbProj?.testPlan?.phases?.find((p: any) => p.id === phase1Id)?.name === 'Phase 1: Core Smoke & Auth',
      'Testing phase edit synchronizes to MongoDB'
    );

    // 4c. Phase movement (reorder) updates phase order AND project.updatedAt in MongoDB
    const updatedAtBeforeMove = dbProj!.updatedAt;
    await new Promise((r) => setTimeout(r, 15));
    recordedRequests.length = 0;
    await app.movePhase(proj1Id, phase2Id, -1); // Move Phase 2 up before Phase 1

    dbProj = await db.collection('projects').findOne({ id: proj1Id });
    assert(
      recordedRequests.some((r) => r.method === 'PATCH' && r.path === `/api/projects/${proj1Id}/data` && r.status === 200) &&
        dbProj?.testPlan?.phases?.[0]?.id === phase2Id &&
        dbProj?.testPlan?.phases?.[0]?.order === 0 &&
        dbProj?.testPlan?.phases?.[1]?.id === phase1Id &&
        dbProj?.testPlan?.phases?.[1]?.order === 1 &&
        dbProj?.updatedAt !== updatedAtBeforeMove,
      'Phase movement updates sequential phase order, updates project.updatedAt, and syncs to MongoDB'
    );

    // 4d. Test Suite creation (Suite 1 & Suite 2) + Suite editing
    recordedRequests.length = 0;
    app.DOM.suiteIdInput.value = '';
    app.DOM.suitePhaseSelect.value = phase1Id;
    app.DOM.suiteNameInput.value = 'Card Checkout Suite';
    app.DOM.suiteCategorySelect.value = 'Functional';
    app.DOM.suiteTagsInput.value = 'payments, cards';
    app.DOM.suiteDescInput.value = '3DS2 card flows';
    await app.handleSaveSuiteSubmit(makeSubmitEvent());

    app.DOM.suiteIdInput.value = '';
    app.DOM.suitePhaseSelect.value = phase2Id;
    app.DOM.suiteNameInput.value = 'Disposable Temp Suite';
    app.DOM.suiteCategorySelect.value = 'Regression';
    app.DOM.suiteTagsInput.value = 'temp';
    app.DOM.suiteDescInput.value = 'Suite for deletion verification';
    await app.handleSaveSuiteSubmit(makeSubmitEvent());

    dbProj = await db.collection('projects').findOne({ id: proj1Id });
    assert(dbProj?.testSuites?.length === 2, 'Created test suites are stored in MongoDB');
    const suite1Id = dbProj!.testSuites[0].id;
    const suite2Id = dbProj!.testSuites[1].id;

    // Edit Suite 1
    app.DOM.suiteIdInput.value = suite1Id;
    app.DOM.suitePhaseSelect.value = phase1Id;
    app.DOM.suiteNameInput.value = 'Card & 3DS2 Checkout Suite';
    app.DOM.suiteCategorySelect.value = 'Security';
    app.DOM.suiteTagsInput.value = 'payments, 3ds2, pci';
    app.DOM.suiteDescInput.value = 'Updated 3DS2 suite';
    await app.handleSaveSuiteSubmit(makeSubmitEvent());

    dbProj = await db.collection('projects').findOne({ id: proj1Id });
    assert(
      dbProj?.testSuites?.find((s: any) => s.id === suite1Id)?.name === 'Card & 3DS2 Checkout Suite',
      'Test suite edit synchronizes to MongoDB'
    );

    // 4e. Test Case creation + editing + duplication
    app.State.activeSuiteId = suite1Id;
    app.DOM.caseIdInput.value = '';
    app.DOM.caseSuiteIdInput.value = suite1Id;
    app.DOM.caseTitleInput.value = 'Verify Visa 3DS2 Challenge Approval';
    app.DOM.casePrioritySelect.value = 'Critical';
    app.DOM.caseCategoryInput.value = 'Security';
    app.DOM.caseTagsInput.value = 'visa, 3ds2';
    app.DOM.caseDescInput.value = 'Validates 3DS2 OTP challenge flow';
    app.DOM.casePreconditionsInput.value = 'Cart contains 1 item ($49.00)';
    app.DOM.caseExpectedInput.value = 'Order confirmed and receipt generated';
    app.State.modalSteps = [
      { id: 'st_1', action: 'Enter Visa 3DS2 test card', testData: '4000002500003155' },
      { id: 'st_2', action: 'Submit OTP code in challenge modal', testData: '123456' }
    ];
    await app.handleSaveTestCaseSubmit(makeSubmitEvent());

    dbProj = await db.collection('projects').findOne({ id: proj1Id });
    const createdCases = dbProj?.testSuites?.find((s: any) => s.id === suite1Id)?.testCases || [];
    assert(createdCases.length === 1 && createdCases[0].id === 'TC-001', 'Test Case TC-001 created and stored in MongoDB');

    // Edit TC-001
    app.DOM.caseIdInput.value = 'TC-001';
    app.DOM.caseSuiteIdInput.value = suite1Id;
    app.DOM.caseTitleInput.value = 'Verify Visa 3DS2 Challenge & Webhook';
    app.DOM.casePrioritySelect.value = 'Critical';
    app.DOM.caseCategoryInput.value = 'Security';
    app.DOM.caseTagsInput.value = 'visa, 3ds2, webhook';
    app.DOM.caseDescInput.value = 'Validates 3DS2 OTP challenge + payment_intent.succeeded';
    app.DOM.casePreconditionsInput.value = 'Cart contains 1 item ($49.00)';
    app.DOM.caseExpectedInput.value = 'Order confirmed, webhook processed, receipt generated';
    app.State.modalSteps = [
      { id: 'st_1', action: 'Enter Visa 3DS2 test card', testData: '4000002500003155' },
      { id: 'st_2', action: 'Submit OTP code in challenge modal', testData: '123456' }
    ];
    await app.handleSaveTestCaseSubmit(makeSubmitEvent());

    // Duplicate TC-001 -> TC-002, and duplicate again -> TC-003 (for deletion test)
    await app.duplicateTestCase(proj1Id, suite1Id, 'TC-001');
    await app.duplicateTestCase(proj1Id, suite1Id, 'TC-001');

    dbProj = await db.collection('projects').findOne({ id: proj1Id });
    const casesAfterDup = dbProj?.testSuites?.find((s: any) => s.id === suite1Id)?.testCases || [];
    assert(
      casesAfterDup.length === 3 &&
        casesAfterDup[0].title === 'Verify Visa 3DS2 Challenge & Webhook' &&
        casesAfterDup.some((c: any) => c.id === 'TC-002') &&
        casesAfterDup.some((c: any) => c.id === 'TC-003') &&
        dbProj?.testCaseCount === 3,
      'Test Case edit and duplicateTestCase synchronize to MongoDB and update testCaseCount'
    );

    // 4f. Test Execution (Pass on TC-001, Fail + Quick Defect on TC-002)
    app.State.modalExecContext = {
      projectId: proj1Id,
      suiteId: suite1Id,
      caseId: 'TC-001',
      steps: [
        { stepId: 'st_1', action: 'Enter Visa 3DS2 test card', testData: '4000002500003155', status: 'completed', note: 'Accepted' },
        { stepId: 'st_2', action: 'Submit OTP code', testData: '123456', status: 'completed', note: 'Verified' }
      ]
    };
    app.DOM.execProjectIdInput.value = proj1Id;
    app.DOM.execCaseIdInput.value = 'TC-001';
    app.DOM.execStatusSelect.value = 'Pass';
    app.DOM.execActualInput.value = 'Order confirmed and webhook received in 320ms';
    app.DOM.execNotesInput.value = 'Clean run on staging';
    app.DOM.execTesterInput.value = 'Alice QA Lead';
    app.DOM.execEnvInput.value = 'Staging';
    app.DOM.execDeviceInput.value = 'Chrome 131 / macOS';
    app.DOM.execBuildInput.value = 'v2.5.0-rc1';
    app.DOM.execLogDefectToggle.checked = false;
    await app.handleSaveExecutionSubmit(makeSubmitEvent());

    // Fail execution on TC-002 with quick defect creation
    app.State.modalExecContext = {
      projectId: proj1Id,
      suiteId: suite1Id,
      caseId: 'TC-002',
      steps: [
        { stepId: 'st_1', action: 'Enter Visa 3DS2 test card', testData: '4000002500003155', status: 'completed', note: '' },
        { stepId: 'st_2', action: 'Submit OTP code', testData: '000000', status: 'failed', note: 'Modal froze' }
      ]
    };
    app.DOM.execProjectIdInput.value = proj1Id;
    app.DOM.execCaseIdInput.value = 'TC-002';
    app.DOM.execStatusSelect.value = 'Fail';
    app.DOM.execActualInput.value = '3DS2 iframe froze on invalid OTP retry';
    app.DOM.execNotesInput.value = 'Console shows unhandled rejection';
    app.DOM.execTesterInput.value = 'Alice QA Lead';
    app.DOM.execEnvInput.value = 'Staging';
    app.DOM.execDeviceInput.value = 'Safari 18';
    app.DOM.execBuildInput.value = 'v2.5.0-rc1';
    app.DOM.execLogDefectToggle.checked = true;
    app.DOM.execDefectTitle.value = '3DS2 iframe hangs after invalid OTP';
    app.DOM.execDefectSeverity.value = 'Critical';
    app.DOM.execDefectSteps.value = '1. Trigger 3DS2\n2. Submit wrong OTP';
    app.DOM.execDefectUrl.value = 'https://issues.example.com/QAV-101';
    await app.handleSaveExecutionSubmit(makeSubmitEvent());

    dbProj = await db.collection('projects').findOne({ id: proj1Id });
    assert(
      dbProj?.executions?.length === 2 &&
        dbProj?.passedTests === 1 &&
        dbProj?.failedTests === 1 &&
        dbProj?.defects?.length === 1 &&
        dbProj?.openDefects === 1,
      'Test executions (Pass & Fail with quick defect) synchronize executions, defects, and KPIs to MongoDB'
    );
    const execDefectId = dbProj!.defects[0].id;

    // 4g. Standalone Defect creation, editing, quick-status update, and cross-project move
    app.DOM.defectIdInput.value = '';
    app.DOM.defectProjectIdInput.value = proj1Id;
    app.DOM.defectProjectSelectField.value = proj1Id;
    app.DOM.defectTitleInput.value = 'Apple Pay button misaligned on 320px viewport';
    app.DOM.defectSeveritySelect.value = 'Medium';
    app.DOM.defectStatusSelect.value = 'Open';
    app.DOM.defectLinkedCaseSelect.value = 'TC-001';
    app.DOM.defectStepsInput.value = 'Resize viewport to 320px width';
    app.DOM.defectExpectedInput.value = 'Button stays inside checkout container';
    app.DOM.defectActualInput.value = 'Button overflows right border by 12px';
    app.DOM.defectDescInput.value = 'CSS flex-wrap missing';
    app.DOM.defectUrlInput.value = '';
    await app.handleSaveDefectSubmit(makeSubmitEvent());

    dbProj = await db.collection('projects').findOne({ id: proj1Id });
    assert(dbProj?.defects?.length === 2, 'Standalone defect creation synchronizes to MongoDB');
    const standaloneDefectId = dbProj!.defects[0].id;

    // Quick status update -> Resolved
    await app.updateDefectQuickStatus(proj1Id, execDefectId, 'Resolved');
    dbProj = await db.collection('projects').findOne({ id: proj1Id });
    assert(
      dbProj?.defects?.find((d: any) => d.id === execDefectId)?.status === 'Resolved' &&
        dbProj?.openDefects === 1,
      'Defect quick-status update synchronizes to MongoDB and updates openDefects'
    );

    // Create a second project (proj2) to test cross-project defect transfer & Scenario 5 unchanged-project isolation
    app.openProjectModal(null);
    app.DOM.projectIdInput.value = '';
    app.DOM.projectNameInput.value = 'Qavora Mobile iOS App';
    app.DOM.projectTypeInput.value = 'Mobile Application';
    app.DOM.projectStatusInput.value = 'Active';
    app.DOM.projectVersionInput.value = 'v1.0.0';
    app.DOM.projectDescInput.value = 'iOS native client QA';
    await app.handleCreateOrEditProjectSubmit(makeSubmitEvent());

    const proj2Id = app.Storage.getProjects().find((p: any) => p.name === 'Qavora Mobile iOS App')!.id;
    assert(Boolean(proj2Id && proj2Id !== proj1Id), 'Second project created for multi-project tests');

    // Move standaloneDefectId from proj1 to proj2 via handleSaveDefectSubmit
    recordedRequests.length = 0;
    app.DOM.defectIdInput.value = standaloneDefectId;
    app.DOM.defectProjectIdInput.value = proj1Id;
    app.DOM.defectProjectSelectField.value = proj2Id;
    app.DOM.defectTitleInput.value = 'Apple Pay button misaligned on iOS SE';
    app.DOM.defectSeveritySelect.value = 'High';
    app.DOM.defectStatusSelect.value = 'In Progress';
    app.DOM.defectLinkedCaseSelect.value = '';
    app.DOM.defectStepsInput.value = 'Open checkout on iPhone SE';
    app.DOM.defectExpectedInput.value = 'Button fits screen';
    app.DOM.defectActualInput.value = 'Clipped on right edge';
    app.DOM.defectDescInput.value = 'Moved to iOS project';
    app.DOM.defectUrlInput.value = '';
    await app.handleSaveDefectSubmit(makeSubmitEvent());

    const dbProj1AfterMove = await db.collection('projects').findOne({ id: proj1Id });
    const dbProj2AfterMove = await db.collection('projects').findOne({ id: proj2Id });
    assert(
      !dbProj1AfterMove?.defects?.some((d: any) => d.id === standaloneDefectId) &&
        dbProj2AfterMove?.defects?.some((d: any) => d.id === standaloneDefectId),
      'Cross-project defect edit synchronizes BOTH source and destination projects in MongoDB'
    );

    // 4h. Checklist promotion -> POST /api/projects
    const createdChecklistRes = checklistStore.createChecklistFromParsedPlan(
      {
        title: 'API Gateway Sanity Checklist',
        phases: [
          {
            phaseNumber: '1',
            title: 'Auth Headers',
            sections: [
              {
                type: 'category',
                name: 'JWT Validation',
                notes: [],
                tests: [
                  { testId: 'CHK-1', priority: 'High', text: 'Reject expired Bearer token' },
                  { testId: 'CHK-2', priority: 'Medium', text: 'Accept valid RS256/HS256 token' }
                ]
              }
            ]
          }
        ]
      },
      'API Gateway Sanity Checklist'
    );
    assert(createdChecklistRes.ok === true, 'Created local QA checklist for promotion test');

    recordedRequests.length = 0;
    const promoteRes = checklistStore.promoteChecklistToProject(createdChecklistRes.checklist!.id, {
      projectName: 'Promoted API Gateway Project',
      projectType: 'Web Application'
    });
    assert(promoteRes.ok === true && Boolean(promoteRes.project?.id), 'promoteChecklistToProject succeeded');
    const promotedProjId = promoteRes.project!.id;
    await app.ProjectsPersistence.flushAll();

    const dbPromotedProj = await db.collection('projects').findOne({ id: promotedProjId });
    const appPromotedProj = app.Storage.getProjects().find((p: any) => p.id === promotedProjId);
    assert(
      recordedRequests.some((r) => r.method === 'POST' && r.path === '/api/projects' && r.status === 201) &&
        Boolean(dbPromotedProj) &&
        dbPromotedProj?.sourceChecklistId === createdChecklistRes.checklist!.id &&
        dbPromotedProj?.testSuites?.[0]?.testCases?.length === 2 &&
        appPromotedProj?.testCaseCount === 2,
      'Checklist promotion persists the newly promoted formal project to MongoDB via POST /api/projects'
    );

    // 4i. Universal Deletions: defect, test case, suite, phase, and entire project
    // Delete standaloneDefectId from proj2
    app.requestUniversalDelete('defect', standaloneDefectId, proj2Id);
    await app.executeUniversalDelete();
    const dbProj2AfterDefectDel = await db.collection('projects').findOne({ id: proj2Id });
    assert(
      (dbProj2AfterDefectDel?.defects || []).length === 0,
      'Deleting a defect synchronizes removal to MongoDB'
    );

    // Delete TC-003 from suite1 in proj1
    app.requestUniversalDelete('case', 'TC-003', suite1Id);
    await app.executeUniversalDelete();
    dbProj = await db.collection('projects').findOne({ id: proj1Id });
    assert(
      !(dbProj?.testSuites?.find((s: any) => s.id === suite1Id)?.testCases || []).some((c: any) => c.id === 'TC-003') &&
        dbProj?.testCaseCount === 2,
      'Deleting a test case synchronizes removal and updated testCaseCount to MongoDB'
    );

    // Delete disposable suite2 from proj1
    app.requestUniversalDelete('suite', suite2Id, proj1Id);
    await app.executeUniversalDelete();
    dbProj = await db.collection('projects').findOne({ id: proj1Id });
    assert(
      !(dbProj?.testSuites || []).some((s: any) => s.id === suite2Id),
      'Deleting a test suite synchronizes removal to MongoDB'
    );

    // Delete phase2 from proj1
    app.requestUniversalDelete('phase', phase2Id, proj1Id);
    await app.executeUniversalDelete();
    dbProj = await db.collection('projects').findOne({ id: proj1Id });
    assert(
      !(dbProj?.testPlan?.phases || []).some((ph: any) => ph.id === phase2Id),
      'Deleting a testing phase synchronizes removal to MongoDB'
    );

    // Delete promoted project via universal project delete -> DELETE /api/projects/:id
    recordedRequests.length = 0;
    app.requestUniversalDelete('project', promotedProjId);
    await app.executeUniversalDelete();
    const dbPromotedAfterDel = await db.collection('projects').findOne({ id: promotedProjId });
    assert(
      recordedRequests.some((r) => r.method === 'DELETE' && r.path === `/api/projects/${promotedProjId}` && r.status === 200) &&
        dbPromotedAfterDel === null,
      'Deleting a project sends DELETE /api/projects/:id and removes it from MongoDB'
    );

    // ========================================================================
    // SCENARIO 5: Unchanged Projects Are NOT Unnecessarily Updated
    // ========================================================================
    console.log('\n--- Scenario 5: Unchanged Projects Are Not Unnecessarily Updated ---');
    // Currently User A has 2 persisted projects: proj1Id and proj2Id
    assert(app.Storage.getProjects().length === 2, 'Two projects active in workspace (proj1 & proj2)');

    // 5a. Saving cloned projects with ZERO content changes triggers 0 network requests
    recordedRequests.length = 0;
    const unchangedClones = app.Storage.getProjects();
    const noopSaveRes = app.Storage.saveProjects(unchangedClones);
    if (noopSaveRes.syncPromise) {
      await noopSaveRes.syncPromise;
    }
    assert(
      recordedRequests.length === 0,
      'Calling Storage.saveProjects() with cloned but unchanged projects triggers 0 API requests'
    );

    // 5b. Editing ONLY proj1 triggers 1 PATCH for proj1 and 0 requests for unchanged proj2
    recordedRequests.length = 0;
    app.openProjectModal(proj1Id);
    app.DOM.projectVersionInput.value = 'v2.5.1';
    await app.handleCreateOrEditProjectSubmit(makeSubmitEvent());

    const proj1Reqs = recordedRequests.filter((r) => r.path.includes(proj1Id));
    const proj2Reqs = recordedRequests.filter((r) => r.path.includes(proj2Id));
    assert(
      proj1Reqs.length === 1 && proj1Reqs[0].method === 'PATCH' && proj2Reqs.length === 0,
      'Mutating Project 1 updates ONLY Project 1 and sends 0 requests for unchanged Project 2'
    );

    // ========================================================================
    // SCENARIO 6: Browser Refresh Restores Projects from MongoDB (No Stale 304)
    // ========================================================================
    console.log('\n--- Scenario 6: Browser Refresh & Cache-Busting Restoration ---');
    // Simulate a cold page refresh: wipe in-memory State.projects, hydration flags, and localStorage project backup,
    // leaving ONLY the user's JWT token in localStorage.
    app.State.projects = null;
    app.State.projectsHydrated = false;
    app.ProjectsPersistence.persistedProjectIds.clear();
    mockLocalStorage.removeItem('qavora_projects_v1');

    recordedRequests.length = 0;
    await app.authController.init();
    await app.hydrateProjectsFromBackend();

    const refreshGetReq = recordedRequests.find((r) => r.method === 'GET' && r.path === '/api/projects');
    assert(Boolean(refreshGetReq), 'Simulated browser refresh issued GET /api/projects');
    assert(refreshGetReq?.status === 200, 'GET /api/projects returned fresh HTTP 200 (not stale 304)');
    assert(refreshGetReq?.cache === 'no-store', 'GET /api/projects used fetch cache: "no-store"');
    assert(
      (refreshGetReq?.responseHeaders['cache-control'] || '').includes('no-store'),
      'Backend GET /api/projects sets Cache-Control: no-store header'
    );

    const restoredAfterRefresh = app.Storage.getProjects();
    const restoredProj1 = restoredAfterRefresh.find((p: any) => p.id === proj1Id);
    assert(
      restoredAfterRefresh.length === 2 &&
        restoredProj1?.name === 'Qavora Checkout Portal Pro' &&
        restoredProj1?.version === 'v2.5.1' &&
        restoredProj1?.testPlan?.phases?.length === 1 &&
        restoredProj1?.testSuites?.length === 1 &&
        restoredProj1?.testSuites?.[0]?.testCases?.length === 2 &&
        restoredProj1?.executions?.length === 2 &&
        restoredProj1?.defects?.length === 1,
      'Refresh faithfully restored all projects and nested plans, phases, suites, cases, executions, and defects from MongoDB'
    );

    // ========================================================================
    // SCENARIO 7: Project Data Remains Available After Logout and Re-Login
    // ========================================================================
    console.log('\n--- Scenario 7: Logout Cleanup & Re-Login Restoration ---');
    app.authController.logout();
    assert(app.authController.isAuthenticated() === false, 'User A logged out');
    assert(
      app.State.projects === null && mockLocalStorage.getItem('qavora_projects_v1') === null,
      'Logout cleared in-memory State.projects and localStorage project cache'
    );

    const reloginRes = await app.authController.login('alice.persistence@example.com', 'SecurePass123!');
    assert(reloginRes.ok === true, 'User A logged back in');
    await app.hydrateProjectsFromBackend();

    const restoredAfterRelogin = app.Storage.getProjects();
    assert(
      restoredAfterRelogin.length === 2 &&
        restoredAfterRelogin.some((p: any) => p.id === proj1Id) &&
        restoredAfterRelogin.some((p: any) => p.id === proj2Id),
      'All User A projects remain intact and are restored from MongoDB after logout and login'
    );

    // ========================================================================
    // SCENARIO 8: Derived KPI Metrics Accuracy After Hydration
    // ========================================================================
    console.log('\n--- Scenario 8: Derived KPI Metrics Recalculation on Hydration ---');
    // Insert a project directly into MongoDB with stale/zeroed KPI fields to prove hydrateCache recomputes them
    const rawMetricsProjectId = 'proj_metrics_hydration_test';
    await db.collection('projects').insertOne({
      id: rawMetricsProjectId,
      userId: userAId,
      name: 'Metrics Hydration Audit Project',
      type: 'Web Application',
      status: 'Active',
      version: 'v1.0',
      description: 'Has stale zeroed counters in DB',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Intentionally stale/wrong stored KPIs:
      testCaseCount: 0,
      passedTests: 0,
      failedTests: 0,
      blockedTests: 0,
      skippedTests: 0,
      notRunTests: 0,
      executedTests: 0,
      completionRate: 0,
      passRate: 0,
      totalDefects: 0,
      openDefects: 0,
      testPlan: {
        id: 'plan_metrics',
        name: 'Metrics Plan',
        phases: [{ id: 'ph_m1', name: 'Phase M1', order: 0 }]
      },
      testSuites: [
        {
          id: 'suite_m1',
          phaseId: 'ph_m1',
          name: 'Suite M1',
          category: 'Functional',
          testCases: [
            { id: 'TC-101', title: 'Case Pass', priority: 'High', status: 'Pass', expectedResult: 'OK', steps: [{ id: 's1', action: 'Run' }] },
            { id: 'TC-102', title: 'Case Fail', priority: 'High', status: 'Fail', expectedResult: 'OK', steps: [{ id: 's2', action: 'Run' }] },
            { id: 'TC-103', title: 'Case Blocked', priority: 'Medium', status: 'Blocked', expectedResult: 'OK', steps: [{ id: 's3', action: 'Run' }] },
            { id: 'TC-104', title: 'Case Not Run', priority: 'Low', status: 'Not Run', expectedResult: 'OK', steps: [{ id: 's4', action: 'Run' }] }
          ]
        }
      ],
      executions: [],
      defects: [
        { id: 'DEF-101', title: 'Open Bug', severity: 'High', status: 'Open' },
        { id: 'DEF-102', title: 'Reopened Bug', severity: 'Medium', status: 'Reopened' },
        { id: 'DEF-103', title: 'Closed Bug', severity: 'Low', status: 'Closed' }
      ]
    });

    await app.hydrateProjectsFromBackend({ force: true });
    const hydratedMetricsProj = app.Storage.getProjects().find((p: any) => p.id === rawMetricsProjectId);
    assert(Boolean(hydratedMetricsProj), 'Hydrated raw metrics audit project from MongoDB');
    assert(
      hydratedMetricsProj.testCaseCount === 4 &&
        hydratedMetricsProj.passedTests === 1 &&
        hydratedMetricsProj.failedTests === 1 &&
        hydratedMetricsProj.blockedTests === 1 &&
        hydratedMetricsProj.skippedTests === 0 &&
        hydratedMetricsProj.notRunTests === 1 &&
        hydratedMetricsProj.executedTests === 3 &&
        hydratedMetricsProj.completionRate === 75 &&
        hydratedMetricsProj.passRate === 33 &&
        hydratedMetricsProj.totalDefects === 3 &&
        hydratedMetricsProj.openDefects === 2,
      'Hydration normalized project structure and accurately recomputed all 11 derived KPI metrics'
    );

    // ========================================================================
    // SCENARIO 9: Authentication & Multi-Tenant Isolation
    // ========================================================================
    console.log('\n--- Scenario 9: Authentication & Multi-Tenant Isolation ---');
    // Unauthenticated API access is rejected with HTTP 401
    const unauthGet = await realFetch(`${baseUrl}/api/projects`);
    const unauthPost = await realFetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'proj_unauth', name: 'Illegal', type: 'Website' })
    });
    assert(
      unauthGet.status === 401 && unauthPost.status === 401,
      'Unauthenticated GET /api/projects and POST /api/projects are rejected with HTTP 401'
    );

    // Switch to User B
    app.authController.logout();
    const regBRes = await app.authController.register(
      'Bob Tenant B',
      'bob.tenantb@example.com',
      'SecurePass456!'
    );
    assert(regBRes.ok === true && regBRes.user?.userId !== userAId, 'Registered & logged in isolated User B');
    await app.hydrateProjectsFromBackend();

    assert(app.Storage.getProjects().length === 0, 'User B sees 0 projects from User A after hydration');

    const userBToken = app.authController.getToken();
    const crossReadRes = await realFetch(`${baseUrl}/api/projects/${proj1Id}`, {
      headers: { Authorization: `Bearer ${userBToken}` }
    });
    const crossPatchRes = await realFetch(`${baseUrl}/api/projects/${proj1Id}/data`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`
      },
      body: JSON.stringify({ name: 'Hijacked by User B' })
    });
    const crossDeleteRes = await realFetch(`${baseUrl}/api/projects/${proj1Id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userBToken}` }
    });

    assert(
      crossReadRes.status === 404 && crossPatchRes.status === 404 && crossDeleteRes.status === 404,
      'User B cannot read, patch, or delete User A projects (enforced HTTP 404 tenant boundary)'
    );

    const verifyUserAUntouched = await db.collection('projects').findOne({ id: proj1Id });
    assert(
      verifyUserAUntouched?.name === 'Qavora Checkout Portal Pro' && verifyUserAUntouched?.userId === userAId,
      'User A MongoDB project remains completely untouched after cross-tenant attempts'
    );

    // ========================================================================
    // SCENARIO 10: API Failure Handling Without False Success Reporting
    // ========================================================================
    console.log('\n--- Scenario 10: Clean API Failure Handling & Rollback ---');
    // Log back in as User A
    app.authController.logout();
    await app.authController.login('alice.persistence@example.com', 'SecurePass123!');
    await app.hydrateProjectsFromBackend();
    const countBeforeFailedCreate = app.Storage.getProjects().length;

    // 10a. Simulate HTTP 503 failure on POST /api/projects during Create Project
    faultInjectionRule = (method, pathname) => {
      if (method === 'POST' && pathname === '/api/projects') {
        return {
          status: 503,
          body: { error: 'Database service temporarily unavailable.' }
        };
      }
      return null;
    };

    toastLog.length = 0;
    app.openProjectModal(null);
    app.DOM.projectIdInput.value = '';
    app.DOM.projectNameInput.value = 'Should Not Persist On 503';
    app.DOM.projectTypeInput.value = 'Website';
    app.DOM.projectStatusInput.value = 'Active';
    app.DOM.projectVersionInput.value = 'v0.1';
    app.DOM.projectDescInput.value = 'Simulated backend outage';

    await app.handleCreateOrEditProjectSubmit(makeSubmitEvent());

    const projectsAfterFailedCreate = app.Storage.getProjects();
    const successToastsOnCreateFail = toastLog.filter((t) => t.type === 'success');
    assert(
      projectsAfterFailedCreate.length === countBeforeFailedCreate &&
        !projectsAfterFailedCreate.some((p: any) => p.name === 'Should Not Persist On 503'),
      'Failed POST /api/projects rolled back optimistic project creation from frontend state & cache'
    );
    assert(
      app.DOM.projectModal.classList.contains('open') &&
        app.DOM.modalErrorAlert.style.display === 'flex' &&
        app.DOM.modalErrorText.textContent.includes('Database service temporarily unavailable'),
      'Create modal stays open and displays exact backend failure message on API error'
    );
    assert(
      successToastsOnCreateFail.length === 0 &&
        Boolean(app.State.projectsError) &&
        app.getSyncStatusInfo().state !== 'synced',
      'Zero false success toasts emitted and sync status reflects error state on POST failure'
    );
    app.DOM.projectModal.classList.remove('open');

    // 10b. Simulate HTTP 500 failure on PATCH /api/projects/:id/data during Edit Project
    faultInjectionRule = (method, pathname) => {
      if (method === 'PATCH' && pathname === `/api/projects/${proj1Id}/data`) {
        return {
          status: 500,
          body: { error: 'Simulated MongoDB write failure.' }
        };
      }
      return null;
    };

    toastLog.length = 0;
    app.openProjectModal(proj1Id);
    app.DOM.projectNameInput.value = 'Name That Must Roll Back';
    await app.handleCreateOrEditProjectSubmit(makeSubmitEvent());

    const proj1AfterFailedEdit = app.Storage.getProjects().find((p: any) => p.id === proj1Id);
    const successToastsOnEditFail = toastLog.filter((t) => t.type === 'success');
    assert(
      proj1AfterFailedEdit?.name === 'Qavora Checkout Portal Pro',
      'Failed PATCH /api/projects/:id/data rolled back edited project name to last persisted snapshot'
    );
    assert(
      successToastsOnEditFail.length === 0 &&
        app.DOM.modalErrorAlert.style.display === 'flex' &&
        app.DOM.modalErrorText.textContent.includes('Simulated MongoDB write failure'),
      'Zero false success toasts emitted and modal error displayed on PATCH failure'
    );

    faultInjectionRule = null;
  } finally {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await directMongo.close();
    await mongod.stop();
  }

  console.log('\n========================================================================');
  console.log(`SUMMARY: ${passedCount} passed, ${failedCount} failed`);
  console.log('========================================================================');

  process.exit(failedCount > 0 ? 1 : 0);
}

runPersistenceVerification().catch((err) => {
  console.error('Fatal error in verify-persistence.ts:', err);
  process.exit(1);
});
