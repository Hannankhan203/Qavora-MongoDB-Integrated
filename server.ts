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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

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

  // Strict-Transport-Security in production environments (or when forwarded over HTTPS)
  if (isProdOrVercel || req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Content-Security-Policy tailored specifically for Qavora
  const connectSrc = isProdOrVercel
    ? "'self'"
    : "'self' ws: wss: http: https:";
  const frameAncestors = isProdOrVercel ? "frame-ancestors 'none'" : 'frame-ancestors *';

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
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

app.use(express.json({ limit: '10mb' }));

// ============================================================================
// 3. MongoDB Connection Handling & In-Memory Mock Fallback
// ============================================================================
function matchesFilter(doc: any, filter: any = {}): boolean {
  if (!filter || typeof filter !== 'object') return true;
  for (const [key, val] of Object.entries(filter)) {
    if (key === '$or' && Array.isArray(val)) {
      if (!val.some((sub) => matchesFilter(doc, sub))) return false;
      continue;
    }
    const docVal = doc[key];
    if (val instanceof ObjectId || docVal instanceof ObjectId) {
      if (String(docVal) !== String(val)) return false;
    } else if (docVal !== val) {
      return false;
    }
  }
  return true;
}

function createInMemoryDb() {
  const collections = new Map<string, any[]>();
  const getCol = (name: string) => {
    if (!collections.has(name)) {
      collections.set(name, []);
    }
    return collections.get(name)!;
  };

  return {
    __isMock: true,
    collection(name: string) {
      const store = getCol(name);
      return {
        async createIndex() {
          return 'ok';
        },
        find(filter: any = {}) {
          return {
            async toArray() {
              return store.filter((doc) => matchesFilter(doc, filter)).map((d) => ({ ...d }));
            }
          };
        },
        async findOne(filter: any = {}) {
          const found = store.find((doc) => matchesFilter(doc, filter));
          return found ? { ...found } : null;
        },
        async insertOne(doc: any) {
          const insertedId = doc._id || new ObjectId();
          const record = { ...doc, _id: insertedId };
          store.push(record);
          return { insertedId, acknowledged: true };
        },
        async updateOne(filter: any, update: any, options: any = {}) {
          const idx = store.findIndex((doc) => matchesFilter(doc, filter));
          if (idx === -1) {
            if (options?.upsert) {
              const base = update?.$setOnInsert ? { ...update.$setOnInsert } : {};
              const setFields = update?.$set ? { ...update.$set } : {};
              const insertedId = base._id || new ObjectId();
              store.push({ ...base, ...setFields, _id: insertedId });
              return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: insertedId };
            }
            return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
          }
          if (update?.$set) {
            store[idx] = { ...store[idx], ...update.$set };
          }
          return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
        },
        async findOneAndUpdate(filter: any, update: any, options: any = {}) {
          const idx = store.findIndex((doc) => matchesFilter(doc, filter));
          if (idx === -1) return null;
          const before = { ...store[idx] };
          if (update?.$set) {
            store[idx] = { ...store[idx], ...update.$set };
          }
          return options?.returnDocument === 'before' ? before : { ...store[idx] };
        },
        async deleteOne(filter: any) {
          const idx = store.findIndex((doc) => matchesFilter(doc, filter));
          if (idx === -1) return { deletedCount: 0 };
          store.splice(idx, 1);
          return { deletedCount: 1 };
        },
        async bulkWrite(operations: any[]) {
          let upsertedCount = 0;
          let matchedCount = 0;
          for (const op of operations) {
            if (op?.updateOne) {
              const { filter, update, upsert } = op.updateOne;
              const idx = store.findIndex((doc) => matchesFilter(doc, filter));
              if (idx === -1) {
                if (upsert) {
                  const base = update?.$setOnInsert ? { ...update.$setOnInsert } : {};
                  const setFields = update?.$set ? { ...update.$set } : {};
                  store.push({ ...base, ...setFields, _id: base._id || new ObjectId() });
                  upsertedCount++;
                }
              } else {
                matchedCount++;
                if (update?.$set) {
                  store[idx] = { ...store[idx], ...update.$set };
                }
              }
            }
          }
          return { upsertedCount, matchedCount };
        }
      };
    }
  };
}

const mockDb = createInMemoryDb();
let db: any = (isProduction || isVercel) ? null : mockDb;
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

async function connectToDatabase(): Promise<any> {
  const currentUri = process.env.MONGODB_URI;
  const currentDbName = process.env.MONGODB_DB || 'qavora';
  const currentIsProd = process.env.NODE_ENV === 'production';
  const currentIsVercel = Boolean(process.env.VERCEL || process.env.NOW_REGION);

  // If already connected to real MongoDB, return immediately (warm invocation reuse)
  if (db && !db.__isMock) {
    return db;
  }

  // Never allow mockDb to remain active in production or Vercel
  if (db?.__isMock && (currentIsProd || currentIsVercel)) {
    db = null;
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
          console.error('[Qavora Server FATAL] Production startup failed: MONGODB_URI environment variable is missing. In-memory fallback is strictly disabled in production.');
          process.exit(1);
        }
        if (currentIsProd || currentIsVercel) {
          db = null;
          console.warn('[Qavora Server] MONGODB_URI is missing in serverless/production environment; database remains offline (HTTP 503).');
          return null;
        }
        console.log('[Qavora Server] MongoDB credentials not provided in environment; using in-memory mock responses.');
        db = mockDb;
        return db;
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

      // Ensure indexes safely with non-fatal logging
      try {
        await db.collection("projects").createIndex({ id: 1 }, { unique: true });
      } catch (idxErr: any) {
        console.warn(`[Qavora Server] Warning creating unique index on projects.id: ${sanitizeDiagnosticText(idxErr?.message)}`);
      }
      try {
        await db.collection("projects").createIndex({ userId: 1, id: 1 });
        await db.collection("projects").createIndex({ userId: 1, status: 1 });
        await db.collection("projects").createIndex({ userId: 1 });
        console.log(`[Qavora Server] Ensured tenant-isolation indexes on projects collection (userId, id, status).`);
      } catch (idxErr: any) {
        console.warn(`[Qavora Server] Warning creating tenant isolation indexes on projects: ${sanitizeDiagnosticText(idxErr?.message)}`);
      }
      try {
        await db.collection("tests").createIndex({ userId: 1 });
      } catch (idxErr: any) {
        console.warn(`[Qavora Server] Warning creating index on tests: ${sanitizeDiagnosticText(idxErr?.message)}`);
      }
      try {
        await db.collection("users").createIndex({ email: 1 }, { unique: true });
        await db.collection("users").createIndex({ userId: 1 }, { unique: true });
        console.log(`[Qavora Server] Ensured unique indexes on users collection (email, userId).`);
      } catch (idxErr: any) {
        console.warn(`[Qavora Server] Warning creating unique index on users: ${sanitizeDiagnosticText(idxErr?.message)}`);
      }

      return db;
    } catch (error: any) {
      const safeErrorMessage = sanitizeDiagnosticText(error?.message || "Unknown error");

      if (currentIsProd && !currentIsVercel) {
        db = null;
        const diagnostics = buildMongoConnectionDiagnostics(error, attemptedClient);
        console.error(
          `[Qavora Server FATAL] Production startup failed: Unable to connect to MongoDB Atlas (${safeErrorMessage}). In-memory fallback is strictly disabled in production.`,
          JSON.stringify(diagnostics)
        );
        process.exit(1);
      } else if (currentIsProd || currentIsVercel) {
        db = null;
        const diagnostics = buildMongoConnectionDiagnostics(error, attemptedClient);
        console.error(
          `[Qavora Server] MongoDB connection failure diagnostics (serverless/production): ${JSON.stringify(diagnostics)}`
        );
        console.warn(`[Qavora Server] MongoDB connection offline in serverless/production: ${safeErrorMessage}.`);
        return null;
      } else {
        db = mockDb;
        console.warn(`[Qavora Server] MongoDB connection offline (${safeErrorMessage}) — falling back to in-memory mock responses.`);
        return db;
      }
      return null;
    } finally {
      if (!db || db.__isMock) {
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

  // Health endpoint can be accessed without blocking
  if (req.path === '/api/health') {
    return next();
  }

  const currentIsProd = process.env.NODE_ENV === 'production';
  const currentIsVercel = Boolean(process.env.VERCEL || process.env.NOW_REGION);
  if (db?.__isMock && (currentIsProd || currentIsVercel)) {
    db = null;
  }

  const activeUri = process.env.MONGODB_URI;
  if ((!db || db.__isMock) && activeUri) {
    try {
      await connectToDatabase();
    } catch (err: any) {
      console.warn(`[Qavora Server] Failed awaiting database connection in request middleware: ${sanitizeDiagnosticText(err?.message || err)}`);
    }
  }

  next();
});

// Default mock tests for QA verification
const mockTests = [
  { _id: "qav-test-001", name: "User Registration & Form Validation", status: "Passed" },
  { _id: "qav-test-002", name: "Authentication Session Expiry Check", status: "Active" },
  { _id: "qav-test-003", name: "Manual Test Suite Export & Import", status: "Passed" },
  { _id: "qav-test-004", name: "Cross-Device Checklist Synchronization", status: "Active" },
  { _id: "qav-test-005", name: "Defect Logging & Severity Assignment", status: "Passed" }
];

// In-memory fallback projects store when MongoDB is offline
const inMemoryProjects: any[] = [];

// Health check endpoint
app.get("/api/health", (req: Request, res: Response) => {
  const currentIsProd = process.env.NODE_ENV === 'production';
  const currentIsVercel = Boolean(process.env.VERCEL || process.env.NOW_REGION);
  const databaseStatus = db && !db.__isMock
    ? "connected"
    : (currentIsProd || currentIsVercel ? "disconnected" : "mock-active");
  res.json({
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
  const currentIsProd = process.env.NODE_ENV === 'production';
  const currentIsVercel = Boolean(process.env.VERCEL || process.env.NOW_REGION);

  if (!secret || typeof secret !== 'string' || secret.trim() === '') {
    if (currentIsProd || currentIsVercel) {
      throw new Error('JWT_SECRET environment variable is missing.');
    }
    return 'qavora-dev-fallback-jwt-secret-key';
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
}

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    name: string;
    role: string;
  };
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
    lastLoginAt: String(user.lastLoginAt)
  };
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

    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: "Authentication token missing or invalid."
      });
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
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

    if (!decoded || !decoded.userId) {
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

    (req as AuthenticatedRequest).user = {
      userId: String(user.userId),
      email: String(user.email),
      name: String(user.name),
      role: String(user.role || 'QA Tester')
    };

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
// Authentication Endpoints
// ============================================================================

// 1. POST /api/auth/register - Register a new user
app.post("/api/auth/register", async (req: Request, res: Response) => {
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

    const { name, email, password } = req.body || {};

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
      role: 'QA Tester',
      avatarInitials: getAvatarInitials(trimmedName),
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
        role: newUser.role
      },
      jwtSecret,
      { expiresIn: tokenExpiry }
    );

    return res.status(201).json({
      success: true,
      token,
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
app.post("/api/auth/login", async (req: Request, res: Response) => {
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
    await db.collection("users").updateOne(
      { userId: user.userId },
      { $set: { lastLoginAt: now, updatedAt: now } }
    );
    user.lastLoginAt = now;
    user.updatedAt = now;

    const tokenExpiry = (process.env.JWT_EXPIRES_IN || '7d') as any;
    const token = jwt.sign(
      {
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role || 'QA Tester'
      },
      jwtSecret,
      { expiresIn: tokenExpiry }
    );

    return res.json({
      success: true,
      token,
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

// ============================================================================
// Projects & Workspaces MongoDB API Endpoints
// ============================================================================

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
    return res.json(projects);
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

    return res.json(project);
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

    // Never accept userId from request body as authoritative; always derive from authenticated JWT identity
    const { name, type, version, description, status, id, userId: _ignoredUserId, ...extraData } = req.body || {};

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

    const newProject: any = {
      id: projectId,
      userId,
      name: trimmedName,
      type: typeof type === 'string' && type.trim() ? type.trim() : 'Web Application',
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
    const { name, type, version, description, status } = req.body || {};

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

    return res.json(result);
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error updating project ${req.params.id}: ${safeError}`);
    return res.status(500).json({ error: "Failed to update project." });
  }
});

// 5. PATCH /api/projects/:id/status - Update project status
app.patch("/api/projects/:id/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;
    const { status } = req.body || {};
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

    return res.json(result);
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

    // Strip immutable primary identity keys & ownership fields: never allow body to modify '_id', 'id', or 'userId'
    const { _id, id, userId: _ignoredUserId, ...allowedData } = req.body;

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

    // Ensure updatedAt timestamp reflects current modification
    allowedData.updatedAt = new Date().toISOString();

    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }

    // Real MongoDB Atlas update using $set to prevent full document replacement
    const query = buildUserProjectQuery(cleanId, userId);
    const result = await db.collection("projects").findOneAndUpdate(
      query,
      { $set: allowedData },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: "Project not found." });
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
      console.error(`Database unavailable during project data update: ${safeError}`);
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }
    console.error(`Error updating project data ${req.params.id}: ${safeError}`);
    return res.status(500).json({ error: "Failed to update project data." });
  }
});

// 6. DELETE /api/projects/:id - Delete a project document
app.delete("/api/projects/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;
    const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }

    const query = buildUserProjectQuery(idParam, userId);
    const result = await db.collection("projects").deleteOne(query);

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Project not found." });
    }

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

// 7. POST /api/projects/sync-local - Local storage migration sync using $setOnInsert
app.post("/api/projects/sync-local", requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;

    const rawList = Array.isArray(req.body) ? req.body : req.body?.projects;
    if (!Array.isArray(rawList)) {
      return res.status(400).json({ error: "Payload must be an array of projects or an object with a 'projects' array." });
    }

    if (rawList.length === 0) {
      return res.json({ success: true, count: 0, insertedCount: 0, matchedCount: 0 });
    }

    if (!db) {
      return res.status(503).json({ error: "Service temporarily unavailable (database offline)." });
    }

    const operations = [];
    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue;
      const projId = (typeof item.id === 'string' && item.id.trim())
        ? item.id.trim()
        : (item.name ? `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}` : null);

      if (!projId) continue;

      // Clone document and stamp authenticated userId, never trusting incoming userId
      const docToInsert = { ...item, id: projId, userId };
      delete docToInsert._id;

      operations.push({
        updateOne: {
          filter: { id: projId, userId },
          update: { $setOnInsert: docToInsert },
          upsert: true
        }
      });
    }

    if (operations.length === 0) {
      return res.json({ success: true, count: 0, insertedCount: 0, matchedCount: 0 });
    }

    const bulkResult = await db.collection("projects").bulkWrite(operations);

    return res.json({
      success: true,
      count: operations.length,
      insertedCount: bulkResult.upsertedCount,
      matchedCount: bulkResult.matchedCount
    });
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error syncing local projects: ${safeError}`);
    return res.status(500).json({ error: "Failed to sync local projects." });
  }
});

// Route-level fallback for database errors
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err?.name === 'MongooseError' || err?.name === 'MongoNetworkError' || (err?.message && err.message.includes('buffering timed out'))) {
    console.warn('[AI Studio] Database offline — returning mock empty response');
    if (req.method === 'GET') {
      return res.json(req.path.endsWith('s') || req.path.endsWith('s/') ? [] : {});
    }
    return res.status(503).json({ error: 'Service temporarily unavailable (database offline)' });
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
// 4. Server Lifecycle & Execution Mode Isolation
// ============================================================================
// On Vercel, serverless function runtimes handle the HTTP listener and routing.
// Standalone execution (local development or container) calls setupServer().

async function setupServer() {
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
    const distPath = path.resolve(__dirname, 'dist');
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

    // SPA fallback route for all non-API GET requests
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) {
        return res.sendFile(indexPath);
      }
      next();
    });
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

export { connectToDatabase };
export default app;
