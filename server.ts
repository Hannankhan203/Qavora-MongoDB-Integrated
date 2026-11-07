import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import dns from 'dns/promises';
import net from 'net';
import { fileURLToPath } from 'url';
import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Enable reverse proxy trust (default 1 hop) for accurate client IP identification on Cloud Run, Vercel, and Render
function resolveTrustProxy(): number | boolean | string {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) return 1;
  if (raw.toLowerCase() === 'false' || raw === '0') return false;
  if (raw.toLowerCase() === 'true') {
    console.warn('[Qavora Server] TRUST_PROXY=true is insecure; falling back to 1 hop.');
    return 1;
  }
  const num = Number(raw);
  if (Number.isInteger(num) && num > 0) return num;
  return raw;
}
app.set('trust proxy', resolveTrustProxy());

// ============================================================================
// 1. Dynamic Port Configuration & Validation
// ============================================================================
function resolvePort(): number {
  const envPort = process.env.PORT;
  if (!envPort) {
    return 3000;
  }
  const parsed = parseInt(envPort, 10);
  if (isNaN(parsed) || parsed <= 0 || parsed > 65535) {
    console.warn(`[Qavora Server] Invalid PORT "${envPort}" provided in environment; falling back to 3000.`);
    return 3000;
  }
  return parsed;
}

const PORT = resolvePort();
const isProduction = process.env.NODE_ENV === 'production';
const isVercel = Boolean(process.env.VERCEL || process.env.NOW_REGION);

// ============================================================================
// 2. Production HTTP Security Headers & Helmet-Equivalent Discipline
// ============================================================================
app.use((req: Request, res: Response, next: NextFunction) => {
  const isProdOrVercel =
    process.env.NODE_ENV === 'production' ||
    Boolean(process.env.VERCEL || process.env.NOW_REGION);

  // Prevent MIME-sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Strict Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Environment-aware iframe & Cross-Origin Resource Policy headers:
  // Production / Vercel strictly blocks framing; Development / AI Studio preview permits preview iframe
  if (isProdOrVercel) {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  } else {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Strict-Transport-Security only in production over HTTPS (respecting TRUST_PROXY via req.secure) and never on localhost
  const isLocalhost = req.hostname === 'localhost' || req.hostname === '127.0.0.1' || req.hostname === '::1';
  if (isProdOrVercel && req.secure && !isLocalhost) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Generate a cryptographically random, unpredictable 128-bit (16-byte) per-response nonce
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.nonce = nonce;

  // Content-Security-Policy tailored specifically for Qavora (QAV-AUDIT-005):
  // Production strictly enforces nonce-based execution with zero 'unsafe-inline' or 'wasm-unsafe-eval'
  const scriptSrc = isProdOrVercel
    ? `'self' 'nonce-${nonce}'`
    : `'self' 'unsafe-inline' 'nonce-${nonce}'`;

  const connectSrc = isProdOrVercel
    ? "'self'"
    : "'self' ws: wss: http: https:";
  const frameAncestors = isProdOrVercel ? "frame-ancestors 'none'" : 'frame-ancestors *';

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: blob:",
      `connect-src ${connectSrc}`,
      "manifest-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      frameAncestors,
      "object-src 'none'"
    ].join('; ')
  );

  next();
});

// Scoped 20 MB JSON body limit for large payload routes (data import, checklists, project data)
const largeJsonParser = express.json({ limit: '20mb' });
app.use('/api/data/import', largeJsonParser);
app.use('/api/checklists', largeJsonParser);
app.use('/api/projects', largeJsonParser);

// Default 1 MB JSON body limit for authentication and standard API routes
app.use(express.json({ limit: '1mb' }));

// ============================================================================
// 2b. HttpOnly Cookie, CORS & CSRF Protection (SEC-002)
// ============================================================================
const IS_PROD_ENV = process.env.NODE_ENV === 'production';
const AUTH_COOKIE_NAME = IS_PROD_ENV ? '__Host-qavora_auth_token' : 'qavora_auth_token';
const CSRF_COOKIE_NAME = IS_PROD_ENV ? '__Host-qavora_csrf_token' : 'qavora_csrf_token';

function parseCookies(cookieHeader?: string): { cookies: Record<string, string>; duplicates: Set<string> } {
  const cookies: Record<string, string> = {};
  const duplicates = new Set<string>();
  if (!cookieHeader || typeof cookieHeader !== 'string') return { cookies, duplicates };
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      if (Object.prototype.hasOwnProperty.call(cookies, key)) {
        duplicates.add(key);
      }
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return { cookies, duplicates };
}

function parseJwtExpiryToMs(expiresIn: string | number): number {
  const defaultMs = 7 * 24 * 60 * 60 * 1000;
  if (typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0) {
    return expiresIn * 1000;
  }
  if (typeof expiresIn !== 'string') return defaultMs;
  const match = expiresIn.trim().match(/^(\d+)\s*(ms|s|m|h|d|w|y)?$/i);
  if (!match) return defaultMs;
  const value = parseInt(match[1], 10);
  const unit = (match[2] || 's').toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000
  };
  return value * (multipliers[unit] || 1000);
}

function getAuthCookieOptions(maxAgeMs?: number) {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
    ...(typeof maxAgeMs === 'number' ? { maxAge: maxAgeMs } : {})
  };
}

function setAuthCookie(res: Response, token: string, expiresIn: string | number) {
  res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(parseJwtExpiryToMs(expiresIn)));
}

function clearAuthCookie(res: Response) {
  res.clearCookie(AUTH_COOKIE_NAME, getAuthCookieOptions());
}

function computeCsrfSignature(nonce: string, authToken: string): string {
  if (!authToken || typeof authToken !== 'string' || !authToken.trim()) {
    throw new Error('Authentication token is required to compute session-bound CSRF signature.');
  }
  const sessionKey = crypto.createHash('sha256').update(authToken).digest('hex');
  return crypto
    .createHmac('sha256', getJwtSecret())
    .update(`${sessionKey}.${nonce}`)
    .digest('hex');
}

function setCsrfCookie(res: Response, authToken: string): string {
  if (!authToken || typeof authToken !== 'string' || !authToken.trim()) {
    throw new Error('Cannot issue CSRF token without a valid authenticated session.');
  }
  const isProd = process.env.NODE_ENV === 'production';
  const nonce = crypto.randomBytes(24).toString('hex');
  const sig = computeCsrfSignature(nonce, authToken);
  const csrfToken = `${nonce}.${sig}`;
  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure: isProd,
    sameSite: 'lax',
    path: '/'
  });
  return csrfToken;
}

function getTrustedOrigins(): Set<string> {
  const trusted = new Set<string>();
  const rawCors = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  for (const entry of rawCors) {
    try {
      const parsed = new URL(entry);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        trusted.add(parsed.origin);
      }
    } catch {
      // Ignore malformed CORS_ORIGIN entries
    }
  }

  const canonicalCandidates = [
    process.env.APP_ORIGIN,
    process.env.PUBLIC_URL,
    process.env.RENDER_EXTERNAL_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined
  ].filter((v): v is string => Boolean(v && v.trim()));

  for (const candidate of canonicalCandidates) {
    try {
      const parsed = new URL(candidate.trim());
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        trusted.add(parsed.origin);
      }
    } catch {
      // Ignore malformed canonical URL
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    trusted.add(`http://localhost:${PORT}`);
    trusted.add(`http://127.0.0.1:${PORT}`);
    trusted.add('http://localhost:3000');
    trusted.add('http://127.0.0.1:3000');
  }

  return trusted;
}

function isOriginTrusted(originHeader: string | undefined): boolean {
  if (!originHeader || typeof originHeader !== 'string') return false;
  const trimmed = originHeader.trim();
  if (!trimmed || trimmed === 'null') return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return getTrustedOrigins().has(parsed.origin);
  } catch {
    return false;
  }
}

// CORS with credentials for /api
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && isOriginTrusted(origin)) {
    res.setHeader('Access-Control-Allow-Origin', new URL(origin).origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-Requested-With');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// CSRF protection for state-changing /api requests
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  const origin = req.headers.origin;
  if (origin !== undefined) {
    if (!isOriginTrusted(origin)) {
      return res.status(403).json({ error: 'Forbidden: Cross-origin request rejected.' });
    }
  } else if (req.path === '/auth/login' || req.path === '/auth/register') {
    return res.status(403).json({ error: 'Forbidden: Origin header required.' });
  }

  // Login and register establish a new session
  if (req.path === '/auth/login' || req.path === '/auth/register') {
    return next();
  }

  const { cookies, duplicates } = parseCookies(req.headers.cookie);
  const activeCsrfCookieName = cookies[CSRF_COOKIE_NAME]
    ? CSRF_COOKIE_NAME
    : (cookies['__Host-qavora_csrf_token'] ? '__Host-qavora_csrf_token' : (cookies['qavora_csrf_token'] ? 'qavora_csrf_token' : CSRF_COOKIE_NAME));

  if (
    duplicates.has(CSRF_COOKIE_NAME) ||
    duplicates.has('__Host-qavora_csrf_token') ||
    duplicates.has('qavora_csrf_token') ||
    duplicates.has(AUTH_COOKIE_NAME) ||
    (Boolean(cookies['__Host-qavora_csrf_token']) && Boolean(cookies['qavora_csrf_token']))
  ) {
    return res.status(403).json({ error: 'Invalid or duplicate security cookies.' });
  }

  const authToken = cookies[AUTH_COOKIE_NAME];
  if (!authToken) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
  }

  const cookieCsrf = cookies[activeCsrfCookieName];
  const headerCsrf = req.headers['x-csrf-token'];

  if (
    !cookieCsrf ||
    typeof headerCsrf !== 'string' ||
    cookieCsrf.length !== headerCsrf.length ||
    !crypto.timingSafeEqual(Buffer.from(cookieCsrf), Buffer.from(headerCsrf))
  ) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
  }

  const parts = cookieCsrf.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
  }

  try {
    const expectedSig = computeCsrfSignature(parts[0], authToken);
    if (
      parts[1].length !== expectedSig.length ||
      !crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expectedSig))
    ) {
      return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
    }
  } catch {
    return res.status(500).json({ error: 'Authentication service misconfigured: JWT_SECRET is missing.' });
  }

  next();
});

// ============================================================================
// 3. MongoDB Connection Handling
// ============================================================================
let db: any = null;
let mongoClientInstance: MongoClient | null = null;
let connectionPromise: Promise<any> | null = null;

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'qavora';

function sanitizeDiagnosticText(input: unknown): string {
  if (input === null || input === undefined) {
    return '';
  }
  let text = typeof input === 'string' ? input : String(input);

  // Redact explicit sensitive environment values if non-trivial and accidentally echoed
  const sensitiveValues = [process.env.MONGODB_URI, process.env.JWT_SECRET];
  for (const val of sensitiveValues) {
    if (typeof val === 'string' && val.trim().length >= 4) {
      text = text.split(val).join('[REDACTED]');
      const trimmed = val.trim();
      if (trimmed !== val) {
        text = text.split(trimmed).join('[REDACTED]');
      }
    }
  }

  // Redact full MongoDB connection URIs and credentials
  text = text.replace(
    /mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi,
    'mongodb+srv://[REDACTED]'
  );

  // Redact generic URI userinfo credentials (scheme://user:pass@host)
  text = text.replace(
    /([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+:[^/@\s]+)@/gi,
    '$1[credentials-hidden]@'
  );

  // Redact sensitive key=value or JSON parameters if present in driver/error strings
  text = text.replace(
    /((?:password|passwd|pwd|secret|token|jwt_secret|mongodb_uri|authsourcepassword)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,&;]+)/gi,
    '$1[REDACTED]'
  );

  return text;
}

function extractSafeCauseChain(cause: any, depth = 0): any {
  if (!cause || depth > 4) return undefined;
  if (typeof cause !== 'object') {
    return sanitizeDiagnosticText(cause);
  }
  const summary: Record<string, any> = {
    name: sanitizeDiagnosticText(cause.name || 'Error'),
    message: sanitizeDiagnosticText(cause.message || String(cause))
  };
  if (cause.code !== undefined) summary.code = sanitizeDiagnosticText(cause.code);
  if (cause.codeName !== undefined) summary.codeName = sanitizeDiagnosticText(cause.codeName);
  if (cause.syscall !== undefined) summary.syscall = sanitizeDiagnosticText(cause.syscall);
  if (cause.hostname !== undefined) summary.hostname = sanitizeDiagnosticText(cause.hostname);
  if (cause.address !== undefined) summary.address = sanitizeDiagnosticText(cause.address);
  if (typeof cause.port === 'number') summary.port = cause.port;
  if (cause.cause) {
    summary.cause = extractSafeCauseChain(cause.cause, depth + 1);
  }
  return summary;
}

function buildMongoConnectionDiagnostics(error: any, client?: MongoClient | null): Record<string, any> {
  const diagnostics: Record<string, any> = {
    errorName: sanitizeDiagnosticText(error?.name || 'Error'),
    message: sanitizeDiagnosticText(error?.message || 'Unknown error')
  };

  if (error?.code !== undefined) {
    diagnostics.code = sanitizeDiagnosticText(error.code);
  }
  if (error?.codeName !== undefined) {
    diagnostics.codeName = sanitizeDiagnosticText(error.codeName);
  }
  if (error?.errorLabels && Array.isArray(error.errorLabels) && error.errorLabels.length > 0) {
    diagnostics.errorLabels = error.errorLabels.map((l: unknown) => sanitizeDiagnosticText(l));
  }

  const topologyDesc =
    error?.reason && typeof error.reason === 'object'
      ? error.reason
      : (client as any)?.topology?.description;

  if (topologyDesc && typeof topologyDesc === 'object') {
    const topoSummary: Record<string, any> = {};
    if (topologyDesc.type !== undefined) topoSummary.type = sanitizeDiagnosticText(topologyDesc.type);
    if (topologyDesc.setName) topoSummary.setName = sanitizeDiagnosticText(topologyDesc.setName);
    if (typeof topologyDesc.compatible === 'boolean') topoSummary.compatible = topologyDesc.compatible;
    if (typeof topologyDesc.stale === 'boolean') topoSummary.stale = topologyDesc.stale;
    if (typeof topologyDesc.heartbeatFrequencyMS === 'number') {
      topoSummary.heartbeatFrequencyMS = topologyDesc.heartbeatFrequencyMS;
    }

    const serversMap = topologyDesc.servers;
    if (serversMap && typeof serversMap.entries === 'function') {
      topoSummary.totalKnownServers = typeof serversMap.size === 'number' ? serversMap.size : undefined;
      const failedServers: Array<Record<string, any>> = [];

      for (const [address, serverDesc] of serversMap.entries()) {
        const srvErr = serverDesc?.error;
        const srvType = serverDesc?.type ? sanitizeDiagnosticText(serverDesc.type) : 'Unknown';
        if (srvErr || srvType === 'Unknown') {
          const entry: Record<string, any> = {
            address: sanitizeDiagnosticText(serverDesc?.address || address),
            type: srvType
          };
          if (srvErr) {
            entry.errorName = sanitizeDiagnosticText(srvErr.name || 'Error');
            entry.errorMessage = sanitizeDiagnosticText(srvErr.message || String(srvErr));
            if (srvErr.code !== undefined) entry.code = sanitizeDiagnosticText(srvErr.code);
            if (srvErr.codeName !== undefined) entry.codeName = sanitizeDiagnosticText(srvErr.codeName);
            if (srvErr.cause) entry.cause = extractSafeCauseChain(srvErr.cause, 1);
          }
          failedServers.push(entry);
        }
      }

      if (failedServers.length > 0) {
        diagnostics.failedServers = failedServers;
      }
    }

    if (Object.keys(topoSummary).length > 0) {
      diagnostics.topology = topoSummary;
    }
  }

  if (error?.cause) {
    diagnostics.cause = extractSafeCauseChain(error.cause, 0);
  }

  return diagnostics;
}

interface MongoHostTcpDiagnostic {
  hostname: string;
  port: number;
  resolvedIps: string[];
  tcpStatus: 'success' | 'failure';
  tcpConnected: boolean;
  errorCode: string | null;
  dnsErrorCode?: string | null;
}

function extractSafeHostnamesFromMongoUri(rawUri: string): { scheme: string; hosts: string[] } {
  try {
    const schemeMatch = rawUri.trim().match(/^(mongodb(?:\+srv)?):\/\/(.+)$/i);
    if (!schemeMatch) {
      return { scheme: 'unknown', hosts: [] };
    }

    const scheme = schemeMatch[1].toLowerCase();
    const remainder = schemeMatch[2];

    // Strip path and query string
    const slashIdx = remainder.indexOf('/');
    const qIdx = remainder.indexOf('?');
    let authorityEnd = remainder.length;
    if (slashIdx !== -1) authorityEnd = Math.min(authorityEnd, slashIdx);
    if (qIdx !== -1) authorityEnd = Math.min(authorityEnd, qIdx);
    const authority = remainder.slice(0, authorityEnd);

    // Strip username:password@ userinfo if present (never log or retain credentials)
    const atIdx = authority.lastIndexOf('@');
    const hostListPart = atIdx !== -1 ? authority.slice(atIdx + 1) : authority;

    const hosts: string[] = [];
    for (const rawEntry of hostListPart.split(',')) {
      const trimmed = rawEntry.trim();
      if (!trimmed) continue;

      let hostname = '';
      if (trimmed.startsWith('[')) {
        const closeBracket = trimmed.indexOf(']');
        if (closeBracket === -1) continue;
        const bracketHost = trimmed.slice(1, closeBracket).trim();
        const afterBracket = trimmed.slice(closeBracket + 1).trim();
        if (afterBracket && !/^:\d{1,5}$/.test(afterBracket)) {
          continue;
        }
        if (net.isIP(bracketHost) === 6) {
          hostname = bracketHost.toLowerCase();
        }
      } else {
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx !== -1) {
          const portPart = trimmed.slice(colonIdx + 1).trim();
          // Reject malformed user:pass entries missing '@' where suffix is not a numeric port
          if (!/^\d{1,5}$/.test(portPart)) {
            continue;
          }
          hostname = trimmed.slice(0, colonIdx).trim().toLowerCase();
        } else {
          hostname = trimmed.toLowerCase();
        }

        // Allow only valid DNS hostname characters or IPv4 literals
        if (!hostname || (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(hostname) && net.isIP(hostname) === 0)) {
          continue;
        }
      }

      if (hostname && !hosts.includes(hostname)) {
        hosts.push(hostname);
      }
    }

    return { scheme, hosts };
  } catch {
    return { scheme: 'unknown', hosts: [] };
  }
}

function probeTcpPort(host: string, port: number, timeoutMs: number): Promise<{ connected: boolean; errorCode: string | null }> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = new net.Socket();

    const finish = (connected: boolean, errorCode: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(wallClockTimer);
      socket.removeAllListeners();
      socket.destroy();
      resolve({ connected, errorCode });
    };

    const wallClockTimer = setTimeout(() => {
      finish(false, 'ETIMEDOUT');
    }, timeoutMs);

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      finish(true, null);
    });

    socket.once('timeout', () => {
      finish(false, 'ETIMEDOUT');
    });

    socket.once('error', (err: NodeJS.ErrnoException) => {
      const code = err?.code ? sanitizeDiagnosticText(err.code) : sanitizeDiagnosticText(err?.name || 'TCP_ERROR');
      finish(false, code || 'TCP_ERROR');
    });

    try {
      socket.connect(port, host);
    } catch (syncErr: any) {
      const code = syncErr?.code ? sanitizeDiagnosticText(syncErr.code) : 'TCP_CONNECT_THROW';
      finish(false, code);
    }
  });
}

async function runMongoNetworkDiagnostics(connectionUri: string): Promise<void> {
  const TCP_DIAGNOSTIC_PORT = 27017;
  const TCP_TIMEOUT_MS = 5000;

  try {
    const { scheme, hosts: initialHosts } = extractSafeHostnamesFromMongoUri(connectionUri);
    if (initialHosts.length === 0) {
      return;
    }

    const targetHostnames: string[] = [];

    if (scheme === 'mongodb+srv') {
      for (const seedHost of initialHosts) {
        try {
          const srvRecords = await dns.resolveSrv(`_mongodb._tcp.${seedHost}`);
          const srvTargets = srvRecords
            .map((rec) => (rec?.name ? rec.name.replace(/\.$/, '').trim().toLowerCase() : ''))
            .filter(Boolean);

          if (srvTargets.length > 0) {
            for (const target of srvTargets) {
              if (!targetHostnames.includes(target)) {
                targetHostnames.push(target);
              }
            }
          } else if (!targetHostnames.includes(seedHost)) {
            targetHostnames.push(seedHost);
          }
        } catch (srvErr: any) {
          const srvCode = srvErr?.code ? sanitizeDiagnosticText(srvErr.code) : 'SRV_LOOKUP_FAILED';
          console.warn(
            `[Qavora MongoDB NetDiag] SRV lookup failed for ${sanitizeDiagnosticText(seedHost)}: errorCode=${srvCode}`
          );
          if (!targetHostnames.includes(seedHost)) {
            targetHostnames.push(seedHost);
          }
        }
      }
    } else {
      for (const h of initialHosts) {
        if (!targetHostnames.includes(h)) {
          targetHostnames.push(h);
        }
      }
    }

    await Promise.all(
      targetHostnames.map(async (hostname) => {
        const safeHost = sanitizeDiagnosticText(hostname);
        let resolvedIps: string[] = [];
        let dnsErrorCode: string | null = null;

        if (net.isIP(hostname) !== 0) {
          resolvedIps = [hostname];
        } else {
          try {
            const lookupResults = await dns.lookup(hostname, { all: true });
            resolvedIps = Array.from(new Set(lookupResults.map((entry) => entry.address).filter(Boolean)));
          } catch (dnsErr: any) {
            dnsErrorCode = dnsErr?.code ? sanitizeDiagnosticText(dnsErr.code) : 'DNS_LOOKUP_FAILED';
          }
        }

        const tcpProbeTarget = resolvedIps[0] || hostname;
        const tcpResult = await probeTcpPort(tcpProbeTarget, TCP_DIAGNOSTIC_PORT, TCP_TIMEOUT_MS);
        const finalErrorCode = tcpResult.connected ? null : (tcpResult.errorCode || dnsErrorCode || 'UNKNOWN');

        const summary: MongoHostTcpDiagnostic = {
          hostname: safeHost,
          port: TCP_DIAGNOSTIC_PORT,
          resolvedIps: resolvedIps.map((ip) => sanitizeDiagnosticText(ip)),
          tcpStatus: tcpResult.connected ? 'success' : 'failure',
          tcpConnected: tcpResult.connected,
          errorCode: finalErrorCode,
          ...(dnsErrorCode ? { dnsErrorCode } : {})
        };

        console.log(`[Qavora MongoDB NetDiag] ${JSON.stringify(summary)}`);
      })
    );
  } catch (diagErr: any) {
    console.warn(
      `[Qavora MongoDB NetDiag] Diagnostic check skipped safely: ${sanitizeDiagnosticText(diagErr?.code || diagErr?.message || 'Unknown error')}`
    );
  }
}

// ============================================================================
// Multi-Tenant Unique Index Migration & Safety Helper (M-01)
// ============================================================================
async function ensureMultiTenantUniqueIndex(col: any, collectionName: string): Promise<boolean> {
  try {
    const existingIndexes = await col.indexes().catch(() => []);

    // 1. Drop legacy global unique index on { id: 1 } if present
    for (const idx of existingIndexes) {
      if (idx.name !== '_id_' && idx.unique && Object.keys(idx.key).length === 1 && idx.key.id === 1) {
        try {
          console.log(`[Qavora Server] Dropping legacy global unique index '${idx.name}' on ${collectionName}...`);
          await col.dropIndex(idx.name);
          console.log(`[Qavora Server] Successfully dropped legacy global unique index '${idx.name}' on ${collectionName}.`);
        } catch (dropErr: any) {
          console.warn(`[Qavora Server] Warning dropping legacy index '${idx.name}' on ${collectionName}: ${sanitizeDiagnosticText(dropErr?.message)}`);
        }
      }

      // If a non-unique compound index on { userId: 1, id: 1 } exists, drop it so it can be re-created with unique: true
      if (idx.name !== '_id_' && !idx.unique && Object.keys(idx.key).length === 2 && idx.key.userId === 1 && idx.key.id === 1) {
        try {
          console.log(`[Qavora Server] Dropping legacy non-unique compound index '${idx.name}' on ${collectionName}...`);
          await col.dropIndex(idx.name);
          console.log(`[Qavora Server] Successfully dropped legacy non-unique index '${idx.name}' on ${collectionName}.`);
        } catch (dropErr: any) {
          console.warn(`[Qavora Server] Warning dropping non-unique index '${idx.name}' on ${collectionName}: ${sanitizeDiagnosticText(dropErr?.message)}`);
        }
      }
    }

    // 2. Safely scan for duplicate records for the same user before index creation
    const duplicates = await col.aggregate([
      { $group: { _id: { userId: "$userId", id: "$id" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 }, "_id.userId": { $ne: null }, "_id.id": { $ne: null } } }
    ]).toArray().catch(() => []);

    if (duplicates && duplicates.length > 0) {
      console.error(
        `[Qavora Server ERROR] Cannot create compound unique index on ${collectionName} ({ userId: 1, id: 1 }). ` +
        `Existing duplicate records found for the same user: ${JSON.stringify(duplicates)}. ` +
        `Index creation stopped safely without altering or deleting existing user data.`
      );
      return false;
    }

    // 3. Create the compound unique index { userId: 1, id: 1 }
    await col.createIndex({ userId: 1, id: 1 }, { unique: true });
    console.log(`[Qavora Server] Ensured multi-tenant compound unique index on ${collectionName} ({ userId: 1, id: 1 }).`);
    return true;
  } catch (err: any) {
    console.warn(`[Qavora Server] Warning configuring multi-tenant compound unique index on ${collectionName}: ${sanitizeDiagnosticText(err?.message)}`);
    return false;
  }
}

async function ensureDatabaseIndexes(database: any = db): Promise<void> {
  if (!database) return;

  // Ensure multi-tenant compound unique index on projects collection ({ userId: 1, id: 1 })
  await ensureMultiTenantUniqueIndex(database.collection("projects"), "projects");
  try {
    await database.collection("projects").createIndex({ userId: 1, status: 1 });
    await database.collection("projects").createIndex({ userId: 1 });
    console.log(`[Qavora Server] Ensured tenant-isolation auxiliary indexes on projects collection (userId, status).`);
  } catch (idxErr: any) {
    console.warn(`[Qavora Server] Warning creating auxiliary indexes on projects: ${sanitizeDiagnosticText(idxErr?.message)}`);
  }

  try {
    await database.collection("tests").createIndex({ userId: 1 });
  } catch (idxErr: any) {
    console.warn(`[Qavora Server] Warning creating index on tests: ${sanitizeDiagnosticText(idxErr?.message)}`);
  }

  try {
    await database.collection("users").createIndex({ email: 1 }, { unique: true });
    await database.collection("users").createIndex({ userId: 1 }, { unique: true });
    console.log(`[Qavora Server] Ensured unique indexes on users collection (email, userId).`);
  } catch (idxErr: any) {
    console.warn(`[Qavora Server] Warning creating unique index on users: ${sanitizeDiagnosticText(idxErr?.message)}`);
  }

  // Ensure multi-tenant compound unique index on checklists collection ({ userId: 1, id: 1 })
  await ensureMultiTenantUniqueIndex(database.collection("checklists"), "checklists");
  try {
    await database.collection("checklists").createIndex({ userId: 1 });
    console.log(`[Qavora Server] Ensured tenant-isolation auxiliary index on checklists collection (userId).`);
  } catch (idxErr: any) {
    console.warn(`[Qavora Server] Warning creating auxiliary index on checklists: ${sanitizeDiagnosticText(idxErr?.message)}`);
  }

  try {
    await database.collection("recovery_snapshots").createIndex({ userId: 1, createdAt: -1 });
    await database.collection("recovery_snapshots").createIndex({ userId: 1, snapshotId: 1 });
    console.log(`[Qavora Server] Ensured tenant-isolation indexes on recovery_snapshots collection (userId, createdAt).`);
  } catch (idxErr: any) {
    console.warn(`[Qavora Server] Warning creating indexes on recovery_snapshots: ${sanitizeDiagnosticText(idxErr?.message)}`);
  }

  // Ensure compound index on project_artifacts collection ({ projectId: 1, userId: 1 }) (ISSUE-04)
  try {
    await database.collection("project_artifacts").createIndex({ projectId: 1, userId: 1 });
    console.log(`[Qavora Server] Ensured compound index on project_artifacts collection ({ projectId: 1, userId: 1 }).`);
  } catch (idxErr: any) {
    console.warn(`[Qavora Server] Warning creating compound index on project_artifacts: ${sanitizeDiagnosticText(idxErr?.message)}`);
  }
}

async function connectToDatabase(): Promise<any> {
  const currentUri = process.env.MONGODB_URI?.trim();
  const currentDbName = process.env.MONGODB_DB || 'qavora';
  const currentIsProd = process.env.NODE_ENV === 'production';
  const currentIsVercel = Boolean(process.env.VERCEL || process.env.NOW_REGION);

  // If already connected to real MongoDB, return immediately (warm invocation reuse)
  if (db) {
    return db;
  }

  // If a connection attempt is already in flight, await the existing promise
  if (connectionPromise) {
    return connectionPromise;
  }

  const inFlightPromise = Promise.resolve().then(async () => {
    let attemptedClient: MongoClient | null = null;
    try {
      if (!currentUri) {
        if (currentIsProd && !currentIsVercel) {
          console.error('[Qavora Server FATAL] Production startup failed: MONGODB_URI environment variable is missing.');
          process.exit(1);
        }
        db = null;
        console.warn('[Qavora Server] MONGODB_URI is missing in environment; database remains offline (HTTP 503).');
        return null;
      }

      await runMongoNetworkDiagnostics(currentUri);

      console.log(`[Qavora Server] Initializing MongoDB Atlas client (database: ${currentDbName})...`);
      const client = new MongoClient(currentUri, {
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: 20
      });
      attemptedClient = client;

      await client.connect();
      mongoClientInstance = client;
      db = client.db(currentDbName);
      console.log(`[Qavora Server] Successfully connected to MongoDB Atlas (database: ${currentDbName}).`);

      await ensureDatabaseIndexes(db);

      return db;
    } catch (error: any) {
      const safeErrorMessage = sanitizeDiagnosticText(error?.message || "Unknown error");
      const diagnostics = buildMongoConnectionDiagnostics(error, attemptedClient);

      if (currentIsProd && !currentIsVercel) {
        db = null;
        console.error(
          `[Qavora Server FATAL] Production startup failed: Unable to connect to MongoDB Atlas (${safeErrorMessage}).`,
          JSON.stringify(diagnostics)
        );
        process.exit(1);
      } else {
        db = null;
        console.warn(`[Qavora Server] MongoDB connection offline (${safeErrorMessage}).`, JSON.stringify(diagnostics));
        return null;
      }
    } finally {
      if (!db) {
        connectionPromise = null;
      }
    }
  });

  connectionPromise = inFlightPromise;
  return inFlightPromise;
}

// Pre-warm database connection if credentials exist (or enforce standalone production fail-fast)
if (uri || (isProduction && !isVercel)) {
  connectToDatabase().catch((err) => {
    console.warn(`[Qavora Server] Initial connection pre-warm warning: ${sanitizeDiagnosticText(err?.message)}`);
  });
}

// Middleware: ensure database connection is established (or retried) before processing API requests
app.use(async (req: Request, res: Response, next: NextFunction) => {
  // Only intercept /api routes
  if (!req.path.startsWith('/api')) {
    return next();
  }

  // Health endpoint invokes and awaits connectToDatabase() directly before reporting status
  if (req.path === '/api/health') {
    return next();
  }

  const activeUri = process.env.MONGODB_URI?.trim();
  if (!db && activeUri) {
    try {
      await connectToDatabase();
    } catch (err: any) {
      console.warn(`[Qavora Server] Failed awaiting database connection in request middleware: ${sanitizeDiagnosticText(err?.message || err)}`);
    }
  }

  next();
});

// Health check endpoint
app.get("/api/health", async (req: Request, res: Response) => {
  if (!db && Boolean(process.env.MONGODB_URI?.trim())) {
    try {
      await connectToDatabase();
    } catch (err: any) {
      console.warn(
        `[Qavora Server] Health check database connection attempt failed: ${sanitizeDiagnosticText(err?.message || err)}`
      );
    }
  }

  const databaseStatus = db ? "connected" : "disconnected";

  return res.json({
    success: true,
    message: "Qavora backend is running successfully.",
    database: databaseStatus
  });
});

// ============================================================================
// Authentication Helpers & Security Configuration
// ============================================================================
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || typeof secret !== 'string' || secret.trim().length < 16) {
    throw new Error('JWT_SECRET environment variable must be configured and at least 16 characters long.');
  }
  return secret.trim();
}

function getAvatarInitials(name: string): string {
  if (!name || typeof name !== 'string') return 'QA';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface SafeUserProfile {
  userId: string;
  email: string;
  name: string;
  role: string;
  avatarInitials: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
  preferences?: Record<string, any>;
}

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    name: string;
    role: string;
  };
  authToken?: string;
}

function toSafeUser(user: any): SafeUserProfile {
  return {
    userId: String(user.userId),
    email: String(user.email),
    name: String(user.name),
    role: String(user.role || 'QA Tester'),
    avatarInitials: String(user.avatarInitials || getAvatarInitials(user.name)),
    createdAt: String(user.createdAt),
    updatedAt: String(user.updatedAt),
    lastLoginAt: String(user.lastLoginAt),
    preferences: user.preferences || {}
  };
}

/**
 * Atomic MongoDB update pipeline stage to safely advance a user's tokenVersion.
 * - If tokenVersion is a valid positive integer, increments by 1.
 * - If tokenVersion is missing/null (legacy user), defaults base to 1 and advances to 2.
 * - If tokenVersion is malformed (string, fractional, negative, zero, non-finite), defaults base to 1 and advances to 2.
 * - Prevents lost updates under concurrent logout / password-change requests.
 */
function buildTokenVersionIncrementPipeline(extraFields: Record<string, any> = {}) {
  const literalFields: Record<string, any> = {};
  for (const [key, val] of Object.entries(extraFields)) {
    // In aggregation pipeline $set, literal string values (especially bcrypt hashes starting with $)
    // must be wrapped in { $literal: val } to prevent MongoDB from treating them as field path expressions.
    if (typeof val === 'string') {
      literalFields[key] = { $literal: val };
    } else {
      literalFields[key] = val;
    }
  }

  return [
    {
      $set: {
        tokenVersion: {
          $add: [
            {
              $ifNull: [
                {
                  $cond: {
                    if: {
                      $and: [
                        { $isNumber: "$tokenVersion" },
                        { $gte: ["$tokenVersion", 1] },
                        { $eq: ["$tokenVersion", { $floor: "$tokenVersion" }] }
                      ]
                    },
                    then: "$tokenVersion",
                    else: null
                  }
                },
                1
              ]
            },
            1
          ]
        },
        ...literalFields
      }
    }
  ];
}

// ============================================================================
// Authentication Middleware (Route Guard & Identity Verification)
// ============================================================================
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    if (!db) {
      return res.status(503).json({
        error: "Authentication service unavailable (database offline)."
      });
    }

    let jwtSecret: string;
    try {
      jwtSecret = getJwtSecret();
    } catch {
      return res.status(500).json({
        error: "Authentication service misconfigured: JWT_SECRET is missing."
      });
    }

    const { cookies, duplicates } = parseCookies(req.headers.cookie);
    if (duplicates.has(AUTH_COOKIE_NAME)) {
      return res.status(401).json({
        error: "Invalid or duplicate authentication token."
      });
    }
    const authCookieToken = cookies[AUTH_COOKIE_NAME];
    const authHeader = req.headers.authorization;
    let bearerToken: string | undefined;
    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      bearerToken = authHeader.substring(7).trim();
    }

    if (authCookieToken && bearerToken && authCookieToken !== bearerToken) {
      return res.status(401).json({
        error: "Conflicting authentication credentials provided."
      });
    }

    const token = authCookieToken || bearerToken;

    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(401).json({
        error: "Authentication token missing or invalid."
      });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (jwtErr: any) {
      if (jwtErr?.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: "Session expired. Please log in again."
        });
      }
      return res.status(401).json({
        error: "Invalid authentication token."
      });
    }

    if (!decoded || typeof decoded !== 'object' || !decoded.userId || typeof decoded.userId !== 'string' || !decoded.userId.trim()) {
      return res.status(401).json({
        error: "Invalid authentication token payload."
      });
    }

    const user = await db.collection("users").findOne({ userId: decoded.userId });
    if (!user) {
      return res.status(401).json({
        error: "User account no longer exists."
      });
    }

    // Safe normalization and strict validation of database tokenVersion.
    // - Positive integer >= 1 is accepted as expectedTokenVersion.
    // - Missing/undefined legacy user records default to version 1.
    // - Malformed or invalid database values (e.g. null, string, fractional, negative, zero, non-finite)
    //   are strictly rejected rather than silently falling back to version 1.
    let expectedTokenVersion: number | null = null;
    let dbTokenVersionValid = true;

    if (user.tokenVersion === undefined) {
      expectedTokenVersion = 1;
    } else if (
      typeof user.tokenVersion === 'number' &&
      Number.isInteger(user.tokenVersion) &&
      Number.isFinite(user.tokenVersion) &&
      user.tokenVersion >= 1
    ) {
      expectedTokenVersion = user.tokenVersion;
    } else {
      dbTokenVersionValid = false;
    }

    // Safe normalization and strict validation of decoded JWT tokenVersion.
    // - For versioned tokens: require decoded.tokenVersion === expectedTokenVersion.
    // - Reject missing, null, string, fractional, negative, zero, and non-finite JWT token versions.
    // - Legacy tokens without tokenVersion (decoded.tokenVersion === undefined) are only valid when expectedTokenVersion === 1.
    let tokenVersionValid = false;

    if (dbTokenVersionValid && expectedTokenVersion !== null) {
      if (decoded.tokenVersion === undefined) {
        // Legacy token without version: strictly permitted only if database version is exactly 1
        if (expectedTokenVersion === 1) {
          tokenVersionValid = true;
        }
      } else if (
        typeof decoded.tokenVersion === 'number' &&
        Number.isInteger(decoded.tokenVersion) &&
        Number.isFinite(decoded.tokenVersion) &&
        decoded.tokenVersion >= 1
      ) {
        // Versioned token: must match database version exactly
        if (decoded.tokenVersion === expectedTokenVersion) {
          tokenVersionValid = true;
        }
      }
      // Any other value (null, string, fractional, negative, zero, NaN, Infinity) remains tokenVersionValid = false
    }

    const isRevoked =
      user.revoked === true ||
      user.isRevoked === true ||
      user.disabled === true ||
      user.sessionRevoked === true ||
      user.status === 'revoked' ||
      user.status === 'disabled' ||
      user.status === 'suspended' ||
      user.status === 'inactive' ||
      !tokenVersionValid ||
      (Array.isArray(user.revokedTokens) && user.revokedTokens.includes(crypto.createHash('sha256').update(token).digest('hex')));

    if (isRevoked) {
      return res.status(401).json({
        error: "Session has been revoked. Please log in again."
      });
    }

    (req as AuthenticatedRequest).user = {
      userId: String(user.userId),
      email: String(user.email),
      name: String(user.name),
      role: String(user.role || 'QA Tester')
    };
    (req as AuthenticatedRequest).authToken = token;

    next();
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error in requireAuth middleware: ${safeError}`);
    return res.status(500).json({ error: "Failed to authenticate request." });
  }
}

// ============================================================================
// Authentication Rate Limiters (SEC-001 / QAV-SEC-002)
// ============================================================================
class MongoRateLimitStore {
  private windowMs: number;
  prefix: string;
  private ttlIndexEnsured = false;

  constructor(windowMs: number, prefix: string) {
    this.windowMs = windowMs;
    this.prefix = prefix;
  }

  private ensureTtlIndex(col: any): void {
    if (this.ttlIndexEnsured) return;
    this.ttlIndexEnsured = true;
    col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch((err: any) => {
      this.ttlIndexEnsured = false;
      console.warn(`[Qavora Server] Failed to ensure rate_limits TTL index: ${sanitizeDiagnosticText(err?.message || err)}`);
    });
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
    if (!db) {
      const err: any = new Error('Service temporarily unavailable (database offline).');
      err.name = 'MongoNetworkError';
      err.status = 503;
      throw err;
    }

    const now = new Date();
    const docId = `${this.prefix}:${key}`;
    const resetTime = new Date(now.getTime() + this.windowMs);
    const col = db.collection('rate_limits');
    this.ensureTtlIndex(col);

    const updated = await col.findOneAndUpdate(
      { _id: docId },
      [
        {
          $set: {
            totalHits: {
              $cond: [
                { $gt: ['$expiresAt', now] },
                { $add: ['$totalHits', 1] },
                1
              ]
            },
            expiresAt: {
              $cond: [
                { $gt: ['$expiresAt', now] },
                '$expiresAt',
                resetTime
              ]
            }
          }
        }
      ],
      { upsert: true, returnDocument: 'after' }
    );

    return {
      totalHits: Number(updated?.totalHits || 1),
      resetTime: updated?.expiresAt ? new Date(updated.expiresAt) : resetTime
    };
  }

  async decrement(key: string): Promise<void> {
    if (!db) return;
    const docId = `${this.prefix}:${key}`;
    await db.collection('rate_limits').updateOne(
      { _id: docId, totalHits: { $gt: 0 } },
      { $inc: { totalHits: -1 } }
    );
  }

  async resetKey(key: string): Promise<void> {
    if (!db) return;
    const docId = `${this.prefix}:${key}`;
    await db.collection('rate_limits').deleteOne({ _id: docId });
  }
}

// 1. Login rate limiter: Maximum 5 attempts per 15 minutes per IP
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginRateLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  limit: 5, // 5 attempts per window per IP
  store: new MongoRateLimitStore(LOGIN_WINDOW_MS, 'rl_login'),
  standardHeaders: true, // draft-6/draft-7 RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  statusCode: 429,
  message: {
    error: 'Too many login attempts. Please try again after 15 minutes.',
    message: 'Too many login attempts from this IP address, please try again after 15 minutes.'
  },
  validate: { xForwardedForHeader: false }
});

// 2. Registration rate limiter: Maximum 3 registration attempts per hour per IP
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const registerRateLimiter = rateLimit({
  windowMs: REGISTER_WINDOW_MS,
  limit: 3, // 3 registration attempts per hour per IP
  store: new MongoRateLimitStore(REGISTER_WINDOW_MS, 'rl_register'),
  standardHeaders: true, // draft-6/draft-7 RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  statusCode: 429,
  message: {
    error: 'Too many registration attempts. Please try again after an hour.',
    message: 'Too many accounts created from this IP address, please try again after an hour.'
  },
  validate: { xForwardedForHeader: false }
});

// ============================================================================
// Authentication Endpoints
// ============================================================================

// 1. POST /api/auth/register - Register a new user
app.post("/api/auth/register", registerRateLimiter, async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({
        error: "Authentication service unavailable (database offline)."
      });
    }

    let jwtSecret: string;
    try {
      jwtSecret = getJwtSecret();
    } catch {
      return res.status(500).json({
        error: "Authentication service misconfigured: JWT_SECRET is missing."
      });
    }

    const { name, email, password, role } = req.body || {};

    if (typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({
        error: "Full name is required and must be a non-empty string."
      });
    }

    if (typeof email !== 'string' || !EMAIL_REGEX.test(email.trim().toLowerCase())) {
      return res.status(400).json({
        error: "A valid email address is required."
      });
    }

    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        error: "Password must be at least 8 characters long."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();

    // Check for existing user by normalized email
    const existingUser = await db.collection("users").findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        error: "An account with this email address already exists."
      });
    }

    // Hash password with bcryptjs (10 salt rounds)
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date().toISOString();

    const newUser = {
      userId,
      email: normalizedEmail,
      passwordHash,
      name: trimmedName,
      role: typeof role === 'string' && role.trim() ? role.trim() : 'QA Tester',
      avatarInitials: getAvatarInitials(trimmedName),
      tokenVersion: 1,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now
    };

    try {
      await db.collection("users").insertOne(newUser);
    } catch (insertErr: any) {
      if (insertErr?.code === 11000) {
        return res.status(409).json({
          error: "An account with this email address already exists."
        });
      }
      throw insertErr;
    }

    const tokenExpiry = (process.env.JWT_EXPIRES_IN || '7d') as any;
    const token = jwt.sign(
      {
        userId: newUser.userId,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        tokenVersion: newUser.tokenVersion
      },
      jwtSecret,
      { expiresIn: tokenExpiry }
    );

    setAuthCookie(res, token, tokenExpiry);
    setCsrfCookie(res, token);

    return res.status(201).json({
      success: true,
      user: toSafeUser(newUser)
    });
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error in registration: ${safeError}`);
    return res.status(500).json({ error: "Failed to register user." });
  }
});

// 2. POST /api/auth/login - Authenticate existing user
app.post("/api/auth/login", loginRateLimiter, async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({
        error: "Authentication service unavailable (database offline)."
      });
    }

    let jwtSecret: string;
    try {
      jwtSecret = getJwtSecret();
    } catch {
      return res.status(500).json({
        error: "Authentication service misconfigured: JWT_SECRET is missing."
      });
    }

    const { email, password } = req.body || {};

    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      email.trim() === '' ||
      password === ''
    ) {
      return res.status(400).json({
        error: "Email and password are required."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await db.collection("users").findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({
        error: "Invalid email or password."
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        error: "Invalid email or password."
      });
    }

    const now = new Date().toISOString();
    const userTokenVersion = (typeof user.tokenVersion === 'number' && Number.isInteger(user.tokenVersion) && Number.isFinite(user.tokenVersion) && user.tokenVersion >= 1)
      ? user.tokenVersion
      : 1;

    await db.collection("users").updateOne(
      { userId: user.userId },
      { $set: { lastLoginAt: now, updatedAt: now, tokenVersion: userTokenVersion } }
    );
    user.tokenVersion = userTokenVersion;
    user.lastLoginAt = now;
    user.updatedAt = now;

    const tokenExpiry = (process.env.JWT_EXPIRES_IN || '7d') as any;
    const token = jwt.sign(
      {
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role || 'QA Tester',
        tokenVersion: userTokenVersion
      },
      jwtSecret,
      { expiresIn: tokenExpiry }
    );

    setAuthCookie(res, token, tokenExpiry);
    setCsrfCookie(res, token);

    return res.json({
      success: true,
      user: toSafeUser(user)
    });
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error in login: ${safeError}`);
    return res.status(500).json({ error: "Failed to authenticate user." });
  }
});

// 2b. POST /api/auth/logout - Clear authentication and CSRF cookies & atomically invalidate session
app.post("/api/auth/logout", async (req: Request, res: Response) => {
  try {
    const { cookies } = parseCookies(req.headers.cookie);
    let token = cookies[AUTH_COOKIE_NAME];
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
      }
    }
    if (token && db) {
      try {
        const decoded: any = jwt.decode(token);
        if (decoded && typeof decoded === 'object' && typeof decoded.userId === 'string' && decoded.userId.trim()) {
          const updateResult = await db.collection("users").updateOne(
            { userId: decoded.userId.trim() },
            buildTokenVersionIncrementPipeline({ updatedAt: new Date().toISOString() })
          );
          if (!updateResult.acknowledged) {
            console.warn('[Qavora Server] Logout tokenVersion increment not acknowledged.');
          }
        }
      } catch {
        // Ignore decode error during logout cleanup
      }
    }
  } catch {
    // Ignore error
  }

  clearAuthCookie(res);
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
  });
  return res.json({
    success: true,
    message: "Logged out successfully."
  });
});

// 2c. GET /api/auth/csrf - Issue CSRF token cookie for authenticated sessions only (QAV-AUDIT-003)
app.get("/api/auth/csrf", requireAuth, (req: Request, res: Response) => {
  try {
    const { cookies, duplicates } = parseCookies(req.headers.cookie);
    if (duplicates.has(AUTH_COOKIE_NAME) || duplicates.has(CSRF_COOKIE_NAME)) {
      return res.status(401).json({ error: "Invalid or duplicate security cookies." });
    }
    const cookieAuthToken = cookies[AUTH_COOKIE_NAME];
    const authReq = req as AuthenticatedRequest;
    const verifiedToken = authReq.authToken;

    if (!cookieAuthToken || !verifiedToken || cookieAuthToken !== verifiedToken) {
      return res.status(401).json({ error: "Authentication cookie missing or invalid." });
    }

    if (!authReq.user || !authReq.user.userId) {
      return res.status(401).json({ error: "Authenticated user context required." });
    }

    const csrfToken = setCsrfCookie(res, cookieAuthToken);
    return res.json({ success: true, csrfToken });
  } catch (error: any) {
    console.error(`Error in CSRF token issuance: ${sanitizeDiagnosticText(error?.message || error)}`);
    return res.status(500).json({ error: "Failed to issue CSRF token." });
  }
});

// 3. GET /api/auth/me - Verify session token and retrieve user profile
app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = await db.collection("users").findOne({ userId: authReq.user!.userId });
    if (!user) {
      return res.status(401).json({
        error: "User account no longer exists."
      });
    }

    return res.json({
      success: true,
      user: toSafeUser(user)
    });
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error in session verification: ${safeError}`);
    return res.status(500).json({ error: "Failed to verify session." });
  }
});

// 4. PATCH /api/auth/profile - Update user display name and QA role
app.patch("/api/auth/profile", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;
    const { name, role } = req.body || {};

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: "Full name is required and cannot be empty." });
    }

    const trimmedName = name.trim();
    const cleanRole = typeof role === 'string' && role.trim() ? role.trim() : 'QA Tester';
    const now = new Date().toISOString();

    const updateFields: Record<string, any> = {
      name: trimmedName,
      role: cleanRole,
      avatarInitials: getAvatarInitials(trimmedName),
      updatedAt: now
    };

    await db.collection("users").updateOne(
      { userId },
      { $set: updateFields }
    );

    const updatedUser = await db.collection("users").findOne({ userId });
    return res.json({
      success: true,
      message: "Profile updated successfully.",
      user: toSafeUser(updatedUser)
    });
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error in profile update: ${safeError}`);
    return res.status(500).json({ error: "Failed to update profile." });
  }
});

// 5. POST /api/auth/change-password - Secure password change with current password verification
app.post("/api/auth/change-password", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;
    const { currentPassword, newPassword } = req.body || {};

    if (typeof currentPassword !== 'string' || !currentPassword) {
      return res.status(400).json({ error: "Current password is required." });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters long." });
    }

    const user = await db.collection("users").findOne({ userId });
    if (!user) {
      return res.status(404).json({ error: "User account not found." });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ error: "Current password does not match our records." });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);
    const now = new Date().toISOString();

    const updateResult = await db.collection("users").updateOne(
      { userId },
      buildTokenVersionIncrementPipeline({
        passwordHash,
        updatedAt: now
      })
    );

    if (!updateResult.acknowledged || updateResult.matchedCount === 0) {
      return res.status(404).json({ error: "User account not found." });
    }

    return res.json({
      success: true,
      message: "Password changed successfully."
    });
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error in password change: ${safeError}`);
    return res.status(500).json({ error: "Failed to change password." });
  }
});

// 6. PATCH /api/auth/preferences - Update application and UI preferences
app.patch("/api/auth/preferences", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;
    const preferences = req.body?.preferences;

    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
      return res.status(400).json({ error: "Preferences must be a valid key-value object." });
    }

    const now = new Date().toISOString();
    await db.collection("users").updateOne(
      { userId },
      { $set: { preferences, updatedAt: now } }
    );

    const updatedUser = await db.collection("users").findOne({ userId });
    return res.json({
      success: true,
      preferences: updatedUser?.preferences || {},
      user: toSafeUser(updatedUser)
    });
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error saving preferences: ${safeError}`);
    return res.status(500).json({ error: "Failed to save preferences." });
  }
});

// 6.5. GET /api/data/storage-usage - Actual MongoDB Atlas database storage usage
app.get("/api/data/storage-usage", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({
        error: "Service temporarily unavailable (database offline).",
        status: "offline"
      });
    }

    // Retrieve genuine database statistics directly from MongoDB Atlas via dbStats command
    const stats: any = await db.command({ dbStats: 1, scale: 1 });

    const rawDataSize = typeof stats.dataSize === 'number' ? stats.dataSize : 0;
    const rawStorageSize = typeof stats.storageSize === 'number' ? stats.storageSize : 0;
    const rawIndexSize = typeof stats.indexSize === 'number' ? stats.indexSize : 0;

    // Total storage footprint: In MongoDB WiredTiger, actual disk space consumed by the database
    // equals storageSize (compressed data on disk) plus indexSize (index allocation on disk).
    const totalFootprintBytes = typeof stats.totalSize === 'number' && stats.totalSize > 0
      ? stats.totalSize
      : (rawStorageSize + rawIndexSize);

    // Configurable reference storage capacity limit (default 512 MB)
    const envLimit = Number(process.env.MONGODB_STORAGE_LIMIT_MB);
    const capacityMb = !isNaN(envLimit) && envLimit > 0 ? envLimit : 512;
    const capacityBytes = capacityMb * 1024 * 1024;

    const usedMb = Number((totalFootprintBytes / (1024 * 1024)).toFixed(2));
    const availableBytes = Math.max(0, capacityBytes - totalFootprintBytes);
    const availableMb = Number(Math.max(0, capacityMb - (totalFootprintBytes / (1024 * 1024))).toFixed(2));
    const usagePercentage = Number(Math.min(100, Math.max(0, (totalFootprintBytes / capacityBytes) * 100)).toFixed(2));

    const dataSizeMb = Number((rawDataSize / (1024 * 1024)).toFixed(2));
    const storageSizeMb = Number((rawStorageSize / (1024 * 1024)).toFixed(2));
    const indexSizeMb = Number((rawIndexSize / (1024 * 1024)).toFixed(2));

    return res.json({
      success: true,
      status: "connected",
      storage: {
        usedBytes: totalFootprintBytes,
        usedMb,
        capacityBytes,
        capacityMb,
        availableBytes,
        availableMb,
        usagePercentage
      },
      metrics: {
        dataSize: {
          bytes: rawDataSize,
          mb: dataSizeMb
        },
        storageSize: {
          bytes: rawStorageSize,
          mb: storageSizeMb
        },
        indexSize: {
          bytes: rawIndexSize,
          mb: indexSizeMb
        },
        totalStorage: {
          bytes: totalFootprintBytes,
          mb: usedMb
        }
      },
      metadata: {
        collections: typeof stats.collections === 'number' ? stats.collections : 0,
        objects: typeof stats.objects === 'number' ? stats.objects : 0,
        indexes: typeof stats.indexes === 'number' ? stats.indexes : 0,
        avgObjSizeBytes: typeof stats.avgObjSize === 'number' ? Math.round(stats.avgObjSize) : 0,
        timestamp: new Date().toISOString(),
        definition: "Total storage footprint equals MongoDB storageSize (compressed data on disk) plus indexSize (indexes on disk)."
      }
    });
  } catch (error: any) {
    const safeError = sanitizeDiagnosticText(error?.message || "Internal server error");
    console.error(`[Qavora Server] Error retrieving MongoDB storage stats: ${safeError}`);
    return res.status(500).json({
      error: "Failed to retrieve MongoDB database storage statistics.",
      status: "error"
    });
  }
});

// 7. POST /api/data/reset - Danger Zone: Reset all projects and checklists for the authenticated user
app.post("/api/data/reset", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;

    let txSuccess = false;
    let deletedCounts = { projects: 0, artifacts: 0, checklists: 0 };

    if (mongoClientInstance && typeof mongoClientInstance.startSession === 'function') {
      let session: any = null;
      try {
        session = mongoClientInstance.startSession();
        await session.withTransaction(async () => {
          const projRes = await db.collection("projects").deleteMany({ userId }, { session });
          const artRes = await db.collection("project_artifacts").deleteMany({ userId }, { session });
          const chkRes = await db.collection("checklists").deleteMany({ userId }, { session });
          deletedCounts = {
            projects: projRes.deletedCount,
            artifacts: artRes.deletedCount,
            checklists: chkRes.deletedCount
          };
        });
        txSuccess = true;
      } catch (txErr: any) {
        console.warn(`[Qavora Server] Reset transaction unsupported or failed: ${sanitizeDiagnosticText(txErr?.message)}`);
      } finally {
        if (session) await session.endSession().catch(() => {});
      }
    }

    if (!txSuccess) {
      const [projRes, artRes, chkRes] = await Promise.all([
        db.collection("projects").deleteMany({ userId }),
        db.collection("project_artifacts").deleteMany({ userId }),
        db.collection("checklists").deleteMany({ userId })
      ]);
      deletedCounts = {
        projects: projRes.deletedCount,
        artifacts: artRes.deletedCount,
        checklists: chkRes.deletedCount
      };
    }

    return res.json({
      success: true,
      message: "Workspace test data reset successfully.",
      deleted: deletedCounts
    });
  } catch (error: any) {
    const safeError = sanitizeDiagnosticText(error?.message || "Internal server error");
    console.error(`Error in workspace reset: ${safeError}`);
    return res.status(500).json({ error: "Failed to reset workspace." });
  }
});

// 8. GET /api/data/recovery-snapshot - Retrieve latest recovery snapshot metadata for user
app.get("/api/data/recovery-snapshot", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;

    const snapshots = await db.collection("recovery_snapshots")
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    if (!snapshots || snapshots.length === 0) {
      return res.json({ success: true, snapshot: null });
    }

    const snap = snapshots[0];
    return res.json({
      success: true,
      snapshot: {
        snapshotId: snap.snapshotId,
        createdAt: snap.createdAt,
        timestamp: snap.timestamp,
        metadata: snap.metadata || {},
        projectsCount: Array.isArray(snap.projects) ? snap.projects.length : 0,
        checklistsCount: Array.isArray(snap.checklists) ? snap.checklists.length : 0
      }
    });
  } catch (error: any) {
    const safeError = sanitizeDiagnosticText(error?.message || "Internal server error");
    console.error(`Error retrieving recovery snapshot: ${safeError}`);
    return res.status(500).json({ error: "Failed to retrieve recovery snapshot." });
  }
});

// 9. DELETE /api/data/recovery-snapshot - Explicitly clear recovery snapshot for user
app.delete("/api/data/recovery-snapshot", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;

    const result = await db.collection("recovery_snapshots").deleteMany({ userId });
    return res.json({
      success: true,
      message: "Recovery snapshot cleared successfully.",
      deletedCount: result.deletedCount
    });
  } catch (error: any) {
    const safeError = sanitizeDiagnosticText(error?.message || "Internal server error");
    console.error(`Error deleting recovery snapshot: ${safeError}`);
    return res.status(500).json({ error: "Failed to clear recovery snapshot." });
  }
});

const MAX_BSON_DOC_BYTES = 14 * 1024 * 1024; // 14 MB safe threshold below MongoDB 16 MB limit
const ARTIFACT_FIELDS = ['testSuites', 'executions', 'defects'] as const;

function getApproxBsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

// Helper to query project documents by string business 'id' or BSON '_id' scoped by authenticated userId
function buildUserProjectQuery(idParam: string | string[], userId: string) {
  const cleanId = Array.isArray(idParam) ? idParam[0] : idParam;
  if (ObjectId.isValid(cleanId) && cleanId.length === 24) {
    return {
      $or: [
        { id: cleanId, userId },
        { _id: new ObjectId(cleanId), userId }
      ]
    };
  }
  return { id: cleanId, userId };
}

async function hydrateProjectWithArtifacts(project: any, userId: string): Promise<any> {
  if (!project || !db) return project;
  const hydrated = { ...project };
  const candidateIds = Array.from(
    new Set(
      [
        project.id ? String(project.id) : null,
        project._id ? String(project._id) : null
      ].filter((v): v is string => Boolean(v))
    )
  );
  if (candidateIds.length === 0) return hydrated;

  const projectIdFilter = candidateIds.length === 1 ? candidateIds[0] : { $in: candidateIds };
  const artifacts = await db
    .collection("project_artifacts")
    .find({ projectId: projectIdFilter, userId })
    .toArray();

  for (const art of artifacts) {
    if (art && typeof art.kind === 'string' && Array.isArray(art.items)) {
      hydrated[art.kind] = art.items;
    }
  }
  return hydrated;
}

function extractArtifactsFromProjects(projects: any[], userId: string): any[] {
  if (!Array.isArray(projects)) return [];
  const artifactDocs: any[] = [];
  const nowIso = new Date().toISOString();

  for (const proj of projects) {
    if (!proj || typeof proj !== 'object') continue;
    const projectId = String(proj.id || proj._id || '');
    if (!projectId) continue;
    const updatedAt = typeof proj.updatedAt === 'string' && proj.updatedAt ? proj.updatedAt : nowIso;

    for (const field of ARTIFACT_FIELDS) {
      if (Array.isArray(proj[field])) {
        artifactDocs.push({
          projectId,
          userId,
          kind: field,
          items: proj[field],
          updatedAt
        });
      }
    }
  }
  return artifactDocs;
}

// 10. POST /api/data/rollback - Restore workspace state from durable recovery snapshot
app.post("/api/data/rollback", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;

    const snapshots = await db.collection("recovery_snapshots")
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    if (!snapshots || snapshots.length === 0) {
      return res.status(404).json({ error: "No recovery snapshot found to restore." });
    }

    const targetSnapshot = snapshots[0];
    const restoredProjects = Array.isArray(targetSnapshot.projects)
      ? targetSnapshot.projects.map((p: any) => {
          const copy = { ...p, userId };
          delete copy._id;
          return copy;
        })
      : [];
    const restoredChecklists = Array.isArray(targetSnapshot.checklists)
      ? targetSnapshot.checklists.map((c: any) => {
          const copy = { ...c, userId };
          delete copy._id;
          return copy;
        })
      : [];
    const restoredArtifacts = extractArtifactsFromProjects(restoredProjects, userId);

    let txSuccess = false;
    if (mongoClientInstance && typeof mongoClientInstance.startSession === 'function') {
      let session: any = null;
      try {
        session = mongoClientInstance.startSession();
        await session.withTransaction(async () => {
          await db.collection("projects").deleteMany({ userId }, { session });
          await db.collection("project_artifacts").deleteMany({ userId }, { session });
          await db.collection("checklists").deleteMany({ userId }, { session });
          if (restoredProjects.length > 0) {
            await db.collection("projects").insertMany(restoredProjects, { session });
          }
          if (restoredArtifacts.length > 0) {
            await db.collection("project_artifacts").insertMany(restoredArtifacts, { session });
          }
          if (restoredChecklists.length > 0) {
            await db.collection("checklists").insertMany(restoredChecklists, { session });
          }
          await db.collection("recovery_snapshots").deleteOne({ _id: targetSnapshot._id }, { session });
        });
        txSuccess = true;
      } catch (txErr: any) {
        console.warn(`[Qavora Server] Rollback transaction unsupported or failed: ${sanitizeDiagnosticText(txErr?.message)}`);
      } finally {
        if (session) await session.endSession().catch(() => {});
      }
    }

    if (!txSuccess) {
      const currentProjects = await db.collection("projects").find({ userId }).toArray();
      const currentArtifacts = await db.collection("project_artifacts").find({ userId }).toArray();
      const currentChecklists = await db.collection("checklists").find({ userId }).toArray();

      try {
        await db.collection("projects").deleteMany({ userId });
        await db.collection("project_artifacts").deleteMany({ userId });
        await db.collection("checklists").deleteMany({ userId });
        if (restoredProjects.length > 0) {
          await db.collection("projects").insertMany(restoredProjects);
        }
        if (restoredArtifacts.length > 0) {
          await db.collection("project_artifacts").insertMany(restoredArtifacts);
        }
        if (restoredChecklists.length > 0) {
          await db.collection("checklists").insertMany(restoredChecklists);
        }
        await db.collection("recovery_snapshots").deleteOne({ _id: targetSnapshot._id });
      } catch (opErr: any) {
        console.error(`[Qavora Server] Rollback failed midway; restoring pre-rollback state...`);
        try {
          await db.collection("projects").deleteMany({ userId });
          await db.collection("project_artifacts").deleteMany({ userId });
          await db.collection("checklists").deleteMany({ userId });
          if (currentProjects.length > 0) {
            await db.collection("projects").insertMany(currentProjects);
          }
          if (currentArtifacts.length > 0) {
            await db.collection("project_artifacts").insertMany(currentArtifacts);
          }
          if (currentChecklists.length > 0) {
            await db.collection("checklists").insertMany(currentChecklists);
          }
        } catch (rescueErr: any) {
          console.error(`[Qavora Server FATAL] Rollback rescue failed: ${rescueErr?.message}`);
        }
        return res.status(500).json({ error: "Failed to execute rollback. Pre-rollback workspace state was preserved." });
      }
    }

    return res.json({
      success: true,
      message: "Rollback executed successfully. Workspace restored to snapshot state.",
      restored: {
        projects: restoredProjects.length,
        checklists: restoredChecklists.length
      }
    });
  } catch (error: any) {
    const safeError = sanitizeDiagnosticText(error?.message || "Internal server error");
    console.error(`Error in rollback execution: ${safeError}`);
    return res.status(500).json({ error: "Failed to execute rollback." });
  }
});

// 11. POST /api/data/import - Safe merge or atomic replace import with pre-replacement snapshot
app.post("/api/data/import", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;

    const { mode, projects, checklists } = req.body || {};

    if (mode !== 'merge' && mode !== 'replace') {
      return res.status(400).json({ error: "Field 'mode' must be either 'merge' or 'replace'." });
    }

    if (projects !== undefined && !Array.isArray(projects)) {
      return res.status(400).json({ error: "Field 'projects' must be an array if provided." });
    }

    if (checklists !== undefined && !Array.isArray(checklists)) {
      return res.status(400).json({ error: "Field 'checklists' must be an array if provided." });
    }

    const rawProjects = Array.isArray(projects) ? projects : [];
    const rawChecklists = Array.isArray(checklists) ? checklists : [];

    if (rawProjects.length === 0 && rawChecklists.length === 0) {
      return res.status(400).json({ error: "Import payload must contain at least one project or checklist." });
    }

    const now = new Date().toISOString();

    // Validate and normalize all projects BEFORE touching the database
    const normalizedProjects: any[] = [];
    for (let idx = 0; idx < rawProjects.length; idx++) {
      const p = rawProjects[idx];
      if (!p || typeof p !== 'object') {
        return res.status(400).json({ error: `Project at index ${idx} is not a valid object.` });
      }
      if (typeof p.name !== 'string' || p.name.trim() === '') {
        return res.status(400).json({ error: `Project at index ${idx} must have a non-empty 'name' string.` });
      }

      const projId = (typeof p.id === 'string' && p.id.trim())
        ? p.id.trim()
        : `proj_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`;
      const projName = p.name.trim();

      // Normalize testPlan and root-level phases
      let testPlan = p.testPlan && typeof p.testPlan === 'object' ? { ...p.testPlan } : null;
      if (!testPlan) {
        testPlan = {
          id: `plan_${projId}`,
          name: `${projName} Master Test Plan`,
          description: '',
          objective: '',
          scope: '',
          notes: '',
          createdAt: p.createdAt || now,
          updatedAt: now,
          phases: []
        };
      }
      if (!Array.isArray(testPlan.phases)) {
        testPlan.phases = [];
      }

      let testSuites = Array.isArray(p.testSuites) ? [...p.testSuites] : [];

      // Convert root-level phases into testPlan.phases and extract nested suites
      if (Array.isArray(p.phases)) {
        p.phases.forEach((ph: any, pIdx: number) => {
          if (!ph || typeof ph !== 'object') return;
          const phaseId = (typeof ph.id === 'string' && ph.id.trim()) ? ph.id.trim() : `ph_${projId}_${pIdx}`;
          const phaseName = (typeof ph.name === 'string' && ph.name.trim()) ? ph.name.trim() : (ph.title || `Phase ${pIdx + 1}`);

          if (!testPlan.phases.some((existing: any) => existing.id === phaseId)) {
            testPlan.phases.push({
              id: phaseId,
              name: phaseName,
              status: ph.status || 'Active',
              order: typeof ph.order === 'number' ? ph.order : pIdx,
              description: ph.description || ''
            });
          }

          if (Array.isArray(ph.suites)) {
            ph.suites.forEach((su: any, sIdx: number) => {
              if (!su || typeof su !== 'object') return;
              const suiteId = (typeof su.id === 'string' && su.id.trim()) ? su.id.trim() : `su_${phaseId}_${sIdx}`;
              if (!testSuites.some((existing: any) => existing.id === suiteId)) {
                testSuites.push({
                  id: suiteId,
                  phaseId,
                  title: su.title || su.name || `Suite ${sIdx + 1}`,
                  description: su.description || '',
                  cases: Array.isArray(su.cases) ? su.cases : (Array.isArray(su.testCases) ? su.testCases : []),
                  tags: Array.isArray(su.tags) ? su.tags : [],
                  createdAt: su.createdAt || now,
                  updatedAt: now
                });
              }
            });
          }
        });
      }

      // Normalize testSuites cases
      testSuites = testSuites.map((su: any, sIdx: number) => {
        const rawCases = Array.isArray(su.cases) ? su.cases : (Array.isArray(su.testCases) ? su.testCases : []);
        const normalizedCases = rawCases.map((tc: any, cIdx: number) => ({
          id: tc?.id || `tc_${su.id || sIdx}_${cIdx}`,
          title: tc?.title || tc?.name || `Test Case ${cIdx + 1}`,
          description: tc?.description || '',
          preconditions: tc?.preconditions || '',
          steps: Array.isArray(tc?.steps) ? tc.steps : [],
          expectedResult: tc?.expectedResult || '',
          status: tc?.status || 'Active',
          priority: tc?.priority || 'Medium',
          severity: tc?.severity || 'Medium',
          tags: Array.isArray(tc?.tags) ? tc.tags : [],
          createdAt: tc?.createdAt || now,
          updatedAt: now
        }));

        return {
          id: su?.id || `su_${projId}_${sIdx}`,
          phaseId: su?.phaseId || (testPlan.phases[0]?.id || `ph_${projId}_0`),
          title: su?.title || su?.name || `Suite ${sIdx + 1}`,
          name: su?.name || su?.title || `Suite ${sIdx + 1}`,
          description: su?.description || '',
          cases: normalizedCases,
          tags: Array.isArray(su?.tags) ? su.tags : [],
          createdAt: su?.createdAt || now,
          updatedAt: now
        };
      });

      const phases = testPlan.phases.map((ph: any) => ({ ...ph }));
      const executions = Array.isArray(p.executions) ? p.executions : [];
      const defects = Array.isArray(p.defects) ? p.defects : [];

      // QAV-FINAL-002: Normalize canonical 'type' property while supporting legacy 'projectType'
      const resolvedType = (typeof p.type === 'string' && p.type.trim())
        ? p.type.trim()
        : ((typeof p.projectType === 'string' && p.projectType.trim())
            ? p.projectType.trim()
            : 'Web Application');

      const cleanProj: any = {
        id: projId,
        userId,
        name: projName,
        description: typeof p.description === 'string' ? p.description : '',
        type: resolvedType,
        version: typeof p.version === 'string' ? p.version.trim() : (typeof p.version === 'number' ? String(p.version) : ''),
        status: typeof p.status === 'string' ? p.status : 'Active',
        testPlan,
        testSuites,
        phases,
        executions,
        defects,
        createdAt: p.createdAt || now,
        updatedAt: now
      };
      if (p.sourceChecklistId) cleanProj.sourceChecklistId = p.sourceChecklistId;
      if (p.promotedFromChecklistTitle) cleanProj.promotedFromChecklistTitle = p.promotedFromChecklistTitle;
      if (p.promotedAt) cleanProj.promotedAt = p.promotedAt;
      if (typeof p.environment === 'string') cleanProj.environment = p.environment;
      if (typeof p.baseUrl === 'string') cleanProj.baseUrl = p.baseUrl;
      if (Array.isArray(p.tags)) cleanProj.tags = p.tags;
      if (Array.isArray(p.executionRuns)) cleanProj.executionRuns = p.executionRuns;
      if (p.activeRun !== undefined) cleanProj.activeRun = p.activeRun;

      delete cleanProj._id;
      normalizedProjects.push(cleanProj);
    }

    // Validate and normalize all checklists BEFORE touching the database
    const normalizedChecklists: any[] = [];
    for (let idx = 0; idx < rawChecklists.length; idx++) {
      const c = rawChecklists[idx];
      if (!c || typeof c !== 'object') {
        return res.status(400).json({ error: `Checklist at index ${idx} is not a valid object.` });
      }
      if (typeof c.title !== 'string' || c.title.trim() === '') {
        return res.status(400).json({ error: `Checklist at index ${idx} must have a non-empty 'title' string.` });
      }

      const chkId = (typeof c.id === 'string' && c.id.trim())
        ? c.id.trim()
        : `chk_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`;

      const cleanChk: any = {
        id: chkId,
        userId,
        schemaVersion: typeof c.schemaVersion === 'number' ? c.schemaVersion : 1,
        title: c.title.trim(),
        documentNotes: Array.isArray(c.documentNotes) ? c.documentNotes : [],
        phases: Array.isArray(c.phases) ? c.phases : [],
        promotedProjectId: c.promotedProjectId || null,
        promotedAt: c.promotedAt || null,
        createdAt: c.createdAt || now,
        updatedAt: now
      };
      delete cleanChk._id;
      normalizedChecklists.push(cleanChk);
    }

    if (mode === 'replace') {
      // 1. Fetch current user data and hydrate projects with their artifacts before creating recovery snapshot
      const rawExistingProjects = await db.collection("projects").find({ userId }).toArray();
      const existingProjects = await Promise.all(
        rawExistingProjects.map((p: any) => hydrateProjectWithArtifacts(p, userId))
      );
      const existingArtifacts = await db.collection("project_artifacts").find({ userId }).toArray();
      const existingChecklists = await db.collection("checklists").find({ userId }).toArray();

      const snapshotDoc = {
        userId,
        snapshotId: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        createdAt: now,
        timestamp: new Date().toLocaleString(),
        metadata: {
          totalProjects: existingProjects.length,
          totalChecklists: existingChecklists.length,
          source: 'replace_import',
          description: `Pre-replacement snapshot (${existingProjects.length} projects, ${existingChecklists.length} checklists)`
        },
        projects: existingProjects.map((p: any) => { const copy = { ...p }; delete copy._id; return copy; }),
        checklists: existingChecklists.map((c: any) => { const copy = { ...c }; delete copy._id; return copy; })
      };

      await db.collection("recovery_snapshots").insertOne(snapshotDoc);

      const newArtifactDocs = extractArtifactsFromProjects(normalizedProjects, userId);

      // 2. Perform replace atomically with MongoDB transaction if available
      let txSuccess = false;
      if (mongoClientInstance && typeof mongoClientInstance.startSession === 'function') {
        let session: any = null;
        try {
          session = mongoClientInstance.startSession();
          await session.withTransaction(async () => {
            await db.collection("projects").deleteMany({ userId }, { session });
            await db.collection("project_artifacts").deleteMany({ userId }, { session });
            await db.collection("checklists").deleteMany({ userId }, { session });
            if (normalizedProjects.length > 0) {
              await db.collection("projects").insertMany(normalizedProjects, { session });
            }
            if (newArtifactDocs.length > 0) {
              await db.collection("project_artifacts").insertMany(newArtifactDocs, { session });
            }
            if (normalizedChecklists.length > 0) {
              await db.collection("checklists").insertMany(normalizedChecklists, { session });
            }
          });
          txSuccess = true;
        } catch (txErr: any) {
          console.warn(`[Qavora Server] Import transaction unsupported or failed: ${sanitizeDiagnosticText(txErr?.message)}`);
        } finally {
          if (session) await session.endSession().catch(() => {});
        }
      }

      if (!txSuccess) {
        // Safe non-transactional replace with snapshot & artifact rollback recovery if anything fails:
        try {
          await db.collection("projects").deleteMany({ userId });
          await db.collection("project_artifacts").deleteMany({ userId });
          await db.collection("checklists").deleteMany({ userId });
          if (normalizedProjects.length > 0) {
            const resP = await db.collection("projects").insertMany(normalizedProjects);
            if (resP.insertedCount !== normalizedProjects.length) {
              throw new Error(`Incomplete project insertion: expected ${normalizedProjects.length}, inserted ${resP.insertedCount}`);
            }
          }
          if (newArtifactDocs.length > 0) {
            const resA = await db.collection("project_artifacts").insertMany(newArtifactDocs);
            if (resA.insertedCount !== newArtifactDocs.length) {
              throw new Error(`Incomplete artifact insertion: expected ${newArtifactDocs.length}, inserted ${resA.insertedCount}`);
            }
          }
          if (normalizedChecklists.length > 0) {
            const resC = await db.collection("checklists").insertMany(normalizedChecklists);
            if (resC.insertedCount !== normalizedChecklists.length) {
              throw new Error(`Incomplete checklist insertion: expected ${normalizedChecklists.length}, inserted ${resC.insertedCount}`);
            }
          }
        } catch (replaceErr: any) {
          console.error(`[Qavora Server] Replace import failed midway; restoring from snapshot...`);
          try {
            await db.collection("projects").deleteMany({ userId });
            await db.collection("project_artifacts").deleteMany({ userId });
            await db.collection("checklists").deleteMany({ userId });
            if (rawExistingProjects.length > 0) {
              await db.collection("projects").insertMany(rawExistingProjects.map((p: any) => ({ ...p, userId })));
            }
            if (existingArtifacts.length > 0) {
              await db.collection("project_artifacts").insertMany(existingArtifacts.map((a: any) => ({ ...a, userId })));
            }
            if (existingChecklists.length > 0) {
              await db.collection("checklists").insertMany(existingChecklists.map((c: any) => ({ ...c, userId })));
            }
            await db.collection("recovery_snapshots").deleteOne({ snapshotId: snapshotDoc.snapshotId, userId });
          } catch (rescueErr: any) {
            console.error(`[Qavora Server FATAL] Auto-recovery failed: ${rescueErr?.message}`);
          }
          return res.status(500).json({
            error: "Failed to replace import data. Workspace restored from pre-replacement snapshot.",
            details: sanitizeDiagnosticText(replaceErr?.message)
          });
        }
      }

      return res.json({
        success: true,
        mode: "replace",
        message: `Successfully replaced workspace with ${normalizedProjects.length} project(s) and ${normalizedChecklists.length} checklist(s).`,
        imported: {
          projects: normalizedProjects.length,
          checklists: normalizedChecklists.length
        },
        snapshotCreated: true,
        snapshotId: snapshotDoc.snapshotId
      });
    } else {
      // Merge mode: resolve ID collisions for authenticated user
      const existingProjects = await db.collection("projects").find({ userId }).toArray();
      const existingChecklists = await db.collection("checklists").find({ userId }).toArray();
      const existingProjIds = new Set(existingProjects.map((p: any) => p.id));
      const existingChkIds = new Set(existingChecklists.map((c: any) => c.id));

      for (const p of normalizedProjects) {
        if (existingProjIds.has(p.id)) {
          p.id = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          p.name = `${p.name} (Imported)`;
        }
        existingProjIds.add(p.id);
      }

      for (const c of normalizedChecklists) {
        if (existingChkIds.has(c.id)) {
          c.id = `chk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          c.title = `${c.title} (Imported)`;
        }
        existingChkIds.add(c.id);
      }

      const mergeProjectIds = normalizedProjects.map((p: any) => p.id);
      const mergeArtifactDocs = extractArtifactsFromProjects(normalizedProjects, userId);

      let txSuccess = false;
      if (mongoClientInstance && typeof mongoClientInstance.startSession === 'function') {
        let session: any = null;
        try {
          session = mongoClientInstance.startSession();
          await session.withTransaction(async () => {
            if (mergeProjectIds.length > 0) {
              await db.collection("project_artifacts").deleteMany(
                { userId, projectId: { $in: mergeProjectIds } },
                { session }
              );
            }
            if (normalizedProjects.length > 0) {
              await db.collection("projects").insertMany(normalizedProjects, { session });
            }
            if (mergeArtifactDocs.length > 0) {
              await db.collection("project_artifacts").insertMany(mergeArtifactDocs, { session });
            }
            if (normalizedChecklists.length > 0) {
              await db.collection("checklists").insertMany(normalizedChecklists, { session });
            }
          });
          txSuccess = true;
        } catch (txErr: any) {
          console.warn(`[Qavora Server] Merge import transaction unsupported or failed: ${sanitizeDiagnosticText(txErr?.message)}`);
        } finally {
          if (session) await session.endSession().catch(() => {});
        }
      }

      if (!txSuccess) {
        if (mergeProjectIds.length > 0) {
          await db.collection("project_artifacts").deleteMany({
            userId,
            projectId: { $in: mergeProjectIds }
          });
        }
        if (normalizedProjects.length > 0) {
          await db.collection("projects").insertMany(normalizedProjects);
        }
        if (mergeArtifactDocs.length > 0) {
          await db.collection("project_artifacts").insertMany(mergeArtifactDocs);
        }
        if (normalizedChecklists.length > 0) {
          await db.collection("checklists").insertMany(normalizedChecklists);
        }
      }

      return res.json({
        success: true,
        mode: "merge",
        message: `Successfully merged ${normalizedProjects.length} project(s) and ${normalizedChecklists.length} checklist(s).`,
        imported: {
          projects: normalizedProjects.length,
          checklists: normalizedChecklists.length
        }
      });
    }
  } catch (error: any) {
    const safeError = sanitizeDiagnosticText(error?.message || "Internal server error");
    console.error(`Error in import handler: ${safeError}`);
    return res.status(500).json({ error: "Failed to process import." });
  }
});

// GET /api/tests endpoint - Fetch user-owned documents from the 'tests' collection
app.get("/api/tests", requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;
    const tests = await db.collection("tests").find({ userId }).toArray();
    return res.json(tests);
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.warn(`[AI Studio] Error querying tests collection: ${safeError}.`);
    return res.status(500).json({ error: "Failed to fetch tests." });
  }
});

// POST /api/tests endpoint - Save a new user-owned test document to the 'tests' collection
app.post("/api/tests", requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;
    const { name, status } = req.body || {};

    if (
      typeof name !== "string" ||
      typeof status !== "string" ||
      name.trim() === "" ||
      status.trim() === ""
    ) {
      return res.status(400).json({
        error: "Both 'name' and 'status' are required and must be non-empty strings."
      });
    }

    const trimmedName = name.trim();
    const trimmedStatus = status.trim();

    const newTest = {
      name: trimmedName,
      status: trimmedStatus,
      userId
    };

    const result = await db.collection("tests").insertOne(newTest);

    return res.status(201).json({
      _id: result.insertedId,
      name: trimmedName,
      status: trimmedStatus,
      userId
    });
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error saving test to database: ${safeError}`);
    return res.status(500).json({
      error: "Failed to save test."
    });
  }
});

// ============================================================================
// Projects & Workspaces MongoDB API Endpoints
// ============================================================================

function requireDatabase(req: Request, res: Response, next: NextFunction) {
  if (!db) {
    return res.status(503).json({
      error: "Service temporarily unavailable (database offline)."
    });
  }
  next();
}

app.use('/api/projects', requireDatabase);

const ALLOWED_PROJECT_CREATE_FIELDS = new Set([
  'id',
  'name',
  'type',
  'projectType',
  'version',
  'description',
  'status',
  'environment',
  'environments',
  'baseUrl',
  'tags',
  'createdAt',
  'updatedAt',
  'testPlan',
  'testSuites',
  'phases',
  'executions',
  'executionRuns',
  'activeRun',
  'defects',
  'team',
  'automation',
  'testData',
  'sourceChecklistId',
  'promotedFromChecklistTitle',
  'promotedAt',
  'testCaseCount',
  'executedTests',
  'passedTests',
  'failedTests',
  'blockedTests',
  'skippedTests',
  'notRunTests',
  'passRate',
  'totalDefects',
  'openDefects',
  'inProgressDefects',
  'resolvedDefects',
  'closedDefects',
  'criticalDefects'
]);

const ALLOWED_PROJECT_PUT_FIELDS = new Set([
  'name',
  'type',
  'version',
  'description',
  'status',
  'environment',
  'baseUrl',
  'tags'
]);

const ALLOWED_PROJECT_PATCH_FIELDS = new Set([
  'name',
  'type',
  'version',
  'description',
  'status',
  'environment',
  'baseUrl',
  'tags',
  'expectedUpdatedAt'
]);

const ALLOWED_PROJECT_DATA_PATCH_FIELDS = new Set([
  'name',
  'type',
  'projectType',
  'version',
  'description',
  'status',
  'environment',
  'environments',
  'baseUrl',
  'tags',
  'testPlan',
  'testSuites',
  'phases',
  'executions',
  'executionRuns',
  'activeRun',
  'defects',
  'team',
  'automation',
  'testData',
  'sourceChecklistId',
  'promotedFromChecklistTitle',
  'promotedAt',
  'testCaseCount',
  'executedTests',
  'passedTests',
  'failedTests',
  'blockedTests',
  'skippedTests',
  'notRunTests',
  'passRate',
  'totalDefects',
  'openDefects',
  'inProgressDefects',
  'resolvedDefects',
  'closedDefects',
  'criticalDefects',
  'expectedUpdatedAt'
]);

// 1. GET /api/projects - Fetch all projects for the authenticated user (with optional status filter)
app.get("/api/projects", requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;

    const filter: any = { userId };
    if (typeof req.query.status === 'string' && req.query.status.trim()) {
      filter.status = req.query.status.trim();
    }

    const projects = await db.collection("projects").find(filter).toArray();
    const hydratedProjects = await Promise.all(
      projects.map((p: any) => hydrateProjectWithArtifacts(p, userId))
    );
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.json(hydratedProjects);
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error fetching projects: ${safeError}`);
    return res.status(500).json({ error: "Failed to fetch projects." });
  }
});

// 2. GET /api/projects/:id - Fetch a single user-owned project by ID
app.get("/api/projects/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;

    const query = buildUserProjectQuery(req.params.id, userId);
    const project = await db.collection("projects").findOne(query);

    if (!project) {
      return res.status(404).json({ error: "Project not found." });
    }

    const hydrated = await hydrateProjectWithArtifacts(project, userId);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.json(hydrated);
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error fetching project ${req.params.id}: ${safeError}`);
    return res.status(500).json({ error: "Failed to fetch project." });
  }
});

// 3. POST /api/projects - Create a new user-owned project document
app.post("/api/projects", requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;
    const body = req.body;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: "Request body must be a valid JSON object." });
    }

    if (containsProhibitedKeys(body)) {
      return res.status(400).json({
        error: "Request body contains prohibited keys (NoSQL operators, dotted paths, or prototype pollution keys are not allowed)."
      });
    }

    const disallowedCreateKeys = Object.keys(body).filter((k) => !ALLOWED_PROJECT_CREATE_FIELDS.has(k));
    if (disallowedCreateKeys.length > 0) {
      return res.status(400).json({
        error: `Disallowed field(s) in project payload: ${disallowedCreateKeys.join(', ')}.`
      });
    }

    const { name, type, version, description, status, id, ...extraData } = body;

    if (typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: "Field 'name' is required and must be a non-empty string." });
    }

    if (status !== undefined && !['Active', 'Completed', 'Archived'].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Must be 'Active', 'Completed', or 'Archived'." });
    }

    const trimmedName = name.trim();
    const projectId = (typeof id === 'string' && id.trim())
      ? id.trim()
      : `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const now = new Date().toISOString();
    const resolvedType = (typeof type === 'string' && type.trim())
      ? type.trim()
      : ((typeof extraData.projectType === 'string' && extraData.projectType.trim())
          ? extraData.projectType.trim()
          : 'Web Application');

    // Enforce per-user project ID uniqueness (prevents duplicate offline submissions)
    const existingForUser = await db.collection("projects").findOne({ id: projectId, userId });
    if (existingForUser) {
      return res.status(409).json({
        error: "A project with this ID already exists.",
        projectId,
        currentUpdatedAt: existingForUser.updatedAt || null
      });
    }

    const newProject: any = {
      id: projectId,
      userId,
      name: trimmedName,
      type: resolvedType,
      status: ['Active', 'Completed', 'Archived'].includes(status) ? status : 'Active',
      version: typeof version === 'string' ? version.trim() : (typeof version === 'number' ? String(version) : ''),
      description: typeof description === 'string' ? description.trim() : '',
      createdAt: extraData.createdAt || now,
      updatedAt: now,
      testPlan: extraData.testPlan || {
        id: `plan_${projectId}`,
        name: `${trimmedName} Master Test Plan`,
        description: '',
        objective: '',
        scope: '',
        notes: '',
        createdAt: now,
        updatedAt: now,
        phases: []
      },
      testSuites: Array.isArray(extraData.testSuites) ? extraData.testSuites : [],
      executions: Array.isArray(extraData.executions) ? extraData.executions : [],
      defects: Array.isArray(extraData.defects) ? extraData.defects : []
    };

    if (Array.isArray(extraData.executionRuns)) newProject.executionRuns = extraData.executionRuns;
    if (extraData.activeRun !== undefined) newProject.activeRun = extraData.activeRun;
    if (typeof extraData.environment === 'string') newProject.environment = extraData.environment.trim();
    if (Array.isArray(extraData.environments)) newProject.environments = extraData.environments;
    if (typeof extraData.baseUrl === 'string') newProject.baseUrl = extraData.baseUrl.trim();
    if (Array.isArray(extraData.tags)) newProject.tags = extraData.tags;
    if (extraData.sourceChecklistId) newProject.sourceChecklistId = extraData.sourceChecklistId;
    if (extraData.promotedFromChecklistTitle) newProject.promotedFromChecklistTitle = extraData.promotedFromChecklistTitle;
    if (extraData.promotedAt) newProject.promotedAt = extraData.promotedAt;

    const result = await db.collection("projects").insertOne(newProject);

    return res.status(201).json({
      _id: result.insertedId,
      ...newProject
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: "A project with this ID already exists." });
    }
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error creating project: ${safeError}`);
    return res.status(500).json({ error: "Failed to create project." });
  }
});

// 4. PUT /api/projects/:id - Update project metadata using $set (never replaces entire document)
app.put("/api/projects/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;
    const body = req.body;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: "Request body must be a valid JSON object." });
    }

    if (containsProhibitedKeys(body)) {
      return res.status(400).json({
        error: "Request body contains prohibited keys (NoSQL operators, dotted paths, or prototype pollution keys are not allowed)."
      });
    }

    const keys = Object.keys(body);
    if (keys.length === 0) {
      return res.status(400).json({ error: "Update payload cannot be empty." });
    }

    const disallowedPutKeys = keys.filter((k) => !ALLOWED_PROJECT_PUT_FIELDS.has(k));
    if (disallowedPutKeys.length > 0) {
      return res.status(400).json({
        error: `Disallowed field(s) in update payload: ${disallowedPutKeys.join(', ')}.`
      });
    }

    const { name, type, version, description, status, environment, baseUrl, tags } = body;

    const updateFields: any = {
      updatedAt: new Date().toISOString()
    };

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: "Field 'name' must be a non-empty string." });
      }
      updateFields.name = name.trim();
    }

    if (type !== undefined) {
      if (typeof type !== 'string' || type.trim() === '') {
        return res.status(400).json({ error: "Field 'type' must be a non-empty string." });
      }
      updateFields.type = type.trim();
    }

    if (version !== undefined) {
      updateFields.version = typeof version === 'string' ? version.trim() : String(version);
    }

    if (description !== undefined) {
      updateFields.description = typeof description === 'string' ? description.trim() : '';
    }

    if (status !== undefined) {
      if (!['Active', 'Completed', 'Archived'].includes(status)) {
        return res.status(400).json({ error: "Invalid status. Must be 'Active', 'Completed', or 'Archived'." });
      }
      updateFields.status = status;
    }

    if (environment !== undefined) {
      if (typeof environment !== 'string') {
        return res.status(400).json({ error: "Field 'environment' must be a string." });
      }
      updateFields.environment = environment.trim();
    }

    if (baseUrl !== undefined) {
      if (typeof baseUrl !== 'string') {
        return res.status(400).json({ error: "Field 'baseUrl' must be a string." });
      }
      updateFields.baseUrl = baseUrl.trim();
    }

    if (tags !== undefined) {
      if (!Array.isArray(tags) || !tags.every((t: unknown) => typeof t === 'string')) {
        return res.status(400).json({ error: "Field 'tags' must be an array of strings." });
      }
      updateFields.tags = tags.map((t: string) => t.trim());
    }

    const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }

    const query = buildUserProjectQuery(idParam, userId);
    const result = await db.collection("projects").findOneAndUpdate(
      query,
      { $set: updateFields },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: "Project not found." });
    }

    const hydrated = await hydrateProjectWithArtifacts(result, userId);
    return res.json(hydrated);
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error updating project ${req.params.id}: ${safeError}`);
    return res.status(500).json({ error: "Failed to update project." });
  }
});

// 4b. PATCH /api/projects/:id - Strictly whitelisted partial project update
app.patch("/api/projects/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;
    const body = req.body;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: "Request body must be a valid JSON object." });
    }

    const keys = Object.keys(body);
    if (keys.length === 0) {
      return res.status(400).json({ error: "Update payload cannot be empty." });
    }

    if (containsProhibitedKeys(body)) {
      return res.status(400).json({
        error: "Invalid update payload: NoSQL operators, dotted paths, and prototype pollution keys are not permitted."
      });
    }

    const disallowedKeys = keys.filter((k) => !ALLOWED_PROJECT_PATCH_FIELDS.has(k));
    if (disallowedKeys.length > 0) {
      return res.status(400).json({
        error: `Disallowed field(s) in update payload: ${disallowedKeys.join(', ')}.`
      });
    }

    const expectedUpdatedAt = body.expectedUpdatedAt;
    if (expectedUpdatedAt !== undefined) {
      if (typeof expectedUpdatedAt !== 'string' || expectedUpdatedAt.trim() === '') {
        return res.status(400).json({ error: "Field 'expectedUpdatedAt' must be a non-empty string when provided." });
      }
    }

    const dataFieldKeys = keys.filter((k) => k !== 'expectedUpdatedAt');
    if (dataFieldKeys.length === 0) {
      return res.status(400).json({ error: "Request body must contain at least one field to update." });
    }

    const nowIso = new Date().toISOString();
    const updateFields: Record<string, unknown> = {
      updatedAt: (expectedUpdatedAt && nowIso === expectedUpdatedAt)
        ? new Date(Date.now() + 1).toISOString()
        : nowIso
    };

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        return res.status(400).json({ error: "Field 'name' must be a non-empty string." });
      }
      updateFields.name = body.name.trim();
    }

    if (body.type !== undefined) {
      if (typeof body.type !== 'string' || body.type.trim() === '') {
        return res.status(400).json({ error: "Field 'type' must be a non-empty string." });
      }
      updateFields.type = body.type.trim();
    }

    if (body.version !== undefined) {
      if (typeof body.version !== 'string') {
        return res.status(400).json({ error: "Field 'version' must be a string." });
      }
      updateFields.version = body.version.trim();
    }

    if (body.description !== undefined) {
      if (typeof body.description !== 'string') {
        return res.status(400).json({ error: "Field 'description' must be a string." });
      }
      updateFields.description = body.description.trim();
    }

    if (body.status !== undefined) {
      if (typeof body.status !== 'string' || !['Active', 'Completed', 'Archived'].includes(body.status)) {
        return res.status(400).json({ error: "Invalid status. Must be 'Active', 'Completed', or 'Archived'." });
      }
      updateFields.status = body.status;
    }

    if (body.environment !== undefined) {
      if (typeof body.environment !== 'string') {
        return res.status(400).json({ error: "Field 'environment' must be a string." });
      }
      updateFields.environment = body.environment.trim();
    }

    if (body.baseUrl !== undefined) {
      if (typeof body.baseUrl !== 'string') {
        return res.status(400).json({ error: "Field 'baseUrl' must be a string." });
      }
      updateFields.baseUrl = body.baseUrl.trim();
    }

    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags) || !body.tags.every((t: unknown) => typeof t === 'string')) {
        return res.status(400).json({ error: "Field 'tags' must be an array of strings." });
      }
      updateFields.tags = body.tags.map((t: string) => t.trim());
    }

    const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }

    const baseQuery = buildUserProjectQuery(idParam, userId);
    let query: any;
    if (expectedUpdatedAt) {
      if (baseQuery.$or) {
        query = {
          $and: [
            baseQuery,
            { updatedAt: expectedUpdatedAt }
          ]
        };
      } else {
        query = {
          ...baseQuery,
          updatedAt: expectedUpdatedAt
        };
      }
    } else {
      query = baseQuery;
    }

    const result = await db.collection("projects").findOneAndUpdate(
      query,
      { $set: updateFields },
      { returnDocument: 'after' }
    );

    if (!result) {
      if (expectedUpdatedAt) {
        const existingDoc = await db.collection("projects").findOne(baseQuery);
        if (existingDoc) {
          return res.status(409).json({
            error: "Conflict: The project has been modified by another operation.",
            currentUpdatedAt: existingDoc.updatedAt || null,
            expectedUpdatedAt
          });
        }
      }
      return res.status(404).json({ error: "Project not found." });
    }

    const hydrated = await hydrateProjectWithArtifacts(result, userId);
    return res.json(hydrated);
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error patching project ${req.params.id}: ${safeError}`);
    return res.status(500).json({ error: "Failed to update project." });
  }
});

// 5. PATCH /api/projects/:id/status - Update project status
app.patch("/api/projects/:id/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;
    const body = req.body;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: "Request body must be a valid JSON object." });
    }

    if (containsProhibitedKeys(body)) {
      return res.status(400).json({
        error: "Request body contains prohibited keys (NoSQL operators, dotted paths, or prototype pollution keys are not allowed)."
      });
    }

    const { status } = body;
    if (!status || !['Active', 'Completed', 'Archived'].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Must be 'Active', 'Completed', or 'Archived'." });
    }

    const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }

    const query = buildUserProjectQuery(idParam, userId);
    const result = await db.collection("projects").findOneAndUpdate(
      query,
      {
        $set: {
          status,
          updatedAt: new Date().toISOString()
        }
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: "Project not found." });
    }

    const hydrated = await hydrateProjectWithArtifacts(result, userId);
    return res.json(hydrated);
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error updating project status ${req.params.id}: ${safeError}`);
    return res.status(500).json({ error: "Failed to update project status." });
  }
});

// 5b. PATCH /api/projects/:id/data - Full project and nested QA data update
app.patch("/api/projects/:id/data", requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;
    const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!idParam || typeof idParam !== 'string' || idParam.trim() === '') {
      return res.status(400).json({ error: "Project ID parameter is required and must be a non-empty string." });
    }
    const cleanId = idParam.trim();

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: "Request body must be a JSON object containing project update data." });
    }

    // QAV-FINAL-003: Reject MongoDB operators, dotted keys, and prototype pollution keys at any depth
    if (containsProhibitedKeys(req.body)) {
      return res.status(400).json({
        error: "Request body contains prohibited keys (NoSQL operators, dotted paths, or prototype pollution keys are not allowed)."
      });
    }

    const bodyKeys = Object.keys(req.body);
    const disallowedDataKeys = bodyKeys.filter((k) => !ALLOWED_PROJECT_DATA_PATCH_FIELDS.has(k));
    if (disallowedDataKeys.length > 0) {
      return res.status(400).json({
        error: `Disallowed field(s) in project data update payload: ${disallowedDataKeys.join(', ')}.`
      });
    }

    const { expectedUpdatedAt, ...allowedData } = req.body;

    if (expectedUpdatedAt !== undefined) {
      if (typeof expectedUpdatedAt !== 'string' || expectedUpdatedAt.trim() === '') {
        return res.status(400).json({ error: "Field 'expectedUpdatedAt' must be a non-empty string when provided." });
      }
    }

    if (Object.keys(allowedData).length === 0) {
      return res.status(400).json({ error: "Request body must contain at least one field to update." });
    }

    // Validation for specific known fields if provided
    if (allowedData.name !== undefined) {
      if (typeof allowedData.name !== 'string' || allowedData.name.trim() === '') {
        return res.status(400).json({ error: "Field 'name' must be a non-empty string." });
      }
      allowedData.name = allowedData.name.trim();
    }

    if (allowedData.type !== undefined) {
      if (typeof allowedData.type !== 'string' || allowedData.type.trim() === '') {
        return res.status(400).json({ error: "Field 'type' must be a non-empty string." });
      }
      allowedData.type = allowedData.type.trim();
    }

    if (allowedData.projectType !== undefined) {
      if (typeof allowedData.projectType !== 'string' || allowedData.projectType.trim() === '') {
        return res.status(400).json({ error: "Field 'projectType' must be a non-empty string." });
      }
      if (allowedData.type === undefined) {
        allowedData.type = allowedData.projectType.trim();
      }
      delete allowedData.projectType;
    }

    if (allowedData.status !== undefined) {
      if (!['Active', 'Completed', 'Archived'].includes(allowedData.status)) {
        return res.status(400).json({ error: "Invalid status. Must be 'Active', 'Completed', or 'Archived'." });
      }
    }

    if (allowedData.testPlan !== undefined) {
      if (typeof allowedData.testPlan !== 'object' || allowedData.testPlan === null || Array.isArray(allowedData.testPlan)) {
        return res.status(400).json({ error: "Field 'testPlan' must be an object." });
      }
    }

    if (allowedData.testSuites !== undefined && !Array.isArray(allowedData.testSuites)) {
      return res.status(400).json({ error: "Field 'testSuites' must be an array." });
    }

    if (allowedData.executions !== undefined && !Array.isArray(allowedData.executions)) {
      return res.status(400).json({ error: "Field 'executions' must be an array." });
    }

    if (allowedData.defects !== undefined && !Array.isArray(allowedData.defects)) {
      return res.status(400).json({ error: "Field 'defects' must be an array." });
    }

    // Ensure updatedAt timestamp reflects current modification and advances
    const nowIso = new Date().toISOString();
    allowedData.updatedAt = (expectedUpdatedAt && nowIso === expectedUpdatedAt)
      ? new Date(Date.now() + 1).toISOString()
      : nowIso;

    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }

    // Separate large embedded collections into dedicated project_artifacts collection
    const artifactUpdates: Record<string, any[]> = {};
    const unsetFields: Record<string, 1> = {};
    for (const field of ARTIFACT_FIELDS) {
      if (allowedData[field] !== undefined) {
        if (getApproxBsonBytes(allowedData[field]) > MAX_BSON_DOC_BYTES) {
          return res.status(413).json({
            error: `Field '${field}' exceeds maximum allowed document size (14 MB).`
          });
        }
        artifactUpdates[field] = allowedData[field];
        delete allowedData[field];
        unsetFields[field] = 1;
      }
    }

    if (getApproxBsonBytes(allowedData) > MAX_BSON_DOC_BYTES) {
      return res.status(413).json({
        error: "Project update payload exceeds maximum allowed document size (14 MB)."
      });
    }

    const baseQuery = buildUserProjectQuery(cleanId, userId);
    let query: any;
    if (expectedUpdatedAt) {
      if (baseQuery.$or) {
        query = {
          $and: [
            baseQuery,
            { updatedAt: expectedUpdatedAt }
          ]
        };
      } else {
        query = {
          ...baseQuery,
          updatedAt: expectedUpdatedAt
        };
      }
    } else {
      query = baseQuery;
    }

    const updateOp: any = { $set: allowedData };
    if (Object.keys(unsetFields).length > 0) {
      updateOp.$unset = unsetFields;
    }

    const result = await db.collection("projects").findOneAndUpdate(
      query,
      updateOp,
      { returnDocument: 'after' }
    );

    if (!result) {
      if (expectedUpdatedAt) {
        // Project may exist for this user but its updatedAt did not match expectedUpdatedAt (concurrent modification)
        const existingDoc = await db.collection("projects").findOne(baseQuery);
        if (existingDoc) {
          return res.status(409).json({
            error: "Conflict: The project has been modified by another operation.",
            currentUpdatedAt: existingDoc.updatedAt || null,
            expectedUpdatedAt
          });
        }
      }
      return res.status(404).json({ error: "Project not found." });
    }

    const projectId = String(result.id || cleanId);
    for (const [kind, items] of Object.entries(artifactUpdates)) {
      await db.collection("project_artifacts").updateOne(
        { projectId, userId, kind },
        {
          $set: {
            projectId,
            userId,
            kind,
            items,
            updatedAt: allowedData.updatedAt
          }
        },
        { upsert: true }
      );
    }

    const hydrated = await hydrateProjectWithArtifacts(result, userId);
    return res.json(hydrated);
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    if (
      error?.name === 'MongoNetworkError' ||
      error?.name === 'MongoServerSelectionError' ||
      error?.name === 'MongoTimeoutError' ||
      (error?.message && error.message.includes('buffering timed out'))
    ) {
      console.error(`Database unavailable during project data update: ${safeError}`);
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }
    console.error(`Error updating project data ${req.params.id}: ${safeError}`);
    return res.status(500).json({ error: "Failed to update project data." });
  }
});

// 6. DELETE /api/projects/:id - Delete a project document and all associated artifacts
app.delete("/api/projects/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;
    const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cleanId = typeof idParam === 'string' ? idParam.trim() : '';

    if (!cleanId) {
      return res.status(400).json({ error: "Project ID is required." });
    }

    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }

    const query = buildUserProjectQuery(cleanId, userId);
    const existingProject = await db.collection("projects").findOne(query);

    if (!existingProject) {
      return res.status(404).json({ error: "Project not found." });
    }

    const deleteQuery = existingProject._id
      ? { _id: existingProject._id, userId }
      : query;
    const result = await db.collection("projects").deleteOne(deleteQuery);

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Project not found." });
    }

    const candidateProjectIds = Array.from(
      new Set(
        [
          cleanId,
          existingProject.id ? String(existingProject.id) : null,
          existingProject._id ? String(existingProject._id) : null
        ].filter((val): val is string => Boolean(val))
      )
    );

    await db.collection("project_artifacts").deleteMany({
      userId,
      projectId: candidateProjectIds.length === 1 ? candidateProjectIds[0] : { $in: candidateProjectIds }
    });

    return res.json({ success: true, message: "Project deleted successfully." });
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error deleting project ${req.params.id}: ${safeError}`);
    return res.status(500).json({ error: "Failed to delete project." });
  }
});

// ============================================================================
// Standalone QA Checklists MongoDB API Endpoints (DAT-001)
// ============================================================================

// Helper to query checklist documents by string business 'id' or BSON '_id' scoped by authenticated userId
function buildUserChecklistQuery(idParam: string | string[], userId: string) {
  const cleanId = Array.isArray(idParam) ? idParam[0] : idParam;
  if (ObjectId.isValid(cleanId) && cleanId.length === 24) {
    return {
      $or: [
        { id: cleanId, userId },
        { _id: new ObjectId(cleanId), userId }
      ]
    };
  }
  return { id: cleanId, userId };
}

// 1. GET /api/checklists - Retrieve all checklists for the authenticated user
app.get("/api/checklists", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;

    const checklists = await db.collection("checklists").find({ userId }).toArray();
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.json(checklists);
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error fetching checklists: ${safeError}`);
    return res.status(500).json({ error: "Failed to fetch checklists." });
  }
});

// 2. GET /api/checklists/:id - Retrieve a specific checklist owned by the authenticated user
app.get("/api/checklists/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;

    const query = buildUserChecklistQuery(req.params.id, userId);
    const checklist = await db.collection("checklists").findOne(query);

    if (!checklist) {
      return res.status(404).json({ error: "Checklist not found." });
    }

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.json(checklist);
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error fetching checklist ${req.params.id}: ${safeError}`);
    return res.status(500).json({ error: "Failed to fetch checklist." });
  }
});

// ============================================================================
// NoSQL Operator & Prototype-Pollution Security Validation (QAV-AUDIT-001)
// ============================================================================

/**
 * Returns true if a key represents a NoSQL operator, dotted path, or prototype pollution vector.
 */
function isProhibitedKey(key: string): boolean {
  if (typeof key !== 'string') return true;
  if (key.startsWith('$')) return true;
  if (key.includes('.')) return true;
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') return true;
  return false;
}

/**
 * Recursively inspects every object, nested object, and array element.
 * Returns true if any prohibited key is detected at any depth.
 */
function containsProhibitedKeys(value: unknown, seen = new WeakSet()): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (containsProhibitedKeys(value[i], seen)) {
        return true;
      }
    }
    return false;
  }

  // Check own enumerable property names
  const ownKeys = Object.keys(value);
  for (const k of ownKeys) {
    if (isProhibitedKey(k)) {
      return true;
    }
    if (containsProhibitedKeys((value as any)[k], seen)) {
      return true;
    }
  }

  // Also check non-enumerable own properties via getOwnPropertyNames
  const ownNames = Object.getOwnPropertyNames(value);
  for (const k of ownNames) {
    if (isProhibitedKey(k)) {
      return true;
    }
  }

  // Explicit prototype pollution checks
  if (
    Object.prototype.hasOwnProperty.call(value, '__proto__') ||
    Object.prototype.hasOwnProperty.call(value, 'constructor') ||
    Object.prototype.hasOwnProperty.call(value, 'prototype')
  ) {
    return true;
  }

  return false;
}

const CHECKLIST_POST_ALLOWED_FIELDS = new Set([
  'id',
  'schemaVersion',
  'title',
  'documentNotes',
  'phases',
  'promotedProjectId',
  'promotedAt',
  'completedAt',
  'completedBy',
  'originalPrompt',
  'createdAt',
  'updatedAt'
]);

const CHECKLIST_PATCH_ALLOWED_FIELDS = new Set([
  'title',
  'schemaVersion',
  'documentNotes',
  'phases',
  'promotedProjectId',
  'promotedAt',
  'completedAt',
  'completedBy',
  'originalPrompt',
  'expectedUpdatedAt'
]);

// 3. POST /api/checklists - Create and persist a new checklist for the authenticated user
app.post("/api/checklists", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: "Request body must be a valid JSON object." });
    }

    // 1. Recursive prohibited key detection (NoSQL operators, dotted paths, prototype pollution)
    if (containsProhibitedKeys(req.body)) {
      return res.status(400).json({ error: "Invalid request: Request body contains unsafe or prohibited property keys." });
    }

    // 2. Reject attempts to supply server-controlled fields
    if ('_id' in req.body || 'userId' in req.body) {
      return res.status(400).json({ error: "Cannot set server-controlled fields (_id, userId)." });
    }

    // 3. Top-level field allowlisting
    const bodyKeys = Object.keys(req.body);
    for (const key of bodyKeys) {
      if (!CHECKLIST_POST_ALLOWED_FIELDS.has(key)) {
        return res.status(400).json({ error: `Invalid or unrecognized field: '${key}'.` });
      }
    }

    const {
      title,
      id,
      schemaVersion,
      documentNotes,
      phases,
      promotedProjectId,
      promotedAt,
      completedAt,
      completedBy,
      originalPrompt,
      createdAt
    } = req.body;

    if (title !== undefined && (typeof title !== 'string' || title.trim() === '')) {
      return res.status(400).json({ error: "Field 'title' must be a non-empty string if provided." });
    }

    if (id !== undefined && (typeof id !== 'string' || id.trim() === '')) {
      return res.status(400).json({ error: "Field 'id' must be a non-empty string if provided." });
    }

    if (phases !== undefined && !Array.isArray(phases)) {
      return res.status(400).json({ error: "Field 'phases' must be an array if provided." });
    }

    if (documentNotes !== undefined && !Array.isArray(documentNotes)) {
      return res.status(400).json({ error: "Field 'documentNotes' must be an array if provided." });
    }

    if (schemaVersion !== undefined && (typeof schemaVersion !== 'number' || !Number.isFinite(schemaVersion))) {
      return res.status(400).json({ error: "Field 'schemaVersion' must be a number if provided." });
    }

    const trimmedTitle = typeof title === 'string' && title.trim() ? title.trim() : 'Untitled QA Checklist';
    const checklistId = (typeof id === 'string' && id.trim())
      ? id.trim()
      : `chk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const now = new Date().toISOString();

    const newChecklist = {
      id: checklistId,
      userId,
      schemaVersion: typeof schemaVersion === 'number' ? schemaVersion : 1,
      title: trimmedTitle,
      createdAt: typeof createdAt === 'string' && createdAt.trim() ? createdAt.trim() : now,
      updatedAt: now,
      documentNotes: Array.isArray(documentNotes) ? documentNotes : [],
      phases: Array.isArray(phases) ? phases : [],
      promotedProjectId: typeof promotedProjectId === 'string' && promotedProjectId.trim() ? promotedProjectId.trim() : null,
      promotedAt: typeof promotedAt === 'string' && promotedAt.trim() ? promotedAt.trim() : null,
      completedAt: typeof completedAt === 'string' && completedAt.trim() ? completedAt.trim() : null,
      completedBy: completedBy !== undefined ? completedBy : null,
      originalPrompt: typeof originalPrompt === 'string' ? originalPrompt : ''
    };

    const result = await db.collection("checklists").insertOne(newChecklist);

    return res.status(201).json({
      _id: result.insertedId,
      ...newChecklist
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: "A checklist with this ID already exists." });
    }
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error creating checklist: ${safeError}`);
    return res.status(500).json({ error: "Failed to create checklist." });
  }
});

// 4. PATCH /api/checklists/:id - Update an existing checklist using $set
app.patch("/api/checklists/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;
    const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: "Request body must be a valid JSON object." });
    }

    // 1. Recursive prohibited key detection (NoSQL operators, dotted paths, prototype pollution)
    if (containsProhibitedKeys(req.body)) {
      return res.status(400).json({ error: "Invalid request: Request body contains unsafe or prohibited property keys." });
    }

    // 2. Reject attempts to modify server-controlled or immutable fields
    if ('_id' in req.body || 'userId' in req.body || 'id' in req.body) {
      return res.status(400).json({ error: "Cannot modify server-controlled or immutable fields (_id, userId, id)." });
    }

    // 3. Top-level field allowlisting
    const bodyKeys = Object.keys(req.body);
    if (bodyKeys.length === 0) {
      return res.status(400).json({ error: "Request body cannot be empty." });
    }

    for (const key of bodyKeys) {
      if (!CHECKLIST_PATCH_ALLOWED_FIELDS.has(key)) {
        return res.status(400).json({ error: `Invalid or unrecognized field: '${key}'.` });
      }
    }

    let expectedUpdatedAt: string | null = null;
    if (req.body.expectedUpdatedAt !== undefined) {
      if (typeof req.body.expectedUpdatedAt !== 'string' || req.body.expectedUpdatedAt.trim() === '') {
        return res.status(400).json({ error: "Field 'expectedUpdatedAt' must be a non-empty string when provided." });
      }
      expectedUpdatedAt = req.body.expectedUpdatedAt.trim();
    }

    const updateDoc: Record<string, any> = {};

    if (req.body.title !== undefined) {
      if (typeof req.body.title !== 'string' || req.body.title.trim() === '') {
        return res.status(400).json({ error: "Field 'title' must be a non-empty string." });
      }
      updateDoc.title = req.body.title.trim();
    }

    if (req.body.schemaVersion !== undefined) {
      if (typeof req.body.schemaVersion !== 'number' || !Number.isFinite(req.body.schemaVersion)) {
        return res.status(400).json({ error: "Field 'schemaVersion' must be a number." });
      }
      updateDoc.schemaVersion = req.body.schemaVersion;
    }

    if (req.body.phases !== undefined) {
      if (!Array.isArray(req.body.phases)) {
        return res.status(400).json({ error: "Field 'phases' must be an array." });
      }
      updateDoc.phases = req.body.phases;
    }

    if (req.body.documentNotes !== undefined) {
      if (!Array.isArray(req.body.documentNotes)) {
        return res.status(400).json({ error: "Field 'documentNotes' must be an array." });
      }
      updateDoc.documentNotes = req.body.documentNotes;
    }

    if (req.body.promotedProjectId !== undefined) {
      if (req.body.promotedProjectId !== null && typeof req.body.promotedProjectId !== 'string') {
        return res.status(400).json({ error: "Field 'promotedProjectId' must be a string or null." });
      }
      updateDoc.promotedProjectId = typeof req.body.promotedProjectId === 'string' ? req.body.promotedProjectId.trim() : null;
    }

    if (req.body.promotedAt !== undefined) {
      if (req.body.promotedAt !== null && typeof req.body.promotedAt !== 'string') {
        return res.status(400).json({ error: "Field 'promotedAt' must be a string or null." });
      }
      updateDoc.promotedAt = typeof req.body.promotedAt === 'string' ? req.body.promotedAt.trim() : null;
    }

    if (req.body.completedAt !== undefined) {
      if (req.body.completedAt !== null && typeof req.body.completedAt !== 'string') {
        return res.status(400).json({ error: "Field 'completedAt' must be a string or null." });
      }
      updateDoc.completedAt = typeof req.body.completedAt === 'string' ? req.body.completedAt.trim() : null;
    }

    if (req.body.completedBy !== undefined) {
      updateDoc.completedBy = req.body.completedBy;
    }

    if (req.body.originalPrompt !== undefined) {
      if (typeof req.body.originalPrompt !== 'string') {
        return res.status(400).json({ error: "Field 'originalPrompt' must be a string." });
      }
      updateDoc.originalPrompt = req.body.originalPrompt;
    }

    if (Object.keys(updateDoc).length === 0) {
      return res.status(400).json({ error: "No valid fields provided for update." });
    }

    const nowIso = new Date().toISOString();
    updateDoc.updatedAt = (nowIso === expectedUpdatedAt)
      ? new Date(Date.now() + 1).toISOString()
      : nowIso;

    const baseQuery = buildUserChecklistQuery(idParam, userId);
    let query: any;
    if (expectedUpdatedAt) {
      if (baseQuery.$or) {
        query = {
          $and: [
            baseQuery,
            { updatedAt: expectedUpdatedAt }
          ]
        };
      } else {
        query = {
          ...baseQuery,
          updatedAt: expectedUpdatedAt
        };
      }
    } else {
      query = baseQuery;
    }

    const result = await db.collection("checklists").findOneAndUpdate(
      query,
      { $set: updateDoc },
      { returnDocument: 'after' }
    );

    if (!result) {
      if (expectedUpdatedAt) {
        // Document may exist for this user but its updatedAt did not match expectedUpdatedAt (concurrent modification)
        const existingDoc = await db.collection("checklists").findOne(baseQuery);
        if (existingDoc) {
          return res.status(409).json({
            error: "Conflict: The checklist has been modified by another operation.",
            currentUpdatedAt: existingDoc.updatedAt || null,
            expectedUpdatedAt
          });
        }
      }
      return res.status(404).json({ error: "Checklist not found." });
    }

    return res.json(result);
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    if (
      error?.name === 'MongoNetworkError' ||
      error?.name === 'MongoServerSelectionError' ||
      error?.name === 'MongoTimeoutError' ||
      (error?.message && error.message.includes('buffering timed out'))
    ) {
      console.error(`Database unavailable during checklist update: ${safeError}`);
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }
    console.error(`Error updating checklist ${req.params.id}: ${safeError}`);
    return res.status(500).json({ error: "Failed to update checklist." });
  }
});

// 5. DELETE /api/checklists/:id - Delete a checklist owned by the authenticated user
app.delete("/api/checklists/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;
    const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const query = buildUserChecklistQuery(idParam, userId);
    const result = await db.collection("checklists").deleteOne(query);

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Checklist not found." });
    }

    return res.json({ success: true, message: "Checklist deleted successfully." });
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error deleting checklist ${req.params.id}: ${safeError}`);
    return res.status(500).json({ error: "Failed to delete checklist." });
  }
});

// Route-level error handler for database connection failures and API safety
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err?.name === 'MongooseError' || err?.name === 'MongoNetworkError' || (err?.message && err.message.includes('buffering timed out'))) {
    console.warn('[Qavora Server] Database offline — returning 503 response');
    return res.status(503).json({ error: 'Service temporarily unavailable (database offline)' });
  }
  if (res.headersSent) {
    return next(err);
  }
  if (req.path.startsWith('/api')) {
    const statusCode = typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(statusCode).json({ error: 'Internal server error.' });
  }
  next(err);
});

// Unknown API route handler — ensures /api/* routes never fall back to index.html (runs in both serverless and standalone)
app.use('/api', (req: Request, res: Response) => {
  return res.status(404).json({
    error: 'Not Found',
    message: `API endpoint '${req.method} ${req.originalUrl || req.path}' does not exist.`
  });
});

// ============================================================================
// 4. Server Lifecycle, SPA Nonce Injection & Execution Mode Isolation
// ============================================================================
let cachedSpaHtmlTemplate: string | null = null;
let cachedSpaHtmlPath: string | null = null;

function resolveSpaIndexHtmlTemplate(): { template: string; indexPath: string | null } {
  if (cachedSpaHtmlTemplate) {
    return { template: cachedSpaHtmlTemplate, indexPath: cachedSpaHtmlPath };
  }

  const distDir = path.basename(__dirname) === 'dist' ? __dirname : path.resolve(__dirname, 'dist');
  const candidatePaths = [
    path.resolve(distDir, 'index.html'),
    path.resolve(process.cwd(), 'dist', 'index.html'),
    path.resolve(__dirname, 'index.html'),
    path.resolve(process.cwd(), 'index.html')
  ];

  for (const candidate of candidatePaths) {
    try {
      if (fs.existsSync(candidate)) {
        const content = fs.readFileSync(candidate, 'utf-8');
        if (content) {
          cachedSpaHtmlTemplate = content;
          cachedSpaHtmlPath = candidate;
          return { template: content, indexPath: candidate };
        }
      }
    } catch {
      // Ignore read errors and check next candidate
    }
  }

  return { template: '', indexPath: null };
}

function serveSpaHtmlWithNonce(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    const { template, indexPath } = resolveSpaIndexHtmlTemplate();
    const nonce = res.locals.nonce;
    if (template) {
      const htmlWithNonce = nonce
        ? template.replace(/<script\b(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`)
        : template;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.send(htmlWithNonce);
    }
    if (indexPath) {
      return res.sendFile(indexPath);
    }
  }
  next();
}

// On Vercel, serverless function runtimes handle the HTTP listener and routing.
// Standalone execution (local development or container) calls setupServer().
if (isVercel) {
  app.use(serveSpaHtmlWithNonce);
}

async function setupServer() {
  try {
    getJwtSecret();
  } catch (jwtConfigErr: any) {
    console.error(`[Qavora Server FATAL] ${jwtConfigErr?.message || 'JWT_SECRET is missing or invalid.'}`);
    process.exit(1);
  }
  let isShuttingDown = false;
  let httpServer: any = null;

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    // Resolve dist directory relative to project root (or __dirname)
    const distPath = path.basename(__dirname) === 'dist' ? __dirname : path.resolve(__dirname, 'dist');
    const indexPath = path.resolve(distPath, 'index.html');

    // Build reliability check: Fail fast with clear error if production build is missing
    if (!fs.existsSync(distPath) || !fs.existsSync(indexPath)) {
      console.error(
        `[Qavora Server FATAL] Production frontend build missing or incomplete!\n` +
        `Expected 'index.html' at: ${indexPath}\n` +
        `Please run 'npm run build' before starting the production server.`
      );
      process.exit(1);
    }

    // Determine normalized base path from VITE_BASE_PATH (e.g. '/' or '/qavora/')
    const rawBasePath = process.env.VITE_BASE_PATH || '/';
    const basePath = rawBasePath.startsWith('/') ? rawBasePath : `/${rawBasePath}`;
    const cleanBasePath = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;

    // Serve static assets from dist/
    // If base path is specified (e.g. /qavora), mount at that path and also at root for convenience
    if (cleanBasePath && cleanBasePath !== '') {
      app.use(cleanBasePath, express.static(distPath, { maxAge: '1h', index: false }));
    }
    app.use(express.static(distPath, { maxAge: '1h', index: false }));

    // Pre-read index.html template for dynamic per-response CSP nonce injection
    try {
      cachedSpaHtmlTemplate = fs.readFileSync(indexPath, 'utf-8');
      cachedSpaHtmlPath = indexPath;
    } catch (_) {}

    // SPA fallback route for all non-API GET requests
    app.use(serveSpaHtmlWithNonce);
  }

  httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Qavora Server] Running on http://0.0.0.0:${PORT} (env: ${process.env.NODE_ENV || 'development'})`);
  });

  // Graceful shutdown handler
  async function gracefulShutdown(signal: string) {
    if (isShuttingDown) {
      console.log(`[Qavora Server] Shutdown already in progress. Ignoring duplicate signal: ${signal}`);
      return;
    }
    isShuttingDown = true;
    console.log(`\n[Qavora Server] Received ${signal}. Starting graceful shutdown...`);

    // Force exit timeout to prevent hanging connections
    const forceExitTimer = setTimeout(() => {
      console.error('[Qavora Server] Graceful shutdown timed out (10s limit). Forcing process exit.');
      process.exit(1);
    }, 10000);
    forceExitTimer.unref();

    try {
      if (httpServer) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((err: any) => {
            if (err) {
              console.warn(`[Qavora Server] Error while closing HTTP server: ${err?.message}`);
              return reject(err);
            }
            console.log('[Qavora Server] Closed HTTP server. No longer accepting new connections.');
            resolve();
          });
        });
      }

      if (mongoClientInstance) {
        await mongoClientInstance.close();
        console.log('[Qavora Server] MongoDB connection pool closed cleanly.');
      }

      console.log('[Qavora Server] Graceful shutdown completed cleanly.');
      clearTimeout(forceExitTimer);
      process.exit(0);
    } catch (shutdownErr: any) {
      console.error(`[Qavora Server] Error encountered during shutdown: ${shutdownErr?.message}`);
      clearTimeout(forceExitTimer);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

// In Vercel serverless functions, do not start HTTP listener or initialize Vite
if (!isVercel) {
  setupServer();
}

async function closeDatabase(): Promise<void> {
  if (mongoClientInstance) {
    await mongoClientInstance.close();
    mongoClientInstance = null;
  }
  db = null;
  connectionPromise = null;
}

function setDatabaseForTesting(testDb: any, testClient: any = null): void {
  db = testDb;
  mongoClientInstance = testClient;
}

export { connectToDatabase, closeDatabase, setDatabaseForTesting, loginRateLimiter, registerRateLimiter, ensureMultiTenantUniqueIndex, ensureDatabaseIndexes };
export default app;
