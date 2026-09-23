/**
 * Admin auth for the Cloudflare Worker — mirrors server/adminAuth.ts behaviour
 * but built for Workers primitives (WebCrypto, no Node deps):
 *   - Firebase password check via Identity Toolkit REST
 *   - Mandatory TOTP 2FA (Google Authenticator compatible, RFC 6238)
 *   - Admin sessions persisted in admin_sessions (30-min inactivity window)
 *   - Per-IP + per-account lockout (5 failures -> 15 min)
 *   - DB-driven RBAC (admin_config.rolePermissions, fallback to defaults)
 *   - IP whitelist / VPN-gate config support
 *   - Immutable audit trail (admin_audit_logs)
 */
import { Env, fsGetDoc, fsSetDoc, fsAddDoc, fsRunQuery, fsDeleteDoc } from "./firestore";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const ADMIN_ROLES = ["SUPER_ADMIN", "MODERATOR", "FINANCE_ADMIN", "SUPPORT"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const SESSION_TTL_MINUTES = 30;
export const SESSION_TTL_MS = SESSION_TTL_MINUTES * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
export const PENDING_APPROVAL_THRESHOLD_USD_DEFAULT = 60; // ≈ ₹5000

export interface AdminSession {
  claims: { sid: string; uid: string; email: string; role: AdminRole };
  email: string;
  role: AdminRole;
}

export interface AdminAccount {
  uid: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  totpSecret: string | null;
  totpEnabled: boolean;
  displayName?: string;
}

// ---------------------------------------------------------------------------
// Default role->permissions map (same as server; seeded into admin_config)
// ---------------------------------------------------------------------------
export const DEFAULT_ROLE_PERMISSIONS: Record<AdminRole, string[]> = {
  SUPER_ADMIN: ["*"],
  MODERATOR: [
    "users.view", "users.suspend", "users.ban", "users.reactivate", "users.warn", "users.manage",
    "reports.view", "reports.action", "content.view", "content.delete",
    "dating.view", "dating.flag", "dating.action",
    "analytics.view", "audit.view"
  ],
  FINANCE_ADMIN: [
    "users.view", "payouts.view", "payouts.approve", "payouts.reject",
    "monetization.view", "monetization.approve", "analytics.view", "audit.view"
  ],
  SUPPORT: [
    "users.view", "reports.view", "reports.dismiss", "content.view",
    "analytics.view", "audit.view"
  ]
};

export const ROUTE_PERMISSION_MAP: Record<string, string> = {
  "GET /api/admin/users": "users.view",
  "POST /api/admin/users/:uid/action": "users.manage",
  "GET /api/admin/reports": "reports.view",
  "POST /api/admin/reports/:reportId/action": "reports.action",
  "GET /api/admin/stories": "content.view",
  "POST /api/admin/stories/:storyId/delete": "content.delete",
  "GET /api/admin/payouts": "payouts.view",
  "POST /api/admin/payouts/:payoutId/action": "payouts.approve",
  "GET /api/admin/monetization-report": "monetization.view",
  "GET /api/monetization/admin/creators": "monetization.view",
  "POST /api/monetization/admin/approve-creator": "monetization.approve",
  "POST /api/monetization/run-batch-calculator": "monetization.approve",
  "GET /api/admin/overview": "analytics.view",
  "GET /api/admin/analytics": "analytics.view",
  "GET /api/admin/dating-flags": "dating.view",
  "POST /api/admin/dating-flags/:flagId/action": "dating.action",
  "GET /api/admin/pending-approvals": "payouts.view",
  "POST /api/admin/pending-approvals/:id/decision": "payouts.approve",
  "GET /api/admin/audit-logs": "audit.view",
  "GET /api/admin/admins": "admins.view",
  "POST /api/admin/admins/invite": "admins.manage",
  "POST /api/admin/admins/:uid/set-role": "admins.manage",
  "POST /api/admin/admins/:uid/reset-2fa": "admins.manage",
  "POST /api/admin/admins/:uid/set-active": "admins.manage",
  "GET /api/admin/config": "admins.view",
  "POST /api/admin/config/update": "admins.manage"
};

/** Route-level fallback: resolve permission for a concrete method+path (deny if unmapped). */
export function routePermission(method: string, path: string): string | null {
  const m = method.toUpperCase();
  const clean = path.split("?")[0];
  const key = `${m} ${clean}`;
  if (ROUTE_PERMISSION_MAP[key]) return ROUTE_PERMISSION_MAP[key];
  const pathParts = clean.split("/");
  for (const pattern of Object.keys(ROUTE_PERMISSION_MAP)) {
    const [pMethod, pPath] = pattern.split(" ");
    if (pMethod !== m) continue;
    const patternParts = pPath.split("/");
    if (patternParts.length !== pathParts.length) continue;
    let matched = true;
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(":")) continue;
      if (patternParts[i] !== pathParts[i]) { matched = false; break; }
    }
    if (matched) return ROUTE_PERMISSION_MAP[pattern];
  }
  return null;
}

// ---------------------------------------------------------------------------
// WebCrypto helpers: sha256, HS256 JWT, base32
// ---------------------------------------------------------------------------
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const enc = new TextEncoder();

async function hmacKey(secret: string, hash: "SHA-256" | "SHA-1"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash }, false, ["sign"]);
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function jwtSign(payload: Record<string, unknown>, secret: string, ttlSec: number): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64urlEncode(enc.encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })));
  const key = await hmacKey(secret, "SHA-256");
  const sig = b64urlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${body}`))));
  return `${header}.${body}.${sig}`;
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function jwtVerify<T = any>(token: string, secret: string): Promise<T | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const key = await hmacKey(secret, "SHA-256");
    const expected = b64urlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${body}`))));
    if (expected.length !== sig.length) return null;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    if (diff !== 0) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (typeof claims.exp === "number" && Math.floor(Date.now() / 1000) > claims.exp) return null;
    return claims as T;
  } catch {
    return null;
  }
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[=\s]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238, SHA-1, 6 digits, 30s — Google Authenticator compatible)
// ---------------------------------------------------------------------------
async function totpAt(secret: string, counter: number): Promise<string> {
  const keyBytes = base32Decode(secret);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c = Math.floor(c / 256); }
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

export async function verifyTotp(secret: string, token: string): Promise<boolean> {
  if (!secret || !/^\d{6}$/.test(token)) return false;
  const step = Math.floor(Date.now() / 1000 / 30);
  for (const drift of [0, -1, 1]) {
    if ((await totpAt(secret, step + drift)) === token) return true;
  }
  return false;
}

export function generateTotpSecret(email: string): { secret: string; otpauthUrl: string } {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const secret = base32Encode(bytes);
  // Compact URL (defaults SHA1/6/30 are what Google Authenticator assumes anyway)
  const otpauthUrl = `otpauth://totp/AnvioTalk:${encodeURIComponent(email)}?secret=${secret}&issuer=AnvioTalk`;
  return { secret, otpauthUrl };
}

// ---------------------------------------------------------------------------
// JWT secret — env first, else reuse the secret persisted in admin_config
// ---------------------------------------------------------------------------
let jwtSecretCache: { value: string; at: number } | null = null;

export async function getJwtSecret(env: Env): Promise<string> {
  if (jwtSecretCache && Date.now() - jwtSecretCache.at < 5 * 60 * 1000) return jwtSecretCache.value;
  const envSecret = env.ADMIN_JWT_SECRET;
  if (typeof envSecret === "string" && envSecret.length >= 32) {
    jwtSecretCache = { value: envSecret, at: Date.now() };
    return envSecret;
  }
  // Reuse the secret the Node server persists in admin_config (shared across runtimes)
  try {
    const cfg = await fsGetDoc(env, "admin_config/config");
    const existing = cfg?.jwtSecret;
    if (typeof existing === "string" && existing.length >= 32) {
      jwtSecretCache = { value: existing, at: Date.now() };
      return existing;
    }
    const generated = b64urlEncode(crypto.getRandomValues(new Uint8Array(48)));
    await fsSetDoc(env, "admin_config/config", { jwtSecret: generated, secretGeneratedAt: new Date().toISOString() });
    jwtSecretCache = { value: generated, at: Date.now() };
    return generated;
  } catch {
    // Firestore unavailable — per-isolate random (sessions won't survive restarts)
    if (!jwtSecretCache) jwtSecretCache = { value: b64urlEncode(crypto.getRandomValues(new Uint8Array(48))), at: Date.now() };
    return jwtSecretCache.value;
  }
}

// Temp 2FA token (5 min) — step 1 of login
export async function createTemp2FaToken(env: Env, uid: string): Promise<string> {
  return jwtSign({ t: "2fa-pending", uid }, await getJwtSecret(env), 5 * 60);
}
export async function verifyTemp2FaToken(env: Env, token: string): Promise<{ uid: string } | null> {
  const claims = await jwtVerify<{ t: string; uid: string }>(token, await getJwtSecret(env));
  if (!claims || claims.t !== "2fa-pending" || !claims.uid) return null;
  return { uid: claims.uid };
}

// ---------------------------------------------------------------------------
// Admin accounts (admin_users)
// ---------------------------------------------------------------------------
function toAccount(id: string, d: Record<string, unknown>): AdminAccount {
  return {
    uid: id,
    email: String(d.email || "").toLowerCase(),
    role: (ADMIN_ROLES as readonly string[]).includes(String(d.role)) ? (String(d.role) as AdminRole) : "SUPPORT",
    isActive: d.isActive !== false,
    totpSecret: typeof d.totpSecret === "string" && d.totpSecret ? d.totpSecret : null,
    totpEnabled: d.totpEnabled === true,
    displayName: typeof d.displayName === "string" ? d.displayName : undefined
  };
}

export async function getAdminAccount(env: Env, uid: string): Promise<AdminAccount | null> {
  const d = await fsGetDoc(env, `admin_users/${uid}`);
  return d ? toAccount(uid, d) : null;
}
export const getAdminById = getAdminAccount;

export async function findAdminByEmail(env: Env, email: string): Promise<AdminAccount | null> {
  const hits = await fsRunQuery(env, { from: "admin_users", clauses: [{ field: "email", op: "EQUAL", value: email.toLowerCase() }], limit: 1 });
  return hits.length ? toAccount(hits[0].id, hits[0].data) : null;
}

let seeded = false;
/** Ensures the owner SUPER_ADMIN exists (kartiksingh7870n@gmail.com). */
export async function ensureSeedSuperAdmin(env: Env): Promise<void> {
  if (seeded) return;
  seeded = true;
  const seedEmail = "kartiksingh7870n@gmail.com";
  try {
    const existing = await findAdminByEmail(env, seedEmail);
    if (existing) return;
    await fsAddDoc(env, "admin_users", {
      email: seedEmail,
      role: "SUPER_ADMIN",
      isActive: true,
      totpSecret: null,
      totpEnabled: false,
      displayName: "Kartik (Owner)",
      createdAt: new Date().toISOString()
    });
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Rate limiting: per-IP AND per-account (in-memory, per isolate)
// ---------------------------------------------------------------------------
const ipAttempts: Record<string, number[]> = {};
const accountAttempts: Record<string, number[]> = {};

function prune(hits: number[], nowMs: number, windowMs: number) {
  return hits.filter((t) => nowMs - t < windowMs);
}

export function checkLoginRate(ip: string, email: string): { allowed: boolean; retryAfterMin: number; reason?: string } {
  const now = Date.now();
  const windowMs = LOCKOUT_MINUTES * 60 * 1000;
  ipAttempts[ip] = prune(ipAttempts[ip] || [], now, windowMs);
  accountAttempts[email] = prune(accountAttempts[email] || [], now, windowMs);
  if (ipAttempts[ip].length >= MAX_FAILED_ATTEMPTS * 3) {
    return { allowed: false, retryAfterMin: LOCKOUT_MINUTES, reason: "Too many attempts from this network. Try later." };
  }
  if (accountAttempts[email].length >= MAX_FAILED_ATTEMPTS) {
    return { allowed: false, retryAfterMin: LOCKOUT_MINUTES, reason: "Account locked for 15 minutes due to failed attempts." };
  }
  return { allowed: true, retryAfterMin: 0 };
}

export function recordFailedLogin(ip: string, email: string) {
  const now = Date.now();
  ipAttempts[ip] = prune(ipAttempts[ip] || [], now, LOCKOUT_MINUTES * 60 * 1000);
  ipAttempts[ip].push(now);
  accountAttempts[email] = prune(accountAttempts[email] || [], now, LOCKOUT_MINUTES * 60 * 1000);
  accountAttempts[email].push(now);
}

export function clearFailedLogins(ip: string, email: string) {
  delete ipAttempts[ip];
  delete accountAttempts[email];
}

// ---------------------------------------------------------------------------
// Admin config (role map, ip whitelist, vpn gate, threshold) — cached 60s
// ---------------------------------------------------------------------------
export interface AdminConfig {
  rolePermissions: Record<string, string[]>;
  ipWhitelist: string[];
  vpnGateEnabled: boolean;
  payoutApprovalThresholdUsd: number;
}

let configCache: { value: AdminConfig; at: number } | null = null;

export async function getAdminConfig(env: Env): Promise<AdminConfig> {
  if (configCache && Date.now() - configCache.at < 60 * 1000) return configCache.value;
  const fallback: AdminConfig = {
    rolePermissions: DEFAULT_ROLE_PERMISSIONS,
    ipWhitelist: [],
    vpnGateEnabled: false,
    payoutApprovalThresholdUsd: PENDING_APPROVAL_THRESHOLD_USD_DEFAULT
  };
  try {
    const data = (await fsGetDoc(env, "admin_config/config")) || {};
    const value: AdminConfig = {
      rolePermissions: (data.rolePermissions as Record<string, string[]>) || DEFAULT_ROLE_PERMISSIONS,
      ipWhitelist: Array.isArray(data.ipWhitelist) ? (data.ipWhitelist as string[]) : [],
      vpnGateEnabled: data.vpnGateEnabled === true,
      payoutApprovalThresholdUsd: typeof data.payoutApprovalThresholdUsd === "number"
        ? data.payoutApprovalThresholdUsd
        : PENDING_APPROVAL_THRESHOLD_USD_DEFAULT
    };
    configCache = { value, at: Date.now() };
    return value;
  } catch {
    configCache = { value: fallback, at: Date.now() };
    return fallback;
  }
}

export function invalidateConfigCache() {
  configCache = null;
}

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------
export function roleHasPermission(rolePermissions: Record<string, string[]>, role: AdminRole, permission: string): boolean {
  const perms = rolePermissions[role] || DEFAULT_ROLE_PERMISSIONS[role] || [];
  if (perms.includes("*")) return true;
  if (perms.includes(permission)) return true;
  if (perms.includes(permission.split(".")[0] + ".*")) return true;
  return false;
}

export async function hasPermission(env: Env, session: AdminSession, permission: string): Promise<boolean> {
  const cfg = await getAdminConfig(env);
  return roleHasPermission(cfg.rolePermissions, session.role, permission);
}

// ---------------------------------------------------------------------------
// Client IP + IP gate
// ---------------------------------------------------------------------------
export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "0.0.0.0";
}

function ipMatchesRule(ip: string, rule: string): boolean {
  if (rule === "*" || rule === "0.0.0.0/0") return true;
  if (rule.endsWith(".*")) return ip.startsWith(rule.slice(0, -1));
  return ip === rule;
}

export async function checkIpGate(env: Env, ip: string): Promise<boolean> {
  const cfg = await getAdminConfig(env);
  if (cfg.ipWhitelist.length === 0) return true;
  return cfg.ipWhitelist.some((rule) => ipMatchesRule(ip, rule));
}

// ---------------------------------------------------------------------------
// Sessions (admin_sessions) — 30-min sliding inactivity window
// ---------------------------------------------------------------------------
export async function createAdminSession(env: Env, account: AdminAccount, ip: string, userAgent: string): Promise<string> {
  const sid = b64urlEncode(crypto.getRandomValues(new Uint8Array(24))).slice(0, 32);
  const now = Date.now();
  await fsSetDoc(env, `admin_sessions/${sid}`, {
    adminUid: account.uid,
    email: account.email,
    role: account.role,
    tokenHash: await sha256Hex(sid),
    ipAddress: ip,
    userAgent: String(userAgent || "").slice(0, 200),
    createdAtMs: now,
    lastActivityAtMs: now,
    expiresAtMs: now + SESSION_TTL_MS,
    revoked: false
  });
  return jwtSign({ sid, uid: account.uid, email: account.email, role: account.role }, await getJwtSecret(env), SESSION_TTL_MINUTES * 60);
}

export async function validateAdminSession(
  env: Env, token: string
): Promise<{ valid: true; claims: AdminSession["claims"] } | { valid: false; reason: string }> {
  const claims = await jwtVerify<AdminSession["claims"]>(token, await getJwtSecret(env));
  if (!claims || !claims.sid || !claims.uid) return { valid: false, reason: "Invalid or expired admin token." };
  try {
    const s = await fsGetDoc(env, `admin_sessions/${claims.sid}`);
    if (!s) return { valid: false, reason: "Session not found." };
    if (s.revoked === true) return { valid: false, reason: "Session revoked (logged out)." };
    const now = Date.now();
    if (typeof s.expiresAtMs === "number" && now > s.expiresAtMs) {
      return { valid: false, reason: "Session expired." };
    }
    if (typeof s.lastActivityAtMs === "number" && now - s.lastActivityAtMs > SESSION_TTL_MS) {
      await fsSetDoc(env, `admin_sessions/${claims.sid}`, { revoked: true, revokedReason: "inactivity_timeout" }, { updateMask: ["revoked", "revokedReason"] });
      return { valid: false, reason: "Session timed out after 30 minutes of inactivity." };
    }
    await fsSetDoc(env, `admin_sessions/${claims.sid}`, { lastActivityAtMs: now, expiresAtMs: now + SESSION_TTL_MS }, { updateMask: ["lastActivityAtMs", "expiresAtMs"] });
    return { valid: true, claims };
  } catch {
    return { valid: false, reason: "Session validation error." };
  }
}

export async function revokeAdminSession(env: Env, sid: string, reason: string): Promise<void> {
  try {
    await fsSetDoc(env, `admin_sessions/${sid}`, { revoked: true, revokedReason: reason, revokedAtMs: Date.now() }, { updateMask: ["revoked", "revokedReason", "revokedAtMs"] });
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Audit log (immutable admin_audit_logs)
// ---------------------------------------------------------------------------
export interface AdminAuditEntry {
  adminId: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress: string;
  userAgent?: string;
  note?: string;
}

export async function writeAdminAudit(env: Env, entry: AdminAuditEntry): Promise<void> {
  try {
    await fsAddDoc(env, "admin_audit_logs", {
      ...entry,
      oldValue: entry.oldValue === undefined ? null : entry.oldValue,
      newValue: entry.newValue === undefined ? null : entry.newValue,
      timestamp: new Date().toISOString(),
      timestampMs: Date.now()
    });
  } catch (e) {
    console.error("[WorkerAuth] audit write failed:", e);
  }
}

// ---------------------------------------------------------------------------
// Firebase password verify (Identity Toolkit REST)
// ---------------------------------------------------------------------------
const FIREBASE_WEB_API_KEY_DEFAULT = "AIzaSyBR9e8eLDsyr5cHhwkcanRTbPqqjfGBBHU"; // public client key (same as src/firebase.ts)

export async function firebasePasswordSignIn(env: Env, email: string, password: string): Promise<{ ok: true; localId: string } | { ok: false; status: number; error: string }> {
  const apiKey = (typeof env.FIRESTORE_API_KEY === "string" && env.FIRESTORE_API_KEY.startsWith("AIza")) ? env.FIRESTORE_API_KEY : FIREBASE_WEB_API_KEY_DEFAULT;
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: false })
    });
    if (!res.ok) return { ok: false, status: 401, error: "Invalid email or password." };
    const data: any = await res.json();
    if (!data?.localId) return { ok: false, status: 401, error: "Invalid credentials." };
    return { ok: true, localId: data.localId };
  } catch {
    return { ok: false, status: 502, error: "Authentication service unavailable." };
  }
}

/** Self-heal: point the admin_users doc at the real Firebase uid (mirrors Node login). */
export async function migrateAdminUidIfNeeded(env: Env, account: AdminAccount, firebaseUid: string): Promise<void> {
  if (account.uid === firebaseUid) return;
  try {
    const old = await fsGetDoc(env, `admin_users/${account.uid}`);
    if (old) {
      await fsSetDoc(env, `admin_users/${firebaseUid}`, old);
      await fsDeleteDoc(env, `admin_users/${account.uid}`);
    }
    account.uid = firebaseUid;
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Validation helpers (zod-lite)
// ---------------------------------------------------------------------------
export function isEmail(s: unknown): s is string {
  return typeof s === "string" && s.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
export function isStr(s: unknown, max: number): s is string {
  return typeof s === "string" && s.length <= max;
}
export function isCode6(s: unknown): s is string {
  return typeof s === "string" && /^\d{6}$/.test(s);
}
export function asUserAction(b: any): { action: "suspend" | "ban" | "reactivate" | "warn"; note?: string } | null {
  if (!b || !["suspend", "ban", "reactivate", "warn"].includes(b.action)) return null;
  if (b.note !== undefined && !isStr(b.note, 500)) return null;
  return { action: b.action, note: b.note };
}
export function asPayoutAction(b: any): { action: "approve" | "mark_paid" | "reject"; transactionReference?: string; adminNote?: string } | null {
  if (!b || !["approve", "mark_paid", "reject"].includes(b.action)) return null;
  if (b.transactionReference !== undefined && !isStr(b.transactionReference, 120)) return null;
  if (b.adminNote !== undefined && !isStr(b.adminNote, 500)) return null;
  return b;
}
export function asRole(r: unknown): AdminRole | null {
  return (ADMIN_ROLES as readonly string[]).includes(String(r)) ? (r as AdminRole) : null;
}
