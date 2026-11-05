/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Authentication UI Controller
 * Phase 4, Step 5: Responsive Login & Registration Experience
 */

import { authController } from './authController.js';

// Email validation regular expression
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * References to DOM elements cached upon initialization
 */
let DOM = null;

function getElements() {
  if (typeof document === 'undefined') return null;

  return {
    // Top-level containers
    loadingOverlay: document.getElementById('auth-loading-overlay'),
    authContainer: document.getElementById('auth-container'),
    appContainer: document.getElementById('app-container'),

    // Switcher Tabs
    tabLogin: document.getElementById('auth-tab-login'),
    tabRegister: document.getElementById('auth-tab-register'),

    // Panels
    panelLogin: document.getElementById('auth-login-panel'),
    panelRegister: document.getElementById('auth-register-panel'),

    // Switch links
    switchToRegisterLink: document.getElementById('switch-to-register-link'),
    switchToLoginLink: document.getElementById('switch-to-login-link'),

    // Alerts
    errorAlert: document.getElementById('auth-error-alert'),
    errorMessage: document.getElementById('auth-error-message'),
    successAlert: document.getElementById('auth-success-alert'),
    successMessage: document.getElementById('auth-success-message'),

    // Login Form Elements
    loginForm: document.getElementById('auth-login-form'),
    loginEmail: document.getElementById('login-email'),
    loginEmailError: document.getElementById('login-email-error'),
    loginPassword: document.getElementById('login-password'),
    loginPasswordError: document.getElementById('login-password-error'),
    loginPasswordToggle: document.getElementById('login-password-toggle'),
    loginSubmitBtn: document.getElementById('login-submit-btn'),

    // Register Form Elements
    registerForm: document.getElementById('auth-register-form'),
    registerName: document.getElementById('register-name'),
    registerNameError: document.getElementById('register-name-error'),
    registerEmail: document.getElementById('register-email'),
    registerEmailError: document.getElementById('register-email-error'),
    registerPassword: document.getElementById('register-password'),
    registerPasswordError: document.getElementById('register-password-error'),
    registerPasswordToggle: document.getElementById('register-password-toggle'),
    registerConfirmPassword: document.getElementById('register-confirm-password'),
    registerConfirmError: document.getElementById('register-confirm-error'),
    registerConfirmPasswordToggle: document.getElementById('register-confirm-password-toggle'),
    registerSubmitBtn: document.getElementById('register-submit-btn'),

    // Profile & Logout in main app
    headerUserProfileWrapper: document.getElementById('header-user-profile-wrapper'),
    headerUserProfileBtn: document.getElementById('header-user-profile-btn'),
    accountDropdownMenu: document.getElementById('account-dropdown-menu'),
    accountDropdownAvatar: document.getElementById('account-dropdown-avatar'),
    accountDropdownName: document.getElementById('account-dropdown-name'),
    accountDropdownEmail: document.getElementById('account-dropdown-email'),
    accountDropdownRole: document.getElementById('account-dropdown-role'),
    accountMenuLogoutBtn: document.getElementById('account-menu-logout-btn'),
    accountMenuSettingsBtn: document.getElementById('account-menu-settings-btn'),
    accountMenuDataBtn: document.getElementById('account-menu-data-btn'),
    headerUserAvatar: document.getElementById('header-user-avatar'),
    headerUserName: document.getElementById('header-user-name'),
    headerUserRole: document.getElementById('header-user-role'),
    headerLogoutBtn: document.getElementById('header-logout-btn'),
    sidebarLogoutBtn: document.getElementById('sidebar-logout-btn')
  };
}

/**
 * Toggle password input between 'password' and 'text'
 */
export function togglePasswordVisibility(inputEl, toggleBtn) {
  if (!inputEl || !toggleBtn) return;

  const isPassword = inputEl.type === 'password';
  inputEl.type = isPassword ? 'text' : 'password';

  toggleBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');

  const eyeIcon = toggleBtn.querySelector('.icon-eye');
  const eyeOffIcon = toggleBtn.querySelector('.icon-eye-off');

  if (eyeIcon && eyeOffIcon) {
    eyeIcon.style.display = isPassword ? 'none' : 'block';
    eyeOffIcon.style.display = isPassword ? 'block' : 'none';
  }
}

/**
 * Display top-level error alert
 */
export function showAuthError(message) {
  const dom = DOM || getElements();
  if (!dom || !dom.errorAlert || !dom.errorMessage) return;

  dom.errorMessage.textContent = message || 'An unexpected error occurred.';
  dom.errorAlert.style.display = 'flex';

  if (dom.successAlert) {
    dom.successAlert.style.display = 'none';
  }
}

/**
 * Display top-level success alert
 */
export function showAuthSuccess(message) {
  const dom = DOM || getElements();
  if (!dom || !dom.successAlert || !dom.successMessage) return;

  dom.successMessage.textContent = message || 'Success!';
  dom.successAlert.style.display = 'flex';

  if (dom.errorAlert) {
    dom.errorAlert.style.display = 'none';
  }
}

/**
 * Clear top-level alert banners
 */
export function clearAuthAlerts() {
  const dom = DOM || getElements();
  if (!dom) return;

  if (dom.errorAlert) dom.errorAlert.style.display = 'none';
  if (dom.errorMessage) dom.errorMessage.textContent = '';
  if (dom.successAlert) dom.successAlert.style.display = 'none';
  if (dom.successMessage) dom.successMessage.textContent = '';
}

/**
 * Display inline validation error on a specific form input field
 */
export function showFieldError(inputEl, errorEl, message) {
  if (inputEl) {
    if (inputEl.classList && typeof inputEl.classList.add === 'function') {
      inputEl.classList.add('input-error');
    }
    if (typeof inputEl.setAttribute === 'function') {
      inputEl.setAttribute('aria-invalid', 'true');
    }
  }
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }
}

/**
 * Clear inline validation error from an input field
 */
export function clearFieldError(inputEl, errorEl) {
  if (inputEl) {
    if (inputEl.classList && typeof inputEl.classList.remove === 'function') {
      inputEl.classList.remove('input-error');
    }
    if (typeof inputEl.removeAttribute === 'function') {
      inputEl.removeAttribute('aria-invalid');
    }
  }
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.style.display = 'none';
  }
}

/**
 * Clear all field validation errors across all auth forms
 */
export function clearAllFieldErrors() {
  const dom = DOM || getElements();
  if (!dom) return;

  clearFieldError(dom.loginEmail, dom.loginEmailError);
  clearFieldError(dom.loginPassword, dom.loginPasswordError);
  clearFieldError(dom.registerName, dom.registerNameError);
  clearFieldError(dom.registerEmail, dom.registerEmailError);
  clearFieldError(dom.registerPassword, dom.registerPasswordError);
  clearFieldError(dom.registerConfirmPassword, dom.registerConfirmError);
}

/**
 * Switch active authentication panel ('login' or 'register')
 */
export function switchAuthTab(tabName = 'login') {
  const dom = DOM || getElements();
  if (!dom) return;

  clearAuthAlerts();
  clearAllFieldErrors();

  const isLogin = tabName === 'login';

  if (dom.tabLogin) {
    dom.tabLogin.classList.toggle('active', isLogin);
    dom.tabLogin.setAttribute('aria-selected', isLogin ? 'true' : 'false');
  }

  if (dom.tabRegister) {
    dom.tabRegister.classList.toggle('active', !isLogin);
    dom.tabRegister.setAttribute('aria-selected', !isLogin ? 'true' : 'false');
  }

  if (dom.panelLogin) {
    dom.panelLogin.style.display = isLogin ? 'block' : 'none';
  }

  if (dom.panelRegister) {
    dom.panelRegister.style.display = !isLogin ? 'block' : 'none';
  }

  // Set focus on primary field
  if (isLogin && dom.loginEmail) {
    dom.loginEmail.focus();
  } else if (!isLogin && dom.registerName) {
    dom.registerName.focus();
  }
}

/**
 * Reset sensitive form fields and errors
 */
export function resetAuthForms() {
  const dom = DOM || getElements();
  if (!dom) return;

  clearAuthAlerts();
  clearAllFieldErrors();

  if (dom.loginForm) dom.loginForm.reset();
  if (dom.registerForm) dom.registerForm.reset();

  // Reset password visibility toggles back to masked password
  if (dom.loginPassword && dom.loginPasswordToggle) {
    dom.loginPassword.type = 'password';
    dom.loginPasswordToggle.setAttribute('aria-label', 'Show password');
    const eye = dom.loginPasswordToggle.querySelector('.icon-eye');
    const eyeOff = dom.loginPasswordToggle.querySelector('.icon-eye-off');
    if (eye) eye.style.display = 'block';
    if (eyeOff) eyeOff.style.display = 'none';
  }

  if (dom.registerPassword && dom.registerPasswordToggle) {
    dom.registerPassword.type = 'password';
    dom.registerPasswordToggle.setAttribute('aria-label', 'Show password');
    const eye = dom.registerPasswordToggle.querySelector('.icon-eye');
    const eyeOff = dom.registerPasswordToggle.querySelector('.icon-eye-off');
    if (eye) eye.style.display = 'block';
    if (eyeOff) eyeOff.style.display = 'none';
  }

  if (dom.registerConfirmPassword && dom.registerConfirmPasswordToggle) {
    dom.registerConfirmPassword.type = 'password';
    dom.registerConfirmPasswordToggle.setAttribute('aria-label', 'Show password confirmation');
    const eye = dom.registerConfirmPasswordToggle.querySelector('.icon-eye');
    const eyeOff = dom.registerConfirmPasswordToggle.querySelector('.icon-eye-off');
    if (eye) eye.style.display = 'block';
    if (eyeOff) eyeOff.style.display = 'none';
  }

  // Reset button loading states
  setButtonLoading(dom.loginSubmitBtn, false, 'Sign In');
  setButtonLoading(dom.registerSubmitBtn, false, 'Create Account');
}

/**
 * Set button loading state (spinner + disabled)
 */
function setButtonLoading(buttonEl, isLoading, defaultText) {
  if (!buttonEl) return;

  buttonEl.disabled = Boolean(isLoading);

  const spinner = buttonEl.querySelector('.auth-btn-spinner');
  const textSpan = buttonEl.querySelector('.auth-btn-text');

  if (spinner) {
    spinner.style.display = isLoading ? 'inline-block' : 'none';
  }

  if (textSpan) {
    textSpan.textContent = isLoading ? 'Processing...' : defaultText;
  }
}

/**
 * Show or hide initial session loading overlay
 */
export function setLoadingOverlay(visible) {
  const dom = DOM || getElements();
  if (!dom) return;

  if (visible) {
    if (dom.loadingOverlay) {
      dom.loadingOverlay.style.setProperty('display', 'flex', 'important');
      dom.loadingOverlay.classList.remove('auth-hidden');
      dom.loadingOverlay.setAttribute('aria-busy', 'true');
    }
    if (dom.appContainer) {
      dom.appContainer.style.setProperty('display', 'none', 'important');
      dom.appContainer.classList.add('app-hidden');
    }
    if (dom.authContainer) {
      dom.authContainer.style.setProperty('display', 'none', 'important');
      dom.authContainer.classList.add('auth-hidden');
    }
    if (typeof document !== 'undefined') {
      document.body.classList.add('auth-view-active');
    }
  } else {
    if (dom.loadingOverlay) {
      dom.loadingOverlay.style.setProperty('display', 'none', 'important');
      dom.loadingOverlay.classList.add('auth-hidden');
      dom.loadingOverlay.setAttribute('aria-busy', 'false');
    }
  }
}

/**
 * Show the authentication card view and hide the main application dashboard
 */
export function showAuthView(tab = 'login') {
  const dom = DOM || getElements();
  if (!dom) return;

  if (dom.loadingOverlay) {
    dom.loadingOverlay.style.setProperty('display', 'none', 'important');
    dom.loadingOverlay.classList.add('auth-hidden');
    dom.loadingOverlay.setAttribute('aria-busy', 'false');
  }
  if (dom.appContainer) {
    dom.appContainer.style.setProperty('display', 'none', 'important');
    dom.appContainer.classList.add('app-hidden');
  }
  if (typeof document !== 'undefined') {
    document.body.classList.add('auth-view-active');
  }
  if (dom.authContainer) {
    dom.authContainer.classList.remove('auth-hidden');
    dom.authContainer.style.setProperty('display', 'flex', 'important');
  }

  switchAuthTab(tab);
}

/**
 * Hide the authentication card view and display the main application dashboard
 */
export function hideAuthView() {
  const dom = DOM || getElements();
  if (!dom) return;

  if (dom.loadingOverlay) {
    dom.loadingOverlay.style.setProperty('display', 'none', 'important');
    dom.loadingOverlay.classList.add('auth-hidden');
    dom.loadingOverlay.setAttribute('aria-busy', 'false');
  }
  if (dom.authContainer) {
    dom.authContainer.style.setProperty('display', 'none', 'important');
    dom.authContainer.classList.add('auth-hidden');
  }
  if (typeof document !== 'undefined') {
    document.body.classList.remove('auth-view-active');
  }
  if (dom.appContainer) {
    dom.appContainer.classList.remove('app-hidden');
    dom.appContainer.style.removeProperty('display');
  }
}

/**
 * Update authenticated user profile display in top-bar header and account dropdown
 */
export function updateUserProfileUI(user) {
  const dom = DOM || getElements();
  if (!dom) return;

  if (!user) {
    if (dom.headerUserAvatar) dom.headerUserAvatar.textContent = 'QA';
    if (dom.headerUserName) dom.headerUserName.textContent = 'QA Tester';
    if (dom.headerUserRole) dom.headerUserRole.textContent = 'Manual QA';
    if (dom.accountDropdownAvatar) dom.accountDropdownAvatar.textContent = 'QA';
    if (dom.accountDropdownName) dom.accountDropdownName.textContent = 'QA Tester';
    if (dom.accountDropdownEmail) dom.accountDropdownEmail.textContent = 'tester@qavora.internal';
    if (dom.accountDropdownRole) dom.accountDropdownRole.textContent = 'Manual QA';
    return;
  }

  const initials = user.avatarInitials || (user.name ? user.name.slice(0, 2).toUpperCase() : 'QA');
  const displayName = user.name || user.email || 'QA Tester';
  const roleTitle = user.role || 'QA Lead';
  const emailAddr = user.email || `${user.username || 'user'}@qavora.internal`;

  if (dom.headerUserAvatar) dom.headerUserAvatar.textContent = initials;
  if (dom.headerUserName) dom.headerUserName.textContent = displayName;
  if (dom.headerUserRole) dom.headerUserRole.textContent = roleTitle;

  if (dom.accountDropdownAvatar) dom.accountDropdownAvatar.textContent = initials;
  if (dom.accountDropdownName) dom.accountDropdownName.textContent = displayName;
  if (dom.accountDropdownEmail) dom.accountDropdownEmail.textContent = emailAddr;
  if (dom.accountDropdownRole) dom.accountDropdownRole.textContent = roleTitle;
}

/**
 * Main initializer for Authentication UI
 */
export function initAuthUI(options = {}) {
  DOM = getElements();
  if (!DOM) return;

  const { onAuthenticated, onLogout } = options;

  // 1. Password Visibility Toggles
  if (DOM.loginPasswordToggle && DOM.loginPassword) {
    DOM.loginPasswordToggle.addEventListener('click', (e) => {
      e.preventDefault();
      togglePasswordVisibility(DOM.loginPassword, DOM.loginPasswordToggle);
    });
  }

  if (DOM.registerPasswordToggle && DOM.registerPassword) {
    DOM.registerPasswordToggle.addEventListener('click', (e) => {
      e.preventDefault();
      togglePasswordVisibility(DOM.registerPassword, DOM.registerPasswordToggle);
    });
  }

  if (DOM.registerConfirmPasswordToggle && DOM.registerConfirmPassword) {
    DOM.registerConfirmPasswordToggle.addEventListener('click', (e) => {
      e.preventDefault();
      togglePasswordVisibility(DOM.registerConfirmPassword, DOM.registerConfirmPasswordToggle);
    });
  }

  // 2. Tab Navigation
  if (DOM.tabLogin) {
    DOM.tabLogin.addEventListener('click', () => switchAuthTab('login'));
  }

  if (DOM.tabRegister) {
    DOM.tabRegister.addEventListener('click', () => switchAuthTab('register'));
  }

  if (DOM.switchToRegisterLink) {
    DOM.switchToRegisterLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthTab('register');
    });
  }

  if (DOM.switchToLoginLink) {
    DOM.switchToLoginLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthTab('login');
    });
  }

  // 3. Clear errors upon typing
  const bindInputClearing = (inputEl, errorEl) => {
    if (!inputEl) return;
    inputEl.addEventListener('input', () => {
      clearFieldError(inputEl, errorEl);
      if (DOM.errorAlert && DOM.errorAlert.style.display !== 'none') {
        clearAuthAlerts();
      }
    });
  };

  bindInputClearing(DOM.loginEmail, DOM.loginEmailError);
  bindInputClearing(DOM.loginPassword, DOM.loginPasswordError);
  bindInputClearing(DOM.registerName, DOM.registerNameError);
  bindInputClearing(DOM.registerEmail, DOM.registerEmailError);
  bindInputClearing(DOM.registerPassword, DOM.registerPasswordError);
  bindInputClearing(DOM.registerConfirmPassword, DOM.registerConfirmError);

  // 4. Login Form Submission
  if (DOM.loginForm) {
    DOM.loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthAlerts();
      clearAllFieldErrors();

      const email = (DOM.loginEmail ? DOM.loginEmail.value : '').trim();
      const password = DOM.loginPassword ? DOM.loginPassword.value : '';

      let hasError = false;

      if (!email) {
        showFieldError(DOM.loginEmail, DOM.loginEmailError, 'Please enter your email address.');
        hasError = true;
      } else if (!EMAIL_REGEX.test(email)) {
        showFieldError(DOM.loginEmail, DOM.loginEmailError, 'Please enter a valid email address.');
        hasError = true;
      }

      if (!password) {
        showFieldError(DOM.loginPassword, DOM.loginPasswordError, 'Please enter your password.');
        hasError = true;
      }

      if (hasError) return;

      setButtonLoading(DOM.loginSubmitBtn, true, 'Sign In');

      try {
        const result = await authController.login({ email, password });

        if (!result.ok) {
          setButtonLoading(DOM.loginSubmitBtn, false, 'Sign In');
          showAuthError(result.error || 'Invalid email or password.');
          if (DOM.loginPassword) DOM.loginPassword.focus();
        } else {
          // Success: reset forms and transition to app
          resetAuthForms();
          hideAuthView();
          updateUserProfileUI(result.user);
          if (typeof onAuthenticated === 'function') {
            onAuthenticated(result.user);
          }
        }
      } catch (err) {
        setButtonLoading(DOM.loginSubmitBtn, false, 'Sign In');
        showAuthError('Unable to connect to authentication server. Please try again.');
      }
    });
  }

  // 5. Registration Form Submission
  if (DOM.registerForm) {
    DOM.registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthAlerts();
      clearAllFieldErrors();

      const name = (DOM.registerName ? DOM.registerName.value : '').trim();
      const email = (DOM.registerEmail ? DOM.registerEmail.value : '').trim();
      const password = DOM.registerPassword ? DOM.registerPassword.value : '';
      const confirmPassword = DOM.registerConfirmPassword ? DOM.registerConfirmPassword.value : '';

      let hasError = false;

      if (!name) {
        showFieldError(DOM.registerName, DOM.registerNameError, 'Please enter your full name.');
        hasError = true;
      }

      if (!email) {
        showFieldError(DOM.registerEmail, DOM.registerEmailError, 'Please enter your work email.');
        hasError = true;
      } else if (!EMAIL_REGEX.test(email)) {
        showFieldError(DOM.registerEmail, DOM.registerEmailError, 'Please enter a valid email address.');
        hasError = true;
      }

      if (!password) {
        showFieldError(DOM.registerPassword, DOM.registerPasswordError, 'Please enter a password.');
        hasError = true;
      } else if (password.length < 8) {
        showFieldError(DOM.registerPassword, DOM.registerPasswordError, 'Password must be at least 8 characters long.');
        hasError = true;
      }

      if (!confirmPassword) {
        showFieldError(DOM.registerConfirmPassword, DOM.registerConfirmError, 'Please confirm your password.');
        hasError = true;
      } else if (password !== confirmPassword) {
        showFieldError(DOM.registerConfirmPassword, DOM.registerConfirmError, 'Passwords do not match.');
        hasError = true;
      }

      if (hasError) return;

      setButtonLoading(DOM.registerSubmitBtn, true, 'Create Account');

      try {
        const result = await authController.register({ name, email, password });

        if (!result.ok) {
          setButtonLoading(DOM.registerSubmitBtn, false, 'Create Account');
          showAuthError(result.error || 'Registration failed. Please try again.');
        } else {
          // Success: reset forms and transition to app
          resetAuthForms();
          hideAuthView();
          updateUserProfileUI(result.user);
          if (typeof onAuthenticated === 'function') {
            onAuthenticated(result.user);
          }
        }
      } catch (err) {
        setButtonLoading(DOM.registerSubmitBtn, false, 'Create Account');
        showAuthError('Unable to connect to authentication server. Please try again.');
      }
    });
  }

  // 6. Logout Buttons (Header & Sidebar)
  const handleLogoutAction = (e) => {
    if (e) e.preventDefault();
    authController.logout();
    resetAuthForms();
    showAuthView('login');
    updateUserProfileUI(null);

    if (typeof onLogout === 'function') {
      onLogout();
    }
  };

  if (DOM.headerLogoutBtn) {
    DOM.headerLogoutBtn.addEventListener('click', handleLogoutAction);
  }

  if (DOM.sidebarLogoutBtn) {
    DOM.sidebarLogoutBtn.addEventListener('click', handleLogoutAction);
  }

  if (DOM.accountMenuLogoutBtn) {
    DOM.accountMenuLogoutBtn.addEventListener('click', handleLogoutAction);
  }

  // 7. Subscribe to authController state transitions
  authController.onAuthStateChanged((snapshot) => {
    if (snapshot.state === 'loading') {
      setLoadingOverlay(true);
    } else if (snapshot.isAuthenticated && snapshot.user) {
      setLoadingOverlay(false);
      hideAuthView();
      updateUserProfileUI(snapshot.user);
    } else {
      // Unauthenticated
      setLoadingOverlay(false);
      resetAuthForms();
      showAuthView('login');
      updateUserProfileUI(null);
    }
  });

  return {
    DOM,
    switchAuthTab,
    showAuthError,
    showAuthSuccess,
    clearAuthAlerts,
    resetAuthForms,
    showAuthView,
    hideAuthView,
    setLoadingOverlay,
    updateUserProfileUI,
    handleLogout: handleLogoutAction
  };
}
