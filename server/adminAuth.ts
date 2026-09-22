/**
 * ============================================================================
 * ANVIO TALK — SECURE ADMIN AUTH & RBAC (v2)
 * ============================================================================
 * Completely separate from end-user Firebase sessions:
 *  - Separate JWT secret (ADMIN_JWT_SECRET env, fallback derived & persisted)
 *  - Mandatory TOTP 2FA (Google Authenticator compatible)
 *  - 30-minute inactivity auto-logout (touch on every request)
 *  - Lockout: 5 failed logins -> 15 min lock (per-account AND per-IP)
 *  - RBAC: roles -> permissions mapping stored in admin_config (DB-driven)
 *  - Immutable audit log for every sensitive action
 */
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { authenticator } from "otplib";
import { z } from "zod";
import { adminDb } from "./firebaseAdmin";
import { createAuditLog } from "./monetizationService";

// ---------------------------------------------------------------------------
// Constants / config
// ---------------------------------------------------------------------------
export const ADMIN_ROLES = ["SUPER_ADMIN", "MODERATOR", "FINANCE_ADMIN", "SUPPORT"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const SESSION_TTL_MINUTES = 30;
export const SESSION_TTL_MS = SESSION_TTL_MINUTES * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
export const PENDING_APPROVAL_THRESHOLD_USD_DEFAULT = 60; // ≈ ₹5000 @83.5

// ---------------------------------------------------------------------------
// JWT secret — env var first, else derived + persisted in admin_config
// ---------------------------------------------------------------------------
let cachedJwtSecret: string | null = null;

async function getJwtSecret(): Promise<string> {
  if (cachedJwtSecret) return cachedJwtSecret;

  const envSecret = process.env.ADMIN_JWT_SECRET;
  if (envSecret && envSecret.length >= 32) {
    cachedJwtSecret = envSecret;
    return cachedJwtSecret;
  }

  // Fallback: persisted random secret (stable across server restarts)
  const cfgRef = adminDb.collection("admin_config").doc("config");
  const snap = await cfgRef.get();
  const existing = snap.exists ? snap.data()?.jwtSecret : null;
  if (typeof existing === "string" && existing.length >= 32) {
    cachedJwtSecret = existing;
    return cachedJwtSecret;
  }

  const generated = crypto.randomBytes(48).toString("hex");
  await cfgRef.set({ jwtSecret: generated, secretGeneratedAt: new Date().toISOString() }, { merge: true });
  console.warn("[AdminAuth] ADMIN_JWT_SECRET env not set — generated & persisted a random secret in admin_config.");
  cachedJwtSecret = generated;
  return cachedJwtSecret;
}

// ---------------------------------------------------------------------------
// Default role→permissions map (seeded into admin_config; editable there)
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
  // users
  "GET /api/admin/users": "users.view",
  "POST /api/admin/users/:uid/action": "users.manage",
  // reports
  "GET /api/admin/reports": "reports.view",
  "POST /api/admin/reports/:reportId/action": "reports.action",
  // stories / content
  "GET /api/admin/stories": "content.view",
  "POST /api/admin/stories/:storyId/delete": "content.delete",
  // payouts (decision route: approve/mark_paid/reject — maker-checker wraps threshold)
  "GET /api/admin/payouts": "payouts.view",
  "POST /api/admin/payouts/:payoutId/action": "payouts.approve",
  // monetization
  "GET /api/admin/monetization-report": "monetization.view",
  "GET /api/monetization/admin/creators": "monetization.view",
  "POST /api/monetization/admin/approve-creator": "monetization.approve",
  "POST /api/monetization/run-batch-calculator": "monetization.approve",
  // dashboard
  "GET /api/admin/overview": "analytics.view",
  "GET /api/admin/analytics": "analytics.view",
  // dating moderation
  "GET /api/admin/dating-flags": "dating.view",
  "POST /api/admin/dating-flags/:flagId/action": "dating.action",
  // maker-checker approvals
  "GET /api/admin/pending-approvals": "payouts.view",
  "POST /api/admin/pending-approvals/:id/decision": "payouts.approve",
  // audit logs
  "GET /api/admin/audit-logs": "audit.view",
  // admin management
  "GET /api/admin/admins": "admins.view",
  "POST /api/admin/admins/invite": "admins.manage",
  "POST /api/admin/admins/:uid/set-role": "admins.manage",
  "POST /api/admin/admins/:uid/reset-2fa": "admins.manage",
  "POST /api/admin/admins/:uid/set-active": "admins.manage",
  // config
  "GET /api/admin/config": "admins.view",
  "POST /api/admin/config/update": "admins.manage"
};

/** Route-level fallback: route pattern -> permission (used when role map misses) */
export function routePermission(method: string, path: string): string | null {
  const key = `${method.toUpperCase()} ${path}`;
  if (ROUTE_PERMISSION_MAP[key]) return ROUTE_PERMISSION_MAP[key];

  // Parameterized match: /api/admin/users/ABC/action -> pattern
  for (const pattern of Object.keys(ROUTE_PERMISSION_MAP)) {
    const [pMethod, pPath] = pattern.split(" ");
    if (pMethod !== method.toUpperCase()) continue;
    const patternParts = pPath.split("/");
    const pathParts = path.split("/");
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
// Admin config (role map, ip whitelist, vpn gate, threshold) — DB-driven
// ---------------------------------------------------------------------------
interface AdminConfig {
  rolePermissions: Record<string, string[]>;
  ipWhitelist: string[];
  vpnGateEnabled: boolean;
  payoutApprovalThresholdUsd: number;
}

let configCache: { value: AdminConfig; loadedAt: number } | null = null;
const CONFIG_CACHE_TTL_MS = 60 * 1000;

export async function getAdminConfig(): Promise<AdminConfig> {
  if (configCache && Date.now() - configCache.loadedAt < CONFIG_CACHE_TTL_MS) return configCache.value;
  try {
    const snap = await adminDb.collection("admin_config").doc("config").get();
    const data = snap.exists ? snap.data() || {} : {};
    const value: AdminConfig = {
      rolePermissions: data.rolePermissions || DEFAULT_ROLE_PERMISSIONS,
      ipWhitelist: Array.isArray(data.ipWhitelist) ? data.ipWhitelist : [],
      vpnGateEnabled: data.vpnGateEnabled === true,
      payoutApprovalThresholdUsd: typeof data.payoutApprovalThresholdUsd === "number"
        ? data.payoutApprovalThresholdUsd
        : PENDING_APPROVAL_THRESHOLD_USD_DEFAULT
    };
    configCache = { value, loadedAt: Date.now() };
    return value;
  } catch {
    configCache = {
      value: {
        rolePermissions: DEFAULT_ROLE_PERMISSIONS,
        ipWhitelist: [],
        vpnGateEnabled: false,
        payoutApprovalThresholdUsd: PENDING_APPROVAL_THRESHOLD_USD_DEFAULT
      },
      loadedAt: Date.now()
    };
    return configCache.value;
  }
}

export function invalidateConfigCache() {
  configCache = null;
}

// ---------------------------------------------------------------------------
// IP helpers
// ---------------------------------------------------------------------------
export function clientIp(req: { ip?: string; headers: Record<string, unknown> }): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
  return req.ip || "0.0.0.0";
}

function ipMatchesRule(ip: string, rule: string): boolean {
  if (rule === "*" || rule === "0.0.0.0/0") return true;
  if (rule.endsWith(".*")) {
    const prefix = rule.slice(0, -1); // "192.168." keep dot
    return ip.startsWith(prefix);
  }
  return ip === rule;
}

async function checkIpGate(req: { ip?: string; headers: Record<string, unknown> }): Promise<boolean> {
  const cfg = await getAdminConfig();
  if (cfg.ipWhitelist.length === 0) return true;
  const ip = clientIp(req);
  return cfg.ipWhitelist.some((rule) => ipMatchesRule(ip, rule));
}

// ---------------------------------------------------------------------------
// Rate limiting: per-IP AND per-account (memory; adequate for single-node local)
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
// Input validation schemas (zod)
// ---------------------------------------------------------------------------
export const LoginStartSchema = z.object({
  email: z.string().email().max(120),
  password: z.string().min(1).max(200)
});

export const Login2FaSchema = z.object({
  tempToken: z.string().min(10).max(600),
  code: z.string().regex(/^\d{6}$/)
});

export const Setup2FaVerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/)
});

export const UserActionSchema = z.object({
  action: z.enum(["suspend", "ban", "reactivate", "warn"]),
  note: z.string().max(500).optional()
});

export const PayoutActionSchema = z.object({
  action: z.enum(["approve", "mark_paid", "reject"]),
  transactionReference: z.string().max(120).optional(),
  adminNote: z.string().max(500).optional()
});

export const InviteAdminSchema = z.object({
  email: z.string().email().max(120),
  role: z.enum(ADMIN_ROLES)
});

export const SetRoleSchema = z.object({ role: z.enum(ADMIN_ROLES) });
export const SetActiveSchema = z.object({ isActive: z.boolean() });
export const ConfigUpdateSchema = z.object({
  rolePermissions: z.record(z.string(), z.array(z.string())).optional(),
  ipWhitelist: z.array(z.string().max(64)).max(50).optional(),
  vpnGateEnabled: z.boolean().optional(),
  payoutApprovalThresholdUsd: z.number().min(0).max(100000).optional()
});
export const DecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(500).optional()
});
export const DatingFlagActionSchema = z.object({
  action: z.enum(["confirm_fake", "clear_flag", "ban_user"]),
  note: z.string().max(500).optional()
});

// ---------------------------------------------------------------------------
// TOTP helpers
// ---------------------------------------------------------------------------
export function generateTotpSecret(email: string): { secret: string; otpauthUrl: string } {
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(email, "Anvio Talk Admin", secret);
  return { secret, otpauthUrl };
}

export function verifyTotp(secret: string, token: string): boolean {
  try {
    return authenticator.verify({ secret, token });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Admin account helpers (admin_users collection)
// ---------------------------------------------------------------------------
export interface AdminAccount {
  uid: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  totpSecret: string | null;
  totpEnabled: boolean;
  displayName?: string;
}

export async function getAdminAccount(uid: string): Promise<AdminAccount | null> {
  const snap = await adminDb.collection("admin_users").doc(uid).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  return {
    uid: snap.id,
    email: d.email || "",
    role: (ADMIN_ROLES as readonly string[]).includes(d.role) ? d.role : "SUPPORT",
    isActive: d.isActive !== false,
    totpSecret: d.totpSecret || null,
    totpEnabled: d.totpEnabled === true,
    displayName: d.displayName || undefined
  };
}

export async function findAdminByEmail(email: string): Promise<AdminAccount | null> {
  const snap = await adminDb.collection("admin_users").where("email", "==", email.toLowerCase()).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const d = doc.data();
  return {
    uid: doc.id,
    email: d.email || "",
    role: (ADMIN_ROLES as readonly string[]).includes(d.role) ? d.role : "SUPPORT",
    isActive: d.isActive !== false,
    totpSecret: d.totpSecret || null,
    totpEnabled: d.totpEnabled === true,
    displayName: d.displayName || undefined
  };
}

/**
 * Ensures the seed super-admin exists (kartiksingh7870n@gmail.com).
 * totpEnabled=false until the owner completes QR setup on first login.
 */
export async function ensureSeedSuperAdmin(): Promise<void> {
  const seedEmail = "kartiksingh7870n@gmail.com";
  try {
    const existing = await findAdminByEmail(seedEmail);
    if (existing) return;
    await adminDb.collection("admin_users").add({
      email: seedEmail,
      role: "SUPER_ADMIN",
      isActive: true,
      totpSecret: null,
      totpEnabled: false,
      displayName: "Kartik (Owner)",
      createdAt: new Date().toISOString()
    });
    console.log("[AdminAuth] Seeded SUPER_ADMIN:", seedEmail);
  } catch (e) {
    console.warn("[AdminAuth] Seed admin check skipped:", (e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Admin JWT sessions (admin_sessions collection) — SEPARATE from user auth
// ---------------------------------------------------------------------------
interface SessionClaims {
  sid: string;
  uid: string;
  email: string;
  role: AdminRole;
}

export async function createAdminSession(
  account: AdminAccount,
  ip: string,
  userAgent: string
): Promise<string> {
  const sid = crypto.randomBytes(24).toString("hex");
  const now = Date.now();

  await adminDb.collection("admin_sessions").doc(sid).set({
    adminUid: account.uid,
    email: account.email,
    role: account.role,
    tokenHash: sha256(sid),
    ipAddress: ip,
    userAgent: userAgent.slice(0, 200),
    createdAtMs: now,
    lastActivityAtMs: now,
    expiresAtMs: now + SESSION_TTL_MS,
    revoked: false
  });

  const secret = await getJwtSecret();
  const claims: SessionClaims = { sid, uid: account.uid, email: account.email, role: account.role };
  return jwt.sign(claims, secret, { expiresIn: SESSION_TTL_MINUTES * 60 });
}

export async function validateAdminSession(
  token: string
): Promise<{ valid: true; claims: SessionClaims } | { valid: false; reason: string }> {
  let claims: SessionClaims;
  try {
    const secret = await getJwtSecret();
    claims = jwt.verify(token, secret) as SessionClaims;
  } catch {
    return { valid: false, reason: "Invalid or expired admin token." };
  }

  try {
    const snap = await adminDb.collection("admin_sessions").doc(claims.sid).get();
    if (!snap.exists) return { valid: false, reason: "Session not found." };
    const s = snap.data() || {};
    if (s.revoked === true) return { valid: false, reason: "Session revoked (logged out)." };

    const now = Date.now();
    if (typeof s.expiresAtMs === "number" && now > s.expiresAtMs) {
      return { valid: false, reason: "Session expired." };
    }
    // 30-minute inactivity sliding window
    if (typeof s.lastActivityAtMs === "number" && now - s.lastActivityAtMs > SESSION_TTL_MS) {
      await snap.ref.set({ revoked: true, revokedReason: "inactivity_timeout" }, { merge: true });
      return { valid: false, reason: "Session timed out after 30 minutes of inactivity." };
    }

    await snap.ref.set({ lastActivityAtMs: now, expiresAtMs: now + SESSION_TTL_MS }, { merge: true });
    return { valid: true, claims };
  } catch (e) {
    return { valid: false, reason: "Session validation error." };
  }
}

export async function revokeAdminSession(sid: string, reason: string) {
  try {
    await adminDb.collection("admin_sessions").doc(sid).set(
      { revoked: true, revokedReason: reason, revokedAtMs: Date.now() },
      { merge: true }
    );
  } catch { /* non-fatal */ }
}

/**
 * Boot-time: resolve the SAME secret that getJwtSecret() uses (env or persisted
 * random) and warm the synchronous cache so temp 2FA tokens and session JWTs
 * share one secret even across restarts.
 */
export async function warmJwtSecret(): Promise<void> {
  const secret = await getJwtSecret();
  setSyncSecretCache(secret);
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

// ---------------------------------------------------------------------------
// RBAC: permission check (DB-driven role map with route fallback)
// ---------------------------------------------------------------------------
export function roleHasPermission(rolePermissions: Record<string, string[]>, role: AdminRole, permission: string): boolean {
  const perms = rolePermissions[role] || DEFAULT_ROLE_PERMISSIONS[role] || [];
  if (perms.includes("*")) return true;
  if (perms.includes(permission)) return true;

  // prefix grants: "users.manage" implied by "users.*"
  if (perms.includes(permission.split(".")[0] + ".*")) return true;
  return false;
}

/** Inline helper for per-action permission checks inside handlers (e.g. dismiss vs delete). */
export function hasPermission(session: { role: AdminRole } | undefined, permission: string): boolean {
  if (!session?.role) return false;
  return roleHasPermission(syncRolePermissionsCache || DEFAULT_ROLE_PERMISSIONS, session.role, permission);
}

// Populated by requirePermission's config load so hasPermission stays cheap
let syncRolePermissionsCache: Record<string, string[]> | null = null;
export function cacheRolePermissionsForSync(map: Record<string, string[]>) {
  syncRolePermissionsCache = map;
}

// ---------------------------------------------------------------------------
// Audit logging (immutable collection; also best-effort legacy log)
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

export async function writeAdminAudit(entry: AdminAuditEntry): Promise<void> {
  try {
    await adminDb.collection("admin_audit_logs").add({
      ...entry,
      oldValue: entry.oldValue === undefined ? null : entry.oldValue,
      newValue: entry.newValue === undefined ? null : entry.newValue,
      timestamp: new Date().toISOString(),
      timestampMs: Date.now()
    });

    // Legacy parallel log (existing audit system) — best effort
    await createAuditLog(adminDb, {
      userId: entry.adminId,
      targetUserId: entry.targetId,
      timestamp: entry.timestamp,
      timestampMs: Date.now(),
      deviceId: "admin_console",
      ipHash: "admin_ip",
      eventType: "fraud_check",
      verificationStatus: "PASSED",
      reason: `[ADMIN:${entry.action}] ${entry.adminEmail} → ${entry.targetType}/${entry.targetId}${entry.note ? " · " + entry.note : ""}`
    });
  } catch (e) {
    console.error("[AdminAuth] audit write failed:", e);
  }
}

/**
 * Records a manual 2FA secret reset (direct Firestore delete) in the audit trail.
 * Security ops MUST call this after hand-resetting totpSecret in the console.
 */
export async function recordTotpManualReset(adminUid: string, performedBy: string, ip: string): Promise<void> {
  const account = await getAdminAccount(adminUid);
  await writeAdminAudit({
    adminId: performedBy,
    adminEmail: performedBy,
    action: "2fa.manual_reset",
    targetType: "admin_user",
    targetId: adminUid,
    oldValue: { totpEnabled: account?.totpEnabled ?? null, role: account?.role ?? null },
    newValue: { totpEnabled: false, totpSecret: "DELETED_MANUALLY" },
    ipAddress: ip,
    note: "TOTP secret manually deleted from Firestore; admin must re-enroll on next login."
  });
}

// ---------------------------------------------------------------------------
// Express middleware: adminAuthGuard + requirePermission
// ---------------------------------------------------------------------------
interface AuthedReq {
  headers: Record<string, unknown>;
  ip?: string;
  url?: string;
  method?: string;
  adminSession?: { claims: SessionClaims; email: string; role: AdminRole };
  adminDenied?: boolean;
}

export function adminAuthGuard() {
  return async (req: AuthedReq, res: { status: (n: number) => { json: (d: unknown) => void } }, next: () => void) => {
    try {
      const header = String(req.headers["authorization"] || "");
      if (!header.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Admin authentication required." });
      }
      const token = header.slice(7).trim();

      // Firebase user tokens must NEVER satisfy admin routes
      const result = await validateAdminSession(token);
      if (!result.valid) {
        return res.status(401).json({ error: result.reason });
      }

      // IP gate (whitelist / VPN flag) — enforced after auth to avoid user enumeration
      const ipOk = await checkIpGate(req as { ip?: string; headers: Record<string, unknown> });
      if (!ipOk) {
        return res.status(403).json({ error: "Access denied from this network." });
      }

      const account = await getAdminAccount(result.claims.uid);
      if (!account || !account.isActive) {
        return res.status(403).json({ error: "Admin account is disabled." });
      }

      (req as any).adminSession = {
        claims: result.claims,
        email: account.email,
        role: account.role
      };
      next();
    } catch (e) {
      console.error("[AdminAuth] guard error:", e);
      return res.status(500).json({ error: "Admin auth failure." });
    }
  };
}

/**
 * requirePermission('users.ban') — DB-driven role→permission check.
 * ALWAYS falls back to route map permission if the role map lacks an entry,
 * so no route can accidentally run without a permission check.
 */
export function requirePermission(permission?: string) {
  return async (req: AuthedReq, res: { status: (n: number) => { json: (d: unknown) => void } }, next: () => void) => {
    try {
      const session = (req as any).adminSession;
      if (!session?.role) {
        return res.status(401).json({ error: "Admin authentication required." });
      }

      const cfg = await getAdminConfig();
      cacheRolePermissionsForSync(cfg.rolePermissions);
      const method = (req.method || "GET").toUpperCase();
      const rawPath = (req.url || "").split("?")[0];

      // Resolve permission: explicit argument > route map (with :param matching)
      let needed = permission || null;
      if (!needed) {
        // Match against known patterns by replacing param segments
        for (const pattern of Object.keys(ROUTE_PERMISSION_MAP)) {
          const [pMethod, pPath] = pattern.split(" ");
          if (pMethod !== method) continue;
          const patternParts = pPath.split("/");
          const pathParts = rawPath.split("/");
          if (patternParts.length !== pathParts.length) continue;
          let ok = true;
          for (let i = 0; i < patternParts.length; i++) {
            if (patternParts[i].startsWith(":")) continue;
            if (patternParts[i] !== pathParts[i]) { ok = false; break; }
          }
          if (ok) { needed = ROUTE_PERMISSION_MAP[pattern]; break; }
        }
      }

      if (!needed) {
        // DENY BY DEFAULT — route not in map must never pass silently
        console.error(`[AdminAuth] NO PERMISSION MAPPED for ${method} ${rawPath} — denying.`);
        return res.status(403).json({ error: "Endpoint not provisioned for admin access." });
      }

      if (!roleHasPermission(cfg.rolePermissions, session.role, needed)) {
        return res.status(403).json({ error: `Your role (${session.role}) lacks permission: ${needed}` });
      }

      next();
    } catch (e) {
      console.error("[AdminAuth] permission error:", e);
      return res.status(500).json({ error: "Permission check failure." });
    }
  };
}

// ---------------------------------------------------------------------------
// Login temp token (step 1 of login: password OK, 2FA pending)
// ---------------------------------------------------------------------------
export function createTemp2FaToken(uid: string): string {
  const secret = getJwtSecretSync();
  return jwt.sign({ t: "2fa-pending", uid }, secret, { expiresIn: 5 * 60 });
}

export function verifyTemp2FaToken(token: string): { uid: string } | null {
  try {
    const secret = getJwtSecretSync();
    const decoded = jwt.verify(token, secret) as { t: string; uid: string };
    if (decoded.t !== "2fa-pending") return null;
    return { uid: decoded.uid };
  } catch {
    return null;
  }
}

// Synchronous secret accessor (cached only — used by temp token flows)
let syncSecretCache: string | null = null;
export function setSyncSecretCache(secret: string) { syncSecretCache = secret; }
export function getJwtSecretSync(): string {
  if (syncSecretCache) return syncSecretCache;
  // One-time bootstrapping: derive from env or a module-level random (persisted async later)
  const env = process.env.ADMIN_JWT_SECRET;
  if (env && env.length >= 32) { syncSecretCache = env; return syncSecretCache; }
  syncSecretCache = crypto.randomBytes(48).toString("hex");
  return syncSecretCache;
}
