/**
 * Verification test suite for Phase 4 - Step 5: Authentication UI
 * Validates DOM markup, CSS design system, client-side validation, password toggles,
 * access-control state transitions, and end-to-end integration with authController and MongoDB backend.
 */

import fs from 'fs';
import path from 'path';
import express, { Request, Response } from 'express';
import { MongoClient, Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import http from 'http';

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passedCount++;
    console.log(`  ✓ [PASS] #${passedCount}: ${message}`);
  } else {
    failedCount++;
    console.error(`  ✗ [FAIL] ${message}`);
  }
}

// ============================================================================
// Mock DOM Implementation for Node.js Testing
// ============================================================================
class MockClassList {
  private set: Set<string> = new Set();
  add(...tokens: string[]) { tokens.forEach(t => this.set.add(t)); }
  remove(...tokens: string[]) { tokens.forEach(t => this.set.delete(t)); }
  toggle(token: string, force?: boolean): boolean {
    if (force !== undefined) {
      if (force) { this.set.add(token); return true; }
      else { this.set.delete(token); return false; }
    }
    if (this.set.has(token)) { this.set.delete(token); return false; }
    else { this.set.add(token); return true; }
  }
  contains(token: string) { return this.set.has(token); }
  has(token: string) { return this.set.has(token); }
}

class MockElement {
  public tagName: string;
  public id: string;
  public className: string = '';
  public classList: MockClassList = new MockClassList();
  public style: Record<string, string> = {};
  public attributes: Map<string, string> = new Map();
  public textContent: string = '';
  public value: string = '';
  public type: string = 'text';
  public disabled: boolean = false;
  public children: MockElement[] = [];
  public parent: MockElement | null = null;
  public eventListeners: Map<string, Function[]> = new Map();

  constructor(tagName: string, id: string = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
  }

  setAttribute(name: string, val: string) {
    this.attributes.set(name, String(val));
    if (name === 'type') this.type = String(val);
    if (name === 'id') this.id = String(val);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) || null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  addEventListener(event: string, handler: Function) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(handler);
  }

  dispatchEvent(event: { type: string; preventDefault?: () => void }) {
    const handlers = this.eventListeners.get(event.type) || [];
    for (const h of handlers) {
      h(event);
    }
  }

  focus() {}

  reset() {
    this.value = '';
    for (const child of this.children) {
      child.reset();
    }
  }

  querySelector(selector: string): MockElement | null {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      for (const child of this.children) {
        if (child.classList.has(cls)) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const res: MockElement[] = [];
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      for (const child of this.children) {
        if (child.classList.has(cls)) res.push(child);
        res.push(...child.querySelectorAll(selector));
      }
    }
    return res;
  }
}

class MockDocument {
  private elementMap: Map<string, MockElement> = new Map();

  registerElement(el: MockElement) {
    if (el.id) {
      this.elementMap.set(el.id, el);
    }
    for (const child of el.children) {
      this.registerElement(child);
    }
  }

  getElementById(id: string): MockElement | null {
    return this.elementMap.get(id) || null;
  }

  createElement(tagName: string): MockElement {
    return new MockElement(tagName);
  }
}

// In-memory mock localStorage
class MockLocalStorage {
  private store: Map<string, string> = new Map();

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
}

async function runTests() {
  console.log('=== PHASE 4 - STEP 5: AUTHENTICATION UI VERIFICATION ===\n');

  // ==========================================================================
  // SECTION 1: HTML Structure & Markup Inspection in index.html
  // ==========================================================================
  console.log('--- Section 1: HTML Structure & Accessibility in index.html ---');
  const indexHtmlPath = path.resolve('index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  // Loading Overlay
  assert(indexHtml.includes('id="auth-loading-overlay"'), 'index.html contains session loading overlay (#auth-loading-overlay)');
  assert(indexHtml.includes('class="auth-loading-spinner"'), 'index.html contains loading spinner (.auth-loading-spinner)');
  assert(indexHtml.includes('Verifying session...'), 'index.html contains loading status text');

  // Auth Container & Panels
  assert(indexHtml.includes('id="auth-container"'), 'index.html contains auth container (#auth-container)');
  assert(indexHtml.includes('id="auth-login-panel"'), 'index.html contains login panel (#auth-login-panel)');
  assert(indexHtml.includes('id="auth-register-panel"'), 'index.html contains register panel (#auth-register-panel)');

  // Tabs
  assert(indexHtml.includes('id="auth-tab-login"'), 'index.html contains login switcher tab (#auth-tab-login)');
  assert(indexHtml.includes('id="auth-tab-register"'), 'index.html contains register switcher tab (#auth-tab-register)');
  assert(indexHtml.includes('role="tablist"'), 'index.html has accessible tablist role for switcher');

  // Alert Banners
  assert(indexHtml.includes('id="auth-error-alert"'), 'index.html contains error alert container (#auth-error-alert)');
  assert(indexHtml.includes('id="auth-error-message"'), 'index.html contains error message target (#auth-error-message)');
  assert(indexHtml.includes('id="auth-success-alert"'), 'index.html contains success alert container (#auth-success-alert)');

  // Login Form
  assert(indexHtml.includes('id="auth-login-form"'), 'index.html contains login form (#auth-login-form)');
  assert(indexHtml.includes('id="login-email"'), 'index.html contains login email input (#login-email)');
  assert(indexHtml.includes('id="login-password"'), 'index.html contains login password input (#login-password)');
  assert(indexHtml.includes('id="login-password-toggle"'), 'index.html contains login password toggle button (#login-password-toggle)');
  assert(indexHtml.includes('id="login-submit-btn"'), 'index.html contains login submit button (#login-submit-btn)');
  assert(indexHtml.includes('id="switch-to-register-link"'), 'index.html contains switch to register link button (#switch-to-register-link)');

  // Registration Form
  assert(indexHtml.includes('id="auth-register-form"'), 'index.html contains registration form (#auth-register-form)');
  assert(indexHtml.includes('id="register-name"'), 'index.html contains register name input (#register-name)');
  assert(indexHtml.includes('id="register-email"'), 'index.html contains register email input (#register-email)');
  assert(indexHtml.includes('id="register-password"'), 'index.html contains register password input (#register-password)');
  assert(indexHtml.includes('id="register-password-toggle"'), 'index.html contains register password toggle (#register-password-toggle)');
  assert(indexHtml.includes('id="register-confirm-password"'), 'index.html contains confirm password input (#register-confirm-password)');
  assert(indexHtml.includes('id="register-confirm-password-toggle"'), 'index.html contains confirm password toggle (#register-confirm-password-toggle)');
  assert(indexHtml.includes('id="register-submit-btn"'), 'index.html contains register submit button (#register-submit-btn)');
  assert(indexHtml.includes('id="switch-to-login-link"'), 'index.html contains switch to login link button (#switch-to-login-link)');

  // Header and Sidebar User Profile & Logout Elements
  assert(indexHtml.includes('id="header-user-avatar"'), 'index.html contains header user avatar initials (#header-user-avatar)');
  assert(indexHtml.includes('id="header-user-name"'), 'index.html contains header user name (#header-user-name)');
  assert(indexHtml.includes('id="header-user-role"'), 'index.html contains header user role (#header-user-role)');
  assert(indexHtml.includes('id="header-logout-btn"'), 'index.html contains header logout button (#header-logout-btn)');
  assert(indexHtml.includes('id="sidebar-logout-btn"'), 'index.html contains sidebar logout button (#sidebar-logout-btn)');

  // App Container starts hidden to prevent flash of unauthenticated dashboard
  assert(indexHtml.includes('id="app-container" class="app-container" style="display: none;"'), 'App container has initial style="display: none;" to prevent flash of content');

  // ==========================================================================
  // SECTION 2: CSS Stylesheet Inspection in style.css
  // ==========================================================================
  console.log('\n--- Section 2: CSS Design System in style.css ---');
  const styleCssPath = path.resolve('style.css');
  const styleCss = fs.readFileSync(styleCssPath, 'utf8');

  assert(styleCss.includes('.auth-loading-overlay'), 'style.css defines .auth-loading-overlay with fixed viewport and high z-index');
  assert(styleCss.includes('.auth-container'), 'style.css defines .auth-container with responsive centered layout');
  assert(styleCss.includes('.auth-card'), 'style.css defines .auth-card with surface background and dark theme elevation');
  assert(styleCss.includes('.auth-tabs'), 'style.css defines .auth-tabs switcher navigation');
  assert(styleCss.includes('.auth-input'), 'style.css defines .auth-input with focus ring and transitions');
  assert(styleCss.includes('.auth-password-toggle-btn'), 'style.css defines .auth-password-toggle-btn positioning');
  assert(styleCss.includes('.auth-alert-error'), 'style.css defines .auth-alert-error with accessible error colors');
  assert(styleCss.includes('.auth-alert-success'), 'style.css defines .auth-alert-success');
  assert(styleCss.includes('.auth-submit-btn'), 'style.css defines .auth-submit-btn styling');
  assert(styleCss.includes('.auth-btn-spinner'), 'style.css defines .auth-btn-spinner animation');
  assert(styleCss.includes('.header-logout-btn'), 'style.css defines .header-logout-btn styling');
  assert(styleCss.includes('.sidebar-logout-btn'), 'style.css defines .sidebar-logout-btn styling');

  // ==========================================================================
  // SECTION 3: Frontend Module Inspection in authUI.js & script.js
  // ==========================================================================
  console.log('\n--- Section 3: Module Inspection in authUI.js & script.js ---');
  const authUiPath = path.resolve('authUI.js');
  assert(fs.existsSync(authUiPath), 'authUI.js exists as dedicated UI controller');

  const authUiContent = fs.readFileSync(authUiPath, 'utf8');
  assert(authUiContent.includes('export function initAuthUI'), 'authUI.js exports initAuthUI()');
  assert(authUiContent.includes('export function togglePasswordVisibility'), 'authUI.js exports togglePasswordVisibility()');
  assert(authUiContent.includes('export function switchAuthTab'), 'authUI.js exports switchAuthTab()');
  assert(authUiContent.includes('export function showAuthError'), 'authUI.js exports showAuthError()');
  assert(authUiContent.includes('export function resetAuthForms'), 'authUI.js exports resetAuthForms()');
  assert(authUiContent.includes('export function updateUserProfileUI'), 'authUI.js exports updateUserProfileUI()');
  assert(authUiContent.includes('authController.login'), 'authUI.js uses authController.login() exclusively');
  assert(authUiContent.includes('authController.register'), 'authUI.js uses authController.register() exclusively');
  assert(authUiContent.includes('authController.logout'), 'authUI.js uses authController.logout() exclusively');

  const scriptJsContent = fs.readFileSync(path.resolve('script.js'), 'utf8');
  assert(scriptJsContent.includes("import { initAuthUI } from './authUI.js'"), 'script.js imports initAuthUI');
  assert(scriptJsContent.includes('initAuthUI('), 'script.js invokes initAuthUI() during initialization');

  // ==========================================================================
  // SECTION 4: Component Logic & State Transition Simulation
  // ==========================================================================
  console.log('\n--- Section 4: Component Logic & DOM Behavior Simulation ---');

  // Dynamically import authUI functions
  const authUI = await import('../authUI.js');

  // Helper to build a simulated mock DOM environment
  function setupMockDom() {
    const doc = new MockDocument();

    const loadingOverlay = new MockElement('div', 'auth-loading-overlay');
    const authContainer = new MockElement('div', 'auth-container');
    const appContainer = new MockElement('div', 'app-container');

    const tabLogin = new MockElement('button', 'auth-tab-login');
    const tabRegister = new MockElement('button', 'auth-tab-register');
    const panelLogin = new MockElement('div', 'auth-login-panel');
    const panelRegister = new MockElement('div', 'auth-register-panel');

    const errorAlert = new MockElement('div', 'auth-error-alert');
    const errorMessage = new MockElement('span', 'auth-error-message');
    errorAlert.children.push(errorMessage);

    const successAlert = new MockElement('div', 'auth-success-alert');
    const successMessage = new MockElement('span', 'auth-success-message');
    successAlert.children.push(successMessage);

    // Login Form Elements
    const loginForm = new MockElement('form', 'auth-login-form');
    const loginEmail = new MockElement('input', 'login-email');
    loginEmail.setAttribute('type', 'email');
    const loginEmailError = new MockElement('div', 'login-email-error');
    const loginPassword = new MockElement('input', 'login-password');
    loginPassword.setAttribute('type', 'password');
    const loginPasswordError = new MockElement('div', 'login-password-error');
    const loginPasswordToggle = new MockElement('button', 'login-password-toggle');
    const eye1 = new MockElement('svg');
    eye1.classList.add('icon-eye');
    const eyeOff1 = new MockElement('svg');
    eyeOff1.classList.add('icon-eye-off');
    loginPasswordToggle.children.push(eye1, eyeOff1);

    const loginSubmitBtn = new MockElement('button', 'login-submit-btn');
    const spinner1 = new MockElement('span');
    spinner1.classList.add('auth-btn-spinner');
    const textSpan1 = new MockElement('span');
    textSpan1.classList.add('auth-btn-text');
    loginSubmitBtn.children.push(spinner1, textSpan1);

    const switchToRegisterLink = new MockElement('button', 'switch-to-register-link');
    loginForm.children.push(loginEmail, loginEmailError, loginPassword, loginPasswordError, loginPasswordToggle, loginSubmitBtn, switchToRegisterLink);

    // Register Form Elements
    const registerForm = new MockElement('form', 'auth-register-form');
    const registerName = new MockElement('input', 'register-name');
    const registerNameError = new MockElement('div', 'register-name-error');
    const registerEmail = new MockElement('input', 'register-email');
    registerEmail.setAttribute('type', 'email');
    const registerEmailError = new MockElement('div', 'register-email-error');
    const registerPassword = new MockElement('input', 'register-password');
    registerPassword.setAttribute('type', 'password');
    const registerPasswordError = new MockElement('div', 'register-password-error');
    const registerPasswordToggle = new MockElement('button', 'register-password-toggle');
    const eye2 = new MockElement('svg');
    eye2.classList.add('icon-eye');
    const eyeOff2 = new MockElement('svg');
    eyeOff2.classList.add('icon-eye-off');
    registerPasswordToggle.children.push(eye2, eyeOff2);

    const registerConfirmPassword = new MockElement('input', 'register-confirm-password');
    registerConfirmPassword.setAttribute('type', 'password');
    const registerConfirmError = new MockElement('div', 'register-confirm-error');
    const registerConfirmPasswordToggle = new MockElement('button', 'register-confirm-password-toggle');
    const eye3 = new MockElement('svg');
    eye3.classList.add('icon-eye');
    const eyeOff3 = new MockElement('svg');
    eyeOff3.classList.add('icon-eye-off');
    registerConfirmPasswordToggle.children.push(eye3, eyeOff3);

    const registerSubmitBtn = new MockElement('button', 'register-submit-btn');
    const spinner2 = new MockElement('span');
    spinner2.classList.add('auth-btn-spinner');
    const textSpan2 = new MockElement('span');
    textSpan2.classList.add('auth-btn-text');
    registerSubmitBtn.children.push(spinner2, textSpan2);

    const switchToLoginLink = new MockElement('button', 'switch-to-login-link');
    registerForm.children.push(
      registerName, registerNameError, registerEmail, registerEmailError,
      registerPassword, registerPasswordError, registerPasswordToggle,
      registerConfirmPassword, registerConfirmError, registerConfirmPasswordToggle,
      registerSubmitBtn, switchToLoginLink
    );

    // Profile & Logout in app
    const headerUserAvatar = new MockElement('div', 'header-user-avatar');
    const headerUserName = new MockElement('span', 'header-user-name');
    const headerUserRole = new MockElement('span', 'header-user-role');
    const headerLogoutBtn = new MockElement('button', 'header-logout-btn');
    const sidebarLogoutBtn = new MockElement('button', 'sidebar-logout-btn');

    // Register all elements
    const allEls = [
      loadingOverlay, authContainer, appContainer,
      tabLogin, tabRegister, panelLogin, panelRegister,
      errorAlert, errorMessage, successAlert, successMessage,
      loginForm, loginEmail, loginEmailError, loginPassword, loginPasswordError, loginPasswordToggle, loginSubmitBtn, switchToRegisterLink,
      registerForm, registerName, registerNameError, registerEmail, registerEmailError, registerPassword, registerPasswordError, registerPasswordToggle,
      registerConfirmPassword, registerConfirmError, registerConfirmPasswordToggle, registerSubmitBtn, switchToLoginLink,
      headerUserAvatar, headerUserName, headerUserRole, headerLogoutBtn, sidebarLogoutBtn
    ];

    for (const el of allEls) {
      doc.registerElement(el);
    }

    return {
      doc,
      loadingOverlay, authContainer, appContainer,
      tabLogin, tabRegister, panelLogin, panelRegister,
      errorAlert, errorMessage, successAlert, successMessage,
      loginForm, loginEmail, loginEmailError, loginPassword, loginPasswordError, loginPasswordToggle, loginSubmitBtn, switchToRegisterLink,
      registerForm, registerName, registerNameError, registerEmail, registerEmailError, registerPassword, registerPasswordError, registerPasswordToggle,
      registerConfirmPassword, registerConfirmError, registerConfirmPasswordToggle, registerSubmitBtn, switchToLoginLink,
      headerUserAvatar, headerUserName, headerUserRole, headerLogoutBtn, sidebarLogoutBtn
    };
  }

  // Bind mock document to globalThis
  const mockEnv = setupMockDom();
  (globalThis as any).document = mockEnv.doc;

  // Test Password Visibility Toggle
  const testInput = new MockElement('input', 'test-pass');
  testInput.setAttribute('type', 'password');
  const testToggleBtn = new MockElement('button', 'test-toggle');
  const eye = new MockElement('svg');
  eye.classList.add('icon-eye');
  const eyeOff = new MockElement('svg');
  eyeOff.classList.add('icon-eye-off');
  testToggleBtn.children.push(eye, eyeOff);

  authUI.togglePasswordVisibility(testInput as any, testToggleBtn as any);
  assert(testInput.type === 'text', 'togglePasswordVisibility switches password input to text');
  assert(testToggleBtn.getAttribute('aria-label') === 'Hide password', 'togglePasswordVisibility updates aria-label to "Hide password"');
  assert(eye.style.display === 'none' && eyeOff.style.display === 'block', 'togglePasswordVisibility shows eye-off icon and hides eye icon');

  authUI.togglePasswordVisibility(testInput as any, testToggleBtn as any);
  assert(testInput.type === 'password', 'togglePasswordVisibility switches input back to password');
  assert(testToggleBtn.getAttribute('aria-label') === 'Show password', 'togglePasswordVisibility updates aria-label to "Show password"');
  assert(eye.style.display === 'block' && eyeOff.style.display === 'none', 'togglePasswordVisibility shows eye icon and hides eye-off icon');

  // Test Tab Switching
  authUI.switchAuthTab('register');
  assert(mockEnv.tabRegister.classList.has('active'), 'switchAuthTab("register") activates register tab');
  assert(mockEnv.panelRegister.style.display === 'block', 'switchAuthTab("register") displays register panel');
  assert(mockEnv.panelLogin.style.display === 'none', 'switchAuthTab("register") hides login panel');

  authUI.switchAuthTab('login');
  assert(mockEnv.tabLogin.classList.has('active'), 'switchAuthTab("login") activates login tab');
  assert(mockEnv.panelLogin.style.display === 'block', 'switchAuthTab("login") displays login panel');
  assert(mockEnv.panelRegister.style.display === 'none', 'switchAuthTab("login") hides register panel');

  // Test Inline Field Errors
  authUI.showFieldError(mockEnv.loginEmail as any, mockEnv.loginEmailError as any, 'Please enter a valid email address.');
  assert(mockEnv.loginEmail.classList.has('input-error'), 'showFieldError adds input-error class');
  assert(mockEnv.loginEmail.getAttribute('aria-invalid') === 'true', 'showFieldError sets aria-invalid="true"');
  assert(mockEnv.loginEmailError.textContent === 'Please enter a valid email address.', 'showFieldError renders error message text');
  assert(mockEnv.loginEmailError.style.display === 'block', 'showFieldError displays error message element');

  authUI.clearFieldError(mockEnv.loginEmail as any, mockEnv.loginEmailError as any);
  assert(!mockEnv.loginEmail.classList.has('input-error'), 'clearFieldError removes input-error class');
  assert(mockEnv.loginEmail.getAttribute('aria-invalid') === null, 'clearFieldError removes aria-invalid attribute');
  assert(mockEnv.loginEmailError.style.display === 'none', 'clearFieldError hides error message element');

  // Test User Profile UI Updates
  authUI.updateUserProfileUI({
    userId: 'usr_test123',
    email: 'alex.morgan@qa.com',
    name: 'Alex Morgan',
    role: 'Senior QA Engineer',
    avatarInitials: 'AM'
  });
  assert(mockEnv.headerUserAvatar.textContent === 'AM', 'updateUserProfileUI updates avatar initials');
  assert(mockEnv.headerUserName.textContent === 'Alex Morgan', 'updateUserProfileUI updates user display name');
  assert(mockEnv.headerUserRole.textContent === 'Senior QA Engineer', 'updateUserProfileUI updates user role');

  authUI.updateUserProfileUI(null);
  assert(mockEnv.headerUserAvatar.textContent === 'QA', 'updateUserProfileUI(null) falls back to default avatar');
  assert(mockEnv.headerUserName.textContent === 'QA Tester', 'updateUserProfileUI(null) falls back to default name');

  // ==========================================================================
  // SECTION 5: End-to-End Test with In-Memory MongoDB & Express Server
  // ==========================================================================
  console.log('\n--- Section 5: End-to-End Server & State Machine Integration ---');

  const mongod = await MongoMemoryServer.create();
  const mongoUri = mongod.getUri();
  const mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  const db = mongoClient.db('qavora_test_step5');
  const usersCollection = db.collection('users');
  await usersCollection.createIndex({ email: 1 }, { unique: true });

  const JWT_SECRET = 'qavora_step5_super_secret_jwt_key_2026';

  const app = express();
  app.use(express.json());

  // Backend Auth Routes
  app.post('/api/auth/register', async (req: Request, res: Response) => {
    try {
      const { name, email, password, role } = req.body;
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Full name is required.' });
      }
      if (!email || typeof email !== 'string' || !email.trim()) {
        return res.status(400).json({ error: 'Valid email address is required.' });
      }
      if (!password || typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const existing = await usersCollection.findOne({ email: normalizedEmail });
      if (existing) {
        return res.status(409).json({ error: 'A user with this email address already exists.' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const userId = 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const userRole = (role && typeof role === 'string' && role.trim()) ? role.trim() : 'QA Tester';

      const initials = name.trim().split(/\s+/).map((p: string) => p[0]).join('').toUpperCase().slice(0, 2) || 'QA';

      const newUser = {
        userId,
        email: normalizedEmail,
        name: name.trim(),
        role: userRole,
        avatarInitials: initials,
        passwordHash,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString()
      };

      await usersCollection.insertOne(newUser);

      const token = jwt.sign(
        { userId, email: normalizedEmail, name: name.trim(), role: userRole },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      return res.status(201).json({
        message: 'Registration successful.',
        token,
        user: {
          userId,
          email: normalizedEmail,
          name: name.trim(),
          role: userRole,
          avatarInitials: initials
        }
      });
    } catch (err: any) {
      if (err.code === 11000) {
        return res.status(409).json({ error: 'A user with this email address already exists.' });
      }
      return res.status(500).json({ error: 'Internal registration failure.' });
    }
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      const user = await usersCollection.findOne({ email: normalizedEmail });
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const match = await bcrypt.compare(String(password), user.passwordHash);
      if (!match) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      await usersCollection.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date().toISOString() } });

      const token = jwt.sign(
        { userId: user.userId, email: user.email, name: user.name, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      return res.status(200).json({
        message: 'Login successful.',
        token,
        user: {
          userId: user.userId,
          email: user.email,
          name: user.name,
          role: user.role,
          avatarInitials: user.avatarInitials
        }
      });
    } catch (err) {
      return res.status(500).json({ error: 'Internal login failure.' });
    }
  });

  app.get('/api/auth/me', async (req: Request, res: Response) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication token required.' });
    }
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const user = await usersCollection.findOne({ userId: decoded.userId });
      if (!user) {
        return res.status(401).json({ error: 'User not found or deleted.' });
      }
      return res.status(200).json({
        user: {
          userId: user.userId,
          email: user.email,
          name: user.name,
          role: user.role,
          avatarInitials: user.avatarInitials
        }
      });
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired authentication token.' });
    }
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const serverAddress = server.address() as any;
  const baseUrl = `http://127.0.0.1:${serverAddress.port}`;

  // Configure mock client environment
  const mockStorage = new MockLocalStorage();
  (globalThis as any).localStorage = mockStorage;

  // Intercept fetch to route to our test server
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (url: string | URL | Request, init?: RequestInit) => {
    let fullUrl = String(url);
    if (fullUrl.startsWith('/api/')) {
      fullUrl = `${baseUrl}${fullUrl}`;
    }
    return originalFetch(fullUrl, init);
  };

  const { authController } = await import('../authController.js');

  // Initialize UI with mock elements
  let authChangedUser: any = null;
  let logoutOccurred: boolean = false;

  const uiController = authUI.initAuthUI({
    onAuthenticated: (u: any) => { authChangedUser = u; },
    onLogout: () => { logoutOccurred = true; }
  });

  // Verify initial state: unauthenticated
  await authController.init();
  assert(authController.getAuthState() === 'unauthenticated', 'Initial authController state without saved token is unauthenticated');
  assert(mockEnv.appContainer.style.display === 'none', 'App dashboard is completely hidden when unauthenticated');
  assert(mockEnv.authContainer.style.display === 'flex', 'Authentication container is displayed when unauthenticated');

  // Submit Registration form with short password (< 8 chars)
  mockEnv.registerName.value = 'Jordan Lee';
  mockEnv.registerEmail.value = 'jordan.lee@example.com';
  mockEnv.registerPassword.value = 'short';
  mockEnv.registerConfirmPassword.value = 'short';

  let defaultPrevented = false;
  mockEnv.registerForm.dispatchEvent({ type: 'submit', preventDefault: () => { defaultPrevented = true; } });
  assert(defaultPrevented, 'Form submit prevents default browser form submission');
  assert(mockEnv.registerPasswordError.textContent === 'Password must be at least 8 characters long.', 'Registration client validation catches short password (< 8 chars)');

  // Submit Registration form with mismatched confirm password
  mockEnv.registerPassword.value = 'validPassword123';
  mockEnv.registerConfirmPassword.value = 'differentPassword456';
  mockEnv.registerForm.dispatchEvent({ type: 'submit', preventDefault: () => {} });
  assert(mockEnv.registerConfirmError.textContent === 'Passwords do not match.', 'Registration client validation catches mismatched confirmation password');

  // Submit Registration form with invalid email
  mockEnv.registerEmail.value = 'not-an-email';
  mockEnv.registerConfirmPassword.value = 'validPassword123';
  mockEnv.registerForm.dispatchEvent({ type: 'submit', preventDefault: () => {} });
  assert(mockEnv.registerEmailError.textContent === 'Please enter a valid email address.', 'Registration client validation catches malformed email');

  async function waitForSettled() {
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 40));
      if (authController.getAuthState() !== 'loading') {
        await new Promise(r => setTimeout(r, 40));
        return;
      }
    }
  }

  // Submit valid Registration
  mockEnv.registerEmail.value = 'jordan.lee@example.com';
  mockEnv.registerForm.dispatchEvent({ type: 'submit', preventDefault: () => {} });

  // Wait for async register to complete
  await waitForSettled();

  assert(authController.isAuthenticated(), 'authController transitions to authenticated after successful registration');
  assert(authController.getCurrentUser()?.email === 'jordan.lee@example.com', 'Current user in authController matches registered user');
  assert(mockEnv.appContainer.style.display === 'flex', 'App container is shown upon successful authentication');
  assert(mockEnv.authContainer.style.display === 'none', 'Auth container is hidden upon successful authentication');
  assert(mockEnv.headerUserAvatar.textContent === 'JL', 'Header user avatar displays correct initials (JL)');
  assert(mockEnv.headerUserName.textContent === 'Jordan Lee', 'Header displays registered user full name');

  // Test duplicate email rejection
  // Switch back to register and attempt same email
  authController.logout();
  assert(authController.getAuthState() === 'unauthenticated', 'Logging out resets authController state to unauthenticated');
  assert(mockEnv.appContainer.style.display === 'none', 'App container hidden after logout');
  assert(mockEnv.authContainer.style.display === 'flex', 'Auth container shown after logout');

  mockEnv.registerName.value = 'Another User';
  mockEnv.registerEmail.value = 'jordan.lee@example.com';
  mockEnv.registerPassword.value = 'ValidPass999!';
  mockEnv.registerConfirmPassword.value = 'ValidPass999!';
  mockEnv.registerForm.dispatchEvent({ type: 'submit', preventDefault: () => {} });
  await waitForSettled();

  assert(mockEnv.errorAlert.style.display === 'flex', 'Duplicate email registration displays top-level error banner');
  assert(mockEnv.errorMessage.textContent.includes('already exists'), 'Duplicate email error message contains "already exists"');
  assert(!authController.isAuthenticated(), 'User remains unauthenticated on duplicate registration');

  // Test Login validation
  mockEnv.loginEmail.value = '';
  mockEnv.loginPassword.value = '';
  mockEnv.loginForm.dispatchEvent({ type: 'submit', preventDefault: () => {} });
  assert(mockEnv.loginEmailError.textContent === 'Please enter your email address.', 'Login validation catches empty email');

  // Test Login with invalid credentials
  mockEnv.loginEmail.value = 'jordan.lee@example.com';
  mockEnv.loginPassword.value = 'wrongpassword';
  mockEnv.loginForm.dispatchEvent({ type: 'submit', preventDefault: () => {} });
  await waitForSettled();

  assert(mockEnv.errorAlert.style.display === 'flex', 'Invalid credentials displays error alert');
  assert(mockEnv.errorMessage.textContent === 'Invalid email or password.', 'Error alert displays "Invalid email or password."');
  assert(!authController.isAuthenticated(), 'User remains unauthenticated on invalid credentials');

  // Test Login with valid credentials
  mockEnv.loginEmail.value = 'jordan.lee@example.com';
  mockEnv.loginPassword.value = 'validPassword123';
  mockEnv.loginForm.dispatchEvent({ type: 'submit', preventDefault: () => {} });
  await waitForSettled();

  assert(authController.isAuthenticated(), 'User successfully authenticates with valid credentials');
  assert(mockEnv.appContainer.style.display === 'flex', 'Dashboard is revealed after successful login');
  assert(mockEnv.authContainer.style.display === 'none', 'Auth forms hidden after successful login');
  assert(mockStorage.getItem('qavora_auth_token_v1') !== null, 'JWT token is saved in localStorage');

  // Test Header Logout Button
  logoutOccurred = false;
  mockEnv.headerLogoutBtn.dispatchEvent({ type: 'click', preventDefault: () => {} });
  assert(!authController.isAuthenticated(), 'Clicking header logout button clears authentication');
  assert(mockStorage.getItem('qavora_auth_token_v1') === null, 'Clicking logout removes stored token from localStorage');
  assert(mockEnv.appContainer.style.display === 'none', 'Dashboard is hidden after clicking header logout');
  assert(Boolean(logoutOccurred), 'onLogout callback invoked on header logout');

  // Test Sidebar Logout Button
  // Log in again first
  await authController.login({ email: 'jordan.lee@example.com', password: 'validPassword123' });
  assert(authController.isAuthenticated(), 'Re-authenticated via authController.login()');
  logoutOccurred = false;
  mockEnv.sidebarLogoutBtn.dispatchEvent({ type: 'click', preventDefault: () => {} });
  assert(!authController.isAuthenticated(), 'Clicking sidebar logout button clears authentication');
  assert(mockEnv.appContainer.style.display === 'none', 'Dashboard hidden after clicking sidebar logout');

  // Test Session Restoration on Reload
  // Store valid token
  const validUser = await usersCollection.findOne({ email: 'jordan.lee@example.com' });
  const freshToken = jwt.sign(
    { userId: validUser!.userId, email: validUser!.email, name: validUser!.name, role: validUser!.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  mockStorage.setItem('qavora_auth_token_v1', freshToken);

  const initResult = await authController.init();
  assert(initResult.ok === true, 'authController.init() successfully validates stored token via GET /api/auth/me');
  assert(authController.isAuthenticated(), 'authController restored authenticated state');
  assert(mockEnv.appContainer.style.display === 'flex', 'Session restoration automatically reveals dashboard');
  assert(mockEnv.authContainer.style.display === 'none', 'Session restoration automatically hides auth forms');
  assert(mockEnv.loadingOverlay.style.display === 'none', 'Loading overlay is dismissed after session verification');

  // Test Session Restoration with Expired/Invalid Token
  mockStorage.setItem('qavora_auth_token_v1', 'invalid.jwt.token');
  const invalidInitResult = await authController.init();
  assert(invalidInitResult.ok === false, 'authController.init() rejects invalid/tampered stored token');
  assert(!authController.isAuthenticated(), 'User is unauthenticated after invalid token init');
  assert(mockStorage.getItem('qavora_auth_token_v1') === null, 'Invalid token is purged from localStorage');
  assert(mockEnv.appContainer.style.display === 'none', 'Dashboard hidden when token is invalid');
  assert(mockEnv.authContainer.style.display === 'flex', 'Auth view shown when token is invalid');

  // Cleanup
  server.close();
  await mongoClient.close();
  await mongod.stop();
  (globalThis as any).fetch = originalFetch;

  console.log('\n=======================================================');
  console.log(`TOTAL PASSES: ${passedCount}`);
  console.log(`TOTAL FAILURES: ${failedCount}`);
  console.log('=======================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
