import { db } from '../firebase';
import { 
  collection, doc, addDoc, getDocs, getDoc, updateDoc, query, where, 
  serverTimestamp, increment, limit, orderBy 
} from 'firebase/firestore';
import { Creator, Story, ChatThread } from '../data';
import { getUserAvatar } from './avatar';

// Distance parser helper (converts distance string like "2.4 miles", "10 km" or "Nearby" to miles)
export function parseDistanceInMiles(distanceStr?: string): number {
  if (!distanceStr) return 5;
  try {
    const str = String(distanceStr).toLowerCase();
    if (str.includes('nearby') || str.includes('here')) return 1;
    const match = str.match(/([\d.]+)/);
    if (!match) return 5;
    const num = parseFloat(match[1]);
    if (isNaN(num)) return 5;
    if (str.includes('km')) return num * 0.621371;
    return num;
  } catch (e) {
    return 5;
  }
}

// Calculate tag affinity map from viewer's past liked creators
export function buildLikedTagsMap(likedCreators: Creator[]): Record<string, number> {
  const tagFreq: Record<string, number> = {};
  if (!likedCreators || !Array.isArray(likedCreators)) return tagFreq;

  likedCreators.forEach(creator => {
    try {
      if (creator && Array.isArray(creator.skillTags)) {
        creator.skillTags.forEach(tag => {
          if (tag) {
            tagFreq[tag] = (tagFreq[tag] || 0) + 1;
          }
        });
      }
    } catch (e) {}
  });
  return tagFreq;
}

export interface CandidateScoreResult {
  candidate: Creator;
  score: number;
  breakdown: {
    distanceScore: number;
    interestOverlapScore: number;
    recencyScore: number;
    mutualScore: number;
    newUserBoost: number;
    personalizationScore: number;
  };
}

/**
 * Calculates a candidate's discovery score relative to the viewer.
 */
export function calculateCandidateScore(
  candidate: Creator,
  viewerProfile: any,
  likedTagsMap: Record<string, number>,
  viewerPastLikesCount: number,
  followingIds: string[] = []
): CandidateScoreResult {
  try {
    if (!candidate) throw new Error("Null candidate");

    // 1. Distance Decay Score (Max ~100)
    const distMiles = parseDistanceInMiles(candidate.distance);
    const distanceScore = isFinite(distMiles) ? Math.max(0, 100 * Math.exp(-0.05 * distMiles)) : 0;

    // 2. Interest Overlap Score (25 pts per matching tag)
    const viewerInterests: string[] = [
      ...(viewerProfile?.interests || []),
      ...(viewerProfile?.skillTags || [])
    ];
    const candidateTags = candidate.skillTags || [];
    const sharedTags = candidateTags.filter(tag => tag && viewerInterests.includes(tag));
    const interestOverlapScore = sharedTags.length * 25;

    // 3. Recency Score (30 pts if active)
    const isRecentlyActive = candidate.status === 'active' || String(candidate.activityDetail || '').toLowerCase().includes('active');
    const recencyScore = isRecentlyActive ? 30 : 0;

    // 4. Mutual Connections Score (20 pts)
    const isMutual = (followingIds || []).includes(candidate.id || "");
    const mutualScore = isMutual ? 20 : 0;

    // 5. New User Visibility Boost (40 pts)
    let newUserBoost = 0;
    try {
      const createdDate = candidate.createdAt ? new Date(candidate.createdAt).getTime() : 0;
      const isNewProfile = !isNaN(createdDate) && createdDate > (Date.now() - 7 * 24 * 60 * 60 * 1000);
      const isLowImpression = (Number(candidate.impressionCount) || 0) < 300;
      newUserBoost = (isNewProfile || isLowImpression) ? 40 : 0;
    } catch (e) {
      newUserBoost = 0;
    }

    // 6. Personalization for Returning Users (>= 15 past likes)
    let personalizationScore = 0;
    const pastLikesCount = Number(viewerPastLikesCount) || 0;
    if (pastLikesCount >= 15 && Object.keys(likedTagsMap || {}).length > 0) {
      let affinitySum = 0;
      candidateTags.forEach(tag => {
        if (tag && likedTagsMap && likedTagsMap[tag]) {
          affinitySum += likedTagsMap[tag];
        }
      });
      personalizationScore = Math.min(50, affinitySum * 10);
    }

    const rawScore = distanceScore + interestOverlapScore + recencyScore + mutualScore + newUserBoost + personalizationScore;
    const finalScore = isFinite(rawScore) ? Math.max(0, rawScore) : 0;

    return {
      candidate,
      score: finalScore,
      breakdown: {
        distanceScore,
        interestOverlapScore,
        recencyScore,
        mutualScore,
        newUserBoost,
        personalizationScore
      }
    };
  } catch (err) {
    return {
      candidate: candidate || { id: "error" } as any,
      score: 0,
      breakdown: { distanceScore: 0, interestOverlapScore: 0, recencyScore: 0, mutualScore: 0, newUserBoost: 0, personalizationScore: 0 }
    };
  }
}

/**
 * Ranks candidate profiles for Discover Feed, filtering out hard exclusions.
 */
export function getRankedCandidates(
  allCreators: Creator[],
  viewerProfile: any,
  swipedIds: string[] = [],
  likedCreators: Creator[] = [],
  blockedIds: string[] = [],
  matchedIds: string[] = [],
  followingIds: string[] = []
): Creator[] {
  try {
    const viewerUid = viewerProfile?.uid || viewerProfile?.id;
    const viewerEmail = String(viewerProfile?.email || '').toLowerCase();
    const viewerUsername = String(viewerProfile?.username || '').toLowerCase();
    const likedTagsMap = buildLikedTagsMap(likedCreators || []);
    const pastLikesCount = (Number(viewerProfile?.likedCreatorIds?.length) || 0) + (Number(swipedIds?.length) || 0);

    // Age / Gender filter settings
    const minAge = Number(viewerProfile?.minAge) || 18;
    const maxAge = Number(viewerProfile?.maxAge) || 99;
    const genderPref = String(viewerProfile?.genderPreference || 'all').toLowerCase();

    const eligibleCandidates = (allCreators || []).filter(candidate => {
      if (!candidate || !candidate.id) return false;
      // Exclude self strictly
      if (viewerUid && candidate.id === viewerUid) return false;
      if (viewerEmail && String(candidate.email || '').toLowerCase() === viewerEmail) return false;
      if (viewerUsername && String(candidate.username || '').toLowerCase() === viewerUsername) return false;

      // Exclude swiped / liked / skipped
      if ((swipedIds || []).includes(candidate.id)) return false;
      // Exclude already matched
      if ((matchedIds || []).includes(candidate.id)) return false;
      // Exclude blocked users
      if ((blockedIds || []).includes(candidate.id)) return false;

      // Hard age filter
      const candAge = Number(candidate.age) || 25;
      if (candAge < minAge || candAge > maxAge) return false;

      // Hard gender filter
      if (genderPref !== 'all' && candidate.gender) {
        if (String(candidate.gender).toLowerCase() !== genderPref) return false;
      }

      return true;
    });

    // Calculate scores
    const scored = eligibleCandidates.map(cand =>
      calculateCandidateScore(cand, viewerProfile, likedTagsMap, pastLikesCount, followingIds)
    );

    // Sort descending by score
    scored.sort((a, b) => {
      const scoreDiff = (Number(b.score) || 0) - (Number(a.score) || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const idA = String(a.candidate?.id || '');
      const idB = String(b.candidate?.id || '');
      return idA.localeCompare(idB);
    });

    return scored.map(item => item.candidate);
  } catch (err) {
    console.error("[Ranking] Global ranking failure:", err);
    return [];
  }
}

/**
 * Build story tiers and interleave stories into the feed item list.
 */
export function buildInterleavedFeed(
  rankedCreators: Creator[],
  allStories: Story[],
  followingIds: string[] = [],
  messagedUserIds: string[] = [],
  viewerInterests: string[] = []
): Array<
  | { type: 'creator'; data: Creator }
  | { type: 'story'; data: Story }
  | { type: 'ad'; data: { id: string; adIndex: number } }
> {
  const feed: Array<
    | { type: 'creator'; data: Creator }
    | { type: 'story'; data: Story }
    | { type: 'ad'; data: { id: string; adIndex: number } }
  > = [];

  try {
    const tier1Stories: Story[] = [];
    const tier2Stories: Story[] = [];

    const tier1AuthorIds = new Set([...(followingIds || []), ...(messagedUserIds || [])]);

    (allStories || []).forEach(story => {
      if (!story) return;
      const authorId = story.creatorId || story.authorUid || '';
      if (authorId && tier1AuthorIds.has(authorId)) {
        tier1Stories.push(story);
      } else {
        tier2Stories.push(story);
      }
    });

    // Sort Tier 2 by views/recency
    tier2Stories.sort((a, b) => (Number(b.viewsCount) || 0) - (Number(a.viewsCount) || 0));

    let lastStoryAuthorId: string | null = null;
    let t1Idx = 0;
    let t2Idx = 0;

    (rankedCreators || []).forEach((creator, idx) => {
      if (!creator) return;
      feed.push({ type: 'creator', data: creator });

      if ((idx + 1) % 2 === 0) {
        feed.push({
          type: 'ad',
          data: { id: `discover-ad-${idx}`, adIndex: Math.floor(idx / 2) }
        });
      }

      if ((idx + 1) % 3 === 0) {
        let storyToInsert: Story | null = null;
        while (t1Idx < tier1Stories.length) {
          const candidateStory = tier1Stories[t1Idx++];
          const authorId = candidateStory.creatorId || candidateStory.authorUid || '';
          if (authorId !== lastStoryAuthorId) {
            storyToInsert = candidateStory;
            break;
          }
        }
        if (!storyToInsert) {
          while (t2Idx < tier2Stories.length) {
            const candidateStory = tier2Stories[t2Idx++];
            const authorId = candidateStory.creatorId || candidateStory.authorUid || '';
            if (authorId !== lastStoryAuthorId) {
              storyToInsert = candidateStory;
              break;
            }
          }
        }
        if (storyToInsert) {
          feed.push({ type: 'story', data: storyToInsert });
          lastStoryAuthorId = storyToInsert.creatorId || storyToInsert.authorUid || null;
        }
      }
    });
  } catch (err) {
    console.error("[Ranking] Feed construction crashed:", err);
  }

  return feed;
}

export async function trackProfileImpression(candidateId: string) {
  if (!candidateId) return;
  try {
    const userRef = doc(db, "users", candidateId);
    await updateDoc(userRef, {
      impressionCount: increment(1)
    }).catch(() => {});
  } catch (err) {}
}

export async function recordProfileVisit(
  viewerUid: string,
  targetCreatorId: string,
  viewerProfile: any
) {
  if (!viewerUid || !targetCreatorId || viewerUid === targetCreatorId) return;

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  try {
    const viewsRef = collection(db, "users", targetCreatorId, "profileViews");
    await addDoc(viewsRef, {
      viewerId: viewerUid,
      viewerUsername: viewerProfile?.username || viewerProfile?.name || 'A user',
      timestamp: serverTimestamp(),
      createdAtMs: now
    }).catch(() => {});

    const notifsRef = collection(db, "notifications", targetCreatorId, "items");
    const qRecent = query(notifsRef, where("type", "==", "profile_view"), limit(20));

    const snap = await getDocs(qRecent).catch(() => null);

    let recentViewFromSameViewer = false;
    let todayNotifDoc: any = null;
    let todayViewerCount = 1;

    if (snap && !snap.empty) {
      snap.docs.forEach((docSnap: any) => {
        const data = docSnap.data();
        const createdMs = data.createdAtMs || (data.createdAt?.toDate ? data.createdAt.toDate().getTime() : 0);
        if (data.fromUid === viewerUid && createdMs > sevenDaysAgo) recentViewFromSameViewer = true;
        if (createdMs >= startOfDay.getTime()) {
          todayNotifDoc = docSnap;
          todayViewerCount = (data.batchCount || 1) + 1;
        }
      });
    }

    if (recentViewFromSameViewer) return;

    const viewerName = viewerProfile?.username || viewerProfile?.name || "A creator";
    const viewerAvatar = getUserAvatar(viewerProfile);

    if (todayNotifDoc) {
      const docRef = doc(db, "notifications", targetCreatorId, "items", todayNotifDoc.id);
      await updateDoc(docRef, {
        title: "Profile Views Today 👀",
        description: `${todayViewerCount} people viewed your profile today!`,
        batchCount: todayViewerCount,
        read: false,
        updatedAt: serverTimestamp()
      }).catch(() => {});
    } else {
      await addDoc(notifsRef, {
        type: "profile_view",
        fromUid: viewerUid,
        fromUsername: viewerName,
        fromAvatar: viewerAvatar,
        createdAt: serverTimestamp(),
        createdAtMs: now,
        batchCount: 1,
        read: false,
        title: "New Profile Visitor 👀",
        description: `@${viewerName} viewed your profile.`,
        targetId: viewerUid
      }).catch(() => {});
    }
  } catch (err) {
    console.warn("Profile visit recording error:", err);
  }
}

export async function checkAccountSuggestionNotification(
  viewerUid: string,
  topCandidate: Creator | null,
  topCandidateScore: number
) {
  if (!viewerUid || !topCandidate || topCandidateScore < 120) return;

  const storageKey = `suggested_creator_${viewerUid}_${topCandidate.id}`;
  const lastSuggested = localStorage.getItem(storageKey);
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  if (lastSuggested && (now - parseInt(lastSuggested, 10)) < sevenDays) return;

  try {
    localStorage.setItem(storageKey, now.toString());
    const notifsRef = collection(db, "notifications", viewerUid, "items");
    await addDoc(notifsRef, {
      type: "account_suggestion",
      fromUid: topCandidate.id,
      fromUsername: topCandidate.name,
      fromAvatar: topCandidate.avatar,
      createdAt: serverTimestamp(),
      read: false,
      title: "Strong Interest Match! ✨",
      description: `${topCandidate.name} matches your interests. Tap to discover!`,
      targetId: topCandidate.id
    }).catch(() => {});
  } catch (err) {}
}
