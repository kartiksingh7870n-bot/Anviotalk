import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

// ----------------------------------------------------------------------------
// Safety net: without a service account, Firestore's gRPC channel emits
// asynchronous NO_ADC_FOUND errors from background timers. They must never
// kill the whole server — API handlers already wrap their own try/catch.
// ----------------------------------------------------------------------------
process.on("unhandledRejection", (reason: unknown) => {
  const msg = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  if (msg.includes("NO_ADC_FOUND") || msg.includes("Could not load the default credentials")) {
    console.warn("[Server] Suppressed credential-less Firestore background error (server keeps running):", msg.slice(0, 140));
    return;
  }
  console.error("[Server] Unhandled rejection:", reason);
});
import { adminDb, adminAuth, isServiceAccountConfigured } from "./server/firebaseAdmin";
import { startPushNotificationListeners } from "./server/pushNotifications";
import { startNotificationScheduler } from "./server/schedulerService";
import {
  calculateCreatorEligibility, 
  recordVerifiedView,
  MonetizationViewSource,
  applyForMonetization, 
  runAutomatedFraudScan,
  createAuditLog,
  aggregateCreatorEarningsBatch
} from "./server/monetizationService";
import { recordVerifiedAdImpression, requestWithdrawal, getCreatorPayouts } from "./server/payoutService";
import QRCode from "qrcode";
import {
  ensureSeedSuperAdmin,
  findAdminByEmail,
  getAdminAccount,
  getAdminConfig,
  invalidateConfigCache,
  adminAuthGuard,
  requirePermission,
  checkLoginRate,
  recordFailedLogin,
  clearFailedLogins,
  generateTotpSecret,
  verifyTotp,
  createAdminSession,
  revokeAdminSession,
  writeAdminAudit,
  getAdminAccount as getAdminById,
  createTemp2FaToken,
  verifyTemp2FaToken,
  setSyncSecretCache,
  warmJwtSecret,
  hasPermission,
  LoginStartSchema,
  Login2FaSchema,
  Setup2FaVerifySchema,
  UserActionSchema,
  PayoutActionSchema,
  InviteAdminSchema,
  SetRoleSchema,
  SetActiveSchema,
  ConfigUpdateSchema,
  DecisionSchema,
  DatingFlagActionSchema,
  clientIp,
  ADMIN_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  type AdminRole
} from "./server/adminAuth";

const db = adminDb;

// Authentication & Admin Authorization Middlewares
async function verifyAuthToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Unauthorized: Missing or invalid Authorization header" });
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return res.status(401).json({ error: "Unauthorized: Token string is empty" });
  }

  try {
    let verifiedUid: string | null = null;
    let verifiedEmail: string | null = null;
    let claims: any = {};

    // 1. Try Firebase Admin SDK token verification
    try {
      const decoded = await adminAuth.verifyIdToken(token);
      verifiedUid = decoded.uid;
      verifiedEmail = decoded.email || null;
      claims = decoded;
    } catch (adminErr) {
      // Fallback using Firebase REST Identity Toolkit API
      const apiKey = "AIzaSyBR9e8eLDsyr5cHhwkcanRTbPqqjfGBBHU";
      try {
        const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: token })
        });
        if (verifyRes.ok) {
          const data: any = await verifyRes.json();
          if (data?.users && data.users.length > 0) {
            const u = data.users[0];
            verifiedUid = u.localId;
            verifiedEmail = u.email || null;
          }
        }
      } catch (restErr) {
        console.error("Error verifying ID token via Identity Toolkit:", restErr);
      }
    }

    if (!verifiedUid) {
      return res.status(401).json({ error: "Unauthorized: Invalid or expired ID token" });
    }

    (req as any).user = {
      uid: verifiedUid,
      email: verifiedEmail,
      claims
    };

    next();
  } catch (err: any) {
    console.error("Error in verifyAuthToken middleware:", err);
    return res.status(401).json({ error: "Unauthorized: Authentication failed" });
  }
}

async function verifyAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  await verifyAuthToken(req, res, async () => {
    const user = (req as any).user;
    if (!user || !user.uid) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const email = (user.email || '').toLowerCase();
    const uid = user.uid;

    const APPROVED_ADMIN_EMAILS = ['admin@anviotalk.com', 'kartiksingh7870n@gmail.com'];
    const isApprovedEmail = APPROVED_ADMIN_EMAILS.includes(email);
    const isApprovedUid = uid === 'admin';
    const hasAdminClaim = user.claims?.admin === true || user.claims?.role === 'admin' || user.claims?.isAdmin === true;

    if (isApprovedEmail || isApprovedUid || hasAdminClaim) {
      return next();
    }

    // Check server Firestore user document for admin role using Admin SDK
    try {
      const userDocSnap = await db.collection("users").doc(uid).get();
      if (userDocSnap.exists) {
        const uData = userDocSnap.data();
        if (uData?.isAdmin === true || uData?.role === 'admin') {
          return next();
        }
      }
    } catch (err) {
      console.error("Error checking admin status in Firestore:", err);
    }

    return res.status(403).json({ error: "Forbidden: Admin access required" });
  });
}

function escapeHtml(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function getUserProfileData(usernameOrId: string) {
  try {
    const cleanId = usernameOrId.trim();
    // Try username query first
    const querySnapshot = await db.collection("users")
      .where("username", "==", cleanId.toLowerCase())
      .limit(1)
      .get();
    if (!querySnapshot.empty) {
      return querySnapshot.docs[0].data();
    }
    // Try direct document ID
    const userDoc = await db.collection("users").doc(cleanId).get();
    if (userDoc.exists) {
      return userDoc.data();
    }
  } catch (err) {
    console.error("Error fetching user profile from server:", err);
  }
  return null;
}

async function getGroupData(groupId: string) {
  try {
    const chatDoc = await db.collection("chats").doc(groupId.trim()).get();
    if (chatDoc.exists) {
      return chatDoc.data();
    }
  } catch (err) {
    console.error("Error fetching group data from server:", err);
  }
  return null;
}

async function getStoryData(storyId: string) {
  try {
    const storyDoc = await db.collection("stories").doc(storyId.trim()).get();
    if (storyDoc.exists) {
      return storyDoc.data();
    }
  } catch (err) {
    console.error("Error fetching story data from server:", err);
  }
  return null;
}

function injectMetaTags(html: string, options: {
  title: string;
  description: string;
  image: string;
  url: string;
  type?: string;
}): string {
  const safeTitle = escapeHtml(options.title || 'Anvio Talk');
  const safeDesc = escapeHtml(options.description || 'Spatial Audio Salon & Creative Connection Platform');
  const safeImage = escapeHtml(options.image || 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800');
  const safeUrl = escapeHtml(options.url || 'https://anviotalk.in');
  const safeType = escapeHtml(options.type || 'website');

  const metaTags = `
  <!-- Dynamic Open Graph / Twitter Meta Tags -->
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDesc}">
  <meta property="og:image" content="${safeImage}">
  <meta property="og:url" content="${safeUrl}">
  <meta property="og:type" content="${safeType}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDesc}">
  <meta name="twitter:image" content="${safeImage}">
  `;

  return html.replace("</head>", `${metaTags}\n</head>`);
}

async function resolveAndInjectMetaTags(html: string, req: express.Request): Promise<string> {
  const urlPath = req.path || '';
  const query = req.query || {};

  const profileId = (req.params as any)?.username || (query.profile as string) || (query.creator as string);
  const groupId = (req.params as any)?.groupId || (query.group as string) || (query.invite as string);
  const storyId = (req.params as any)?.storyId || (query.story as string) || (query.image as string);

  if (profileId || urlPath.startsWith('/profile/') || urlPath.startsWith('/creator/')) {
    const target = profileId || urlPath.split('/')[2];
    if (target) {
      const user = await getUserProfileData(target);
      const displayName = user?.displayName || user?.name || user?.username || "Anvio Talk Member";
      const bio = user?.bio || user?.activeProject || "Creative Salon Member on Anvio Talk";
      const avatar = user?.avatarUrl || user?.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200";
      return injectMetaTags(html, {
        title: `${displayName} on Anvio Talk`,
        description: bio,
        image: avatar,
        url: `https://anviotalk.in/profile/${encodeURIComponent(target)}`,
        type: "profile"
      });
    }
  }

  if (groupId || urlPath.startsWith('/group/') || urlPath.startsWith('/invite/')) {
    const target = groupId || urlPath.split('/')[2];
    if (target) {
      const group = await getGroupData(target);
      const groupName = group?.name || "Anvio Talk Creative Group";
      const memberCount = group?.members?.length || 0;
      const desc = group?.description || group?.desc || `${memberCount} members in this group on Anvio Talk`;
      const cover = group?.avatar || group?.photoUrl || "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800";
      return injectMetaTags(html, {
        title: `${groupName} - Anvio Talk Group`,
        description: desc,
        image: cover,
        url: `https://anviotalk.in/group/${encodeURIComponent(target)}`,
        type: "website"
      });
    }
  }

  if (storyId || urlPath.startsWith('/story/') || urlPath.startsWith('/image/')) {
    const target = storyId || urlPath.split('/')[2];
    if (target) {
      const story = await getStoryData(target);
      const title = story?.authorName ? `${story.authorName}'s Shared Photo` : "Shared Image on Anvio Talk";
      const desc = story?.text || story?.caption || "View this shared image on Anvio Talk.";
      const image = story?.mediaUrl || story?.imageUrl || "https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?w=800";
      return injectMetaTags(html, {
        title: `${title} - Anvio Talk`,
        description: desc,
        image: image,
        url: `https://anviotalk.in/story/${encodeURIComponent(target)}`,
        type: "article"
      });
    }
  }

  return html;
}

async function startServer() {
  const server = express();
  const PORT = 3000;

  server.use(express.json());

  // CORS: allow the standalone desktop admin console (file:// / electron) to call the API.
  // Security is enforced per-request by verifyAdminAuth, not by origin.
  server.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Initialize server-side push notification listeners using Firebase Admin SDK.
  // Only when a service account is configured — without credentials the FCM/gRPC
  // background timers crash the whole server process (NO_ADC_FOUND). Cloud Functions
  // handle production push; the embedded listeners/scheduler are for privileged runs.
  if (isServiceAccountConfigured) {
    await startPushNotificationListeners();

    // Initialize background scheduler for rotating notifications (10 AM, 2 PM, 10 PM, 12 AM)
    await startNotificationScheduler();
  } else {
    console.log("[Server] Skipping embedded push listeners & scheduler (no FIREBASE_SERVICE_ACCOUNT_JSON). Cloud Functions handle push.");
  }

  // Initialize secure admin auth system (seed super admin + JWT secret cache)
  try {
    await ensureSeedSuperAdmin();
    const cfg = await getAdminConfig();
    await warmJwtSecret();
    console.log("[AdminAuth] Secure admin system ready. Roles:", Object.keys(cfg.rolePermissions).join(", "));
  } catch (e) {
    console.warn("[AdminAuth] init warning:", (e as Error).message);
  }

  // =========================================================================
  // ADMIN AUTH (v2): separate JWT sessions + mandatory TOTP 2FA + lockout
  // =========================================================================

  // Step 1: email + password (Firebase) + admin_users role check -> temp token
  server.post("/api/admin/auth/login", async (req, res) => {
    try {
      const parsed = LoginStartSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid email or password format." });
      }
      const email = parsed.data.email.toLowerCase().trim();
      const password = parsed.data.password;
      const ip = clientIp(req as any);
      const userAgent = String(req.headers["user-agent"] || "").slice(0, 200);

      // Rate limit: per-IP AND per-account (brute-force protection)
      const rl = checkLoginRate(ip, email);
      if (!rl.allowed) {
        return res.status(429).json({ error: rl.reason, retryAfterMin: rl.retryAfterMin });
      }

      // admin_users role check BEFORE Firebase hit (cheap + avoids user enumeration via timing)
      const account = await findAdminByEmail(email);
      if (!account || !account.isActive) {
        recordFailedLogin(ip, email);
        return res.status(401).json({ error: "Invalid credentials or admin account disabled." });
      }

      // Verify Firebase password via REST (no client SDK needed server-side)
      const apiKey = "AIzaSyBR9e8eLDsyr5cHhwkcanRTbPqqjfGBBHU";
      const fbRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: false })
      });

      if (!fbRes.ok) {
        recordFailedLogin(ip, email);
        return res.status(401).json({ error: "Invalid email or password." });
      }

      const fbData: any = await fbRes.json();
      if (!fbData?.localId) {
        recordFailedLogin(ip, email);
        return res.status(401).json({ error: "Invalid credentials." });
      }

      // Ensure the admin_users doc points to the Firebase uid (self-heal seed)
      if (account.uid !== fbData.localId) {
        try {
          const oldSnap = await db.collection("admin_users").doc(account.uid).get();
          if (oldSnap.exists) {
            await db.collection("admin_users").doc(fbData.localId).set(oldSnap.data(), { merge: true });
            await db.collection("admin_users").doc(account.uid).delete();
          }
          account.uid = fbData.localId;
        } catch { /* non-fatal */ }
      }

      clearFailedLogins(ip, email);

      // 2FA pending: issue short-lived temp token (5 min)
      const tempToken = createTemp2FaToken(account.uid);
      return res.json({
        success: true,
        step: "2fa",
        tempToken,
        totpEnabled: account.totpEnabled,
        email: account.email,
        role: account.role
      });
    } catch (err: any) {
      console.error("Error in POST /api/admin/auth/login:", err);
      res.status(500).json({ error: "Login failed. Try again." });
    }
  });

  // Step 2: TOTP verify -> full admin session JWT (separate secret from user auth)
  server.post("/api/admin/auth/2fa", async (req, res) => {
    try {
      const parsed = Login2FaSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: "Enter the 6-digit code from Google Authenticator." });
      }
      const { tempToken, code } = parsed.data;
      const ip = clientIp(req as any);

      const pending = verifyTemp2FaToken(tempToken);
      if (!pending) {
        return res.status(401).json({ error: "Login session expired. Sign in again." });
      }

      const account = await getAdminAccount(pending.uid);
      if (!account || !account.isActive) {
        return res.status(403).json({ error: "Admin account disabled." });
      }

      // First-time 2FA enrollment: server generated secret at /2fa/setup, stored on account
      if (!account.totpSecret) {
        return res.status(400).json({ error: "2FA not initialized. Call /2fa/setup first.", step: "setup" });
      }

      if (!verifyTotp(account.totpSecret, code)) {
        recordFailedLogin(ip, account.email);
        const rl = checkLoginRate(ip, account.email);
        if (!rl.allowed) {
          return res.status(429).json({ error: rl.reason });
        }
        return res.status(401).json({ error: "Wrong 2FA code. Try again." });
      }

      clearFailedLogins(ip, account.email);

      // Mark 2FA enabled after first successful verification
      if (!account.totpEnabled) {
        await db.collection("admin_users").doc(account.uid).set({ totpEnabled: true, totpEnabledAt: new Date().toISOString() }, { merge: true });
        await writeAdminAudit({
          adminId: account.uid, adminEmail: account.email,
          action: "2fa.enabled", targetType: "admin_user", targetId: account.uid,
          newValue: { totpEnabled: true }, ipAddress: ip,
          note: "First successful TOTP verification."
        });
      }

      const userAgent = String(req.headers["user-agent"] || "").slice(0, 200);
      const sessionJwt = await createAdminSession(account, ip, userAgent);

      await writeAdminAudit({
        adminId: account.uid, adminEmail: account.email,
        action: "auth.login", targetType: "admin_session", targetId: account.uid,
        newValue: { role: account.role }, ipAddress: ip, userAgent,
        note: "Admin signed in with password + TOTP."
      });

      return res.json({
        success: true,
        token: sessionJwt,
        email: account.email,
        role: account.role,
        expiresInMinutes: 30
      });
    } catch (err: any) {
      console.error("Error in POST /api/admin/auth/2fa:", err);
      res.status(500).json({ error: "2FA verification failed." });
    }
  });

  // 2FA setup: generate secret + QR (called when account has no secret yet)
  server.post("/api/admin/auth/2fa/setup", async (req, res) => {
    try {
      const { tempToken } = req.body || {};
      if (typeof tempToken !== "string" || tempToken.length < 10) {
        return res.status(400).json({ error: "tempToken required (from login step)." });
      }
      const pending = verifyTemp2FaToken(tempToken);
      if (!pending) return res.status(401).json({ error: "Login session expired. Sign in again." });

      const account = await getAdminAccount(pending.uid);
      if (!account) return res.status(404).json({ error: "Admin account not found." });
      if (account.totpEnabled && account.totpSecret) {
        return res.status(400).json({ error: "2FA already enabled. Use reset via another SUPER_ADMIN if locked out." });
      }

      const { secret, otpauthUrl } = generateTotpSecret(account.email);
      await db.collection("admin_users").doc(account.uid).set({
        totpSecret: secret,
        totpEnabled: false,
        totpSecretCreatedAt: new Date().toISOString()
      }, { merge: true });

      const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 260, margin: 1 });
      return res.json({ success: true, otpauthUrl, qrDataUrl, secret });
    } catch (err: any) {
      console.error("Error in POST /api/admin/auth/2fa/setup:", err);
      res.status(500).json({ error: "2FA setup failed." });
    }
  });

  // Session info
  server.get("/api/admin/auth/me", adminAuthGuard(), async (req, res) => {
    const s = (req as any).adminSession;
    res.json({ success: true, email: s.email, role: s.role, uid: s.claims.uid });
  });

  // Logout (revoke session server-side)
  server.post("/api/admin/auth/logout", adminAuthGuard(), async (req, res) => {
    const s = (req as any).adminSession;
    await revokeAdminSession(s.claims.sid, "logout");
    const ip = clientIp(req as any);
    await writeAdminAudit({
      adminId: s.claims.uid, adminEmail: s.email,
      action: "auth.logout", targetType: "admin_session", targetId: s.claims.sid,
      ipAddress: ip
    });
    res.json({ success: true });
  });

  // =========================================================================
  // ADMIN MANAGEMENT (SUPER_ADMIN only via admins.* permissions)
  // =========================================================================

  server.get("/api/admin/admins", adminAuthGuard(), requirePermission("admins.view"), async (req, res) => {
    try {
      const snap = await db.collection("admin_users").get();
      const admins = snap.docs.map((d: any) => {
        const v = d.data();
        return {
          uid: d.id,
          email: v.email,
          role: v.role,
          isActive: v.isActive !== false,
          totpEnabled: v.totpEnabled === true,
          displayName: v.displayName || ""
        };
      });
      res.json({ success: true, admins });
    } catch (err: any) {
      console.error("Error in GET /api/admin/admins:", err);
      res.status(500).json({ error: err?.message || "Failed to list admins" });
    }
  });

  server.post("/api/admin/admins/invite", adminAuthGuard(), requirePermission("admins.manage"), async (req, res) => {
    try {
      const parsed = InviteAdminSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: "Valid email + role required." });
      const { email, role } = parsed.data;
      const caller = (req as any).adminSession;
      const ip = clientIp(req as any);

      const existing = await findAdminByEmail(email.toLowerCase());
      if (existing) return res.status(409).json({ error: "This email is already an admin." });

      await db.collection("admin_users").add({
        email: email.toLowerCase(),
        role,
        isActive: true,
        totpSecret: null,
        totpEnabled: false,
        invitedBy: caller.email,
        createdAt: new Date().toISOString()
      });

      await writeAdminAudit({
        adminId: caller.claims.uid, adminEmail: caller.email,
        action: "admins.invite", targetType: "admin_user", targetId: email.toLowerCase(),
        newValue: { role, isActive: true }, ipAddress: ip,
        note: "New admin invited. They enroll 2FA on first login."
      });

      res.json({ success: true, message: `${email} added as ${role}. They must sign up with this email in the app first, then log in here to enroll 2FA.` });
    } catch (err: any) {
      console.error("Error in POST /api/admin/admins/invite:", err);
      res.status(500).json({ error: err?.message || "Failed to invite admin" });
    }
  });

  server.post("/api/admin/admins/:uid/set-role", adminAuthGuard(), requirePermission("admins.manage"), async (req, res) => {
    try {
      const parsed = SetRoleSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: "Valid role required." });
      const caller = (req as any).adminSession;
      const ip = clientIp(req as any);
      const target = await getAdminById(req.params.uid);
      if (!target) return res.status(404).json({ error: "Admin not found." });

      const oldRole = target.role;
      await db.collection("admin_users").doc(req.params.uid).set({ role: parsed.data.role, updatedAt: new Date().toISOString() }, { merge: true });

      await writeAdminAudit({
        adminId: caller.claims.uid, adminEmail: caller.email,
        action: "admins.set_role", targetType: "admin_user", targetId: target.email,
        oldValue: { role: oldRole }, newValue: { role: parsed.data.role }, ipAddress: ip
      });
      res.json({ success: true, message: `${target.email} role: ${oldRole} → ${parsed.data.role}` });
    } catch (err: any) {
      console.error("Error in POST /api/admin/admins/:uid/set-role:", err);
      res.status(500).json({ error: err?.message || "Failed to set role" });
    }
  });

  server.post("/api/admin/admins/:uid/set-active", adminAuthGuard(), requirePermission("admins.manage"), async (req, res) => {
    try {
      const parsed = SetActiveSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: "isActive boolean required." });
      const caller = (req as any).adminSession;
      const ip = clientIp(req as any);
      const target = await getAdminById(req.params.uid);
      if (!target) return res.status(404).json({ error: "Admin not found." });
      if (target.uid === caller.claims.uid && !parsed.data.isActive) {
        return res.status(400).json({ error: "You cannot deactivate your own account." });
      }

      await db.collection("admin_users").doc(req.params.uid).set({ isActive: parsed.data.isActive, updatedAt: new Date().toISOString() }, { merge: true });

      await writeAdminAudit({
        adminId: caller.claims.uid, adminEmail: caller.email,
        action: parsed.data.isActive ? "admins.activate" : "admins.deactivate",
        targetType: "admin_user", targetId: target.email,
        oldValue: { isActive: target.isActive }, newValue: { isActive: parsed.data.isActive }, ipAddress: ip
      });
      res.json({ success: true, message: `${target.email} ${parsed.data.isActive ? "activated" : "deactivated"}.` });
    } catch (err: any) {
      console.error("Error in POST /api/admin/admins/:uid/set-active:", err);
      res.status(500).json({ error: err?.message || "Failed to update admin status" });
    }
  });

  server.post("/api/admin/admins/:uid/reset-2fa", adminAuthGuard(), requirePermission("admins.manage"), async (req, res) => {
    try {
      const caller = (req as any).adminSession;
      const ip = clientIp(req as any);
      const target = await getAdminById(req.params.uid);
      if (!target) return res.status(404).json({ error: "Admin not found." });

      await db.collection("admin_users").doc(req.params.uid).set({
        totpSecret: null,
        totpEnabled: false,
        totpResetAt: new Date().toISOString(),
        totpResetBy: caller.email
      }, { merge: true });

      await writeAdminAudit({
        adminId: caller.claims.uid, adminEmail: caller.email,
        action: "2fa.reset", targetType: "admin_user", targetId: target.email,
        oldValue: { totpEnabled: target.totpEnabled },
        newValue: { totpEnabled: false, totpSecret: "DELETED" },
        ipAddress: ip,
        note: "2FA reset via console. Admin will re-enroll on next login."
      });
      res.json({ success: true, message: `${target.email} ka 2FA reset ho gaya. Wo next login par naya QR scan karega.` });
    } catch (err: any) {
      console.error("Error in POST /api/admin/admins/:uid/reset-2fa:", err);
      res.status(500).json({ error: err?.message || "Failed to reset 2FA" });
    }
  });

  // Admin config (role permissions, IP whitelist, VPN gate, threshold)
  server.get("/api/admin/config", adminAuthGuard(), requirePermission("admins.view"), async (req, res) => {
    const cfg = await getAdminConfig();
    // Never expose the JWT secret
    const { jwtSecret: _secret, ...safeConfig } = (await db.collection("admin_config").doc("config").get()).data() || {};
    res.json({ success: true, config: cfg, defaults: DEFAULT_ROLE_PERMISSIONS });
  });

  server.post("/api/admin/config/update", adminAuthGuard(), requirePermission("admins.manage"), async (req, res) => {
    try {
      const parsed = ConfigUpdateSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: "Invalid config payload." });
      const caller = (req as any).adminSession;
      const ip = clientIp(req as any);
      const before = await getAdminConfig();

      await db.collection("admin_config").doc("config").set(parsed.data, { merge: true });
      invalidateConfigCache();
      const after = await getAdminConfig();

      await writeAdminAudit({
        adminId: caller.claims.uid, adminEmail: caller.email,
        action: "config.update", targetType: "admin_config", targetId: "config",
        oldValue: { ipWhitelist: before.ipWhitelist, vpnGateEnabled: before.vpnGateEnabled, payoutApprovalThresholdUsd: before.payoutApprovalThresholdUsd },
        newValue: parsed.data, ipAddress: ip
      });
      res.json({ success: true, message: "Config updated.", config: after });
    } catch (err: any) {
      console.error("Error in POST /api/admin/config/update:", err);
      res.status(500).json({ error: err?.message || "Failed to update config" });
    }
  });

  // =========================================================================
  // MONETIZATION ELIGIBILITY & ANTI-FRAUD API ROUTES (100% SERVER VALIDATED)
  // =========================================================================

  // 1. Get Real Database-Calculated Monetization Status & Metrics
  server.get("/api/monetization/status/:creatorId", async (req, res) => {
    try {
      const creatorId = req.params.creatorId;
      if (!creatorId) {
        return res.status(400).json({ error: "creatorId is required" });
      }
      const eligibility = await calculateCreatorEligibility(db, creatorId);
      res.json(eligibility);
    } catch (err: any) {
      console.error("Error in GET /api/monetization/status:", err);
      res.status(500).json({ error: err?.message || "Failed to calculate monetization metrics" });
    }
  });

  // =========================================================================
  // MONETIZATION ELIGIBILITY & ANTI-FRAUD API ROUTES (100% SERVER VALIDATED)
  // =========================================================================
  // NOTE: These are END-USER (creator/app) monetization routes — they use the
  // Firebase user auth guard (verifyAuthToken), NOT the admin guard.
  // Every /api/admin/* and /api/monetization/admin/* route uses adminAuthGuard
  // + requirePermission (see §11-series below).

  // 2. Record Verified Unique View (profile / story / chat / group)
  server.post("/api/monetization/record-view", verifyAuthToken, async (req, res) => {
    try {
      const authUser = (req as any).user;
      const { creatorId, viewerUid: reqViewerUid, deviceId, sourceType, sourceId, watchTimeSeconds, watchCompletionPct } = req.body;
      const viewerUid = authUser.uid;

      if (!creatorId) {
        return res.status(400).json({ error: "creatorId is required" });
      }

      if (reqViewerUid && reqViewerUid !== viewerUid) {
        return res.status(403).json({ error: "Forbidden: viewerUid must match authenticated user" });
      }

      const validSources: MonetizationViewSource[] = ['profile', 'story', 'chat', 'group'];
      const safeSourceType: MonetizationViewSource = validSources.includes(sourceType) ? sourceType : 'profile';

      const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
      const userAgent = req.headers['user-agent'] || '';

      const result = await recordVerifiedView(
        db,
        creatorId,
        viewerUid,
        clientIp,
        deviceId,
        userAgent,
        safeSourceType,
        typeof sourceId === 'string' ? sourceId : undefined
      );

      if (!result.success) {
        return res.status(200).json({ success: false, reason: result.reason });
      }
      res.json({ success: true, message: result.reason, viewId: result.viewId });
    } catch (err: any) {
      console.error("Error in POST /api/monetization/record-view:", err);
      res.status(500).json({ error: err?.message || "Failed to record view" });
    }
  });

  // 2B. Run Idempotent Batch Earnings Calculation Job (Admin / Cron)
  server.post("/api/monetization/run-batch-calculator", adminAuthGuard(), requirePermission("monetization.approve"), async (req, res) => {
    try {
      const { monthKey, forceAll } = req.body || {};
      const batchResult = await aggregateCreatorEarningsBatch(db, { monthKey, forceAll });
      res.json(batchResult);
    } catch (err: any) {
      console.error("Error in POST /api/monetization/run-batch-calculator:", err);
      res.status(500).json({ error: err?.message || "Batch earnings calculation failed" });
    }
  });

  // 3. Apply for Creator Monetization (Server Validates All 5 Requirements)
  server.post("/api/monetization/apply", verifyAuthToken, async (req, res) => {
    try {
      const authUser = (req as any).user;
      const { creatorId } = req.body;
      if (!creatorId) {
        return res.status(400).json({ error: "creatorId is required" });
      }

      if (authUser.uid !== creatorId) {
        const email = (authUser.email || '').toLowerCase();
        const isAdmin = ['admin@anviotalk.com', 'kartiksingh7870n@gmail.com'].includes(email) || authUser.uid === 'admin';
        if (!isAdmin) {
          return res.status(403).json({ error: "Forbidden: You can only apply for your own account" });
        }
      }

      const result = await applyForMonetization(db, creatorId);
      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (err: any) {
      console.error("Error in POST /api/monetization/apply:", err);
      res.status(500).json({ error: err?.message || "Failed to submit application" });
    }
  });

  // 4. Record Verified Ad Impression for Revenue Sharing
  server.post("/api/monetization/record-ad-impression", verifyAuthToken, async (req, res) => {
    try {
      const authUser = (req as any).user;
      const { creatorId, placement } = req.body;
      const viewerUid = authUser.uid;

      if (!creatorId) {
        return res.status(400).json({ error: "creatorId is required" });
      }

      const result = await recordVerifiedAdImpression(db, creatorId, viewerUid, placement || 'banner');
      res.json(result);
    } catch (err: any) {
      console.error("Error in POST /api/monetization/record-ad-impression:", err);
      res.status(500).json({ error: err?.message || "Failed to record ad impression" });
    }
  });

  // 5. Update Payment Method (Bank Transfer + UPI)
  server.post("/api/monetization/payment-method", verifyAuthToken, async (req, res) => {
    try {
      const authUser = (req as any).user;
      const { creatorId, upiId, accountHolderName, bankAccountNumber, ifscCode, bankName } = req.body;
      const uid = creatorId || authUser.uid;

      if (authUser.uid !== uid) {
        return res.status(403).json({ error: "Forbidden: You can only update your own payment method" });
      }

      if (!upiId || !/^\S+@\S+$/.test(upiId.trim())) {
        return res.status(400).json({ error: "A valid UPI ID (e.g. user@upi) is required" });
      }

      if (!accountHolderName || !accountHolderName.trim()) {
        return res.status(400).json({ error: "Account Holder Name is required" });
      }

      if (!bankAccountNumber || !bankAccountNumber.trim()) {
        return res.status(400).json({ error: "Bank Account Number is required" });
      }

      if (!ifscCode || !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(ifscCode.trim())) {
        return res.status(400).json({ error: "A valid 11-character IFSC Code (e.g. SBIN0001234) is required" });
      }

      const statusRef = db.collection("users").doc(uid).collection("monetization").doc("status");
      await statusRef.set({
        paymentMethod: {
          type: 'bank_upi',
          upiId: upiId.trim(),
          accountHolderName: accountHolderName.trim(),
          bankAccountNumber: bankAccountNumber.trim(),
          ifscCode: ifscCode.trim().toUpperCase(),
          bankName: (bankName || 'Bank').trim(),
          isVerified: true,
          updatedAt: new Date().toISOString()
        }
      }, { merge: true });

      res.json({ success: true, message: "Bank & UPI payment details saved successfully" });
    } catch (err: any) {
      console.error("Error in POST /api/monetization/payment-method:", err);
      res.status(500).json({ error: err?.message || "Failed to save payment method" });
    }
  });

  // 6. Request Withdrawal (Manual UPI/Bank Transfer Flow)
  server.post("/api/monetization/request-withdrawal", verifyAuthToken, async (req, res) => {
    try {
      const authUser = (req as any).user;
      const creatorId = authUser.uid;
      const totalAmountUsd = req.body.totalAmountUsd || 0;

      const result = await requestWithdrawal(db, creatorId, totalAmountUsd);
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (err: any) {
      console.error("Error in POST /api/monetization/request-withdrawal:", err);
      res.status(500).json({ error: err?.message || "Failed to process withdrawal request" });
    }
  });

  // 7. Get Creator Payouts History
  server.get("/api/monetization/payouts/:creatorId", verifyAuthToken, async (req, res) => {
    try {
      const authUser = (req as any).user;
      const { creatorId } = req.params;

      if (authUser.uid !== creatorId && authUser.email !== 'admin@anviotalk.com') {
        return res.status(403).json({ error: "Forbidden: Cannot view other creator's payouts" });
      }

      const payouts = await getCreatorPayouts(db, creatorId);
      res.json({ success: true, payouts });
    } catch (err: any) {
      console.error("Error in GET /api/monetization/payouts:", err);
      res.status(500).json({ error: err?.message || "Failed to fetch payout history" });
    }
  });

  // 8. User Reports Endpoint (Ultra-resilient with authenticated & guest handling)
  server.post("/api/reports", async (req, res) => {
    try {
      let reporterUid = 'guest_user';
      let reporterName = 'Anonymous User';
      let reporterUsername = 'guest';

      // Check for auth header if available
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        try {
          const idToken = authHeader.split("Bearer ")[1];
          const decoded = await adminAuth.verifyIdToken(idToken);
          reporterUid = decoded.uid;
          reporterName = decoded.name || decoded.email || 'Registered User';
          // Resolve reporter username from Firestore so admins see who reported
          try {
            const reporterSnap = await db.collection("users").doc(reporterUid).get();
            if (reporterSnap.exists) {
              const rData = reporterSnap.data();
              reporterUsername = rData?.username || reporterUsername;
              if (!decoded.name && rData?.displayName) reporterName = rData.displayName;
            }
          } catch (e2) {
            // Non-blocking: keep defaults
          }
        } catch (e) {
          // Continue with guest fallback if token invalid or guest
        }
      }

      const { 
        id: customReportId,
        targetType, 
        targetId, 
        targetName, 
        targetUsername, 
        targetAvatar, 
        targetContent, 
        parentId, 
        reasonCategory, 
        reason, 
        details 
      } = req.body;

      if (!targetType || !targetId || !reason) {
        return res.status(400).json({ error: "targetType, targetId, and reason are required" });
      }

      if (reporterUid !== 'guest_user' && reporterUid === targetId) {
        return res.status(400).json({ error: "You cannot report yourself" });
      }

      const reportId = customReportId || `rep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const reportsRef = db.collection("reports");

      const reportData = {
        id: reportId,
        reporterUid,
        reporterName: (reporterName || '').trim(),
        reporterUsername: (reporterUsername || '').trim(),
        targetType,
        targetId,
        targetName: (targetName || 'User').trim(),
        targetUsername: (targetUsername || '').trim(),
        targetAvatar: targetAvatar || '',
        targetContent: targetContent || null,
        parentId: parentId || null,
        reasonCategory: reasonCategory || 'other',
        reason: (reason || 'Community Guidelines Violation').trim(),
        details: (details || '').trim(),
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      await reportsRef.doc(reportId).set(reportData, { merge: true });

      res.json({ 
        success: true, 
        reportId,
        message: "Thank you. Your report has been submitted to moderators for review." 
      });
    } catch (err: any) {
      console.error("Error in POST /api/reports:", err);
      res.status(500).json({ error: err?.message || "Failed to submit report" });
    }
  });

  // 9. Admin Reports Management Endpoints (Composite index proof)
  server.get("/api/admin/reports", adminAuthGuard(), requirePermission("reports.view"), async (req, res) => {
    try {
      const { status } = req.query;
      
      // Fetch all reports safely without requiring Firestore composite index
      const snap = await db.collection("reports").get();
      let reports: any[] = [];
      
      snap.forEach((d: any) => {
        reports.push({ id: d.id, ...d.data() });
      });

      // Filter by status if requested
      if (status && typeof status === 'string' && status !== 'all') {
        reports = reports.filter(r => r.status === status);
      }

      // Sort in-memory by createdAt descending
      reports.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
      });

      res.json({ success: true, reports });
    } catch (err: any) {
      console.error("Error in GET /api/admin/reports:", err);
      res.status(500).json({ error: err?.message || "Failed to list reports" });
    }
  });

  server.post("/api/admin/reports/:reportId/action", adminAuthGuard(), requirePermission("reports.action"), async (req, res) => {
    try {
      const { reportId } = req.params;
      const { action, adminNote } = req.body || {}; // action: 'dismiss' | 'warn' | 'suspend_user' | 'delete_content'
      const caller = (req as any).adminSession;
      const ip = clientIp(req as any);

      // Per-action fine-grained permission (SUPPORT dismiss kar sakta hai, delete/suspend nahi)
      const actionPerm: Record<string, string> = {
        dismiss: "reports.dismiss", warn: "users.warn", suspend_user: "users.suspend", delete_content: "content.delete"
      };
      if (!actionPerm[action]) {
        return res.status(400).json({ error: "action must be dismiss | warn | suspend_user | delete_content" });
      }
      if (!hasPermission(caller, actionPerm[action])) {
        return res.status(403).json({ error: `Your role (${caller.role}) lacks permission: ${actionPerm[action]}` });
      }

      const reportDocRef = db.collection("reports").doc(reportId);
      const reportSnap = await reportDocRef.get();
      if (!reportSnap.exists) {
        return res.status(404).json({ error: "Report not found" });
      }

      const reportData = reportSnap.data();

      // Moderation Actions
      if (action === 'suspend_user' && (reportData?.targetType === 'user' || reportData?.targetType === 'story')) {
        const targetUserId = reportData?.targetType === 'user' ? reportData.targetId : (reportData.reporterUid || reportData.targetId);
        const userDocRef = db.collection("users").doc(targetUserId);
        await userDocRef.set({ 
          status: 'suspended',
          isSuspended: true,
          monetizationStatus: 'Suspended',
          suspendedAt: new Date().toISOString(),
          suspendedReason: adminNote || `Suspended due to report #${reportId}`
        }, { merge: true });
      } else if (action === 'warn') {
        if (reportData?.targetType === 'user') {
          const userDocRef = db.collection("users").doc(reportData.targetId);
          await userDocRef.set({
            hasWarning: true,
            warningMessage: adminNote || "Your account has received an official warning for violating Community Guidelines.",
            warnedAt: new Date().toISOString()
          }, { merge: true });
        }
      } else if (action === 'delete_content') {
        if (reportData?.targetType === 'story') {
          await db.collection("stories").doc(reportData.targetId).delete();
        } else if (reportData?.targetType === 'group') {
          await db.collection("chats").doc(reportData.targetId).delete();
        }
      }

      await reportDocRef.set({
        status: action === 'dismiss' ? 'dismissed' : 'actioned',
        reviewedBy: caller.claims.uid,
        reviewedByEmail: caller.email,
        reviewedAt: new Date().toISOString(),
        actionTaken: action,
        adminNote: adminNote || null
      }, { merge: true });

      await writeAdminAudit({
        adminId: caller.claims.uid, adminEmail: caller.email,
        action: `reports.${action}`, targetType: String(reportData?.targetType || "report"),
        targetId: String(reportData?.targetId || reportId),
        oldValue: { reportStatus: reportData?.status || "pending" },
        newValue: { reportStatus: action === 'dismiss' ? 'dismissed' : 'actioned', actionTaken: action },
        ipAddress: ip, note: adminNote
      });

      res.json({ success: true, message: `Report action '${action}' applied successfully.` });
    } catch (err: any) {
      console.error("Error in POST /api/admin/reports/:reportId/action:", err);
      res.status(500).json({ error: err?.message || "Failed to take action on report" });
    }
  });

  // 10. Admin Payouts Management Endpoints
  server.get("/api/admin/payouts", adminAuthGuard(), requirePermission("payouts.view"), async (req, res) => {
    try {
      const snap = await db.collection("payouts").get();
      const payouts: any[] = [];
      snap.forEach((d: any) => payouts.push({ id: d.id, ...d.data() }));
      payouts.sort((a, b) => new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime());
      res.json({ success: true, payouts });
    } catch (err: any) {
      console.error("Error in GET /api/admin/payouts:", err);
      res.status(500).json({ error: err?.message || "Failed to list payouts" });
    }
  });

  server.post("/api/admin/payouts/:payoutId/action", adminAuthGuard(), requirePermission("payouts.approve"), async (req, res) => {
    try {
      const parsed = PayoutActionSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: "action must be approve | mark_paid | reject; transactionReference ≤ 120 chars." });
      }
      const { payoutId } = req.params;
      const { action, transactionReference, adminNote } = parsed.data;
      const caller = (req as any).adminSession;
      const ip = clientIp(req as any);

      const payoutDocRef = db.collection("payouts").doc(payoutId);
      const payoutSnap = await payoutDocRef.get();
      if (!payoutSnap.exists) {
        return res.status(404).json({ error: "Payout record not found" });
      }

      const payoutData = payoutSnap.data() || {};
      const creatorId = payoutData?.creatorId;
      const amountUsd = typeof payoutData?.amountUsd === "number" ? payoutData.amountUsd : 0;
      const oldStatus = payoutData?.status || "pending";

      // -----------------------------------------------------------------
      // MAKER-CHECKER: large payouts (>= admin_config threshold) need a
      // second admin. First call creates a pending approval request; the
      // actual payout only happens after another admin approves it.
      // -----------------------------------------------------------------
      const cfg = await getAdminConfig();
      const threshold = cfg.payoutApprovalThresholdUsd;
      const isDecidingAction = action === "mark_paid" || action === "approve";
      if (isDecidingAction && amountUsd >= threshold) {
        const existingSnap = await db.collection("pending_payout_approvals")
          .where("payoutId", "==", payoutId)
          .where("status", "==", "pending")
          .limit(1).get();

        if (existingSnap.empty) {
          const reqRef = db.collection("pending_payout_approvals").doc();
          await reqRef.set({
            payoutId,
            creatorId,
            amountUsd,
            thresholdUsd: threshold,
            requestedAction: action,
            requestedBy: caller.claims.uid,
            requestedByEmail: caller.email,
            status: "pending",
            requestedAtMs: Date.now(),
            requestedAt: new Date().toISOString()
          });
          await writeAdminAudit({
            adminId: caller.claims.uid, adminEmail: caller.email,
            action: "payouts.maker_request", targetType: "payout", targetId: payoutId,
            oldValue: { status: oldStatus },
            newValue: { pendingApprovalId: reqRef.id, amountUsd, thresholdUsd: threshold },
            ipAddress: ip, note: adminNote || `Maker-checker: $${amountUsd.toFixed(2)} >= $${threshold.toFixed(2)} — doosre admin ki approval chahiye.`
          });
          return res.status(202).json({
            success: true,
            makerChecker: true,
            message: `Payout $${amountUsd.toFixed(2)} threshold ($${threshold.toFixed(2)}) se bada hai — approval request ban gayi. Doosra admin (FINANCE_ADMIN/SUPER_ADMIN) approve karega, phir payout lagega.`
          });
        }
        // pending request exists: only the checker (not requester) may complete it here
        const pendingReq = existingSnap.docs[0].data();
        if (pendingReq.requestedBy === caller.claims.uid || pendingReq.requestedByEmail === caller.email) {
          return res.status(403).json({
            error: "Maker-checker: aapne yeh payout request banayi hai, use khud approve nahi kar sakte. Doosra admin approve karega (ya pending-approvals se checker decide kare)."
          });
        }
        // fall through — caller is the checker, proceed with the payout action
      }
      // Self-check guard even below threshold: reject-own-approval confusion se bacho
      if (isDecidingAction && payoutData.processedBy === caller.claims.uid && oldStatus !== "pending") {
        return res.status(409).json({ error: `Payout already ${oldStatus}.` });
      }

      let newStatus = "processing";
      if (action === "mark_paid") newStatus = "paid";
      if (action === "reject") newStatus = "rejected";

      await payoutDocRef.set({
        status: newStatus,
        processedAt: new Date().toISOString(),
        processedBy: caller.claims.uid,
        processedByEmail: caller.email,
        transactionReference: transactionReference || null,
        adminNote: adminNote || null
      }, { merge: true });

      // Mark creator as manually reviewed
      if ((action === "mark_paid" || action === "approve") && creatorId) {
        const statusRef = db.collection("users").doc(creatorId).collection("monetization").doc("status");
        await statusRef.set({ manuallyReviewed: true }, { merge: true });
      }

      await writeAdminAudit({
        adminId: caller.claims.uid, adminEmail: caller.email,
        action: `payouts.${action === "reject" ? "reject" : "approve"}`,
        targetType: "payout", targetId: payoutId,
        oldValue: { status: oldStatus, amountUsd },
        newValue: { status: newStatus, transactionReference: transactionReference || null },
        ipAddress: ip, note: adminNote
      });

      res.json({ success: true, message: `Payout status updated to ${newStatus}` });
    } catch (err: any) {
      console.error("Error in POST /api/admin/payouts/:payoutId/action:", err);
      res.status(500).json({ error: err?.message || "Failed to update payout status" });
    }
  });

  // 11. Admin Manual Approval Endpoint for Creator Monetization
  server.get("/api/monetization/admin/creators", adminAuthGuard(), requirePermission("monetization.view"), async (req, res) => {
    try {
      const usersSnap = await db.collection("users").get();
      const creatorsList: any[] = [];

      for (const uDoc of usersSnap.docs) {
        const uData = uDoc.data();
        const uid = uDoc.id;
        
        // Fetch subcollection status if present
        let status = uData.monetizationStatus || (uData.isMonetized ? 'Approved' : 'In Progress');
        let approvedAt = uData.monetizationApprovedAt || uData.approvedAt || null;
        let paymentMethod = null;
        let unpaidBalanceUsd = 0;

        let uniqueViewsCount = 0;
        let uniqueChatsCount = 0;
        let activeDaysCount = 0;
        let storyUploadDaysCount = 0;

        try {
          const sSnap = await db.collection("users").doc(uid).collection("monetization").doc("status").get();
          if (sSnap.exists) {
            const sData = sSnap.data();
            if (sData.status) status = sData.status;
            if (sData.approvedAt) approvedAt = sData.approvedAt;
            if (sData.paymentMethod) paymentMethod = sData.paymentMethod;
            if (typeof sData.unpaidBalanceUsd === 'number') unpaidBalanceUsd = sData.unpaidBalanceUsd;
            if (typeof sData.uniqueViewsCount === 'number') uniqueViewsCount = sData.uniqueViewsCount;
            if (typeof sData.uniqueChatsCount === 'number') uniqueChatsCount = sData.uniqueChatsCount;
            if (typeof sData.activeDaysCount === 'number') activeDaysCount = sData.activeDaysCount;
            if (typeof sData.storyUploadDaysCount === 'number') storyUploadDaysCount = sData.storyUploadDaysCount;
          }
        } catch (e) {
          // ignore
        }

        creatorsList.push({
          uid,
          username: uData.username || 'unknown',
          displayName: uData.displayName || uData.name || uData.username || 'Anonymous',
          avatarUrl: uData.avatarUrl || uData.avatar || '',
          email: uData.email || '',
          followersCount: uData.followersCount || 0,
          accountStatus: uData.accountStatus || 'active',
          isCreator: uData.isCreator === true,
          isMonetized: status === 'Approved' || uData.isMonetized === true,
          monetizationStatus: status,
          approvedAt,
          paymentMethod,
          unpaidBalanceUsd,
          uniqueViewsCount: status === 'Approved' ? Math.max(uniqueViewsCount, 500) : uniqueViewsCount,
          uniqueChatsCount: status === 'Approved' ? Math.max(uniqueChatsCount, 20) : uniqueChatsCount,
          activeDaysCount: status === 'Approved' ? Math.max(activeDaysCount, 7) : activeDaysCount,
          storyUploadDaysCount: status === 'Approved' ? Math.max(storyUploadDaysCount, 7) : storyUploadDaysCount
        });
      }

      // Sort: Under Review first, then Eligible, then Approved, then In Progress
      const priorityOrder: Record<string, number> = {
        'Under Review': 1,
        'Eligible': 2,
        'Approved': 3,
        'In Progress': 4,
        'Suspended': 5,
        'Paused': 6
      };

      creatorsList.sort((a, b) => {
        const pA = priorityOrder[a.monetizationStatus] || 99;
        const pB = priorityOrder[b.monetizationStatus] || 99;
        if (pA !== pB) return pA - pB;
        return (b.followersCount || 0) - (a.followersCount || 0);
      });

      res.json({ success: true, creators: creatorsList });
    } catch (err: any) {
      console.error("Error in GET /api/monetization/admin/creators:", err);
      res.status(500).json({ error: err?.message || "Failed to fetch creators" });
    }
  });

  server.post("/api/monetization/admin/approve-creator", adminAuthGuard(), requirePermission("monetization.approve"), async (req, res) => {
    try {
      const { creatorId, status = 'Approved', note } = req.body;
      if (!creatorId) {
        return res.status(400).json({ error: "creatorId is required" });
      }

      const statusRef = db.collection("users").doc(creatorId).collection("monetization").doc("status");
      const userRef = db.collection("users").doc(creatorId);

      const existingStatusSnap = await statusRef.get();
      const existingData = existingStatusSnap.exists ? existingStatusSnap.data() : {};
      const existingUserSnap = await userRef.get();
      const existingUserData = existingUserSnap.exists ? existingUserSnap.data() : {};

      const approvalTimestamp = existingData?.approvedAt || existingUserData?.monetizationApprovedAt || new Date().toISOString();

      const updateData: any = {
        status,
        monetizationStatus: status,
        manuallyReviewed: true,
        adminNote: note || "Approved by administrator"
      };

      if (status === 'Approved') {
        updateData.approvedAt = approvalTimestamp;
        updateData.viewsGoalMet = true;
        updateData.chatsGoalMet = true;
        updateData.followersGoalMet = true;
        updateData.activeDaysGoalMet = true;
        updateData.storyDaysGoalMet = true;
        updateData.allGoalsMet = true;
        updateData.overallProgressPct = 100;
        updateData.uniqueViewsCount = Math.max(existingData?.uniqueViewsCount || 0, 500);
        updateData.uniqueChatsCount = Math.max(existingData?.uniqueChatsCount || 0, 20);
        updateData.followersCount = Math.max(existingUserData?.followersCount || 0, 100);
        updateData.activeDaysCount = Math.max(existingData?.activeDaysCount || 0, 7);
        updateData.storyUploadDaysCount = Math.max(existingData?.storyUploadDaysCount || 0, 7);
      }

      // 1. Update subcollection doc
      await statusRef.set(updateData, { merge: true });

      // 2. Also update main user doc for instant app-wide synchronization
      const userUpdate: any = {
        monetizationStatus: status,
        isCreator: true
      };

      if (status === 'Approved') {
        userUpdate.isMonetized = true;
        userUpdate.monetizationApprovedAt = approvalTimestamp;
        userUpdate.followersCount = Math.max(existingUserData?.followersCount || 0, 100);
      } else if (status === 'Suspended' || status === 'Rejected' || status === 'Paused') {
        userUpdate.isMonetized = false;
      }

      await userRef.set(userUpdate, { merge: true });

      await createAuditLog(db, {
        userId: (req as any).adminSession?.claims?.uid || "unknown_admin",
        targetUserId: creatorId,
        timestamp: new Date().toISOString(),
        timestampMs: Date.now(),
        deviceId: 'admin_console',
        ipHash: 'admin_ip',
        eventType: 'fraud_check',
        verificationStatus: 'PASSED',
        reason: `Admin manual approval granted. Status updated to ${status}.`
      });

      res.json({ 
        success: true, 
        message: `Creator ${creatorId} monetization status updated to ${status}`,
        status,
        approvedAt: status === 'Approved' ? approvalTimestamp : null
      });
    } catch (err: any) {
      console.error("Error in POST /api/monetization/admin/approve-creator:", err);
      res.status(500).json({ error: err?.message || "Failed to update creator status" });
    }
  });

  // =========================================================================
  // 11b. ADMIN USERS MANAGEMENT (Account Block/Unblock System)
  // =========================================================================

  // List all users with moderation-relevant fields (search + status filter in-memory, no index needed)
  server.get("/api/admin/users", adminAuthGuard(), requirePermission("users.view"), async (req, res) => {
    try {
      const search = String(req.query.search || '').toLowerCase().trim();
      const statusFilter = String(req.query.status || 'all').toLowerCase();

      const usersSnap = await db.collection("users").get();
      const users: any[] = [];

      usersSnap.forEach((uDoc: any) => {
        const u = uDoc.data();
        const uid = uDoc.id;

        const rawStatus = String(
          u.accountStatus || (u.status === 'banned' || u.status === 'suspended' ? u.status : 'active')
        ).toLowerCase();

        users.push({
          uid,
          username: u.username || 'unknown',
          displayName: u.displayName || u.name || u.username || 'Anonymous',
          avatarUrl: u.avatarUrl || u.avatar || '',
          email: u.email || '',
          accountStatus: rawStatus,
          suspendedReason: u.suspendedReason || u.suspensionReason || null,
          suspendedAt: u.suspendedAt || null,
          hasWarning: u.hasWarning === true,
          warningMessage: u.warningMessage || null,
          monetizationStatus: u.monetizationStatus || (u.isMonetized ? 'Approved' : 'In Progress'),
          followersCount: u.followersCount || 0,
          createdAt: u.createdAt || null,
          lastActiveAt: u.lastActiveAt || null
        });
      });

      let filtered = users;
      if (statusFilter === 'suspended') filtered = filtered.filter((u) => u.accountStatus === 'suspended');
      else if (statusFilter === 'banned') filtered = filtered.filter((u) => u.accountStatus === 'banned');
      else if (statusFilter === 'active') filtered = filtered.filter((u) => u.accountStatus === 'active');
      else if (statusFilter === 'warned') filtered = filtered.filter((u) => u.hasWarning);
      else if (statusFilter === 'blocked') filtered = filtered.filter((u) => u.accountStatus === 'suspended' || u.accountStatus === 'banned');

      if (search) {
        filtered = filtered.filter((u) =>
          u.username?.toLowerCase().includes(search) ||
          u.displayName?.toLowerCase().includes(search) ||
          u.email?.toLowerCase().includes(search) ||
          u.uid?.toLowerCase().includes(search)
        );
      }

      // Blocked users first, then by followers descending
      filtered.sort((a, b) => {
        const blockedA = a.accountStatus === 'suspended' || a.accountStatus === 'banned' ? 0 : 1;
        const blockedB = b.accountStatus === 'suspended' || b.accountStatus === 'banned' ? 0 : 1;
        if (blockedA !== blockedB) return blockedA - blockedB;
        return (b.followersCount || 0) - (a.followersCount || 0);
      });

      res.json({ success: true, users: filtered, total: users.length });
    } catch (err: any) {
      console.error("Error in GET /api/admin/users:", err);
      res.status(500).json({ error: err?.message || "Failed to fetch users" });
    }
  });

  // Suspend / Ban / Reactivate / Warn a user account (audit-logged, self-action guarded)
  server.post("/api/admin/users/:uid/action", adminAuthGuard(), requirePermission("users.manage"), async (req, res) => {
    try {
      const parsed = UserActionSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid action. Use suspend | ban | reactivate | warn (note ≤ 500 chars)." });
      }
      const { uid } = req.params;
      const { action, note } = parsed.data;
      const caller = (req as any).adminSession;
      const ip = clientIp(req as any);

      // Fine-grained per-action permission (reactivate is a softer power than ban)
      const perActionPerm: Record<string, string> = {
        suspend: "users.suspend", ban: "users.ban", reactivate: "users.reactivate", warn: "users.warn"
      };
      if (!hasPermission(caller, perActionPerm[action])) {
        return res.status(403).json({ error: `Your role (${caller.role}) lacks permission: ${perActionPerm[action]}` });
      }

      if (!uid) return res.status(400).json({ error: "uid is required" });

      // Guard: an admin cannot moderate their own account
      if (caller.claims.uid === uid) {
        return res.status(400).json({ error: "You cannot moderate your own account." });
      }

      const userDocRef = db.collection("users").doc(uid);
      const userSnap = await userDocRef.get();
      if (!userSnap.exists) {
        return res.status(404).json({ error: "User not found" });
      }
      const before = userSnap.data() || {};
      const oldValue = { accountStatus: before.accountStatus ?? before.status ?? null, isSuspended: before.isSuspended ?? false, hasWarning: before.hasWarning ?? false, monetizationStatus: before.monetizationStatus ?? null };

      const nowIso = new Date().toISOString();
      const updateData: any = {};

      if (action === 'suspend') {
        updateData.accountStatus = 'suspended';
        updateData.status = 'suspended';
        updateData.isSuspended = true;
        updateData.suspendedAt = nowIso;
        updateData.suspendedReason = note || 'Suspended by administrator';
        updateData.monetizationStatus = 'Suspended';
      } else if (action === 'ban') {
        updateData.accountStatus = 'banned';
        updateData.status = 'banned';
        updateData.isSuspended = true;
        updateData.suspendedAt = nowIso;
        updateData.suspendedReason = note || 'Permanently banned by administrator';
        updateData.monetizationStatus = 'Suspended';
      } else if (action === 'reactivate') {
        updateData.accountStatus = 'active';
        updateData.status = 'active';
        updateData.isSuspended = false;
        updateData.suspendedAt = null;
        updateData.suspendedReason = null;
        // Restore monetization unless it was individually suspended by the monetization console
        try {
          const monStatusSnap = await db.collection("users").doc(uid).collection("monetization").doc("status").get();
          const monStatus = monStatusSnap.exists ? monStatusSnap.data()?.status : null;
          updateData.monetizationStatus = monStatus === 'Suspended' ? 'Suspended' : (monStatus || 'In Progress');
        } catch (e) {
          updateData.monetizationStatus = 'In Progress';
        }
      } else if (action === 'warn') {
        updateData.hasWarning = true;
        updateData.warningMessage = note || 'Your account has received an official warning for violating Community Guidelines.';
        updateData.warnedAt = nowIso;
      }

      await userDocRef.set(updateData, { merge: true });

      await createAuditLog(db, {
        userId: caller.claims.uid,
        targetUserId: uid,
        timestamp: nowIso,
        timestampMs: Date.now(),
        deviceId: 'admin_console',
        ipHash: 'admin_ip',
        eventType: 'fraud_check',
        verificationStatus: action === 'warn' ? 'FLAGGED' : 'PASSED',
        reason: `Admin account action '${action}' applied.${note ? ' Note: ' + note : ''}`
      });

      await writeAdminAudit({
        adminId: caller.claims.uid, adminEmail: caller.email,
        action: `users.${action}`, targetType: "user", targetId: uid,
        oldValue,
        newValue: { accountStatus: updateData.accountStatus ?? null, isSuspended: updateData.isSuspended ?? null, hasWarning: updateData.hasWarning ?? null, monetizationStatus: updateData.monetizationStatus ?? null },
        ipAddress: ip, note
      });

      res.json({ success: true, message: `User ${uid} action '${action}' applied successfully.`, action });
    } catch (err: any) {
      console.error("Error in POST /api/admin/users/:uid/action:", err);
      res.status(500).json({ error: err?.message || "Failed to apply account action" });
    }
  });

  // =========================================================================
  // 11c. ADMIN MONETIZATION REPORT (Platform-wide verified views & earnings)
  // =========================================================================

  server.get("/api/admin/monetization-report", adminAuthGuard(), requirePermission("monetization.view"), async (req, res) => {
    try {
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const USD_TO_INR = 83.5;
      const INR_PER_1000_VIEWS = 40;
      const MAX_MONTHLY_PAYOUT_USD = 500;

      // Users map for display info
      const usersSnap = await db.collection("users").get();
      const userMap: Record<string, any> = {};
      usersSnap.forEach((d: any) => {
        const u = d.data();
        userMap[d.id] = {
          username: u.username || 'unknown',
          displayName: u.displayName || u.name || u.username || 'Anonymous',
          avatarUrl: u.avatarUrl || u.avatar || '',
          monetizationStatus: u.monetizationStatus || (u.isMonetized ? 'Approved' : 'In Progress')
        };
      });

      // This month's verified views grouped by creator & source (equality-only query: no composite index needed)
      const perCreator: Record<string, { profileViews: number; storyViews: number; chatViews: number; groupViews: number; totalViews: number }> = {};
      try {
        const viewsSnap = await db.collection("monetization_views")
          .where("monthKey", "==", monthKey)
          .where("verificationStatus", "==", "PASSED")
          .get();
        viewsSnap.forEach((vDoc: any) => {
          const v = vDoc.data();
          const cId = v.creatorId;
          if (!cId || !userMap[cId]) return; // skip deleted/unknown users
          if (!perCreator[cId]) perCreator[cId] = { profileViews: 0, storyViews: 0, chatViews: 0, groupViews: 0, totalViews: 0 };
          const st = v.sourceType || 'profile';
          if (st === 'profile') perCreator[cId].profileViews++;
          else if (st === 'story') perCreator[cId].storyViews++;
          else if (st === 'chat') perCreator[cId].chatViews++;
          else if (st === 'group') perCreator[cId].groupViews++;
          perCreator[cId].totalViews++;
        });
      } catch (e) {
        console.warn("[AdminReport] views scan warning:", e);
      }

      // Payout aggregates + per-creator payout status
      let pendingPayoutUsd = 0;
      let pendingPayoutCount = 0;
      let paidPayoutUsdTotal = 0;
      let paidPayoutCount = 0;
      const payoutStatusByCreator: Record<string, string> = {};
      try {
        const payoutsSnap = await db.collection("payouts").get();
        payoutsSnap.forEach((pDoc: any) => {
          const p = pDoc.data();
          const amt = Number(p.amountUsd) || 0;
          if (p.status === 'requested' || p.status === 'processing') {
            pendingPayoutUsd += amt;
            pendingPayoutCount++;
            payoutStatusByCreator[p.creatorId] = p.status;
          } else if (p.status === 'paid') {
            paidPayoutUsdTotal += amt;
            paidPayoutCount++;
          } else if (p.status === 'rejected') {
            payoutStatusByCreator[p.creatorId] = 'rejected';
          }
        });
      } catch (e) {
        console.warn("[AdminReport] payouts scan warning:", e);
      }

      const creators = Object.entries(perCreator).map(([uid, c]) => {
        // Same earning rule as the payout engine: ₹40 per complete 1k-views block per source, $500 monthly cap
        const blocks =
          Math.floor(c.profileViews / 1000) +
          Math.floor(c.storyViews / 1000) +
          Math.floor(c.chatViews / 1000) +
          Math.floor(c.groupViews / 1000);
        const earningsUsd = Math.min(MAX_MONTHLY_PAYOUT_USD, (blocks * INR_PER_1000_VIEWS) / USD_TO_INR);
        return {
          uid,
          username: userMap[uid]?.username || 'unknown',
          displayName: userMap[uid]?.displayName || 'Anonymous',
          avatarUrl: userMap[uid]?.avatarUrl || '',
          monetizationStatus: userMap[uid]?.monetizationStatus || 'In Progress',
          profileViews: c.profileViews,
          storyViews: c.storyViews,
          chatViews: c.chatViews,
          groupViews: c.groupViews,
          totalViews: c.totalViews,
          earningsUsd: Number(earningsUsd.toFixed(2)),
          payoutStatus: payoutStatusByCreator[uid] || null
        };
      }).sort((a, b) => b.totalViews - a.totalViews);

      const totalViews = creators.reduce((s, c) => s + c.totalViews, 0);
      const totalEarningsUsd = Number(creators.reduce((s, c) => s + c.earningsUsd, 0).toFixed(2));

      res.json({
        success: true,
        monthKey,
        totals: {
          totalViews,
          totalEarningsUsd,
          totalEarningsInr: Math.round(totalEarningsUsd * USD_TO_INR),
          activeCreators: creators.length,
          pendingPayoutUsd: Number(pendingPayoutUsd.toFixed(2)),
          pendingPayoutCount,
          paidPayoutUsd: Number(paidPayoutUsdTotal.toFixed(2)),
          paidPayoutCount
        },
        creators
      });
    } catch (err: any) {
      console.error("Error in GET /api/admin/monetization-report:", err);
      res.status(500).json({ error: err?.message || "Failed to build monetization report" });
    }
  });

  // =========================================================================
  // 11e. ANALYTICS, DATING MODERATION, MAKER-CHECKER APPROVALS, AUDIT VIEWER
  // =========================================================================

  // Analytics: DAU/MAU, content, earnings
  server.get("/api/admin/analytics", adminAuthGuard(), requirePermission("analytics.view"), async (req, res) => {
    try {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const monthMs = 30 * dayMs;

      let dau = 0, wau = 0, mau = 0, totalUsers = 0;
      try {
        const usersSnap = await db.collection("users").get();
        usersSnap.forEach((d: any) => {
          totalUsers++;
          const u = d.data();
          let lastMs = 0;
          if (u.lastActiveAt?.seconds) lastMs = u.lastActiveAt.seconds * 1000;
          else if (typeof u.lastActiveAtMs === "number") lastMs = u.lastActiveAtMs;
          else if (typeof u.lastActiveAt === "string") lastMs = new Date(u.lastActiveAt).getTime() || 0;
          if (now - lastMs < dayMs) dau++;
          if (now - lastMs < 7 * dayMs) wau++;
          if (now - lastMs < monthMs) mau++;
        });
      } catch { /* ignore */ }

      let totalViews = 0;
      try {
        const snap = await db.collection("monetization_views").get();
        totalViews = snap.size;
      } catch { /* ignore */ }

      let totalPaidOut = 0;
      let paidCount = 0;
      let flaggedCount = 0;
      try {
        const payoutsSnap = await db.collection("payouts").get();
        payoutsSnap.forEach((d: any) => {
          const p = d.data();
          if (p.status === "paid") { totalPaidOut += Number(p.amountUsd) || 0; paidCount++; }
        });
        const flaggedSnap = await db.collection("flagged_content").where("status", "==", "open").get();
        flaggedCount = flaggedSnap.size;
      } catch { /* ignore */ }

      res.json({
        success: true,
        dau, wau, mau, totalUsers,
        stickiness: mau > 0 ? Math.round((dau / mau) * 100) : 0,
        totalViews,
        totalPaidOutUsd: Number(totalPaidOut.toFixed(2)),
        paidPayoutCount: paidCount,
        flaggedContentCount: flaggedCount,
        generatedAt: new Date().toISOString()
      });
    } catch (err: any) {
      console.error("Error in GET /api/admin/analytics:", err);
      res.status(500).json({ error: err?.message || "Failed to compute analytics" });
    }
  });

  // Dating moderation: flagged profiles list
  server.get("/api/admin/dating-flags", adminAuthGuard(), requirePermission("dating.view"), async (req, res) => {
    try {
      const snap = await db.collection("flagged_content").orderBy("createdAtMs", "desc").limit(200).get();
      const flags = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      res.json({ success: true, flags });
    } catch (err: any) {
      console.error("Error in GET /api/admin/dating-flags:", err);
      res.status(500).json({ error: err?.message || "Failed to fetch dating flags" });
    }
  });

  // Dating moderation: act on a flag (confirm fake / clear / ban user) — audit logged
  server.post("/api/admin/dating-flags/:flagId/action", adminAuthGuard(), requirePermission("dating.action"), async (req, res) => {
    try {
      const parsed = DatingFlagActionSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: "Invalid action. Use confirm_fake | clear_flag | ban_user." });
      const caller = (req as any).adminSession;
      const ip = clientIp(req as any);

      const flagRef = db.collection("flagged_content").doc(req.params.flagId);
      const flagSnap = await flagRef.get();
      if (!flagSnap.exists) return res.status(404).json({ error: "Flag not found." });
      const flagData = flagSnap.data() || {};

      if (parsed.data.action === "confirm_fake") {
        await flagRef.set({ status: "confirmed_fake", reviewedBy: caller.email, reviewedAtMs: Date.now(), reviewNote: parsed.data.note || null }, { merge: true });
        if (flagData.targetUserId) {
          await db.collection("users").doc(flagData.targetUserId).set({
            isFake: true,
            flaggedAsFake: true,
            fakeFlagReason: parsed.data.note || "Confirmed fake by moderation",
            fakeFlaggedAtMs: Date.now()
          }, { merge: true });
        }
      } else if (parsed.data.action === "clear_flag") {
        await flagRef.set({ status: "cleared", reviewedBy: caller.email, reviewedAtMs: Date.now(), reviewNote: parsed.data.note || null }, { merge: true });
      } else if (parsed.data.action === "ban_user") {
        if (flagData.targetUserId) {
          await db.collection("users").doc(flagData.targetUserId).set({
            accountStatus: "banned",
            status: "banned",
            isSuspended: true,
            suspendedAt: new Date().toISOString(),
            suspendedReason: parsed.data.note || "Banned via dating moderation (fake profile)",
            monetizationStatus: "Suspended"
          }, { merge: true });
        }
        await flagRef.set({ status: "banned", reviewedBy: caller.email, reviewedAtMs: Date.now() }, { merge: true });
      }

      await writeAdminAudit({
        adminId: caller.claims.uid, adminEmail: caller.email,
        action: `dating.${parsed.data.action}`,
        targetType: "dating_profile",
        targetId: String(flagData.targetUserId || req.params.flagId),
        oldValue: { flagStatus: flagData.status || "open" },
        newValue: { action: parsed.data.action, note: parsed.data.note || null },
        ipAddress: ip, note: parsed.data.note
      });

      res.json({ success: true, message: `Flag ${parsed.data.action} completed.` });
    } catch (err: any) {
      console.error("Error in POST /api/admin/dating-flags/:flagId/action:", err);
      res.status(500).json({ error: err?.message || "Failed to process flag" });
    }
  });

  // Maker-checker: list pending payout approvals
  server.get("/api/admin/pending-approvals", adminAuthGuard(), requirePermission("payouts.view"), async (req, res) => {
    try {
      const snap = await db.collection("pending_payout_approvals").orderBy("requestedAtMs", "desc").limit(100).get();
      const approvals = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      res.json({ success: true, approvals });
    } catch (err: any) {
      console.error("Error in GET /api/admin/pending-approvals:", err);
      res.status(500).json({ error: err?.message || "Failed to fetch pending approvals" });
    }
  });

  // Maker-checker: decide (approve/reject). Requester cannot approve own request.
  server.post("/api/admin/pending-approvals/:id/decision", adminAuthGuard(), requirePermission("payouts.approve"), async (req, res) => {
    try {
      const parsed = DecisionSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: "decision must be approved | rejected." });
      const caller = (req as any).adminSession;
      const ip = clientIp(req as any);

      const ref = db.collection("pending_payout_approvals").doc(req.params.id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Approval request not found." });
      const data = snap.data() || {};

      if (data.status !== "pending") {
        return res.status(409).json({ error: `Already decided (${data.status}).` });
      }
      // MAKER-CHECKER: requester cannot decide own request
      if (data.requestedBy === caller.claims.uid || data.requestedByEmail === caller.email) {
        return res.status(403).json({ error: "Maker-checker: aap apni hi approval request decide nahi kar sakte. Doosra FINANCE_ADMIN/SUPER_ADMIN karega." });
      }

      await ref.set({
        status: parsed.data.decision,
        decidedBy: caller.email,
        decidedByUid: caller.claims.uid,
        decidedAtMs: Date.now(),
        decisionNote: parsed.data.note || null
      }, { merge: true });

      // On approve: apply the underlying payout action
      if (parsed.data.decision === "approved" && data.payoutId) {
        const payoutRef = db.collection("payouts").doc(data.payoutId);
        const payoutSnap = await payoutRef.get();
        if (payoutSnap.exists) {
          await payoutRef.set({
            status: "paid",
            processedAt: new Date().toISOString(),
            processedBy: caller.email,
            approvalFlow: "maker-checker",
            approvedVia: req.params.id
          }, { merge: true });
        }
      }

      await writeAdminAudit({
        adminId: caller.claims.uid, adminEmail: caller.email,
        action: `payouts.checker_${parsed.data.decision}`,
        targetType: "payout_approval", targetId: req.params.id,
        oldValue: { status: "pending", amountUsd: data.amountUsd, requestedBy: data.requestedByEmail },
        newValue: { status: parsed.data.decision, payoutId: data.payoutId },
        ipAddress: ip, note: parsed.data.note
      });

      res.json({ success: true, message: `Approval ${parsed.data.decision}.` });
    } catch (err: any) {
      console.error("Error in POST /api/admin/pending-approvals/:id/decision:", err);
      res.status(500).json({ error: err?.message || "Failed to record decision" });
    }
  });

  // Audit log viewer (read-only, immutable trail)
  server.get("/api/admin/audit-logs", adminAuthGuard(), requirePermission("audit.view"), async (req, res) => {
    try {
      const limitN = Math.min(300, Math.max(1, parseInt(String(req.query.limit || "100"), 10) || 100));
      let q: any = db.collection("admin_audit_logs").orderBy("timestampMs", "desc").limit(limitN);
      const action = String(req.query.action || "").trim();
      if (action) {
        q = db.collection("admin_audit_logs").where("action", ">=", action).where("action", "<=", action + "\uf8ff").orderBy("action").orderBy("timestampMs", "desc").limit(limitN);
      }
      const snap = await q.get();
      const logs = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      res.json({ success: true, logs });
    } catch (err: any) {
      console.error("Error in GET /api/admin/audit-logs:", err);
      res.status(500).json({ error: err?.message || "Failed to fetch audit logs" });
    }
  });

  // =========================================================================
  // 11d. ADMIN DASHBOARD OVERVIEW + CONTENT MODERATION (standalone desktop console)
  // =========================================================================

  // Platform overview stats for the admin dashboard home
  server.get("/api/admin/overview", adminAuthGuard(), requirePermission("analytics.view"), async (req, res) => {
    try {
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const dayAgoMs = Date.now() - 24 * 60 * 60 * 1000;

      const usersSnap = await db.collection("users").get();
      let totalUsers = 0;
      let suspendedUsers = 0;
      let bannedUsers = 0;
      let warnedUsers = 0;
      usersSnap.forEach((d: any) => {
        totalUsers++;
        const u = d.data();
        const st = String(u.accountStatus || u.status || 'active').toLowerCase();
        if (st === 'suspended') suspendedUsers++;
        else if (st === 'banned') bannedUsers++;
        if (u.hasWarning === true) warnedUsers++;
      });

      let storiesCount = 0;
      let newStories24h = 0;
      try {
        const storiesSnap = await db.collection("stories").get();
        storiesSnap.forEach((d: any) => {
          storiesCount++;
          const s = d.data();
          let ms = 0;
          if (s.createdAt?.seconds) ms = s.createdAt.seconds * 1000;
          else if (typeof s.createdAtMs === 'number') ms = s.createdAtMs;
          else if (typeof s.createdAt === 'string') ms = new Date(s.createdAt).getTime() || 0;
          if (ms >= dayAgoMs) newStories24h++;
        });
      } catch (e) { /* ignore */ }

      let pendingReports = 0;
      let totalReports = 0;
      try {
        const reportsSnap = await db.collection("reports").get();
        reportsSnap.forEach((d: any) => {
          totalReports++;
          if (d.data()?.status === 'pending') pendingReports++;
        });
      } catch (e) { /* ignore */ }

      let monthViews = 0;
      try {
        const viewsSnap = await db.collection("monetization_views")
          .where("monthKey", "==", monthKey)
          .where("verificationStatus", "==", "PASSED")
          .get();
        monthViews = viewsSnap.size;
      } catch (e) { /* ignore */ }

      let pendingPayouts = 0;
      let pendingPayoutUsd = 0;
      try {
        const payoutsSnap = await db.collection("payouts").get();
        payoutsSnap.forEach((d: any) => {
          const p = d.data();
          if (p.status === 'requested' || p.status === 'processing') {
            pendingPayouts++;
            pendingPayoutUsd += Number(p.amountUsd) || 0;
          }
        });
      } catch (e) { /* ignore */ }

      res.json({
        success: true,
        totalUsers,
        suspendedUsers,
        bannedUsers,
        warnedUsers,
        storiesCount,
        newStories24h,
        pendingReports,
        totalReports,
        monthViews,
        pendingPayouts,
        pendingPayoutUsd: Number(pendingPayoutUsd.toFixed(2)),
        generatedAt: new Date().toISOString()
      });
    } catch (err: any) {
      console.error("Error in GET /api/admin/overview:", err);
      res.status(500).json({ error: err?.message || "Failed to build overview" });
    }
  });

  // All stories (posts) with author info for content moderation
  server.get("/api/admin/stories", adminAuthGuard(), requirePermission("content.view"), async (req, res) => {
    try {
      const search = String(req.query.search || '').toLowerCase().trim();
      const storiesSnap = await db.collection("stories").get();

      // Author info map
      const userMap: Record<string, { username: string; displayName: string }> = {};
      try {
        const usersSnap = await db.collection("users").get();
        usersSnap.forEach((d: any) => {
          const u = d.data();
          userMap[d.id] = {
            username: u.username || 'unknown',
            displayName: u.displayName || u.name || u.username || 'Anonymous'
          };
        });
      } catch (e) { /* ignore */ }

      const stories: any[] = [];
      storiesSnap.forEach((d: any) => {
        const s = d.data();
        const authorUid = s.authorUid || '';
        let createdMs = 0;
        if (s.createdAt?.seconds) createdMs = s.createdAt.seconds * 1000;
        else if (typeof s.createdAtMs === 'number') createdMs = s.createdAtMs;
        else if (typeof s.createdAt === 'string') createdMs = new Date(s.createdAt).getTime() || 0;

        stories.push({
          id: d.id,
          authorUid,
          authorUsername: userMap[authorUid]?.username || 'unknown',
          authorDisplayName: userMap[authorUid]?.displayName || 'Unknown',
          caption: s.caption || s.text || '',
          mediaUrl: s.mediaUrl || s.imageUrl || '',
          audience: s.audience || 'everyone',
          likesCount: s.likesCount || (Array.isArray(s.likes) ? s.likes.length : 0) || 0,
          viewsCount: s.viewsCount || (Array.isArray(s.viewedBy) ? s.viewedBy.length : 0) || 0,
          createdAtMs: createdMs,
          status: s.status || 'active'
        });
      });

      stories.sort((a, b) => b.createdAtMs - a.createdAtMs);

      let result = stories;
      if (search) {
        result = stories.filter((s) =>
          s.authorUsername.toLowerCase().includes(search) ||
          s.authorDisplayName.toLowerCase().includes(search) ||
          String(s.caption).toLowerCase().includes(search) ||
          s.id.toLowerCase().includes(search)
        );
      }

      res.json({ success: true, stories: result.slice(0, 300), total: stories.length });
    } catch (err: any) {
      console.error("Error in GET /api/admin/stories:", err);
      res.status(500).json({ error: err?.message || "Failed to fetch stories" });
    }
  });

  // Delete a story (content moderation) — audit logged
  server.post("/api/admin/stories/:storyId/delete", adminAuthGuard(), requirePermission("content.delete"), async (req, res) => {
    try {
      const { storyId } = req.params;
      const { note } = (req.body || {}) as { note?: string };
      const caller = (req as any).adminSession;
      const ip = clientIp(req as any);

      const storyRef = db.collection("stories").doc(storyId);
      const storySnap = await storyRef.get();
      if (!storySnap.exists) {
        return res.status(404).json({ error: "Story not found" });
      }

      const storyData = storySnap.data();

      // Hard-delete the story document
      await storyRef.delete();

      await createAuditLog(db, {
        userId: caller.claims.uid,
        targetUserId: storyData?.authorUid || 'unknown',
        timestamp: new Date().toISOString(),
        timestampMs: Date.now(),
        deviceId: 'admin_desktop',
        ipHash: 'admin_ip',
        eventType: 'fraud_check',
        verificationStatus: 'PASSED',
        reason: `Admin deleted story ${storyId}.${note ? ' Note: ' + note : ''}`
      });

      await writeAdminAudit({
        adminId: caller.claims.uid, adminEmail: caller.email,
        action: "content.delete_story", targetType: "story", targetId: storyId,
        oldValue: { authorUid: storyData?.authorUid || null, caption: String(storyData?.caption || "").slice(0, 200) },
        newValue: { deleted: true },
        ipAddress: ip, note
      });

      res.json({ success: true, message: `Story ${storyId} deleted successfully.` });
    } catch (err: any) {
      console.error("Error in POST /api/admin/stories/:storyId/delete:", err);
      res.status(500).json({ error: err?.message || "Failed to delete story" });
    }
  });

  // 12. Direct Push Notification Test Endpoint
  server.post("/api/test-push", async (req, res) => {
    try {
      const { targetUid } = req.body;
      if (!targetUid) return res.status(400).json({ error: "targetUid is required" });

      const userSnap = await db.collection("users").doc(targetUid).get();
      if (!userSnap.exists) return res.status(404).json({ error: "User not found" });

      const userData = userSnap.data();
      const fcmTokens: string[] = Array.isArray(userData?.fcmTokens) ? userData.fcmTokens : [];
      if (fcmTokens.length === 0) return res.status(400).json({ error: "No FCM tokens registered for this user" });

      const response = await adminMessaging.sendEachForMulticast({
        tokens: fcmTokens,
        notification: {
          title: "Test Connection! 🚀",
          body: "This is a direct test message from your app server.",
          image: "https://res.cloudinary.com/dpvpnwhm4/image/upload/v1785045725/Anvio_Talk_logo_ofe2a0.png"
        },
        android: {
          priority: "high",
          notification: {
            channelId: "social_activity",
            priority: "high"
          }
        }
      });

      res.json({ success: true, message: `Attempted to send to ${fcmTokens.length} tokens`, results: response });
    } catch (err: any) {
      console.error("Error in POST /api/test-push:", err);
      res.status(500).json({ error: err?.message || "Failed to send test push" });
    }
  });

  const shareRoutes = ["/profile/:username", "/creator/:username", "/group/:groupId", "/invite/:groupId", "/story/:storyId", "/image/:storyId"];

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: false,
        watch: null,
      },
      appType: "custom",
    });
    server.use(vite.middlewares);
    
    server.get(shareRoutes, async (req, res, next) => {
      try {
        const template = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf-8");
        let html = await vite.transformIndexHtml(req.originalUrl, template);
        html = await resolveAndInjectMetaTags(html, req);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });

    server.use("*", async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
        template = await resolveAndInjectMetaTags(template, req);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    server.use(express.static(distPath));

    server.get(shareRoutes, async (req, res, next) => {
      try {
        let html = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");
        html = await resolveAndInjectMetaTags(html, req);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (e) {
        next(e);
      }
    });

    server.get("*", async (req, res, next) => {
      try {
        let html = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");
        html = await resolveAndInjectMetaTags(html, req);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (e) {
        next(e);
      }
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
