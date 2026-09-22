import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { adminDb, adminAuth } from "./server/firebaseAdmin";
import { startPushNotificationListeners } from "./server/pushNotifications";
import { startNotificationScheduler } from "./server/schedulerService";
import {
  calculateCreatorEligibility, 
  recordVerifiedView,
  MonetizationViewSource,
  applyForMonetization, 
  runAutomatedFraudScan,
  createAuditLog
} from "./server/monetizationService";
import { recordVerifiedAdImpression, requestWithdrawal, getCreatorPayouts } from "./server/payoutService";

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

  // Initialize server-side push notification listeners using Firebase Admin SDK
  await startPushNotificationListeners();

  // Initialize background scheduler for rotating notifications (10 AM, 2 PM, 10 PM, 12 AM)
  await startNotificationScheduler();

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

  // 2. Record Verified Unique View (profile / story / chat / group) with 24h Deduplication & Anti-Fraud
  server.post("/api/monetization/record-view", verifyAuthToken, async (req, res) => {
    try {
      const authUser = (req as any).user;
      const { creatorId, viewerUid: reqViewerUid, deviceId, sourceType, sourceId } = req.body;
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
  server.get("/api/admin/reports", verifyAdminAuth, async (req, res) => {
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

  server.post("/api/admin/reports/:reportId/action", verifyAdminAuth, async (req, res) => {
    try {
      const { reportId } = req.params;
      const { action, adminNote } = req.body; // action: 'dismiss' | 'warn' | 'suspend_user' | 'delete_content'
      const authUser = (req as any).user;

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
        reviewedBy: authUser.uid,
        reviewedAt: new Date().toISOString(),
        actionTaken: action,
        adminNote: adminNote || null
      }, { merge: true });

      res.json({ success: true, message: `Report action '${action}' applied successfully.` });
    } catch (err: any) {
      console.error("Error in POST /api/admin/reports/:reportId/action:", err);
      res.status(500).json({ error: err?.message || "Failed to take action on report" });
    }
  });

  // 10. Admin Payouts Management Endpoints
  server.get("/api/admin/payouts", verifyAdminAuth, async (req, res) => {
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

  server.post("/api/admin/payouts/:payoutId/action", verifyAdminAuth, async (req, res) => {
    try {
      const { payoutId } = req.params;
      const { action, transactionReference, adminNote } = req.body; // action: 'approve' | 'mark_paid' | 'reject'
      const authUser = (req as any).user;

      const payoutDocRef = db.collection("payouts").doc(payoutId);
      const payoutSnap = await payoutDocRef.get();
      if (!payoutSnap.exists) {
        return res.status(404).json({ error: "Payout record not found" });
      }

      const payoutData = payoutSnap.data();
      const creatorId = payoutData?.creatorId;

      let newStatus = 'processing';
      if (action === 'mark_paid') newStatus = 'paid';
      if (action === 'reject') newStatus = 'rejected';

      await payoutDocRef.set({
        status: newStatus,
        processedAt: new Date().toISOString(),
        processedBy: authUser.uid,
        transactionReference: transactionReference || null,
        adminNote: adminNote || null
      }, { merge: true });

      // Mark creator as manually reviewed
      if ((action === 'mark_paid' || action === 'approve') && creatorId) {
        const statusRef = db.collection("users").doc(creatorId).collection("monetization").doc("status");
        await statusRef.set({ manuallyReviewed: true }, { merge: true });
      }

      res.json({ success: true, message: `Payout status updated to ${newStatus}` });
    } catch (err: any) {
      console.error("Error in POST /api/admin/payouts/:payoutId/action:", err);
      res.status(500).json({ error: err?.message || "Failed to update payout status" });
    }
  });

  // 11. Admin Manual Approval Endpoint for Creator Monetization
  server.get("/api/monetization/admin/creators", verifyAdminAuth, async (req, res) => {
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

  server.post("/api/monetization/admin/approve-creator", verifyAdminAuth, async (req, res) => {
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
        userId: (req as any).user.uid,
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
  server.get("/api/admin/users", verifyAdminAuth, async (req, res) => {
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
  server.post("/api/admin/users/:uid/action", verifyAdminAuth, async (req, res) => {
    try {
      const { uid } = req.params;
      const { action, note } = req.body; // action: 'suspend' | 'ban' | 'reactivate' | 'warn'
      const adminUser = (req as any).user;

      if (!uid) return res.status(400).json({ error: "uid is required" });
      if (!['suspend', 'ban', 'reactivate', 'warn'].includes(action)) {
        return res.status(400).json({ error: "Invalid action. Use suspend | ban | reactivate | warn" });
      }

      // Guard: an admin cannot moderate their own account
      if (adminUser.uid === uid) {
        return res.status(400).json({ error: "You cannot moderate your own account." });
      }

      const userDocRef = db.collection("users").doc(uid);
      const userSnap = await userDocRef.get();
      if (!userSnap.exists) {
        return res.status(404).json({ error: "User not found" });
      }

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
        userId: adminUser.uid,
        targetUserId: uid,
        timestamp: nowIso,
        timestampMs: Date.now(),
        deviceId: 'admin_console',
        ipHash: 'admin_ip',
        eventType: 'fraud_check',
        verificationStatus: action === 'warn' ? 'FLAGGED' : 'PASSED',
        reason: `Admin account action '${action}' applied.${note ? ' Note: ' + note : ''}`
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

  server.get("/api/admin/monetization-report", verifyAdminAuth, async (req, res) => {
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
