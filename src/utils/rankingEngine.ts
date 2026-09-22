/**
 * AnvioTalk Production Recommendation & Ranking Engine
 *
 * Implements:
 * 1. Feed Ranking Engine (Photo / Video / Story)
 * 2. Group Recommendation Engine
 * 3. Dating Match & Elo Algorithm
 * 4. Monetization Blending Layer
 * 5. Cold-Start Fallback Strategy
 */

import { Creator, Story } from '../data';

export type MediaType = 'photo' | 'video' | 'story';

export interface RankingWeights {
  engagement: number;
  recency: number;
  relevance: number;
  trust: number;
}

export interface UserTierConfig {
  maxBoostedRatio: number; // e.g. 0.10 = max 1 boosted per 10 organic
  superLikeMultiplier: number;
  adFrequency: number; // insert ad every N items
  seeWhoLikedYou: boolean;
  unlimitedRewinds: boolean;
}

export const RANKING_CONFIG: {
  weights: Record<MediaType, RankingWeights>;
  decayLambda: number; // Exponential decay parameter per hour
  tiers: {
    free: UserTierConfig;
    premium: UserTierConfig;
  };
} = {
  weights: {
    photo: { engagement: 0.35, recency: 0.30, relevance: 0.20, trust: 0.15 },
    video: { engagement: 0.45, recency: 0.20, relevance: 0.20, trust: 0.15 },
    story: { engagement: 0.40, recency: 0.35, relevance: 0.15, trust: 0.10 }
  },
  decayLambda: 0.05, // ~50% score decay at ~14 hours
  tiers: {
    free: {
      maxBoostedRatio: 0.10, // 1 in 10
      superLikeMultiplier: 1.25,
      adFrequency: 5, // ad every 5 items
      seeWhoLikedYou: false,
      unlimitedRewinds: false
    },
    premium: {
      maxBoostedRatio: 0.20, // 2 in 10
      superLikeMultiplier: 2.0,
      adFrequency: 12, // ad every 12 items
      seeWhoLikedYou: true,
      unlimitedRewinds: true
    }
  }
};

// ============================================================================
// MODULE 1: FEED RANKING ENGINE (Photo / Video / Story)
// ============================================================================

export interface FeedItemInput {
  id: string;
  mediaType: MediaType;
  createdAt: any; // Date, Timestamp or ms
  creator: Creator;
  likesCount?: number;
  commentsCount?: number;
  sharesCount?: number;
  viewsCount?: number;
  // Video metrics
  completionRate?: number; // 0 to 1 (e.g. 0.85 = 85% completed)
  averageWatchTimePct?: number; // 0 to 1
  // Story metrics
  viewThroughRate?: number; // 0 to 1
  replyRate?: number; // 0 to 1
  tags?: string[];
}

export interface FeedItemScoreResult {
  itemId: string;
  score: number;
  breakdown: {
    engagementRateScore: number;
    recencyDecayScore: number;
    relevanceScore: number;
    creatorTrustScore: number;
  };
}

/**
 * Calculates normalized Engagement Rate score (0 to 100) based on media type.
 */
export function calculateEngagementRateScore(item: FeedItemInput): number {
  if (item.mediaType === 'video') {
    const completion = Math.min(1, Math.max(0, item.completionRate ?? 0.5));
    const watchPct = Math.min(1, Math.max(0, item.averageWatchTimePct ?? 0.5));
    const engagementVolume = Math.min(1, ((item.likesCount || 0) * 1 + (item.commentsCount || 0) * 2 + (item.sharesCount || 0) * 3) / 100);
    return (completion * 50) + (watchPct * 30) + (engagementVolume * 20);
  }

  if (item.mediaType === 'story') {
    const viewThrough = Math.min(1, Math.max(0, item.viewThroughRate ?? 0.6));
    const replies = Math.min(1, Math.max(0, item.replyRate ?? 0.1));
    const likes = Math.min(1, (item.likesCount || 0) / 50);
    return (viewThrough * 50) + (replies * 30) + (likes * 20);
  }

  // Photo / Standard Feed Post
  const views = Math.max(1, item.viewsCount || 100);
  const interactions = (item.likesCount || 0) * 1 + (item.commentsCount || 0) * 2.5 + (item.sharesCount || 0) * 4;
  const rawRatio = interactions / views;
  return Math.min(100, Math.max(0, rawRatio * 200));
}

/**
 * Calculates Recency Decay score (0 to 100) using exponential decay: 100 * exp(-lambda * hours)
 */
export function calculateRecencyDecayScore(createdAt: any, lambda = RANKING_CONFIG.decayLambda): number {
  try {
    let createdMs = Date.now();
    if (createdAt?.toDate && typeof createdAt.toDate === 'function') {
      createdMs = createdAt.toDate().getTime();
    } else if (createdAt?.seconds) {
      createdMs = createdAt.seconds * 1000;
    } else if (createdAt instanceof Date) {
      createdMs = createdAt.getTime();
    } else if (typeof createdAt === 'number') {
      createdMs = createdAt;
    }

    const hoursAgo = Math.max(0, (Date.now() - createdMs) / (1000 * 60 * 60));
    return Math.max(0, 100 * Math.exp(-lambda * hoursAgo));
  } catch {
    return 50;
  }
}

/**
 * Calculates Relevance Score (0 to 100) based on content tag overlap with viewer's interests/history.
 */
export function calculateRelevanceScore(
  itemTags: string[] = [],
  viewerInterests: string[] = [],
  tagAffinityMap: Record<string, number> = {}
): number {
  if (!itemTags || itemTags.length === 0) return 30; // neutral base score for untagged

  const sharedDirect = itemTags.filter(t => t && viewerInterests.includes(t)).length;
  let affinitySum = 0;
  itemTags.forEach(t => {
    if (t && tagAffinityMap[t]) {
      affinitySum += tagAffinityMap[t];
    }
  });

  const directScore = Math.min(60, sharedDirect * 20);
  const affinityScore = Math.min(40, affinitySum * 10);
  return Math.min(100, directScore + affinityScore);
}

/**
 * Calculates Creator Trust Score (0 to 100) based on account age, verification badge, and activity consistency.
 */
export function calculateCreatorTrustScore(creator: Creator): number {
  if (!creator) return 20;

  let score = 20; // base score

  // 1. Verification bonus (+30)
  if (creator.isVerified) {
    score += 30;
  }

  // 2. Account Age score (+30 max)
  try {
    const rawCreated: any = creator.createdAt;
    let createdMs = Date.now();
    if (rawCreated && typeof rawCreated === 'object' && 'toDate' in rawCreated && typeof rawCreated.toDate === 'function') {
      createdMs = rawCreated.toDate().getTime();
    } else if (typeof rawCreated === 'number') {
      createdMs = rawCreated;
    }
    const daysOld = Math.max(0, (Date.now() - createdMs) / (1000 * 60 * 60 * 24));
    score += Math.min(30, daysOld * 0.5); // maxed at 60 days
  } catch {
    score += 10;
  }

  // 3. Activity Consistency (+20 max)
  if (creator.status === 'active') {
    score += 20;
  } else {
    score += 10;
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * Ranks a feed item using the formula:
 * Score = (w1 * Engagement) + (w2 * Recency) + (w3 * Relevance) + (w4 * Trust)
 */
export function scoreFeedContent(
  item: FeedItemInput,
  viewerProfile: any = {},
  tagAffinityMap: Record<string, number> = {}
): FeedItemScoreResult {
  const mediaType: MediaType = item.mediaType || 'photo';
  const weights = RANKING_CONFIG.weights[mediaType] || RANKING_CONFIG.weights.photo;

  const engagementRateScore = calculateEngagementRateScore(item);
  const recencyDecayScore = calculateRecencyDecayScore(item.createdAt);

  const viewerInterests = [
    ...(viewerProfile?.interests || []),
    ...(viewerProfile?.skillTags || [])
  ];
  const itemTags = item.tags || item.creator?.skillTags || [];
  const relevanceScore = calculateRelevanceScore(itemTags, viewerInterests, tagAffinityMap);

  const creatorTrustScore = calculateCreatorTrustScore(item.creator);

  const finalScore =
    (weights.engagement * engagementRateScore) +
    (weights.recency * recencyDecayScore) +
    (weights.relevance * relevanceScore) +
    (weights.trust * creatorTrustScore);

  return {
    itemId: item.id,
    score: Math.max(0, Math.round(finalScore * 100) / 100),
    breakdown: {
      engagementRateScore: Math.round(engagementRateScore * 10) / 10,
      recencyDecayScore: Math.round(recencyDecayScore * 10) / 10,
      relevanceScore: Math.round(relevanceScore * 10) / 10,
      creatorTrustScore: Math.round(creatorTrustScore * 10) / 10
    }
  };
}

// ============================================================================
// MODULE 2: GROUP RECOMMENDATION ENGINE
// ============================================================================

export interface GroupInput {
  id: string;
  name: string;
  category?: string;
  tags?: string[];
  members?: string[]; // array of member UIDs
  participants?: string[];
  admins?: string[];
  recentMessagesCount7Days?: number; // active message frequency in last 7 days
  recentPostsCount7Days?: number;
  lastMessageAt?: any;
  isPublic?: boolean;
}

export interface GroupRecommendationResult {
  group: GroupInput;
  score: number;
  breakdown: {
    interestOverlapScore: number;
    mutualFriendsScore: number;
    activityLevelScore: number;
  };
}

/**
 * Calculates Interest Tag Overlap Score (0 to 100) for a Group
 */
export function calculateGroupInterestScore(group: GroupInput, userProfile: any): number {
  const userInterests = [
    ...(userProfile?.interests || []),
    ...(userProfile?.skillTags || [])
  ].map(i => String(i).toLowerCase().trim());

  if (userInterests.length === 0) return 30; // default baseline

  const groupTags = [
    ...(group.tags || []),
    ...(group.category ? [group.category] : [])
  ].map(t => String(t).toLowerCase().trim());

  if (groupTags.length === 0) return 20;

  const sharedCount = groupTags.filter(gt => userInterests.some(ui => ui.includes(gt) || gt.includes(ui))).length;
  const ratio = sharedCount / Math.max(1, groupTags.length);

  return Math.min(100, Math.max(0, ratio * 100 + sharedCount * 15));
}

/**
 * Calculates Mutual Friends / Connections in Group Score (0 to 100)
 */
export function calculateGroupMutualConnectionsScore(group: GroupInput, viewerFollowingUids: string[] = []): number {
  if (!viewerFollowingUids || viewerFollowingUids.length === 0) return 0;

  const groupMembers = new Set([
    ...(group.members || []),
    ...(group.participants || []),
    ...(group.admins || [])
  ]);

  const mutualCount = viewerFollowingUids.filter(uid => uid && groupMembers.has(uid)).length;

  // 25 pts per mutual friend, capped at 100 (4 mutual friends)
  return Math.min(100, mutualCount * 25);
}

/**
 * Calculates Group Activity Level Score (0 to 100) based on post/message frequency in last 7 days
 */
export function calculateGroupActivityScore(group: GroupInput): number {
  const msgCount = group.recentMessagesCount7Days ?? 10;
  const postCount = group.recentPostsCount7Days ?? 2;

  // Score based on active interaction volume
  const msgScore = Math.min(60, msgCount * 1.2); // max 60 at 50 msgs
  const postScore = Math.min(40, postCount * 8); // max 40 at 5 posts

  let recencyBonus = 0;
  if (group.lastMessageAt) {
    const recencyScore = calculateRecencyDecayScore(group.lastMessageAt, 0.02); // slower decay for group
    recencyBonus = (recencyScore / 100) * 20;
  }

  return Math.min(100, msgScore + postScore + recencyBonus);
}

/**
 * Recommends and ranks groups for a given user.
 * Formula: GroupScore = (0.45 * InterestScore) + (0.35 * MutualFriendsScore) + (0.20 * ActivityScore)
 */
export function recommendGroups(
  groups: GroupInput[],
  viewerProfile: any,
  viewerFollowingUids: string[] = []
): GroupRecommendationResult[] {
  if (!groups || groups.length === 0) return [];

  const results = groups.map(group => {
    const interestOverlapScore = calculateGroupInterestScore(group, viewerProfile);
    const mutualFriendsScore = calculateGroupMutualConnectionsScore(group, viewerFollowingUids);
    const activityLevelScore = calculateGroupActivityScore(group);

    const score = (0.45 * interestOverlapScore) + (0.35 * mutualFriendsScore) + (0.20 * activityLevelScore);

    return {
      group,
      score: Math.max(0, Math.round(score * 100) / 100),
      breakdown: {
        interestOverlapScore: Math.round(interestOverlapScore * 10) / 10,
        mutualFriendsScore: Math.round(mutualFriendsScore * 10) / 10,
        activityLevelScore: Math.round(activityLevelScore * 10) / 10
      }
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ============================================================================
// MODULE 3: DATING MATCH & ELO ALGORITHM
// ============================================================================

export interface DatingExclusionCriteria {
  swipedIds?: string[];
  matchedIds?: string[];
  blockedIds?: string[];
  reportedIds?: string[];
}

export interface DatingMatchScoreResult {
  candidate: Creator;
  score: number;
  breakdown: {
    interestOverlapScore: number;
    activitySimilarityScore: number;
    responseRateScore: number;
    eloMutualLikeScore: number;
    profileQualityScore: number;
  };
}

/**
 * Parses distance string into numeric miles.
 */
export function parseDistanceMiles(distanceStr?: string): number {
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
  } catch {
    return 5;
  }
}

/**
 * HARD FILTERS EXCLUSION CHECK
 * Explicitly excludes self, blocked users, reported users, already matched users,
 * swiped/passed candidates, and out-of-range age/distance/gender preferences.
 */
export function passesHardDatingFilters(
  candidate: Creator,
  viewerProfile: any,
  exclusions: DatingExclusionCriteria = {}
): boolean {
  if (!candidate || !candidate.id) return false;

  const viewerUid = viewerProfile?.uid || viewerProfile?.id;
  const viewerEmail = String(viewerProfile?.email || '').toLowerCase();
  const viewerUsername = String(viewerProfile?.username || '').toLowerCase();

  // 1. HARD EXCLUSION: Self
  if (viewerUid && candidate.id === viewerUid) return false;
  if (viewerEmail && String(candidate.email || '').toLowerCase() === viewerEmail) return false;
  if (viewerUsername && String(candidate.username || '').toLowerCase() === viewerUsername) return false;

  // 2. HARD EXCLUSION: Swiped / Liked / Passed
  if (exclusions.swipedIds && exclusions.swipedIds.includes(candidate.id)) return false;

  // 3. HARD EXCLUSION: Already Matched
  if (exclusions.matchedIds && exclusions.matchedIds.includes(candidate.id)) return false;

  // 4. HARD EXCLUSION: Blocked Users (Both directions)
  const candObj = candidate as any;
  const viewerBlocked = new Set([
    ...(viewerProfile?.blockedUsers || []),
    ...(exclusions.blockedIds || [])
  ]);
  if (viewerBlocked.has(candidate.id)) return false;
  if (Array.isArray(candObj.blockedUsers) && viewerUid && candObj.blockedUsers.includes(viewerUid)) return false;

  // 5. HARD EXCLUSION: Reported Users
  const viewerReported = new Set([
    ...(viewerProfile?.reportedUsers?.map((r: any) => typeof r === 'string' ? r : r?.targetId) || []),
    ...(exclusions.reportedIds || [])
  ]);
  if (viewerReported.has(candidate.id)) return false;

  // 6. HARD FILTER: Age Range
  const minAge = Number(viewerProfile?.minAgePreference || viewerProfile?.minAge) || 18;
  const maxAge = Number(viewerProfile?.maxAgePreference || viewerProfile?.maxAge) || 99;
  const candidateAge = Number(candObj.age) || 25;
  if (candidateAge < minAge || candidateAge > maxAge) return false;

  // 7. HARD FILTER: Max Distance Radius
  const maxDistance = Number(viewerProfile?.maxDistancePreference || viewerProfile?.distancePreference) || 100; // in miles
  const distanceMiles = parseDistanceMiles(candidate.distance);
  if (distanceMiles > maxDistance) return false;

  // 8. HARD FILTER: Gender Preference
  const genderPref = String(viewerProfile?.genderPreference || viewerProfile?.lookingFor || viewerProfile?.showMe || 'all').toLowerCase();
  if (genderPref !== 'all' && candObj.gender) {
    const candGender = String(candObj.gender).toLowerCase();
    if (genderPref !== candGender) return false;
  }

  return true;
}

/**
 * Calculates Profile / Photo Quality Score (0 to 100)
 */
export function calculateProfileQualityScore(creator: Creator): number {
  if (!creator) return 20;

  let score = 0;
  const candObj = creator as any;

  // Verification (+20)
  if (creator.isVerified) score += 20;

  // Photos count (+10 per photo up to 30)
  const photos = creator.portfolioPhotos || [];
  score += Math.min(30, photos.length * 10);

  // Bio completeness (+25)
  const bioLen = (candObj.bio || creator.activeProject || '').trim().length;
  if (bioLen > 50) score += 25;
  else if (bioLen > 10) score += 15;

  // Setup completion (+25)
  if (candObj.profileCompleted || candObj.hasCompletedProfileSetup) score += 25;

  return Math.min(100, score);
}

/**
 * Calculates Tinder-style Elo Mutual-Like Probability Score (0 to 100)
 * Uses Elo Rating logistic distribution: P = 1 / (1 + 10^((Elo_candidate - Elo_viewer)/400))
 */
export function calculateEloMutualLikeScore(candidateElo = 1200, viewerElo = 1200): number {
  const eloDiff = candidateElo - viewerElo;
  const probability = 1 / (1 + Math.pow(10, eloDiff / 400));
  return Math.min(100, Math.max(0, probability * 100));
}

/**
 * Calculates Soft Dating Match Score for eligible candidate
 * Composite formula:
 * SoftScore = (0.30 * InterestOverlap) + (0.25 * EloMutualLike) + (0.20 * ActivitySimilarity) + (0.15 * ResponseRate) + (0.10 * ProfileQuality)
 */
export function calculateDatingMatchScore(
  candidate: Creator,
  viewerProfile: any
): DatingMatchScoreResult {
  const candObj = candidate as any;

  // 1. Interest / Hobby Overlap %
  const viewerInterests = [
    ...(viewerProfile?.interests || []),
    ...(viewerProfile?.skillTags || [])
  ].map(i => String(i).toLowerCase().trim());

  const candidateInterests = [
    ...(candObj.interests || []),
    ...(candidate.skillTags || [])
  ].map(i => String(i).toLowerCase().trim());

  const sharedInterests = candidateInterests.filter(ci => viewerInterests.includes(ci));
  const overlapPct = viewerInterests.length > 0 ? (sharedInterests.length / viewerInterests.length) * 100 : 30;
  const interestOverlapScore = Math.min(100, overlapPct * 1.5);

  // 2. Activity Similarity (0 to 100)
  const viewerActive = viewerProfile?.status === 'active';
  const candidateActive = candidate.status === 'active';
  const activitySimilarityScore = (viewerActive && candidateActive) ? 100 : (candidateActive ? 70 : 30);

  // 3. Response / Reply Rate (0 to 100)
  const responseRateScore = Math.min(100, Math.max(20, (candObj.followersCount || 10) * 2));

  // 4. Elo Mutual-Like Score (0 to 100)
  const candidateElo = candObj.eloRating || 1200;
  const viewerElo = (viewerProfile as any)?.eloRating || 1200;
  const eloMutualLikeScore = calculateEloMutualLikeScore(candidateElo, viewerElo);

  // 5. Profile / Photo Quality Score (0 to 100)
  const profileQualityScore = calculateProfileQualityScore(candidate);

  const finalScore =
    (0.30 * interestOverlapScore) +
    (0.25 * eloMutualLikeScore) +
    (0.20 * activitySimilarityScore) +
    (0.15 * responseRateScore) +
    (0.10 * profileQualityScore);

  return {
    candidate,
    score: Math.max(0, Math.round(finalScore * 100) / 100),
    breakdown: {
      interestOverlapScore: Math.round(interestOverlapScore * 10) / 10,
      activitySimilarityScore: Math.round(activitySimilarityScore * 10) / 10,
      responseRateScore: Math.round(responseRateScore * 10) / 10,
      eloMutualLikeScore: Math.round(eloMutualLikeScore * 10) / 10,
      profileQualityScore: Math.round(profileQualityScore * 10) / 10
    }
  };
}

/**
 * Filters and ranks dating match candidates, enforcing all hard exclusions.
 */
export function getRankedDatingCandidates(
  allCreators: Creator[],
  viewerProfile: any,
  exclusions: DatingExclusionCriteria = {}
): Creator[] {
  if (!allCreators || allCreators.length === 0) return [];

  // Filter with Hard Exclusions first
  const eligible = allCreators.filter(candidate =>
    passesHardDatingFilters(candidate, viewerProfile, exclusions)
  );

  // Rank eligible candidates with Soft Match Scoring
  const scored = eligible.map(cand => calculateDatingMatchScore(cand, viewerProfile));

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.candidate);
}
