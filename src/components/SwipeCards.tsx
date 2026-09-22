import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Heart, X, Sparkles, MapPin, CheckCircle2, AlertCircle, 
  ChevronRight, RefreshCw, Filter, ArrowRight, MessageSquare, Eye,
  Bookmark, ChevronLeft, Flame, ChevronUp, ChevronDown, Check,
  Lock, Layers, Crown, UserCheck, Plus, Info, CornerDownRight, Share2, ArrowLeft, Flag
} from 'lucide-react';
import { Creator, TRENDING_SKILLS, ChatThread, Story } from '../data';
import { calculateLovePercentage } from '../utils/streak';
import { getUserAvatar, getDefaultAvatar } from '../utils/avatar';
import AdPlacement from './AdPlacement';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { DiscoverCardSkeleton, ProgressiveImage } from './Skeletons';
import {
  getRankedCandidates, 
  buildInterleavedFeed, 
  trackProfileImpression, 
  recordProfileVisit, 
  checkAccountSuggestionNotification,
  calculateCandidateScore,
  buildLikedTagsMap
} from '../utils/discoveryRanking';

interface SwipeCardsProps {
  creators: Creator[];
  chats: ChatThread[];
  stories: Story[];
  isGuest: boolean;
  onNavigateToLogin?: () => void;
  onNavigateHome?: () => void;
  onMatchCreated?: (creator: Creator) => void;
  onBlockUser?: (creatorId: string) => void;
  onReportUser?: (creatorId: string, reason: string) => void;
  onOpenReportModal?: (target: {
    targetType: 'user' | 'story' | 'group' | 'message';
    targetId: string;
    targetName?: string;
    targetUsername?: string;
    targetAvatar?: string;
    targetContent?: string;
  }) => void;
  onCardSwiped?: () => void;
  onChatShortcut?: (creatorId: string) => void;
  onStoryShortcut?: (creatorId: string) => void;
  savedCreatorIds?: string[];
  onToggleBookmark?: (creatorId: string) => void;
  onToggleFollow?: (creator: Creator) => void;
  outgoingFollows?: {[creatorId: string]: string};
  onSelectCreator?: (creator: Creator) => void;
}

export default function SwipeCards({ 
  creators, 
  chats,
  stories,
  isGuest, 
  onNavigateToLogin, 
  onNavigateHome,
  onMatchCreated,
  onBlockUser,
  onReportUser,
  onOpenReportModal,
  onCardSwiped,
  onChatShortcut,
  onStoryShortcut,
  savedCreatorIds = [],
  onToggleBookmark,
  onToggleFollow,
  outgoingFollows = {},
  onSelectCreator
}: SwipeCardsProps) {
  const { userProfile, currentUser } = useAuth();
  
  // Discover Feed Tabs: 'for_you' vs 'matches'
  const [activeTab, setActiveTab] = useState<'for_you' | 'matches'>('for_you');

  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | 'up' | null>(null);
  const [matchedCreator, setMatchedCreator] = useState<Creator | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [isReportSubmitted, setIsReportSubmitted] = useState(false);

  // Photo carousel, bookmarks, detail sheet expansion
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [savedProfiles, setSavedProfiles] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  // Expanded tab sections & Lightbox
  const [activeSection, setActiveSection] = useState<'stories' | 'photos' | 'streak'>('stories');
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);

  const handleSubscribe = () => {
    if (isGuest) {
      if (onNavigateToLogin) onNavigateToLogin();
      return;
    }
    setIsSubscribing(true);
    setTimeout(() => {
      setIsSubscribing(false);
      setIsSubscribed(true);
    }, 1200);
  };

  const [isFollowing, setIsFollowing] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [selectedLightboxImage, setSelectedLightboxImage] = useState<string | null>(null);

  // Following list UIDs
  const followingIds = useMemo(() => Object.keys(outgoingFollows || {}), [outgoingFollows]);

  // Messaged users list UIDs
  const messagedUserIds = useMemo(() => {
    const uids = new Set<string>();
    chats.forEach(c => {
      if (c.participantUids) {
        c.participantUids.forEach(uid => uids.add(uid));
      } else if (c.otherCreatorId) {
        uids.add(c.otherCreatorId);
      }
    });
    return Array.from(uids);
  }, [chats]);

  // Swiped / liked / blocked creator IDs
  const swipedIds = useMemo(() => [
    ...(userProfile?.swipedCreatorIds || []),
    ...(userProfile?.likedCreatorIds || [])
  ], [userProfile]);

  const blockedIds = useMemo(() => userProfile?.blockedUsers || [], [userProfile]);
  const matchedIds = useMemo(() => userProfile?.matchedCreatorIds || [], [userProfile]);

  // 1. RANK CANDIDATES ALGORITHM
  const rankedCandidates = useMemo(() => {
    // Filter creators by tags if tag chips selected
    let candidates = creators;
    if (selectedTags.length > 0) {
      candidates = creators.filter(creator =>
        creator.skillTags?.some(tag => selectedTags.includes(tag))
      );
    }

    if (activeTab === 'matches') {
      const viewerUid = currentUser?.uid || userProfile?.uid || userProfile?.id;
      const viewerEmail = userProfile?.email?.toLowerCase();
      // Matches tab: sort by Love % / mutual connections and exclude self
      return [...candidates]
        .filter(c => c.id !== viewerUid && (viewerEmail ? c.email?.toLowerCase() !== viewerEmail : true))
        .sort((a, b) => {
          const loveA = calculateLovePercentage(userProfile?.interests || [], a.skillTags || []);
          const loveB = calculateLovePercentage(userProfile?.interests || [], b.skillTags || []);
          return loveB - loveA;
        });
    }

    // "For You" tab: Apply ranking algorithm with signals
    const likedCreators = creators.filter(c => (userProfile?.likedCreatorIds || []).includes(c.id));
    return getRankedCandidates(
      candidates,
      userProfile,
      swipedIds,
      likedCreators,
      blockedIds,
      matchedIds,
      followingIds
    );
  }, [creators, selectedTags, activeTab, userProfile, swipedIds, blockedIds, matchedIds, followingIds]);

  // 2. INTERLEAVE STORIES IN DISCOVER FEED
  const feedItems = useMemo(() => {
    if (activeTab === 'matches') {
      return rankedCandidates.map(c => ({ type: 'creator' as const, data: c }));
    }
    return buildInterleavedFeed(
      rankedCandidates,
      stories || [],
      followingIds,
      messagedUserIds,
      userProfile?.interests || []
    );
  }, [rankedCandidates, stories, followingIds, messagedUserIds, userProfile?.interests, activeTab]);

  const currentItem = feedItems[currentIndex];
  const activeCreator = currentItem?.type === 'creator' ? currentItem.data : null;
  const activeFeedStory = currentItem?.type === 'story' ? currentItem.data : null;

  // Track Impression on display
  useEffect(() => {
    if (activeCreator?.id) {
      trackProfileImpression(activeCreator.id);
    }
  }, [activeCreator?.id]);

  // Reset photo index, expanded details, and active section ONLY when active profile/item ID changes
  useEffect(() => {
    setActivePhotoIdx(0);
    setIsExpanded(false);
    setIsSubscribed(false);
    setActiveSection('stories');
  }, [currentItem?.data?.id]);

  // Synchronize follow state when active creator or outgoingFollows changes
  useEffect(() => {
    if (activeCreator && outgoingFollows) {
      setIsFollowing(!!outgoingFollows[activeCreator.id]);
    } else {
      setIsFollowing(false);
    }
  }, [activeCreator?.id, outgoingFollows]);

  // Synchronize Likes count for active creator
  useEffect(() => {
    if (!activeCreator) {
      setLikesCount(0);
      return;
    }

    const q = query(collection(db, "likes"), where("postId", "==", activeCreator.id));
    const unsub = onSnapshot(q, (snap) => {
      setLikesCount(snap.size);
    }, (err) => {
      console.warn("Likes count listener error in SwipeCards:", err);
      setLikesCount(0);
    });

    return () => unsub();
  }, [activeCreator?.id]);

  const handleAction = (direction: 'left' | 'right' | 'up') => {
    if (isGuest && activeCreator) {
      setShowAuthModal(true);
      return;
    }

    setSwipeDirection(direction);

    setTimeout(() => {
      setSwipeDirection(null);

      if ((direction === 'right' || direction === 'up') && activeCreator) {
        const isMatch = Math.random() > 0.3;
        if (isMatch) {
          setMatchedCreator(activeCreator);
          if (onMatchCreated) {
            onMatchCreated(activeCreator);
          }
        }
      }

      setCurrentIndex((prev) => prev + 1);
      if (onCardSwiped) {
        onCardSwiped();
      }
    }, 350);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
    setCurrentIndex(0);
  };

  const handleReport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportReason || !activeCreator) return;
    if (onReportUser) {
      onReportUser(activeCreator.id, reportReason);
    }
    setIsReportSubmitted(true);
    setTimeout(() => {
      setShowReportForm(false);
      setIsReportSubmitted(false);
      setReportReason('');
      setCurrentIndex(prev => prev + 1);
    }, 1200);
  };

  const handleBlock = () => {
    if (!activeCreator) return;
    if (onBlockUser) {
      onBlockUser(activeCreator.id);
    }
    setCurrentIndex(prev => prev + 1);
  };

  const toggleBookmark = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleBookmark) {
      onToggleBookmark(id);
    } else {
      setSavedProfiles(prev =>
        prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
      );
    }
  };

  const handleProfileOpen = (creator: Creator) => {
    if (currentUser?.uid) {
      recordProfileVisit(currentUser.uid, creator.id, userProfile);
    }
    if (onSelectCreator) {
      onSelectCreator(creator);
    } else {
      setIsExpanded(true);
    }
  };

  const creatorPhotos = activeCreator
    ? [activeCreator.avatar, ...(activeCreator.portfolioPhotos || [])]
    : [];

  const lovePercent = activeCreator
    ? calculateLovePercentage(userProfile?.interests || [], activeCreator.skillTags)
    : 65;

  const activeStory = activeCreator
    ? stories.find(s => s.creatorId === activeCreator.id)
    : undefined;

  // Interest tags logic for overlay
  const candidateTags = activeCreator?.skillTags || [];
  const visibleTags = candidateTags.slice(0, 3);
  const extraTagsCount = Math.max(0, candidateTags.length - 3);

  return (
    <div className="w-full h-full flex flex-col justify-between font-sans text-white overflow-hidden bg-[#0A0A0A] select-none relative" style={{ overscrollBehaviorY: 'contain' }}>
      
      {/* 1. TOP HEADER BAR: Back Arrow + For You / Matches Tabs */}
      <div
        className="absolute top-0 inset-x-0 z-50 flex items-center justify-between px-5 pb-2 bg-gradient-to-b from-black/80 via-black/40 to-transparent"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
      >
        <button
          onClick={() => {
            if (onNavigateHome) {
              onNavigateHome();
            } else if (typeof window !== 'undefined' && window.history.length > 1) {
              window.history.back();
            }
          }}
          className="w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 border border-white/10 flex items-center justify-center text-white backdrop-blur-md transition-all cursor-pointer active:scale-90"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        {/* Center Tabs: For You / Matches (Centered with Absolute) */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-6 z-10">
          <button
            onClick={() => {
              setActiveTab('for_you');
              setCurrentIndex(0);
            }}
            className={`text-sm font-black tracking-wide transition-colors cursor-pointer py-1 ${
              activeTab === 'for_you' ? 'text-[#E5FF3B]' : 'text-slate-400 hover:text-white'
            }`}
          >
            For You
          </button>

          <button
            onClick={() => {
              setActiveTab('matches');
              setCurrentIndex(0);
            }}
            className={`text-sm font-black tracking-wide transition-colors cursor-pointer py-1 ${
              activeTab === 'matches' ? 'text-[#E5FF3B]' : 'text-slate-400 hover:text-white'
            }`}
          >
            Matches
          </button>
        </div>

        {/* Right Action Buttons: Bookmark + Report */}
        <div className="flex items-center gap-2">
          {/* Report Button */}
          {activeCreator && onOpenReportModal && (
            <button
              id="swipe_report_btn"
              onClick={(e) => {
                e.stopPropagation();
                onOpenReportModal({
                  targetType: 'user',
                  targetId: activeCreator.id,
                  targetName: activeCreator.name,
                  targetUsername: activeCreator.username,
                  targetAvatar: activeCreator.avatar
                });
              }}
              title="Report User Profile"
              className="w-10 h-10 rounded-full bg-black/40 hover:bg-rose-500/20 hover:border-rose-500/40 border border-white/10 flex items-center justify-center text-white/80 hover:text-rose-400 backdrop-blur-md transition-all cursor-pointer active:scale-90"
            >
              <Flag className="w-4 h-4" />
            </button>
          )}

          {/* Bookmark button */}
          <button
            id="swipe_bookmark_btn"
            onClick={(e) => activeCreator && toggleBookmark(activeCreator.id, e)}
            className="w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 border border-white/10 flex items-center justify-center text-white backdrop-blur-md transition-all cursor-pointer active:scale-90"
          >
            <Bookmark
              className={`w-5 h-5 transition-all ${
                activeCreator && (savedCreatorIds.includes(activeCreator.id) || savedProfiles.includes(activeCreator.id))
                  ? 'text-[#E5FF3B] fill-current'
                  : 'text-white'
              }`}
            />
          </button>
        </div>
      </div>

      {/* FULL-SCREEN SWIPER DECK AREA */}
      <div className="absolute inset-0 w-full h-full z-10 flex items-center justify-center">
        <AnimatePresence mode="popLayout">

          {/* FULL-BLEED EDGE-TO-EDGE PROFILE CARD */}
          {activeCreator && (
            <motion.div
              key={activeCreator.id}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{
                scale: 1,
                opacity: 1,
                x: swipeDirection === 'left' ? -400 : swipeDirection === 'right' ? 400 : 0,
                y: swipeDirection === 'up' ? -500 : 0,
                rotate: swipeDirection === 'left' ? -15 : swipeDirection === 'right' ? 15 : 0,
                zIndex: 100
              }}
              exit={{
                opacity: 0,
                scale: 0.95,
                zIndex: 0,
                transition: { duration: 0.2 }
              }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              drag={!isExpanded}
              dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
              dragElastic={0.6}
              onDragEnd={(event, info) => {
                const threshold = 110;
                if (info.offset.x > threshold) {
                  handleAction('right');
                } else if (info.offset.x < -threshold) {
                  handleAction('left');
                } else if (info.offset.y < -threshold) {
                  handleAction('up');
                } else if (info.offset.y > threshold) {
                  if (isExpanded) {
                    setIsExpanded(false);
                  } else {
                    handleProfileOpen(activeCreator);
                  }
                }
              }}
              className="absolute inset-0 w-full h-full flex flex-col justify-between overflow-hidden bg-[#0A0A0A]"
            >
              {/* FULL-BLEED BACKGROUND IMAGE */}
              <div
                className="absolute inset-0 w-full h-full bg-[#0A0A0A] overflow-hidden cursor-pointer"
                onClick={() => {
                  if (!isExpanded) {
                    handleProfileOpen(activeCreator);
                  }
                }}
              >
                <img
                  src={creatorPhotos[activePhotoIdx] || activeCreator.avatar}
                  alt={activeCreator.name}
                  className="w-full h-full object-cover select-none transition-transform duration-500"
                />

                {/* Photo browsing tap targets (left 30% / right 30%) */}
                {!isExpanded && (
                  <>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        if (activePhotoIdx > 0) {
                          setActivePhotoIdx(prev => prev - 1);
                        }
                      }}
                      className="absolute left-0 top-0 bottom-0 w-[30%] z-20 cursor-w-resize"
                    />
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        if (activePhotoIdx < creatorPhotos.length - 1) {
                          setActivePhotoIdx(prev => prev + 1);
                        }
                      }}
                      className="absolute right-0 top-0 bottom-0 w-[30%] z-20 cursor-e-resize"
                    />
                  </>
                )}

                {/* Full dark gradient overlay for bottom text contrast */}
                <div className="absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-black via-black/70 to-transparent pointer-events-none z-10" />
              </div>

              {/* OVERLAY BOTTOM INFORMATION & ACTION ROW */}
              {!isExpanded && (
                <div
                  className="relative z-20 w-full px-5 pt-2 mb-0 mt-auto flex flex-col justify-end text-left space-y-4 pointer-events-auto"
                  style={{ paddingBottom: 'calc(82px + var(--sab))' }}
                >

                  <div className="space-y-0.5 cursor-pointer" onClick={() => handleProfileOpen(activeCreator)}>
                    <div className="flex items-center gap-2">
                      <h2 className="text-2xl font-black text-white tracking-tight leading-tight">
                        {activeCreator.name}, {activeCreator.age || 27}
                      </h2>
                      <div className="w-3.5 h-3.5 bg-[#E5FF3B] rounded-full shadow-[0_0_8px_#E5FF3B]" />
                    </div>

                    <div className="flex items-center gap-1.5 text-[12px] text-zinc-400 font-bold">
                      <MapPin className="w-3.5 h-3.5 text-[#E5FF3B]" />
                      <span>{activeCreator.distance || "Nearby"} • Washington, D.C.</span>
                    </div>

                    {activeCreator.activeProject && (
                      <p className="text-[11.5px] text-slate-200 font-medium italic line-clamp-1 pt-1 opacity-90">
                        "{activeCreator.activeProject}"
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                    {visibleTags.map(tag => (
                      <span
                        key={tag}
                        className="text-[10px] font-bold text-white bg-zinc-800/80 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/10 whitespace-nowrap"
                      >
                        {tag}
                      </span>
                    ))}
                    {extraTagsCount > 0 && (
                      <span className="text-[10px] font-bold text-[#E5FF3B] bg-[#E5FF3B]/10 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-[#E5FF3B]/20 whitespace-nowrap">
                        +{extraTagsCount}
                      </span>
                    )}
                  </div>

                  {/* 3. CONSOLIDATED ACTION ROW: X | SEND MESSAGE | HEART */}
                  <div className="flex items-center gap-3 w-full pt-1">
                    {/* Skip "X" Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAction('left');
                      }}
                      className="w-13 h-13 bg-black/40 border border-white/10 text-rose-500 rounded-full flex items-center justify-center hover:bg-rose-600 hover:text-white shadow-lg transition-all cursor-pointer active:scale-90 shrink-0 backdrop-blur-xl"
                      title="Skip"
                    >
                      <X className="w-6 h-6" />
                    </button>

                    {/* Send Message Center Pill */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isGuest) {
                          setShowAuthModal(true);
                        } else if (onChatShortcut) {
                          onChatShortcut(activeCreator.id);
                        }
                      }}
                      className="flex-1 h-13 bg-[#E5FF3B] text-black font-black text-[13px] uppercase tracking-wider rounded-full shadow-[0_0_20px_rgba(229,255,59,0.25)] flex items-center justify-center gap-2.5 hover:bg-[#dff03b]/90 transition-all cursor-pointer active:scale-95"
                    >
                      <MessageSquare className="w-4.5 h-4.5 text-black" />
                      <span>Send Message</span>
                    </button>

                    {/* Like "Heart" Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAction('right');
                      }}
                      className="w-13 h-13 bg-black/40 border border-white/10 text-[#E5FF3B] rounded-full flex items-center justify-center hover:bg-[#E5FF3B] hover:text-black shadow-lg transition-all cursor-pointer active:scale-90 shrink-0 backdrop-blur-xl"
                      title="Like Profile"
                    >
                      <Heart className="w-6 h-6 fill-current" />
                    </button>
                  </div>

                </div>
              )}

              {/* EXPANDED DETAILED PROFILE MODAL SHEET */}
              {isExpanded && (
                <div className="absolute inset-0 z-50 overflow-y-auto custom-scrollbar flex flex-col bg-[#1A1A1A] text-white">

                  {/* Top Cover Banner */}
                  <div className="relative w-full h-64 bg-black flex-shrink-0">
                    <img src={creatorPhotos[activePhotoIdx] || activeCreator.avatar} alt="" className="w-full h-full object-cover" />
                    <button
                      onClick={() => setIsExpanded(false)}
                      className="absolute top-6 left-6 w-10 h-10 bg-black/60 text-white rounded-full flex items-center justify-center cursor-pointer border border-white/20 shadow-lg"
                    >
                      <X className="w-6 h-6" />
                    </button>
                  </div>

                  <div className="px-6 pb-4 flex flex-col relative -mt-10 z-10 flex-shrink-0 text-left">
                    <div className="flex justify-between items-end mb-3">
                      <div className="w-20 h-20 rounded-full p-[3px] bg-[#E5FF3B] shadow bg-black">
                        <img
                          src={activeCreator.avatar}
                          alt={activeCreator.name}
                          className="w-full h-full rounded-full object-cover"
                        />
                      </div>

                      <div className="flex items-center gap-1.5 bg-[#1E1E1E] border border-[#2A2A2A] px-3 py-1 rounded-full text-[10px] font-bold text-[#A1A1AA] mb-1 shadow-sm">
                        <MapPin className="w-3.5 h-3.5 text-[#E5FF3B]" />
                        <span>{activeCreator.distance || "Nearby"}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mb-0.5">
                      <h2 className="text-xl font-black tracking-tight text-white">{activeCreator.name}, {activeCreator.age || 27}</h2>
                      <CheckCircle2 className="w-4.5 h-4.5 text-[#E5FF3B] fill-current" />
                    </div>

                    <p className="text-[10.5px] text-[#E5FF3B] font-extrabold uppercase tracking-widest mb-3">
                      {activeCreator.specialty} • {activeCreator.activityDetail || 'Active Creator'}
                    </p>

                    <div className="bg-[#1E1E1E] border border-[#2A2A2A] p-3 rounded-2xl text-[11.5px] text-[#A1A1AA] font-semibold italic mb-3.5 leading-relaxed">
                      "{activeCreator.activeProject}"
                    </div>

                    <div className="flex items-center gap-2.5 w-full">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isGuest) {
                            setShowAuthModal(true);
                          } else if (onToggleFollow && activeCreator) {
                            onToggleFollow(activeCreator);
                          } else {
                            setIsFollowing(!isFollowing);
                          }
                        }}
                        className={`flex-1 h-10 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer ${
                          isFollowing
                            ? 'bg-[#1E1E1E] text-white hover:bg-[#2A2A2A] border border-[#2A2A2A]'
                            : 'bg-[#E5FF3B] text-black font-extrabold hover:bg-[#d8f030]'
                        }`}
                      >
                        {isFollowing ? (
                          <>
                            <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Following</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-3.5 h-3.5 text-black" />
                            <span>Follow</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isGuest) {
                            setShowAuthModal(true);
                          } else if (onChatShortcut) {
                            onChatShortcut(activeCreator.id);
                          }
                        }}
                        className="flex-1 h-10 bg-[#1E1E1E] hover:bg-[#2A2A2A] border border-[#2A2A2A] text-white text-[10px] font-black uppercase tracking-wider rounded-full flex items-center justify-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-[#E5FF3B]" />
                        <span>Chat</span>
                      </button>
                    </div>
                  </div>

                  {/* TAB SWITCHER */}
                  <div className="flex border-b border-[#2A2A2A] px-6 bg-[#1A1A1A] sticky top-0 z-20">
                    {[
                      { id: 'stories', label: 'Stories' },
                      { id: 'photos', label: 'Photos' },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveSection(tab.id as any)}
                        className={`py-2.5 px-4 text-[11px] font-extrabold uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
                          activeSection === tab.id
                            ? 'border-[#E5FF3B] text-[#E5FF3B]'
                            : 'border-transparent text-[#B5B5B5] hover:text-white'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* TAB CONTENT WITH TAP-TO-EXPAND LIGHTBOX */}
                  <div className="p-6 space-y-4 text-left flex-1">
                    {activeSection === 'stories' && (
                      <div className="grid grid-cols-2 gap-3">
                        {activeStory?.items.map((item) => (
                          <div
                            key={item.id}
                            onClick={() => setSelectedLightboxImage(item.mediaUrl)}
                            className="h-36 bg-[#121212] rounded-xl overflow-hidden border border-[#2A2A2A] relative group cursor-pointer"
                          >
                            <img src={item.mediaUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 text-[9px] text-white/90 font-bold">
                              {item.caption || 'Tap to expand'}
                            </div>
                          </div>
                        ))}
                        {(!activeStory || activeStory.items.length === 0) && (
                          <p className="text-xs text-[#B5B5B5] col-span-2 py-4">No active stories available today.</p>
                        )}
                      </div>
                    )}

                    {activeSection === 'photos' && (
                      <div className="grid grid-cols-3 gap-2.5">
                        {creatorPhotos.map((photoUrl, idx) => (
                          <div
                            key={idx}
                            onClick={() => setSelectedLightboxImage(photoUrl)}
                            className="aspect-square bg-[#121212] rounded-xl overflow-hidden border border-[#2A2A2A] relative group cursor-pointer"
                          >
                            <img src={photoUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                          </div>
                        ))}
                      </div>
                    )}

                    {activeSection === 'exclusive' && (
                      <div className="space-y-3">
                        {isSubscribed ? (
                          <div className="grid grid-cols-2 gap-2.5">
                            {(activeCreator.exclusivePhotos || creatorPhotos).map((url, idx) => (
                              <div
                                key={idx}
                                onClick={() => setSelectedLightboxImage(url)}
                                className="h-32 bg-[#121212] rounded-xl overflow-hidden border border-[#2A2A2A] relative group cursor-pointer"
                              >
                                <img src={url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-5 border border-[#2A2A2A] rounded-2xl bg-[#121212] text-center space-y-3">
                            <Lock className="w-6 h-6 text-[#E5FF3B] mx-auto" />
                            <p className="text-xs font-bold text-white">Subscribe to unlock exclusive content</p>
                            <button
                              onClick={handleSubscribe}
                              disabled={isSubscribing}
                              className="px-5 py-2.5 bg-[#E5FF3B] text-black font-extrabold text-xs uppercase rounded-full cursor-pointer shadow"
                            >
                              {isSubscribing ? "Unlocking..." : "Unlock • $4.99/mo"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* INTERSPERSED STORY CARD ITEM */}
          {activeFeedStory && !activeCreator && (
            <motion.div
              key={activeFeedStory.id}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{
                scale: 1,
                opacity: 1,
                x: swipeDirection === 'left' ? -400 : swipeDirection === 'right' ? 400 : 0,
                y: swipeDirection === 'up' ? -500 : 0,
                zIndex: 100
              }}
              exit={{
                opacity: 0,
                scale: 0.95,
                zIndex: 0,
                transition: { duration: 0.2 }
              }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              drag
              dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
              dragElastic={0.6}
              onDragEnd={(event, info) => {
                const threshold = 80;
                if (info.offset.x > threshold || info.offset.x < -threshold || info.offset.y < -threshold) {
                  setCurrentIndex(prev => prev + 1);
                } else if (info.offset.y > threshold && currentIndex > 0) {
                  setCurrentIndex(prev => prev - 1);
                }
              }}
              className="absolute inset-0 w-full h-full bg-[#0A0A0A] flex flex-col justify-between overflow-hidden z-40 text-left"
            >
              {/* Story Header */}
              <div className="p-5 pt-16 flex items-center justify-between border-b border-white/10 z-10 bg-black/60 backdrop-blur-md">
                <div className="flex items-center gap-3">
                  <img
                    src={activeFeedStory.authorAvatar || getDefaultAvatar()}
                    alt=""
                    className="w-10 h-10 rounded-full object-cover border border-[#E5FF3B]"
                  />
                  <div>
                    <h4 className="text-sm font-black text-white">{activeFeedStory.authorName || 'Creator Story'}</h4>
                    <span className="text-[9px] text-[#E5FF3B] font-extrabold uppercase tracking-widest block">Featured Story</span>
                  </div>
                </div>

                <span className="text-[9px] font-bold text-slate-400 bg-white/10 px-2.5 py-1 rounded-full">
                  Story #{currentIndex + 1}
                </span>
              </div>

              {/* Story Media & Overlay */}
              <div
                className="flex-1 relative bg-black overflow-hidden cursor-pointer"
                onClick={() => {
                  if (onStoryShortcut && activeFeedStory.authorUid) {
                    onStoryShortcut(activeFeedStory.authorUid);
                  } else if (activeFeedStory.items?.[0]?.mediaUrl) {
                    setSelectedLightboxImage(activeFeedStory.items[0].mediaUrl);
                  }
                }}
              >
                <img
                  src={activeFeedStory.items?.[0]?.mediaUrl || activeFeedStory.mediaUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80'}
                  alt="Story"
                  className="w-full h-full object-cover"
                />

                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/60 to-transparent p-6 text-left space-y-3 pb-12">
                  <p className="text-sm text-white font-semibold leading-relaxed">
                    {activeFeedStory.items?.[0]?.caption || activeFeedStory.text || "Tap to watch full story"}
                  </p>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onStoryShortcut && activeFeedStory.authorUid) {
                        onStoryShortcut(activeFeedStory.authorUid);
                      }
                    }}
                    className="w-full py-3.5 bg-[#E5FF3B] text-black font-black text-xs uppercase tracking-wider rounded-full shadow-lg flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all"
                  >
                    <Eye className="w-4 h-4 text-black" />
                    <span>Watch Full Story</span>
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* INTERSPERSED FULL-SCREEN NATIVE AD CARD */}
          {currentItem?.type === 'ad' && (
            <motion.div
              key={currentItem.data.id}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{
                scale: 1,
                opacity: 1,
                x: swipeDirection === 'left' ? -400 : swipeDirection === 'right' ? 400 : 0,
                y: swipeDirection === 'up' ? -500 : 0,
              }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              drag
              dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
              dragElastic={0.6}
              onDragEnd={(event, info) => {
                const threshold = 80;
                if (info.offset.x > threshold || info.offset.x < -threshold || info.offset.y < -threshold) {
                  setCurrentIndex(prev => prev + 1);
                } else if (info.offset.y > threshold && currentIndex > 0) {
                  setCurrentIndex(prev => prev - 1);
                }
              }}
              className="absolute inset-0 w-full h-full bg-[#0D0D0D] flex flex-col justify-between overflow-hidden z-40 relative text-left"
            >
              <AdPlacement
                placement="discover_swipe"
                format="fullscreen-card"
                adIndex={currentItem.data.adIndex}
              />
            </motion.div>
          )}

          {/* EMPTY FEED REFRESH STATE */}
          {currentIndex >= feedItems.length && (
            <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-3xl p-8 text-center space-y-4 shadow-2xl my-auto text-left max-w-sm mx-auto z-40">
              <div className="w-14 h-14 bg-[#E5FF3B]/10 text-[#E5FF3B] rounded-full flex items-center justify-center mx-auto">
                <RefreshCw className="w-7 h-7" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-black text-white">You're All Caught Up!</h3>
                <p className="text-xs text-slate-400 font-medium leading-relaxed max-w-xs mx-auto mt-1">
                  You've reviewed all available creator profiles and active stories.
                </p>
              </div>
              <button
                onClick={() => setCurrentIndex(0)}
                className="w-full bg-[#E5FF3B] hover:bg-[#E5FF3B]/90 text-black text-xs font-black py-3.5 rounded-full shadow-lg transition-all cursor-pointer uppercase tracking-wider"
              >
                Re-shuffle Discover Feed
              </button>
            </div>
          )}

        </AnimatePresence>
      </div>

      {/* LIGHTBOX MODAL OVERLAY */}
      <AnimatePresence>
        {selectedLightboxImage && (
          <div
            className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex items-center justify-center p-4 select-none"
            onClick={() => setSelectedLightboxImage(null)}
          >
            <button
              onClick={() => setSelectedLightboxImage(null)}
              className="absolute top-6 right-6 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center cursor-pointer border border-white/20 shadow-lg z-10"
            >
              <X className="w-6 h-6" />
            </button>
            <motion.img
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              src={selectedLightboxImage}
              alt="Expanded view"
              className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
