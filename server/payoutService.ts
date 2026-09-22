export const MIN_PAYOUT_USD = 100; // Minimum YouTube-style payout threshold ($100 USD)
export const USD_TO_INR_RATE = Number(process.env.USD_TO_INR_RATE) || 83.50; // Dynamic USD to INR conversion rate via env
export const INR_PER_1000_AD_IMPRESSIONS = 80; // ₹80 per 1000 verified ad impressions — final target rate
export const USD_PER_1000_AD_IMPRESSIONS = INR_PER_1000_AD_IMPRESSIONS / USD_TO_INR_RATE;
export const INR_PER_1000_VIEWS = 40; // ₹40 per 1000 verified views (video / photo / story / profile)
export const USD_PER_1000_VIEWS = INR_PER_1000_VIEWS / USD_TO_INR_RATE;
export const USD_PER_CHAT = 0.50; // Earn $0.50 per unique active chat conversation
export const USD_PER_STORY_DAY = 1.00; // Earn $1.00 per day with a story upload
export const MAX_MONTHLY_PAYOUT_USD = 500.00; // Capped max monthly payout per creator

export interface BankUpiPaymentMethod {
  type: 'bank_upi';
  upiId: string;
  accountHolderName: string;
  bankAccountNumber: string;
  ifscCode: string;
  bankName: string;
  isVerified?: boolean;
  updatedAt?: string;
}

export interface PayoutRecord {
  id?: string;
  creatorId: string;
  monthKey: string;
  amountUsd: number;
  amountInrApprox: number;
  paymentMethodSnapshot: BankUpiPaymentMethod;
  status: 'requested' | 'processing' | 'paid' | 'rejected';
  requestedAt: string;
  processedAt?: string;
  processedBy?: string;
  transactionReference?: string;
  adminNote?: string;
  manuallyReviewed?: boolean;
}

/**
 * Calculate ad impressions for creator in given monthKey using Firebase Admin Firestore
 */
export async function getVerifiedAdImpressionsCount(
  db: any, 
  creatorId: string, 
  monthKey: string,
  minTimestampMs?: number
): Promise<number> {
  try {
    const snap = await db.collection("ad_impressions")
      .where("creatorId", "==", creatorId)
      .where("monthKey", "==", monthKey)
      .get();
    
    if (typeof minTimestampMs === 'number' && minTimestampMs > 0) {
      let count = 0;
      snap.forEach((doc: any) => {
        const d = doc.data();
        const tMs = typeof d.timestampMs === 'number' 
          ? d.timestampMs 
          : (d.timestampIso ? new Date(d.timestampIso).getTime() : 0);
        if (tMs >= minTimestampMs) {
          count++;
        }
      });
      return count;
    }

    return snap.size;
  } catch (err) {
    // Fallback: Read cached adImpressionsCount from user's monetization status doc
    try {
      const statusSnap = await db.collection("users").doc(creatorId).collection("monetization").doc("status").get();
      if (statusSnap.exists) {
        const sData = statusSnap.data();
        if (typeof sData?.adImpressionsCount === 'number') {
          return sData.adImpressionsCount;
        }
      }
    } catch (fallbackErr) {
      // Ignore fallback error
    }
    return 0;
  }
}

/**
 * Record verified ad impression using Firebase Admin Firestore
 */
export async function recordVerifiedAdImpression(
  db: any,
  creatorId: string,
  viewerUid: string,
  placement: string
): Promise<{ success: boolean; reason: string }> {
  if (!creatorId || !viewerUid || viewerUid === 'guest' || viewerUid === 'anonymous' || viewerUid === creatorId) {
    return { success: false, reason: 'Invalid viewer or self impression excluded.' };
  }

  const nowMs = Date.now();
  const twentyFourHoursAgoMs = nowMs - (24 * 60 * 60 * 1000);
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const monthKey = `${year}-${month}`;

  try {
    const existingSnap = await db.collection("ad_impressions")
      .where("creatorId", "==", creatorId)
      .where("viewerUid", "==", viewerUid)
      .where("timestampMs", ">=", twentyFourHoursAgoMs)
      .get();

    if (!existingSnap.empty) {
      return { success: false, reason: 'Ad impression already recorded within 24 hours.' };
    }

    const newDocRef = db.collection("ad_impressions").doc();
    const impressionData = {
      creatorId,
      viewerUid,
      placement,
      monthKey,
      timestampMs: nowMs,
      timestampIso: new Date().toISOString(),
      verificationStatus: 'PASSED'
    };
    await newDocRef.set(impressionData);

    // Update creator's status document counter
    try {
      const statusRef = db.collection("users").doc(creatorId).collection("monetization").doc("status");
      const statusSnap = await statusRef.get();
      const currentCount = statusSnap.exists ? (statusSnap.data()?.adImpressionsCount || 0) : 0;
      await statusRef.set({
        adImpressionsCount: currentCount + 1,
        updatedAtIso: new Date().toISOString()
      }, { merge: true });
    } catch (e) {
      // Ignore status doc sync errors
    }

    return { success: true, reason: 'Verified ad impression recorded.' };
  } catch (err: any) {
    console.error('[PayoutService] Error recording ad impression:', err?.message || err);
    return { success: false, reason: err?.message || 'Database write error' };
  }
}

/**
 * Request a withdrawal (manual UPI/Bank execution flow) using Firebase Admin Firestore
 */
export async function requestWithdrawal(
  db: any,
  creatorId: string,
  totalAmountUsd: number
): Promise<{ success: boolean; message: string; payoutId?: string }> {
  if (!creatorId) {
    return { success: false, message: 'Missing creatorId' };
  }

  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const monthKey = `${year}-${month}`;

  try {
    // 1. Fetch Creator's Saved Payment Method & Status
    const statusDocRef = db.collection("users").doc(creatorId).collection("monetization").doc("status");
    const statusSnap = await statusDocRef.get();
    if (!statusSnap.exists) {
      return { success: false, message: 'Monetization status not found for this creator.' };
    }

    const statusData = statusSnap.data();
    const paymentMethod: BankUpiPaymentMethod = statusData?.paymentMethod;

    if (!paymentMethod || !paymentMethod.upiId || !paymentMethod.accountHolderName || !paymentMethod.bankAccountNumber || !paymentMethod.ifscCode) {
      return { success: false, message: 'Please complete and save your Bank & UPI payment details first.' };
    }

    // Check minimum threshold
    if (totalAmountUsd < MIN_PAYOUT_USD) {
      return { success: false, message: `Minimum withdrawal threshold is $${MIN_PAYOUT_USD}.00 USD. Your balance ($${totalAmountUsd.toFixed(2)}) will carry forward.` };
    }

    // 2. Check for duplicate pending / processing payout requests
    let hasActivePending = false;
    try {
      const existingPayoutsSnap = await db.collection("payouts")
        .where("creatorId", "==", creatorId)
        .get();
      
      existingPayoutsSnap.forEach((d: any) => {
        const data = d.data();
        if (data.status === 'requested' || data.status === 'processing') {
          hasActivePending = true;
        }
      });
    } catch (e) {
      // Check user's subcollection or payoutHistory array if main query fails
      if (Array.isArray(statusData?.payoutHistory)) {
        hasActivePending = statusData.payoutHistory.some((p: any) => p.status === 'requested' || p.status === 'processing');
      }
    }

    if (hasActivePending) {
      return { success: false, message: 'A withdrawal request is already pending or processing for your account.' };
    }

    // 3. Calculate capped USD and INR equivalent
    const amountUsd = Math.min(totalAmountUsd, MAX_MONTHLY_PAYOUT_USD);
    const amountInrApprox = Math.round(amountUsd * USD_TO_INR_RATE * 100) / 100;

    const newPayoutRef = db.collection("payouts").doc();
    const payoutData: PayoutRecord = {
      id: newPayoutRef.id,
      creatorId,
      monthKey,
      amountUsd,
      amountInrApprox,
      paymentMethodSnapshot: paymentMethod,
      status: 'requested',
      requestedAt: new Date().toISOString(),
      manuallyReviewed: !!statusData?.manuallyReviewed
    };

    // Save to main payouts collection
    try {
      await newPayoutRef.set(payoutData);
    } catch (e) {
      // Ignore root collection write error if user subcollection succeeds
    }

    // Save to user's subcollection and payoutHistory array on status doc for reliable reads
    try {
      const userPayoutRef = db.collection("users").doc(creatorId).collection("monetization").doc("status").collection("payouts").doc(newPayoutRef.id);
      await userPayoutRef.set(payoutData);

      const existingHistory = Array.isArray(statusData?.payoutHistory) ? statusData.payoutHistory : [];
      await statusDocRef.set({
        payoutHistory: [payoutData, ...existingHistory],
        updatedAtIso: new Date().toISOString()
      }, { merge: true });
    } catch (e) {
      // Ignore subcollection write error
    }

    return { 
      success: true, 
      message: `Withdrawal request for $${amountUsd.toFixed(2)} USD (≈ ₹${amountInrApprox.toLocaleString()} INR) submitted successfully.`, 
      payoutId: newPayoutRef.id 
    };
  } catch (err: any) {
    console.error('[PayoutService] Error requesting withdrawal:', err?.message || err);
    return { success: false, message: err?.message || 'Failed to submit withdrawal request.' };
  }
}

/**
 * Get Payout History for a creator using Firebase Admin Firestore
 */
export async function getCreatorPayouts(db: any, creatorId: string): Promise<PayoutRecord[]> {
  try {
    const snap = await db.collection("payouts").where("creatorId", "==", creatorId).get();
    const results: PayoutRecord[] = [];
    snap.forEach((d: any) => {
      results.push({ id: d.id, ...d.data() } as PayoutRecord);
    });
    if (results.length > 0) {
      return results.sort((a: any, b: any) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
    }
  } catch (err) {
    // Silent fallback to user subcollection & status doc
  }

  // Fallback 1: Read from user's subcollection
  try {
    const userSnap = await db.collection("users").doc(creatorId).collection("monetization").doc("status").collection("payouts").get();
    if (!userSnap.empty) {
      const results: PayoutRecord[] = [];
      userSnap.forEach((d: any) => {
        results.push({ id: d.id, ...d.data() } as PayoutRecord);
      });
      return results.sort((a: any, b: any) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
    }
  } catch (fallbackErr) {
    // Ignore
  }

  // Fallback 2: Read from status doc's payoutHistory array
  try {
    const statusSnap = await db.collection("users").doc(creatorId).collection("monetization").doc("status").get();
    if (statusSnap.exists) {
      const sData = statusSnap.data();
      if (Array.isArray(sData?.payoutHistory)) {
        return sData.payoutHistory;
      }
    }
  } catch (fallbackErr) {
    // Ignore
  }

  return [];
}
