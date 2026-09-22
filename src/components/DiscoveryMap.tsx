import React, { useState, useEffect, useRef, useCallback, ErrorInfo, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  AlertCircle, Search, Bell, Plus, X, ArrowRight, Compass, Maximize2,
  MapPin, HelpCircle, Layers, Check, Sparkles, Zap, Palette, Map, Globe,
  Eye, Heart, MessageSquare, Flame, Trash2, Flag, Ban, BookOpen, User, Film, RotateCcw, Camera as LucideCamera,
  History, Settings, Mic, Hash
} from 'lucide-react';

import { requestNotificationPermissionAndRegisterToken } from '../utils/notifications';

import { 
  CREATORS, MOCK_STORIES, MOCK_CHATS, MOCK_NOTIFICATIONS, INITIAL_USER_PROFILE,
  Creator, Story, ChatThread, NotificationItem, UserProfile, TRENDING_SKILLS
} from '../data';

import SwipeCards from './SwipeCards';
import ChatWindow from './ChatWindow';
import ProfileTab from './ProfileTab';
import StoryViewer from './StoryViewer';
import ProfileDetailPopup from './ProfileDetailPopup';
import CreatorFeedCard from './CreatorFeedCard';
import NotificationsTab from './NotificationsTab';
import SearchScreen from './SearchScreen';
import StoriesFeedScreen from './StoriesFeedScreen';
import StoryEditor from './StoryEditor';
import { useAuth } from '../contexts/AuthContext';
import { Camera as CameraPlugin, CameraResultType, CameraSource } from '@capacitor/camera';
import { collection, query, orderBy, onSnapshot, where, serverTimestamp, doc, writeBatch, addDoc, setDoc, deleteDoc, limit } from "firebase/firestore";
import { db } from "../firebase";
import { getUserAvatar, getDefaultAvatar, resolveAvatarUrl } from "../utils/avatar";
import { PostCardSkeleton, StoryRowSkeleton } from './Skeletons';

import { triggerHapticMatch } from '../utils/haptics';

interface DiscoveryMapProps {
  viewport: 'desktop' | 'mobile';
  isGuest: boolean;
  onNavigateToLogin?: () => void;
  onNavigateToProfileSetup?: () => void;
  onRegisterOverlayHandler?: (handler: () => boolean) => void;
}

// Internal Error Boundary to pinpoint the crash source
class InternalDiscoveryMapBoundary extends React.Component<{children: ReactNode}, {hasError: boolean, error: Error | null}> {
  public state: {hasError: boolean, error: Error | null} = { hasError: false, error: null };
  public props!: {children: ReactNode};

  constructor(props: {children: ReactNode}) {
    super(props);
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("CRITICAL DISCOVERY MAP RENDER ERROR:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-black text-white p-10 text-center">
          <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center mb-6">
             <AlertCircle className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-xl font-bold mb-2">Component-Level Failure</h2>
          <p className="text-sm text-zinc-400 font-mono bg-zinc-900 p-4 rounded-xl mb-6">
            {this.state.error?.message || "Unknown rendering exception"}
          </p>
          <button onClick={() => window.location.reload()} className="h-11 px-8 bg-white text-black rounded-xl font-bold">Try Full Reset</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function DiscoveryMapMain({ viewport, isGuest, onNavigateToLogin, onNavigateToProfileSetup, onRegisterOverlayHandler }: DiscoveryMapProps) {
  const { currentUser, isFirebase, userProfile: fbUserProfile, isFirestoreAvailable } = useAuth();

  const [creators, setCreators] = useState<Creator[]>([]);
  const [isCreatorsLoading, setIsCreatorsLoading] = useState(true);
  const [creatorsError, setCreatorsError] = useState<string | null>(null);

  const [stories, setStories] = useState<Story[]>([]);
  const [isStoriesLoading, setIsStoriesLoading] = useState(true);

  const [chats, setChats] = useState<ChatThread[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [localMapProfile, setLocalMapProfile] = useState<UserProfile>(INITIAL_USER_PROFILE);
  const [toast, setToast] = useState<string | null>(null);
  const [outgoingFollows, setOutgoingFollows] = useState<{[uid: string]: string}>({});

  useEffect(() => {
    if (!isFirebase || !isFirestoreAvailable || !currentUser?.uid) {
      setOutgoingFollows({});
      return;
    }
    const q = query(collection(db, "follows"), where("fromUid", "==", currentUser.uid));
    return onSnapshot(q, (snapshot) => {
      const map: {[uid: string]: string} = {};
      snapshot.forEach(docSnap => {
        const d = docSnap.data();
        if (d.toUid) map[d.toUid] = d.status || "accepted";
      });
      setOutgoingFollows(map);
    });
  }, [isFirebase, isFirestoreAvailable, currentUser]);

  const handleToggleFollow = async (creator: Creator) => {
    if (isGuest) {
      if (onNavigateToLogin) onNavigateToLogin();
      return;
    }
    if (!currentUser?.uid || !creator?.id) return;
    const followId = `${currentUser.uid}_${creator.id}`;
    const followRef = doc(db, "follows", followId);
    try {
      if (outgoingFollows[creator.id]) {
        await deleteDoc(followRef);
        setToast(`Unfollowed ${creator.name}`);
      } else {
        await setDoc(followRef, {
          fromUid: currentUser.uid,
          toUid: creator.id,
          status: "accepted",
          createdAt: serverTimestamp()
        });
        setToast(`Following ${creator.name} 🤝`);
      }
    } catch (err) {
      console.error("Follow toggle error:", err);
    }
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    if (currentUser && !isGuest) {
      // 1. Request Camera and Gallery permissions
      const checkPermissions = async () => {
        try {
          const hasAsked = localStorage.getItem(`aura_permissions_asked_${currentUser.uid}`);
          if (hasAsked) return;

          console.log("[Permissions] Requesting Camera and Photos permissions...");
          const cameraStatus = await CameraPlugin.requestPermissions({ permissions: ['camera', 'photos'] });
          console.log("[Permissions] Result:", cameraStatus);

          localStorage.setItem(`aura_permissions_asked_${currentUser.uid}`, 'true');
        } catch (err) {
          console.warn("[Permissions] Automated request failed or cancelled:", err);
        }
      };

      // 2. Initialize Push Notifications & Register FCM Token
      const setupPush = async () => {
        console.log("[Push] Initializing system-level registration...");
        const success = await requestNotificationPermissionAndRegisterToken(currentUser.uid, (url) => {
          if (url) {
            // Handle deep link from notification tap
            const pathParts = url.split('/');
            if (pathParts[1] === 'group') handleNavigateToTab('chat', pathParts[2]);
            else if (pathParts[1] === 'profile') handleNavigateToTab('profile', pathParts[2]);
            else if (pathParts[1] === 'story') {
               // Story handling logic
            }
          }
        });
        console.log("[Push] Registration success:", success);
      };

      // Delay to allow UI to settle post-login
      const timer = setTimeout(() => {
        checkPermissions();
        setupPush();
      }, 2000);

      // Refresh FCM token periodically (every 5 minutes) to ensure server has latest
      const refreshInterval = setInterval(setupPush, 5 * 60 * 1000);

      return () => {
        clearTimeout(timer);
        clearInterval(refreshInterval);
      };
    }
  }, [currentUser, isGuest]);

  useEffect(() => {
    if (isFirebase && fbUserProfile) {
      setLocalMapProfile(fbUserProfile as any);
    }
  }, [isFirebase, fbUserProfile]);

  useEffect(() => {
    if (!isFirebase || !isFirestoreAvailable) {
      setCreators([]);
      setIsCreatorsLoading(false);
      return;
    }
    setIsCreatorsLoading(true);
    setCreatorsError(null);

    const q = query(collection(db, "users"), limit(30));
    return onSnapshot(q, (snapshot) => {
      const list: Creator[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data) {
          if (currentUser && data.uid === currentUser.uid) return;
          list.push({
            ...data,
            id: docSnap.id,
            name: data.displayName || "Anonymous",
            avatar: resolveAvatarUrl(data.avatarUrl || data.avatar, data.gender || data.authorGender)
          } as any);
        }
      });
      setCreators(list);
      setIsCreatorsLoading(false);
    }, (err) => {
      console.warn("Creators listener error:", err);
      setCreatorsError("Failed to fetch creator feed.");
      setIsCreatorsLoading(false);
    });
  }, [isFirebase, currentUser, isFirestoreAvailable]);

  useEffect(() => {
    if (!isFirebase || !isFirestoreAvailable) {
      setStories([]);
      setIsStoriesLoading(false);
      return;
    }
    setIsStoriesLoading(true);

    const q = query(collection(db, "stories"), limit(20));
    return onSnapshot(q, (snapshot) => {
      const now = new Date();
      const grouped: { [uid: string]: Story } = {};
      snapshot.forEach((docSnap) => {
        const s = docSnap.data();
        if (!s) return;

        // Expiration check: Only show stories from the last 24 hours
        let isExpired = false;
        if (s.expiresAt) {
          const expDate = s.expiresAt.toDate ? s.expiresAt.toDate() : new Date(s.expiresAt);
          if (expDate <= now) isExpired = true;
        } else if (s.createdAt) {
          const createdDate = s.createdAt.toDate ? s.createdAt.toDate() : new Date(s.createdAt);
          if (now.getTime() - createdDate.getTime() > 24 * 60 * 60 * 1000) isExpired = true;
        }
        if (isExpired) return;

        const cid = s.authorUid === currentUser?.uid ? 'me' : s.authorUid;
        if (!grouped[cid]) {
          // Resolve avatar to replace placeholders with new premium JPGs
          const processedAvatar = resolveAvatarUrl(s.authorAvatar, s.authorGender);
          grouped[cid] = { id: `story-${cid}`, creatorId: cid, creatorName: s.authorName || "Creator", creatorAvatar: processedAvatar, items: [], viewers: [] };
        }
        grouped[cid].items.push({ id: docSnap.id, mediaUrl: s.mediaUrl, timestamp: 'Just now', caption: s.caption });
      });
      setStories(Object.values(grouped));
      setIsStoriesLoading(false);
    }, (err) => {
      console.warn("Stories listener error:", err);
      setIsStoriesLoading(false);
    });
  }, [isFirebase, currentUser, isFirestoreAvailable]);

  // Real-time listener for user's chat threads (DMs and Groups)
  useEffect(() => {
    if (!isFirebase || !isFirestoreAvailable || !currentUser?.uid) {
      setChats([]);
      return;
    }

    const q = query(
      collection(db, "chats"),
      where("participants", "array-contains", currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatList: ChatThread[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        if (d.deletedBy && d.deletedBy.includes(currentUser.uid)) {
          return;
        }

        const isGroup = d.isGroup || false;
        let titleName = d.name || "Chat";
        let avatarSrc = d.avatar || d.groupAvatar || "";

        // Improved 1:1 Identity Resolution
        if (!isGroup) {
          const otherUid = (d.participants || []).find((p: string) => p !== currentUser.uid);
          if (otherUid) {
            const otherCreator = creators.find(c => c.id === otherUid);
            if (otherCreator) {
              titleName = otherCreator.name;
              avatarSrc = otherCreator.avatar;
            } else if (d.lastMessageSenderName && d.lastMessageSenderId !== currentUser.uid) {
              titleName = d.lastMessageSenderName;
              avatarSrc = d.lastMessageSenderAvatar;
            }
          }
        }

        chatList.push({
          id: docSnap.id,
          name: titleName,
          avatar: resolveAvatarUrl(avatarSrc),
          isGroup: isGroup,
          participants: d.participants || [],
          members: d.members || d.participants || [],
          admins: d.admins || [],
          lastMessageText: d.lastMessageText || "",
          lastMessageSenderName: d.lastMessageSenderName || "",
          lastMessageSenderAvatar: d.lastMessageSenderAvatar || "",
          lastMessageAt: d.lastMessageAt,
          unreadCount: d.unreadCount || 0,
          typing: d.typing || {},
          messages: []
        } as any);
      });

      // Stable In-Memory Sort (Handling pending serverTimestamp())
      chatList.sort((a, b) => {
        const timeA = a.lastMessageAt?.toMillis ? a.lastMessageAt.toMillis() : (a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : Date.now());
        const timeB = b.lastMessageAt?.toMillis ? b.lastMessageAt.toMillis() : (b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : Date.now());
        return timeB - timeA;
      });

      setChats(chatList);
    }, (err) => {
      console.warn("Chats listener error:", err);
    });

    return () => unsubscribe();
  }, [isFirebase, currentUser, isFirestoreAvailable]);

  // Real-time listener for user's notification items
  useEffect(() => {
    if (!isFirebase || !isFirestoreAvailable || !currentUser?.uid) {
      setNotifications([]);
      return;
    }

    const q = query(
      collection(db, "notifications", currentUser.uid, "items"),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: NotificationItem[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        list.push({
          id: docSnap.id,
          type: d.type || 'system',
          title: d.title || 'New Notification',
          description: d.description || '',
          timestamp: d.createdAt?.seconds
            ? new Date(d.createdAt.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : 'Just now',
          avatar: d.fromAvatar || '',
          isRead: d.read || false,
          fromUid: d.fromUid || '',
          status: d.status || 'pending'
        } as any);
      });
      setNotifications(list);
    }, (err) => {
      console.warn("Notifications listener error:", err);
    });

    return () => unsubscribe();
  }, [isFirebase, currentUser, isFirestoreAvailable]);

  const [activeTab, setActiveTab] = useState<'home' | 'discover' | 'stories' | 'chat' | 'profile' | 'notifications' | 'search'>(() => {
    try { return (localStorage.getItem('aura_active_tab') as any) || 'home'; } catch (e) { return 'home'; }
  });

  useEffect(() => { localStorage.setItem('aura_active_tab', activeTab); }, [activeTab]);

  const [activeStoryIdx, setActiveStoryIdx] = useState<number | null>(null);
  const [viewedStoryIds, setViewedStoryIds] = useState<string[]>([]);
  const [selectedProfileCreator, setSelectedProfileCreator] = useState<Creator | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  // New Story Flow State
  const [storyDraft, setStoryDraft] = useState<{ src: string; type: "image" | "video" } | null>(null);
  const [uploadingStory, setUploadingStory] = useState<{ progress: number; failed: boolean; thumbnail: string; caption: string; audience: "everyone" | "followers" } | null>(null);
  const [showStoryTypePrompt, setShowStoryTypePrompt] = useState(false);

  const handleNavigateToTab = (tab: 'home' | 'discover' | 'stories' | 'chat' | 'profile' | 'notifications' | 'search', chatId?: string) => {
    setActiveTab(tab);
    if (chatId) {
      setActiveChatId(chatId);
    }
  };

  const handleLaunchStory = (cid: string) => {
    const list = stories || [];
    const idx = list.findIndex(s => s && s.creatorId === cid);
    if (idx >= 0) setActiveStoryIdx(idx);
  };

  const handleMatchCreated = async (creator: Creator) => {
    if (!creator || !creator.id) return;
    if (isGuest) {
      if (onNavigateToLogin) onNavigateToLogin();
      return;
    }
    if (!currentUser) return;

    triggerHapticMatch();
    try {
      const batch = writeBatch(db);

      // 1. One-Way Follow (Current user follows target creator)
      // This is now a one-way follow. The other user must follow back to unlock chat.
      const ourFollowRef = doc(db, "follows", `${currentUser.uid}_${creator.id}`);
      batch.set(ourFollowRef, {
        fromUid: currentUser.uid,
        toUid: creator.id,
        status: "accepted", // "accepted" here means the current user has initiated the follow
        createdAt: serverTimestamp()
      });

      // REMOVED: batch.set(theirFollowRef, ...) - We no longer automatically follow back.

      // 2. Initialize Chat Thread (Remains locked until mutual)
      const chatId = [currentUser.uid, creator.id].sort().join('_');
      const chatDocRef = doc(db, "chats", chatId);
      batch.set(chatDocRef, {
        participants: [currentUser.uid, creator.id],
        members: [currentUser.uid, creator.id],
        isGroup: false,
        createdAt: serverTimestamp(),
        lastMessageText: `Followed ${creator.name} 🤝 Waiting for connection.`,
        lastMessageSenderName: fbUserProfile?.displayName || "Member",
        lastMessageSenderAvatar: getUserAvatar(fbUserProfile),
        lastMessageAt: serverTimestamp()
      }, { merge: true });

      // 3. Create Notification for the recipient
      const recipientNotifRef = doc(collection(db, "notifications", creator.id, "items"));
      batch.set(recipientNotifRef, {
        type: "follow",
        fromUid: currentUser.uid,
        fromUsername: fbUserProfile?.username || fbUserProfile?.displayName || "user",
        fromAvatar: getUserAvatar(fbUserProfile),
        createdAt: serverTimestamp(),
        read: false,
        title: "New Follower! 👤✨",
        description: `@${fbUserProfile?.username || 'user'} started following you. Follow back to message!`,
        targetId: chatId,
      });

      await batch.commit();

      setToast(`Following ${creator.name}! 🤝✨`);

      // Optionally navigate to chat to show the locked status
      setTimeout(() => {
        handleNavigateToTab('chat', chatId);
      }, 1200);

    } catch (e: any) {
      console.error("[Follow Error]:", e);
      setToast("Failed to follow. Please check your network.");
    }
  };

  const handleAddStory = async () => {
    if (isGuest) {
      if (onNavigateToLogin) onNavigateToLogin();
      return;
    }

    try {
      const image = await CameraPlugin.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Prompt,
        saveToGallery: false
      });

      if (image.dataUrl) {
        setStoryDraft({
          src: image.dataUrl,
          type: "image"
        });
      }
    } catch (err) {
      console.warn("Camera/Picker cancelled or failed:", err);
    }
  };

  const handleStoryFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate media (async check for duration)
    const { validateMedia } = await import('../utils/mediaProcessor');
    const validation = await validateMedia(file);
    if (!validation.valid) {
      setToast(validation.error || "Invalid file");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setStoryDraft({
        src: reader.result as string,
        type: file.type.startsWith("video") ? "video" : "image"
      });
    };
    reader.readAsDataURL(file);
    // Reset input
    e.target.value = '';
  };

  const handlePublishStory = async (processedMedia: string, caption: string, audience: "everyone" | "followers") => {
    if (!currentUser) return;
    setStoryDraft(null);

    // Create optimistic upload state
    setUploadingStory({
      progress: 0,
      failed: false,
      thumbnail: processedMedia,
      caption,
      audience
    });

    console.log("[StoryPublish] Starting upload chain...", { caption, audience });

    try {
      const { uploadStory } = await import('../utils/firebaseStorageUpload');
      console.log("[StoryPublish] Module imported, calling uploadStory...");
      const result = await uploadStory({
        imageSrc: processedMedia,
        caption,
        audience,
        userProfile: fbUserProfile as any,
        onProgress: (p) => {
          console.log(`[StoryPublish] Upload progress: ${p}%`);
          setUploadingStory(prev => prev ? { ...prev, progress: p } : null);
        }
      });

      console.log("[StoryPublish] Upload success!", result);
      setToast("Story published! ✨");
      setUploadingStory(null);
    } catch (err: any) {
      console.error("[StoryPublish] Upload failed error:", err);
      setUploadingStory(prev => prev ? { ...prev, failed: true } : null);
      setToast(`Story failed: ${err.message || "Unknown error"}`);
    }
  };

  const handleRetryStoryUpload = () => {
    if (!uploadingStory) return;
    handlePublishStory(uploadingStory.thumbnail, uploadingStory.caption, uploadingStory.audience);
  };

  const closeTopMostOverlay = useCallback((): boolean => {
    if (activeStoryIdx !== null) { setActiveStoryIdx(null); return true; }
    if (selectedProfileCreator !== null) { setSelectedProfileCreator(null); return true; }
    if (activeChatId !== null) { setActiveChatId(null); return true; }

    // If on a secondary tab (chat, stories, profile, notifications, search), go back to home
    if (activeTab !== 'home') {
      setActiveTab('home');
      return true;
    }

    return false;
  }, [activeStoryIdx, selectedProfileCreator, activeChatId, activeTab]);

  useEffect(() => { onRegisterOverlayHandler?.(closeTopMostOverlay); }, [onRegisterOverlayHandler, closeTopMostOverlay]);

  if (!isGuest && (!currentUser || !fbUserProfile)) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#09090b] p-8 text-center">
        <div className="w-10 h-10 border-2 border-[#DDF639] border-t-transparent rounded-full animate-spin mb-6" />
        <h3 className="text-lg font-bold text-white tracking-tight">Syncing Coordinates</h3>
      </div>
    );
  }

  const isChatOpen = activeTab === 'chat' && !!activeChatId;
  const unreadCount = (notifications || []).filter(n => !n.isRead).length;

  return (
    <div className="w-full h-full bg-[#09090b] text-white flex flex-col overflow-hidden relative font-sans antialiased">

      <main className="flex-1 w-full relative min-h-0" style={{ paddingBottom: isChatOpen ? '0px' : '72px' }}>
        <AnimatePresence mode="wait">
          {activeTab === 'home' && (
            <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 overflow-y-auto custom-scrollbar bg-[#09090b]">

              {/* BRAND HEADER (MOVED DOWN) */}
              <div className="px-6 pt-12 pb-1 flex items-center justify-between">
                <div className="flex items-center gap-2 cursor-pointer active:opacity-70 transition-opacity" onClick={() => setActiveTab('home')}>
                   <span className="font-sans text-[26px] font-semibold text-white tracking-tight">Anvio Talk</span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setActiveTab('search')}
                    className="w-10 h-10 rounded-full flex items-center justify-center bg-[#141414] text-[#B5B5B5] active:scale-90 transition-all border border-[#27272a] cursor-pointer shadow-sm"
                    title="Search"
                  >
                    <Search className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setActiveTab('notifications')}
                    className="w-10 h-10 rounded-full flex items-center justify-center bg-[#141414] text-[#B5B5B5] active:scale-90 transition-all border border-[#27272a] relative cursor-pointer shadow-sm"
                    title="Notifications"
                  >
                    <Bell className="w-5 h-5" />
                    {unreadCount > 0 && <div className="absolute top-2.5 right-2.5 w-1.5 h-1.5 bg-[#DDF639] rounded-full border border-[#09090b]" />}
                  </button>
                </div>
              </div>

              <section className="pt-0 pb-6 px-4 border-b border-[#27272a]/40">
                <div className="flex gap-5 overflow-x-auto no-scrollbar px-2 py-1">
                   {/* User's Own Story Bubble */}
                   {(() => {
                     const myStory = (stories || []).find(s => s && s.creatorId === 'me');
                     const hasActiveStory = myStory && myStory.items && myStory.items.length > 0;

                     // Check if owner has viewed their own story
                     const isFullyViewed = hasActiveStory && myStory.items.every(item =>
                       (myStory.viewedBy || []).includes(currentUser?.uid || '')
                     );

                     if (uploadingStory) {
                       return (
                         <div
                           onClick={uploadingStory.failed ? handleRetryStoryUpload : undefined}
                           className="flex flex-col items-center flex-shrink-0 cursor-pointer"
                          >
                           <div className="relative">
                             {/* Progress Ring */}
                             <svg className="absolute inset-0 w-16 h-16 -rotate-90">
                               <circle
                                 cx="32"
                                 cy="32"
                                 r="28"
                                 fill="transparent"
                                 stroke="#27272a"
                                 strokeWidth="3"
                               />
                               <circle
                                 cx="32"
                                 cy="32"
                                 r="28"
                                 fill="transparent"
                                 stroke={uploadingStory.failed ? "#ef4444" : "#DDF639"}
                                 strokeWidth="3"
                                 strokeDasharray={2 * Math.PI * 28}
                                 strokeDashoffset={2 * Math.PI * 28 * (1 - uploadingStory.progress / 100)}
                                 className="transition-all duration-300"
                               />
                             </svg>
                             <div className="w-16 h-16 rounded-full p-1.5 overflow-hidden">
                               <img
                                 src={uploadingStory.thumbnail}
                                 className={`w-full h-full rounded-full object-cover ${uploadingStory.failed ? 'brightness-50' : 'brightness-75 animate-pulse'}`}
                                 alt="Uploading"
                               />
                             </div>
                             {uploadingStory.failed && (
                               <div className="absolute inset-0 flex items-center justify-center text-white">
                                  <RotateCcw className="w-6 h-6 drop-shadow-md" />
                               </div>
                             )}

                             {/* Persistent Plus Icon Overlay during upload */}
                             <div
                               onClick={(e) => { e.stopPropagation(); handleAddStory(); }}
                               className="absolute bottom-0 right-0 w-5.5 h-5.5 bg-[#DDF639] rounded-full text-black flex items-center justify-center border-2 border-[#09090b] shadow-sm active:scale-90 z-20"
                             >
                               <Plus className="w-3.5 h-3.5 stroke-[3]" />
                             </div>
                           </div>
                           <span className={`text-[10px] font-bold mt-2 ${uploadingStory.failed ? 'text-red-500' : 'text-[#DDF639] animate-pulse'}`}>
                             {uploadingStory.failed ? 'Retry' : `${uploadingStory.progress}%`}
                           </span>
                         </div>
                       );
                     }

                     return (
                       <div className="flex flex-col items-center flex-shrink-0 cursor-pointer group">
                        <div className="relative">
                          <div
                            onClick={hasActiveStory ? () => handleLaunchStory('me') : handleAddStory}
                            className={`w-16 h-16 rounded-full p-0.5 border-2 transition-all ${
                              hasActiveStory
                                ? (isFullyViewed ? 'border-zinc-800' : 'bg-gradient-to-tr from-[#DDF639] via-[#8B5CF6] to-[#DDF639]')
                                : 'border-[#27272a] group-hover:border-[#DDF639]'
                            }`}
                          >
                            <img
                              src={getUserAvatar(fbUserProfile)}
                              className={`w-full h-full rounded-full object-cover border-2 border-[#09090b] ${isFullyViewed ? 'opacity-40' : ''}`}
                              alt="Me"
                            />
                          </div>
                          <div
                            onClick={(e) => { e.stopPropagation(); handleAddStory(); }}
                            className="absolute bottom-0 right-0 w-5.5 h-5.5 bg-[#DDF639] rounded-full text-black flex items-center justify-center border-2 border-[#09090b] shadow-sm active:scale-90 z-20"
                          >
                            <Plus className="w-3.5 h-3.5 stroke-[3]" />
                          </div>
                        </div>
                        <span className={`text-[10px] font-bold mt-2 ${isFullyViewed ? 'text-white/30' : 'text-white/70'}`}>You</span>
                      </div>
                     );
                   })()}

                   {(stories || []).filter(s => s && s.creatorId !== 'me' && s.items && s.items.length > 0).map(s => {
                     if (!s || !s.id) return null;

                     // Check if all items in this story group are viewed by current user
                     const isFullyViewed = s.items.every(item =>
                       (s.viewedBy || []).includes(currentUser?.uid || '') ||
                       viewedStoryIds.includes(item.id)
                     );

                     return (
                      <div key={s.id} onClick={() => handleLaunchStory(s.creatorId)} className="flex-shrink-0 flex flex-col items-center gap-2">
                        <div className="relative">
                          <div className={`w-16 h-16 rounded-full p-0.5 ${
                            isFullyViewed
                              ? 'bg-zinc-800'
                              : 'bg-gradient-to-tr from-[#DDF639] via-[#8B5CF6] to-[#DDF639]'
                          }`}>
                            <img src={s.creatorAvatar} className="w-full h-full rounded-full object-cover border-2 border-[#09090b]" alt="" />
                          </div>
                          {!isFullyViewed && (
                            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-[#dc2626] text-white font-black text-[8px] px-2 py-0.5 rounded-full border border-[#09090b]">LIVE</span>
                          )}
                        </div>
                        <span className={`text-[10px] font-medium truncate w-16 text-center ${isFullyViewed ? 'text-white/40' : 'text-white/70'}`}>
                          {(s.creatorName || "User").split(' ')[0]}
                        </span>
                      </div>
                     );
                   })}
                   <div className="flex-shrink-0 w-2 h-16" /> {/* Right spacer to prevent cutting */}
                </div>
              </section>
              <div className="divide-y divide-[#27272a]/40">
                {isCreatorsLoading ? (
                  <>
                    <PostCardSkeleton />
                    <PostCardSkeleton />
                    <PostCardSkeleton />
                  </>
                ) : creatorsError ? (
                  <div className="p-8 text-center bg-[#141414] rounded-3xl m-4 border border-[#27272a] text-white space-y-3">
                    <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
                    <p className="text-sm font-bold">{creatorsError}</p>
                    <button
                      onClick={() => window.location.reload()}
                      className="px-5 py-2 bg-[#DDF639] text-black font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer"
                    >
                      Retry Feed
                    </button>
                  </div>
                ) : creators.length === 0 ? (
                  <div className="p-10 text-center text-[#A1A1AA] space-y-2">
                    <Sparkles className="w-8 h-8 text-[#DDF639] mx-auto opacity-70" />
                    <p className="text-sm font-bold text-white">No feed updates yet</p>
                    <p className="text-xs text-[#71717A]">Check back soon or explore creators in the Discover tab!</p>
                  </div>
                ) : (
                  (creators || []).map(c => {
                    if (!c || !c.id) return null;
                    return (
                      <CreatorFeedCard
                        key={c.id}
                        creator={c}
                        isGuest={isGuest}
                        onSelectCreator={setSelectedProfileCreator}
                        onMessageInterest={handleMatchCreated}
                        onNavigateToLogin={onNavigateToLogin}
                        onOpenChat={(uid) => handleNavigateToTab('chat', [currentUser?.uid, uid].sort().join('_'))}
                      />
                    );
                  })
                )}
              </div>
              <div className="h-28 w-full" /> {/* Bottom spacer for nav bar */}
            </motion.div>
          )}

          {activeTab === 'discover' && (
            <motion.div key="discover" className="absolute inset-0">
              <SwipeCards
                creators={creators}
                chats={chats}
                stories={stories}
                isGuest={isGuest}
                onMatchCreated={handleMatchCreated}
                onSelectCreator={setSelectedProfileCreator}
                onOpenReportModal={() => {}}
                onChatShortcut={(id) => {
                  const cid = [currentUser?.uid, id].sort().join('_');
                  handleNavigateToTab('chat', cid);
                }}
                outgoingFollows={outgoingFollows}
                onToggleFollow={handleToggleFollow}
              />
            </motion.div>
          )}
          {activeTab === 'stories' && <motion.div key="stories" className="absolute inset-0"><StoriesFeedScreen onSelectCreator={setSelectedProfileCreator} onOpenChat={(uid) => handleNavigateToTab('chat', [currentUser?.uid, uid].sort().join('_'))} /></motion.div>}
          {activeTab === 'chat' && <motion.div key="chat" className="absolute inset-0"><ChatWindow initialChats={chats} creators={creators} isGuest={isGuest} activeChatId={activeChatId} onActiveChatChange={(chatId) => setActiveChatId(chatId)} onSelectCreator={setSelectedProfileCreator} stories={stories} onAddStory={handleAddStory} onViewStory={(idx) => setActiveStoryIdx(idx)} uploadingStory={uploadingStory} onRetryStoryUpload={handleRetryStoryUpload} onBackToMap={() => setActiveTab('home')} /></motion.div>}
          {activeTab === 'profile' && <motion.div key="profile" className="absolute inset-0 pt-16 px-4"><ProfileTab profile={localMapProfile} chats={chats} creators={creators} isGuest={isGuest} onUpdateProfile={setLocalMapProfile} onNavigateToTab={(t, c) => { setActiveTab(t); if(c) setActiveChatId(c); }} /></motion.div>}
          {activeTab === 'notifications' && <motion.div key="notifications" className="absolute inset-0 pt-16 px-4 overflow-y-auto pb-24 pb-safe"><NotificationsTab notifications={notifications} onNavigateToCreator={(id) => { const c = creators.find(cr => cr.id === id); if(c) setSelectedProfileCreator(c); }} onDeleteNotification={async (id) => { if(!currentUser) return; try { await deleteDoc(doc(db, "notifications", currentUser.uid, "items", id)); } catch(e) { console.warn("Failed to delete notification:", e); } }} /></motion.div>}
          {activeTab === 'search' && <motion.div key="search" className="absolute inset-0 pt-16 pb-24 pb-safe"><SearchScreen onSelectCreator={setSelectedProfileCreator} /></motion.div>}
        </AnimatePresence>
      </main>

      {!isChatOpen && (
        <nav className="fixed bottom-0 left-0 w-full h-[72px] flex justify-around items-center bg-[#09090b]/95 backdrop-blur-xl border-t border-[#27272a]/60 z-40 px-6 pb-safe">
          {[{ id: 'home', icon: Globe }, { id: 'discover', icon: Compass }, { id: 'stories', icon: Film }, { id: 'chat', icon: MessageSquare }].map(t => {
            const active = activeTab === t.id;
            return (
              <button key={t.id} onClick={() => setActiveTab(t.id as any)} className={`p-2 transition-all active:scale-90 ${active ? 'text-[#DDF639]' : 'text-[#71717A]'}`}>
                <t.icon className="w-6 h-6" />
                {active && <div className="w-1 h-1 bg-[#DDF639] rounded-full mx-auto mt-1" />}
              </button>
            );
          })}
          <button onClick={() => setActiveTab('profile')} className="p-2">
             <img src={getUserAvatar(localMapProfile)} className={`w-7 h-7 rounded-full object-cover border-2 transition-all ${activeTab === 'profile' ? 'border-[#DDF639] scale-110' : 'border-transparent'}`} alt="" />
          </button>
        </nav>
      )}

      <AnimatePresence>
        {selectedProfileCreator && <ProfileDetailPopup creator={selectedProfileCreator} isGuest={isGuest} onClose={() => setSelectedProfileCreator(null)} onConnect={handleMatchCreated} chats={chats} creators={creators} onNavigateToLogin={onNavigateToLogin || (() => {})} onLaunchStory={() => {}} />}
        {activeStoryIdx !== null && <StoryViewer stories={stories} initialStoryIndex={activeStoryIdx} onClose={() => setActiveStoryIdx(null)} />}

        {/* Story Editor Flow */}
        {storyDraft && (
          <StoryEditor
            mediaSrc={storyDraft.src}
            mediaType={storyDraft.type}
            onCancel={() => setStoryDraft(null)}
            onPublish={handlePublishStory}
          />
        )}

        {/* Hidden Video Input */}
        <input
          type="file"
          id="story-video-input"
          className="hidden"
          accept="video/*"
          onChange={handleStoryFileChange}
        />
      </AnimatePresence>

      {/* Toast Notification Overlay */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] bg-[#141414] border border-[#27272a] px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 min-w-[280px]"
          >
            <div className="w-8 h-8 rounded-full bg-[#DDF639]/10 flex items-center justify-center border border-[#DDF639]/20">
              <Check className="w-4 h-4 text-[#DDF639]" />
            </div>
            <p className="text-sm font-bold text-white whitespace-nowrap">{toast}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function DiscoveryMap(props: DiscoveryMapProps) {
  return (
    <InternalDiscoveryMapBoundary>
      <DiscoveryMapMain {...props} />
    </InternalDiscoveryMapBoundary>
  );
}
