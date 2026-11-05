/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Centralized Frontend Authentication Controller
 * Manages JWT tokens, authenticated user state, and auth lifecycle.
 */

// ============================================================================
// Storage & Constants
// ============================================================================
export const CSRF_COOKIE_NAME = 'qavora_csrf_token';

function getCsrfTokenFromCookie() {
  try {
    if (typeof document !== 'undefined' && typeof document.cookie === 'string') {
      const pairs = document.cookie.split(';');
      for (const pair of pairs) {
        const idx = pair.indexOf('=');
        if (idx > 0 && pair.slice(0, idx).trim() === CSRF_COOKIE_NAME) {
          return decodeURIComponent(pair.slice(idx + 1).trim());
        }
      }
    }
  } catch (err) {
    // Ignore cookie access errors
  }
  return null;
}

function clearLegacyStoredToken() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('qavora_auth_token_v1');
    }
  } catch (err) {
    // Ignore storage access errors
  }
}

// ============================================================================
// Auth Controller State
// ============================================================================
// Valid states: 'loading' | 'authenticated' | 'unauthenticated'
let _state = 'unauthenticated';
let _user = null;
let _initPromise = null;
const _listeners = new Set();

function _notifyListeners() {
  const snapshot = {
    state: _state,
    user: _user ? { ..._user } : null,
    isAuthenticated: _state === 'authenticated' && Boolean(_user)
  };

  _listeners.forEach(listener => {
    try {
      listener(snapshot);
    } catch (err) {
      console.warn('Qavora: Error in auth listener callback', err);
    }
  });
}

// ============================================================================
// Auth Controller API
// ============================================================================
export const authController = {
  /**
   * Current authentication state ('loading' | 'authenticated' | 'unauthenticated')
   */
  getAuthState() {
    return _state;
  },

  /**
   * Returns a copy of the current safe user profile or null
   */
  getCurrentUser() {
    return _user ? { ..._user } : null;
  },

  /**
   * Alias for getCurrentUser()
   */
  getUser() {
    return this.getCurrentUser();
  },

  getToken() {
    return null;
  },

  getCsrfToken() {
    return getCsrfTokenFromCookie();
  },

  /**
   * True if user is fully authenticated with a valid session & user profile
   */
  isAuthenticated() {
    return _state === 'authenticated' && Boolean(_user);
  },

  /**
   * True if auth state is currently initializing or processing a request
   */
  isLoading() {
    return _state === 'loading';
  },

  /**
   * Attach CSRF headers to an options object or headers object
   */
  getAuthHeaders(customHeaders = {}) {
    const headers = { ...customHeaders };
    const csrf = getCsrfTokenFromCookie();
    if (csrf && !headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
      headers['X-CSRF-Token'] = csrf;
    }
    return headers;
  },

  /**
   * Set or override current session
   */
  setSession(session) {
    if (session && session.user) {
      _user = session.user;
      _state = 'authenticated';
    } else {
      _user = null;
      _state = 'unauthenticated';
    }
    _notifyListeners();
  },

  /**
   * Subscribe to authentication state changes.
   * Immediately calls the listener with the current state snapshot.
   * Returns an unsubscribe function.
   */
  onAuthStateChanged(listener) {
    if (typeof listener !== 'function') return () => {};
    _listeners.add(listener);

    // Initial notification for the new subscriber
    try {
      listener({
        state: _state,
        user: _user ? { ..._user } : null,
        isAuthenticated: this.isAuthenticated()
      });
    } catch (err) {
      console.warn('Qavora: Error in initial auth listener invocation', err);
    }

    return () => {
      _listeners.delete(listener);
    };
  },

  /**
   * Subscribe alias for onAuthStateChanged
   */
  subscribe(listener) {
    return this.onAuthStateChanged(listener);
  },

  /**
   * Restore token from persistent storage and verify session with GET /api/auth/me
   */
  async init() {
    if (_initPromise) {
      return _initPromise;
    }

    clearLegacyStoredToken();
    _state = 'loading';
    _notifyListeners();

    _initPromise = (async () => {
      try {
        const response = await fetch('/api/auth/me', {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Accept': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json().catch(() => null);
          if (data && data.user) {
            _user = data.user;
            _state = 'authenticated';
            _notifyListeners();
            return {
              ok: true,
              state: _state,
              user: _user
            };
          }
        }

        _user = null;
        _state = 'unauthenticated';
        _notifyListeners();
        return {
          ok: false,
          state: _state,
          user: null
        };
      } catch (networkErr) {
        console.warn('Qavora: Could not reach /api/auth/me during initialization', networkErr.message);
        // Do not prematurely wipe valid stored token if server or network is temporarily offline
        _state = 'unauthenticated';
        _notifyListeners();
        return {
          ok: false,
          state: _state,
          user: null,
          token: _token,
          isOffline: true
        };
      } finally {
        _initPromise = null;
      }
    })();

    return _initPromise;
  },

  /**
   * Log in user via POST /api/auth/login
   * Supports login({ email, password }) or login(email, password)
   */
  async login(credentialsOrEmail, optionalPassword) {
    let email = '';
    let password = '';

    if (credentialsOrEmail && typeof credentialsOrEmail === 'object') {
      email = credentialsOrEmail.email || '';
      password = credentialsOrEmail.password || '';
    } else {
      email = credentialsOrEmail || '';
      password = optionalPassword || '';
    }

    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return {
        ok: false,
        status: 400,
        error: 'Email and password are required.'
      };
    }

    _state = 'loading';
    _notifyListeners();

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password
        })
      });

      const data = await response.json().catch(() => null);

      if (response.ok && data && data.user) {
        _user = data.user;
        _state = 'authenticated';
        _notifyListeners();
        return {
          ok: true,
          status: response.status,
          user: _user
        };
      }

      // Login failed
      _user = null;
      _state = 'unauthenticated';
      _notifyListeners();

      return {
        ok: false,
        status: response.status,
        error: (data && data.error) ? data.error : 'Invalid email or password.'
      };
    } catch (networkErr) {
      _token = null;
      _user = null;
      _state = 'unauthenticated';
      _notifyListeners();

      return {
        ok: false,
        status: 0,
        error: networkErr.message || 'Unable to connect to authentication server.'
      };
    }
  },

  /**
   * Register a new user via POST /api/auth/register
   * Supports register({ name, email, password, role }) or register(name, email, password, role)
   */
  async register(payloadOrName, optionalEmail, optionalPassword, optionalRole) {
    let name = '';
    let email = '';
    let password = '';
    let role = 'QA Tester';

    if (payloadOrName && typeof payloadOrName === 'object') {
      name = payloadOrName.name || '';
      email = payloadOrName.email || '';
      password = payloadOrName.password || '';
      role = payloadOrName.role || 'QA Tester';
    } else {
      name = payloadOrName || '';
      email = optionalEmail || '';
      password = optionalPassword || '';
      role = optionalRole || 'QA Tester';
    }

    if (typeof name !== 'string' || !name.trim()) {
      return {
        ok: false,
        status: 400,
        error: 'Full name is required.'
      };
    }

    if (typeof email !== 'string' || !email.trim()) {
      return {
        ok: false,
        status: 400,
        error: 'Valid email address is required.'
      };
    }

    if (typeof password !== 'string' || password.length < 8) {
      return {
        ok: false,
        status: 400,
        error: 'Password must be at least 8 characters long.'
      };
    }

    _state = 'loading';
    _notifyListeners();

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          role: (typeof role === 'string' && role.trim()) ? role.trim() : 'QA Tester'
        })
      });

      const data = await response.json().catch(() => null);

      if (response.ok && data && data.user) {
        _user = data.user;
        _state = 'authenticated';
        _notifyListeners();
        return {
          ok: true,
          status: response.status,
          user: _user
        };
      }

      // Registration failed
      _user = null;
      _state = 'unauthenticated';
      _notifyListeners();

      return {
        ok: false,
        status: response.status,
        error: (data && data.error) ? data.error : 'Registration failed.'
      };
    } catch (networkErr) {
      _token = null;
      _user = null;
      _state = 'unauthenticated';
      _notifyListeners();

      return {
        ok: false,
        status: 0,
        error: networkErr.message || 'Unable to connect to authentication server.'
      };
    }
  },

  /**
   * Log out the current user: clears in-memory state and persistent token
   */
  async logout() {
    clearLegacyStoredToken();
    try {
      const csrf = getCsrfTokenFromCookie();
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          ...(csrf ? { 'X-CSRF-Token': csrf } : {})
        }
      });
    } catch (err) {
      // Ignore network errors during logout
    }
    _user = null;
    _state = 'unauthenticated';
    _notifyListeners();
    return { ok: true };
  },

  /**
   * Called when any API call receives HTTP 401 Unauthorized.
   * Clears invalid session and resets state without looping.
   */
  handleUnauthorized() {
    const wasActive = Boolean(_user || _state !== 'unauthenticated');
    clearLegacyStoredToken();
    _user = null;
    _state = 'unauthenticated';

    if (wasActive) {
      _notifyListeners();
    }
  },

  /**
   * Reusable authenticated fetch wrapper that sends HttpOnly cookies, injects CSRF token, and intercepts 401
   */
  async authenticatedFetch(url, options = {}) {
    const headers = {
      ...(options.headers || {})
    };

    const method = (options.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const csrf = getCsrfTokenFromCookie();
      if (csrf && !headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
        headers['X-CSRF-Token'] = csrf;
      }
    }

    try {
      const response = await fetch(url, {
        credentials: 'include',
        ...options,
        headers
      });

      if (response.status === 401) {
        this.handleUnauthorized();
      }

      return response;
    } catch (err) {
      throw err;
    }
  }
};

// Expose on global window object if available in browser
if (typeof window !== 'undefined') {
  window.QavoraAuth = authController;
} else if (typeof globalThis !== 'undefined') {
  globalThis.QavoraAuth = authController;
}

export default authController;
