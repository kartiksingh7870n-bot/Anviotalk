import { auth } from '../firebase';

export type MonetizationViewSource = 'profile' | 'story' | 'chat' | 'group';

/**
 * Record a verified monetizable view (profile / story / chat / group) via the authenticated
 * server API endpoint. The server enforces anti-fraud rules: 24-hour deduplication,
 * self-view exclusion, guest exclusion, and bot/auto-clicker rate limiting.
 * NOTE: Client-side writes to Firestore monetization_views are disabled for anti-fraud security.
 */
export async function recordMonetizationView(
  sourceType: MonetizationViewSource,
  creatorId: string,
  viewerUid?: string | null,
  sourceId?: string,
  watchTimeSeconds?: number,
  watchCompletionPct?: number
): Promise<{ success: boolean; reason: string }> {
  if (!creatorId) return { success: false, reason: 'creatorId missing' };

  const currentViewer = viewerUid || 'guest';

  // Rule: Self views or guest users never count
  if (currentViewer === 'guest' || currentViewer === 'anonymous') {
    return { success: false, reason: 'Guest traffic excluded.' };
  }

  if (currentViewer === creatorId || currentViewer === 'me') {
    return { success: false, reason: 'Self views excluded.' };
  }

  // Send request to server API for server-side verification & audit logging
  try {
    const token = await auth.currentUser?.getIdToken();
    const res = await fetch('/api/monetization/record-view', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        creatorId,
        viewerUid: currentViewer,
        deviceId: typeof window !== 'undefined' ? window.navigator.userAgent : 'web',
        sourceType,
        sourceId,
        watchTimeSeconds,
        watchCompletionPct
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch (err) {
    console.warn('[MonetizationView] API record view call error:', err);
  }

  return { success: false, reason: 'Server verification service unavailable' };
}

/**
 * Record a verified profile view (monetization source: 'profile').
 */
export async function recordProfileViewClient(
  creatorId: string,
  viewerUid?: string | null
): Promise<{ success: boolean; reason: string }> {
  return recordMonetizationView('profile', creatorId, viewerUid);
}
