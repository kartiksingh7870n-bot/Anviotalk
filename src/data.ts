export interface Creator {
  id: string;
  name: string;
  specialty: string;
  distance: string;
  avatar: string;
  activeProject: string;
  x: number; // Percent relative to map canvas
  y: number; // Percent relative to map canvas
  status: 'active' | 'away' | 'focus';
  badgeType?: 'bolt' | 'palette' | 'sparkle' | 'none';
  activityDetail?: string;
  skillTags: string[];
  portfolioPhotos?: string[];
  exclusivePhotos?: string[];
  username?: string;
  coverPhotoUrl?: string;
  city?: string;
  state?: string;
  country?: string;
  gender?: string;
  email?: string;
  isVerified?: boolean;
  age?: number;
  createdAt?: string;
  impressionCount?: number;
}

export interface OnboardingSlide {
  id: number;
  label: string;
  headline: string;
  highlightedText?: string;
  subtext: string;
  image: string;
  theme: 'dark' | 'light' | 'glass';
  sideBadge?: {
    title: string;
    subtitle: string;
    icon: string;
  };
}

export const CREATORS: Creator[] = [
  {
    id: 'elena',
    name: 'Elena Vance',
    gender: 'Female',
    specialty: 'Urban Architect',
    distance: '0.8km',
    avatar: '/boy-avatar.jpg',
    activeProject: 'Designing "The Vertical Forest"',
    x: 62,
    y: 28,
    status: 'active',
    badgeType: 'bolt',
    activityDetail: 'Active 2m ago',
    skillTags: ['Architecture', 'Urbanism', '3D Design'],
    portfolioPhotos: [
      'https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?auto=format&fit=crop&w=400&q=80',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=400&q=80',
      'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?auto=format&fit=crop&w=400&q=80'
    ],
    exclusivePhotos: [
      'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=400&q=80',
      'https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=400&q=80'
    ]
  },
  {
    id: 'julian',
    name: 'Julian Ray',
    gender: 'Male',
    specialty: 'NFT & Digital Artist',
    distance: '1.2km',
    avatar: '/girl-avatar.jpg',
    activeProject: 'Dropped new "Luminous Bloom" collection',
    x: 74,
    y: 68,
    status: 'focus',
    badgeType: 'palette',
    activityDetail: 'In Flow Mode',
    skillTags: ['UI Design', 'Motion Graphics', 'Digital Art'],
    portfolioPhotos: [
      'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80',
      'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=400&q=80',
      'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?auto=format&fit=crop&w=400&q=80'
    ],
    exclusivePhotos: [
      'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=400&q=80',
      'https://images.unsplash.com/photo-1618005198143-d3663a137233?auto=format&fit=crop&w=400&q=80'
    ]
  },
  {
    id: 'marcus',
    name: 'Marcus Thorne',
    gender: 'Male',
    specialty: 'Product Strategist',
    distance: '2.4km',
    avatar: '/boy-avatar.jpg',
    activeProject: 'Synthesizing local design systems',
    x: 48,
    y: 78,
    status: 'away',
    badgeType: 'none',
    activityDetail: 'Active 1h ago',
    skillTags: ['Product Strategy', 'Typography', 'Branding'],
    portfolioPhotos: [
      'https://images.unsplash.com/photo-1626785774573-4b799315345d?auto=format&fit=crop&w=400&q=80',
      'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=400&q=80',
      'https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&w=400&q=80'
    ],
    exclusivePhotos: [
      'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=400&q=80',
      'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?auto=format&fit=crop&w=400&q=80'
    ]
  },
  {
    id: 'liam',
    name: 'Liam Sterling',
    gender: 'Male',
    specialty: 'Spatial Sound Designer',
    distance: '0.5km',
    avatar: '/boy-avatar.jpg',
    activeProject: 'Acoustic maps of Tribeca',
    x: 24,
    y: 42,
    status: 'active',
    badgeType: 'sparkle',
    activityDetail: 'Active Now',
    skillTags: ['Sound Design', 'Motion Graphics', 'Curator'],
    portfolioPhotos: [
      'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=400&q=80',
      'https://images.unsplash.com/photo-1516280440614-37939bbacd6a?auto=format&fit=crop&w=400&q=80',
      'https://images.unsplash.com/photo-1598653222000-6b7b7a552625?auto=format&fit=crop&w=400&q=80'
    ],
    exclusivePhotos: [
      'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=400&q=80',
      'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=400&q=80'
    ]
  }
];

export const ONBOARDING_SLIDES: OnboardingSlide[] = [
  {
    id: 1,
    label: 'ESTABLISHED COMMUNITY',
    headline: 'Where stories converge.',
    highlightedText: 'stories.',
    subtext: 'Discover a community where every encounter is an opportunity for inspiration. Connect with nearby minds.',
    image: 'https://images.unsplash.com/photo-1513829096999-4978602294fc?auto=format&fit=crop&w=1200&q=80', // Gallery/art atmosphere
    theme: 'glass',
    sideBadge: {
      title: 'Connected with Marcus',
      subtitle: 'Just now in Tribeca',
      icon: 'sparkle'
    }
  },
  {
    id: 2,
    label: 'CURATED STORIES',
    headline: 'Discover her world.',
    highlightedText: 'her world.',
    subtext: 'Step into a curated collection of moments, thoughts, and artistic visions shared by the people who move culture forward.',
    image: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=800&q=80', // Portrait female
    theme: 'light',
    sideBadge: {
      title: 'Curated Stories',
      subtitle: 'Daily inspiration',
      icon: 'auto_awesome'
    }
  },
  {
    id: 3,
    label: 'ESTABLISHED COMMUNITY',
    headline: 'Find your rhythm.',
    highlightedText: 'rhythm.',
    subtext: 'Join a design-conscious community that values intimacy and inspiration. Discover people who move at your pace.',
    image: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=800&q=80', // Premium portrait male turtleneck style
    theme: 'dark',
    sideBadge: {
      title: 'New Inspiration',
      subtitle: '32 creators active nearby',
      icon: 'bolt'
    }
  }
];

export const TRENDING_SKILLS = [
  'Architecture',
  'UI Design',
  'Motion Graphics',
  'Product Strategy',
  'Fine Art',
  'Typography',
  'Curator'
];

export interface StoryItem {
  id: string;
  mediaUrl: string;
  timestamp: string;
  caption?: string;
  layout?: 'portrait' | 'square';
}

export interface Story {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorAvatar: string;
  items: StoryItem[];
  viewers: { name: string; avatar: string }[];
  audience?: 'everyone' | 'followers';
  authorUid?: string;
  authorName?: string;
  authorAvatar?: string;
  viewsCount?: number;
  mediaUrl?: string;
  text?: string;
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  text?: string;
  mediaUrl?: string;
  timestamp: string;
  isRead: boolean;
  deletedFor?: string[];
  unsent?: boolean;
  seenBy?: string[];
}

export interface ChatThread {
  id: string;
  name: string;
  avatar?: string;
  isGroup: boolean;
  members: string[]; // Creator IDs
  admins?: string[]; // Admin Creator IDs
  onlyAdminCanSend?: boolean; // True if only admins are allowed to send messages
  openMessaging?: boolean; // True if anyone can message this group
  allowMessagesFromAnyone?: boolean;
  messages: Message[];
  isLocked: boolean; // True if not mutual match (for direct messaging)
  participantUids?: string[];
  participants?: string[];
  otherCreatorId?: string;
  visibility?: 'public' | 'private';
  isPublic?: boolean;
  enableInChatAds?: boolean;
  lastMessageAt?: any;
  lastMessageText?: string;
  lastMessageSenderName?: string;
  lastMessageSenderAvatar?: string;
  unreadCount?: number;
  type?: 'group' | 'individual';
  groupAvatar?: string;
  typing?: any;
}

export interface NotificationItem {
  id: string;
  type: 'like' | 'match' | 'follow' | 'spark' | 'system';
  title: string;
  description: string;
  timestamp: string;
  avatar?: string;
  isRead: boolean;
}

export interface UserProfile {
  id: string;
  uid?: string;
  name: string;
  displayName?: string;
  username: string;
  bio: string;
  age: number;
  gender: string;
  interests: string[];
  photos: string[];
  isVerified: boolean;
  isPremium: boolean;
  isCreator: boolean;
  isAdmin?: boolean;
  role?: string;
  creatorTokens: number;
  creatorSubscribers: number;
  followersCount?: number;
  blockedUsers: string[];
  reportedUsers: { creatorId: string; reason: string }[];
  avatarUrl?: string;
  portfolioPhotos?: string[];
  
  // Onboarding profile setup fields
  profileCompleted?: boolean;
  hasCompletedProfileSetup?: boolean;
  skippedProfileSetup?: boolean;
  coverPhotoUrl?: string;
  fullName?: string;
  dateOfBirth?: string;
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
  allowMessagesFromAnyone?: boolean;
}

// Seed data for Stories
export const MOCK_STORIES: Story[] = [
  {
    id: 'story-elena',
    creatorId: 'elena',
    creatorName: 'Elena Vance',
    creatorAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80',
    items: [
      {
        id: 'item-1',
        mediaUrl: 'https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?auto=format&fit=crop&w=800&q=80',
        timestamp: '2h ago',
        caption: 'Morning site visit at the vertical forest! 🏗️🌿'
      }
    ],
    viewers: []
  },
  {
    id: 'story-julian',
    creatorId: 'julian',
    creatorName: 'Julian Ray',
    creatorAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80',
    items: [
      {
        id: 'item-2',
        mediaUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80',
        timestamp: '4h ago',
        caption: 'Latest NFT render preview. Colors coming along nicely. 🎨✨'
      }
    ],
    viewers: []
  }
];

// Seed data for Chat Threads
export const MOCK_CHATS: ChatThread[] = [];

// Seed data for Notifications
export const MOCK_NOTIFICATIONS: NotificationItem[] = [];

// Initial default user profile state
export const INITIAL_USER_PROFILE: UserProfile = {
  id: 'me',
  name: 'Alex Mercer',
  username: 'alexmercer',
  bio: 'Visual artist and interactive web designer. Exploring the intersection of high-contrast brutalist styling, vector fields, and local creative collaboration. Let us build something real.',
  age: 26,
  gender: 'Non-binary',
  interests: ['UI Design', 'Fine Art', 'Typography', 'Creative Coding'],
  photos: [
    'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=400&q=80',
    'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&q=80',
    'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=400&q=80'
  ],
  isVerified: true,
  isPremium: false,
  isCreator: false,
  creatorTokens: 420,
  creatorSubscribers: 18,
  blockedUsers: [],
  reportedUsers: [],
  profileCompleted: true
};
