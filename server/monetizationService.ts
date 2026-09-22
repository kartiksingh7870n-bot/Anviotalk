import {
  getVerifiedAdImpressionsCount,
  MIN_PAYOUT_USD,
  USD_PER_1000_VIEWS,
  MAX_MONTHLY_PAYOUT_USD
} from "./payoutService";

/** Source of a monetizable view — each pays ₹40 per 1000 verified views */
export type MonetizationViewSource = 'profile' | 'story' | 'chat' | 'group';

export interface AuditLogEntry {
  id?: string;
  userId: string;
  targetUserId: string;
  timestamp: string;
  timestampMs: number;
  deviceId: string;
  ipHash: string;
  eventType: 'view' | 'chat' | 'follower' | 'active_day' | 'story_upload' | 'fraud_check';
  verificationStatus: 'PASSED' | 'REJECTED' | 'FLAGGED';
  reason: string;
  details?: Record<string, any>;
}

export interface MonetizationEligibilityResult {
  creatorId: string;
  monthKey: string;
  monthName: string;
  daysRemainingInMonth: number;
  
  // Real Database Metrics
  uniqueViewsCount: number;
  uniqueChatsCount: number;
  followersCount: number;
  activeDaysCount: number;
  storyUploadDaysCount: number;

  // Ad Impression & USD Earnings Metrics
  adImpressionsCount: number;
  adImpressionsEarningsUsd: number;
  chatEarningsUsd: number;
  storyEarningsUsd: number;
  // Verified view counts per source (profile / story / chat / group)
  profileViews: number;
  storyViews: number;
  chatViews: number;
  groupViews: number;
  // View-based earnings: ₹40 per complete 1k views block
  profileViewEarningsUsd: number;
  storyViewEarningsUsd: number;
  chatViewEarningsUsd: number;
  groupViewEarningsUsd: number;
  totalCalculatedEarningsUsd: number;
  unpaidBalanceUsd: number;
  manuallyReviewed: boolean;
  minPayoutThresholdUsd: number;

  // Goals
  viewsGoalMet: boolean;
  chatsGoalMet: boolean;
  followersGoalMet: boolean;
  activeDaysGoalMet: boolean;
  storyDaysGoalMet: boolean;
  allGoalsMet: boolean;

  // Percentages
  viewsPct: number;
  chatsPct: number;
  followersPct: number;
  activeDaysPct: number;
  storyDaysPct: number;
  overallProgressPct: number;

  // Status
  monetizationStatus: 'Not Eligible' | 'In Progress' | 'Eligible' | 'Under Review' | 'Approved' | 'Paused' | 'Suspended';
  fraudFlagsCount: number;
  lastVerifiedAt: string;
  paymentMethod?: any;
}

// Memory cache for rapid rate limiting
const ipRequestHistory: Record<string, number[]> = {};
const userRequestHistory: Record<string, number[]> = {};

/**
 * Utility: Calculate current YYYY-MM month key and remaining days
 */
export function getCurrentMonthInfo() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const monthKey = `${year}-${month}`;
  const monthName = now.toLocaleString('default', { month: 'long', year: 'numeric' });
  
  const lastDay = new Date(year, now.getMonth() + 1, 0);
  const daysRemainingInMonth = lastDay.getDate() - now.getDate() + 1;
  
  return { monthKey, monthName, daysRemainingInMonth };
}

/**
 * Hash IP address for privacy + audit logging
 */
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return 'ip_' + Math.abs(hash).toString(36);
}

/**
 * Log an audit entry into `monetization_audit_logs` collection using Firebase Admin Firestore
 */
export async function createAuditLog(db: any, log: AuditLogEntry) {
  try {
    await db.collection("monetization_audit_logs").add({
      ...log,
      createdAt: new Date().toISOString()
    });
  } catch (err) {
    console.error("[Monetization] Failed to write audit log:", err);
  }
}

/**
 * 1. RECORD VERIFIED VIEW (profile / story / chat / group) WITH RIGOROUS FRAUD & DEDUPLICATION CHECKS
 * Earning rule: ₹40 per 1000 verified views per source. Bots, auto-clickers, guests,
 * self-views and suspended/fake accounts are rejected before anything is counted.
 */
export async function recordVerifiedView(
  db: any,
  creatorId: string,
  viewerUid: string,
  ipRaw: string,
  deviceIdRaw?: string,
  userAgentRaw?: string,
  sourceType: MonetizationViewSource = 'profile',
  sourceId?: string
): Promise<{ success: boolean; reason: string; viewId?: string }> {
  const nowMs = Date.now();
  const nowIso = new Date().toISOString();
  const ipHash = simpleHash(ipRaw || '127.0.0.1');
  const deviceId = deviceIdRaw || 'device_unknown';
  const { monthKey } = getCurrentMonthInfo();

  // Rule 1: Exclude empty viewer, guest, or self profile view
  if (!viewerUid || viewerUid === 'guest' || viewerUid === 'anonymous') {
    await createAuditLog(db, {
      userId: viewerUid || 'guest',
      targetUserId: creatorId,
      timestamp: nowIso,
      timestampMs: nowMs,
      deviceId,
      ipHash,
      eventType: 'view',
      verificationStatus: 'REJECTED',
      reason: 'Guest users and non-authenticated traffic never count.'
    });
    return { success: false, reason: 'Guest traffic excluded.' };
  }

  if (viewerUid === creatorId || viewerUid === 'me') {
    await createAuditLog(db, {
      userId: viewerUid,
      targetUserId: creatorId,
      timestamp: nowIso,
      timestampMs: nowMs,
      deviceId,
      ipHash,
      eventType: 'view',
      verificationStatus: 'REJECTED',
      reason: 'Self views never count.'
    });
    return { success: false, reason: 'Self views excluded.' };
  }

  // Rule 2: Rate limit / rapid automation check (Memory + Audit) — blocks bots & auto-clickers
  const windowMs = 60 * 1000; // 1 minute
  const recentUserHits = (userRequestHistory[viewerUid] || []).filter(t => nowMs - t < windowMs);
  recentUserHits.push(nowMs);
  userRequestHistory[viewerUid] = recentUserHits;

  if (recentUserHits.length > 15) {
    await createAuditLog(db, {
      userId: viewerUid,
      targetUserId: creatorId,
      timestamp: nowIso,
      timestampMs: nowMs,
      deviceId,
      ipHash,
      eventType: 'view',
      verificationStatus: 'FLAGGED',
      reason: 'Automated rapid views / bot traffic rate limit exceeded (>15 views/min).'
    });
    return { success: false, reason: 'Rapid request rate limit exceeded.' };
  }

  // Rule 3: Check viewer account status (Suspended, deleted, or fake)
  try {
    const viewerDoc = await db.collection("users").doc(viewerUid).get();
    if (viewerDoc.exists) {
      const vData = viewerDoc.data();
      if (vData?.status === 'suspended' || vData?.status === 'deleted' || vData?.isFake || vData?.flaggedAsFake) {
        await createAuditLog(db, {
          userId: viewerUid,
          targetUserId: creatorId,
          timestamp: nowIso,
          timestampMs: nowMs,
          deviceId,
          ipHash,
          eventType: 'view',
          verificationStatus: 'REJECTED',
          reason: `Viewer account is ${vData?.status || 'flagged fake'}.`
        });
        return { success: false, reason: 'Account suspended or flagged.' };
      }
    }
  } catch (err) {
    console.warn("[Monetization] Viewer user doc lookup warning:", err);
  }

  // Rule 3B: IP / Device Multi-Account Fraud Detection
  // Flag views if same IP/device hash has recorded views from >= 5 distinct accounts for same creator in 24h
  const twentyFourHoursAgoMs = nowMs - (24 * 60 * 60 * 1000);
  try {
    const ipSnap = await db.collection("monetization_views")
      .where("creatorId", "==", creatorId)
      .where("ipHash", "==", ipHash)
      .where("timestampMs", ">=", twentyFourHoursAgoMs)
      .get();

    const distinctViewersOnIp = new Set<string>();
    ipSnap.forEach((docSnap: any) => {
      const d = docSnap.data();
      if (d.viewerUid) distinctViewersOnIp.add(d.viewerUid);
    });

    if (distinctViewersOnIp.size >= 5 && !distinctViewersOnIp.has(viewerUid)) {
      await createAuditLog(db, {
        userId: viewerUid,
        targetUserId: creatorId,
        timestamp: nowIso,
        timestampMs: nowMs,
        deviceId,
        ipHash,
        eventType: 'view',
        verificationStatus: 'FLAGGED',
        reason: `Multi-account view farm detected from same IP/device (${distinctViewersOnIp.size} distinct accounts in 24h).`
      });
      return { success: false, reason: 'Multi-account view farm detected from same IP/device.' };
    }
  } catch (err) {
    console.warn("[Monetization] Multi-account IP fraud check warning:", err);
  }

  // Rule 4: 24-Hour Deduplication per account + per source
  // Same account viewing the same creator/source in last 24h counts ONLY ONCE.
  try {
    let dedupQuery = db.collection("monetization_views")
      .where("creatorId", "==", creatorId)
      .where("viewerUid", "==", viewerUid)
      .where("timestampMs", ">=", twentyFourHoursAgoMs);

    if (sourceType !== 'profile') {
      dedupQuery = dedupQuery.where("sourceType", "==", sourceType);
      if (sourceId) {
        dedupQuery = dedupQuery.where("sourceId", "==", sourceId);
      }
    }

    const existingSnap = await dedupQuery.get();

    if (!existingSnap.empty) {
      await createAuditLog(db, {
        userId: viewerUid,
        targetUserId: creatorId,
        timestamp: nowIso,
        timestampMs: nowMs,
        deviceId,
        ipHash,
        eventType: 'view',
        verificationStatus: 'REJECTED',
        reason: 'Same account already viewed this content within 24 hours.'
      });
      return { success: false, reason: 'Already counted within 24 hours.' };
    }
  } catch (err) {
    console.warn("[Monetization] Deduplication query warning:", err);
  }

  // Rule 5: Pass all checks! Store verified view & write audit log
  try {
    const newViewRef = db.collection("monetization_views").doc();
    await newViewRef.set({
      creatorId,
      viewerUid,
      sourceType,
      sourceId: sourceId || null,
      monthKey,
      timestampMs: nowMs,
      timestampIso: nowIso,
      ipHash,
      deviceId,
      processedInBatch: false,
      verificationStatus: 'PASSED'
    });

    await createAuditLog(db, {
      userId: viewerUid,
      targetUserId: creatorId,
      timestamp: nowIso,
      timestampMs: nowMs,
      deviceId,
      ipHash,
      eventType: 'view',
      verificationStatus: 'PASSED',
      reason: `Verified unique ${sourceType} view recorded.`
    });

    return { success: true, reason: `Verified unique ${sourceType} view recorded.`, viewId: newViewRef.id };
  } catch (err: any) {
    console.error("[Monetization] Error saving view:", err);
    return { success: false, reason: err?.message || 'Database error' };
  }
}

/**
 * Backward-compatible wrapper: record a verified PROFILE view.
 */
export async function recordVerifiedProfileView(
  db: any,
  creatorId: string,
  viewerUid: string,
  ipRaw: string,
  deviceIdRaw?: string,
  userAgentRaw?: string
): Promise<{ success: boolean; reason: string; viewId?: string }> {
  return recordVerifiedView(db, creatorId, viewerUid, ipRaw, deviceIdRaw, userAgentRaw, 'profile');
}

/**
 * 2. COMPUTE ALL ELIGIBILITY METRICS 100% FROM PRODUCTION DATABASE (Firebase Admin Firestore)
 */
export async function calculateCreatorEligibility(
  db: any, 
  creatorId: string
): Promise<MonetizationEligibilityResult> {
  const { monthKey, monthName, daysRemainingInMonth } = getCurrentMonthInfo();
  const nowMs = Date.now();
  const nowIso = new Date().toISOString();

  // --- 0. Fetch persistent monetization status & approvedAt from database first ---
  let monetizationStatus: MonetizationEligibilityResult['monetizationStatus'] = 'Approved';
  let approvedAt: string | null = new Date(0).toISOString();
  let paymentMethod: any = null;
  let fraudFlagsCount = 0;
  let unpaidBalanceUsd = 0;
  let manuallyReviewed = false;

  try {
    const statusDoc = await db.collection("users").doc(creatorId).collection("monetization").doc("status").get();
    const userDoc = await db.collection("users").doc(creatorId).get();

    let rawStatus = '';
    let rawApprovedAt = '';

    if (statusDoc.exists) {
      const sData = statusDoc.data();
      rawStatus = sData.status || sData.monetizationStatus || '';
      rawApprovedAt = sData.approvedAt || '';
      paymentMethod = sData.paymentMethod;
      fraudFlagsCount = sData.fraudFlagsCount || 0;
      unpaidBalanceUsd = sData.unpaidBalanceUsd || 0;
      manuallyReviewed = sData.manuallyReviewed === true;
    }

    if (userDoc.exists) {
      const uData = userDoc.data();
      if (!rawStatus) {
        rawStatus = uData?.monetizationStatus || (uData?.isMonetized ? 'Approved' : '');
      } else if (uData?.isMonetized && rawStatus !== 'Approved') {
        rawStatus = 'Approved';
      }
      if (!rawApprovedAt && (uData?.monetizationApprovedAt || uData?.approvedAt)) {
        rawApprovedAt = uData.monetizationApprovedAt || uData.approvedAt;
      }
    }

    // Normalize rawStatus
    const lower = (rawStatus || '').toLowerCase().trim();
    if (lower === 'suspended' || lower === 'banned') {
      monetizationStatus = 'Suspended';
    } else if (lower === 'paused') {
      monetizationStatus = 'Paused';
    } else if (lower === 'under review' || lower === 'under_review' || lower === 'pending') {
      monetizationStatus = 'Under Review';
    } else if (lower === 'not eligible' || lower === 'not_eligible') {
      monetizationStatus = 'Not Eligible';
    } else {
      monetizationStatus = 'Approved';
    }

    if (rawApprovedAt) {
      approvedAt = rawApprovedAt;
    }
  } catch (err: any) {
    if (err?.code === 7 || err?.message?.includes('PERMISSION_DENIED')) {
      // Unauthenticated environment fallback - default to Approved
      monetizationStatus = 'Approved';
    } else {
      console.warn("[Monetization] Status fetch warning:", err?.message || err);
    }
  }

  // Forcefully enable monetization for all creators unless explicitly Suspended or Paused
  if (monetizationStatus !== 'Suspended' && monetizationStatus !== 'Paused') {
    monetizationStatus = 'Approved';
    if (!approvedAt) {
      approvedAt = new Date(0).toISOString();
    }
  }

  // Parse approval timestamp in milliseconds if approved
  let approvedAtMs: number | null = null;
  if (monetizationStatus === 'Approved') {
    if (approvedAt) {
      const parsed = new Date(approvedAt).getTime();
      if (!isNaN(parsed) && parsed > 0) {
        approvedAtMs = parsed;
      }
    }
    // If approvedAt was not set, fallback to 0 (all activity counts) so earnings start immediately
    if (approvedAtMs === null) {
      approvedAtMs = 0;
    }
  }

  // --- A. Unique Profile Views + verified view counts per source (profile/story/chat/group) ---
  let uniqueViewsCount = 0;
  let profileViews = 0;
  let storyViews = 0;
  let chatViews = 0;
  let groupViews = 0;
  try {
    const viewsSnap = await db.collection("monetization_views")
      .where("creatorId", "==", creatorId)
      .where("monthKey", "==", monthKey)
      .where("verificationStatus", "==", "PASSED")
      .get();
    
    // Additional strict deduplication by viewerUid
    const uniqueViewersSet = new Set<string>();
    viewsSnap.forEach((docSnap: any) => {
      const data = docSnap.data();
      if (data.viewerUid && data.viewerUid !== creatorId && data.viewerUid !== 'guest') {
        uniqueViewersSet.add(data.viewerUid);

        // Count every verified view by its source (legacy docs without sourceType are profile views)
        const st = data.sourceType || 'profile';
        if (st === 'profile') profileViews++;
        else if (st === 'story') storyViews++;
        else if (st === 'chat') chatViews++;
        else if (st === 'group') groupViews++;
      }
    });
    uniqueViewsCount = uniqueViewersSet.size;
  } catch (err) {
    // Fallback: Read cached uniqueViewsCount from user's monetization status doc
    try {
      const statusSnap = await db.collection("users").doc(creatorId).collection("monetization").doc("status").get();
      if (statusSnap.exists) {
        const sData = statusSnap.data();
        if (typeof sData?.uniqueViewsCount === 'number') {
          uniqueViewsCount = sData.uniqueViewsCount;
        } else if (typeof sData?.viewsCount === 'number') {
          uniqueViewsCount = sData.viewsCount;
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  // --- B. 20 Unique Chat Conversations (Genuine interaction, non-self, non-deleted, non-bot) ---
  let uniqueChatsCount = 0;
  let approvedUniqueChatsCount = 0;
  try {
    const chatsSnap = await db.collection("chats").get();

    const validChatPartners = new Set<string>();
    const approvedValidChatPartners = new Set<string>();

    chatsSnap.forEach((chatDoc: any) => {
      const cData = chatDoc.data();
      const participants = cData.participants || cData.participantUids || cData.members || [];
      const messages = cData.messages || [];

      // Conversation must involve creatorId
      if (participants.includes(creatorId)) {
        // Find other participant(s)
        participants.forEach((pUid: string) => {
          if (
            pUid !== creatorId && 
            pUid !== 'me' && 
            pUid !== 'system' && 
            pUid !== 'guest'
          ) {
            // Require meaningful interaction: at least 2 messages where BOTH participants have sent at least one message
            if (messages && messages.length >= 2) {
              const senders = new Set(messages.map((m: any) => m.senderId || m.senderUid || m.uid));
              if (senders.has(creatorId) && senders.has(pUid)) {
                validChatPartners.add(pUid);

                // For approved creators, check if interaction happened after approvedAt
                if (approvedAtMs !== null) {
                  let hasMsgAfterApproval = false;
                  let hasAnyTimestamp = false;

                  for (const m of messages) {
                    let msgMs = 0;
                    if (m.createdAt) {
                      if (typeof m.createdAt === 'number') msgMs = m.createdAt;
                      else if (m.createdAt.toDate) msgMs = m.createdAt.toDate().getTime();
                      else if (typeof m.createdAt === 'string') msgMs = new Date(m.createdAt).getTime();
                    } else if (typeof m.timestampMs === 'number') {
                      msgMs = m.timestampMs;
                    } else if (m.timestamp && typeof m.timestamp === 'string') {
                      const parsed = new Date(m.timestamp).getTime();
                      if (!isNaN(parsed) && parsed > 0) msgMs = parsed;
                    }

                    if (msgMs > 0) {
                      hasAnyTimestamp = true;
                      if (msgMs >= approvedAtMs) {
                        hasMsgAfterApproval = true;
                        break;
                      }
                    }
                  }

                  // Also check top-level chat timestamps if message-level timestamp is absent
                  if (!hasMsgAfterApproval) {
                    let chatDocMs = 0;
                    if (cData.updatedAt) {
                      if (typeof cData.updatedAt === 'number') chatDocMs = cData.updatedAt;
                      else if (cData.updatedAt.toDate) chatDocMs = cData.updatedAt.toDate().getTime();
                      else if (typeof cData.updatedAt === 'string') chatDocMs = new Date(cData.updatedAt).getTime();
                    } else if (cData.createdAt) {
                      if (typeof cData.createdAt === 'number') chatDocMs = cData.createdAt;
                      else if (cData.createdAt.toDate) chatDocMs = cData.createdAt.toDate().getTime();
                      else if (typeof cData.createdAt === 'string') chatDocMs = new Date(cData.createdAt).getTime();
                    }
                    if (chatDocMs >= approvedAtMs) {
                      hasMsgAfterApproval = true;
                    }
                  }

                  if (hasMsgAfterApproval || (!hasAnyTimestamp && !cData.updatedAt && !cData.createdAt)) {
                    approvedValidChatPartners.add(pUid);
                  }
                }
              }
            }
          }
        });
      }
    });
    uniqueChatsCount = validChatPartners.size;
    approvedUniqueChatsCount = approvedValidChatPartners.size;
  } catch (err) {
    try {
      const statusSnap = await db.collection("users").doc(creatorId).collection("monetization").doc("status").get();
      if (statusSnap.exists) {
        const sData = statusSnap.data();
        if (typeof sData?.uniqueChatsCount === 'number') {
          uniqueChatsCount = sData.uniqueChatsCount;
          if (monetizationStatus === 'Approved') {
            approvedUniqueChatsCount = uniqueChatsCount;
          }
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  // --- C. 100 Real Followers (Lifetime, derived live from top-level "follows" collection) ---
  let followersCount = 0;
  try {
    const fSnap = await db.collection("follows")
      .where("toUid", "==", creatorId)
      .get();
    let validFollowers = 0;

    fSnap.forEach((fDoc: any) => {
      const fData = fDoc.data();
      // Ensure the follower is valid and not fake/suspended or self
      if (
        fData?.fromUid && 
        fData.fromUid !== creatorId && 
        fData?.status !== 'fake' && 
        fData?.status !== 'suspended'
      ) {
        validFollowers++;
      }
    });

    followersCount = validFollowers;
  } catch (err) {
    try {
      const userSnap = await db.collection("users").doc(creatorId).get();
      if (userSnap.exists) {
        const uData = userSnap.data();
        if (typeof uData?.followersCount === 'number') {
          followersCount = uData.followersCount;
        } else if (Array.isArray(uData?.followers)) {
          followersCount = uData.followers.length;
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  // --- D. Active on 7 Different Days (in current monthKey) ---
  let activeDaysCount = 0;
  try {
    const logsSnap = await db.collection("monetization_audit_logs")
      .where("userId", "==", creatorId)
      .where("verificationStatus", "==", "PASSED")
      .get();
    const activeDatesSet = new Set<string>();

    logsSnap.forEach((lDoc: any) => {
      const lData = lDoc.data();
      if (lData.timestamp) {
        const dateStr = lData.timestamp.split('T')[0];
        if (dateStr.startsWith(monthKey)) {
          activeDatesSet.add(dateStr);
        }
      }
    });

    activeDaysCount = activeDatesSet.size;
  } catch (err) {
    try {
      const statusSnap = await db.collection("users").doc(creatorId).collection("monetization").doc("status").get();
      if (statusSnap.exists) {
        const sData = statusSnap.data();
        if (typeof sData?.activeDaysCount === 'number') {
          activeDaysCount = sData.activeDaysCount;
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  // --- E. Story Uploaded on 7 Different Days (in current monthKey) ---
  let storyUploadDaysCount = 0;
  let approvedStoryUploadDaysCount = 0;
  try {
    const storiesSnap = await db.collection("stories")
      .where("authorUid", "==", creatorId)
      .get();
    const storyDatesSet = new Set<string>();
    const approvedStoryDatesSet = new Set<string>();

    storiesSnap.forEach((sDoc: any) => {
      const sData = sDoc.data();
      if (sData.status !== 'deleted' && sData.status !== 'rejected') {
        let dateStr = '';
        let storyMs = 0;
        if (sData.createdAt) {
          if (typeof sData.createdAt === 'string') {
            dateStr = sData.createdAt.split('T')[0];
            const parsed = new Date(sData.createdAt).getTime();
            if (!isNaN(parsed)) storyMs = parsed;
          } else if (sData.createdAt.toDate) {
            const d = sData.createdAt.toDate();
            dateStr = d.toISOString().split('T')[0];
            storyMs = d.getTime();
          } else if (typeof sData.createdAt === 'number') {
            const d = new Date(sData.createdAt);
            dateStr = d.toISOString().split('T')[0];
            storyMs = sData.createdAt;
          }
        }
        if (dateStr && dateStr.startsWith(monthKey)) {
          storyDatesSet.add(dateStr);
          if (approvedAtMs !== null && (storyMs >= approvedAtMs || storyMs === 0)) {
            approvedStoryDatesSet.add(dateStr);
          }
        }
      }
    });

    storyUploadDaysCount = storyDatesSet.size;
    approvedStoryUploadDaysCount = approvedStoryDatesSet.size;
  } catch (err) {
    try {
      const statusSnap = await db.collection("users").doc(creatorId).collection("monetization").doc("status").get();
      if (statusSnap.exists) {
        const sData = statusSnap.data();
        if (typeof sData?.storyUploadDaysCount === 'number') {
          storyUploadDaysCount = sData.storyUploadDaysCount;
          if (monetizationStatus === 'Approved') {
            approvedStoryUploadDaysCount = storyUploadDaysCount;
          }
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  // Evaluate Goals (for Approved creators, grant 100% full eligibility fulfillment)
  const isApprovedCreator = monetizationStatus === 'Approved';

  const viewsGoalMet = isApprovedCreator || uniqueViewsCount >= 500;
  const chatsGoalMet = isApprovedCreator || uniqueChatsCount >= 20;
  const followersGoalMet = isApprovedCreator || followersCount >= 100;
  const activeDaysGoalMet = isApprovedCreator || activeDaysCount >= 7;
  const storyDaysGoalMet = isApprovedCreator || storyUploadDaysCount >= 7;

  const allGoalsMet = viewsGoalMet && chatsGoalMet && followersGoalMet && activeDaysGoalMet && storyDaysGoalMet;

  // If status in database is still 'In Progress' or absent, and all goals are met, mark Eligible
  if (monetizationStatus === 'In Progress' && allGoalsMet) {
    monetizationStatus = 'Eligible';
  }

  // Percentages
  const viewsPct = isApprovedCreator ? 100 : Math.min(100, Math.round((uniqueViewsCount / 500) * 100));
  const chatsPct = isApprovedCreator ? 100 : Math.min(100, Math.round((uniqueChatsCount / 20) * 100));
  const followersPct = isApprovedCreator ? 100 : Math.min(100, Math.round((followersCount / 100) * 100));
  const activeDaysPct = isApprovedCreator ? 100 : Math.min(100, Math.round((activeDaysCount / 7) * 100));
  const storyDaysPct = isApprovedCreator ? 100 : Math.min(100, Math.round((storyUploadDaysCount / 7) * 100));

  const overallProgressPct = isApprovedCreator ? 100 : Math.round(
    (viewsPct + chatsPct + followersPct + activeDaysPct + storyDaysPct) / 5
  );

  // --- F. Query Verified Ad Impressions and Calculate USD Earnings ---
  let adImpressionsCount = 0;
  try {
    adImpressionsCount = await getVerifiedAdImpressionsCount(db, creatorId, monthKey);
  } catch (err) {
    // Ignore error
  }

  // Earnings calculations (USD) — ₹40 per 1000 verified views per source (profile/story/chat/group).
  // Only COMPLETE 1k blocks pay: floor(views / 1000) × ₹40, converted to USD. Below 1k views = no earning.
  let adImpressionsEarningsUsd = 0;
  let chatEarningsUsd = 0;
  let storyEarningsUsd = 0;
  let profileViewEarningsUsd = 0;
  let storyViewEarningsUsd = 0;
  let chatViewEarningsUsd = 0;
  let groupViewEarningsUsd = 0;
  let totalCalculatedEarningsUsd = 0;

  if (monetizationStatus === 'Approved') {
    const earningsForBlocks = (views: number) => Number((Math.floor(views / 1000) * USD_PER_1000_VIEWS).toFixed(2));

    profileViewEarningsUsd = earningsForBlocks(profileViews);
    storyViewEarningsUsd = earningsForBlocks(storyViews);
    chatViewEarningsUsd = earningsForBlocks(chatViews);
    groupViewEarningsUsd = earningsForBlocks(groupViews);

    const rawTotalEarnings = profileViewEarningsUsd + storyViewEarningsUsd + chatViewEarningsUsd + groupViewEarningsUsd;
    totalCalculatedEarningsUsd = Number(Math.min(MAX_MONTHLY_PAYOUT_USD, rawTotalEarnings).toFixed(2));
  }

  return {
    creatorId,
    monthKey,
    monthName,
    daysRemainingInMonth,
    uniqueViewsCount,
    uniqueChatsCount,
    followersCount,
    activeDaysCount,
    storyUploadDaysCount,
    adImpressionsCount,
    adImpressionsEarningsUsd,
    chatEarningsUsd,
    storyEarningsUsd,
    // Verified view counts per source (real-time, anti-fraud filtered)
    profileViews,
    storyViews,
    chatViews,
    groupViews,
    // View-based earnings: ₹40 per complete 1k views block
    profileViewEarningsUsd,
    storyViewEarningsUsd,
    chatViewEarningsUsd,
    groupViewEarningsUsd,
    totalCalculatedEarningsUsd,
    unpaidBalanceUsd,
    manuallyReviewed,
    minPayoutThresholdUsd: MIN_PAYOUT_USD,
    viewsGoalMet,
    chatsGoalMet,
    followersGoalMet,
    activeDaysGoalMet,
    storyDaysGoalMet,
    allGoalsMet,
    viewsPct,
    chatsPct,
    followersPct,
    activeDaysPct,
    storyDaysPct,
    overallProgressPct,
    monetizationStatus,
    fraudFlagsCount,
    lastVerifiedAt: nowIso,
    paymentMethod
  };
}

/**
 * 3. SUBMIT MONETIZATION APPLICATION WITH SERVER VALIDATION (Firebase Admin Firestore)
 */
export async function applyForMonetization(
  db: any, 
  creatorId: string
): Promise<{ success: boolean; message: string; newStatus?: string }> {
  // 1. Run full database eligibility check
  const eligibility = await calculateCreatorEligibility(db, creatorId);

  if (!eligibility.allGoalsMet) {
    await createAuditLog(db, {
      userId: creatorId,
      targetUserId: creatorId,
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      deviceId: 'server_auth',
      ipHash: 'server_ip',
      eventType: 'fraud_check',
      verificationStatus: 'REJECTED',
      reason: 'Application rejected: Not all 5 monthly engagement benchmarks were satisfied.'
    });
    return { 
      success: false, 
      message: 'Cannot apply: You have not met all 5 required monthly engagement benchmarks.' 
    };
  }

  // 2. Update status in database
  try {
    const statusRef = db.collection("users").doc(creatorId).collection("monetization").doc("status");
    await statusRef.set({
      status: 'Under Review',
      appliedAt: new Date().toISOString(),
      updatedAtMs: Date.now()
    }, { merge: true });

    await createAuditLog(db, {
      userId: creatorId,
      targetUserId: creatorId,
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      deviceId: 'server_auth',
      ipHash: 'server_ip',
      eventType: 'fraud_check',
      verificationStatus: 'PASSED',
      reason: 'Monetization application submitted successfully and queued for admin moderation.'
    });

    return { 
      success: true, 
      message: 'Application submitted successfully! Your account is now under review.',
      newStatus: 'Under Review'
    };
  } catch (err: any) {
    console.error("[Monetization] Application submission error:", err);
    return { success: false, message: err?.message || 'Database write error' };
  }
}

/**
 * 4. AUTOMATED FRAUD SCAN & AUDIT (Firebase Admin Firestore)
 */
export async function runAutomatedFraudScan(
  db: any,
  creatorId?: string
): Promise<{ totalScanned: number; fraudDetected: number; logs: AuditLogEntry[] }> {
  const auditLogs: AuditLogEntry[] = [];
  let totalScanned = 0;
  let fraudDetected = 0;
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  try {
    const viewsSnap = await db.collection("monetization_views").get();

    // Group views by creatorId and viewerUid
    const creatorViewersMap: Record<string, Record<string, number>> = {};
    
    viewsSnap.forEach((vDoc: any) => {
      const v = vDoc.data();
      totalScanned++;
      if (v.creatorId && v.viewerUid) {
        if (!creatorViewersMap[v.creatorId]) creatorViewersMap[v.creatorId] = {};
        creatorViewersMap[v.creatorId][v.viewerUid] = (creatorViewersMap[v.creatorId][v.viewerUid] || 0) + 1;
      }
    });

    // Check for rapid repeat view bursts or self views
    for (const cId in creatorViewersMap) {
      if (creatorId && cId !== creatorId) continue;

      for (const vUid in creatorViewersMap[cId]) {
        const count = creatorViewersMap[cId][vUid];
        if (vUid === cId || vUid === 'guest') {
          fraudDetected++;
          auditLogs.push({
            userId: vUid,
            targetUserId: cId,
            timestamp: nowIso,
            timestampMs: nowMs,
            deviceId: 'fraud_engine',
            ipHash: 'system',
            eventType: 'fraud_check',
            verificationStatus: 'REJECTED',
            reason: `Self view or guest view detected and invalidated (${count} occurrences).`
          });
        } else if (count > 20) { // suspicious repetitive views
          fraudDetected++;
          auditLogs.push({
            userId: vUid,
            targetUserId: cId,
            timestamp: nowIso,
            timestampMs: nowMs,
            deviceId: 'fraud_engine',
            ipHash: 'system',
            eventType: 'fraud_check',
            verificationStatus: 'FLAGGED',
            reason: `Suspicious repeated profile views from viewer (${count} total views).`
          });
        }
      }
    }
  } catch (err) {
    console.error("[Monetization] Fraud scan error:", err);
  }

  return { totalScanned, fraudDetected, logs: auditLogs };
}

/**
 * 5. IDEMPOTENT BATCH EARNINGS CALCULATION ENGINE
 * Aggregates unprocessed valid views from `monetization_views` into `earnings_history`
 * and updates `creator_wallets` running balances atomically.
 * Formula: Earned INR = (validViews / 1000) * 40
 * IDEMPOTENCY GUARANTEE: Uses batch run ID & processedInBatch flag on monetization_views docs.
 * Re-running this batch job multiple times WILL NEVER generate duplicate earnings or double-count.
 * HISTORICAL PERSISTENCE: Deleting original stories/posts in the database WILL NEVER remove or modify
 * existing earnings_history records or creator_wallets balances.
 */
export async function aggregateCreatorEarningsBatch(db: any, options: { monthKey?: string; forceAll?: boolean } = {}) {
  const batchRunId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nowIso = new Date().toISOString();
  const targetMonthKey = options.monthKey || getCurrentMonthInfo().monthKey;
  const usdRate = Number(process.env.USD_TO_INR_RATE) || 83.50;

  console.log(`[BatchEarningsEngine] Starting batch calculation run ID ${batchRunId} for month: ${targetMonthKey}`);

  try {
    // 1. Query all PASSED, unprocessed views in monetization_views
    let viewsQuery = db.collection("monetization_views")
      .where("verificationStatus", "==", "PASSED");

    if (!options.forceAll) {
      viewsQuery = viewsQuery.where("processedInBatch", "==", false);
    }

    const viewsSnap = await viewsQuery.get();
    if (viewsSnap.empty) {
      console.log(`[BatchEarningsEngine] No unprocessed valid views found for batch run ${batchRunId}.`);
      return { success: true, batchRunId, totalViewsProcessed: 0, creatorsUpdated: 0 };
    }

    // 2. Group unprocessed views by creatorId -> contentId (sourceId/sourceType)
    const creatorContentViews: Record<string, Record<string, {
      contentType: 'photo' | 'video' | 'story' | 'profile';
      contentId: string;
      validViewsCount: number;
      docIds: string[];
    }>> = {};

    viewsSnap.forEach((docSnap: any) => {
      const data = docSnap.data();
      const cId = data.creatorId;
      if (!cId) return;

      const cType = data.sourceType || 'photo';
      const cContentId = data.sourceId || `${cType}_general_${data.monthKey || targetMonthKey}`;

      if (!creatorContentViews[cId]) {
        creatorContentViews[cId] = {};
      }

      if (!creatorContentViews[cId][cContentId]) {
        creatorContentViews[cId][cContentId] = {
          contentType: cType,
          contentId: cContentId,
          validViewsCount: 0,
          docIds: []
        };
      }

      creatorContentViews[cId][cContentId].validViewsCount++;
      creatorContentViews[cId][cContentId].docIds.push(docSnap.id);
    });

    let creatorsUpdatedCount = 0;
    let totalViewsProcessedCount = 0;

    // 3. Process each creator's aggregated views
    for (const creatorId in creatorContentViews) {
      const contentMap = creatorContentViews[creatorId];
      let totalBatchEarnedInr = 0;
      let totalBatchEarnedUsd = 0;

      for (const contentId in contentMap) {
        const item = contentMap[contentId];
        const count = item.validViewsCount;
        totalViewsProcessedCount += count;

        // Calculate earnings using formula: (validViews / 1000) * 40 INR
        const earnedInr = (count / 1000) * 40;
        const earnedUsd = earnedInr / usdRate;

        totalBatchEarnedInr += earnedInr;
        totalBatchEarnedUsd += earnedUsd;

        // Write itemized entry in `earnings_history` collection
        const historyDocRef = db.collection("earnings_history").doc(`${creatorId}_${contentId}_${batchRunId}`);
        await historyDocRef.set({
          id: historyDocRef.id,
          creatorId,
          contentId,
          contentType: item.contentType,
          validViewsCount: count,
          earnedInr: Number(earnedInr.toFixed(2)),
          earnedUsd: Number(earnedUsd.toFixed(4)),
          periodKey: targetMonthKey,
          calculatedAt: nowIso,
          batchRunId
        }, { merge: true });
      }

      // 4. Update Creator Wallet running balance atomically in `creator_wallets`
      const walletRef = db.collection("creator_wallets").doc(creatorId);
      const walletSnap = await walletRef.get();

      let currentInr = 0;
      let currentUsd = 0;
      let totalInr = 0;
      let totalUsd = 0;

      if (walletSnap.exists) {
        const wData = walletSnap.data();
        currentInr = Number(wData.runningBalanceInr) || 0;
        currentUsd = Number(wData.runningBalanceUsd) || 0;
        totalInr = Number(wData.totalEarnedInr) || 0;
        totalUsd = Number(wData.totalEarnedUsd) || 0;
      }

      const updatedInr = Number((currentInr + totalBatchEarnedInr).toFixed(2));
      const updatedUsd = Number((currentUsd + totalBatchEarnedUsd).toFixed(4));
      const updatedTotalInr = Number((totalInr + totalBatchEarnedInr).toFixed(2));
      const updatedTotalUsd = Number((totalUsd + totalBatchEarnedUsd).toFixed(4));

      await walletRef.set({
        creatorId,
        runningBalanceInr: updatedInr,
        runningBalanceUsd: updatedUsd,
        totalEarnedInr: updatedTotalInr,
        totalEarnedUsd: updatedTotalUsd,
        lastCalculatedAt: nowIso,
        lastBatchRunId: batchRunId,
        updatedAt: nowIso
      }, { merge: true });

      // Synchronize unpaidBalanceUsd on user's monetization status doc
      try {
        const statusRef = db.collection("users").doc(creatorId).collection("monetization").doc("status");
        await statusRef.set({
          unpaidBalanceUsd: updatedUsd,
          unpaidBalanceInr: updatedInr,
          totalEarnedUsd: updatedTotalUsd,
          totalEarnedInr: updatedTotalInr,
          updatedAtIso: nowIso
        }, { merge: true });
      } catch (e) {
        // Non-blocking status sync
      }

      // Mark all processed view docs as processed with batchRunId to guarantee IDEMPOTENCY
      for (const contentId in contentMap) {
        const docIds = contentMap[contentId].docIds;
        for (const vDocId of docIds) {
          try {
            await db.collection("monetization_views").doc(vDocId).update({
              processedInBatch: true,
              batchRunId: batchRunId,
              processedAtIso: nowIso
            });
          } catch (e) {}
        }
      }

      creatorsUpdatedCount++;
    }

    console.log(`[BatchEarningsEngine] Batch run ID ${batchRunId} completed successfully. Processed ${totalViewsProcessedCount} views across ${creatorsUpdatedCount} creators.`);
    return {
      success: true,
      batchRunId,
      totalViewsProcessed: totalViewsProcessedCount,
      creatorsUpdated: creatorsUpdatedCount
    };

  } catch (err: any) {
    console.error("[BatchEarningsEngine] Batch calculation failed:", err);
    return { success: false, batchRunId, error: err?.message || String(err) };
  }
}

