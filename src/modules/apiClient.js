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

  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'include',
    ...options,
    headers
  });

  if (response.status === 401 && typeof authController !== 'undefined' && typeof authController.handleUnauthorized === 'function') {
    authController.handleUnauthorized();
  }

  return response;
}

export async function apiJson(url, options = {}) {
  const response = await apiFetch(url, options);
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data, response };
}

export async function checkBackendHealth() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store', credentials: 'include' });
    if (!res.ok) return { ok: false, database: 'disconnected' };
    const data = await res.json().catch(() => ({}));
    return { ok: Boolean(data.success), database: data.database || 'unknown' };
  } catch {
    return { ok: false, database: 'disconnected' };
  }
}
