import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  User, CheckCircle2, Crown, Sparkles, Settings, Plus, 
  Trash2, Landmark, Coins, Heart, Check, Loader2, ArrowRight,
  Flame, BookOpen, MessageSquare, Image, ShieldAlert, Award, Grid, Share2,
  Camera as LucideCamera, Bookmark, Bell, ChevronRight, Scale, Target, MoreHorizontal, Sliders, ChevronLeft, Volume2, Radio, MapPin, X
} from 'lucide-react';
import { openExternalUrl } from '../utils/openUrl';
import { navigateToPolicyPath } from '../utils/policyNavigation';

const LEGAL_POLICIES = [
  { title: 'Privacy Policy', path: '/privacy-policy' },
  { title: 'Terms & Conditions', path: '/terms-and-conditions' },
  { title: 'Community Guidelines', path: '/community-guidelines' },
  { title: 'Delete Account Policy', path: '/delete-account-policy' },
  { title: 'Contact Us', path: '/contact-us' },
  { title: 'Refund Policy', path: '/refund-policy' },
  { title: 'Cookie Policy', path: '/cookie-policy' },
  { title: 'Safety Tips for Dating', path: '/safety-tips' },
  { title: 'DMCA & Copyright Policy', path: '/dmca-copyright-policy' },
  { title: 'Content Moderation Policy', path: '/content-moderation-policy' },
];
import { UserProfile, Creator, ChatThread, TRENDING_SKILLS } from '../data';
import ShareLinkModal from './ShareLinkModal';
import AdPlacement from './AdPlacement';
import { calculateStreak, calculateLovePercentage } from '../utils/streak';
import ProfileSetupScreen from './ProfileSetupScreen';
import ProfileMonetization from './ProfileMonetization';
import AdminPanelModal from './AdminPanelModal';
import { useAuth } from '../contexts/AuthContext';
import ImageCropperModal from './ImageCropperModal';
import { collection, query, where, onSnapshot, doc, deleteDoc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { handleFirestoreError, OperationType } from '../utils/firestoreErrorHandler';
import { getUserAvatar, getDefaultAvatar } from '../utils/avatar';
import { getShareUrl, triggerShare } from '../utils/deeplink';
import { uploadStory } from '../utils/firebaseStorageUpload';
import { requestNotificationPermissionAndRegisterToken, getNotificationPermissionStatus } from '../utils/notifications';
import { ProfileSkeleton, ProgressiveImage } from './Skeletons';

interface ProfileTabProps {
  profile: UserProfile;
  chats: ChatThread[];
  creators: Creator[];
  isGuest: boolean;
  onUpdateProfile: (updated: UserProfile) => void;
  onNavigateToLogin?: () => void;
  onNavigateToTab?: (tab: 'home' | 'discover' | 'chat' | 'profile', chatId?: string | null) => void;
  savedCreatorIds?: string[];
  onToggleBookmark?: (creatorId: string) => void;
  onUnblockUser?: (creatorId: string) => void;
  initialSubTab?: 'stories' | 'photos' | 'streak' | 'saved' | 'monetization';
}

export default function ProfileTab({ 
  profile, 
  chats,
  creators,
  isGuest, 
  onUpdateProfile,
  onNavigateToLogin,
  onNavigateToTab,
  savedCreatorIds = [],
  onToggleBookmark,
  onUnblockUser,
  initialSubTab
}: ProfileTabProps) {
  const { currentUser, isFirebase, updateProfile } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<'stories' | 'photos' | 'streak' | 'saved' | 'monetization'>(initialSubTab || 'stories');
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  // Admin gate — matches the server-side APPROVED_ADMIN_EMAILS + isAdmin/role claim checks.
  // The panel itself is protected server-side by verifyAdminAuth; this only controls visibility.
  const ADMIN_EMAILS = ['admin@anviotalk.com', 'kartiksingh7870n@gmail.com'];
  const adminEmail = String((profile as any).email || currentUser?.email || '').toLowerCase();
  const isAdminUser =
    ADMIN_EMAILS.includes(adminEmail) ||
    (profile as any).isAdmin === true ||
    (profile as any).role === 'admin';

  useEffect(() => {
    if (initialSubTab) {
      setActiveTab(initialSubTab);
    }
  }, [initialSubTab]);

  const [selectedLightboxImage, setSelectedLightboxImage] = useState<string | null>(null);
  const [notifPermission, setNotifPermission] = useState<'granted' | 'denied' | 'default' | 'unsupported'>(() => getNotificationPermissionStatus());
  const [isRequestingNotif, setIsRequestingNotif] = useState(false);
  const [isMonetizationPopupOpen, setIsMonetizationPopupOpen] = useState(false);

  const handleEnableNotifications = async () => {
    setIsRequestingNotif(true);
    const success = await requestNotificationPermissionAndRegisterToken(currentUser?.uid);
    setNotifPermission(getNotificationPermissionStatus());
    setIsRequestingNotif(false);
  };

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const portfolioInputRef = useRef<HTMLInputElement>(null);
  const storyInputRef = useRef<HTMLInputElement>(null);

  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropperSrc, setCropperSrc] = useState('');
  const [cropperType, setCropperType] = useState<'circle' | 'square' | 'cover'>('square');
  const [pendingUploadType, setPendingUploadType] = useState<'avatar' | 'cover' | 'portfolio' | 'story' | null>(null);

  const handlePhotoUploadAttempt = (e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'cover' | 'portfolio' | 'story') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (type === 'story') {
        setPendingStoryUrl(reader.result as string);
        setIsStoryEditorOpen(true);
      } else {
        setCropperSrc(reader.result as string);
        setCropperType(type === 'avatar' ? 'circle' : type === 'cover' ? 'cover' : 'square');
        setPendingUploadType(type);
        setCropperOpen(true);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCropSave = async (croppedBase64: string) => {
    setCropperOpen(false);
    let finalUrl = croppedBase64;
    if (isFirebase && currentUser) {
      try {
        const timestamp = Date.now();
        const storagePath = pendingUploadType === 'portfolio' 
          ? `profilePhotos/${currentUser.uid}/${timestamp}_portfolio.jpg` 
          : `users/${currentUser.uid}/${pendingUploadType}/${timestamp}`;
        const fileRef = ref(storage, storagePath);
        const uploadResult = await uploadString(fileRef, croppedBase64, 'data_url');
        finalUrl = await getDownloadURL(uploadResult.ref);
      } catch (err: any) {
        console.warn("Storage upload failed:", err);
      }
    }

    if (pendingUploadType === 'avatar') {
      const updatedPhotos = [...photos];
      updatedPhotos[0] = finalUrl;
      setPhotos(updatedPhotos);
      onUpdateProfile({ ...profile, photos: updatedPhotos });
      if (isFirebase && currentUser) updateProfile({ photos: updatedPhotos, avatarUrl: finalUrl });
    } else if (pendingUploadType === 'cover') {
      onUpdateProfile({ ...profile, coverPhotoUrl: finalUrl });
      if (isFirebase && currentUser) updateProfile({ coverPhotoUrl: finalUrl });
    } else if (pendingUploadType === 'portfolio') {
      const updatedPhotos = [...photos, finalUrl];
      setPhotos(updatedPhotos);
      onUpdateProfile({ ...profile, photos: updatedPhotos });
      if (isFirebase && currentUser) updateProfile({ photos: updatedPhotos, portfolioPhotos: updatedPhotos });
    } else if (pendingUploadType === 'story') {
      setPendingStoryUrl(finalUrl);
      setIsStoryEditorOpen(true);
    }
    setPendingUploadType(null);
  };
  
  const [name, setName] = useState(profile.name || "");
  const [username, setUsername] = useState(profile.username || "");
  const [bio, setBio] = useState(profile.bio || "");
  const [age, setAge] = useState(profile.age || 0);
  const [gender, setGender] = useState(profile.gender || "Non-binary");
  const [selectedInterests, setSelectedInterests] = useState<string[]>(profile.interests || []);
  const [photos, setPhotos] = useState<string[]>(profile.portfolioPhotos || profile.photos || []);

  useEffect(() => {
    setName(profile.name || "");
    setUsername(profile.username || "");
    setBio(profile.bio || "");
    setAge(profile.age || 0);
    setGender(profile.gender || "Non-binary");
    setSelectedInterests(profile.interests || []);
    setPhotos(profile.portfolioPhotos || profile.photos || []);
  }, [profile]);

  const [userStories, setUserStories] = useState<any[]>([]);
  const [newStoryCaption, setNewStoryCaption] = useState("");
  const [newStoryAudience, setNewStoryAudience] = useState<'everyone' | 'followers'>('everyone');
  const [newStoryLayout, setNewStoryLayout] = useState<'portrait' | 'square'>('portrait');
  const [isStoryPublishing, setIsStoryPublishing] = useState(false);
  const [pendingStoryUrl, setPendingStoryUrl] = useState<string | null>(null);
  const [isStoryEditorOpen, setIsStoryEditorOpen] = useState(false);

  const [followerCount, setFollowerCount] = useState<number>(0);
  const [followingCount, setFollowingCount] = useState<number>(0);

  const handleToggleAllowMessagesFromAnyone = async (enable: boolean) => {
    const updatedProfile = { ...profile, allowMessagesFromAnyone: enable };
    onUpdateProfile(updatedProfile);
    if (isFirebase && currentUser) {
      try {
        await updateDoc(doc(db, "users", currentUser.uid), { allowMessagesFromAnyone: enable });
      } catch (err) { console.error(err); }
    }
  };

  useEffect(() => {
    if (!isFirebase || !currentUser?.uid) return;
    const followersQ = query(collection(db, "follows"), where("toUid", "==", currentUser.uid), where("status", "==", "accepted"));
    const followingQ = query(collection(db, "follows"), where("fromUid", "==", currentUser.uid), where("status", "==", "accepted"));
    const unsubFollowers = onSnapshot(followersQ, (snap) => setFollowerCount(snap.size));
    const unsubFollowing = onSnapshot(followingQ, (snap) => setFollowingCount(snap.size));
    return () => { unsubFollowers(); unsubFollowing(); };
  }, [isFirebase, currentUser]);

  useEffect(() => {
    if (!isFirebase || !currentUser?.uid) return;
    const q = query(collection(db, "stories"), where("authorUid", "==", currentUser.uid));
    return onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((docSnap) => { list.push({ id: docSnap.id, ...docSnap.data() }); });
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setUserStories(list);
    });
  }, [isFirebase, currentUser]);

  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [showShareToast, setShowShareToast] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  const handleShareProfile = (e: React.MouseEvent) => {
    e.stopPropagation();
    const targetId = profile.username || currentUser?.uid || 'user';
    const profileUrl = getShareUrl('profile', targetId);
    triggerShare({ title: `${profile.name} on Anvio Talk`, text: profile.bio, url: profileUrl });
    setShowShareToast(true);
    setTimeout(() => setShowShareToast(false), 3000);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const updatedData = { name, username, bio, age: Number(age), gender, interests: selectedInterests, photos, portfolioPhotos: photos };
    onUpdateProfile({ ...profile, ...updatedData });
    if (isFirebase && currentUser) {
      try { await updateProfile(updatedData); } catch (err) { console.error(err); }
    }
    setIsEditing(false);
  };

  const handleAddMockPhoto = () => portfolioInputRef.current?.click();
  const handleDeletePhoto = (idxToDelete: number) => setPhotos(prev => prev.filter((_, idx) => idx !== idxToDelete));
  const handleAddStory = () => storyInputRef.current?.click();

  const handlePublishStory = async () => {
    if (!pendingStoryUrl) return;
    setIsStoryPublishing(true);
    try {
      if (isFirebase && currentUser) {
        await uploadStory({ imageSrc: pendingStoryUrl, caption: newStoryCaption, audience: newStoryAudience, userProfile: profile });
      } else {
        setUserStories(prev => [{ id: `temp-${Date.now()}`, mediaUrl: pendingStoryUrl, caption: newStoryCaption, audience: newStoryAudience, createdAt: new Date() }, ...prev]);
      }
      setPendingStoryUrl(null);
      setIsStoryEditorOpen(false);
      setNewStoryCaption("");
    } catch (err) {
      console.error(err);
    } finally { setIsStoryPublishing(false); }
  };

  const handleBuyPremium = () => { onUpdateProfile({ ...profile, isPremium: true }); setShowPremiumModal(false); };

  if (isGuest) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-center p-8 font-sans text-[#1b1c1c] bg-[#fbf9f9] select-none">
        <div className="w-16 h-16 bg-[#854c6f]/15 rounded-[1.8rem] flex items-center justify-center text-[#854c6f] mb-5">
          <User className="w-8 h-8" />
        </div>
        <h3 className="text-2xl font-extrabold tracking-tight mb-2">Create your creative profile</h3>
        <p className="text-sm text-[#444748] max-w-[320px] leading-relaxed mb-8 font-medium">
          Unlock edit capabilities, portfolio showcase, verification badges, story posting, and monetization tools.
        </p>
        <button
          onClick={onNavigateToLogin}
          className="px-8 h-14 bg-[#1b1c1c] text-white rounded-full text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-lg hover:opacity-90 transition-opacity cursor-pointer"
        >
          Sign In / Create Account <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // Monetization Popup logic would go here if needed, but let's keep it simple to fix build.

  const creatorsWithStreaks = creators.map(creator => {
    const creatorChat = chats.find(c => !c.isGroup && c.members.includes(creator.id));
    const streak = creatorChat ? calculateStreak(creatorChat, creator.id) : 0;
    return { creator, chat: creatorChat, streak };
  });

  return (
    <div className="w-full h-full bg-[#0A0A0C] text-white font-sans antialiased relative flex flex-col overflow-x-hidden selection:bg-[#DDF639] selection:text-black">
      {/* 1. TOP BAR (FIXED) */}
      <header className="fixed top-0 max-w-[580px] w-full z-[100] flex items-center justify-between px-5 pt-12 pb-3 transition-all left-1/2 -translate-x-1/2">
        <button aria-label="Go Back" className="w-10 h-10 rounded-full glass-pill flex items-center justify-center text-white/90 hover:text-white active:scale-95 transition-transform cursor-pointer">
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full glass-pill">
          <span className="text-sm font-semibold tracking-tight text-white/90">@{profile.username}</span>
          <span className="inline-flex items-center justify-center w-4 h-4 bg-[#DDF639] text-black rounded-full text-[9px] font-black">
            <Check className="w-2.5 h-2.5 stroke-[3]" />
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <button aria-label="More Options" className="w-10 h-10 rounded-full glass-pill flex items-center justify-center text-white/90 hover:text-white active:scale-95 transition-transform cursor-pointer">
            <MoreHorizontal className="w-5 h-5" />
          </button>
          <button aria-label="Notifications" onClick={() => setActiveTab('streak')} className="w-10 h-10 rounded-full glass-pill flex items-center justify-center text-white/90 hover:text-white active:scale-95 transition-transform cursor-pointer">
            <Heart className="w-4.5 h-4.5" />
          </button>
        </div>
      </header>

      {/* SCROLLABLE CONTENT */}
      <div className="flex-1 overflow-y-auto custom-scrollbar no-scrollbar pt-20 pb-28">

        {/* 2. HERO SECTION */}
        <section className="relative w-full pt-6 pb-4 overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-56 bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none"></div>

          <div className="relative z-10 px-6 pt-6 flex flex-col items-center text-center">
            <div className="relative mb-3.5">
              <div className="w-24 h-24 rounded-full p-0.5 bg-gradient-to-b from-white/20 to-white/5 shadow-2xl">
                <div className="w-full h-full rounded-full overflow-hidden bg-[#121217] ring-1 ring-white/10">
                  <img src={getUserAvatar(profile)} className="w-full h-full object-cover" alt="" />
                </div>
              </div>
              <button onClick={() => avatarInputRef.current?.click()} className="absolute bottom-0 right-0 bg-[#1A1A22] border border-white/10 text-white/80 p-1.5 rounded-full shadow-lg hover:text-[#DDF639] active:scale-95 transition cursor-pointer">
                <LucideCamera className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-1.5">
                {profile.name}
                <span className="inline-flex items-center justify-center w-3.5 h-3.5 bg-[#DDF639] text-black rounded-full text-[8px] font-black">
                  <Check className="w-2 h-2 stroke-[3]" />
                </span>
              </h1>
              <span className="text-white/30 text-xs">•</span>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-white/70">{profile.gender}</span>
            </div>

            <p className="mt-1.5 text-xs text-neutral-400 font-normal tracking-wide italic">“{profile.bio}”</p>

            {/* Stats Bar */}
            <div className="w-full max-w-xs mt-5 px-5 py-2.5 rounded-2xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-around text-center">
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-white tracking-tight">{userStories.length}</span>
                <span className="text-[9px] font-medium text-white/40 tracking-wider uppercase mt-0.5">Posts</span>
              </div>
              <div className="h-5 w-px bg-white/10"></div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-white tracking-tight">{followerCount}</span>
                <span className="text-[9px] font-medium text-white/40 tracking-wider uppercase mt-0.5">Followers</span>
              </div>
              <div className="h-5 w-px bg-white/10"></div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-white tracking-tight">{followingCount}</span>
                <span className="text-[9px] font-medium text-white/40 tracking-wider uppercase mt-0.5">Following</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="w-full max-w-xs flex items-center justify-center gap-2.5 mt-4">
              <button
                onClick={() => setIsEditing(!isEditing)}
                className="flex-1 py-2.5 px-4 rounded-full bg-white text-black font-semibold text-xs flex items-center justify-center gap-1.5 shadow-sm hover:bg-neutral-200 active:scale-[0.98] transition cursor-pointer"
              >
                <Sliders className="w-3.5 h-3.5 text-black" />
                <span>Edit Profile</span>
              </button>
              <button
                onClick={handleShareProfile}
                className="flex-1 py-2.5 px-4 rounded-full bg-white/[0.07] border border-white/10 text-white/90 font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-white/10 active:scale-[0.98] transition cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5 text-white/70" />
                <span>Share Profile</span>
              </button>
            </div>
          </div>
        </section>

        {/* 3. SEGMENTED TABS */}
        <nav className="px-5 mt-3 mb-4 sticky top-[80px] z-50">
          <div className="flex items-center p-1 rounded-full bg-white/[0.04] border border-white/[0.06] overflow-x-auto hide-scrollbar backdrop-blur-xl">
            {[
              { id: 'stories', label: 'Stories', icon: null },
              { id: 'photos', label: 'Photos', icon: null },
              { id: 'monetization', label: 'Monetize', icon: null },
              { id: 'streak', label: 'Streak', icon: Flame },
              { id: 'saved', label: 'Saved', icon: Bookmark },
              ...(isAdminUser ? [{ id: 'admin', label: 'Admin', icon: ShieldAlert }] : [])
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  if (tab.id === 'admin') {
                    setShowAdminPanel(true);
                    return;
                  }
                  setActiveTab(tab.id as any);
                }}
                className={`flex-1 min-w-[70px] py-1.5 px-3 rounded-full text-xs transition-all duration-300 flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-white/10 text-white shadow-sm font-semibold'
                    : 'text-white/50 font-medium hover:text-white/80'
                }`}
              >
                {tab.icon && <tab.icon className={`w-3 h-3 ${tab.id === 'admin' ? 'text-rose-400' : activeTab === tab.id ? 'text-orange-400' : ''}`} />}
                <span className={tab.id === 'admin' ? 'text-rose-400' : ''}>{tab.label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* 4. ABOUT CARD */}
        <section className="px-5 mb-5">
          <div className="bg-[#121217] border border-white/[0.06] rounded-2xl p-4 relative overflow-hidden">
            <div className="flex items-center justify-between mb-1.5">
              <h2 className="text-xs font-semibold text-white/90 tracking-wide uppercase">About</h2>
              <span className="text-[11px] font-medium text-[#DDF639] hover:underline cursor-pointer">Read more</span>
            </div>
            <p className="text-xs text-neutral-400 leading-relaxed font-normal">
              {profile.bio || "Digital creator crafting high-impact spatial audio moments and decentralized community vibes on Anvio Talk."}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-white/5">
              {(profile.interests || ['#SpatialAudio', '#Minimalist', '#CreatorCollective']).map((interest, i) => (
                <span key={i} className={`text-[10px] px-2.5 py-0.5 rounded-full border border-white/5 ${i === 2 ? 'bg-[#DDF639]/10 text-[#DDF639] border-[#DDF639]/20' : 'bg-white/[0.04] text-white/70'}`}>
                  {interest.startsWith('#') ? interest : `#${interest}`}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* 5. TAB CONTENT */}
        <div className="px-5">
          <AnimatePresence mode="wait">
            {activeTab === 'stories' && (
              <motion.div key="stories" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#DDF639]"></div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-white/80">Stories ({userStories.length})</h3>
                  </div>
                  <button onClick={handleAddStory} className="text-xs font-medium text-[#DDF639] flex items-center gap-1 hover:opacity-80 active:scale-95 transition cursor-pointer">
                    <Plus className="w-3.5 h-3.5" />
                    <span>Post Snap</span>
                  </button>
                </div>

                <div className="flex space-x-3 overflow-x-auto pb-2 hide-scrollbar">
                  {userStories.length === 0 ? (
                    <div className="w-full py-12 text-center text-white/20 italic text-xs border border-dashed border-white/10 rounded-2xl">
                      No snaps posted yet
                    </div>
                  ) : (
                    userStories.map((s) => (
                      <div key={s.id} onClick={() => setSelectedLightboxImage(s.mediaUrl)} className="min-w-[160px] max-w-[160px] bg-[#121217] p-3.5 rounded-2xl border border-white/[0.06] flex flex-col justify-between h-40 group hover:border-white/20 transition cursor-pointer">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-semibold text-white/40 tracking-wider uppercase">Snap</span>
                          <div className="w-5 h-5 rounded-full bg-white/5 text-neutral-300 flex items-center justify-center">
                            <Volume2 className="w-3 h-3" />
                          </div>
                        </div>
                        <div className="relative h-20 w-full rounded-xl overflow-hidden mt-2 mb-2">
                           <img src={s.mediaUrl} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="" />
                        </div>
                        <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[10px]">
                          <span className="text-white/40">Active</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); if (isFirebase && s.id) deleteDoc(doc(db, "stories", s.id)); }}
                            className="font-medium px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'photos' && (
              <motion.div key="photos" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-white/80">Portfolio ({photos.length})</h3>
                  <button onClick={handleAddMockPhoto} className="text-xs font-medium text-[#DDF639] flex items-center gap-1 hover:opacity-80 transition cursor-pointer">
                    <Plus className="w-3.5 h-3.5" /> <span>Add Artwork</span>
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((url, i) => (
                    <div key={i} onClick={() => setSelectedLightboxImage(url)} className="aspect-square bg-[#121217] border border-white/5 rounded-2xl overflow-hidden relative group cursor-pointer shadow-sm">
                      <ProgressiveImage src={url} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      <button onClick={(e) => { e.stopPropagation(); handleDeletePhoto(i); }} className="absolute inset-0 bg-black/75 opacity-0 group-hover:opacity-100 flex items-center justify-center text-rose-400 transition-opacity">
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'monetization' && (
              <motion.div key="monetization" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                <ProfileMonetization profile={profile} chats={chats} userStoriesCount={userStories.length} onBack={() => setActiveTab('stories')} onUpdateProfile={onUpdateProfile} />
              </motion.div>
            )}

            {activeTab === 'streak' && (
              <motion.div key="streak" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-white/80 mb-3 px-1">Active Streaks</h3>
                {creatorsWithStreaks.map(({ creator, streak }) => (
                  <div key={creator.id} className="flex items-center justify-between p-3.5 bg-[#121217] border border-white/[0.06] rounded-2xl">
                    <div className="flex items-center gap-3">
                      <img src={creator.avatar} className="w-10 h-10 rounded-full border border-white/10" />
                      <div>
                        <h5 className="text-xs font-semibold text-white">{creator.name}</h5>
                        <span className="text-[10px] text-white/40">{creator.specialty}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Flame className={`w-4 h-4 ${streak > 0 ? 'text-orange-400 fill-current' : 'text-white/20'}`} />
                      <span className="text-sm font-bold">{streak}</span>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}

            {activeTab === 'saved' && (
              <motion.div key="saved" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-white/80 mb-3 px-1">Saved Creators</h3>
                {creators.filter(c => savedCreatorIds.includes(c.id)).map(c => (
                  <div key={c.id} className="flex items-center justify-between p-3.5 bg-[#121217] border border-white/[0.06] rounded-2xl">
                    <div className="flex items-center gap-3">
                      <img src={c.avatar} className="w-10 h-10 rounded-full border border-white/10" />
                      <div>
                        <h5 className="text-xs font-semibold text-white">{c.name}</h5>
                        <span className="text-[10px] text-white/40">{c.specialty}</span>
                      </div>
                    </div>
                    <button onClick={() => onToggleBookmark?.(c.id)} className="p-2 text-[#DDF639] hover:bg-white/5 rounded-full transition-colors cursor-pointer">
                      <Bookmark className="w-5 h-5 fill-current" />
                    </button>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 6. EDIT OVERLAY */}
        <AnimatePresence>
          {isEditing && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4"
            >
              <div className="w-full max-w-lg bg-[#0A0A0C] border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl relative">
                <button onClick={() => setIsEditing(false)} className="absolute top-6 right-6 w-10 h-10 rounded-full glass-pill flex items-center justify-center text-white/90 z-[210] cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
                <div className="max-h-[85vh] overflow-y-auto custom-scrollbar pt-4">
                   <ProfileSetupScreen isEditing={true} onCancel={() => setIsEditing(false)} onComplete={() => setIsEditing(false)} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* OVERLAYS & MODALS */}
      <AnimatePresence>
        {selectedLightboxImage && (
          <div className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-md flex items-center justify-center p-4 select-none" onClick={() => setSelectedLightboxImage(null)}>
            <button className="absolute top-6 right-6 text-white text-3xl font-bold cursor-pointer">✕</button>
            <motion.img initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} src={selectedLightboxImage} className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
          </div>
        )}
      </AnimatePresence>

      <ImageCropperModal isOpen={cropperOpen} imageSrc={cropperSrc} cropType={cropperType} onCancel={() => setCropperOpen(false)} onSave={handleCropSave} />

      {/* ADMIN CONSOLE (visible to approved admins only; server re-verifies every request) */}
      <AdminPanelModal isOpen={showAdminPanel} onClose={() => setShowAdminPanel(false)} />

      {/* HIDDEN INPUTS */}
      <input type="file" ref={avatarInputRef} onChange={(e) => handlePhotoUploadAttempt(e, 'avatar')} accept="image/*" className="hidden" />
      <input type="file" ref={coverInputRef} onChange={(e) => handlePhotoUploadAttempt(e, 'cover')} accept="image/*" className="hidden" />
      <input type="file" ref={portfolioInputRef} onChange={(e) => handlePhotoUploadAttempt(e, 'portfolio')} accept="image/*" className="hidden" />
      <input type="file" ref={storyInputRef} onChange={(e) => handlePhotoUploadAttempt(e, 'story')} accept="image/*" className="hidden" />
    </div>
  );
}
