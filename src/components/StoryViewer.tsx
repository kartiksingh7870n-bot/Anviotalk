import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  ChevronLeft, 
  ChevronRight, 
  ChevronUp, 
  ChevronDown, 
  Eye, 
  MessageSquare, 
  Send, 
  Heart, 
  Share2, 
  Trash2, 
  UserPlus, 
  UserCheck, 
  MessageCircle,
  Globe,
  Lock,
  Flag
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  doc, 
  updateDoc, 
  addDoc, 
  deleteDoc, 
  setDoc, 
  arrayUnion, 
  arrayRemove, 
  increment, 
  serverTimestamp,
  where
} from 'firebase/firestore';
import ShareLinkModal from './ShareLinkModal';
import { recordMonetizationView } from '../utils/recordProfileView';
import { getUserAvatar, getDefaultAvatar } from '../utils/avatar';
import { PRODUCTION_URL } from '../utils/deeplink';
import AdPlacement from './AdPlacement';

export interface StoryDoc {
  id: string;
  authorUid: string;
  authorUsername: string;
  authorName: string;
  authorAvatar: string;
  mediaUrl: string;
  mediaType?: 'image' | 'video';
  caption?: string;
  audience?: 'everyone' | 'followers';
  createdAt: any;
  expiresAt: any;
  likes?: string[];
  likesCount?: number;
  commentsCount?: number;
  sharesCount?: number;
  viewedBy?: string[];
}

export interface UserStoriesGroup {
  authorUid: string;
  authorName: string;
  authorUsername: string;
  authorAvatar: string;
  stories: StoryDoc[];
}

interface StoryViewerProps {
  initialStoryId?: string;
  initialUserUid?: string;
  stories?: any[]; // Backward compatibility prop
  initialStoryIndex?: number; // Backward compatibility prop
  onClose: () => void;
  onOpenChat?: (authorUid: string) => void;
  onAddView?: (storyId: string) => void;
  onDeleteStory?: (storyId: string, itemId: string) => void;
  onOpenReportModal?: (target: {
    targetType: 'user' | 'story' | 'group' | 'message';
    targetId: string;
    targetName?: string;
    targetUsername?: string;
    targetAvatar?: string;
    targetContent?: string;
  }) => void;
}

export default function StoryViewer({ 
  initialStoryId, 
  initialUserUid, 
  stories: propStories, 
  initialStoryIndex, 
  onClose, 
  onOpenChat,
  onAddView,
  onDeleteStory,
  onOpenReportModal
}: StoryViewerProps) {
  const { currentUser, userProfile, isGuest } = useAuth();

  const [userGroups, setUserGroups] = useState<UserStoriesGroup[]>([]);
  const [currentUserIdx, setCurrentUserIdx] = useState(0);
  const [currentStoryIdx, setCurrentStoryIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [videoDuration, setVideoDuration] = useState(6000); // Default 6s

  // Comments state
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [newCommentText, setNewCommentText] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);

  // Share Modal
  const [showShareModal, setShowShareModal] = useState(false);

  // Follow state for current user
  const [isFollowingAuthor, setIsFollowingAuthor] = useState(false);

  // Swipe Touch Coordinates
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const [followsMap, setFollowsMap] = useState<{ [uid: string]: boolean }>({});

  // Subscribe to follows map for ordering user story groups
  useEffect(() => {
    if (!currentUser?.uid) return;
    try {
      const q = query(collection(db, 'follows'));
      const unsub = onSnapshot(q, (snapshot) => {
        const follows: { [targetUid: string]: boolean } = {};
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (data.fromUid === currentUser.uid) {
            follows[data.toUid] = true;
          }
        });
        setFollowsMap(follows);
      });
      return () => unsub();
    } catch (err) {
      console.warn("Follows map listener error in viewer:", err);
    }
  }, [currentUser?.uid]);

  // 1. Subscribe to active stories from Firestore
  useEffect(() => {
    try {
      const q = query(collection(db, 'stories'), orderBy('createdAt', 'asc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const now = new Date();
        const activeDocs: StoryDoc[] = [];

        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          let isExpired = false;
          if (data.expiresAt) {
            const expDate = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
            if (expDate <= now) isExpired = true;
          } else if (data.createdAt) {
            const createdDate = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
            if (now.getTime() - createdDate.getTime() > 24 * 60 * 60 * 1000) isExpired = true;
          }

          if (!isExpired) {
            activeDocs.push({
              id: docSnap.id,
              authorUid: data.authorUid || 'anonymous',
              authorUsername: data.authorUsername || 'user',
              authorName: data.authorName || 'Anonymous',
              authorAvatar: data.authorAvatar || getDefaultAvatar(),
              mediaUrl: data.mediaUrl || '',
              mediaType: data.mediaType || 'image',
              caption: data.caption || '',
              audience: data.audience || 'everyone',
              createdAt: data.createdAt,
              expiresAt: data.expiresAt,
              likes: data.likes || [],
              likesCount: data.likesCount || (data.likes ? data.likes.length : 0),
              commentsCount: data.commentsCount || 0,
              sharesCount: data.sharesCount || 0,
              viewedBy: data.viewedBy || []
            });
          }
        });

        // Group by authorUid
        const groupedMap: { [uid: string]: UserStoriesGroup } = {};
        activeDocs.forEach((s) => {
          if (!groupedMap[s.authorUid]) {
            groupedMap[s.authorUid] = {
              authorUid: s.authorUid,
              authorName: s.authorName,
              authorUsername: s.authorUsername,
              authorAvatar: s.authorAvatar,
              stories: []
            };
          }
          groupedMap[s.authorUid].stories.push(s);
        });

        const rawGroups = Object.values(groupedMap);

        // Sort groups: News -> Following -> Recommended/Public
        const isNewsGroup = (g: UserStoriesGroup) => {
          const nameLower = g.authorName.toLowerCase();
          const unameLower = g.authorUsername.toLowerCase();
          return nameLower.includes('news') || unameLower.includes('news') || unameLower.includes('anvio') || unameLower.includes('official');
        };

        const newsGroups = rawGroups.filter(isNewsGroup);
        const newsUids = new Set(newsGroups.map(g => g.authorUid));

        const followingGroups = rawGroups.filter(g => 
          !newsUids.has(g.authorUid) && (followsMap[g.authorUid] === true || g.authorUid === currentUser?.uid)
        );
        const followingUids = new Set(followingGroups.map(g => g.authorUid));

        const recommendedGroups = rawGroups.filter(g => 
          !newsUids.has(g.authorUid) && !followingUids.has(g.authorUid)
        );

        const groupsList = [...newsGroups, ...followingGroups, ...recommendedGroups];
        
        // Interleave ad story slides after every 2 user stories
        const groupsListWithAds = groupsList.map((group) => {
          const interleavedStories: StoryDoc[] = [];
          group.stories.forEach((story, idx) => {
            interleavedStories.push(story);
            if ((idx + 1) % 2 === 0 && idx < group.stories.length - 1) {
              interleavedStories.push({
                id: `ad-story-${group.authorUid}-${idx}`,
                authorUid: 'sponsored-ad',
                authorUsername: 'sponsored',
                authorName: 'Sponsored Ad',
                authorAvatar: 'https://res.cloudinary.com/dpvpnwhm4/image/upload/v1785045725/Anvio_Talk_logo_ofe2a0.png',
                mediaUrl: '',
                mediaType: 'image',
                caption: 'Sponsored Content',
                audience: 'everyone',
                createdAt: null,
                expiresAt: null,
                likes: [],
                likesCount: 0,
                commentsCount: 0,
                sharesCount: 0,
                viewedBy: []
              });
            }
          });
          return { ...group, stories: interleavedStories };
        });

        setUserGroups(groupsListWithAds);

        // Determine starting user and story indices if not set yet
        if (groupsList.length > 0) {
          let targetUserIdx = 0;
          let targetStoryIdx = 0;

          const searchStoryId = initialStoryId || (propStories && initialStoryIndex !== undefined ? propStories[initialStoryIndex]?.id : null);
          const searchUid = initialUserUid;

          if (searchStoryId) {
            groupsList.forEach((group, uIdx) => {
              const sIdx = group.stories.findIndex(st => st.id === searchStoryId || st.id.includes(searchStoryId!));
              if (sIdx !== -1) {
                targetUserIdx = uIdx;
                targetStoryIdx = sIdx;
              }
            });
          } else if (searchUid) {
            const uIdx = groupsList.findIndex(g => g.authorUid === searchUid);
            if (uIdx !== -1) targetUserIdx = uIdx;
          }

          setCurrentUserIdx((prev) => Math.min(prev, Math.max(0, groupsList.length - 1)));
          if (currentUserIdx === 0 && currentStoryIdx === 0) {
            setCurrentUserIdx(targetUserIdx);
            setCurrentStoryIdx(targetStoryIdx);
          }
        }
      }, (err) => {
        console.warn('Stories listener notice:', err);
      });

      return () => unsubscribe();
    } catch (err) {
      console.warn('Stories setup error:', err);
    }
  }, [initialStoryId, initialUserUid, followsMap]);

  const activeGroup = userGroups[currentUserIdx];
  const activeStory = activeGroup?.stories[currentStoryIdx];

  // 2. Preload adjacent story media for smooth performance (Requirement 11)
  useEffect(() => {
    if (!activeGroup) return;

    const urlsToPreload: string[] = [];
    
    // Current story
    if (activeStory?.mediaUrl) urlsToPreload.push(activeStory.mediaUrl);

    // Next story same user
    if (activeGroup.stories[currentStoryIdx + 1]?.mediaUrl) {
      urlsToPreload.push(activeGroup.stories[currentStoryIdx + 1].mediaUrl);
    }
    // Prev story same user
    if (activeGroup.stories[currentStoryIdx - 1]?.mediaUrl) {
      urlsToPreload.push(activeGroup.stories[currentStoryIdx - 1].mediaUrl);
    }
    // Next user story
    if (userGroups[currentUserIdx + 1]?.stories[0]?.mediaUrl) {
      urlsToPreload.push(userGroups[currentUserIdx + 1].stories[0].mediaUrl);
    }

    urlsToPreload.forEach(url => {
      if (url && typeof window !== 'undefined') {
        const img = new Image();
        img.src = url;
      }
    });
  }, [currentUserIdx, currentStoryIdx, userGroups]);

  // 3. Auto-view tracking (Requirement 9 & 11 Scalability)
  useEffect(() => {
    if (!activeStory || !currentUser?.uid || activeStory.authorUid === 'sponsored-ad') return;
    
    const recordView = async () => {
      try {
        // Record verified monetization view (₹40/1k views). Anti-fraud: server-side bot rate limit,
        // 24h dedup and self/guest exclusion. Fire-and-forget; Firestore writes below power the UI.
        recordMonetizationView('story', activeStory.authorUid, currentUser.uid, activeStory.id);

        const viewId = `${currentUser.uid}_${activeStory.id}`;
        const viewRef = doc(db, 'stories', activeStory.id, 'views', currentUser.uid);

        // We use setDoc to avoid duplicates automatically
        await setDoc(viewRef, {
          viewerUid: currentUser.uid,
          viewerName: userProfile?.displayName || 'User',
          viewedAt: serverTimestamp()
        }, { merge: true });

        // Increment total view count in parent doc safely
        if (!activeStory.viewedBy?.includes(currentUser.uid)) {
          const storyRef = doc(db, 'stories', activeStory.id);
          await updateDoc(storyRef, {
            viewedBy: arrayUnion(currentUser.uid),
            viewCount: increment(1)
          });

          // Create notification for the author (only if first time view)
          if (activeStory.authorUid !== currentUser.uid) {
            const notifRef = doc(collection(db, "notifications", activeStory.authorUid, "items"));
            await setDoc(notifRef, {
              type: "story_view",
              fromUid: currentUser.uid,
              fromUsername: userProfile?.username || "user",
              fromAvatar: getUserAvatar(userProfile),
              createdAt: serverTimestamp(),
              read: false,
              title: "Story View! 👀",
              description: `@${userProfile?.username || 'user'} viewed your story.`,
              targetId: activeStory.id,
              mediaUrl: activeStory.mediaUrl
            });
          }
        }
      } catch (err) {
        console.warn('View recording error:', err);
      }
    };

    recordView();

    if (onAddView) {
      onAddView(activeStory.id);
    }
  }, [activeStory?.id, currentUser?.uid]);

  // 4. Live follow status listener for current story author
  useEffect(() => {
    if (!activeStory?.authorUid || !currentUser?.uid || activeStory.authorUid === currentUser.uid) {
      setIsFollowingAuthor(false);
      return;
    }

    try {
      const followDocRef = doc(db, 'follows', `${currentUser.uid}_${activeStory.authorUid}`);
      const unsub = onSnapshot(followDocRef, (docSnap) => {
        setIsFollowingAuthor(docSnap.exists());
      }, (err) => {
        console.warn("Follow status snapshot notice:", err);
      });
      return () => unsub();
    } catch (e) {
      // Ignore
    }
  }, [activeStory?.authorUid, currentUser?.uid]);

  // 5. Live comments listener for active story
  useEffect(() => {
    if (!activeStory?.id) return;

    try {
      const unsub = onSnapshot(
        collection(db, 'stories', activeStory.id, 'comments'),
        (snapshot) => {
          const loaded: any[] = [];
          snapshot.forEach((docSnap) => {
            loaded.push({ id: docSnap.id, ...docSnap.data() });
          });
          // In-memory sort by createdAt
          loaded.sort((a, b) => {
            const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
            const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
            return timeA - timeB;
          });
          setComments(loaded);
        },
        (err) => {
          console.warn("Comments snapshot notice:", err);
        }
      );
      return () => unsub();
    } catch (e) {
      setComments([]);
    }
  }, [activeStory?.id]);

  // 6. Progress bar timer & auto-advance
  useEffect(() => {
    if (showComments || isPaused || !activeStory) return;

    setProgress(0);
    const intervalMs = 60;
    const totalMs = activeStory.mediaType === 'video' ? videoDuration : 6000;
    const step = (intervalMs / totalMs) * 100;

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(timer);
          handleNextStorySameUser();
          return 0;
        }
        return prev + step;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [currentUserIdx, currentStoryIdx, showComments, isPaused, activeStory?.id]);

  // 7. 2D Navigation handlers
  // Swipe Left / Next story from same user (Requirement 6)
  const handleNextStorySameUser = () => {
    setShowComments(false);
    if (!activeGroup) return;

    if (currentStoryIdx < activeGroup.stories.length - 1) {
      setCurrentStoryIdx(currentStoryIdx + 1);
      setProgress(0);
    } else if (currentUserIdx < userGroups.length - 1) {
      // Advance to next user's first story
      setCurrentUserIdx(currentUserIdx + 1);
      setCurrentStoryIdx(0);
      setProgress(0);
    } else {
      onClose();
    }
  };

  // Swipe Right / Prev story from same user (Requirement 6)
  const handlePrevStorySameUser = () => {
    setShowComments(false);
    if (!activeGroup) return;

    if (currentStoryIdx > 0) {
      setCurrentStoryIdx(currentStoryIdx - 1);
      setProgress(0);
    } else if (currentUserIdx > 0) {
      const prevGroup = userGroups[currentUserIdx - 1];
      setCurrentUserIdx(currentUserIdx - 1);
      setCurrentStoryIdx(prevGroup.stories.length - 1);
      setProgress(0);
    } else {
      setProgress(0);
    }
  };

  // Swipe Up / Next user's stories (Requirement 6)
  const handleNextUser = () => {
    setShowComments(false);
    if (currentUserIdx < userGroups.length - 1) {
      setCurrentUserIdx(currentUserIdx + 1);
      setCurrentStoryIdx(0);
      setProgress(0);
    } else {
      onClose();
    }
  };

  // Swipe Down / Prev user's stories (Requirement 6)
  const handlePrevUser = () => {
    setShowComments(false);
    if (currentUserIdx > 0) {
      const prevGroup = userGroups[currentUserIdx - 1];
      setCurrentUserIdx(currentUserIdx - 1);
      setCurrentStoryIdx(prevGroup ? prevGroup.stories.length - 1 : 0);
      setProgress(0);
    } else {
      onClose();
    }
  };

  // Touch and Mouse gesture listener with long press handling
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isLongPressing, setIsLongPressing] = useState(false);

  const startLongPressTimer = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      setIsLongPressing(true);
      setIsPaused(true);
    }, 200); // 200ms holds to pause
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (isLongPressing) {
      setIsLongPressing(false);
      setIsPaused(false);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    startLongPressTimer();
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const hadLongPressed = isLongPressing;
    clearLongPressTimer();

    if (!touchStartRef.current) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    touchStartRef.current = null;

    // If long pressed, do not trigger swipe navigation
    if (hadLongPressed) return;

    const threshold = 35; // Gesture distance threshold

    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal swipe
      if (dx < -threshold) {
        // Swipe Left -> Next story same user (or next user if at end)
        handleNextStorySameUser();
      } else if (dx > threshold) {
        // Swipe Right -> Prev story same user (or prev user if at start)
        handlePrevStorySameUser();
      }
    } else {
      // Vertical swipe
      if (dy < -threshold) {
        // Swipe Up -> First story of NEXT profile
        handleNextUser();
      } else if (dy > threshold) {
        // Swipe Down -> Last story of PREVIOUS profile
        handlePrevUser();
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    touchStartRef.current = { x: e.clientX, y: e.clientY };
    startLongPressTimer();
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const hadLongPressed = isLongPressing;
    clearLongPressTimer();

    if (!touchStartRef.current) return;
    const dx = e.clientX - touchStartRef.current.x;
    const dy = e.clientY - touchStartRef.current.y;
    touchStartRef.current = null;

    if (hadLongPressed) return;

    const threshold = 35; // Gesture distance threshold

    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal swipe
      if (dx < -threshold) {
        // Swipe Left -> Next story same user
        handleNextStorySameUser();
      } else if (dx > threshold) {
        // Swipe Right -> Prev story same user
        handlePrevStorySameUser();
      }
    } else {
      // Vertical swipe
      if (dy < -threshold) {
        // Swipe Up -> First story of NEXT profile
        handleNextUser();
      } else if (dy > threshold) {
        // Swipe Down -> Last story of PREVIOUS profile
        handlePrevUser();
      }
    }
  };

  // Keyboard arrow listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showComments) return;
      if (e.key === 'ArrowRight') handleNextStorySameUser();
      if (e.key === 'ArrowLeft') handlePrevStorySameUser();
      if (e.key === 'ArrowUp') handleNextUser();
      if (e.key === 'ArrowDown') handlePrevUser();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentUserIdx, currentStoryIdx, userGroups, showComments]);

  // 8. Real Firebase Interaction Handlers (Requirement 9)
  // Toggle Like
  const handleToggleLike = async () => {
    if (!activeStory || !currentUser?.uid) return;
    const isLiked = activeStory.likes?.includes(currentUser.uid);

    try {
      const storyRef = doc(db, 'stories', activeStory.id);
      if (isLiked) {
        await updateDoc(storyRef, {
          likes: arrayRemove(currentUser.uid),
          likesCount: increment(-1)
        });
      } else {
        await updateDoc(storyRef, {
          likes: arrayUnion(currentUser.uid),
          likesCount: increment(1)
        });

        // Create notification for the author
        if (activeStory.authorUid !== currentUser.uid) {
          const notifRef = doc(collection(db, "notifications", activeStory.authorUid, "items"));
          await setDoc(notifRef, {
            type: "story_like",
            fromUid: currentUser.uid,
            fromUsername: userProfile?.username || "user",
            fromAvatar: getUserAvatar(userProfile),
            createdAt: serverTimestamp(),
            read: false,
            title: "Story Liked! ❤️",
            description: `@${userProfile?.username || 'user'} liked your story.`,
            targetId: activeStory.id,
            mediaUrl: activeStory.mediaUrl
          });
        }
      }
    } catch (err) {
      console.warn('Like toggle error:', err);
    }
  };

  // Add Comment
  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim() || !activeStory || !currentUser?.uid || isPostingComment) return;

    setIsPostingComment(true);
    const text = newCommentText.trim();
    setNewCommentText('');

    // Optimistic comment addition
    const optimisticComment = {
      id: `temp-${Date.now()}`,
      authorUid: currentUser.uid,
      authorName: userProfile?.displayName || userProfile?.fullName || userProfile?.name || 'You',
      authorUsername: userProfile?.username || 'user',
      authorAvatar: getUserAvatar(userProfile),
      text: text,
      createdAt: new Date()
    };
    setComments((prev) => [...prev, optimisticComment]);

    try {
      await addDoc(collection(db, 'stories', activeStory.id, 'comments'), {
        authorUid: currentUser.uid,
        authorName: userProfile?.displayName || userProfile?.fullName || 'Anonymous',
        authorUsername: userProfile?.username || 'user',
        authorAvatar: getUserAvatar(userProfile),
        text: text,
        createdAt: serverTimestamp()
      });

      await updateDoc(doc(db, 'stories', activeStory.id), {
        commentsCount: increment(1)
      }).catch(err => console.warn('Could not update story commentsCount:', err));

      // Create notification for the author
      if (activeStory.authorUid !== currentUser.uid) {
        const notifRef = doc(collection(db, "notifications", activeStory.authorUid, "items"));
        await setDoc(notifRef, {
          type: "story_comment",
          fromUid: currentUser.uid,
          fromUsername: userProfile?.username || "user",
          fromAvatar: getUserAvatar(userProfile),
          createdAt: serverTimestamp(),
          read: false,
          title: "New Story Comment! 💬",
          description: `@${userProfile?.username || 'user'} replied to your story: ${text.substring(0, 30)}${text.length > 30 ? '...' : ''}`,
          targetId: activeStory.id,
          mediaUrl: activeStory.mediaUrl
        });
      }
    } catch (err: any) {
      console.warn('Comment post error:', err);
    } finally {
      setIsPostingComment(false);
    }
  };

  // Delete Comment
  const handleDeleteComment = async (commentId: string) => {
    if (!activeStory?.id) return;
    try {
      await deleteDoc(doc(db, 'stories', activeStory.id, 'comments', commentId));
      await updateDoc(doc(db, 'stories', activeStory.id), {
        commentsCount: increment(-1)
      });
    } catch (err) {
      console.warn('Comment delete error:', err);
    }
  };

  // Toggle Follow
  const handleToggleFollow = async () => {
    if (!activeStory?.authorUid || !currentUser?.uid || activeStory.authorUid === currentUser.uid) return;

    try {
      const followDocRef = doc(db, 'follows', `${currentUser.uid}_${activeStory.authorUid}`);
      if (isFollowingAuthor) {
        await deleteDoc(followDocRef);
      } else {
        await setDoc(followDocRef, {
          fromUid: currentUser.uid,
          toUid: activeStory.authorUid,
          status: 'accepted',
          createdAt: serverTimestamp()
        });
      }
    } catch (err) {
      console.warn('Follow toggle error:', err);
    }
  };

  // Trigger Share
  const handleShareStory = async () => {
    if (!activeStory) return;
    setShowShareModal(true);

    try {
      await updateDoc(doc(db, 'stories', activeStory.id), {
        sharesCount: increment(1)
      });
    } catch (err) {
      // Ignore
    }
  };

  // Trigger Message
  const handleOpenMessage = () => {
    if (!activeStory?.authorUid) return;
    onClose();
    if (onOpenChat) {
      onOpenChat(activeStory.authorUid);
    }
  };

  // Delete Own Story Snap
  const handleDeleteCurrentStory = async () => {
    if (!activeStory) return;
    if (!window.confirm("Are you sure you want to delete this story snap?")) return;

    try {
      await deleteDoc(doc(db, 'stories', activeStory.id));
      if (onDeleteStory) {
        onDeleteStory(activeStory.id, activeStory.id);
      }
    } catch (err) {
      console.warn('Story delete error:', err);
    }
  };

  if (!activeStory || !activeGroup) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center text-white text-xs font-bold p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#854c6f] border-t-transparent rounded-full animate-spin" />
          <span>Loading Story...</span>
        </div>
      </div>
    );
  }

  const isOwnStory = currentUser?.uid === activeStory.authorUid;
  const isLikedByMe = activeStory.likes?.includes(currentUser?.uid || '');
  const timeFormatted = activeStory.createdAt?.seconds 
    ? new Date(activeStory.createdAt.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    : 'Recently';

  return (
    <AnimatePresence>
      <div 
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex flex-col items-center justify-center select-none"
      >
        {/* Main Phone-style Viewer Container */}
        <div className="relative w-full max-w-[480px] h-full max-h-[900px] flex flex-col justify-between p-4 bg-zinc-950 overflow-hidden md:rounded-[2.5rem] shadow-2xl border border-zinc-800">
          
          {/* Top Indicators & Bar */}
          <div 
            className="absolute left-4 right-4 z-50 flex flex-col gap-3 pointer-events-none"
            style={{ top: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
          >
            
            {/* Segmented Progress Indicators for current user's stories */}
            <div className="flex gap-1 w-full pointer-events-auto">
              {activeGroup.stories.map((s, idx) => (
                <div key={s.id} className="h-1 bg-white/20 rounded-full flex-1 overflow-hidden">
                  <div 
                    className="h-full bg-white transition-all duration-[60ms]" 
                    style={{ 
                      width: 
                        idx < currentStoryIdx 
                          ? '100%' 
                          : idx === currentStoryIdx 
                            ? `${progress}%` 
                            : '0%' 
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Profile Row */}
            <div className="flex justify-between items-center pointer-events-auto">
              <div className="flex items-center gap-2.5">
                <img 
                  src={activeStory.authorAvatar || getDefaultAvatar()} 
                  alt={activeStory.authorName} 
                  className="w-9 h-9 rounded-full object-cover border border-white/20 shadow-md"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-[13px] font-bold text-white tracking-tight drop-shadow-sm">
                      {activeStory.authorName}
                    </h4>
                    <span className="text-[10px] text-zinc-400 font-medium">@{activeStory.authorUsername}</span>
                    <span className="flex items-center gap-0.5 text-[8px] font-bold text-zinc-400 bg-white/10 px-1.5 py-0.5 rounded">
                      {activeStory.audience === 'followers' ? (
                        <>
                          <Lock className="w-2 h-2 text-[#854c6f]" />
                          <span>Followers</span>
                        </>
                      ) : (
                        <>
                          <Globe className="w-2 h-2 text-emerald-400" />
                          <span>Everyone</span>
                        </>
                      )}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-400 font-semibold drop-shadow-sm">{timeFormatted}</p>
                </div>
              </div>

              {/* Action Buttons: Follow, Delete, Close */}
              <div className="flex items-center gap-2">
                {!isOwnStory && !isGuest && (
                  <button
                    onClick={handleToggleFollow}
                    className={`text-[10px] font-black px-3 py-1 rounded-full border transition-all cursor-pointer flex items-center gap-1 ${
                      isFollowingAuthor 
                        ? 'bg-white/20 text-white border-white/20' 
                        : 'bg-[#854c6f] text-white border-[#854c6f] hover:bg-[#854c6f]/90'
                    }`}
                  >
                    {isFollowingAuthor ? (
                      <>
                        <UserCheck className="w-3 h-3" />
                        <span>Following</span>
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-3 h-3" />
                        <span>Follow</span>
                      </>
                    )}
                  </button>
                )}

                {!isOwnStory && onOpenReportModal && (
                  <button
                    id="story_report_btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsPaused(true);
                      onOpenReportModal({
                        targetType: 'story',
                        targetId: activeStory.id,
                        targetName: activeStory.authorName || 'Story Author',
                        targetUsername: activeStory.authorUsername || '',
                        targetAvatar: activeStory.authorAvatar || '',
                        targetContent: activeStory.caption || 'Story Photo'
                      });
                    }}
                    className="w-8 h-8 rounded-full bg-black/40 hover:bg-rose-500/30 text-white/80 hover:text-rose-400 flex items-center justify-center transition-colors border border-white/10 outline-none cursor-pointer"
                    title="Report Inappropriate Story"
                  >
                    <Flag className="w-3.5 h-3.5" />
                  </button>
                )}

                {isOwnStory && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteCurrentStory();
                    }}
                    className="w-8 h-8 rounded-full bg-black/40 hover:bg-rose-600 text-white flex items-center justify-center transition-colors border border-white/10 outline-none cursor-pointer"
                    title="Delete Story Snap"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}

                <button 
                  onClick={onClose}
                  className="w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition-colors border border-white/10 outline-none cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

          </div>

          {/* Interactive Tap Zones for Desktop / Touch */}
          <div className="absolute inset-0 flex">
            {/* Left Tap -> prev story same user */}
            <div className="w-[30%] h-full z-30 cursor-pointer" onClick={handlePrevStorySameUser} />
            {/* Center Area -> toggle pause */}
            <div className="w-[40%] h-full z-30" onClick={() => setIsPaused(!isPaused)} />
            {/* Right Tap -> next story same user */}
            <div className="w-[30%] h-full z-30 cursor-pointer" onClick={handleNextStorySameUser} />
          </div>

          {/* Story Visual Media */}
          <div className="absolute inset-0 z-10 bg-zinc-950 flex items-center justify-center">
            {activeStory.id.startsWith('ad-story-') || activeStory.authorUid === 'sponsored-ad' ? (
              <div className="w-full h-full p-2 flex items-center justify-center bg-black">
                <AdPlacement placement="story_viewer" format="fullscreen-card" adIndex={currentStoryIdx} />
              </div>
            ) : (
              <>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeStory.id}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.04 }}
                    transition={{ duration: 0.25 }}
                    className="w-full h-full"
                  >
                    {activeStory.mediaType === 'video' ? (
                      <video
                        src={activeStory.mediaUrl}
                        className="w-full h-full object-cover"
                        autoPlay
                        muted={false}
                        playsInline
                        onLoadedMetadata={(e) => {
                          const dur = e.currentTarget.duration * 1000;
                          setVideoDuration(dur);
                        }}
                        onPlay={() => setIsPaused(false)}
                        onPause={() => setIsPaused(true)}
                        onEnded={handleNextStorySameUser}
                      />
                    ) : (
                      <img
                        src={activeStory.mediaUrl}
                        alt="Story item"
                        className="w-full h-full object-cover"
                      />
                    )}
                  </motion.div>
                </AnimatePresence>
                {/* Bottom gradient overlay */}
                <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/90 via-black/40 to-transparent z-20 pointer-events-none" />
              </>
            )}
          </div>

          {/* Desktop Chevron Navigation Controls */}
          <button 
            onClick={handlePrevStorySameUser}
            className="absolute left-[-60px] top-1/2 -translate-y-1/2 hidden md:flex w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white items-center justify-center border border-white/10 transition-colors cursor-pointer z-50"
            title="Previous Story (Same User)"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button 
            onClick={handleNextStorySameUser}
            className="absolute right-[-60px] top-1/2 -translate-y-1/2 hidden md:flex w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white items-center justify-center border border-white/10 transition-colors cursor-pointer z-50"
            title="Next Story (Same User)"
          >
            <ChevronRight className="w-6 h-6" />
          </button>

          {/* Desktop User Switch Navigation Chevrons */}
          <button 
            onClick={handlePrevUser}
            disabled={currentUserIdx === 0}
            className="absolute top-4 right-[-60px] hidden md:flex w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white items-center justify-center border border-white/10 transition-colors cursor-pointer disabled:opacity-30 z-50"
            title="Previous User"
          >
            <ChevronUp className="w-6 h-6" />
          </button>
          <button 
            onClick={handleNextUser}
            disabled={currentUserIdx === userGroups.length - 1}
            className="absolute bottom-4 right-[-60px] hidden md:flex w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white items-center justify-center border border-white/10 transition-colors cursor-pointer disabled:opacity-30 z-50"
            title="Next User"
          >
            <ChevronDown className="w-6 h-6" />
          </button>

          {/* Bottom Controls Bar (Requirement 8) */}
          <div className="relative z-40 mt-auto p-4 pb-12 sm:pb-10 pb-safe flex flex-col gap-3">
            {activeStory.caption && (
              <p className="text-[13px] text-white/95 font-medium leading-relaxed drop-shadow-md text-center max-w-[95%] mx-auto bg-black/40 backdrop-blur-md p-2.5 rounded-2xl border border-white/10">
                {activeStory.caption}
              </p>
            )}

            {/* Bottom Actions Row: Like, Comment, Share, Follow, Message */}
            <div className="flex items-center justify-between gap-1.5 bg-black/60 backdrop-blur-xl px-3 py-2 rounded-full border border-white/15 text-white">
              
              {/* Like Button */}
              <button
                onClick={handleToggleLike}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full hover:bg-white/10 transition-all cursor-pointer text-xs font-black"
                title="Like Story"
              >
                <Heart className={`w-4 h-4 ${isLikedByMe ? 'fill-rose-500 text-rose-500' : 'text-white'}`} />
                <span>{activeStory.likesCount || 0}</span>
              </button>

              {/* Comment Button */}
              <button
                onClick={() => setShowComments(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full hover:bg-white/10 transition-all cursor-pointer text-xs font-black"
                title="View Comments"
              >
                <MessageSquare className="w-4 h-4 text-white" />
                <span>{activeStory.commentsCount || comments.length || 0}</span>
              </button>

              {/* Share Button */}
              <button
                onClick={handleShareStory}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full hover:bg-white/10 transition-all cursor-pointer text-xs font-black"
                title="Share Story"
              >
                <Share2 className="w-4 h-4 text-white" />
                <span>{activeStory.sharesCount || 0}</span>
              </button>

              {/* Follow / Following Button */}
              {!isOwnStory && (
                <button
                  onClick={handleToggleFollow}
                  className={`px-2.5 py-1.5 rounded-full text-[11px] font-black transition-all cursor-pointer ${
                    isFollowingAuthor 
                      ? 'bg-white/20 text-white' 
                      : 'bg-[#854c6f] text-white hover:bg-[#854c6f]/90'
                  }`}
                  title={isFollowingAuthor ? 'Following' : 'Follow User'}
                >
                  {isFollowingAuthor ? 'Following' : 'Follow'}
                </button>
              )}

              {/* Direct Message Button */}
              {!isOwnStory && (
                <button
                  onClick={handleOpenMessage}
                  className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                  title="Direct Message"
                >
                  <MessageCircle className="w-4.5 h-4.5" />
                </button>
              )}

              {/* Views indicator */}
              <div className="flex items-center gap-1 px-2 text-[10px] font-bold text-zinc-400">
                <Eye className="w-3.5 h-3.5" />
                <span>{activeStory.viewedBy?.length || 1}</span>
              </div>
            </div>

          </div>

          {/* Slide-Up Comments Drawer */}
          <AnimatePresence>
            {showComments && (
              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 220 }}
                className="absolute inset-x-0 bottom-0 h-[65%] bg-zinc-900/98 backdrop-blur-xl border-t border-zinc-800 rounded-t-[2.5rem] z-50 flex flex-col p-6 shadow-2xl"
              >
                {/* Drawer Header */}
                <div className="flex items-center justify-between mb-4 border-b border-zinc-800 pb-3">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-[#854c6f]" />
                    <span className="text-xs font-black text-white uppercase tracking-wider">
                      Comments ({comments.length})
                    </span>
                  </div>
                  <button 
                    onClick={() => setShowComments(false)}
                    className="w-7 h-7 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Comments List */}
                <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 scrollbar-thin scrollbar-thumb-zinc-800">
                  {comments.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-zinc-500 py-10 space-y-2">
                      <MessageSquare className="w-8 h-8 text-zinc-700" />
                      <p className="text-xs font-bold">No comments yet</p>
                      <p className="text-[10px]">Be the first to leave a comment on this story!</p>
                    </div>
                  ) : (
                    comments.map((comment) => (
                      <div key={comment.id} className="flex gap-2.5 items-start text-left bg-zinc-950/40 p-2.5 rounded-xl border border-zinc-800/40">
                        <img 
                          src={comment.authorAvatar || getDefaultAvatar()} 
                          alt={comment.authorName} 
                          className="w-7 h-7 rounded-full object-cover border border-zinc-800 flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-black text-white truncate">{comment.authorName}</span>
                            {comment.authorUid === currentUser?.uid && (
                              <button 
                                onClick={() => handleDeleteComment(comment.id)}
                                className="text-rose-400 hover:text-rose-300 p-1 cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <p className="text-xs text-zinc-300 font-medium mt-0.5 leading-normal whitespace-pre-line">
                            {comment.text}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Comment Input Form */}
                <form onSubmit={handlePostComment} className="mt-3 flex gap-2 items-center bg-zinc-950 border border-zinc-800 rounded-full px-4 py-1">
                  <input
                    type="text"
                    name="anviotalk-story-comment"
                    autoComplete="off"
                    autoCorrect="off"
                    value={newCommentText}
                    onChange={(e) => setNewCommentText(e.target.value)}
                    placeholder="Type a comment..."
                    className="flex-1 bg-transparent text-xs text-white placeholder-zinc-500 py-2 focus:outline-none"
                  />
                  <button 
                    type="submit"
                    disabled={isPostingComment || !newCommentText.trim()}
                    className="w-8 h-8 rounded-full bg-[#854c6f] hover:bg-[#854c6f]/90 text-white flex items-center justify-center transition-colors cursor-pointer disabled:opacity-40"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

        </div>

        {/* Share Link Modal */}
        <ShareLinkModal 
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          title={`${activeStory.authorName}'s Story`}
          description={activeStory.caption || `Check out this story snap on Anvio Talk.`}
          imageUrl={activeStory.mediaUrl}
          shareUrl={`${PRODUCTION_URL}?story=${activeStory.id}`}
        />

      </div>
    </AnimatePresence>
  );
}
