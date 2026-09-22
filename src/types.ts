export interface UserProfile {
  uid: string;
  username: string;          // unique, lowercase, no spaces (e.g. "elena_vance")
  displayName: string;
  email: string;
  bio: string;
  specialty: string;         // e.g. "Urban Architect" (existing Creator field)
  avatarUrl: string;
  portfolioPhotos: string[];
  skillTags: string[];
  status: 'active' | 'away' | 'focus';
  accountStatus?: 'active' | 'suspended' | 'banned';
  createdAt: any;            // Firestore Timestamp or Date
  lastActiveAt: any;         // Firestore Timestamp or Date
  followersCount: number;
  followingCount: number;
  x?: number;                // Map coordinate X percent (relative to canvas, default random or preset)
  y?: number;                // Map coordinate Y percent (relative to canvas, default random or preset)
  
  // Onboarding profile setup fields
  profileCompleted?: boolean;
  hasCompletedProfileSetup?: boolean;
  skippedProfileSetup?: boolean;
  coverPhotoUrl?: string;
  fullName?: string;
  dateOfBirth?: string;
  age?: number;
  gender?: string;
  interestedIn?: string;
  relationshipGoal?: string;
  country?: string;
  state?: string;
  city?: string;
  currentLocation?: string;
  distancePreference?: number;
  occupation?: string;
  education?: string;
  languagesSpoken?: string[];
  musicCategories?: string[];
  interests?: string[];
  smoking?: string;
  drinking?: string;
  workoutFrequency?: string;
  religion?: string;
  height?: string;
  personalityType?: string;
  minAgePreference?: number;
  maxAgePreference?: number;
  maxDistancePreference?: number;
  lookingFor?: string;
  showMe?: string;
  visibilitySettings?: string;
  isVerified?: boolean;
  isPremium?: boolean;
  isCreator?: boolean;
  isAdmin?: boolean;
  role?: string;
  creatorTokens?: number;
  creatorSubscribers?: number;
  blockedUsers?: string[];
  reportedUsers?: any[];
  allowMessagesFromAnyone?: boolean;
  searchKeywords?: string[];
}

export interface FollowEdge {
  followerUid: string;
  followingUid: string;
  status: 'pending' | 'accepted';
  createdAt: any;
  respondedAt?: any;
}

export interface AppNotification {
  id: string;
  type: 'follow_request' | 'follow_accepted' | 'story_view' | 'message' | 'new_follower_post';
  fromUid: string;
  fromUsername: string;
  fromAvatar: string;
  createdAt: any;
  read: boolean;
  targetId?: string; // e.g. follow doc id, story id, chat id
}

export interface Story {
  id: string;
  authorUid: string;
  authorUsername: string;
  authorAvatar: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  createdAt: any;
  expiresAt: any;   // createdAt + 24h
  viewedBy: string[];     // array of uids
}

export interface Chat {
  id: string;
  participants: string[]; // [uidA, uidB]
  lastMessage: string;
  lastMessageAt: any;
}

export interface Message {
  id: string;
  senderUid: string;
  text: string;
  createdAt: any;
  read: boolean;
  deletedFor?: string[];
  unsent?: boolean;
}

export interface PaymentMethodData {
  type: 'bank_upi';
  upiId: string;
  accountHolderName: string;
  bankAccountNumber: string;
  ifscCode: string;
  bankName: string;
  isVerified?: boolean;
  updatedAt?: string;
}

export interface PayoutRequest {
  id?: string;
  creatorId: string;
  monthKey: string;
  amountUsd: number;
  amountInrApprox: number;
  paymentMethodSnapshot: PaymentMethodData;
  status: 'requested' | 'processing' | 'paid' | 'rejected';
  requestedAt: string;
  processedAt?: string;
  processedBy?: string;
  transactionReference?: string;
  adminNote?: string;
  manuallyReviewed?: boolean;
}

export interface ReportItem {
  id?: string;
  reporterUid: string;
  targetType: 'user' | 'group' | 'message' | 'story' | 'post';
  targetId: string;
  parentId?: string;
  reason: string;
  details?: string;
  status: 'pending' | 'reviewed' | 'actioned' | 'dismissed';
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  actionTaken?: string;
}

