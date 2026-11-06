/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Qavora — Centralized API Client Module (SEC-002 / CQ-003)
 * Handles HttpOnly cookie credentials, CSRF token injection, and 401 interception.
 */

import authController from '../../authController.js';

export async function apiFetch(url, options = {}) {
  const headers = {
    'Accept': 'application/json',
    ...(options.headers || {})
  };

  const reqMethod = (options.method || 'GET').toUpperCase();
  if (
    reqMethod !== 'GET' &&
    reqMethod !== 'HEAD' &&
    reqMethod !== 'OPTIONS' &&
    typeof authController !== 'undefined' &&
    typeof authController.getCsrfToken === 'function'
  ) {
    const csrf = authController.getCsrfToken();
    if (csrf && !headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
      headers['X-CSRF-Token'] = csrf;
    }
  }

  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  let response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      credentials: 'include',
      ...options,
      headers
    });
  } catch (err) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('qavora:db-status-change', { detail: { database: 'disconnected' } }));
    }
    const networkError = new Error(err?.message || 'Network request failed (offline or server unreachable).');
    networkError.name = 'NetworkError';
    networkError.isNetworkError = true;
    networkError.cause = err;
    throw networkError;
  }

  if (response.status === 401 && typeof authController !== 'undefined' && typeof authController.handleUnauthorized === 'function') {
    authController.handleUnauthorized();
  }

  if (response.status === 503 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('qavora:db-status-change', { detail: { database: 'disconnected' } }));
  }

  return response;
}

export async function apiJson(url, options = {}) {
  try {
    const response = await apiFetch(url, options);
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data, response };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: { error: err?.message || 'Network request failed (offline or server unreachable).' },
      response: null,
      isNetworkError: Boolean(err?.isNetworkError)
    };
  }
}

export async function checkBackendHealth() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store', credentials: 'include' });
    if (!res.ok) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('qavora:db-status-change', { detail: { database: 'disconnected' } }));
      }
      return { ok: false, database: 'disconnected' };
    }
    const data = await res.json().catch(() => ({}));
    const dbStatus = data.database === 'connected' ? 'connected' : 'disconnected';
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('qavora:db-status-change', { detail: { database: dbStatus } }));
    }
    return { ok: Boolean(data.success), database: data.database || 'unknown' };
  } catch {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('qavora:db-status-change', { detail: { database: 'disconnected' } }));
    }
    return { ok: false, database: 'disconnected' };
  }
}
