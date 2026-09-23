/**
 * ============================================================================
 * ANVIO TALK — ADMIN API WORKER (Cloudflare)
 * ============================================================================
 * Same-origin admin API for the web admin console (anviotalk.in/admin).
 * Mirrors the Node server's /api/admin/* contract 1:1 but runs on Workers:
 *   - Firestore via REST (worker/firestore.ts)
 *   - Auth: Firebase password + mandatory TOTP 2FA + JWT sessions (worker/auth.ts)
 *   - RBAC deny-by-default, immutable audit logs, maker-checker payouts
 */
import { Env, fsGetDoc, fsSetDoc, fsAddDoc, fsDeleteDoc, fsListDocs, fsRunQuery } from "./firestore";
import {
  AdminSession, AdminRole, DEFAULT_ROLE_PERMISSIONS,
  ensureSeedSuperAdmin, findAdminByEmail, getAdminAccount, getAdminById,
  firebasePasswordSignIn, migrateAdminUidIfNeeded,
  checkLoginRate, recordFailedLogin, clearFailedLogins,
  createTemp2FaToken, verifyTemp2FaToken, verifyTotp, generateTotpSecret,
  createAdminSession, validateAdminSession, revokeAdminSession,
  getAdminConfig, invalidateConfigCache, hasPermission, checkIpGate, clientIp,
  writeAdminAudit, routePermission,
  asUserAction, asPayoutAction, asRole, isEmail, isStr, isCode6
} from "./auth";
import { qrDataUrl } from "./qr";

interface Ctx {
  req: Request;
  env: Env;
  ip: string;
  userAgent: string;
  session?: AdminSession;
}

const JSON_H = { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" };
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_H });
}
function ok(data: Record<string, unknown> = {}): Response { return json({ success: true, ...data }); }
function fail(error: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ success: false, error, ...extra }, status);
}

// ---------------------------------------------------------------------------
// Field helpers (Firestore REST decodes timestamps as ISO strings)
// ---------------------------------------------------------------------------
function toMs(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") { const t = Date.parse(v); return isNaN(t) ? 0 : t; }
  if (typeof v === "object") {
    if (typeof v.seconds === "number") return v.seconds * 1000;
    if (typeof v._seconds === "number") return v._seconds * 1000;
    if (typeof v.createdAt === "string") return Date.parse(v.createdAt) || 0;
  }
  return 0;
}

async function getBody(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

async function listAll(env: Env, collection: string, maxDocs = 2000): Promise<Array<{ id: string; data: any }>> {
  return fsListDocs(env, collection, { maxDocs, pageSize: 300 });
}

// ---------------------------------------------------------------------------
// Auth guard + RBAC
// ---------------------------------------------------------------------------
async function requireSession(ctx: Ctx): Promise<Response | null> {
  const header = ctx.req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return fail("Admin authentication required.", 401);
  const token = header.slice(7).trim();
  const result = await validateAdminSession(ctx.env, token);
  if (!result.valid) return fail(result.reason, 401);
  if (!(await checkIpGate(ctx.env, ctx.ip))) return fail("Access denied from this network.", 403);
  const account = await getAdminAccount(ctx.env, result.claims.uid);
  if (!account || !account.isActive) return fail("Admin account is disabled.", 403);
  ctx.session = { claims: result.claims, email: account.email, role: account.role };
  return null;
}

async function requirePermission(ctx: Ctx, permission: string): Promise<Response | null> {
  const unauthed = await requireSession(ctx);
  if (unauthed) return unauthed;
  const s = ctx.session!;
  if (!(await hasPermission(ctx.env, s, permission))) {
    return fail(`Your role (${s.role}) lacks permission: ${permission}`, 403);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
async function handleLogin(ctx: Ctx): Promise<Response> {
  const body = await getBody(ctx.req);
  if (!isEmail(body?.email) || !isStr(body?.password, 200)) {
    return fail("Invalid email or password format.", 400);
  }
  const email = (body.email as string).toLowerCase().trim();
  const ip = ctx.ip;

  await ensureSeedSuperAdmin(ctx.env);

  const rl = checkLoginRate(ip, email);
  if (!rl.allowed) return fail(rl.reason || "Too many attempts.", 429, { retryAfterMin: rl.retryAfterMin });

  const account = await findAdminByEmail(ctx.env, email);
  if (!account || !account.isActive) {
    recordFailedLogin(ip, email);
    return fail("Invalid credentials or admin account disabled.", 401);
  }

  const fb = await firebasePasswordSignIn(ctx.env, email, body.password);
  if (!fb.ok) {
    recordFailedLogin(ip, email);
    return fail(fb.error, fb.status);
  }

  await migrateAdminUidIfNeeded(ctx.env, account, fb.localId);
  clearFailedLogins(ip, email);

  const tempToken = await createTemp2FaToken(ctx.env, account.uid);
  return ok({ step: "2fa", tempToken, totpEnabled: account.totpEnabled, email: account.email, role: account.role });
}

async function handle2FaSetup(ctx: Ctx): Promise<Response> {
  const body = await getBody(ctx.req);
  if (!isStr(body?.tempToken, 600) || String(body.tempToken).length < 10) {
    return fail("tempToken required (from login step).", 400);
  }
  const pending = await verifyTemp2FaToken(ctx.env, body.tempToken);
  if (!pending) return fail("Login session expired. Sign in again.", 401);

  const account = await getAdminAccount(ctx.env, pending.uid);
  if (!account) return fail("Admin account not found.", 404);
  if (account.totpEnabled && account.totpSecret) {
    return fail("2FA already enabled. Use reset via another SUPER_ADMIN if locked out.", 400);
  }
  const { secret, otpauthUrl } = generateTotpSecret(account.email);
  await fsSetDoc(ctx.env, `admin_users/${account.uid}`, {
    totpSecret: secret, totpEnabled: false, totpSecretCreatedAt: new Date().toISOString()
  });
  return ok({ otpauthUrl, qrDataUrl: qrDataUrl(otpauthUrl), secret });
}

async function handle2Fa(ctx: Ctx): Promise<Response> {
  const body = await getBody(ctx.req);
  if (!isStr(body?.tempToken, 600) || !isCode6(body?.code)) {
    return fail("Enter the 6-digit code from Google Authenticator.", 400);
  }
  const pending = await verifyTemp2FaToken(ctx.env, body.tempToken);
  if (!pending) return fail("Login session expired. Sign in again.", 401);

  const account = await getAdminAccount(ctx.env, pending.uid);
  if (!account || !account.isActive) return fail("Admin account disabled.", 403);

  const rl = checkLoginRate(ctx.ip, account.email);
  if (!rl.allowed) return fail(rl.reason || "Too many attempts.", 429, { retryAfterMin: rl.retryAfterMin });

  if (!account.totpSecret) {
    return fail("2FA not initialized. Call /2fa/setup first.", 400, { step: "setup" });
  }
  const codeOk = await verifyTotp(account.totpSecret, body.code);
  if (!codeOk) {
    recordFailedLogin(ctx.ip, account.email);
    await writeAdminAudit(ctx.env, {
      adminId: account.uid, adminEmail: account.email, action: "auth.2fa_failed",
      targetType: "admin_user", targetId: account.uid, ipAddress: ctx.ip,
      note: "Invalid TOTP code during login."
    });
    return fail("Wrong code.", 401);
  }

  if (!account.totpEnabled) {
    await fsSetDoc(ctx.env, `admin_users/${account.uid}`, { totpEnabled: true, totpEnabledAt: new Date().toISOString() });
  }
  clearFailedLogins(ctx.ip, account.email);

  const token = await createAdminSession(ctx.env, account, ctx.ip, ctx.userAgent);
  await writeAdminAudit(ctx.env, {
    adminId: account.uid, adminEmail: account.email, action: "auth.login",
    targetType: "admin_session", targetId: account.uid, ipAddress: ctx.ip,
    note: "Login success (password + TOTP)."
  });
  return ok({ token, email: account.email, role: account.role, expiresInMinutes: 30 });
}

// ---------------------------------------------------------------------------
// Data: overview / analytics
// ---------------------------------------------------------------------------
async function handleOverview(ctx: Ctx): Promise<Response> {
  const env = ctx.env;
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dayAgoMs = Date.now() - 24 * 60 * 60 * 1000;

  let totalUsers = 0, suspendedUsers = 0, bannedUsers = 0, warnedUsers = 0;
  for (const u of await listAll(env, "users")) {
    totalUsers++;
    const st = String(u.data.accountStatus || u.data.status || "active").toLowerCase();
    if (st === "suspended") suspendedUsers++;
    else if (st === "banned") bannedUsers++;
    if (u.data.hasWarning === true) warnedUsers++;
  }

  let storiesCount = 0, newStories24h = 0;
  for (const s of await listAll(env, "stories", 1500)) {
    storiesCount++;
    if (toMs(s.data.createdAt) >= dayAgoMs || (typeof s.data.createdAtMs === "number" && s.data.createdAtMs >= dayAgoMs)) newStories24h++;
  }

  let pendingReports = 0, totalReports = 0;
  for (const r of await listAll(env, "reports", 1500)) {
    totalReports++;
    if (r.data.status === "pending") pendingReports++;
  }

  let monthViews = 0;
  try {
    monthViews = (await fsRunQuery(env, {
      from: "monetization_views",
      clauses: [
        { field: "monthKey", op: "EQUAL", value: monthKey },
        { field: "verificationStatus", op: "EQUAL", value: "PASSED" }
      ],
      limit: 3000
    })).length;
  } catch { /* ignore */ }

  let pendingPayouts = 0, pendingPayoutUsd = 0;
  for (const p of await listAll(env, "payouts", 1000)) {
    if (p.data.status === "requested" || p.data.status === "processing") {
      pendingPayouts++;
      pendingPayoutUsd += Number(p.data.amountUsd) || 0;
    }
  }

  return ok({
    totalUsers, suspendedUsers, bannedUsers, warnedUsers,
    storiesCount, newStories24h,
    pendingReports, totalReports,
    monthViews, pendingPayouts,
    pendingPayoutUsd: Number(pendingPayoutUsd.toFixed(2)),
    generatedAt: now.toISOString()
  });
}

async function handleAnalytics(ctx: Ctx): Promise<Response> {
  const env = ctx.env;
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const monthMs = 30 * dayMs;

  let dau = 0, wau = 0, mau = 0, totalUsers = 0;
  for (const u of await listAll(env, "users")) {
    totalUsers++;
    const lastMs = Math.max(toMs(u.data.lastActiveAt), typeof u.data.lastActiveAtMs === "number" ? u.data.lastActiveAtMs : 0);
    if (now - lastMs < dayMs) dau++;
    if (now - lastMs < 7 * dayMs) wau++;
    if (now - lastMs < monthMs) mau++;
  }

  let totalViews = 0;
  try { totalViews = (await listAll(env, "monetization_views", 3000)).length; } catch { /* ignore */ }

  let totalPaidOut = 0, paidCount = 0, flaggedCount = 0;
  try {
    for (const p of await listAll(env, "payouts", 1000)) {
      if (p.data.status === "paid") { totalPaidOut += Number(p.data.amountUsd) || 0; paidCount++; }
    }
    flaggedCount = (await fsRunQuery(env, { from: "flagged_content", clauses: [{ field: "status", op: "EQUAL", value: "open" }], limit: 1000 })).length;
  } catch { /* ignore */ }

  return ok({
    dau, wau, mau, totalUsers,
    stickiness: mau > 0 ? Math.round((dau / mau) * 100) : 0,
    totalViews,
    totalPaidOutUsd: Number(totalPaidOut.toFixed(2)),
    paidPayoutCount: paidCount,
    flaggedContentCount: flaggedCount,
    generatedAt: new Date().toISOString()
  });
}

// ---------------------------------------------------------------------------
// Data: users
// ---------------------------------------------------------------------------
async function handleUsersList(ctx: Ctx): Promise<Response> {
  const url = new URL(ctx.req.url);
  const search = (url.searchParams.get("search") || "").toLowerCase().trim();
  const statusFilter = (url.searchParams.get("status") || "all").toLowerCase();

  const users: any[] = [];
  for (const uDoc of await listAll(ctx.env, "users")) {
    const u = uDoc.data;
    const rawStatus = String(u.accountStatus || (u.status === "banned" || u.status === "suspended" ? u.status : "active")).toLowerCase();
    users.push({
      uid: uDoc.id,
      username: u.username || "unknown",
      displayName: u.displayName || u.name || u.username || "Anonymous",
      avatarUrl: u.avatarUrl || u.avatar || "",
      email: u.email || "",
      accountStatus: rawStatus,
      suspendedReason: u.suspendedReason || u.suspensionReason || null,
      suspendedAt: u.suspendedAt || null,
      hasWarning: u.hasWarning === true,
      warningMessage: u.warningMessage || null,
      monetizationStatus: u.monetizationStatus || (u.isMonetized ? "Approved" : "In Progress"),
      followersCount: u.followersCount || 0,
      createdAt: u.createdAt || null,
      lastActiveAt: u.lastActiveAt || null
    });
  }

  let filtered = users;
  if (statusFilter === "suspended") filtered = filtered.filter((u) => u.accountStatus === "suspended");
  else if (statusFilter === "banned") filtered = filtered.filter((u) => u.accountStatus === "banned");
  else if (statusFilter === "active") filtered = filtered.filter((u) => u.accountStatus === "active");
  else if (statusFilter === "warned") filtered = filtered.filter((u) => u.hasWarning);
  else if (statusFilter === "blocked") filtered = filtered.filter((u) => u.accountStatus === "suspended" || u.accountStatus === "banned");

  if (search) {
    filtered = filtered.filter((u) =>
      String(u.username).toLowerCase().includes(search) ||
      String(u.displayName).toLowerCase().includes(search) ||
      String(u.email).toLowerCase().includes(search) ||
      String(u.uid).toLowerCase().includes(search));
  }

  filtered.sort((a, b) => {
    const blockedA = a.accountStatus === "suspended" || a.accountStatus === "banned" ? 0 : 1;
    const blockedB = b.accountStatus === "suspended" || b.accountStatus === "banned" ? 0 : 1;
    if (blockedA !== blockedB) return blockedA - blockedB;
    return (b.followersCount || 0) - (a.followersCount || 0);
  });

  return ok({ users: filtered, total: users.length });
}

async function handleUserAction(ctx: Ctx, uid: string): Promise<Response> {
  const parsed = asUserAction(await getBody(ctx.req));
  if (!parsed) return fail("Invalid action. Use suspend | ban | reactivate | warn (note ≤ 500 chars).", 400);
  const { action, note } = parsed;
  const s = ctx.session!;

  const perActionPerm: Record<string, string> = { suspend: "users.suspend", ban: "users.ban", reactivate: "users.reactivate", warn: "users.warn" };
  if (!(await hasPermission(ctx.env, s, perActionPerm[action]))) {
    return fail(`Your role (${s.role}) lacks permission: ${perActionPerm[action]}`, 403);
  }
  if (!uid) return fail("uid is required", 400);
  if (s.claims.uid === uid) return fail("You cannot moderate your own account.", 400);

  const before = await fsGetDoc(ctx.env, `users/${uid}`);
  if (!before) return fail("User not found", 404);
  const oldValue = { accountStatus: before.accountStatus ?? before.status ?? null, isSuspended: before.isSuspended ?? false, hasWarning: before.hasWarning ?? false, monetizationStatus: before.monetizationStatus ?? null };

  const nowIso = new Date().toISOString();
  const updateData: Record<string, unknown> = {};
  if (action === "suspend") {
    Object.assign(updateData, { accountStatus: "suspended", status: "suspended", isSuspended: true, suspendedAt: nowIso, suspendedReason: note || "Suspended by administrator", monetizationStatus: "Suspended" });
  } else if (action === "ban") {
    Object.assign(updateData, { accountStatus: "banned", status: "banned", isSuspended: true, suspendedAt: nowIso, suspendedReason: note || "Permanently banned by administrator", monetizationStatus: "Suspended" });
  } else if (action === "reactivate") {
    Object.assign(updateData, { accountStatus: "active", status: "active", isSuspended: false, suspendedAt: null, suspendedReason: null });
    try {
      const mon = await fsGetDoc(ctx.env, `users/${uid}/monetization/status`);
      const monStatus = mon?.status;
      updateData.monetizationStatus = monStatus === "Suspended" ? "Suspended" : ((monStatus as string) || "In Progress");
    } catch { updateData.monetizationStatus = "In Progress"; }
  } else if (action === "warn") {
    Object.assign(updateData, { hasWarning: true, warningMessage: note || "Your account has received an official warning for violating Community Guidelines.", warnedAt: nowIso });
  }

  await fsSetDoc(ctx.env, `users/${uid}`, updateData);
  await writeAdminAudit(ctx.env, {
    adminId: s.claims.uid, adminEmail: s.email, action: `users.${action}`,
    targetType: "user", targetId: uid, oldValue,
    newValue: { accountStatus: updateData.accountStatus ?? null, isSuspended: updateData.isSuspended ?? null, hasWarning: updateData.hasWarning ?? null, monetizationStatus: updateData.monetizationStatus ?? null },
    ipAddress: ctx.ip, note
  });
  return ok({ message: `User ${uid} action '${action}' applied successfully.`, action });
}

// ---------------------------------------------------------------------------
// Data: reports
// ---------------------------------------------------------------------------
async function handleReportsList(ctx: Ctx): Promise<Response> {
  const url = new URL(ctx.req.url);
  const status = url.searchParams.get("status") || "all";
  let reports: any[] = (await listAll(ctx.env, "reports", 1500)).map((d) => ({ id: d.id, ...d.data }));
  if (status && status !== "all") reports = reports.filter((r) => r.status === status);
  reports.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
  return ok({ reports });
}

async function handleReportAction(ctx: Ctx, reportId: string): Promise<Response> {
  const body = await getBody(ctx.req);
  const action = body?.action;
  const adminNote = isStr(body?.adminNote, 500) ? body.adminNote : undefined;
  const s = ctx.session!;

  const actionPerm: Record<string, string> = { dismiss: "reports.dismiss", warn: "users.warn", suspend_user: "users.suspend", delete_content: "content.delete" };
  if (!actionPerm[action]) return fail("action must be dismiss | warn | suspend_user | delete_content", 400);
  if (!(await hasPermission(ctx.env, s, actionPerm[action]))) {
    return fail(`Your role (${s.role}) lacks permission: ${actionPerm[action]}`, 403);
  }

  const report = await fsGetDoc(ctx.env, `reports/${reportId}`);
  if (!report) return fail("Report not found", 404);

  if (action === "suspend_user" && (report.targetType === "user" || report.targetType === "story")) {
    const targetUserId = report.targetType === "user" ? report.targetId : (report.reporterUid || report.targetId);
    await fsSetDoc(ctx.env, `users/${targetUserId}`, {
      status: "suspended", isSuspended: true, monetizationStatus: "Suspended",
      suspendedAt: new Date().toISOString(),
      suspendedReason: adminNote || `Suspended due to report #${reportId}`
    });
  } else if (action === "warn" && report.targetType === "user") {
    await fsSetDoc(ctx.env, `users/${report.targetId}`, {
      hasWarning: true,
      warningMessage: adminNote || "Your account has received an official warning for violating Community Guidelines.",
      warnedAt: new Date().toISOString()
    });
  } else if (action === "delete_content") {
    if (report.targetType === "story") await fsDeleteDoc(ctx.env, `stories/${report.targetId}`);
    else if (report.targetType === "group") await fsDeleteDoc(ctx.env, `chats/${report.targetId}`);
  }

  await fsSetDoc(ctx.env, `reports/${reportId}`, {
    status: action === "dismiss" ? "dismissed" : "actioned",
    reviewedBy: s.claims.uid,
    reviewedByEmail: s.email,
    reviewedAt: new Date().toISOString(),
    actionTaken: action,
    adminNote: adminNote || null
  });

  await writeAdminAudit(ctx.env, {
    adminId: s.claims.uid, adminEmail: s.email, action: `reports.${action}`,
    targetType: String(report.targetType || "report"), targetId: String(report.targetId || reportId),
    oldValue: { reportStatus: report.status || "pending" },
    newValue: { reportStatus: action === "dismiss" ? "dismissed" : "actioned", actionTaken: action },
    ipAddress: ctx.ip, note: adminNote
  });
  return ok({ message: `Report action '${action}' applied successfully.` });
}

// ---------------------------------------------------------------------------
// Data: stories (content moderation)
// ---------------------------------------------------------------------------
async function handleStoriesList(ctx: Ctx): Promise<Response> {
  const url = new URL(ctx.req.url);
  const search = (url.searchParams.get("search") || "").toLowerCase().trim();

  const userMap: Record<string, { username: string; displayName: string }> = {};
  try {
    for (const d of await listAll(ctx.env, "users")) {
      const u = d.data;
      userMap[d.id] = { username: u.username || "unknown", displayName: u.displayName || u.name || u.username || "Anonymous" };
    }
  } catch { /* ignore */ }

  const stories: any[] = [];
  for (const d of await listAll(ctx.env, "stories", 1500)) {
    const s = d.data;
    const authorUid = s.authorUid || "";
    stories.push({
      id: d.id,
      authorUid,
      authorUsername: userMap[authorUid]?.username || "unknown",
      authorDisplayName: userMap[authorUid]?.displayName || "Unknown",
      caption: s.caption || s.text || "",
      mediaUrl: s.mediaUrl || s.imageUrl || "",
      audience: s.audience || "everyone",
      likesCount: s.likesCount || (Array.isArray(s.likes) ? s.likes.length : 0) || 0,
      viewsCount: s.viewsCount || (Array.isArray(s.viewedBy) ? s.viewedBy.length : 0) || 0,
      createdAtMs: Math.max(toMs(s.createdAt), typeof s.createdAtMs === "number" ? s.createdAtMs : 0),
      status: s.status || "active"
    });
  }
  stories.sort((a, b) => b.createdAtMs - a.createdAtMs);
  let result = stories;
  if (search) {
    result = stories.filter((x) =>
      String(x.authorUsername).toLowerCase().includes(search) ||
      String(x.authorDisplayName).toLowerCase().includes(search) ||
      String(x.caption).toLowerCase().includes(search) ||
      String(x.id).toLowerCase().includes(search));
  }
  return ok({ stories: result.slice(0, 300), total: stories.length });
}

async function handleStoryDelete(ctx: Ctx, storyId: string): Promise<Response> {
  const body = await getBody(ctx.req);
  const note = isStr(body?.note, 500) ? body.note : undefined;
  const s = ctx.session!;
  const story = await fsGetDoc(ctx.env, `stories/${storyId}`);
  if (!story) return fail("Story not found", 404);

  await fsDeleteDoc(ctx.env, `stories/${storyId}`);
  await writeAdminAudit(ctx.env, {
    adminId: s.claims.uid, adminEmail: s.email, action: "content.delete_story",
    targetType: "story", targetId: storyId,
    oldValue: { authorUid: story.authorUid || null, caption: String(story.caption || "").slice(0, 200) },
    newValue: { deleted: true }, ipAddress: ctx.ip, note
  });
  return ok({ message: `Story ${storyId} deleted successfully.` });
}

// ---------------------------------------------------------------------------
// Data: payouts + maker-checker
// ---------------------------------------------------------------------------
async function handlePayoutsList(ctx: Ctx): Promise<Response> {
  const payouts = (await listAll(ctx.env, "payouts", 1000)).map((d) => ({ id: d.id, ...d.data }));
  payouts.sort((a, b) => toMs(b.requestedAt) - toMs(a.requestedAt));
  return ok({ payouts });
}

async function handlePayoutAction(ctx: Ctx, payoutId: string): Promise<Response> {
  const parsed = asPayoutAction(await getBody(ctx.req));
  if (!parsed) return fail("action must be approve | mark_paid | reject; transactionReference ≤ 120 chars.", 400);
  const { action, transactionReference, adminNote } = parsed;
  const s = ctx.session!;

  const payout = await fsGetDoc(ctx.env, `payouts/${payoutId}`);
  if (!payout) return fail("Payout record not found", 404);
  const creatorId = payout.creatorId as string | undefined;
  const amountUsd = typeof payout.amountUsd === "number" ? payout.amountUsd : 0;
  const oldStatus = payout.status || "pending";

  const cfg = await getAdminConfig(ctx.env);
  const threshold = cfg.payoutApprovalThresholdUsd;
  const isDecidingAction = action === "mark_paid" || action === "approve";
  if (isDecidingAction && amountUsd >= threshold) {
    const existing = await fsRunQuery(ctx.env, {
      from: "pending_payout_approvals",
      clauses: [
        { field: "payoutId", op: "EQUAL", value: payoutId },
        { field: "status", op: "EQUAL", value: "pending" }
      ],
      limit: 1
    });
    if (existing.length === 0) {
      const reqId = await fsAddDoc(ctx.env, "pending_payout_approvals", {
        payoutId, creatorId, amountUsd, thresholdUsd: threshold,
        requestedAction: action, requestedBy: s.claims.uid, requestedByEmail: s.email,
        status: "pending", requestedAtMs: Date.now(), requestedAt: new Date().toISOString()
      });
      await writeAdminAudit(ctx.env, {
        adminId: s.claims.uid, adminEmail: s.email, action: "payouts.maker_request",
        targetType: "payout", targetId: payoutId,
        oldValue: { status: oldStatus },
        newValue: { pendingApprovalId: reqId, amountUsd, thresholdUsd: threshold },
        ipAddress: ctx.ip, note: adminNote || `Maker-checker: $${amountUsd.toFixed(2)} >= $${threshold.toFixed(2)} — doosre admin ki approval chahiye.`
      });
      return json({
        success: true, makerChecker: true,
        message: `Payout $${amountUsd.toFixed(2)} threshold ($${threshold.toFixed(2)}) se bada hai — approval request ban gayi. Doosra admin (FINANCE_ADMIN/SUPER_ADMIN) approve karega, phir payout lagega.`
      }, 202);
    }
    const pendingReq = existing[0].data;
    if (pendingReq.requestedBy === s.claims.uid || pendingReq.requestedByEmail === s.email) {
      return fail("Maker-checker: aapne yeh payout request banayi hai, use khud approve nahi kar sakte. Doosra admin approve karega (ya pending-approvals se checker decide kare).", 403);
    }
  }
  if (isDecidingAction && payout.processedBy === s.claims.uid && oldStatus !== "pending") {
    return fail(`Payout already ${oldStatus}.`, 409);
  }

  let newStatus = "processing";
  if (action === "mark_paid") newStatus = "paid";
  if (action === "reject") newStatus = "rejected";

  await fsSetDoc(ctx.env, `payouts/${payoutId}`, {
    status: newStatus,
    processedAt: new Date().toISOString(),
    processedBy: s.claims.uid,
    processedByEmail: s.email,
    transactionReference: transactionReference || null,
    adminNote: adminNote || null
  });

  if ((action === "mark_paid" || action === "approve") && creatorId) {
    await fsSetDoc(ctx.env, `users/${creatorId}/monetization/status`, { manuallyReviewed: true });
  }

  await writeAdminAudit(ctx.env, {
    adminId: s.claims.uid, adminEmail: s.email,
    action: `payouts.${action === "reject" ? "reject" : "approve"}`,
    targetType: "payout", targetId: payoutId,
    oldValue: { status: oldStatus, amountUsd },
    newValue: { status: newStatus, transactionReference: transactionReference || null },
    ipAddress: ctx.ip, note: adminNote
  });
  return ok({ message: `Payout status updated to ${newStatus}` });
}

// ---------------------------------------------------------------------------
// Data: monetization report
// ---------------------------------------------------------------------------
async function handleMonetizationReport(ctx: Ctx): Promise<Response> {
  const env = ctx.env;
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const USD_TO_INR = 83.5;
  const INR_PER_1000_VIEWS = 40;
  const MAX_MONTHLY_PAYOUT_USD = 500;

  const userMap: Record<string, any> = {};
  for (const d of await listAll(env, "users")) {
    const u = d.data;
    userMap[d.id] = {
      username: u.username || "unknown",
      displayName: u.displayName || u.name || u.username || "Anonymous",
      avatarUrl: u.avatarUrl || u.avatar || "",
      monetizationStatus: u.monetizationStatus || (u.isMonetized ? "Approved" : "In Progress")
    };
  }

  const perCreator: Record<string, { profileViews: number; storyViews: number; chatViews: number; groupViews: number; totalViews: number }> = {};
  try {
    const views = await fsRunQuery(env, {
      from: "monetization_views",
      clauses: [
        { field: "monthKey", op: "EQUAL", value: monthKey },
        { field: "verificationStatus", op: "EQUAL", value: "PASSED" }
      ],
      limit: 3000
    });
    for (const v of views) {
      const cId = v.data.creatorId as string;
      if (!cId || !userMap[cId]) continue;
      if (!perCreator[cId]) perCreator[cId] = { profileViews: 0, storyViews: 0, chatViews: 0, groupViews: 0, totalViews: 0 };
      const st = String(v.data.sourceType || "profile");
      if (st === "profile") perCreator[cId].profileViews++;
      else if (st === "story") perCreator[cId].storyViews++;
      else if (st === "chat") perCreator[cId].chatViews++;
      else if (st === "group") perCreator[cId].groupViews++;
      perCreator[cId].totalViews++;
    }
  } catch { /* ignore */ }

  let pendingPayoutUsd = 0, pendingPayoutCount = 0, paidPayoutUsdTotal = 0, paidPayoutCount = 0;
  const payoutStatusByCreator: Record<string, string> = {};
  try {
    for (const p of await listAll(env, "payouts", 1000)) {
      const amt = Number(p.data.amountUsd) || 0;
      if (p.data.status === "requested" || p.data.status === "processing") {
        pendingPayoutUsd += amt; pendingPayoutCount++;
        payoutStatusByCreator[p.data.creatorId] = p.data.status;
      } else if (p.data.status === "paid") {
        paidPayoutUsdTotal += amt; paidPayoutCount++;
      } else if (p.data.status === "rejected") {
        payoutStatusByCreator[p.data.creatorId] = "rejected";
      }
    }
  } catch { /* ignore */ }

  const creators = Object.entries(perCreator).map(([uid, c]) => {
    const blocks = Math.floor(c.profileViews / 1000) + Math.floor(c.storyViews / 1000) + Math.floor(c.chatViews / 1000) + Math.floor(c.groupViews / 1000);
    const earningsUsd = Math.min(MAX_MONTHLY_PAYOUT_USD, (blocks * INR_PER_1000_VIEWS) / USD_TO_INR);
    return {
      uid,
      username: userMap[uid]?.username || "unknown",
      displayName: userMap[uid]?.displayName || "Anonymous",
      avatarUrl: userMap[uid]?.avatarUrl || "",
      monetizationStatus: userMap[uid]?.monetizationStatus || "In Progress",
      profileViews: c.profileViews, storyViews: c.storyViews, chatViews: c.chatViews, groupViews: c.groupViews,
      totalViews: c.totalViews,
      earningsUsd: Number(earningsUsd.toFixed(2)),
      payoutStatus: payoutStatusByCreator[uid] || null
    };
  }).sort((a, b) => b.totalViews - a.totalViews);

  const totalViews = creators.reduce((s, c) => s + c.totalViews, 0);
  const totalEarningsUsd = Number(creators.reduce((s, c) => s + c.earningsUsd, 0).toFixed(2));

  return ok({
    monthKey,
    totals: {
      totalViews, totalEarningsUsd,
      totalEarningsInr: Math.round(totalEarningsUsd * USD_TO_INR),
      activeCreators: creators.length,
      pendingPayoutUsd: Number(pendingPayoutUsd.toFixed(2)),
      pendingPayoutCount,
      paidPayoutUsd: Number(paidPayoutUsdTotal.toFixed(2)),
      paidPayoutCount
    },
    creators
  });
}

// ---------------------------------------------------------------------------
// Data: dating flags
// ---------------------------------------------------------------------------
async function handleDatingFlagsList(ctx: Ctx): Promise<Response> {
  let flags: any[] = [];
  try {
    flags = (await fsRunQuery(ctx.env, { from: "flagged_content", orderBy: "createdAtMs", orderDesc: true, limit: 200 }))
      .map((d) => ({ id: d.id, ...d.data }));
  } catch {
    // fallback without orderBy (index not ready)
    flags = (await listAll(ctx.env, "flagged_content", 200)).map((d) => ({ id: d.id, ...d.data }));
  }
  return ok({ flags });
}

async function handleDatingFlagAction(ctx: Ctx, flagId: string): Promise<Response> {
  const body = await getBody(ctx.req);
  const action = body?.action;
  const note = isStr(body?.note, 500) ? body.note : undefined;
  if (!["confirm_fake", "clear_flag", "ban_user"].includes(action)) {
    return fail("Invalid action. Use confirm_fake | clear_flag | ban_user.", 400);
  }
  const s = ctx.session!;
  const flag = await fsGetDoc(ctx.env, `flagged_content/${flagId}`);
  if (!flag) return fail("Flag not found.", 404);

  if (action === "confirm_fake") {
    await fsSetDoc(ctx.env, `flagged_content/${flagId}`, { status: "confirmed_fake", reviewedBy: s.email, reviewedAtMs: Date.now(), reviewNote: note || null });
    if (flag.targetUserId) {
      await fsSetDoc(ctx.env, `users/${flag.targetUserId}`, {
        isFake: true, flaggedAsFake: true,
        fakeFlagReason: note || "Confirmed fake by moderation",
        fakeFlaggedAtMs: Date.now()
      });
    }
  } else if (action === "clear_flag") {
    await fsSetDoc(ctx.env, `flagged_content/${flagId}`, { status: "cleared", reviewedBy: s.email, reviewedAtMs: Date.now(), reviewNote: note || null });
  } else if (action === "ban_user") {
    if (flag.targetUserId) {
      await fsSetDoc(ctx.env, `users/${flag.targetUserId}`, {
        accountStatus: "banned", status: "banned", isSuspended: true,
        suspendedAt: new Date().toISOString(),
        suspendedReason: note || "Banned via dating moderation (fake profile)",
        monetizationStatus: "Suspended"
      });
    }
    await fsSetDoc(ctx.env, `flagged_content/${flagId}`, { status: "banned", reviewedBy: s.email, reviewedAtMs: Date.now() });
  }

  await writeAdminAudit(ctx.env, {
    adminId: s.claims.uid, adminEmail: s.email, action: `dating.${action}`,
    targetType: "dating_profile", targetId: String(flag.targetUserId || flagId),
    oldValue: { flagStatus: flag.status || "open" },
    newValue: { action, note: note || null },
    ipAddress: ctx.ip, note
  });
  return ok({ message: `Flag ${action} completed.` });
}

// ---------------------------------------------------------------------------
// Data: pending approvals (maker-checker decisions)
// ---------------------------------------------------------------------------
async function handlePendingApprovalsList(ctx: Ctx): Promise<Response> {
  let approvals: any[] = [];
  try {
    approvals = (await fsRunQuery(ctx.env, { from: "pending_payout_approvals", orderBy: "requestedAtMs", orderDesc: true, limit: 100 }))
      .map((d) => ({ id: d.id, ...d.data }));
  } catch {
    approvals = (await listAll(ctx.env, "pending_payout_approvals", 100)).map((d) => ({ id: d.id, ...d.data }));
  }
  return ok({ approvals });
}

async function handleApprovalDecision(ctx: Ctx, id: string): Promise<Response> {
  const body = await getBody(ctx.req);
  const decision = body?.decision;
  const note = isStr(body?.note, 500) ? body.note : undefined;
  if (!["approved", "rejected"].includes(decision)) return fail("decision must be approved | rejected.", 400);
  const s = ctx.session!;

  const approval = await fsGetDoc(ctx.env, `pending_payout_approvals/${id}`);
  if (!approval) return fail("Approval request not found.", 404);
  if (approval.status !== "pending") return fail(`Already decided (${approval.status}).`, 409);
  if (approval.requestedBy === s.claims.uid || approval.requestedByEmail === s.email) {
    return fail("Maker-checker: aap apni hi approval request decide nahi kar sakte. Doosra FINANCE_ADMIN/SUPER_ADMIN karega.", 403);
  }

  await fsSetDoc(ctx.env, `pending_payout_approvals/${id}`, {
    status: decision, decidedBy: s.email, decidedByUid: s.claims.uid,
    decidedAtMs: Date.now(), decisionNote: note || null
  });

  if (decision === "approved" && approval.payoutId) {
    const payout = await fsGetDoc(ctx.env, `payouts/${approval.payoutId}`);
    if (payout) {
      await fsSetDoc(ctx.env, `payouts/${approval.payoutId}`, {
        status: "paid", processedAt: new Date().toISOString(),
        processedBy: s.email, approvalFlow: "maker-checker", approvedVia: id
      });
    }
  }

  await writeAdminAudit(ctx.env, {
    adminId: s.claims.uid, adminEmail: s.email, action: `payouts.checker_${decision}`,
    targetType: "payout_approval", targetId: id,
    oldValue: { status: "pending", amountUsd: approval.amountUsd, requestedBy: approval.requestedByEmail },
    newValue: { status: decision, payoutId: approval.payoutId },
    ipAddress: ctx.ip, note
  });
  return ok({ message: `Approval ${decision}.` });
}

// ---------------------------------------------------------------------------
// Data: audit logs
// ---------------------------------------------------------------------------
async function handleAuditLogs(ctx: Ctx): Promise<Response> {
  const url = new URL(ctx.req.url);
  const limitN = Math.min(300, Math.max(1, parseInt(url.searchParams.get("limit") || "100", 10) || 100));
  let logs: any[] = [];
  try {
    logs = (await fsRunQuery(ctx.env, { from: "admin_audit_logs", orderBy: "timestampMs", orderDesc: true, limit: limitN }))
      .map((d) => ({ id: d.id, ...d.data }));
  } catch {
    logs = (await listAll(ctx.env, "admin_audit_logs", limitN)).map((d) => ({ id: d.id, ...d.data }));
  }
  return ok({ logs });
}

// ---------------------------------------------------------------------------
// Data: admin management + config
// ---------------------------------------------------------------------------
async function handleAdminsList(ctx: Ctx): Promise<Response> {
  const admins = (await listAll(ctx.env, "admin_users", 100)).map((d) => ({
    uid: d.id,
    email: d.data.email,
    role: d.data.role,
    isActive: d.data.isActive !== false,
    totpEnabled: d.data.totpEnabled === true,
    displayName: d.data.displayName || ""
  }));
  return ok({ admins });
}

async function handleAdminInvite(ctx: Ctx): Promise<Response> {
  const body = await getBody(ctx.req);
  if (!isEmail(body?.email) || !asRole(body?.role)) return fail("Valid email + role required.", 400);
  const email = (body.email as string).toLowerCase();
  const role = body.role as AdminRole;
  const s = ctx.session!;
  const existing = await findAdminByEmail(ctx.env, email);
  if (existing) return fail("This email is already an admin.", 409);
  await fsAddDoc(ctx.env, "admin_users", {
    email, role, isActive: true, totpSecret: null, totpEnabled: false,
    invitedBy: s.email, createdAt: new Date().toISOString()
  });
  await writeAdminAudit(ctx.env, {
    adminId: s.claims.uid, adminEmail: s.email, action: "admins.invite",
    targetType: "admin_user", targetId: email,
    newValue: { role, isActive: true }, ipAddress: ctx.ip,
    note: "New admin invited. They enroll 2FA on first login."
  });
  return ok({ message: `${email} added as ${role}. They must sign up with this email in the app first, then log in here to enroll 2FA.` });
}

async function handleAdminSetRole(ctx: Ctx, uid: string): Promise<Response> {
  const body = await getBody(ctx.req);
  const role = asRole(body?.role);
  if (!role) return fail("Valid role required.", 400);
  const s = ctx.session!;
  const target = await getAdminById(ctx.env, uid);
  if (!target) return fail("Admin not found.", 404);
  await fsSetDoc(ctx.env, `admin_users/${uid}`, { role, updatedAt: new Date().toISOString() });
  await writeAdminAudit(ctx.env, {
    adminId: s.claims.uid, adminEmail: s.email, action: "admins.set_role",
    targetType: "admin_user", targetId: target.email,
    oldValue: { role: target.role }, newValue: { role }, ipAddress: ctx.ip
  });
  return ok({ message: `${target.email} role: ${target.role} → ${role}` });
}

async function handleAdminReset2Fa(ctx: Ctx, uid: string): Promise<Response> {
  const s = ctx.session!;
  const target = await getAdminById(ctx.env, uid);
  if (!target) return fail("Admin not found.", 404);
  await fsSetDoc(ctx.env, `admin_users/${uid}`, {
    totpSecret: null, totpEnabled: false,
    totpResetAt: new Date().toISOString(), totpResetBy: s.email
  });
  await writeAdminAudit(ctx.env, {
    adminId: s.claims.uid, adminEmail: s.email, action: "2fa.reset",
    targetType: "admin_user", targetId: target.email,
    oldValue: { totpEnabled: target.totpEnabled },
    newValue: { totpEnabled: false, totpSecret: "DELETED" },
    ipAddress: ctx.ip, note: "2FA reset via console. Admin will re-enroll on next login."
  });
  return ok({ message: `${target.email} ka 2FA reset ho gaya. Wo next login par naya QR scan karega.` });
}

async function handleAdminSetActive(ctx: Ctx, uid: string): Promise<Response> {
  const body = await getBody(ctx.req);
  if (typeof body?.isActive !== "boolean") return fail("isActive boolean required.", 400);
  const s = ctx.session!;
  const target = await getAdminById(ctx.env, uid);
  if (!target) return fail("Admin not found.", 404);
  if (target.uid === s.claims.uid && !body.isActive) return fail("You cannot deactivate your own account.", 400);
  await fsSetDoc(ctx.env, `admin_users/${uid}`, { isActive: body.isActive, updatedAt: new Date().toISOString() });
  await writeAdminAudit(ctx.env, {
    adminId: s.claims.uid, adminEmail: s.email,
    action: body.isActive ? "admins.activate" : "admins.deactivate",
    targetType: "admin_user", targetId: target.email,
    oldValue: { isActive: target.isActive }, newValue: { isActive: body.isActive }, ipAddress: ctx.ip
  });
  return ok({ message: `${target.email} ${body.isActive ? "activated" : "deactivated"}.` });
}

async function handleConfigGet(ctx: Ctx): Promise<Response> {
  const cfg = await getAdminConfig(ctx.env);
  return ok({ config: cfg, defaults: DEFAULT_ROLE_PERMISSIONS });
}

async function handleConfigUpdate(ctx: Ctx): Promise<Response> {
  const body = await getBody(ctx.req);
  const update: Record<string, unknown> = {};
  if (body?.rolePermissions !== undefined) {
    if (typeof body.rolePermissions !== "object") return fail("Invalid config payload.", 400);
    update.rolePermissions = body.rolePermissions;
  }
  if (body?.ipWhitelist !== undefined) {
    if (!Array.isArray(body.ipWhitelist) || body.ipWhitelist.length > 50 || body.ipWhitelist.some((s: unknown) => !isStr(s, 64))) {
      return fail("Invalid config payload.", 400);
    }
    update.ipWhitelist = body.ipWhitelist;
  }
  if (body?.vpnGateEnabled !== undefined) {
    if (typeof body.vpnGateEnabled !== "boolean") return fail("Invalid config payload.", 400);
    update.vpnGateEnabled = body.vpnGateEnabled;
  }
  if (body?.payoutApprovalThresholdUsd !== undefined) {
    if (typeof body.payoutApprovalThresholdUsd !== "number" || body.payoutApprovalThresholdUsd < 0 || body.payoutApprovalThresholdUsd > 100000) {
      return fail("Invalid config payload.", 400);
    }
    update.payoutApprovalThresholdUsd = body.payoutApprovalThresholdUsd;
  }
  if (Object.keys(update).length === 0) return fail("Invalid config payload.", 400);

  const s = ctx.session!;
  const before = await getAdminConfig(ctx.env);
  await fsSetDoc(ctx.env, "admin_config/config", update);
  invalidateConfigCache();
  const after = await getAdminConfig(ctx.env);
  await writeAdminAudit(ctx.env, {
    adminId: s.claims.uid, adminEmail: s.email, action: "config.update",
    targetType: "admin_config", targetId: "config",
    oldValue: { ipWhitelist: before.ipWhitelist, vpnGateEnabled: before.vpnGateEnabled, payoutApprovalThresholdUsd: before.payoutApprovalThresholdUsd },
    newValue: update, ipAddress: ctx.ip
  });
  return ok({ message: "Config updated.", config: after });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function route(ctx: Ctx, method: string, pathname: string): Promise<Response> {
  const P = (pattern: string): RegExpMatchArray | null => {
    if (method !== ctx.req.method) return null;
    const regex = new RegExp("^" + pattern.replace(/:[^/]+/g, "([^/]+)") + "$");
    return pathname.match(regex);
  };

  // --- auth entry points (no session yet) ---
  if (pathname === "/api/admin/auth/login" && method === "HEAD") return new Response(null, { status: 405, headers: JSON_H });
  if (pathname === "/api/admin/auth/login" && method === "POST") return handleLogin(ctx);
  if (pathname === "/api/admin/auth/2fa/setup" && method === "POST") return handle2FaSetup(ctx);
  if (pathname === "/api/admin/auth/2fa" && method === "POST") return handle2Fa(ctx);

  // --- health probe for the console ---
  if (pathname === "/api/admin/health" && method === "GET") return ok({ service: "admin-api-worker" });

  // --- session-required routes (deny-by-default RBAC) ---
  if (pathname === "/api/admin/auth/me" && method === "GET") {
    const e = await requireSession(ctx);
    if (e) return e;
    const s = ctx.session!;
    return ok({ email: s.email, role: s.role, uid: s.claims.uid });
  }
  if (pathname === "/api/admin/auth/logout" && method === "POST") {
    const e = await requireSession(ctx);
    if (e) return e;
    const s = ctx.session!;
    await revokeAdminSession(ctx.env, s.claims.sid, "logout");
    await writeAdminAudit(ctx.env, {
      adminId: s.claims.uid, adminEmail: s.email, action: "auth.logout",
      targetType: "admin_session", targetId: s.claims.sid, ipAddress: ctx.ip
    });
    return ok();
  }

  if (P("/api/admin/overview") && method === "GET") { const e = await requirePermission(ctx, "analytics.view"); return e || handleOverview(ctx); }
  if (P("/api/admin/analytics") && method === "GET") { const e = await requirePermission(ctx, "analytics.view"); return e || handleAnalytics(ctx); }

  if (P("/api/admin/users") && method === "GET") { const e = await requirePermission(ctx, "users.view"); return e || handleUsersList(ctx); }
  {
    const m = P("/api/admin/users/:uid/action");
    if (m && method === "POST") { const e = await requirePermission(ctx, "users.manage"); return e || handleUserAction(ctx, m[1]); }
  }

  if (P("/api/admin/reports") && method === "GET") { const e = await requirePermission(ctx, "reports.view"); return e || handleReportsList(ctx); }
  {
    const m = P("/api/admin/reports/:reportId/action");
    if (m && method === "POST") { const e = await requirePermission(ctx, "reports.action"); return e || handleReportAction(ctx, m[1]); }
  }

  if (P("/api/admin/stories") && method === "GET") { const e = await requirePermission(ctx, "content.view"); return e || handleStoriesList(ctx); }
  {
    const m = P("/api/admin/stories/:storyId/delete");
    if (m && method === "POST") { const e = await requirePermission(ctx, "content.delete"); return e || handleStoryDelete(ctx, m[1]); }
  }

  if (P("/api/admin/payouts") && method === "GET") { const e = await requirePermission(ctx, "payouts.view"); return e || handlePayoutsList(ctx); }
  {
    const m = P("/api/admin/payouts/:payoutId/action");
    if (m && method === "POST") { const e = await requirePermission(ctx, "payouts.approve"); return e || handlePayoutAction(ctx, m[1]); }
  }

  if (P("/api/admin/monetization-report") && method === "GET") { const e = await requirePermission(ctx, "monetization.view"); return e || handleMonetizationReport(ctx); }

  if (P("/api/admin/dating-flags") && method === "GET") { const e = await requirePermission(ctx, "dating.view"); return e || handleDatingFlagsList(ctx); }
  {
    const m = P("/api/admin/dating-flags/:flagId/action");
    if (m && method === "POST") { const e = await requirePermission(ctx, "dating.action"); return e || handleDatingFlagAction(ctx, m[1]); }
  }

  if (P("/api/admin/pending-approvals") && method === "GET") { const e = await requirePermission(ctx, "payouts.view"); return e || handlePendingApprovalsList(ctx); }
  {
    const m = P("/api/admin/pending-approvals/:id/decision");
    if (m && method === "POST") { const e = await requirePermission(ctx, "payouts.approve"); return e || handleApprovalDecision(ctx, m[1]); }
  }

  if (P("/api/admin/audit-logs") && method === "GET") { const e = await requirePermission(ctx, "audit.view"); return e || handleAuditLogs(ctx); }

  if (P("/api/admin/admins") && method === "GET") { const e = await requirePermission(ctx, "admins.view"); return e || handleAdminsList(ctx); }
  if (P("/api/admin/admins/invite") && method === "POST") { const e = await requirePermission(ctx, "admins.manage"); return e || handleAdminInvite(ctx); }
  {
    const m = P("/api/admin/admins/:uid/set-role");
    if (m && method === "POST") { const e = await requirePermission(ctx, "admins.manage"); return e || handleAdminSetRole(ctx, m[1]); }
  }
  {
    const m = P("/api/admin/admins/:uid/reset-2fa");
    if (m && method === "POST") { const e = await requirePermission(ctx, "admins.manage"); return e || handleAdminReset2Fa(ctx, m[1]); }
  }
  {
    const m = P("/api/admin/admins/:uid/set-active");
    if (m && method === "POST") { const e = await requirePermission(ctx, "admins.manage"); return e || handleAdminSetActive(ctx, m[1]); }
  }

  if (P("/api/admin/config") && method === "GET") { const e = await requirePermission(ctx, "admins.view"); return e || handleConfigGet(ctx); }
  if (P("/api/admin/config/update") && method === "POST") { const e = await requirePermission(ctx, "admins.manage"); return e || handleConfigUpdate(ctx); }

  // Deny-by-default: every admin route must be explicitly mapped above
  if (routePermission(method, pathname)) {
    return fail("Endpoint exists but is not wired to a permission handler — denied.", 403);
  }
  return fail("Not found", 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const ctx: Ctx = {
      req, env,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent") || ""
    };
    try {
      // Non-API requests fall through to the static site assets (SPA)
      if (!url.pathname.startsWith("/api/admin/") && !url.pathname.startsWith("/api/monetization/admin/")) {
        return (env as any).ASSETS
          ? (env as any).ASSETS.fetch(req)
          : fail("Not found", 404);
      }
      return await route(ctx, req.method, url.pathname);
    } catch (err: any) {
      console.error("[Worker] error:", err);
      return fail(err?.message || "Internal error", 500);
    }
  }
};
