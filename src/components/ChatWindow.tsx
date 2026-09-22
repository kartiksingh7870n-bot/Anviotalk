import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, Image, Lock, ShieldAlert, ArrowLeft, Search, Users, Plus, 
  MoreVertical, CheckCheck, HelpCircle, User, Sparkles, Ban, Flag,
  Settings, UserPlus, Trash2, Bookmark, X, Check, Crown, Paperclip, Share2, Eye,
  Pin, VolumeX, Volume2, Archive, Mail, MailOpen, MessageSquareDashed, Compass, Edit3, LogOut, ArrowRight, Info,
  Loader2, AlertCircle, Mic, Smile, Camera as LucideCamera, FileText, MapPin, UserCheck, BarChart2
} from 'lucide-react';
import { ChatThread, Creator, Message, Story } from '../data';
import { useAuth } from '../contexts/AuthContext';
import { Capacitor } from '@capacitor/core';
import { Camera as CameraPlugin, CameraResultType, CameraSource } from '@capacitor/camera';
import { collection, query, where, orderBy, onSnapshot, doc, addDoc, serverTimestamp, updateDoc, arrayUnion, arrayRemove, limit, getDoc, setDoc, writeBatch, getDocs, deleteDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../firebase";
import { getUserAvatar, getDefaultAvatar, resolveAvatarUrl } from "../utils/avatar";
import { compressImage } from "../utils/imageCompressor";
import { uploadChatImage, uploadToStorageWithRetry } from "../utils/firebaseStorageUpload";
import { getShareUrl, PRODUCTION_URL } from "../utils/deeplink";
import { triggerHapticMessage } from "../utils/haptics";
import { formatUserFriendlyErrorMessage } from "../utils/errorMessage";
import ProfileDetailPopup from './ProfileDetailPopup';
import { recordMonetizationView } from '../utils/recordProfileView';
import ShareLinkModal from './ShareLinkModal';
import AdPlacement from './AdPlacement';
import { ChatListItemSkeleton, ChatMessageSkeleton, ProgressiveImage } from './Skeletons';

interface ChatWindowProps {
  initialChats: ChatThread[];
  creators: Creator[];
  isGuest: boolean;
  onNavigateToLogin?: () => void;
  onBlockUser?: (creatorId: string) => void;
  onUnblockUser?: (creatorId: string) => void;
  onReportUser?: (creatorId: string, reason: string) => void;
  onOpenReportModal?: (target: {
    targetType: 'user' | 'story' | 'group' | 'message';
    targetId: string;
    targetName?: string;
    targetUsername?: string;
    targetAvatar?: string;
    targetContent?: string;
  }) => void;
  activeChatId?: string | null;
  onSelectCreator?: (creator: Creator) => void;
  stories?: Story[];
  onViewStory?: (idx: number) => void;
  uploadingStory?: {
    progress: number;
    failed: boolean;
    thumbnail: string;
    caption: string;
    audience: "everyone" | "followers";
  } | null;
  onRetryStoryUpload?: () => void;
  onAddStory?: () => void;
  onBackToMap?: () => void;
  onActiveChatChange?: (chatId: string | null) => void;
}

// Mandatory Content Type helper (No actual text content is displayed)
function getChatContentTypeLabel(lastMsg?: Message): { label: string; icon: string } {
  if (!lastMsg) {
    return { label: 'New Message', icon: '📩' };
  }

  const text = (lastMsg.text || '').toLowerCase();
  const media = (lastMsg.mediaUrl || (lastMsg as any).imageUrl || '').toLowerCase();

  if (text.includes('video') || media.includes('.mp4') || media.includes('.mov') || media.includes('video')) {
    return { label: 'New Video', icon: '🎥' };
  }
  if (text.includes('audio') || text.includes('voice') || media.includes('.mp3') || media.includes('.m4a') || media.includes('audio')) {
    return { label: 'New Audio', icon: '🎵' };
  }
  if (media || text.includes('photo') || text.includes('image') || text.includes('picture')) {
    return { label: 'New Image', icon: '🖼️' };
  }
  if (text.includes('document') || text.includes('pdf') || text.includes('file') || media.includes('.pdf') || media.includes('.doc')) {
    return { label: 'New Document', icon: '📄' };
  }
  if (text.includes('location') || text.includes('map') || text.includes('coords') || text.includes('📍')) {
    return { label: 'New Location', icon: '📍' };
  }
  if (text.includes('shared profile') || text.includes('profile') || text.includes('🎁')) {
    return { label: 'Shared Profile', icon: '🎁' };
  }
  if (text.includes('shared story') || text.includes('story') || text.includes('📖')) {
    return { label: 'Shared Story', icon: '📖' };
  }
  if (text.includes('group invitation') || text.includes('joined group') || text.includes('salon') || text.includes('👥')) {
    return { label: 'Group Invitation', icon: '👥' };
  }

  return { label: 'New Message', icon: '📩' };
}

function renderTextWithLinks(text: string, isMe: boolean) {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const parts = text.split(urlRegex);

  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        if (part.match(urlRegex)) {
          const href = part.toLowerCase().startsWith('http') ? part : `https://${part}`;
          return (
            <a
              key={i}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={`underline font-bold transition-opacity hover:opacity-80 break-all ${
                isMe ? 'text-pink-200 hover:text-white' : 'text-[#854c6f] hover:text-[#854c6f]/80'
              }`}
            >
              {part}
            </a>
          );
        }
        return part;
      })}
    </span>
  );
}

function renderMessageStatus(lastMsg?: Message) {
  if (!lastMsg || lastMsg.senderId !== 'me') return null;
  if (lastMsg.isRead) {
    return <CheckCheck className="w-3.5 h-3.5 text-[#854c6f] shrink-0" title="Seen" />;
  }
  return <CheckCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" title="Delivered" />;
}

export default function ChatWindow({ 
  initialChats, 
  creators, 
  isGuest, 
  onNavigateToLogin,
  onBlockUser,
  onUnblockUser,
  onReportUser,
  onOpenReportModal,
  activeChatId,
  onSelectCreator,
  stories = [],
  onViewStory,
  uploadingStory,
  onRetryStoryUpload,
  onAddStory,
  onBackToMap,
  onActiveChatChange
}: ChatWindowProps) {
  const { currentUser, isFirebase, userProfile, updateProfile } = useAuth();
  const [chats, setChats] = useState<ChatThread[]>(initialChats);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(activeChatId || null);

  useEffect(() => {
    if (onActiveChatChange) {
      onActiveChatChange(selectedChatId);
    }
  }, [selectedChatId, onActiveChatChange]);

  const selectedChat = chats.find(c => c.id === selectedChatId);
  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState<{ file: File; preview: string; base64: string } | null>(null);
  const [imageUploadProgress, setImageUploadProgress] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [chatAdFailed, setChatAdFailed] = useState(false);
  const [activeMessageMenuId, setActiveMessageMenuId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const groupAvatarInputRef = useRef<HTMLInputElement>(null);
  
  // Composer States (Voice recording removed)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Real-time messages state
  const [messages, setMessages] = useState<Message[]>([]);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<any[]>([]);
  const [typingUsers, setTypingUsers] = useState<Record<string, { timestamp: number; name?: string; avatar?: string }>>({});
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isMutuallyFollowing, setIsMutuallyFollowing] = useState<boolean>(true);
  const [ourFollowStatus, setOurFollowStatus] = useState<string | null>(null);
  const [theirFollowStatus, setTheirFollowStatus] = useState<string | null>(null);

  // Error feedback and message retry states
  const [errorToast, setErrorToast] = useState<{ message: string; sub: string } | null>(null);
  const [failedMessages, setFailedMessages] = useState<any[]>([]);

  // Redesign state declarations
  const [activeSidebarTab, setActiveSidebarTab] = useState<'primary' | 'requests'>('primary');
  const [activeCategoryTab, setActiveCategoryTab] = useState<'all' | 'unread' | 'groups' | 'pinned' | 'requests'>('all');
  const [sidebarLoading, setSidebarLoading] = useState(true);
  const [unlockedStories, setUnlockedStories] = useState<string[]>([]);
  const [storyToUnlock, setStoryToUnlock] = useState<{ story: Story; idx: number } | null>(null);

  // Swipe & List Management State
  const [pinnedChatIds, setPinnedChatIds] = useState<string[]>([]);
  const [mutedChatIds, setMutedChatIds] = useState<string[]>([]);
  const [archivedChatIds, setArchivedChatIds] = useState<string[]>([]);
  const [readOverrideMap, setReadOverrideMap] = useState<Record<string, boolean>>({});
  const [showFabMenu, setShowFabMenu] = useState(false);
  const [swipedCardId, setSwipedCardId] = useState<string | null>(null);
  const [toastNotice, setToastNotice] = useState<string | null>(null);
  const [showAuthButtons, setShowAuthButtons] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [expandedMediaUrl, setExpandedMediaUrl] = useState<string | null>(null);
  const [viewingSeenByMessage, setViewingSeenByMessage] = useState<any | null>(null);

  // Group Admin & Permissions States
  const [showGroupSettingsModal, setShowGroupSettingsModal] = useState(false);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [isSavingGroupInfo, setIsSavingGroupInfo] = useState(false);
  const [searchResultsGroups, setSearchResultsGroups] = useState<ChatThread[]>([]);
  const [isSearchingGroups, setIsSearchingGroups] = useState(false);
  const groupLogoEditInputRef = useRef<HTMLInputElement>(null);

  // Check if current user is admin of selected group
  const activeChat = chats.find(c => c.id === selectedChatId);
  const selectedChatForAdmin = activeChat;
  const isGroupAdmin = !!(
    (selectedChatForAdmin?.isGroup || selectedChatForAdmin?.type === 'group' || (selectedChatForAdmin?.admins && selectedChatForAdmin.admins.length > 0)) &&
    (
      (currentUser && selectedChatForAdmin?.admins && selectedChatForAdmin.admins.includes(currentUser.uid)) ||
      (selectedChatForAdmin?.admins && selectedChatForAdmin.admins.includes('me')) ||
      (currentUser && selectedChatForAdmin?.members && selectedChatForAdmin.members[0] === currentUser.uid) ||
      (currentUser && selectedChatForAdmin?.participants && selectedChatForAdmin.participants[0] === currentUser.uid) ||
      (selectedChatForAdmin?.members && selectedChatForAdmin.members[0] === 'me') ||
      (!selectedChatForAdmin?.admins || selectedChatForAdmin.admins.length === 0)
    )
  );

  // Sync activeChatId prop
  useEffect(() => {
    if (activeChatId) {
      setSelectedChatId(activeChatId);
    }
  }, [activeChatId]);

  // Clear typing text and attachment draft when switching chats
  useEffect(() => {
    setInputText('');
    setSelectedImage(null);
    setImageUploadProgress(null);
  }, [selectedChatId]);

  // Monetization: record a verified chat/group view for the earning creator(s).
  // Anti-fraud (bot rate limit, 24h dedup, self/guest exclusion) is enforced server-side.
  useEffect(() => {
    if (!activeChat || !currentUser?.uid) return;
    const isGroupChat = !!(activeChat.isGroup || activeChat.type === 'group');
    const participants = activeChat.participantUids || activeChat.participants || activeChat.members || [];
    const targets = isGroupChat
      ? (activeChat.admins || []).filter(a => a && a !== currentUser.uid && a !== 'me' && a !== 'system')
      : participants.filter(p => p && p !== currentUser.uid && p !== 'me' && p !== 'guest' && p !== 'system');
    if (targets.length === 0) return;
    targets.forEach((t) => {
      recordMonetizationView(isGroupChat ? 'group' : 'chat', t, currentUser.uid, activeChat.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat?.id, currentUser?.uid]);

  // Real-time listener for current selected group thread updates
  useEffect(() => {
    if (!selectedChatId || !isFirebase) return;
    const unsub = onSnapshot(doc(db, "chats", selectedChatId), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        if (d.isGroup) {
          setChats(prev => {
            const exists = prev.some(c => c.id === selectedChatId);
            const isPub = d.visibility !== 'private' && d.isPublic !== false;
            if (!exists) {
              const newGroupThread: ChatThread = {
                id: snap.id,
                name: d.name || 'Group',
                isGroup: true,
                avatar: d.avatar || d.groupAvatar || getDefaultAvatar(),
                members: d.members || d.participants || [],
                admins: d.admins || [],
                onlyAdminCanSend: d.onlyAdminCanSend || false,
                visibility: d.visibility || 'public',
                isPublic: isPub,
                isLocked: !isPub,
                messages: []
              };
              return [newGroupThread, ...prev];
            }
            return prev.map(c => {
              if (c.id === selectedChatId) {
                return {
                  ...c,
                  name: d.name || c.name,
                  avatar: d.avatar || d.groupAvatar || c.avatar,
                  members: d.members || d.participants || c.members,
                  admins: d.admins || c.admins,
                  onlyAdminCanSend: d.onlyAdminCanSend !== undefined ? d.onlyAdminCanSend : (c as any).onlyAdminCanSend,
                  visibility: d.visibility || 'public',
                  isPublic: isPub,
                  isLocked: !isPub
                };
              }
              return c;
            });
          });
        }
      }
    });
    return () => unsub();
  }, [selectedChatId, isFirebase]);

  // Real-time listener for typing indicator
  useEffect(() => {
    if (!selectedChatId || !isFirebase) {
      setTypingUsers({});
      return;
    }
    const unsub = onSnapshot(doc(db, "chats", selectedChatId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.typing) {
          setTypingUsers(data.typing);
        } else {
          setTypingUsers({});
        }
      }
    }, () => {});
    return () => unsub();
  }, [selectedChatId, isFirebase]);

  // Real-time public groups search from Firestore
  useEffect(() => {
    if (!searchQuery.trim() || !isFirebase) {
      setSearchResultsGroups([]);
      return;
    }
    setIsSearchingGroups(true);
    const q = query(
      collection(db, "chats"),
      where("isGroup", "==", true),
      limit(20)
    );
    getDocs(q).then((snap) => {
      const found: ChatThread[] = [];
      const lowerQuery = searchQuery.toLowerCase().trim();
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const gName = d.name || '';
        if (gName.toLowerCase().includes(lowerQuery) || docSnap.id === lowerQuery) {
          found.push({
            id: docSnap.id,
            name: gName || 'Group',
            isGroup: true,
            avatar: d.avatar || getDefaultAvatar(),
            members: d.members || d.participants || [],
            admins: d.admins || [],
            onlyAdminCanSend: d.onlyAdminCanSend || false,
            isLocked: false,
            messages: []
          });
        }
      });
      setSearchResultsGroups(found);
    }).catch((err) => {
      console.warn("Group search error:", err);
    }).finally(() => {
      setIsSearchingGroups(false);
    });
  }, [searchQuery, isFirebase]);

  // Group Admin Action Handlers
  const handleSaveGroupName = async () => {
    if (!selectedChatId || !editingGroupName.trim() || !isGroupAdmin) return;
    setIsSavingGroupInfo(true);
    try {
      if (isFirebase) {
        await updateDoc(doc(db, "chats", selectedChatId), {
          name: editingGroupName.trim()
        });
      }
      setChats(prev => prev.map(c => c.id === selectedChatId ? { ...c, name: editingGroupName.trim() } : c));
      setToastNotice("Group name updated! ✅");
      setTimeout(() => setToastNotice(null), 3000);
    } catch (err: any) {
      console.error("Error updating group name:", err);
      setErrorToast({ message: "Update Failed", sub: formatUserFriendlyErrorMessage(err, "Only admins can change group name.") });
    } finally {
      setIsSavingGroupInfo(false);
    }
  };

  const handleEditGroupLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedChatId || !isGroupAdmin) return;
    try {
      setIsSavingGroupInfo(true);
      setErrorToast({ message: "Uploading Logo...", sub: "Uploading new group logo..." });
      
      const uploadedUrl = await uploadToStorageWithRetry(
        `groupAvatars/${selectedChatId}/${Date.now()}.jpg`,
        file
      );

      if (isFirebase) {
        await updateDoc(doc(db, "chats", selectedChatId), {
          avatar: uploadedUrl,
          groupAvatar: uploadedUrl,
          updatedAt: serverTimestamp()
        });
      }
      setChats(prev => prev.map(c => c.id === selectedChatId ? { ...c, avatar: uploadedUrl, groupAvatar: uploadedUrl } : c));
      setErrorToast(null);
      setToastNotice("Group logo updated! 🎨");
      setTimeout(() => setToastNotice(null), 3000);
    } catch (err: any) {
      console.error("Error changing group logo:", err);
      setErrorToast({ message: "Upload Failed", sub: formatUserFriendlyErrorMessage(err, "Could not change group logo.") });
    } finally {
      setIsSavingGroupInfo(false);
      if (groupLogoEditInputRef.current) {
        groupLogoEditInputRef.current.value = "";
      }
    }
  };

  const handleSetGroupPrivacy = async (visibility: 'public' | 'private') => {
    if (!selectedChatId || !isGroupAdmin) return;
    try {
      setIsSavingGroupInfo(true);
      const isPub = visibility === 'public';
      if (isFirebase) {
        await updateDoc(doc(db, "chats", selectedChatId), {
          visibility: visibility,
          isPublic: isPub,
          isLocked: !isPub
        });
      }
      setChats(prev => prev.map(c => c.id === selectedChatId ? {
        ...c,
        visibility: visibility,
        isPublic: isPub,
        isLocked: !isPub
      } : c));
      setToastNotice(isPub ? "Group is now Public! 🌐 Anyone with link can view chat & media." : "Group is now Private! 🔒 Messages hidden from non-members.");
      setTimeout(() => setToastNotice(null), 3000);
    } catch (err: any) {
      console.error("Error setting group privacy:", err);
      setErrorToast({ message: "Update Failed", sub: formatUserFriendlyErrorMessage(err, "Could not update group privacy.") });
    } finally {
      setIsSavingGroupInfo(false);
    }
  };

  const handleToggleAdminOnlyMessaging = async (onlyAdmin: boolean) => {
    if (!selectedChatId || !isGroupAdmin) return;
    try {
      if (isFirebase) {
        await updateDoc(doc(db, "chats", selectedChatId), {
          onlyAdminCanSend: onlyAdmin
        });
      }
      setChats(prev => prev.map(c => c.id === selectedChatId ? { ...c, onlyAdminCanSend: onlyAdmin } : c));
      setToastNotice(onlyAdmin ? "Only admins can now send messages in this group." : "All members can now send messages in this group.");
      setTimeout(() => setToastNotice(null), 3000);
    } catch (err: any) {
      console.error("Error updating messaging permissions:", err);
      setErrorToast({ message: "Update Failed", sub: formatUserFriendlyErrorMessage(err, "Could not update group permissions.") });
    }
  };

  const handleToggleOpenMessaging = async (openMsg: boolean) => {
    if (!selectedChatId || !isGroupAdmin) return;
    try {
      if (isFirebase) {
        await updateDoc(doc(db, "chats", selectedChatId), {
          openMessaging: openMsg,
          allowMessagesFromAnyone: openMsg
        });
      }
      setChats(prev => prev.map(c => c.id === selectedChatId ? { ...c, openMessaging: openMsg, allowMessagesFromAnyone: openMsg } : c));
      setToastNotice(openMsg ? "Messages allowed from everyone in this group." : "Mutual follow requirement restored for group messaging.");
      setTimeout(() => setToastNotice(null), 3000);
    } catch (err: any) {
      console.error("Error updating open messaging setting:", err);
      setErrorToast({ message: "Update Failed", sub: formatUserFriendlyErrorMessage(err, "Could not update group permissions.") });
    }
  };

  // User & Admin In-Chat Ads Toggle Map (Inbox & Group)
  const [chatAdsToggleMap, setChatAdsToggleMap] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('anvio_chat_in_ads_enabled');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const isCurrentChatAdsEnabled = React.useMemo(() => {
    if (!selectedChat) return false;
    if (selectedChat.isGroup) {
      if (selectedChat.enableInChatAds !== undefined) {
        return !!selectedChat.enableInChatAds;
      }
      return !!chatAdsToggleMap[selectedChat.id];
    }
    return !!chatAdsToggleMap[selectedChat.id];
  }, [selectedChat, chatAdsToggleMap]);

  const handleToggleInChatAds = async (enable: boolean) => {
    if (!selectedChat) return;
    const targetChatId = selectedChat.id;

    // Update local state map and localStorage
    setChatAdsToggleMap(prev => {
      const updated = { ...prev, [targetChatId]: enable };
      try {
        localStorage.setItem('anvio_chat_in_ads_enabled', JSON.stringify(updated));
      } catch (e) {
        console.warn('Could not save chat ads preference:', e);
      }
      return updated;
    });

    // If it's a group and current user is admin, persist in Firestore
    if (selectedChat.isGroup && isGroupAdmin && isFirebase) {
      try {
        await updateDoc(doc(db, "chats", targetChatId), {
          enableInChatAds: enable
        });
      } catch (err) {
        console.error("Error updating group in-chat ads in Firestore:", err);
      }
    }

    setChats(prev => prev.map(c => c.id === targetChatId ? { ...c, enableInChatAds: enable } : c));
    setToastNotice(enable ? "In-chat sponsored ads enabled for this chat! ✨" : "In-chat ads disabled for this chat.");
    setTimeout(() => setToastNotice(null), 3000);
  };

  const handleJoinGroupById = async (groupId: string, groupName: string) => {
    if (!currentUser || isJoining) return;
    setIsJoining(true);
    try {
      if (isFirebase) {
        const groupRef = doc(db, "chats", groupId);
        await updateDoc(groupRef, {
          members: arrayUnion(currentUser.uid),
          participants: arrayUnion(currentUser.uid)
        });
      }
      setChats(prev => {
        const exists = prev.some(c => c.id === groupId);
        if (exists) {
          return prev.map(c => c.id === groupId ? { ...c, members: Array.from(new Set([...c.members, currentUser.uid])) } : c);
        } else {
          const searched = searchResultsGroups.find(g => g.id === groupId);
          const newGroup: ChatThread = searched ? {
            ...searched,
            members: Array.from(new Set([...searched.members, currentUser.uid]))
          } : {
            id: groupId,
            name: groupName,
            isGroup: true,
            avatar: getDefaultAvatar(),
            members: [currentUser.uid],
            isLocked: false,
            messages: []
          };
          return [newGroup, ...prev];
        }
      });
      setSelectedChatId(groupId);
      setSearchQuery('');
      setToastNotice(`Successfully joined "${groupName}"! 🎉`);
      setTimeout(() => setToastNotice(null), 3000);
    } catch (err: any) {
      console.error("Error joining group by id:", err);
      setErrorToast({ message: "Could not join group", sub: err.message || "Please try again." });
    } finally {
      setIsJoining(false);
    }
  };

  // Requirement 1: 5-second timer for unauthenticated visitor auth buttons
  useEffect(() => {
    if (!currentUser) {
      setShowAuthButtons(false);
      const timer = setTimeout(() => {
        setShowAuthButtons(true);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [currentUser, selectedChatId]);

  // Ensure dynamic group thread resolution
  useEffect(() => {
    if (!selectedChatId) return;
    const exists = chats.some(c => c.id === selectedChatId);
    if (!exists && isFirebase) {
      getDoc(doc(db, "chats", selectedChatId)).then(docSnap => {
        if (docSnap.exists()) {
          const d = docSnap.data();
          const newThread: ChatThread = {
            id: docSnap.id,
            name: d.name || 'Group',
            isGroup: true,
            avatar: d.avatar || getDefaultAvatar(),
            members: d.members || [],
            isLocked: false,
            messages: []
          };
          setChats(prev => [newThread, ...prev]);
        } else {
          const placeholderThread: ChatThread = {
            id: selectedChatId,
            name: 'Group',
            isGroup: true,
            avatar: getDefaultAvatar(),
            members: [],
            isLocked: false,
            messages: []
          };
          setChats(prev => [placeholderThread, ...prev]);
        }
      }).catch(err => {
        console.warn("Error fetching group thread:", err);
      });
    }
  }, [selectedChatId, chats, isFirebase]);

  const handleJoinGroup = async () => {
    if (!currentUser || !selectedChatId || isJoining) return;
    setIsJoining(true);
    try {
      if (isFirebase) {
        const groupRef = doc(db, "chats", selectedChatId);
        await updateDoc(groupRef, {
          members: arrayUnion(currentUser.uid),
          participants: arrayUnion(currentUser.uid)
        });
      }
      setChats(prev => prev.map(c => {
        if (c.id === selectedChatId) {
          return {
            ...c,
            members: [...(c.members || []), currentUser.uid]
          };
        }
        return c;
      }));
      setToastNotice("You joined the group! 🎉");
      setTimeout(() => setToastNotice(null), 3000);
    } catch (err: any) {
      console.error("Error joining group:", err);
      setErrorToast({ message: "Could not join group", sub: err.message || "Please try again." });
    } finally {
      setIsJoining(false);
    }
  };

  // Action handlers
  const handleTogglePin = (chatId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setPinnedChatIds(prev =>
      prev.includes(chatId) ? prev.filter(id => id !== chatId) : [...prev, chatId]
    );
    setSwipedCardId(null);
  };

  const handleToggleMute = (chatId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setMutedChatIds(prev =>
      prev.includes(chatId) ? prev.filter(id => id !== chatId) : [...prev, chatId]
    );
    setSwipedCardId(null);
  };

  const handleArchiveChat = (chatId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setArchivedChatIds(prev => [...prev, chatId]);
    if (selectedChatId === chatId) setSelectedChatId(null);
    setSwipedCardId(null);
  };

  const handleDeleteChat = async (chatId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const confirmed = window.confirm("Are you sure you want to delete this chat? This will remove the conversation from your inbox.");
    if (!confirmed) return;

    try {
      if (isFirebase && currentUser) {
        await updateDoc(doc(db, "chats", chatId), {
          deletedBy: arrayUnion(currentUser.uid)
        });
      }
      setChats(prev => prev.filter(c => c.id !== chatId));
      if (selectedChatId === chatId) setSelectedChatId(null);
      setSwipedCardId(null);
      setToastNotice("Chat deleted successfully.");
      setTimeout(() => setToastNotice(null), 3000);
    } catch (err: any) {
      console.error("Error deleting chat:", err);
      setErrorToast({ message: "Delete Failed", sub: formatUserFriendlyErrorMessage(err, "Could not delete conversation.") });
    }
  };

  const handleToggleRead = (chatId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setReadOverrideMap(prev => ({
      ...prev,
      [chatId]: !prev[chatId]
    }));
    setSwipedCardId(null);
  };

  // Simulate skeleton shimmer loader on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      setSidebarLoading(false);
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  // Auto-hide error toast after 4 seconds
  useEffect(() => {
    if (errorToast) {
      const timer = setTimeout(() => setErrorToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [errorToast]);

  // Handle retrying failed messages
  const handleRetryMessage = async (msg: any) => {
    // 1. Remove from failed list
    setFailedMessages(prev => prev.filter(m => m.id !== msg.id));

    if (msg.file || msg.mediaUrl) {
      // Photo upload retry
      try {
        setIsSending(true);
        setImageUploadProgress(5);
        if (!selectedChatId) return;
        await uploadChatImage({
          chatId: selectedChatId,
          imageInput: msg.file || msg.mediaUrl,
          text: msg.text || "",
          userProfile,
          onProgress: (p) => setImageUploadProgress(p)
        });
        setErrorToast({ message: "Photo Delivered 📸", sub: "Resent photo successfully." });
      } catch (err: any) {
        console.error("[Firebase Upload Error] Retry file upload failed:", err);
        setErrorToast({ message: "Upload failed", sub: formatUserFriendlyErrorMessage(err, "Could not upload photo. Please check connection.") });
        setFailedMessages(prev => [...prev, msg]);
      } finally {
        setIsSending(false);
        setImageUploadProgress(null);
      }
    } else {
      // Text message retry
      try {
        await addDoc(collection(db, "chats", selectedChatId, "messages"), {
          senderId: currentUser?.uid,
          senderName: userProfile?.displayName || "You",
          senderAvatar: userProfile?.avatarUrl || "",
          text: msg.text,
          createdAt: serverTimestamp()
        });

        await updateDoc(doc(db, "chats", selectedChatId), {
          lastMessageText: msg.text,
          lastMessageSenderName: userProfile?.displayName || "You",
          lastMessageSenderAvatar: userProfile?.avatarUrl || "",
          lastMessageAt: serverTimestamp()
        });
      } catch (err) {
        console.error("Retry message failed:", err);
        let errorSub = formatUserFriendlyErrorMessage(err, "Network issue, please check your connection and try again.");
        if (err && typeof err === 'object') {
          const errMsg = (err as any).message || '';
          const errCode = (err as any).code || '';
          if (errMsg.includes("permission-denied") || errCode === "permission-denied" || errMsg.toLowerCase().includes("permission")) {
            errorSub = "This person/group requires you to follow each other before messaging.";
          }
        }
        setErrorToast({ message: "Send failed", sub: errorSub });
        setFailedMessages(prev => [...prev, msg]);
      }
    }
  };

  useEffect(() => {
    if (activeChatId) {
      setSelectedChatId(activeChatId);
    }
  }, [activeChatId]);

  // Sync state chats when initialChats prop changes
  useEffect(() => {
    setChats(initialChats);
  }, [initialChats]);

  // Real-time messages fetch from Firestore subcollection
  useEffect(() => {
    if (!isFirebase) {
      setMessages([]);
      setIsMessagesLoading(false);
      return;
    }
    if (!selectedChatId) {
      setMessages([]);
      setIsMessagesLoading(false);
      return;
    }

    setIsMessagesLoading(true);

    const q = query(
      collection(db, "chats", selectedChatId, "messages"),
      orderBy("createdAt", "asc"),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot: any) => {
      const list: Message[] = [];
      let hasNewIncoming = false;

      snapshot.docChanges().forEach((change: any) => {
        if (change.type === 'added') {
          const d = change.doc.data();
          if (d.senderId && d.senderId !== currentUser?.uid) {
            hasNewIncoming = true;
          }
        }
      });

      if (hasNewIncoming) {
        triggerHapticMessage();
      }

      snapshot.forEach((docSnap: any) => {
        const d = docSnap.data();
        list.push({
          id: docSnap.id,
          senderId: d.senderId === currentUser?.uid ? 'me' : d.senderId,
          senderName: d.senderName || "Creator",
          senderAvatar: d.senderAvatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&q=80",
          text: d.text || "",
          mediaUrl: d.mediaUrl || "",
          timestamp: (d.createdAt && typeof d.createdAt.seconds === 'number') ? new Date(d.createdAt.seconds * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Just now',
          isRead: d.read || false,
          deletedFor: d.deletedFor || [],
          unsent: d.unsent || false,
          seenBy: d.seenBy || []
        });
      });
      setMessages(list);
      setIsMessagesLoading(false);
    }, (err: any) => {
      console.warn("Messages snap issue:", err);
      setIsMessagesLoading(false);
    });

    return () => unsubscribe();
  }, [isFirebase, selectedChatId, currentUser]);

  // Real-time Group Seen Receipt Logic
  useEffect(() => {
    if (!isFirebase || !currentUser?.uid || !selectedChatId || !selectedChat?.isGroup || messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    const isMe = lastMessage.senderId === 'me' || lastMessage.senderId === currentUser.uid;
    if (!isMe && !lastMessage.seenBy?.includes(currentUser.uid)) {
      const msgRef = doc(db, "chats", selectedChatId, "messages", lastMessage.id);
      updateDoc(msgRef, {
        seenBy: arrayUnion(currentUser.uid)
      }).catch(err => console.warn("Error updating seen receipt:", err));
    }
  }, [isFirebase, currentUser, selectedChatId, selectedChat, messages]);

  // Real-time mutual follow lock validation
  useEffect(() => {
    if (!isFirebase) {
      setIsMutuallyFollowing(true);
      setOurFollowStatus(null);
      setTheirFollowStatus(null);
      return;
    }

    if (!currentUser?.uid) {
      console.warn("Skipping mutual follow validation: currentUser.uid is undefined.");
      setIsMutuallyFollowing(true);
      setOurFollowStatus(null);
      setTheirFollowStatus(null);
      return;
    }

    if (!selectedChatId || selectedChat?.isGroup) {
      setIsMutuallyFollowing(true);
      setOurFollowStatus(null);
      setTheirFollowStatus(null);
      return;
    }

    const otherUid = selectedChat?.members.find(m => m !== currentUser.uid);
    if (!otherUid) {
      setIsMutuallyFollowing(true);
      setOurFollowStatus(null);
      setTheirFollowStatus(null);
      return;
    }

    const ourFollowingRef = doc(db, "follows", `${currentUser.uid}_${otherUid}`);
    const theirFollowingRef = doc(db, "follows", `${otherUid}_${currentUser.uid}`);

    let ourStatusVal: string | null = null;
    let theirStatusVal: string | null = null;

    const unsub1 = onSnapshot(ourFollowingRef, (snap1: any) => {
      ourStatusVal = snap1.exists() ? snap1.data()?.status || "pending" : null;
      setOurFollowStatus(ourStatusVal);
      setIsMutuallyFollowing(ourStatusVal === "accepted" && theirStatusVal === "accepted");
    }, (err) => {
      console.error("error sub1:", err);
    });

    const unsub2 = onSnapshot(theirFollowingRef, (snap2: any) => {
      theirStatusVal = snap2.exists() ? snap2.data()?.status || "pending" : null;
      setTheirFollowStatus(theirStatusVal);
      setIsMutuallyFollowing(ourStatusVal === "accepted" && theirStatusVal === "accepted");
    }, (err) => {
      console.error("error sub2:", err);
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, [isFirebase, currentUser, selectedChatId, selectedChat]);

  const [recipientAllowMessagesFromAnyone, setRecipientAllowMessagesFromAnyone] = useState<boolean>(false);

  // Real-time recipient / group open messaging flag listener
  useEffect(() => {
    if (!isFirebase || !selectedChatId) {
      setRecipientAllowMessagesFromAnyone(false);
      return;
    }

    if (selectedChat?.isGroup) {
      const unsubGroup = onSnapshot(doc(db, "chats", selectedChatId), (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setRecipientAllowMessagesFromAnyone(!!(d.openMessaging || d.allowMessagesFromAnyone));
        } else {
          setRecipientAllowMessagesFromAnyone(false);
        }
      }, (err) => {
        console.warn("Group openMessaging check notice:", err);
      });
      return () => unsubGroup();
    } else {
      const otherUid = selectedChat?.members.find(m => m !== currentUser?.uid && m !== 'me');
      if (!otherUid) {
        setRecipientAllowMessagesFromAnyone(false);
        return;
      }

      const unsubUser = onSnapshot(doc(db, "users", otherUid), (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setRecipientAllowMessagesFromAnyone(!!d.allowMessagesFromAnyone);
        } else {
          setRecipientAllowMessagesFromAnyone(false);
        }
      }, (err) => {
        console.warn("Recipient allowMessagesFromAnyone check notice:", err);
      });
      return () => unsubUser();
    }
  }, [isFirebase, selectedChatId, selectedChat, currentUser]);

  const rawActiveMessages = isFirebase 
    ? [
        ...messages, 
        ...optimisticMessages.filter((m: any) => m.chatId === selectedChatId),
        ...failedMessages.filter((m: any) => m.chatId === selectedChatId)
      ] 
    : (selectedChat?.messages || []);

  const activeMessages = rawActiveMessages.filter((m: any) => 
    m.senderId !== 'system' && m.senderId !== 'bot' && m.senderId !== 'aura-bot'
  );

  // Messaging permission check: Groups vs 1:1 Direct Chat
  const isGroupChat = !!(selectedChat?.isGroup || selectedChat?.type === 'group' || (selectedChat?.admins && selectedChat.admins.length > 0));
  let isLocked = false;

  if (isGroupChat) {
    if (selectedChat?.onlyAdminCanSend && !isGroupAdmin) {
      isLocked = true; // Only admins can send in admin-only groups
    } else {
      isLocked = false; // Anyone in group can message if admin-only mode is OFF
    }
  } else {
    // 1:1 Direct Chat: Mutual follow required UNLESS recipient turned ON 'allowMessagesFromAnyone'
    if (recipientAllowMessagesFromAnyone) {
      isLocked = false;
    } else {
      isLocked = isFirebase ? !isMutuallyFollowing : !!selectedChat?.isLocked;
    }
  }
  
  // Group chat generation modal state
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [newGroupPrivacy, setNewGroupPrivacy] = useState<'public' | 'private'>('public');
  
  // Custom group creation logo upload
  const groupLogoInputRef = useRef<HTMLInputElement>(null);
  const [newGroupLogoFile, setNewGroupLogoFile] = useState<File | null>(null);
  const [newGroupLogoPreview, setNewGroupLogoPreview] = useState<string>('');

  const handleNewGroupLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setNewGroupLogoFile(file);
      try {
        const compressedDataUrl = await compressImage(file, 300, 0.7);
        setNewGroupLogoPreview(compressedDataUrl);
      } catch (err) {
        setNewGroupLogoPreview(URL.createObjectURL(file));
      }
    }
  };

  // Group / Chat sharing modal state
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareModalData, setShareModalData] = useState({ title: '', desc: '', url: '', img: '' });

  // Detailed view of another user's profile state
  const [localViewingProfileCreator, setLocalViewingProfileCreator] = useState<Creator | null>(null);

  const setViewingProfileCreator = (creator: Creator | null) => {
    if (creator && onSelectCreator) {
      onSelectCreator(creator);
    } else {
      setLocalViewingProfileCreator(creator);
    }
  };

  const viewingProfileCreator = localViewingProfileCreator;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const userSentMessageRef = useRef(false);
  const prevChatIdRef = useRef<string | null>(null);
  const prevLastMsgIdRef = useRef<string | null>(null);

  // Global users search state
  const [globalSearchResults, setGlobalSearchResults] = useState<any[]>([]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setGlobalSearchResults([]);
      return;
    }

    if (!isFirebase) {
      const matches = creators.filter(cr => 
        cr.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        cr.username?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setGlobalSearchResults(matches);
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      try {
        // Statically imported
        const usersRef = collection(db, "users");
        const q = query(usersRef, limit(100));
        const querySnapshot = await getDocs(q);
        const results: any[] = [];
        querySnapshot.forEach((docSnap) => {
          const d = docSnap.data();
          if (currentUser && d.uid === currentUser.uid) return;
          
          const uName = (d.username || "").toLowerCase();
          const dispName = (d.displayName || d.fullName || "").toLowerCase();
          const queryLower = searchQuery.toLowerCase();

          if (uName.includes(queryLower) || dispName.includes(queryLower)) {
            results.push({
              id: d.uid,
              name: d.displayName || d.fullName || "Anonymous",
              username: d.username || "creator",
              avatar: d.avatarUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80",
              specialty: d.specialty || "Digital Artist",
              coverPhotoUrl: d.coverPhotoUrl || "",
              portfolioPhotos: d.portfolioPhotos || [],
              bio: d.bio || ""
            });
          }
        });
        setGlobalSearchResults(results);
      } catch (err) {
        console.error("Global search query failed:", err);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, isFirebase, creators, currentUser]);

  const handleSelectGlobalUser = async (targetUser: any) => {
    if (isGuest) {
      if (onNavigateToLogin) onNavigateToLogin();
      return;
    }

    if (!currentUser) return;

    if (isFirebase) {
      try {
        // Statically imported
        const userDocRef = doc(db, "users", targetUser.id);
        const userDocSnap = await getDoc(userDocRef);
        let userData = targetUser;
        if (userDocSnap.exists()) {
          const d = userDocSnap.data();
          userData = {
            id: targetUser.id,
            name: d.displayName || d.fullName || targetUser.name || "Anonymous",
            username: d.username || targetUser.username || "creator",
            avatar: d.avatarUrl || targetUser.avatar,
            specialty: d.specialty || targetUser.specialty || "Digital Artist",
            coverPhotoUrl: d.coverPhotoUrl || targetUser.coverPhotoUrl || "",
            portfolioPhotos: d.portfolioPhotos || targetUser.portfolioPhotos || [],
            exclusivePhotos: d.exclusivePhotos || d.portfolioPhotos || [],
            bio: d.bio || targetUser.bio || "",
            city: d.city || "New York",
            state: d.state || "NY",
            country: d.country || "USA"
          };
        }

        const creatorObj: Creator = {
          id: userData.id,
          name: userData.name,
          specialty: userData.specialty,
          distance: "0.5km",
          avatar: userData.avatar,
          activeProject: userData.bio || "Sharing concepts.",
          x: Math.floor(Math.random() * 40) + 30,
          y: Math.floor(Math.random() * 40) + 30,
          status: 'active',
          skillTags: ["UI Design", "3D Design"],
          portfolioPhotos: userData.portfolioPhotos || [],
          exclusivePhotos: userData.portfolioPhotos || [],
          username: userData.username,
          city: userData.city,
          state: userData.state,
          country: userData.country,
          coverPhotoUrl: userData.coverPhotoUrl
        };
        setViewingProfileCreator(creatorObj);
      } catch (err) {
        console.error("Error fetching global search user details:", err);
        // Fallback to what we have
        const creatorObj: Creator = {
          id: targetUser.id,
          name: targetUser.name,
          specialty: targetUser.specialty,
          distance: "0.5km",
          avatar: targetUser.avatar,
          activeProject: targetUser.bio || "Sharing concepts.",
          x: Math.floor(Math.random() * 40) + 30,
          y: Math.floor(Math.random() * 40) + 30,
          status: 'active',
          skillTags: ["UI Design", "3D Design"],
          portfolioPhotos: targetUser.portfolioPhotos || [],
          exclusivePhotos: targetUser.portfolioPhotos || [],
          username: targetUser.username,
          city: "New York",
          state: "NY",
          country: "USA",
          coverPhotoUrl: targetUser.coverPhotoUrl
        };
        setViewingProfileCreator(creatorObj);
      }
    } else {
      const creatorObj: Creator = creators.find(c => c.id === targetUser.id) || {
        id: targetUser.id,
        name: targetUser.name,
        specialty: targetUser.specialty,
        distance: "0.5km",
        avatar: targetUser.avatar,
        activeProject: targetUser.bio || "Sharing concepts.",
        x: Math.floor(Math.random() * 40) + 30,
        y: Math.floor(Math.random() * 40) + 30,
        status: 'active',
        skillTags: ["UI Design", "3D Design"],
        portfolioPhotos: targetUser.portfolioPhotos || [],
        exclusivePhotos: targetUser.portfolioPhotos || [],
        username: targetUser.username,
        city: "New York",
        state: "NY",
        country: "USA",
        coverPhotoUrl: targetUser.coverPhotoUrl
      };
      setViewingProfileCreator(creatorObj);
    }
  };

  // Auto scroll logic strictly adhering to requirements:
  // - Stay at current scroll position.
  // - Auto-scroll only when the current user sends a new message or opening a new chat.
  // - Do not jump while receiving messages.
  // - Do not jump while loading images.
  // - Preserve scroll position after pagination.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || activeMessages.length === 0) return;

    const isNewChat = prevChatIdRef.current !== selectedChatId;
    prevChatIdRef.current = selectedChatId;

    const lastMessage = activeMessages[activeMessages.length - 1];
    const isNewMessage = lastMessage && lastMessage.id !== prevLastMsgIdRef.current;
    prevLastMsgIdRef.current = lastMessage?.id || null;

    if (isNewChat) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      userSentMessageRef.current = false;
    } else if (isNewMessage && userSentMessageRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      userSentMessageRef.current = false;
    }
  }, [activeMessages, selectedChatId]);

  const handleSendFollowRequest = async () => {
    if (!currentUser || !selectedChat) return;
    const otherUid = selectedChat.members.find(m => m !== currentUser.uid);
    if (!otherUid) return;

    // Find other creator details to get name & avatar
    const otherCreator = creators.find(cr => cr.id === otherUid);
    const otherName = otherCreator?.name || "this creator";
    const otherAvatar = otherCreator?.avatar || "";

    try {
      // Statically imported
      
      const batch = writeBatch(db);
      
      // Check if they are already following us (pending)
      const theirFollowRef = doc(db, "follows", `${otherUid}_${currentUser.uid}`);
      const theirFollowSnap = await getDoc(theirFollowRef);

      if (theirFollowSnap.exists() && theirFollowSnap.data()?.status === "pending") {
        // They already followed us! Make it mutual and accepted!
        const ourFollowRef = doc(db, "follows", `${currentUser.uid}_${otherUid}`);
        batch.set(ourFollowRef, {
          fromUid: currentUser.uid,
          toUid: otherUid,
          status: "accepted",
          createdAt: serverTimestamp(),
          respondedAt: serverTimestamp()
        });

        batch.set(theirFollowRef, {
          status: "accepted",
          respondedAt: serverTimestamp()
        }, { merge: true });

        // Ensure chat thread
        const chatId = [currentUser.uid, otherUid].sort().join('_');
        const chatDocRef = doc(db, "chats", chatId);
        batch.set(chatDocRef, {
          participants: [currentUser.uid, otherUid],
          isGroup: false,
          createdAt: serverTimestamp(),
          lastMessageText: "",
          lastMessageSenderName: otherName,
          lastMessageSenderAvatar: otherAvatar,
          lastMessageAt: serverTimestamp()
        }, { merge: true });

        await batch.commit();

        setErrorToast({
          message: "Connected! 🤝✨",
          sub: `You are now mutually connected with ${otherName}!`
        });
      } else {
        // Direct follow
        const ourFollowRef = doc(db, "follows", `${currentUser.uid}_${otherUid}`);
        batch.set(ourFollowRef, {
          fromUid: currentUser.uid,
          toUid: otherUid,
          status: "accepted",
          createdAt: serverTimestamp()
        });

        // Create notification for them
        const recipientNotifRef = doc(collection(db, "notifications", otherUid, "items"));
        batch.set(recipientNotifRef, {
          type: "follow",
          fromUid: currentUser.uid,
          fromUsername: userProfile?.username || "alex",
          fromAvatar: userProfile?.avatarUrl || "",
          createdAt: serverTimestamp(),
          read: false,
          title: "New Follower! 👤",
          description: `@${userProfile?.username || 'alex'} started following you.`,
          targetId: `${currentUser.uid}_${otherUid}`,
        });

        await batch.commit();

        setErrorToast({
          message: "Following! 🤝",
          sub: `You are now following ${otherName}!`
        });
      }
    } catch (err) {
      console.error("Error sending follow request from chat window:", err);
      setErrorToast({
        message: "Request Failed",
        sub: "Could not send connection handshake. Please retry."
      });
    }
  };

  const handleClearSelectedImage = () => {
    if (selectedImage?.preview) {
      URL.revokeObjectURL(selectedImage.preview);
    }
    setSelectedImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRetryImageUpload = async (msg: any) => {
    if (!selectedChatId || !currentUser || !isFirebase) return;
    setOptimisticMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isSending: true, isFailed: false, progress: 10, timestamp: 'Uploading...' } : m));
    
    try {
      await uploadChatImage({
        chatId: selectedChatId,
        imageInput: msg.file || msg.mediaUrl,
        text: msg.text || "",
        userProfile,
        onProgress: (p) => {
          setOptimisticMessages(prev => prev.map(m => m.id === msg.id ? { ...m, progress: p } : m));
        }
      });
      setTimeout(() => {
        setOptimisticMessages(prev => prev.filter(m => m.id !== msg.id));
      }, 1000);
    } catch (err) {
      setOptimisticMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isSending: false, isFailed: true, timestamp: 'Failed – tap to retry' } : m));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputText(val);

    if (selectedChatId && currentUser && isFirebase) {
      const chatDocRef = doc(db, "chats", selectedChatId);
      setDoc(chatDocRef, {
        typing: {
          [currentUser.uid]: {
            timestamp: Date.now(),
            name: userProfile?.displayName || userProfile?.fullName || userProfile?.username || "Member",
            avatar: userProfile?.avatarUrl || ""
          }
        }
      }, { merge: true }).catch(() => {});

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

      typingTimeoutRef.current = setTimeout(() => {
        setDoc(chatDocRef, {
          typing: {
            [currentUser.uid]: {
              timestamp: 0
            }
          }
        }, { merge: true }).catch(() => {});
      }, 3000);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const textToSend = inputText.trim();
    if ((!textToSend && !selectedImage) || !selectedChatId || isGuest) return;

    // STRICT PERMISSION CHECK
    if (isLocked) {
      setErrorToast({
        message: "Message Blocked",
        sub: isGroupChat ? "You must be a member to message this group." : "Mutual follow is required to start a conversation."
      });
      return;
    }

    if (selectedChat?.isGroup && selectedChat?.onlyAdminCanSend && !isGroupAdmin) {
      setErrorToast({
        message: "Message Blocked",
        sub: "This group is in read-only mode for members."
      });
      return;
    }

    // Account status check to prevent suspended/banned users from sending chat messages
    const accStatus = (userProfile?.accountStatus || (userProfile?.status === 'suspended' || userProfile?.status === 'banned' ? userProfile?.status : 'active')).toLowerCase();
    if (accStatus === 'suspended' || accStatus === 'banned') {
      return;
    }

    userSentMessageRef.current = true;
    const currentSelectedImage = selectedImage;
    const currentText = textToSend;

    // Clear inputs immediately for smooth UI
    setInputText('');
    handleClearSelectedImage();

    // Clear typing status immediately on message send
    if (selectedChatId && currentUser && isFirebase) {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      setDoc(doc(db, "chats", selectedChatId), {
        typing: {
          [currentUser.uid]: { timestamp: 0 }
        }
      }, { merge: true }).catch(() => {});
    }

    if (isFirebase && currentUser) {
      if (currentSelectedImage) {
        // Create optimistic message immediately in thread
        const tempId = `opt-img-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const optimisticMsg = {
          id: tempId,
          chatId: selectedChatId,
          senderId: currentUser.uid,
          senderName: userProfile?.displayName || userProfile?.fullName || userProfile?.username || "You",
          senderAvatar: userProfile?.avatarUrl || "",
          text: currentText,
          mediaUrl: currentSelectedImage.preview,
          timestamp: 'Uploading...',
          isSending: true,
          isFailed: false,
          progress: 10,
          file: currentSelectedImage.file || currentSelectedImage.base64,
          createdAt: new Date()
        };

        setOptimisticMessages(prev => [...prev, optimisticMsg]);

        // Background non-blocking upload
        uploadChatImage({
          chatId: selectedChatId,
          imageInput: currentSelectedImage.file || currentSelectedImage.base64,
          text: currentText,
          userProfile,
          onProgress: (p) => {
            setOptimisticMessages(prev => prev.map(m => m.id === tempId ? { ...m, progress: p } : m));
          }
        }).then(() => {
          setTimeout(() => {
            setOptimisticMessages(prev => prev.filter(m => m.id !== tempId));
          }, 1200);
        }).catch((err: any) => {
          console.error("Optimistic image upload failed:", err);
          setOptimisticMessages(prev => prev.map(m => 
            m.id === tempId 
              ? { ...m, isSending: false, isFailed: true, timestamp: 'Failed – tap to retry' } 
              : m
          ));
        });

        return;
      }

      try {
        setIsSending(true);

        const msgData: any = {
          chatId: selectedChatId,
          senderId: currentUser.uid,
          senderName: userProfile?.displayName || userProfile?.fullName || userProfile?.username || "You",
          senderAvatar: userProfile?.avatarUrl || "",
          text: currentText,
          type: "text",
          timestamp: serverTimestamp(),
          createdAt: serverTimestamp(),
          status: "sent"
        };

        // Parallel update: message doc and chat preview
        await Promise.all([
          addDoc(collection(db, "chats", selectedChatId, "messages"), msgData),
          updateDoc(doc(db, "chats", selectedChatId), {
            lastMessageText: currentText,
            lastMessageSenderName: userProfile?.displayName || userProfile?.fullName || userProfile?.username || "You",
            lastMessageSenderAvatar: userProfile?.avatarUrl || "",
            lastMessageAt: serverTimestamp(),
            deletedBy: []
          })
        ]);

      } catch (err: any) {
        console.error("[Firebase Upload Error] Error sending message to Firestore:", err);
        // On error, we might want to restore the text to the input so the user doesn't lose it
        setInputText(currentText);
        const rawErrorMsg = err?.message || String(err);
        const errCode = err?.code || '';
        let errorSub = formatUserFriendlyErrorMessage(err, "Network issue, please check your connection and try again.");
        if (rawErrorMsg.includes("permission-denied") || errCode === "permission-denied" || rawErrorMsg.toLowerCase().includes("permission")) {
          errorSub = isGroupChat
            ? "You must be a member or admin of this group to send messages."
            : "This person requires you to follow each other before messaging.";
        }
        setErrorToast({
          message: "Sending Failed ❌",
          sub: errorSub
        });
      } finally {
        setIsSending(false);
      }
      return;
    }

    const newMsg: Message = {
      id: `m-user-${Date.now()}`,
      senderId: 'me',
      senderName: 'You',
      senderAvatar: getUserAvatar(userProfile),
      text: textToSend,
      mediaUrl: currentSelectedImage ? currentSelectedImage.preview : undefined,
      timestamp: 'Just now',
      isRead: true
    };

    setChats(prev => prev.map(chat => {
      if (chat.id === selectedChatId) {
        return {
          ...chat,
          messages: [...chat.messages, newMsg]
        };
      }
      return chat;
    }));
  };

  const handleSendImage = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedChatId) return;

    // Video file detection (Show "video not support" error as requested)
    if (file.type.startsWith("video/") || file.name.match(/\.(mp4|mov|avi|mkv|webm|3gp|flv|wmv)$/i)) {
      setErrorToast({
        message: "Video Not Supported",
        sub: "video not support"
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    // Client-side image validation
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type) && !file.type.startsWith("image/")) {
      setErrorToast({
        message: "Invalid Format",
        sub: "Please select a JPEG, PNG, or WEBP image."
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      setErrorToast({
        message: "File Too Large",
        sub: "Maximum allowed image size is 5MB."
      });
      return;
    }

    // Compress image client-side (max dimension 1280px, JPEG quality 0.7)
    try {
      const compressed = await compressImage(file, 1280, 0.7);
      setSelectedImage({
        file: compressed.file,
        preview: compressed.dataUrl,
        base64: compressed.dataUrl,
        sizeBytes: compressed.sizeBytes
      } as any);
    } catch (compressErr) {
      console.warn("Client-side image compression failed, using FileReader fallback:", compressErr);
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage({
          file: file,
          preview: URL.createObjectURL(file),
          base64: reader.result as string
        });
      };
      reader.onerror = (err) => {
        console.error("FileReader failed:", err);
        setErrorToast({
          message: "Read Failed",
          sub: "Could not read the selected photo."
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUnsendMessage = async (messageId: string) => {
    if (!selectedChatId) return;
    try {
      await updateDoc(doc(db, "chats", selectedChatId, "messages", messageId), {
        unsent: true,
        text: "Message unsent",
        mediaUrl: ""
      });
    } catch (err) {
      console.error("Error unsending message in Firestore:", err);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!selectedChatId || !currentUser) return;
    try {
      await updateDoc(doc(db, "chats", selectedChatId, "messages", messageId), {
        deletedFor: arrayUnion(currentUser.uid)
      });
    } catch (err) {
      console.error("Error deleting message locally in Firestore:", err);
    }
  };

  const handleClearHistory = async () => {
    if (!selectedChatId || !currentUser) return;
    if (!window.confirm("Are you sure you want to delete your copy of this chat history? This cannot be undone.")) {
      return;
    }
    try {
      const messagesSnap = await getDocs(collection(db, "chats", selectedChatId, "messages"));
      const batch = writeBatch(db);
      messagesSnap.forEach((msgDoc) => {
        const msgRef = doc(db, "chats", selectedChatId, "messages", msgDoc.id);
        batch.update(msgRef, {
          deletedFor: arrayUnion(currentUser.uid)
        });
      });
      await batch.commit();
      setShowDropdown(false);
      setErrorToast({
        message: "History Cleared",
        sub: "All messages in this chat have been deleted for you."
      });
    } catch (err: any) {
      console.error("Error clearing chat history in Firestore:", err);
      setErrorToast({
        message: "Clear Failed",
        sub: err?.message || String(err)
      });
    }
  };

  const handleCreateGroupChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim() || selectedMembers.length === 0) return;

    const groupNameFixed = newGroupName.trim();
    let groupAvatar = newGroupLogoPreview || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(groupNameFixed)}`;
    const isPub = newGroupPrivacy === 'public';
    const logoFileToUpload = newGroupLogoFile;

    // Reset form and close modal immediately so UI response is instant
    setShowCreateGroup(false);
    setNewGroupName('');
    setSelectedMembers([]);
    setNewGroupLogoFile(null);
    setNewGroupLogoPreview('');
    setNewGroupPrivacy('public');

    if (isFirebase && currentUser) {
      try {
        // Create Firestore doc instantly with current compressed avatar / dicebear
        const docRef = await addDoc(collection(db, "chats"), {
          name: groupNameFixed,
          avatar: groupAvatar,
          isGroup: true,
          visibility: newGroupPrivacy,
          isPublic: isPub,
          isLocked: !isPub,
          participants: [currentUser.uid, ...selectedMembers],
          members: [currentUser.uid, ...selectedMembers],
          admins: [currentUser.uid],
          createdAt: serverTimestamp(),
          lastMessageText: `Group "${groupNameFixed}" created by you`,
          lastMessageSenderName: userProfile?.displayName || "You",
          lastMessageSenderAvatar: userProfile?.avatarUrl || "",
          lastMessageAt: serverTimestamp()
        });

        setSelectedChatId(docRef.id);
        setErrorToast({ message: "Group Created", sub: `Welcome to "${groupNameFixed}"!` });

        // Asynchronously upload logo file in background if selected
        if (logoFileToUpload) {
          (async () => {
            try {
              const fileRef = storageRef(storage, `groupAvatars/${docRef.id}_${Date.now()}`);
              const uploadResult = await uploadBytes(fileRef, logoFileToUpload);
              const uploadedUrl = await getDownloadURL(uploadResult.ref);
              await updateDoc(doc(db, "chats", docRef.id), {
                avatar: uploadedUrl,
                groupAvatar: uploadedUrl
              });
            } catch (upErr) {
              console.warn("Background group logo upload error:", upErr);
            }
          })();
        }
      } catch (err: any) {
        console.error("Error creating Firebase group chat:", err);
        setErrorToast({ message: "Creation Failed", sub: formatUserFriendlyErrorMessage(err, "Could not create group. Please check connection.") });
      }
      return;
    }

    const newGroup: ChatThread = {
      id: `group-chat-${Date.now()}`,
      name: groupNameFixed,
      avatar: groupAvatar,
      isGroup: true,
      visibility: newGroupPrivacy,
      isPublic: isPub,
      isLocked: !isPub,
      members: ['me', ...selectedMembers],
      admins: ['me'],
      messages: []
    };

    setChats(prev => [newGroup, ...prev]);
    setSelectedChatId(newGroup.id);
  };

  const toggleSelectMember = (memberId: string) => {
    setSelectedMembers(prev => 
      prev.includes(memberId) ? prev.filter(id => id !== memberId) : [...prev, memberId]
    );
  };

  const handleBlockAction = () => {
    if (!selectedChat) return;
    const oppositeCreator = creators.find(cr => selectedChat.members.includes(cr.id) && cr.id !== 'me');
    if (oppositeCreator && onBlockUser) {
      onBlockUser(oppositeCreator.id);
      // Remove or lock the chat
      setChats(prev => prev.filter(c => c.id !== selectedChat.id));
      setSelectedChatId(null);
    }
    setShowDropdown(false);
  };

  const handleReportAction = () => {
    if (!selectedChat) return;
    if (selectedChat.isGroup) {
      if (onOpenReportModal) {
        onOpenReportModal({
          targetType: 'group',
          targetId: selectedChat.id,
          targetName: selectedChat.name || 'Group Chat',
          targetAvatar: selectedChat.avatar,
          targetContent: `Group Conversation: ${selectedChat.name || 'Group'}`
        });
      } else if (onReportUser) {
        onReportUser(selectedChat.id, `Reported group: ${selectedChat.name || 'Group'}`);
        setToastNotice("Group report submitted to moderators.");
        setTimeout(() => setToastNotice(null), 3000);
      }
    } else {
      const oppositeCreator = creators.find(cr => selectedChat.members.includes(cr.id) && cr.id !== 'me');
      if (oppositeCreator) {
        if (onOpenReportModal) {
          onOpenReportModal({
            targetType: 'user',
            targetId: oppositeCreator.id,
            targetName: oppositeCreator.name,
            targetUsername: oppositeCreator.username,
            targetAvatar: oppositeCreator.avatar
          });
        } else if (onReportUser) {
          onReportUser(oppositeCreator.id, "Reported through conversation options dropdown.");
          setToastNotice(`Report submitted for ${oppositeCreator.name || 'User'}.`);
          setTimeout(() => setToastNotice(null), 3000);
        }
      }
    }
    setShowDropdown(false);
    setShowGroupSettingsModal(false);
  };

  const handleLeaveGroup = async () => {
    if (!selectedChatId || !currentUser || !selectedChat?.isGroup) return;
    const confirmed = window.confirm("Are you sure you want to leave this group?");
    if (!confirmed) return;

    try {
      if (isFirebase) {
        const groupRef = doc(db, "chats", selectedChatId);
        await updateDoc(groupRef, {
          members: arrayRemove(currentUser.uid)
        });
      }
      setChats(prev => prev.filter(c => c.id !== selectedChatId));
      setSelectedChatId(null);
      setShowGroupSettingsModal(false);
      setToastNotice("You left the group.");
      setTimeout(() => setToastNotice(null), 3000);
    } catch (err: any) {
      console.error("Error leaving group:", err);
      setErrorToast({ message: "Error Leaving Group", sub: formatUserFriendlyErrorMessage(err, "Could not leave group.") });
    }
  };

  const handleDeleteGroup = async () => {
    if (!selectedChatId || !currentUser || !selectedChat?.isGroup) return;
    const confirmed = window.confirm("Are you sure you want to delete this group? This action cannot be undone.");
    if (!confirmed) return;

    try {
      if (isFirebase) {
        const groupRef = doc(db, "chats", selectedChatId);
        await deleteDoc(groupRef);
      }
      setChats(prev => prev.filter(c => c.id !== selectedChatId));
      setSelectedChatId(null);
      setShowDropdown(false);
      setShowGroupSettingsModal(false);
      setToastNotice("Group deleted successfully.");
      setTimeout(() => setToastNotice(null), 3000);
    } catch (err: any) {
      console.error("Error deleting group:", err);
      setErrorToast({ message: "Error Deleting Group", sub: formatUserFriendlyErrorMessage(err, "Could not delete group.") });
    }
  };

  const getGroupInitials = (name?: string) => {
    if (!name) return "GC";
    const trimmed = name.trim();
    if (!trimmed) return "GC";
    const words = trimmed.split(/\s+/);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return trimmed.slice(0, 2).toUpperCase();
  };

  const handleShareGroup = () => {
    if (!selectedChat) return;
    const inviteUrl = getShareUrl('group', selectedChat.id);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(inviteUrl);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = inviteUrl;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
    } catch (e) {
      console.warn("Copy group link fallback error:", e);
    }
    setToastNotice("Group link copied!");
    setTimeout(() => setToastNotice(null), 3000);
  };

  const handleGroupAvatarClick = () => {
    groupAvatarInputRef.current?.click();
  };

  const handleGroupAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedChatId) return;

    if (isFirebase && currentUser) {
      try {
        setErrorToast({ message: "Uploading...", sub: "Uploading new group avatar..." });
        // Statically imported
        const fileRef = storageRef(storage, `groupAvatars/${selectedChatId}/${Date.now()}_${file.name}`);
        const uploadResult = await uploadBytes(fileRef, file);
        const downloadUrl = await getDownloadURL(uploadResult.ref);

        await updateDoc(doc(db, "chats", selectedChatId), {
          avatar: downloadUrl
        });

        setErrorToast({ message: "Avatar Updated", sub: "Group avatar has been successfully changed!" });
        setShowDropdown(false);
      } catch (err: any) {
        console.error("Error uploading group avatar:", err);
        setErrorToast({ message: "Update Failed", sub: formatUserFriendlyErrorMessage(err, "Could not upload group avatar.") });
      }
    } else {
      // Mock mode
      const localUrl = URL.createObjectURL(file);
      setChats(prev => prev.map(c => {
        if (c.id === selectedChatId) {
          return { ...c, avatar: localUrl };
        }
        return c;
      }));
      setShowDropdown(false);
    }
  };

  const handleViewMessageSenderProfile = async (message: Message) => {
    if (message.senderId === 'me' || message.senderId === 'system') return;

    // 1. First try to find them in the local creators array
    const localCreator = creators.find(cr => cr.id === message.senderId);
    if (localCreator) {
      setViewingProfileCreator(localCreator);
      return;
    }

    // 2. If Firebase is active, try to fetch the real user document from Firestore
    if (isFirebase) {
      try {
        // Statically imported
        const userDocRef = doc(db, "users", message.senderId);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
          const d = userDocSnap.data();
          const creatorObj: Creator = {
            id: message.senderId,
            name: d.displayName || d.fullName || message.senderName || "Anonymous",
            username: d.username || "creator",
            avatar: d.avatarUrl || message.senderAvatar,
            specialty: d.specialty || "Digital Artist",
            distance: "0.5km",
            activeProject: d.bio || "Sharing concepts.",
            x: Math.floor(Math.random() * 40) + 30,
            y: Math.floor(Math.random() * 40) + 30,
            status: 'active',
            skillTags: d.skillTags || ["UI Design", "3D Design"],
            portfolioPhotos: d.portfolioPhotos || [],
            exclusivePhotos: d.exclusivePhotos || d.portfolioPhotos || [],
            city: d.city || "New York",
            state: d.state || "NY",
            country: d.country || "USA",
            coverPhotoUrl: d.coverPhotoUrl || ""
          };
          setViewingProfileCreator(creatorObj);
          return;
        }
      } catch (err) {
        console.error("Error fetching message sender profile details:", err);
      }
    }

    // 3. Fallback to constructing a temporary creator object from the message metadata
    const creatorFallback: Creator = {
      id: message.senderId,
      name: message.senderName,
      specialty: "Creative Partner",
      distance: "0.5km",
      avatar: message.senderAvatar,
      activeProject: "Sharing concepts.",
      x: Math.floor(Math.random() * 40) + 30,
      y: Math.floor(Math.random() * 40) + 30,
      status: 'active',
      skillTags: ["Creator"],
      portfolioPhotos: [],
      exclusivePhotos: [],
      username: "creator",
      city: "New York",
      state: "NY",
      country: "USA"
    };
    setViewingProfileCreator(creatorFallback);
  };

  // Non-archived chats
  const nonArchivedChats = chats.filter(c => !archivedChatIds.includes(c.id));

  // Count connection request chats (locked chats)
  const requestChats = nonArchivedChats.filter(chat => {
    if (chat.isGroup) return false;
    const isLockedChat = isFirebase ? (selectedChatId === chat.id ? !isMutuallyFollowing : chat.isLocked) : chat.isLocked;
    return isLockedChat;
  });

  // Count unread chats
  const unreadChatsCount = nonArchivedChats.filter(c => {
    const lastMsg = c.messages[c.messages.length - 1];
    const isUnread = (c.unreadCount && c.unreadCount > 0) || (lastMsg && !lastMsg.isRead && lastMsg.senderId !== 'me');
    const isOverriddenRead = readOverrideMap[c.id] === true;
    const isOverriddenUnread = readOverrideMap[c.id] === false;
    if (isOverriddenRead) return false;
    if (isOverriddenUnread) return true;
    return isUnread;
  }).length;

  // Active Category Filtered List
  const activeCategoryList = nonArchivedChats
    .filter(chat => {
      // 1. Search query filter
      if (searchQuery.trim()) {
        const nameMatch = chat.name.toLowerCase().includes(searchQuery.toLowerCase());
        const msgMatch = chat.messages.some(m => m.text?.toLowerCase().includes(searchQuery.toLowerCase()));
        if (!nameMatch && !msgMatch) return false;
      }

      // 2. Active Category Tab Filter
      if (activeCategoryTab === 'all') {
        // "Chats" tab should ONLY show 1:1 conversations
        if (chat.isGroup) return false;
      }

      if (activeCategoryTab === 'unread') {
        const lastMsg = chat.messages[chat.messages.length - 1];
        const isUnread = (chat.unreadCount && chat.unreadCount > 0) || (lastMsg && !lastMsg.isRead && lastMsg.senderId !== 'me');
        const isOverriddenRead = readOverrideMap[chat.id] === true;
        const isOverriddenUnread = readOverrideMap[chat.id] === false;
        if (isOverriddenRead) return false;
        if (isOverriddenUnread) return true;
        return isUnread;
      }
      if (activeCategoryTab === 'groups') {
        return chat.isGroup;
      }
      if (activeCategoryTab === 'pinned') {
        return pinnedChatIds.includes(chat.id);
      }
      if (activeCategoryTab === 'requests') {
        if (chat.isGroup) return false;
        const isLockedChat = isFirebase ? (selectedChatId === chat.id ? !isMutuallyFollowing : chat.isLocked) : chat.isLocked;
        return isLockedChat;
      }

      // Default 'all' tab -> exclude locked requests unless searching
      if (!searchQuery.trim()) {
        const isLockedChat = isFirebase ? (selectedChatId === chat.id ? !isMutuallyFollowing : chat.isLocked) : chat.isLocked;
        if (isLockedChat && !chat.isGroup) return false;
      }

      return true;
    })
    .sort((a, b) => {
      // Pinned chats sorted first
      const isAPinned = pinnedChatIds.includes(a.id);
      const isBPinned = pinnedChatIds.includes(b.id);
      if (isAPinned && !isBPinned) return -1;
      if (!isAPinned && isBPinned) return 1;

      const timeA = (a as any).lastMessageAt || (a as any).updatedAt || (a.messages && a.messages.length > 0 ? (parseInt(a.messages[a.messages.length - 1].id.replace(/[^\d]/g, '')) || 0) : 0);
      const timeB = (b as any).lastMessageAt || (b as any).updatedAt || (b.messages && b.messages.length > 0 ? (parseInt(b.messages[b.messages.length - 1].id.replace(/[^\d]/g, '')) || 0) : 0);

      if (timeA !== timeB) {
        return timeB - timeA;
      }

      return b.id.localeCompare(a.id);
    });

  const messageRequestsCount = requestChats.length;

  // Story click & unlock handling
  const handleStoryClick = (story: Story, idx: number) => {
    const isExclusive = story.creatorId === 'julian';
    const isUnlocked = unlockedStories.includes(story.creatorId);
    
    if (isExclusive && !isUnlocked) {
      setStoryToUnlock({ story, idx });
    } else {
      if (onViewStory) onViewStory(idx);
    }
  };

  const handleConfirmUnlockStory = async () => {
    if (!storyToUnlock) return;
    const { story, idx } = storyToUnlock;
    
    const tokenCost = 50;
    const currentTokens = userProfile?.creatorTokens || 0;
    
    if (currentTokens >= tokenCost) {
      const updatedTokens = currentTokens - tokenCost;
      
      try {
        if (updateProfile) {
          await updateProfile({ creatorTokens: updatedTokens });
        }
        setUnlockedStories(prev => [...prev, story.creatorId]);
        setStoryToUnlock(null);
        setErrorToast({
          message: "Story Unlocked! 🤝✨",
          sub: `Paid 50 tokens to Elena & Julian. Balance: ${updatedTokens} tokens.`
        });
        
        setTimeout(() => {
          if (onViewStory) onViewStory(idx);
        }, 600);
      } catch (err) {
        console.warn("Error updating token balance:", err);
        setUnlockedStories(prev => [...prev, story.creatorId]);
        setStoryToUnlock(null);
        if (onViewStory) onViewStory(idx);
      }
    } else {
      setErrorToast({
        message: "Insufficient Balance 🪙",
        sub: `Unlock requires 50 tokens. Current balance is ${currentTokens} tokens.`
      });
      setStoryToUnlock(null);
    }
  };

  return (
    <div className="w-full h-full min-h-0 flex font-sans text-white overflow-hidden bg-[#0A0A0A]">
      
      {/* 1. Chats List Panel (Apple Minimal Redesign) */}
      <div className={`w-full ${selectedChatId ? 'hidden md:flex' : 'flex'} md:w-[380px] lg:w-[420px] flex-col h-full min-h-0 bg-black relative overflow-hidden`}>
        
        {/* Apple Style Status Bar Spacer */}
        <div style={{ height: 'env(safe-area-inset-top, 20px)' }}></div>

        {/* Large Header Section */}
        <div className="px-6 pt-8 pb-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (onBackToMap) onBackToMap();
              }}
              className="p-1.5 hover:bg-[#1C1C1E] active:scale-90 rounded-full transition-all cursor-pointer text-white"
              title="Go to Home"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            <h1 className="text-[28px] font-bold tracking-tight text-white">Wave</h1>
          </div>

          <div className="flex items-center gap-3 relative">
            <button
              onClick={() => {
                if (isGuest) {
                  if (onNavigateToLogin) onNavigateToLogin();
                } else {
                  setShowFabMenu(!showFabMenu);
                }
              }}
              className="w-10 h-10 rounded-full bg-[#1C1C1E] flex items-center justify-center text-[#DDF639] active:scale-95 transition-all cursor-pointer shadow-sm"
              title="Actions"
            >
              <Edit3 className={`w-5 h-5 transition-transform ${showFabMenu ? 'rotate-45 text-rose-500' : ''}`} />
            </button>

            {/* Integrated Actions Menu */}
            <AnimatePresence>
              {showFabMenu && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 10 }}
                  className="absolute top-12 right-0 w-48 bg-[#1C1C1E] border border-white/5 rounded-2xl shadow-2xl p-2 z-50 text-left overflow-hidden"
                >
                  <button
                    onClick={() => {
                      setShowFabMenu(false);
                      const searchInput = document.querySelector('input[placeholder="Search"]') as HTMLInputElement;
                      if (searchInput) searchInput.focus();
                    }}
                    className="w-full px-4 py-2.5 hover:bg-white/5 rounded-xl text-xs font-bold flex items-center gap-2.5 text-white hover:text-[#DDF639] transition-colors cursor-pointer"
                  >
                    <Search className="w-4 h-4 text-[#DDF639]" />
                    <span>New Chat</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowFabMenu(false);
                      setShowCreateGroup(true);
                    }}
                    className="w-full px-4 py-2.5 hover:bg-white/5 rounded-xl text-xs font-bold flex items-center gap-2.5 text-white hover:text-[#DDF639] transition-colors cursor-pointer"
                  >
                    <Users className="w-4 h-4 text-[#DDF639]" />
                    <span>New Wave</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowFabMenu(false);
                      setShareModalData({
                        title: 'Anvio Talk Collaboration Channel',
                        desc: 'Join Anvio Talk to connect and collaborate with nearby creative artists!',
                        url: PRODUCTION_URL,
                        img: userProfile?.avatarUrl || ''
                      });
                      setShareModalOpen(true);
                    }}
                    className="w-full px-4 py-2.5 hover:bg-white/5 rounded-xl text-xs font-bold flex items-center gap-2.5 text-white hover:text-[#DDF639] transition-colors cursor-pointer"
                  >
                    <Share2 className="w-4 h-4 text-[#DDF639]" />
                    <span>Invite Friends</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Minimal Search Bar */}
        <div className="px-6 py-3 shrink-0">
          <div className="relative flex items-center bg-[#1C1C1E] rounded-2xl px-4 py-2.5 text-zinc-500 focus-within:text-white transition-colors">
            <Search className="w-4 h-4 mr-3 flex-shrink-0" />
            <input
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent text-[17px] text-white placeholder-zinc-500 outline-none border-0 p-0 focus:ring-0"
            />
          </div>
        </div>

        {/* Segmented Tab Bar */}
        <div className="px-6 py-2 shrink-0">
          <div className="p-1 bg-[#1C1C1E] rounded-2xl flex items-center">
            <button
              onClick={() => setActiveCategoryTab('all')}
              className={`flex-1 py-2 text-[13px] font-bold rounded-xl text-center transition-all duration-200 cursor-pointer ${
                activeCategoryTab === 'all' ? 'text-black bg-[#DDF639] shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Chats
            </button>
            <button
              onClick={() => setActiveCategoryTab('groups')}
              className={`flex-1 py-2 text-[13px] font-bold rounded-xl text-center transition-all duration-200 cursor-pointer ${
                activeCategoryTab === 'groups' ? 'text-black bg-[#DDF639] shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Spaces & Waves
            </button>
          </div>
        </div>

        {/* REDESIGN: 5 Horizontal Sub-Tab Filters */}
        {!searchQuery && activeCategoryTab !== 'all' && activeCategoryTab !== 'groups' && (
          <div className="px-5 py-2.5 flex gap-2 overflow-x-auto scrollbar-none flex-shrink-0">
            {(['all', 'unread', 'groups', 'pinned', 'requests'] as const).map((cat) => {
              const isActive = activeCategoryTab === cat;
              let badgeCount = 0;
              if (cat === 'unread') badgeCount = unreadChatsCount;
              if (cat === 'requests') badgeCount = messageRequestsCount;
              if (cat === 'pinned') badgeCount = pinnedChatIds.length;

              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategoryTab(cat)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold tracking-wide transition-all cursor-pointer border outline-none flex items-center gap-1.5 shrink-0 ${
                    isActive
                      ? 'bg-[#DDF639] text-black border-[#DDF639] shadow-xs'
                      : 'bg-[#141414] border-[#2A2A2A] text-[#B5B5B5] hover:text-white hover:bg-[#1A1A1A]'
                  }`}
                >
                  <span className="capitalize">{cat}</span>
                  {badgeCount > 0 && (
                    <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold leading-tight ${
                      isActive ? 'bg-black text-[#DDF639]' : 'bg-[#DDF639] text-black'
                    }`}>
                      {badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Chats scrollable feed with FAB */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar relative">
          {sidebarLoading ? (
            <div className="divide-y divide-slate-100/30">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="px-6 py-4 flex items-center gap-4 animate-pulse">
                  <div className="w-12 h-12 bg-slate-200 rounded-full flex-shrink-0" />
                  <div className="flex-1 space-y-2 text-left">
                    <div className="flex justify-between items-baseline">
                      <div className="w-24 h-3 bg-slate-200 rounded" />
                      <div className="w-8 h-2 bg-slate-200 rounded" />
                    </div>
                    <div className="w-40 h-2.5 bg-slate-200 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : searchQuery ? (
            <div className="space-y-6">
              {/* Global directory search */}
              <div>
                <div className="px-6 py-2 text-[10px] font-black uppercase tracking-widest text-[#854c6f] bg-[#854c6f]/5">
                  Global Creative Directory
                </div>
                {globalSearchResults.length > 0 ? (
                  globalSearchResults.map(user => (
                    <div
                      key={user.id}
                      onClick={() => handleSelectGlobalUser(user)}
                      className="px-6 py-4 border-b border-[#fbf9f9] flex items-center justify-between gap-4 cursor-pointer hover:bg-[#efeded]/30 transition-colors"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-11 h-11 rounded-full overflow-hidden flex-shrink-0 bg-slate-100 border border-slate-100">
                          <img className="w-full h-full object-cover rounded-full" src={getUserAvatar(user)} alt={user.name} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-black text-black truncate">{user.name}</p>
                          <p className="text-[10px] text-slate-400 font-bold">@{user.username}</p>
                        </div>
                      </div>
                      <div className="text-[9px] font-extrabold uppercase tracking-widest text-[#854c6f] px-2.5 py-1 bg-[#854c6f]/5 rounded-full shrink-0">
                        View Profile
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-6 py-8 text-center text-slate-400">
                    <p className="text-xs font-bold">No global creators found matching "{searchQuery}"</p>
                  </div>
                )}
              </div>

              {/* Search in Public Groups */}
              <div>
                <div className="px-6 py-2 text-[10px] font-black uppercase tracking-widest text-[#DDF639] bg-[#141414] border-y border-[#2C3222] flex items-center justify-between">
                  <span>Groups Search</span>
                  {isSearchingGroups && <span className="text-[9px] text-slate-400 font-bold animate-pulse">Searching...</span>}
                </div>
                {searchResultsGroups.length > 0 ? (
                  searchResultsGroups.map(group => {
                    const isMember = group.members.includes(currentUser?.uid || 'me');
                    return (
                      <div
                        key={group.id}
                        className="px-6 py-3.5 border-b border-[#2C3222] flex items-center justify-between gap-3 bg-[#0A0A0A] hover:bg-[#141414] transition-colors"
                      >
                        <div
                          onClick={() => {
                            setSelectedChatId(group.id);
                            setSearchQuery('');
                          }}
                          className="flex items-center gap-3 min-w-0 cursor-pointer flex-1"
                        >
                          <img className="w-10 h-10 rounded-full object-cover border border-[#2C3222] bg-slate-800 shrink-0" src={group.avatar || getDefaultAvatar()} alt={group.name} />
                          <div className="min-w-0 text-left">
                            <h4 className="text-xs font-black text-white truncate">{group.name}</h4>
                            <p className="text-[10px] text-slate-400 font-bold flex items-center gap-1 mt-0.5">
                              <Users className="w-3 h-3 text-[#DDF639]" />
                              <span>{group.members.length} Members</span>
                            </p>
                          </div>
                        </div>

                        {isMember ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedChatId(group.id);
                              setSearchQuery('');
                            }}
                            className="px-3 py-1 bg-[#1A1F12] text-[#DDF639] rounded-full text-[10px] font-extrabold border border-[#2C3222] hover:bg-[#2C3222] cursor-pointer shrink-0"
                          >
                            Open Chat
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleJoinGroupById(group.id, group.name)}
                            disabled={isJoining}
                            className="px-3 py-1 bg-[#DDF639] text-black rounded-full text-[10px] font-extrabold hover:bg-[#DDF639]/90 cursor-pointer shrink-0"
                          >
                            + Join Group
                          </button>
                        )}
                      </div>
                    );
                  })
                ) : (
                  !isSearchingGroups && searchQuery && (
                    <div className="px-6 py-4 text-center text-slate-500 text-xs font-semibold">
                      No public groups found matching "{searchQuery}"
                    </div>
                  )
                )}
              </div>

              {/* Search in conversations */}
              <div>
                <div className="px-6 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400 bg-slate-50">
                  Existing Messages
                </div>
                {activeCategoryList.length > 0 ? (
                  activeCategoryList.map(chat => {
                    const active = selectedChatId === chat.id;
                    const lastMsg = chat.messages[chat.messages.length - 1];
                    const otherCreator = creators.find(cr => chat.members.includes(cr.id) && cr.id !== 'me' && cr.id !== currentUser?.uid);
                    const avatarSrc = chat.isGroup ? (chat.avatar || getDefaultAvatar()) : getUserAvatar(otherCreator);
                    const titleName = chat.isGroup ? chat.name : (otherCreator?.name || chat.name);
                    const isOnline = otherCreator?.status === 'active';
                    const { label: contentLabel, icon: contentIcon } = getChatContentTypeLabel(lastMsg);

                    return (
                      <div
                        key={chat.id}
                        onClick={() => setSelectedChatId(chat.id)}
                        className={`px-6 py-4 border-b border-slate-100 flex items-center gap-4 cursor-pointer transition-colors relative ${
                          active ? 'bg-[#efeded]/60' : 'hover:bg-[#efeded]/30'
                        }`}
                      >
                        <div className="relative flex-shrink-0">
                          <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-100 border">
                            <img className="w-full h-full object-cover" src={avatarSrc} alt={titleName} />
                          </div>
                        </div>

                        <div className="flex-1 min-w-0 text-left">
                          <div className="flex justify-between items-baseline mb-0.5">
                            <h4 className="text-xs font-bold text-slate-800 truncate pr-2">{titleName}</h4>
                            <span className="text-[10px] text-slate-400 font-semibold shrink-0">
                              {lastMsg?.timestamp || ''}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-slate-500">
                            <span className="text-sm shrink-0">{contentIcon}</span>
                            <span className="truncate">{contentLabel}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="px-6 py-8 text-center text-slate-400">
                    <p className="text-xs font-bold">No active chats matching "{searchQuery}"</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            activeCategoryList.length > 0 ? (
              <>
                {activeCategoryList.map((chat, idx) => {
                  const active = selectedChatId === chat.id;
                  const lastMsg = chat.messages[chat.messages.length - 1];
                  const isPinned = pinnedChatIds.includes(chat.id);
                  const isMuted = mutedChatIds.includes(chat.id);
                  
                  const otherCreator = creators.find(cr => chat.members.includes(cr.id) && cr.id !== 'me' && cr.id !== currentUser?.uid);
                  const avatarSrc = chat.isGroup
                    ? resolveAvatarUrl(chat.avatar)
                    : (getUserAvatar(otherCreator) !== getDefaultAvatar() ? getUserAvatar(otherCreator) : resolveAvatarUrl(chat.lastMessageSenderAvatar || chat.avatar));
                  const titleName = chat.isGroup
                    ? chat.name
                    : (otherCreator?.name || chat.lastMessageSenderName || chat.name || "Chat User");
                  const isVerified = otherCreator?.isVerified || otherCreator?.badgeType === 'bolt' || otherCreator?.badgeType === 'sparkle';
                  const isOnline = otherCreator?.status === 'active';
                  const lastActiveText = otherCreator?.activityDetail || lastMsg?.timestamp || 'Active today';

                  const { label: contentLabel, icon: contentIcon } = getChatContentTypeLabel(lastMsg);

                  const rawUnread = (chat.unreadCount && chat.unreadCount > 0) || (lastMsg && !lastMsg.isRead && lastMsg.senderId !== 'me');
                  const isOverriddenRead = readOverrideMap[chat.id] === true;
                  const isOverriddenUnread = readOverrideMap[chat.id] === false;
                  const isUnread = isOverriddenRead ? false : (isOverriddenUnread ? true : rawUnread);

                  return (
                    <React.Fragment key={chat.id}>
                      <div className="relative overflow-hidden group select-none border-b border-[#1C1C1E]/50">
                        {/* Swipe Background Actions (WhatsApp style) */}
                        <div className="absolute inset-0 flex items-center justify-end bg-[#0A0A0A]">
                          <div className="flex h-full items-center">
                            <button
                              onClick={(e) => handleTogglePin(chat.id, e)}
                              className={`h-full w-16 flex flex-col items-center justify-center gap-1 transition-all ${
                                isPinned ? 'bg-amber-500 text-black' : 'bg-[#2A2A2E] text-white'
                              }`}
                            >
                              <Pin className="w-4 h-4" />
                              <span className="text-[10px] font-bold">{isPinned ? 'Unpin' : 'Pin'}</span>
                            </button>
                            <button
                              onClick={(e) => handleToggleMute(chat.id, e)}
                              className="h-full w-16 bg-[#3A3A3C] text-white flex flex-col items-center justify-center gap-1"
                            >
                              {isMuted ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                              <span className="text-[10px] font-bold">{isMuted ? 'Unmute' : 'Mute'}</span>
                            </button>
                            <button
                              onClick={(e) => handleArchiveChat(chat.id, e)}
                              className="h-full w-16 bg-[#8E8E93] text-white flex flex-col items-center justify-center gap-1"
                            >
                              <Archive className="w-4 h-4" />
                              <span className="text-[10px] font-bold">Archive</span>
                            </button>
                            <button
                              onClick={(e) => handleDeleteChat(chat.id, e)}
                              className="h-full w-16 bg-[#FF3B30] text-white flex flex-col items-center justify-center gap-1"
                            >
                              <Trash2 className="w-4 h-4" />
                              <span className="text-[10px] font-bold">Delete</span>
                            </button>
                          </div>
                        </div>

                        {/* Card Foreground */}
                        <motion.div
                          drag="x"
                          dragConstraints={{ left: -256, right: 0 }}
                          dragElastic={0.02}
                          onDragEnd={(e, info) => {
                            if (info.offset.x < -160) {
                              setSwipedCardId(chat.id);
                            } else {
                              setSwipedCardId(null);
                            }
                          }}
                          style={{ x: swipedCardId === chat.id ? -256 : 0 }}
                          onClick={() => {
                            if (swipedCardId) {
                              setSwipedCardId(null);
                            } else {
                              setSelectedChatId(chat.id);
                            }
                          }}
                          className={`px-5 py-4 flex items-center gap-4 cursor-pointer transition-colors relative z-10 bg-black ${
                            active ? 'bg-[#1C1C1E]' : 'hover:bg-[#1C1C1E]/50'
                          }`}
                        >
                          {/* Real User Profile Avatar & Online Status */}
                          <div className="relative shrink-0">
                            <img
                              className={`w-12 h-12 rounded-full object-cover ${isUnread ? 'ring-2 ring-[#DDF639]/40' : 'border border-white/10'}`}
                              src={avatarSrc}
                              alt={titleName}
                            />
                            {isOnline && (
                              <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-[#DDF639] border-2 border-[#131316] rounded-full"></span>
                            )}
                            {isMuted && (
                              <div className="absolute -top-1 -right-1 w-4 h-4 bg-black/60 backdrop-blur-sm text-zinc-400 rounded-full flex items-center justify-center border border-white/10 scale-90">
                                <VolumeX className="w-2.5 h-2.5" />
                              </div>
                            )}
                          </div>

                          {/* Info area */}
                          <div className="flex-1 min-w-0 text-left">
                            <div className="flex justify-between items-center mb-0.5">
                              <div className="flex items-center gap-1.5 min-w-0 pr-2">
                                <h4 className={`text-sm font-semibold truncate group-hover:text-[#DDF639] transition-colors ${active ? 'text-[#DDF639]' : 'text-zinc-100'}`}>
                                  {titleName}
                                </h4>
                                {isVerified && (
                                  <svg className="w-3.5 h-3.5 text-[#DDF639] inline flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"></path>
                                  </svg>
                                )}
                                {isPinned && (
                                  <Pin className="w-3 h-3 text-[#DDF639] shrink-0 fill-[#DDF639]" title="Pinned" />
                                )}
                              </div>
                              <span className={`text-[11px] font-medium shrink-0 ${isUnread ? 'text-[#DDF639]' : 'text-zinc-400'}`}>
                                {lastMsg?.timestamp || ''}
                              </span>
                            </div>

                            {/* Content type label */}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 text-xs text-zinc-400 truncate w-full">
                                {/* Red arrow and blue envelope as seen in screenshot */}
                                <div className="flex items-center -space-x-1 shrink-0">
                                  <svg className="w-4 h-4 text-rose-500" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M11 4v12.17l-4.58-4.59L5 13l7 7 7-7-1.41-1.42L13 16.17V4z" />
                                  </svg>
                                  <Mail className="w-4 h-4 text-blue-400 fill-blue-400/20" />
                                </div>
                                <span className={`truncate font-medium flex-1 ${isUnread ? 'text-zinc-200' : ''}`}>
                                  {(() => {
                                    const chatTyping = (chat as any).typing || {};
                                    const activeTypingUser = Object.entries(chatTyping).find(([uid, infoVal]) => {
                                      const info = infoVal as any;
                                      if (uid === currentUser?.uid || uid === 'me') return false;
                                      return info && info.timestamp && (Date.now() - info.timestamp) < 4000;
                                    });
                                    if (activeTypingUser) return <span className="italic text-[#DDF639]">Typing...</span>;

                                    // FIX: Priority logic for inbox keywords
                                    if (chat.lastMessageText) return chat.lastMessageText;
                                    if (lastMsg) return lastMsg.text || contentLabel;
                                    return contentLabel;
                                  })()}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {renderMessageStatus(lastMsg)}
                                {isUnread && (
                                  <div className="w-5 h-5 bg-[#DDF639] text-black font-extrabold text-[10px] rounded-full flex items-center justify-center shadow-glow-lime">
                                    {chat.unreadCount || 1}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Quick action desktop toggle */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSwipedCardId(swipedCardId === chat.id ? null : chat.id);
                            }}
                            className="p-1 text-[#B5B5B5] hover:text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0 hidden sm:block"
                            title="Card Actions"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        </motion.div>
                      </div>

                      {/* Interspersed Home-Style Adsterra Inline Card */}
                      {(idx + 1) % 3 === 0 && (
                        <div className="px-4 py-2">
                          <AdPlacement placement="chat_list" format="inline-card" adIndex={idx} />
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </>
            ) : (
              <div className="py-16 text-center px-6 flex flex-col items-center">
                <div className="w-16 h-16 rounded-full bg-[#DDF639]/10 text-[#DDF639] flex items-center justify-center mb-4 border border-[#DDF639]/20 shadow-inner">
                  <MessageSquareDashed className="w-8 h-8" />
                </div>
                <h4 className="text-sm font-bold text-white">No Conversations Found</h4>
                <p className="text-xs text-[#B5B5B5] max-w-[240px] leading-relaxed mt-1 mb-5">
                  {activeCategoryTab === 'requests'
                    ? "No pending connection requests at the moment."
                    : activeCategoryTab === 'unread'
                    ? "You're all caught up! No unread messages."
                    : activeCategoryTab === 'pinned'
                    ? "No pinned conversations yet. Drag or swipe left on any chat to pin it!"
                    : "Discover matched creators near Tribeca to start collaborating."}
                </p>
                <button
                  onClick={() => {
                    if (onBackToMap) onBackToMap();
                  }}
                  className="px-6 py-2.5 bg-[#DDF639] hover:bg-[#DDF639]/90 text-black rounded-full text-xs font-bold uppercase tracking-wider shadow-md transition-all active:scale-95 flex items-center gap-2 cursor-pointer"
                >
                  <Compass className="w-4 h-4 text-black" />
                  <span>Find People</span>
                </button>
              </div>
            )
          )}
        </div>

        {/* Removed redundant FAB logic as it's now integrated in the header Pencil icon */}

      </div>

      {/* 2. Active Chat Panel */}
      <div className={`flex-1 ${!selectedChatId ? 'hidden md:flex' : 'flex'} flex-col bg-[#0A0A0A] h-full min-h-0 overflow-hidden relative`}>
        {selectedChat ? (
          <div className="flex flex-col h-full w-full min-h-0 overflow-hidden relative">
            
            {/* Header Area - Solid Black for Group & DM Header */}
            {selectedChat.isGroup ? (
              <header 
                className="w-full bg-[#0A0A0A] border-b border-[#2A2A2A] px-3 sm:px-4 flex items-center justify-between shrink-0 select-none z-40"
                style={{ 
                  paddingTop: 'env(safe-area-inset-top, 0px)', 
                  height: 'calc(76px + env(safe-area-inset-top, 0px))', 
                  minHeight: 'calc(76px + env(safe-area-inset-top, 0px))' 
                }}
              >
                {/* Left section: Back Arrow + Circular 50x50 Group Avatar + Group Name & Participant Count */}
                <div className="flex items-center gap-4 flex-1 min-w-0 mr-2">
                  <button 
                    onClick={() => setSelectedChatId(null)}
                    className="p-2 -ml-2 text-white hover:bg-[#1C1C1E] active:bg-[#DDF639]/10 rounded-full transition-colors cursor-pointer shrink-0"
                    title="Back"
                  >
                    <ArrowLeft className="w-6 h-6" />
                  </button>

                  <div
                    onClick={() => {
                      setEditingGroupName(selectedChat.name || selectedChat.title || '');
                      setShowGroupSettingsModal(true);
                    }}
                    className="flex items-center gap-3.5 flex-1 min-w-0 cursor-pointer group py-1"
                  >
                    {/* Circular Group Avatar */}
                    {selectedChat.avatar ? (
                      <img 
                        src={selectedChat.avatar} 
                        alt={selectedChat.name}
                        className="w-[44px] h-[44px] rounded-[14px] object-cover shrink-0 border border-[#2A2A2A] shadow-sm"
                      />
                    ) : (
                      <div className="w-[44px] h-[44px] rounded-[14px] bg-[#1C1C1E] text-[#DDF639] border border-[#2A2A2A] flex items-center justify-center font-bold text-lg shrink-0">
                        {getGroupInitials(selectedChat.name)}
                      </div>
                    )}

                    <div className="flex flex-col text-left overflow-hidden min-w-0">
                      <h3 className="text-[17px] font-bold text-white leading-tight truncate tracking-tight group-hover:text-[#DDF639] transition-colors">
                        {selectedChat.name || "Group"}
                      </h3>
                      <p className="text-[11px] text-[#8E8E93] font-medium truncate mt-0.5">
                        {(() => {
                          const count = selectedChat.members?.length || 0;
                          return `${count} ${count === 1 ? 'member' : 'members'}`;
                        })()}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Right section: Join Group button + Vertical 3-Dot Overflow Menu */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Join Group Button for non-members */}
                  {currentUser && !selectedChat.members.includes(currentUser.uid) && (
                    <button
                      onClick={handleJoinGroup}
                      disabled={isJoining}
                      className="bg-[#DDF639] hover:bg-[#DDF639]/90 text-black font-extrabold text-xs px-3.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm transition-all cursor-pointer active:scale-95 shrink-0"
                    >
                      <Users className="w-3.5 h-3.5 text-black" />
                      <span>{isJoining ? "Joining..." : "Join Group"}</span>
                    </button>
                  )}

                  {/* Vertical 3-Dot Overflow Menu Toggle */}
                  <div className="relative">
                    <button 
                      onClick={() => setShowDropdown(!showDropdown)}
                      className="w-10 h-10 hover:bg-[#141414] active:bg-[#1A1F12] rounded-full flex items-center justify-center text-white transition-colors cursor-pointer focus:outline-none"
                      title="Group Options"
                      aria-label="Group Options"
                    >
                      <MoreVertical className="w-6 h-6 text-white" />
                    </button>

                    {/* Material 3 Overflow Dropdown Menu */}
                    <AnimatePresence>
                      {showDropdown && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: -6 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: -6 }}
                          transition={{ duration: 0.15, ease: "easeOut" }}
                          className="absolute right-0 top-12 w-56 bg-[#141414] border border-[#2A2A2A] rounded-2xl shadow-xl p-1.5 z-50 text-left overflow-hidden text-white"
                        >
                          {/* 1. View Group */}
                          <button
                            onClick={() => {
                              setEditingGroupName(selectedChat.name || '');
                              setShowGroupSettingsModal(true);
                              setShowDropdown(false);
                            }}
                            className="w-full px-3.5 py-2.5 hover:bg-[#1F1F1F] rounded-xl text-xs font-semibold flex items-center gap-3 text-white cursor-pointer transition-colors"
                          >
                            <Info className="w-4 h-4 text-[#B5B5B5]" />
                            <span>View Group</span>
                          </button>

                          {/* 2. Group Members */}
                          <button
                            onClick={() => {
                              setEditingGroupName(selectedChat.name || '');
                              setShowGroupSettingsModal(true);
                              setShowDropdown(false);
                            }}
                            className="w-full px-3.5 py-2.5 hover:bg-[#1F1F1F] rounded-xl text-xs font-semibold flex items-center gap-3 text-white cursor-pointer transition-colors"
                          >
                            <Users className="w-4 h-4 text-[#B5B5B5]" />
                            <span>Group Members ({selectedChat.members ? selectedChat.members.filter((m: string) => m !== 'system' && m !== 'bot').length : 0})</span>
                          </button>

                          {/* 3. Share Group Link */}
                          <button
                            onClick={() => {
                              handleShareGroup();
                              setShowDropdown(false);
                            }}
                            className="w-full px-3.5 py-2.5 hover:bg-[#1F1F1F] rounded-xl text-xs font-semibold flex items-center gap-3 text-white cursor-pointer transition-colors"
                          >
                            <Share2 className="w-4 h-4 text-[#DDF639]" />
                            <span className="text-[#DDF639]">Share Group Link</span>
                          </button>

                          {/* 4. In-Chat Sponsored Ads Toggle */}
                          <button
                            onClick={() => {
                              handleToggleInChatAds(!isCurrentChatAdsEnabled);
                              setShowDropdown(false);
                            }}
                            className="w-full px-3.5 py-2.5 hover:bg-[#1F1F1F] rounded-xl text-xs font-semibold flex items-center justify-between text-white cursor-pointer transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <Sparkles className="w-4 h-4 text-[#DDF639]" />
                              <span>In-Chat Sponsored Ads</span>
                            </div>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                              isCurrentChatAdsEnabled ? 'bg-[#DDF639] text-black' : 'bg-zinc-800 text-zinc-400'
                            }`}>
                              {isCurrentChatAdsEnabled ? 'ON' : 'OFF'}
                            </span>
                          </button>

                          {/* 5. Report Group */}
                          <button
                            onClick={() => {
                              handleReportAction();
                              setShowDropdown(false);
                            }}
                            className="w-full px-3.5 py-2.5 hover:bg-[#1F1F1F] rounded-xl text-xs font-semibold flex items-center gap-3 text-white cursor-pointer transition-colors"
                          >
                            <Flag className="w-4 h-4 text-[#B5B5B5]" />
                            <span>Report Group</span>
                          </button>

                          <div className="my-1 border-t border-[#2A2A2A]" />

                          {/* 5. Leave Group (For members) */}
                          <button
                            onClick={() => {
                              setShowDropdown(false);
                              handleLeaveGroup();
                            }}
                            className="w-full px-3.5 py-2.5 hover:bg-rose-950/40 rounded-xl text-xs font-semibold flex items-center gap-3 text-rose-400 cursor-pointer transition-colors"
                          >
                            <LogOut className="w-4 h-4 text-rose-400" />
                            <span>Leave Group</span>
                          </button>

                          {/* 6. Delete Group (For owner/admin) */}
                          {(() => {
                            const isGroupAdmin = selectedChat.admins?.includes(currentUser?.uid || 'me') ||
                              selectedChat.members?.[0] === currentUser?.uid ||
                              currentUser?.uid === 'alex' ||
                              !selectedChat.admins ||
                              selectedChat.admins.length === 0;

                            return isGroupAdmin ? (
                              <button
                                onClick={() => {
                                  setShowDropdown(false);
                                  handleDeleteGroup();
                                }}
                                className="w-full px-3.5 py-2.5 hover:bg-rose-950/40 rounded-xl text-xs font-semibold flex items-center gap-3 text-rose-500 cursor-pointer transition-colors"
                              >
                                <Trash2 className="w-4 h-4 text-rose-500" />
                                <span>Delete Group</span>
                              </button>
                            ) : null;
                          })()}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </header>
            ) : (
              <header 
                className="w-full bg-[#0A0A0A] border-b border-[#2A2A2A] px-3 sm:px-4 flex items-center justify-between shrink-0 text-white z-40 select-none"
                style={{ 
                  paddingTop: 'env(safe-area-inset-top, 0px)', 
                  height: 'calc(76px + env(safe-area-inset-top, 0px))', 
                  minHeight: 'calc(76px + env(safe-area-inset-top, 0px))' 
                }}
              >
                <div className="flex items-center gap-4 flex-1 min-w-0 mr-2">
                  <button 
                    onClick={() => setSelectedChatId(null)}
                    className="p-2 -ml-2 text-white hover:bg-[#1C1C1E] active:bg-[#DDF639]/10 rounded-full transition-colors cursor-pointer shrink-0"
                    title="Back"
                  >
                    <ArrowLeft className="w-6 h-6" />
                  </button>

                  {(() => {
                    const otherCreator = creators.find(cr => selectedChat.members && selectedChat.members.includes(cr.id) && cr.id !== 'me' && cr.id !== currentUser?.uid);
                    const avatarSrc = (otherCreator && getUserAvatar(otherCreator) !== getDefaultAvatar())
                      ? getUserAvatar(otherCreator)
                      : resolveAvatarUrl(selectedChat.lastMessageSenderAvatar || selectedChat.avatar || selectedChat.groupAvatar);
                    const titleName = otherCreator?.name || selectedChat.lastMessageSenderName || selectedChat.name || "Chat User";

                    return (
                      <div 
                        onClick={() => {
                          if (currentUser && otherCreator) setViewingProfileCreator(otherCreator);
                        }}
                        className="flex items-center gap-3.5 cursor-pointer hover:opacity-90 transition-opacity flex-1 min-w-0"
                      >
                        <div className="relative shrink-0">
                          <img
                            src={avatarSrc}
                            alt={titleName}
                            className="w-[44px] h-[44px] rounded-[14px] object-cover border border-[#2A2A2A]"
                          />
                          {otherCreator?.status === 'active' && (
                            <div className="absolute bottom-0 right-0 w-3 h-3 bg-[#DDF639] rounded-full border-2 border-black" />
                          )}
                        </div>
                        <div className="text-left flex flex-col overflow-hidden min-w-0">
                          <h4 className="text-[17px] font-bold text-white tracking-tight flex items-center gap-1.5 leading-tight truncate">
                            {titleName}
                            {otherCreator?.badgeType === 'bolt' && <Sparkles className="w-3.5 h-3.5 text-[#DDF639]" />}
                          </h4>
                          <p className="text-[11px] text-[#8E8E93] font-medium truncate mt-0.5">
                            {otherCreator?.status === 'active' ? 'Active now' : 'Online'}
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Chat action options dropdown toggle */}
                  {currentUser && (
                    <div className="relative">
                      <button 
                        onClick={() => setShowDropdown(!showDropdown)}
                        className="w-9 h-9 hover:bg-[#141414] active:bg-[#1A1F12] rounded-full flex items-center justify-center text-white transition-colors cursor-pointer focus:outline-none"
                        title="More options"
                        aria-label="More options"
                      >
                        <MoreVertical className="w-5 h-5 text-white" />
                      </button>
                  
                      {/* Collapsible Dropdown menu */}
                      <AnimatePresence>
                        {showDropdown && (
                          <motion.div
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 5 }}
                            className="absolute right-0 mt-2 w-56 bg-[#141414] border border-[#2A2A2A] rounded-2xl shadow-xl p-1.5 z-50 text-left text-white"
                          >
                            {/* View creator details */}
                            <button
                              onClick={() => {
                                const otherCreator = creators.find(cr => selectedChat.members.includes(cr.id) && cr.id !== 'me');
                                if (otherCreator) setViewingProfileCreator(otherCreator);
                                setShowDropdown(false);
                              }}
                              className="w-full px-3.5 py-2.5 hover:bg-[#1F1F1F] rounded-xl text-xs font-semibold flex items-center gap-2.5 text-white cursor-pointer transition-colors"
                            >
                              <User className="w-4 h-4 text-[#B5B5B5]" /> View Details
                            </button>

                            {/* In-Chat Sponsored Ads Toggle */}
                            <button
                              onClick={() => {
                                handleToggleInChatAds(!isCurrentChatAdsEnabled);
                                setShowDropdown(false);
                              }}
                              className="w-full px-3.5 py-2.5 hover:bg-[#1F1F1F] rounded-xl text-xs font-semibold flex items-center justify-between text-white cursor-pointer transition-colors"
                            >
                              <div className="flex items-center gap-2.5">
                                <Sparkles className="w-4 h-4 text-[#DDF639]" />
                                <span>In-Chat Sponsored Ads</span>
                              </div>
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                                isCurrentChatAdsEnabled ? 'bg-[#DDF639] text-black' : 'bg-zinc-800 text-zinc-400'
                              }`}>
                                {isCurrentChatAdsEnabled ? 'ON' : 'OFF'}
                              </span>
                            </button>

                            {/* Share Profile Link option for DMs */}
                            <button
                              onClick={() => {
                                const otherCreator = creators.find(cr => selectedChat.members.includes(cr.id) && cr.id !== 'me');
                                const targetId = otherCreator?.username || otherCreator?.id || selectedChat.members.find((m: string) => m !== currentUser?.uid && m !== 'me') || selectedChat.id;
                                const shareUrl = getShareUrl('profile', targetId);
                                try {
                                  if (navigator.clipboard && window.isSecureContext) {
                                    navigator.clipboard.writeText(shareUrl);
                                  } else {
                                    const textArea = document.createElement("textarea");
                                    textArea.value = shareUrl;
                                    document.body.appendChild(textArea);
                                    textArea.select();
                                    document.execCommand("copy");
                                    document.body.removeChild(textArea);
                                  }
                                } catch (e) {
                                  console.warn("Copy link error:", e);
                                }
                                setToastNotice("Profile link copied to clipboard!");
                                setShowDropdown(false);
                              }}
                              className="w-full px-3.5 py-2.5 hover:bg-[#1F1F1F] rounded-xl text-xs font-semibold flex items-center gap-2.5 text-[#DDF639] cursor-pointer transition-colors"
                            >
                              <Share2 className="w-4 h-4 text-[#DDF639]" /> Share Profile
                            </button>

                            <div className="my-1 border-t border-[#2A2A2A]" />

                            {/* Clear Chat History */}
                            <button
                              onClick={handleClearHistory}
                              className="w-full px-3.5 py-2.5 hover:bg-rose-950/40 rounded-xl text-xs font-semibold flex items-center gap-2.5 text-rose-400 cursor-pointer transition-colors"
                            >
                              <Trash2 className="w-4 h-4 text-rose-400" /> Clear Chat History
                            </button>

                            {/* Safety: Block user */}
                            <button
                              onClick={handleBlockAction}
                              className="w-full px-3.5 py-2.5 hover:bg-rose-950/40 rounded-xl text-xs font-semibold flex items-center gap-2.5 text-rose-400 cursor-pointer transition-colors"
                            >
                              <Ban className="w-4 h-4 text-rose-400" /> Block User
                            </button>

                            {/* Safety: Report user */}
                            <button
                              onClick={handleReportAction}
                              className="w-full px-3.5 py-2.5 hover:bg-[#1F1F1F] rounded-xl text-xs font-semibold flex items-center gap-2.5 text-[#B5B5B5] hover:text-rose-400 cursor-pointer transition-colors"
                            >
                              <Flag className="w-4 h-4" /> Report Content
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              </header>
            )}

            {/* Private Group non-member overlay */}
            {selectedChat.isGroup && (selectedChat.visibility !== 'public' && !selectedChat.isPublic) && currentUser && !selectedChat.members?.includes(currentUser.uid) && !selectedChat.members?.includes('me') ? (
              <div className="flex-1 flex flex-col justify-center items-center p-8 text-center bg-[#141414] text-white select-none">
                <div className="w-14 h-14 bg-[#1F2417] border border-[#2C3222] text-[#DDF639] rounded-full flex items-center justify-center shadow-md mb-4 animate-bounce">
                  <Lock className="w-6 h-6 text-[#DDF639]" />
                </div>
                <h4 className="font-extrabold text-white text-[15px] mb-1.5">Private Group Conversation</h4>
                <p className="text-[12px] text-[#B5B5B5] max-w-[290px] leading-relaxed font-semibold mb-5">
                  This group is private. Messages and photos are hidden from non-members. Join the group to view messages.
                </p>
                <button
                  type="button"
                  onClick={() => handleJoinGroupById(selectedChat.id, selectedChat.name)}
                  disabled={isJoining}
                  className="px-6 py-2.5 bg-[#DDF639] text-black font-extrabold text-[11px] uppercase tracking-wider rounded-full shadow-lg hover:bg-[#DDF639]/90 active:scale-95 transition-all cursor-pointer"
                >
                  {isJoining ? "Joining Group..." : "Join Private Group"}
                </button>
              </div>
            ) : isLocked ? (
              <div className="flex-1 flex flex-col justify-center items-center p-8 text-center bg-[#efeded]/30 select-none">
                <div className="w-14 h-14 bg-white border border-[#efeded] text-[#854c6f] rounded-full flex items-center justify-center shadow-md mb-4 animate-bounce">
                  <Lock className="w-6 h-6" />
                </div>
                <h4 className="font-extrabold text-[#1b1c1c] text-[15px] mb-1.5">Mutual Match Pending</h4>
                <p className="text-[12px] text-[#444748] max-w-[280px] leading-relaxed font-semibold">
                  Direct message threads unlock once both parties follow each other.
                </p>
                {isGuest && (
                  <button
                    onClick={onNavigateToLogin}
                    className="mt-5 px-6 py-2.5 bg-[#1b1c1c] text-white font-extrabold text-[11px] uppercase tracking-wider rounded-full"
                  >
                    Create Account to Connect
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Active Message Feed */}
                <div 
                  ref={scrollContainerRef} 
                  className={`flex-1 w-full min-h-0 p-4 md:p-6 overflow-y-auto space-y-4 custom-scrollbar flex flex-col ${(!currentUser && !(selectedChat.isGroup && (selectedChat.visibility === 'public' || selectedChat.isPublic))) ? 'overflow-hidden select-none pointer-events-none' : ''}`}
                >
                  {(() => {
                    const visibleMessages = activeMessages.filter(m => {
                      if (m.id.startsWith('deleted-')) return false;
                      if (m.deletedFor && m.deletedFor.includes(currentUser?.uid || '')) return false;
                      if (selectedChat.isGroup && m.senderId === 'system') return false;
                      return true;
                    });

                    return visibleMessages.flatMap((message, index) => {
                      const isMe = message.senderId === 'me' || (currentUser && message.senderId === currentUser.uid);
                      const elements = [];

                      elements.push(
                        <div key={message.id} className={`w-full flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                          <motion.div 
                            drag={currentUser ? "x" : false}
                            dragConstraints={{ left: -100, right: 100 }}
                            onDragEnd={(event, info) => {
                              if (currentUser && (info.offset.x < -80 || info.offset.x > 80)) {
                                handleDeleteMessage(message.id);
                              }
                            }}
                            className={`flex gap-3.5 max-w-[88%] sm:max-w-[80%] relative ${isMe ? 'flex-row-reverse' : 'text-left'}`}
                          >
                          {/* Avatar */}
                          {!isMe && (
                            <div 
                              onClick={() => {
                                if (currentUser) handleViewMessageSenderProfile(message);
                              }}
                              className="w-8 h-8 rounded-full overflow-hidden bg-slate-100 flex-shrink-0 border border-slate-100 mt-1 cursor-pointer hover:scale-105 active:scale-95 transition-transform"
                              title={`View ${message.senderName}'s profile`}
                            >
                              {message.senderAvatar ? (
                                <img src={message.senderAvatar} alt={message.senderName} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full bg-[#1A1F12] text-[#DDF639] flex items-center justify-center text-[10px] font-bold">SM</div>
                              )}
                            </div>
                          )}

                          {/* Content text/image */}
                          <div className="space-y-1 relative group/msg">
                            <div 
                              onClick={() => {
                                if (currentUser && !message.unsent) {
                                  setActiveMessageMenuId(activeMessageMenuId === message.id ? null : message.id);
                                }
                              }}
                              className={`p-3.5 px-4 rounded-2xl text-[15px] font-medium leading-relaxed shadow-sm cursor-pointer select-none transition-all ${
                                message.unsent
                                  ? 'bg-[#1C1C1E] text-[#8E8E93] border border-white/5 line-through'
                                  : (message.senderId === 'me' || (currentUser && message.senderId === currentUser.uid))
                                    ? 'bg-[#DDF639] text-black rounded-tr-sm hover:opacity-95 shadow-md'
                                    : 'bg-[#1C1C1E] text-white rounded-tl-sm hover:bg-[#2C2C2E] shadow-sm'
                              }`}
                            >
                              {message.unsent ? (
                                <span className="italic text-[#444748]">Message unsent</span>
                              ) : message.mediaUrl ? (
                                <div className="space-y-2 select-text pointer-events-auto">
                                  {/* Image container with 16px corner radius */}
                                  <div className="relative rounded-2xl overflow-hidden border border-[#E8E8E8] shadow-xs max-w-[280px] sm:max-w-[320px]">
                                    <img 
                                      src={message.mediaUrl} 
                                      alt="Shared attachment" 
                                      className="w-full max-h-[340px] object-cover rounded-2xl cursor-pointer hover:opacity-95 transition-opacity" 
                                      referrerPolicy="no-referrer"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!(message as any).isSending && !(message as any).isFailed) {
                                          setExpandedMediaUrl(message.mediaUrl);
                                        }
                                      }}
                                    />

                                    {/* Uploading progress overlay (WhatsApp-style spinning circle ring) */}
                                    {(message as any).isSending && (
                                      <div className="absolute inset-0 bg-black/65 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 z-20 transition-all">
                                        <div className="relative w-14 h-14 flex items-center justify-center">
                                          {/* Outer spinning SVG ring */}
                                          <svg className="w-14 h-14 -rotate-90 animate-spin" viewBox="0 0 36 36">
                                            <path
                                              className="text-white/20"
                                              strokeWidth="3"
                                              stroke="currentColor"
                                              fill="none"
                                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                            />
                                            <path
                                              className="text-[#DDF639]"
                                              strokeDasharray={`${(message as any).progress || 15}, 100`}
                                              strokeWidth="3"
                                              strokeLinecap="round"
                                              stroke="currentColor"
                                              fill="none"
                                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                            />
                                          </svg>
                                          <span className="absolute text-[10px] font-black text-white">
                                            {(message as any).progress || 0}%
                                          </span>
                                        </div>
                                        <span className="text-[10px] font-extrabold text-[#DDF639] uppercase tracking-wider">Uploading Photo...</span>
                                      </div>
                                    )}

                                    {/* Failed retry overlay */}
                                    {(message as any).isFailed && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleRetryImageUpload(message);
                                        }}
                                        className="absolute inset-0 bg-black/75 backdrop-blur-[2px] flex flex-col items-center justify-center gap-1.5 z-20 cursor-pointer hover:bg-black/85 transition-colors p-2 text-center"
                                      >
                                        <div className="w-9 h-9 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center">
                                          <AlertCircle className="w-5 h-5" />
                                        </div>
                                        <span className="text-xs font-bold text-white">Upload Failed</span>
                                        <span className="text-[10px] font-extrabold text-[#DDF639] uppercase tracking-wider underline">Tap to Retry</span>
                                      </button>
                                    )}
                                  </div>

                                  {/* Caption Text ALWAYS BELOW the image */}
                                  {message.text && (
                                    <div className={`px-1 text-[14px] font-medium leading-relaxed whitespace-pre-wrap break-words ${(message.senderId === 'me' || (currentUser && message.senderId === currentUser.uid)) ? 'text-black' : 'text-white'}`}>
                                      {renderTextWithLinks(message.text, (message.senderId === 'me' || (currentUser && message.senderId === currentUser.uid)))}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                message.text && (
                                  <p className="whitespace-pre-wrap">{renderTextWithLinks(message.text, isMe)}</p>
                                )
                              )}

                            </div>

                            {/* Options popup */}
                            <AnimatePresence>
                              {activeMessageMenuId === message.id && (
                                <>
                                  <div className="fixed inset-0 z-[110]" onClick={(e) => { e.stopPropagation(); setActiveMessageMenuId(null); }} />
                                  <motion.div
                                    initial={{ opacity: 0, scale: 0.95, y: 5 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95, y: 5 }}
                                    className={`absolute z-[120] mt-1 w-28 bg-[#FFFFFF] border border-[#E8E8E8] rounded-xl shadow-lg p-1 text-left ${isMe ? 'right-0' : 'left-0'}`}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {isMe && !message.unsent && (
                                      <button
                                        onClick={() => {
                                          handleUnsendMessage(message.id);
                                          setActiveMessageMenuId(null);
                                        }}
                                        className="w-full text-left px-2.5 py-1.5 text-[10px] font-bold text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                                      >
                                        Unsend
                                      </button>
                                    )}
                                    <button
                                      onClick={() => {
                                        handleDeleteMessage(message.id);
                                        setActiveMessageMenuId(null);
                                      }}
                                      className="w-full text-left px-2.5 py-1.5 text-[10px] font-bold text-[#444748] hover:bg-[#FBF9F9] rounded-lg cursor-pointer"
                                    >
                                      Delete local
                                    </button>
                                  </motion.div>
                                </>
                              )}
                            </AnimatePresence>
                            
                            {/* Timestamp and receipts row */}
                            <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-tight ${isMe ? 'justify-end' : ''}`}>
                              {message.isFailed ? (
                                <div className="flex items-center gap-1.5 text-rose-500">
                                  <span>Failed</span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRetryMessage(message);
                                    }}
                                    className="bg-rose-500/10 text-rose-500 px-2 py-0.5 rounded-md hover:bg-rose-500/20 transition-colors cursor-pointer border border-rose-500/20"
                                  >
                                    Retry
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <span className="text-[#737373]">{message.timestamp}</span>
                                  {selectedChat?.isGroup && index === visibleMessages.length - 1 && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setViewingSeenByMessage(message);
                                      }}
                                      className="text-[9px] font-black text-[#DDF639] bg-[#DDF639]/10 px-2 py-0.5 rounded-full hover:bg-[#DDF639]/20 transition-all cursor-pointer border border-[#DDF639]/20 ml-1 shrink-0"
                                    >
                                      Seen {(message.seenBy || []).length}
                                    </button>
                                  )}
                                  {isMe && !selectedChat?.isGroup && (
                                    message.isRead ? (
                                      <CheckCheck className="w-3.5 h-3.5 text-[#DDF639]" />
                                    ) : (
                                      <Check className="w-3.5 h-3.5 text-[#737373]" />
                                    )
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                        </motion.div>
                      </div>
                    );

                    // If In-Chat Sponsored Ads are enabled by user/admin, inject ad banner at regular message intervals
                    if (isCurrentChatAdsEnabled && (index + 1) % 6 === 0) {
                      elements.push(
                        <div key={`chat_ad_stream_${message.id}_${index}`} className="w-full flex justify-center py-2 select-none">
                          <div className="w-full max-w-[340px]">
                            <AdPlacement
                              placement={selectedChat.isGroup ? "group_chat" : "chat_inbox"}
                              format="inline-card"
                              adIndex={index}
                            />
                          </div>
                        </div>
                      );
                    }

                    return elements;
                  });
                })()}

                  {/* Real-time typing indicator */}
                  {(() => {
                    const activeTypingUser = Object.entries(typingUsers).find(([uid, infoVal]) => {
                      const info = infoVal as { timestamp?: number; name?: string; avatar?: string };
                      if (uid === currentUser?.uid || uid === 'me') return false;
                      if (!info || !info.timestamp) return false;
                      return (Date.now() - info.timestamp) < 4000;
                    })?.[1] as { timestamp?: number; name?: string; avatar?: string } | undefined;

                    if (!activeTypingUser) return null;

                    return (
                      <div className="flex gap-3 max-w-[80%] mr-auto text-left items-center my-2 animate-in fade-in duration-200">
                        <div className="w-8 h-8 rounded-full overflow-hidden bg-slate-800 flex-shrink-0 border border-slate-700 mt-1">
                          <img 
                            src={activeTypingUser.avatar || getDefaultAvatar()} 
                            alt={activeTypingUser.name || "User"} 
                            className="w-full h-full object-cover" 
                          />
                        </div>
                        <div className="bg-[#141414] text-[#B5B5B5] p-3 px-4 rounded-[1.6rem] rounded-tl-none border border-[#2A2A2A] shadow-sm flex items-center gap-2">
                          <span className="text-[11px] font-bold text-slate-300">{activeTypingUser.name || 'Someone'} is typing</span>
                          <div className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#DDF639] animate-bounce" />
                            <span className="w-1.5 h-1.5 rounded-full bg-[#DDF639] animate-bounce [animation-delay:0.2s]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-[#DDF639] animate-bounce [animation-delay:0.4s]" />
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div ref={messagesEndRef} />
                </div>

                {/* Message Input form bar or Unauthenticated / Locked Connection block */}
                {!currentUser ? (
                  <div className="p-4 bg-white border-t border-[#efeded] flex flex-col items-center gap-2.5 z-30 shadow-lg flex-shrink-0">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                      <Sparkles className="w-4 h-4 text-[#854c6f]" />
                      <span>Continue to Join this Group</span>
                    </div>

                    {showAuthButtons && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                        className="flex items-center gap-3 w-full max-w-sm pt-1"
                      >
                        <button
                          onClick={onNavigateToLogin}
                          className="flex-1 bg-[#854c6f] hover:bg-[#854c6f]/90 text-white font-black text-xs py-3 rounded-2xl shadow-md transition-all cursor-pointer text-center"
                        >
                          Login
                        </button>
                        <button
                          onClick={onNavigateToLogin}
                          className="flex-1 bg-slate-900 hover:bg-black text-white font-black text-xs py-3 rounded-2xl shadow-md transition-all cursor-pointer text-center"
                        >
                          Sign Up
                        </button>
                      </motion.div>
                    )}
                  </div>
                ) : isLocked ? (
                  <div className="bg-black/50 border-t border-white/5 p-8 flex flex-col items-center justify-center text-center gap-4 flex-shrink-0 select-none">
                    <div className="w-16 h-16 bg-[#DDF639]/10 text-[#DDF639] rounded-full flex items-center justify-center shadow-glow-lime">
                      <Lock className="w-7 h-7" />
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-bold text-white text-[16px]">Messaging is Locked</h4>
                      <p className="text-xs font-medium text-zinc-400 max-w-[280px] leading-relaxed">
                        {ourFollowStatus === "pending" || ourFollowStatus === "accepted" && !theirFollowStatus
                          ? "You are following them! Once they follow you back, you can start chatting."
                          : !ourFollowStatus && theirFollowStatus === "pending" || theirFollowStatus === "accepted"
                          ? "This creator is following you! Follow them back to unlock direct messaging."
                          : "You can only message people you're mutually connected with."}
                      </p>
                    </div>
                    {ourFollowStatus === "pending" || ourFollowStatus === "accepted" && !theirFollowStatus ? (
                      <div className="h-11 px-6 bg-[#1C1C1E] text-zinc-500 rounded-full text-[12px] font-bold flex items-center gap-2 border border-white/5">
                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                        <span>Waiting for follow back</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSendFollowRequest}
                        className="h-11 px-8 bg-[#DDF639] text-black rounded-full text-[12px] font-black uppercase tracking-wider flex items-center gap-2 shadow-lg hover:bg-[#cbe32d] active:scale-95 transition-all cursor-pointer"
                      >
                        <span>
                          {!ourFollowStatus && (theirFollowStatus === "pending" || theirFollowStatus === "accepted")
                            ? "Follow Back & Unlock 🤝✨"
                            : "Follow to Message 🤝"}
                        </span>
                      </button>
                    )}
                  </div>
                ) : selectedChat.isGroup && selectedChat.onlyAdminCanSend && !isGroupAdmin ? (
                  <div className="bg-[#0A0A0A] border-t border-[#2C3222] px-6 py-4 flex items-center justify-center">
                    <div className="flex items-center justify-center gap-2 px-5 py-3 bg-[#141414] border border-[#2C3222] text-amber-300 rounded-full text-xs font-extrabold shadow-md w-full">
                      <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Only admins can send messages</span>
                    </div>
                  </div>
                ) : selectedChat.isGroup && currentUser && !(
                  (selectedChat.members && (selectedChat.members.includes(currentUser.uid) || selectedChat.members.includes('me'))) ||
                  (selectedChat.participants && (selectedChat.participants.includes(currentUser.uid) || selectedChat.participants.includes('me'))) ||
                  (selectedChat.admins && (selectedChat.admins.includes(currentUser.uid) || selectedChat.admins.includes('me'))) ||
                  ((!selectedChat.members || selectedChat.members.length === 0) &&
                   (!selectedChat.participants || selectedChat.participants.length === 0) &&
                   (!selectedChat.admins || selectedChat.admins.length === 0))
                ) ? (
                  <div className="bg-[#0A0A0A] border-t border-[#2C3222] px-6 py-4 flex items-center justify-between gap-3 shrink-0 mt-auto">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#DDF639] animate-pulse shrink-0" />
                      <span className="text-xs font-bold text-[#B5B5B5]">🌐 Public Group Preview — Join to chat</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleJoinGroupById(selectedChat.id, selectedChat.name)}
                      disabled={isJoining}
                      className="px-5 py-2 bg-[#DDF639] text-black font-extrabold text-xs rounded-full shadow-md hover:bg-[#DDF639]/90 transition-all cursor-pointer shrink-0"
                    >
                      {isJoining ? "Joining..." : "Join Group"}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col shrink-0 mt-auto w-full z-30 relative bg-black">
                    <form 
                      onSubmit={handleSendMessage}
                      autoComplete="off"
                      className="px-4 py-3 flex items-center gap-3 shrink-0 w-full relative"
                      style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                    >
                      {/* Hidden File Inputs */}
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept="image/*,video/*"
                        className="hidden"
                      />
                      <input
                        type="file"
                        ref={cameraInputRef}
                        onChange={handleFileChange}
                        accept="image/*"
                        className="hidden"
                      />
                      <input
                        type="file"
                        ref={groupAvatarInputRef}
                        onChange={handleGroupAvatarFileChange}
                        accept="image/*"
                        className="hidden"
                      />

                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-10 h-10 bg-[#1C1C1E] text-[#8E8E93] rounded-full flex items-center justify-center transition-all cursor-pointer shrink-0"
                        title="Open Gallery"
                      >
                        <Plus className="w-6 h-6" />
                      </button>

                      <div className="relative flex-1 flex items-center bg-[#1C1C1E] rounded-2xl px-4 py-2">
                        <input
                          type="text"
                          placeholder="Message..."
                          value={inputText}
                          onChange={handleInputChange}
                          className="w-full bg-transparent text-white text-[16px] outline-none border-0 p-0 focus:ring-0 placeholder-zinc-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                          className="text-zinc-500 hover:text-white p-1"
                        >
                          <Smile className="w-5 h-5" />
                        </button>
                      </div>

                      {inputText.length > 0 || selectedImage ? (
                        <button
                          key="send-btn"
                          type="submit"
                          disabled={isSending}
                          className="w-10 h-10 bg-[#DDF639] text-black rounded-full flex items-center justify-center active:scale-90 transition-transform cursor-pointer shrink-0 shadow-lg z-10"
                        >
                          <Send className="w-5 h-5 stroke-[2.5px]" />
                        </button>
                      ) : null}
                    </form>
                  </div>
              )}
              </>
            )}

          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-center items-center text-center p-8 select-none bg-[#0A0A0A]">
            <div className="w-16 h-16 bg-[#DDF639]/10 text-[#DDF639] rounded-full flex items-center justify-center mb-4 border border-[#DDF639]/20">
              <Users className="w-8 h-8" />
            </div>
            <h4 className="font-extrabold text-white text-base">Start a Collaboration Thread</h4>
            <p className="text-xs text-[#B5B5B5] max-w-[280px] leading-relaxed mt-1">Select an active creative channel from the sidebar list, or tap the button above to form a new group.</p>
          </div>
        )}
      </div>

      {/* ==================== 3. CREATE GROUP CHAT POPUP MODAL ==================== */}
      <AnimatePresence>
        {showCreateGroup && (
          <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-[110] flex items-center justify-center p-6 select-none">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-2xl text-left"
            >
              <h3 className="text-xl font-extrabold text-[#1b1c1c] mb-1.5 flex items-center gap-2">
                <Users className="w-5.5 h-5.5 text-[#854c6f]" /> Create Group
              </h3>
              <p className="text-xs text-[#444748] mb-6 leading-relaxed">Assemble nearby matched creators to share feedback loops, review mock designs, or host spatial audio meetups.</p>

              <form onSubmit={handleCreateGroupChat} className="space-y-5">
                {/* Group Title */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-[#444748]" htmlFor="group-name">Group Name</label>
                  <input 
                    id="group-name"
                    type="text"
                    name="off"
                    autoComplete="off"
                    autoCorrect="off"
                    data-lpignore="true"
                    aria-autocomplete="none"
                    required
                    placeholder="e.g. Tribeca Spatial Audio Co."
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    className="w-full h-12 bg-[#fbf9f9] border border-[#efeded] rounded-2xl px-4 text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:ring-1 focus:ring-[#854c6f] outline-none"
                  />
                </div>

                {/* Custom Group Logo Setup */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-[#444748]">Group Logo (Optional)</label>
                  <div className="flex items-center gap-4 p-3.5 bg-[#fbf9f9] border border-[#efeded] rounded-2xl">
                    <div className="relative w-14 h-14 rounded-full overflow-hidden border-2 border-[#854c6f]/20 bg-white flex items-center justify-center shrink-0">
                      {newGroupLogoPreview ? (
                        <img src={newGroupLogoPreview} alt="Group Preview" className="w-full h-full object-cover" />
                      ) : (
                        <Users className="w-6 h-6 text-slate-400" />
                      )}
                    </div>
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => groupLogoInputRef.current?.click()}
                        className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors cursor-pointer outline-none"
                      >
                        Change Group Logo
                      </button>
                      <p className="text-[9px] text-slate-400 font-bold">Recommended: Square PNG/JPG</p>
                    </div>
                    <input
                      type="file"
                      ref={groupLogoInputRef}
                      onChange={handleNewGroupLogoFileChange}
                      accept="image/*"
                      className="hidden"
                    />
                  </div>
                </div>

                {/* Group Privacy Setup */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-[#444748]">Group Privacy</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setNewGroupPrivacy('public')}
                      className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                        newGroupPrivacy === 'public'
                          ? 'bg-[#1b1c1c] text-white border-[#1b1c1c]'
                          : 'bg-[#fbf9f9] border-[#efeded] text-[#444748] hover:bg-slate-100'
                      }`}
                    >
                      <div className="text-xs font-bold flex items-center justify-between">
                        <span>🌐 Public</span>
                        {newGroupPrivacy === 'public' && <Check className="w-3.5 h-3.5 text-[#DDF639]" />}
                      </div>
                      <p className="text-[9px] opacity-80 mt-0.5">Link lets anyone view chat & media</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setNewGroupPrivacy('private')}
                      className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                        newGroupPrivacy === 'private'
                          ? 'bg-[#1b1c1c] text-white border-[#1b1c1c]'
                          : 'bg-[#fbf9f9] border-[#efeded] text-[#444748] hover:bg-slate-100'
                      }`}
                    >
                      <div className="text-xs font-bold flex items-center justify-between">
                        <span>🔒 Private</span>
                        {newGroupPrivacy === 'private' && <Check className="w-3.5 h-3.5 text-[#DDF639]" />}
                      </div>
                      <p className="text-[9px] opacity-80 mt-0.5">Visible only to joined members</p>
                    </button>
                  </div>
                </div>

                {/* Members checklist */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-wider text-[#444748]">Choose Members (Nearby creatives)</label>
                  <div className="max-h-[140px] overflow-y-auto border border-[#efeded] rounded-2xl p-2.5 space-y-1.5 custom-scrollbar bg-[#fbf9f9]">
                    {creators.map(creator => (
                      <div 
                        key={creator.id}
                        onClick={() => toggleSelectMember(creator.id)}
                        className={`p-2.5 rounded-xl flex items-center justify-between cursor-pointer transition-colors ${
                          selectedMembers.includes(creator.id) ? 'bg-[#854c6f]/10' : 'hover:bg-slate-200/50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <img src={creator.avatar} alt={creator.name} className="w-8 h-8 rounded-xl object-cover border border-white" />
                          <div>
                            <p className="text-xs font-bold text-slate-900">{creator.name}</p>
                            <p className="text-[9px] text-[#854c6f] font-semibold">{creator.specialty}</p>
                          </div>
                        </div>
                        <div className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all ${
                          selectedMembers.includes(creator.id)
                            ? 'bg-[#854c6f] border-[#854c6f] text-white'
                            : 'border-slate-300 bg-white text-transparent hover:border-[#854c6f]'
                        }`}>
                          <Check className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Trigger Buttons */}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateGroup(false)}
                    className="flex-1 h-12 bg-slate-50 text-[#444748] rounded-full font-bold text-xs cursor-pointer hover:bg-slate-100 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!newGroupName.trim() || selectedMembers.length === 0}
                    className="flex-1 h-12 bg-[#1b1c1c] hover:bg-[#854c6f] text-white rounded-full font-black text-xs uppercase tracking-wider cursor-pointer transition-all disabled:opacity-45"
                  >
                    Create Group
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ==================== 4. VIEW ANOTHER USER'S PROFILE MODAL ==================== */}
      <AnimatePresence>
        {viewingProfileCreator && (
          <ProfileDetailPopup 
            creator={viewingProfileCreator}
            chats={chats}
            creators={creators}
            isGuest={isGuest}
            onClose={() => setViewingProfileCreator(null)}
            onNavigateToLogin={onNavigateToLogin || (() => {})}
            onBlockUser={(creatorId) => {
              if (onBlockUser) onBlockUser(creatorId);
              setViewingProfileCreator(null);
            }}
            onUnblockUser={(creatorId) => {
              if (onUnblockUser) onUnblockUser(creatorId);
            }}
            onOpenReportModal={onOpenReportModal}
            onConnect={(creator) => {
              setViewingProfileCreator(null);
            }}
            onLaunchStory={() => {}}
            onNavigateToTab={(tab, chatId) => {
              if (tab === 'chat') {
                setSelectedChatId(chatId || null);
                setViewingProfileCreator(null);
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* ==================== 5. ERROR FEEDBACK TOAST ==================== */}
      <AnimatePresence>
        {errorToast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-[130] w-[340px] bg-white border-l-4 border-rose-500 rounded-2xl shadow-xl p-4 flex gap-3 text-left"
          >
            <ShieldAlert className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="text-xs font-black text-[#1b1c1c] uppercase tracking-wider">{errorToast.message}</h4>
              <p className="text-[10.5px] text-slate-500 font-medium mt-0.5">{errorToast.sub}</p>
            </div>
            <button 
              onClick={() => setErrorToast(null)}
              className="text-slate-400 hover:text-black font-bold text-xs"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ==================== 6. UNLOCK PREMIUM STORY MODAL ==================== */}
      <AnimatePresence>
        {storyToUnlock && (
          <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-[120] flex items-center justify-center p-6 select-none">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-2xl text-center relative overflow-hidden"
            >
              {/* Background amber glow */}
              <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500" />
              
              <div className="w-14 h-14 bg-amber-500/10 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <Crown className="w-7 h-7" />
              </div>

              <h3 className="text-lg font-black text-[#1b1c1c] leading-tight">
                Unlock Premium Story
              </h3>
              <p className="text-[10px] text-[#854c6f] font-black uppercase tracking-wider mt-1">
                By {storyToUnlock.story.creatorName}
              </p>

              <p className="text-xs text-[#444748] my-4 leading-relaxed font-semibold">
                This creator's exclusive behind-the-scenes concept layout requires a subscription or premium ticket entry.
              </p>

              {/* Token price tag */}
              <div className="py-3 bg-amber-50 rounded-2xl border border-amber-100 mb-6 flex items-center justify-center gap-2">
                <span className="text-xl">🪙</span>
                <span className="text-base font-black text-amber-600">50 Creator Tokens</span>
              </div>

              {/* Trigger Buttons */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStoryToUnlock(null)}
                  className="flex-1 h-11 bg-slate-50 hover:bg-slate-100 text-[#444748] rounded-full font-bold text-xs cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmUnlockStory}
                  className="flex-1 h-11 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white rounded-full font-black text-xs uppercase tracking-wider cursor-pointer shadow-md active:scale-98 transition-all"
                >
                  Confirm Pay
                </button>
              </div>

              {/* Current balance display */}
              <p className="text-[10px] text-slate-400 font-bold mt-4">
                Your Balance: {userProfile?.creatorTokens || 0} tokens
              </p>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ShareLinkModal 
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        title={shareModalData.title}
        description={shareModalData.desc}
        shareUrl={shareModalData.url}
        imageUrl={shareModalData.img}
      />

      {/* Toast Notice Alert */}
      <AnimatePresence>
        {toastNotice && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] bg-[#1b1c1c] text-white text-xs font-black px-5 py-2.5 rounded-full shadow-2xl border border-white/20 flex items-center gap-2 pointer-events-none"
          >
            <Check className="w-4 h-4 text-emerald-400" />
            <span>{toastNotice}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Group Settings & Admin Permissions Modal */}
      <AnimatePresence>
        {showGroupSettingsModal && selectedChat?.isGroup && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[120] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-[#141414] border border-[#2C3222] text-white w-full max-w-md rounded-3xl p-6 shadow-2xl relative overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-[#2C3222] mb-5">
                <div className="flex items-center gap-2">
                  <Settings className="w-5 h-5 text-[#DDF639]" />
                  <h3 className="text-base font-black text-white tracking-tight">Group Settings</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGroupSettingsModal(false)}
                  className="w-8 h-8 rounded-full bg-[#1F2417] text-[#B5B5B5] hover:text-white flex items-center justify-center border border-[#2C3222] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-6 max-h-[75vh] overflow-y-auto pr-1 custom-scrollbar">
                {/* 1. Group Logo Change Section */}
                <div className="flex flex-col items-center text-center p-4 bg-[#1F2417]/50 border border-[#2C3222] rounded-2xl relative">
                  <div className="relative group mb-3">
                    <img
                      src={selectedChat.avatar || getDefaultAvatar()}
                      alt={selectedChat.name}
                      className="w-20 h-20 rounded-full object-cover border-2 border-[#DDF639] bg-slate-800 shadow-lg"
                    />
                    {isGroupAdmin && (
                      <button
                        type="button"
                        onClick={() => groupLogoEditInputRef.current?.click()}
                        className="absolute bottom-0 right-0 w-7 h-7 bg-[#DDF639] text-black rounded-full flex items-center justify-center shadow-md hover:scale-105 transition-transform cursor-pointer"
                        title="Change Logo"
                      >
                        <Edit3 className="w-3.5 h-3.5 stroke-[2.5]" />
                      </button>
                    )}
                  </div>

                  <input
                    ref={groupLogoEditInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleEditGroupLogoFileChange}
                  />

                  {isGroupAdmin ? (
                    <button
                      type="button"
                      onClick={() => groupLogoEditInputRef.current?.click()}
                      disabled={isSavingGroupInfo}
                      className="text-xs font-bold text-[#DDF639] bg-[#141414] px-4 py-1.5 rounded-full border border-[#2C3222] hover:bg-[#2C3222] transition-all cursor-pointer"
                    >
                      Change Group Logo
                    </button>
                  ) : (
                    <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-3 py-1 rounded-full border border-amber-400/20 flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Group Logo can only be changed by Admin
                    </span>
                  )}
                </div>

                {/* 2. Group Name Edit Section */}
                <div className="space-y-2">
                  <label className="text-xs font-extrabold text-[#B5B5B5] uppercase tracking-wider block">
                    Group Name
                  </label>
                  {isGroupAdmin ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        name="off"
                        autoComplete="off"
                        autoCorrect="off"
                        data-lpignore="true"
                        aria-autocomplete="none"
                        value={editingGroupName}
                        onChange={(e) => setEditingGroupName(e.target.value)}
                        placeholder="Enter group name..."
                        className="flex-1 h-11 bg-[#1A1F12] border border-[#2C3222] rounded-2xl px-4 text-xs font-bold text-white focus:outline-none focus:border-[#DDF639]"
                      />
                      <button
                        type="button"
                        onClick={handleSaveGroupName}
                        disabled={isSavingGroupInfo || !editingGroupName.trim()}
                        className="px-4 h-11 bg-[#DDF639] text-black font-extrabold rounded-2xl text-xs hover:bg-[#DDF639]/90 transition-all disabled:opacity-50 cursor-pointer shrink-0"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <div className="p-3 bg-[#1A1F12] border border-[#2C3222] rounded-2xl flex items-center justify-between">
                      <span className="text-sm font-bold text-white">{selectedChat.name}</span>
                      <span className="text-[10px] text-amber-400 font-bold bg-amber-400/10 px-2.5 py-1 rounded-full border border-amber-400/20 flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Admin Only Edit
                      </span>
                    </div>
                  )}
                </div>

                {/* 3. Messaging Permissions Section (Only Admin vs Everyone) */}
                <div className="p-4 bg-[#1A1F12] border border-[#2C3222] rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-white uppercase tracking-wider">
                      Message Permissions
                    </span>
                    {isGroupAdmin ? (
                      <span className="text-[10px] font-black text-[#DDF639] bg-[#DDF639]/10 px-2 py-0.5 rounded border border-[#DDF639]/20">
                        ADMIN CONTROL
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-slate-400">READ ONLY MODE</span>
                    )}
                  </div>

                  {isGroupAdmin ? (
                    <div className="space-y-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleToggleAdminOnlyMessaging(false)}
                        className={`w-full p-3 rounded-2xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                          !selectedChat.onlyAdminCanSend
                            ? 'bg-[#2C3222] border-[#DDF639] text-white'
                            : 'bg-[#141414] border-[#2C3222] text-[#B5B5B5] hover:border-[#3a422d]'
                        }`}
                      >
                        <div>
                          <div className="text-xs font-bold text-white">Everyone can message</div>
                          <div className="text-[10px] text-slate-400 font-medium">All group members can participate in chat</div>
                        </div>
                        {!selectedChat.onlyAdminCanSend && <Check className="w-4 h-4 text-[#DDF639]" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleAdminOnlyMessaging(true)}
                        className={`w-full p-3 rounded-2xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                          selectedChat.onlyAdminCanSend
                            ? 'bg-[#2C3222] border-[#DDF639] text-white'
                            : 'bg-[#141414] border-[#2C3222] text-[#B5B5B5] hover:border-[#3a422d]'
                        }`}
                      >
                        <div>
                          <div className="text-xs font-bold text-amber-300 flex items-center gap-1">
                            <Lock className="w-3.5 h-3.5 text-amber-400" /> Only Admin can message
                          </div>
                          <div className="text-[10px] text-slate-400 font-medium">Non-admin members will only be able to read</div>
                        </div>
                        {selectedChat.onlyAdminCanSend && <Check className="w-4 h-4 text-[#DDF639]" />}
                      </button>
                    </div>
                  ) : (
                    <div className="p-3 bg-[#141414] rounded-xl border border-[#2C3222] text-xs font-bold text-slate-300 flex items-center gap-2">
                      {selectedChat.onlyAdminCanSend ? (
                        <>
                          <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>Only admins can send messages</span>
                        </>
                      ) : (
                        <>
                          <Users className="w-4 h-4 text-[#DDF639] shrink-0" />
                          <span>All members can send messages</span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Group Privacy Section (Public vs Private) */}
                <div className="p-4 bg-[#1A1F12] border border-[#2C3222] rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-white uppercase tracking-wider">
                      Group Privacy Setting
                    </span>
                    <span className="text-[10px] font-black text-[#DDF639] bg-[#DDF639]/10 px-2 py-0.5 rounded border border-[#DDF639]/20">
                      {(selectedChat.visibility === 'public' || selectedChat.isPublic) ? 'PUBLIC' : 'PRIVATE'}
                    </span>
                  </div>

                  {isGroupAdmin ? (
                    <div className="space-y-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleSetGroupPrivacy('public')}
                        disabled={isSavingGroupInfo}
                        className={`w-full p-3 rounded-2xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                          (selectedChat.visibility === 'public' || selectedChat.isPublic)
                            ? 'bg-[#2C3222] border-[#DDF639] text-white'
                            : 'bg-[#141414] border-[#2C3222] text-[#B5B5B5] hover:border-[#3a422d]'
                        }`}
                      >
                        <div>
                          <div className="text-xs font-bold text-white flex items-center gap-1.5">
                            <span>🌐 Public Group (Default)</span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-medium">Anyone with the share link can view messages and preview content.</div>
                        </div>
                        {(selectedChat.visibility === 'public' || selectedChat.isPublic) && <Check className="w-4 h-4 text-[#DDF639]" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSetGroupPrivacy('private')}
                        disabled={isSavingGroupInfo}
                        className={`w-full p-3 rounded-2xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                          (selectedChat.visibility !== 'public' && !selectedChat.isPublic)
                            ? 'bg-[#2C3222] border-[#DDF639] text-white'
                            : 'bg-[#141414] border-[#2C3222] text-[#B5B5B5] hover:border-[#3a422d]'
                        }`}
                      >
                        <div>
                          <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                            <Lock className="w-3.5 h-3.5 text-amber-400" />
                            <span>🔒 Private Group</span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-medium">Shared links show group profile info; messages are hidden from non-members.</div>
                        </div>
                        {(selectedChat.visibility !== 'public' && !selectedChat.isPublic) && <Check className="w-4 h-4 text-[#DDF639]" />}
                      </button>
                    </div>
                  ) : (
                    <div className="p-3 bg-[#141414] rounded-xl border border-[#2C3222] text-xs font-bold text-slate-300 flex items-center gap-2">
                      {selectedChat.visibility === 'public' ? (
                        <span>🌐 Public Group — Content is viewable via shared link</span>
                      ) : (
                        <span>🔒 Private Group — Messages are visible only to members</span>
                      )}
                    </div>
                  )}
                </div>

                {/* In-Chat Sponsored Ads Section */}
                <div className="p-4 bg-[#1A1F12] border border-[#2C3222] rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-white uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-[#DDF639]" />
                      In-Chat Sponsored Ads
                    </span>
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${
                      isCurrentChatAdsEnabled ? 'text-[#DDF639] bg-[#DDF639]/10 border-[#DDF639]/20' : 'text-slate-400 bg-zinc-800 border-zinc-700'
                    }`}>
                      {isCurrentChatAdsEnabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </div>

                  {isGroupAdmin ? (
                    <div className="space-y-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleToggleInChatAds(true)}
                        className={`w-full p-3 rounded-2xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                          isCurrentChatAdsEnabled
                            ? 'bg-[#2C3222] border-[#DDF639] text-white'
                            : 'bg-[#141414] border-[#2C3222] text-[#B5B5B5] hover:border-[#3a422d]'
                        }`}
                      >
                        <div>
                          <div className="text-xs font-bold text-white flex items-center gap-1.5">
                            <span>✨ Enable Sponsored Ads</span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-medium">Show non-intrusive sponsor ads inside the group chat stream.</div>
                        </div>
                        {isCurrentChatAdsEnabled && <Check className="w-4 h-4 text-[#DDF639]" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleInChatAds(false)}
                        className={`w-full p-3 rounded-2xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                          !isCurrentChatAdsEnabled
                            ? 'bg-[#2C3222] border-[#DDF639] text-white'
                            : 'bg-[#141414] border-[#2C3222] text-[#B5B5B5] hover:border-[#3a422d]'
                        }`}
                      >
                        <div>
                          <div className="text-xs font-bold text-white flex items-center gap-1.5">
                            <span>🚫 Disable Ads (Clean Chat)</span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-medium">No ads will be displayed inside this group chat conversation.</div>
                        </div>
                        {!isCurrentChatAdsEnabled && <Check className="w-4 h-4 text-[#DDF639]" />}
                      </button>
                    </div>
                  ) : (
                    <div className="p-3 bg-[#141414] rounded-xl border border-[#2C3222] text-xs font-bold text-slate-300 flex items-center gap-2">
                      <span>{isCurrentChatAdsEnabled ? '✨ In-chat ads enabled by Admin' : '🚫 In-chat ads disabled by Admin'}</span>
                    </div>
                  )}
                </div>

                {/* 4. Group Members List */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-[#B5B5B5] uppercase tracking-wider">
                      Group Members ({selectedChat.members?.length || 1})
                    </span>
                  </div>

                  <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                    {selectedChat.members?.map((memberId) => {
                      const memberCreator = creators.find(cr => cr.id === memberId);
                      const isMemberAdmin = (selectedChat.admins && selectedChat.admins.includes(memberId)) || (selectedChat.members && selectedChat.members[0] === memberId);
                      const name = memberCreator?.name || (memberId === currentUser?.uid ? 'You' : `Member (${memberId.slice(0, 6)})`);
                      const avatar = getUserAvatar(memberCreator);

                      return (
                        <div key={memberId} className="p-2.5 bg-[#1A1F12] border border-[#2C3222] rounded-2xl flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <img src={avatar} alt="" className="w-8 h-8 rounded-full object-cover border border-[#2C3222]" />
                            <span className="text-xs font-bold text-white">{name}</span>
                          </div>

                          {isMemberAdmin && (
                            <span className="text-[9.5px] font-black text-[#DDF639] bg-[#DDF639]/10 px-2 py-0.5 rounded-full border border-[#DDF639]/20 flex items-center gap-1">
                              <Crown className="w-3 h-3 text-amber-400" /> Admin
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 5. Group Quick Actions (Share Link, Report, Leave) */}
                <div className="pt-2 border-t border-[#2C3222] space-y-2">
                  <span className="text-xs font-extrabold text-[#B5B5B5] uppercase tracking-wider block">
                    Group Actions
                  </span>

                  <button
                    type="button"
                    onClick={handleShareGroup}
                    className="w-full p-3 bg-[#1A1F12] hover:bg-[#2C3222] border border-[#2C3222] rounded-2xl flex items-center justify-between text-xs font-bold text-[#DDF639] transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Share2 className="w-4 h-4 text-[#DDF639]" />
                      <span>Share Group Link</span>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-[#B5B5B5]" />
                  </button>

                  <button
                    type="button"
                    onClick={handleReportAction}
                    className="w-full p-3 bg-[#1A1F12] hover:bg-rose-950/20 border border-[#2C3222] rounded-2xl flex items-center justify-between text-xs font-bold text-rose-400 transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Flag className="w-4 h-4 text-rose-400" />
                      <span>Report Group</span>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-rose-400" />
                  </button>

                  <button
                    type="button"
                    onClick={handleLeaveGroup}
                    className="w-full p-3 bg-rose-950/30 hover:bg-rose-950/60 border border-rose-900/40 rounded-2xl flex items-center justify-between text-xs font-bold text-rose-300 transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <LogOut className="w-4 h-4 text-rose-400" />
                      <span>Leave Group</span>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-rose-300" />
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Message Seen By Modal */}
      <AnimatePresence>
        {viewingSeenByMessage && (
          <div 
            className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setViewingSeenByMessage(null)}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#1A1F12] border border-[#2C3222] rounded-3xl p-6 w-full max-w-sm text-left space-y-4 shadow-2xl relative"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[#2C3222] pb-3">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-[#DDF639]" />
                  <h4 className="text-xs font-black text-white uppercase tracking-wider">Message Read Receipts</h4>
                </div>
                <button 
                  onClick={() => setViewingSeenByMessage(null)}
                  className="w-7 h-7 rounded-full bg-[#141414] text-slate-400 hover:text-white flex items-center justify-center cursor-pointer border border-[#2C3222]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                {(() => {
                  const seenUids: string[] = viewingSeenByMessage.seenBy || [];
                  if (seenUids.length === 0) {
                    return (
                      <p className="text-xs text-slate-400 font-medium py-3 text-center">No other members have viewed this message yet.</p>
                    );
                  }

                  return seenUids.map((uid) => {
                    const memberCreator = creators.find(cr => cr.id === uid);
                    const name = memberCreator?.name || (uid === currentUser?.uid ? 'You' : `User (${uid.slice(0, 6)})`);
                    const avatar = getUserAvatar(memberCreator);

                    return (
                      <div key={uid} className="p-2.5 bg-[#141414] border border-[#2C3222] rounded-2xl flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <img src={avatar} alt="" className="w-8 h-8 rounded-full object-cover border border-[#2C3222]" />
                          <span className="text-xs font-bold text-white">{name}</span>
                        </div>
                        <CheckCheck className="w-4 h-4 text-[#DDF639]" />
                      </div>
                    );
                  });
                })()}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Expanded Media Lightbox */}
      <AnimatePresence>
        {expandedMediaUrl && (
          <div 
            className="fixed inset-0 z-[300] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
            onClick={() => setExpandedMediaUrl(null)}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative max-w-4xl max-h-[90vh] rounded-2xl overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <img src={expandedMediaUrl} alt="Enlarged attachment" className="w-full h-full object-contain max-h-[85vh] rounded-2xl" />
              <button 
                onClick={() => setExpandedMediaUrl(null)}
                className="absolute top-3 right-3 bg-black/60 text-white w-9 h-9 rounded-full flex items-center justify-center hover:bg-black transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
