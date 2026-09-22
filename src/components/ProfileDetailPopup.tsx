import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Lock, MapPin, Check, Sparkles, 
  MessageSquare, Layers, Eye, ShieldAlert, Zap,
  Flame, CheckCircle2, UserCheck, Plus, User, Image, Crown, Heart, Share2, Ban, Flag
} from 'lucide-react';
import { Creator, Story, ChatThread } from '../data';
import { calculateStreak, calculateLovePercentage } from '../utils/streak';
import { getUserAvatar } from '../utils/avatar';
import { getShareUrl, PRODUCTION_URL } from '../utils/deeplink';
import { recordProfileViewClient } from '../utils/recordProfileView';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { doc, onSnapshot, query, collection, where, setDoc, serverTimestamp } from 'firebase/firestore';
import ShareLinkModal from './ShareLinkModal';
import AdPlacement from './AdPlacement';

interface ProfileDetailPopupProps {
  creator: Creator;
  chats: ChatThread[];
  creators: Creator[];
  story?: Story;
  isGuest: boolean;
  onClose: () => void;
  onNavigateToLogin: () => void;
  onConnect: (creator: Creator) => void;
  onLaunchStory: () => void;
  onNavigateToTab?: (tab: 'home' | 'discover' | 'chat' | 'profile', chatId?: string | null) => void;
  outgoingStatus?: string;
  incomingStatus?: string;
  onToggleFollow?: (creator: Creator) => void;
  onBlockUser?: (creatorId: string) => void;
  onUnblockUser?: (creatorId: string) => void;
  onOpenReportModal?: (target: {
    targetType: 'user' | 'story' | 'group' | 'message';
    targetId: string;
    targetName?: string;
    targetUsername?: string;
    targetAvatar?: string;
    targetContent?: string;
  }) => void;
}

export default function ProfileDetailPopup({
  creator,
  chats,
  creators,
  story,
  isGuest,
  onClose,
  onNavigateToLogin,
  onConnect,
  onLaunchStory,
  onNavigateToTab,
  outgoingStatus,
  incomingStatus,
  onToggleFollow,
  onBlockUser,
  onUnblockUser,
  onOpenReportModal
}: ProfileDetailPopupProps) {
  const { userProfile } = useAuth();
  const [activeSection, setActiveSection] = useState<'stories' | 'photos' | 'streak'>('stories');
  const [selectedLightboxImage, setSelectedLightboxImage] = useState<string | null>(null);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showCopyToast, setShowCopyToast] = useState(false);

  const handleShareProfileLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    const targetId = creator.username || creator.id;
    const profileUrl = getShareUrl('profile', targetId);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(profileUrl);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = profileUrl;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
    } catch (err) {
      console.warn("Copy to clipboard fallback:", err);
    }
    setShowCopyToast(true);
    setTimeout(() => setShowCopyToast(false), 3000);
  };

  const [realProfile, setRealProfile] = useState<any>(null);
  const [followerCount, setFollowerCount] = useState<number>(0);
  const [followingCount, setFollowingCount] = useState<number>(0);
  const [postsCount, setPostsCount] = useState<number>(0);

  useEffect(() => {
    if (!creator.id) return;

    // Record verified profile view on server database (handles 24h deduplication, self-view check, fraud checks)
    if (userProfile?.uid && creator.id !== userProfile.uid && !isGuest) {
      recordProfileViewClient(creator.id, userProfile.uid);

      // Create notification for the creator
      const notifRef = doc(collection(db, "notifications", creator.id, "items"), `view_${userProfile.uid}`);
      setDoc(notifRef, {
        type: "profile_view",
        fromUid: userProfile.uid,
        fromUsername: userProfile.username || "user",
        fromAvatar: userProfile.avatarUrl || getUserAvatar(userProfile),
        createdAt: serverTimestamp(),
        read: false,
        title: "Profile View! 👤",
        description: `@${userProfile.username || 'user'} viewed your profile.`,
        targetId: userProfile.uid,
      }, { merge: true }).catch(err => console.warn("Profile view notification failed:", err));
    }

    // Listen to real-time user profile modifications
    const userDocRef = doc(db, "users", creator.id);
    const unsubProfile = onSnapshot(userDocRef, (docSnap: any) => {
      if (docSnap.exists()) {
        setRealProfile(docSnap.data());
      }
    }, (err: any) => {
      console.warn("Error fetching real user profile:", err);
    });

    // Listen to actual follower count
    const followersQ = query(
      collection(db, "follows"),
      where("toUid", "==", creator.id),
      where("status", "==", "accepted")
    );
    const unsubFollowers = onSnapshot(followersQ, (snap: any) => {
      setFollowerCount(snap.size);
    }, (err: any) => {});

    // Listen to actual following count
    const followingQ = query(
      collection(db, "follows"),
      where("fromUid", "==", creator.id),
      where("status", "==", "accepted")
    );
    const unsubFollowing = onSnapshot(followingQ, (snap: any) => {
      setFollowingCount(snap.size);
    }, (err: any) => {});

    // Listen to posts/stories count
    const storiesQ = query(
      collection(db, "stories"),
      where("authorUid", "==", creator.id)
    );
    const unsubStories = onSnapshot(storiesQ, (snap: any) => {
      setPostsCount(snap.size);
    }, (err: any) => {});

    return () => {
      unsubProfile();
      unsubFollowers();
      unsubFollowing();
      unsubStories();
    };
  }, [creator.id]);

  const displayName = realProfile?.name || realProfile?.displayName || creator.name;
  const displayAvatar = getUserAvatar(realProfile) || getUserAvatar(creator);
  const displayBio = realProfile?.bio || creator.activeProject || "Spatial Computing Enthusiast";
  const displaySpecialty = realProfile?.specialty || creator.specialty;

  const rawAccountStatus = (realProfile?.accountStatus || (realProfile?.status === 'suspended' || realProfile?.status === 'banned' ? realProfile?.status : (creator as any)?.accountStatus || (creator as any)?.status || 'active')).toLowerCase();
  const isAccountRestricted = rawAccountStatus === 'suspended' || rawAccountStatus === 'banned';

  const hasOutgoing = !!outgoingStatus;
  const isAccepted = outgoingStatus === "accepted";
  const isPending = outgoingStatus === "pending";

  const handleSubscribe = () => {
    if (isGuest) {
      onNavigateToLogin();
      return;
    }
    setIsSubscribing(true);
    setTimeout(() => {
      setIsSubscribing(false);
      setIsSubscribed(true);
    }, 1200);
  };

  // Get count of story items
  const storyCount = story?.items.length || 0;
  // Use portfolioPhotos from the data, fallback to placeholder if none
  const portfolioPhotos = creator.portfolioPhotos || [creator.avatar];
  // Use exclusivePhotos from the data, fallback to placeholders
  const exclusivePhotos = creator.exclusivePhotos || [
    'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=400&q=80',
    'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=400&q=80'
  ];

  // Calculate mutual compatibility score (Love %)
  const lovePercent = calculateLovePercentage(userProfile?.interests || [], creator.skillTags);
  const userChat = chats.find(c => !c.isGroup && c.members.includes(creator.id));

  // Filter other creators to show in their connection network
  const networkCreators = creators.filter(c => c.id !== creator.id);

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 md:p-6 select-none bg-black/80 backdrop-blur-md">
      {/* Background click to close */}
      <div className="absolute inset-0 cursor-pointer" onClick={onClose} />

      {/* Main card panel in reference layout size */}
      <motion.div
        initial={{ y: 80, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 80, opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", damping: 25, stiffness: 350 }}
        className="relative w-full max-w-[480px] h-[92vh] max-h-[760px] bg-[#0A0A0C] rounded-[2.5rem] border border-white/10 shadow-2xl overflow-hidden flex flex-col justify-between text-white font-sans"
      >
        
        {/* Scrollable Content Container */}
        {isAccountRestricted ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#0A0A0C]">
            <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4 text-rose-400">
              <Ban className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-black text-white mb-2">Profile Unavailable</h3>
            <p className="text-xs text-[#B5B5B5] max-w-xs leading-relaxed mb-6 font-medium">
              This account has been {rawAccountStatus === 'banned' ? 'permanently banned' : 'temporarily suspended'} for violating community guidelines.
            </p>
            <button 
              onClick={onClose}
              className="px-6 py-2.5 rounded-full bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#2A2A2A] text-white text-xs font-bold transition-all cursor-pointer shadow-lg"
            >
              Close
            </button>
          </div>
        ) : (
        <>
        <div className="flex-1 overflow-y-auto custom-scrollbar no-scrollbar flex flex-col">
          
          {/* Cover / Banner Photo */}
          <div className="relative h-44 bg-[#141414] overflow-hidden flex-shrink-0">
            <img 
              src={creator.coverPhotoUrl || portfolioPhotos[0] || creator.avatar} 
              alt="Cover Backdrop" 
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0C] via-transparent to-black/40" />

            {/* Top Right Action Overlay (Share, Report, Close) */}
            <div className="absolute top-5 right-5 flex items-center gap-2 z-20">
              <button
                onClick={handleShareProfileLink}
                className="w-9 h-9 glass-pill text-white hover:text-[#DDF639] rounded-full flex items-center justify-center shadow transition-all active:scale-90 cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => onOpenReportModal?.({ targetType: 'user', targetId: creator.id, targetName: displayName, targetUsername: realProfile?.username || creator.username, targetAvatar: displayAvatar })}
                className="w-9 h-9 glass-pill text-[#8A8A8A] hover:text-rose-400 rounded-full flex items-center justify-center shadow transition-all active:scale-90 cursor-pointer"
              >
                <Flag className="w-4 h-4" />
              </button>
              <button
                onClick={onClose}
                className="w-9 h-9 glass-pill text-white hover:text-[#DDF639] rounded-full flex items-center justify-center shadow transition-all active:scale-90 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <span className="absolute top-5 left-5 bg-[#DDF639] text-black text-[9px] font-black tracking-widest uppercase px-3 py-1 rounded-full shadow-sm">
              {displaySpecialty}
            </span>
          </div>

          {/* Profile details container - Centered Hero */}
          <div className="px-6 pb-5 flex flex-col items-center text-center relative -mt-12 z-10 flex-shrink-0">

            <div className="relative mb-3.5">
              <div className="w-24 h-24 rounded-full p-0.5 bg-gradient-to-b from-white/20 to-white/5 shadow-2xl bg-[#0A0A0C]">
                <div className="w-full h-full rounded-full overflow-hidden bg-[#121217] ring-1 ring-white/10">
                  <img src={displayAvatar} alt={displayName} className="w-full h-full object-cover" />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 mb-1 justify-center">
              <h2 className="text-xl font-bold tracking-tight text-white">{displayName}</h2>
              <CheckCircle2 className="w-4 h-4 text-[#DDF639] fill-current text-black" />
            </div>

            <p className="text-[10px] text-[#DDF639] font-extrabold uppercase tracking-widest mb-3">
              @{realProfile?.username || creator.username} • {creator.activityDetail || 'Active Now'}
            </p>

            <p className="text-xs text-neutral-400 font-normal tracking-wide italic max-w-xs mb-5">
              “{displayBio}”
            </p>

            {/* Action Buttons */}
            <div className="w-full flex items-center justify-center gap-2.5 mb-6">
              <button
                onClick={() => isGuest ? onNavigateToLogin() : onToggleFollow?.(creator)}
                className={`flex-1 py-2.5 px-4 rounded-full font-semibold text-xs flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.98] transition cursor-pointer ${
                  isAccepted ? 'bg-white/10 text-white border border-white/10' : 'bg-white text-black'
                }`}
              >
                {isAccepted ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                <span>{isAccepted ? 'Following' : 'Follow'}</span>
              </button>
              <button
                onClick={() => {
                  if (isGuest) {
                    onNavigateToLogin();
                    return;
                  }
                  // Message logic: Only allowed if mutual OR recipient allows anyone
                  const isMutual = isAccepted && incomingStatus === "accepted";
                  const allowsAnyone = !!realProfile?.allowMessagesFromAnyone;

                  if (isMutual || allowsAnyone) {
                    onNavigateToTab?.('chat', userChat?.id || null);
                  } else {
                    onConnect(creator); // Trigger follow flow if not mutual
                  }
                }}
                className={`flex-1 py-2.5 px-4 rounded-full font-semibold text-xs flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.98] transition cursor-pointer ${
                  (isAccepted && incomingStatus === "accepted") || !!realProfile?.allowMessagesFromAnyone
                    ? 'bg-white/[0.07] border border-white/10 text-white/90 hover:bg-white/10'
                    : 'bg-[#DDF639] text-black border border-[#DDF639] opacity-90'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5 text-white/70" />
                <span>{((isAccepted && incomingStatus === "accepted") || !!realProfile?.allowMessagesFromAnyone) ? 'Message' : 'Connect'}</span>
              </button>
            </div>

            {/* Stats Bar */}
            <div className="w-full max-w-xs px-5 py-2.5 rounded-2xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-around text-center mb-6">
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-white tracking-tight">{postsCount}</span>
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

            <AdPlacement placement="other_profile" format="inline-card" adIndex={0} creatorId={creator.id} />
          </div>

          {/* Segmented Navigation Tabs */}
          <nav className="px-5 mb-4 sticky top-0 z-50">
            <div className="flex items-center p-1 rounded-full bg-white/[0.04] border border-white/[0.06] overflow-x-auto hide-scrollbar backdrop-blur-xl">
              {[
                { id: 'stories', label: 'Stories' },
                { id: 'photos', label: 'Photos' },
                { id: 'streak', label: 'Love %' },
              ].map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id as any)}
                  className={`flex-1 min-w-[70px] py-1.5 px-3 rounded-full text-xs transition-all duration-300 flex items-center justify-center gap-1.5 cursor-pointer ${
                    activeSection === section.id
                      ? 'bg-white/10 text-white shadow-sm font-semibold'
                      : 'text-white/50 font-medium hover:text-white/80'
                  }`}
                >
                  <span>{section.label}</span>
                </button>
              ))}
            </div>
          </nav>

          <div className="flex-1 p-5 overflow-y-auto min-h-[220px]">
            {/* ABOUT CARD */}
            <div className="bg-[#121217] border border-white/[0.06] rounded-2xl p-4 relative overflow-hidden mb-5">
              <h2 className="text-xs font-semibold text-white/90 tracking-wide uppercase mb-1.5">About</h2>
              <p className="text-xs text-neutral-400 leading-relaxed font-normal">
                {displayBio}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-white/5">
                {(creator.skillTags || ['#SpatialAudio', '#Minimalist', '#CreatorCollective']).map((tag, i) => (
                  <span key={i} className={`text-[10px] px-2.5 py-0.5 rounded-full border border-white/5 ${i === 0 ? 'bg-[#DDF639]/10 text-[#DDF639] border-[#DDF639]/20' : 'bg-white/[0.04] text-white/70'}`}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* TAB CONTENT */}
            <AnimatePresence mode="wait">
              {activeSection === 'stories' && (
                <motion.div key="stories" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-white/40 tracking-wider uppercase">Active stories for today</span>
                    {storyCount > 0 && (!isGuest || !story?.audience || story.audience === 'everyone') && (
                      <button onClick={onLaunchStory} className="text-[10px] font-bold text-[#DDF639] uppercase tracking-wider flex items-center gap-1 hover:underline cursor-pointer">
                        <Eye className="w-3.5 h-3.5" /> View Story
                      </button>
                    )}
                  </div>
                  {storyCount > 0 ? (
                    (!isGuest || !story?.audience || story.audience === 'everyone') ? (
                      <div className="grid grid-cols-2 gap-3">
                        {(story?.items || []).map((item) => (
                          <div key={item.id} onClick={() => setSelectedLightboxImage(item.mediaUrl)} className="relative h-40 bg-[#121217] border border-white/5 rounded-2xl overflow-hidden cursor-pointer group shadow-sm">
                            <img src={item.mediaUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" alt="" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex items-end p-3">
                              <p className="text-[10px] text-white/90 font-medium line-clamp-1">{item.caption || 'Active snap'}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-12 border border-white/5 bg-[#121217] rounded-2xl flex flex-col items-center justify-center gap-3 px-6 text-center">
                         <div className="w-10 h-10 bg-[#DDF639]/10 text-[#DDF639] rounded-full flex items-center justify-center"><Lock className="w-4 h-4" /></div>
                         <p className="text-xs font-bold">Followers Only Story</p>
                         <button onClick={onNavigateToLogin} className="h-8 px-4 bg-[#DDF639] text-black rounded-full text-[10px] font-black uppercase cursor-pointer">Log in to unlock</button>
                      </div>
                    )
                  ) : (
                    <div className="py-10 border border-dashed border-white/10 rounded-2xl text-center text-white/30 text-[11px] italic">No active stories</div>
                  )}
                </motion.div>
              )}

              {activeSection === 'photos' && (
                <motion.div key="photos" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
                   <div className="grid grid-cols-3 gap-2">
                     {portfolioPhotos.map((url, i) => (
                       <div key={i} onClick={() => setSelectedLightboxImage(url)} className="aspect-square bg-[#121217] rounded-xl overflow-hidden border border-white/5 shadow-sm cursor-pointer">
                         <img src={url} className="w-full h-full object-cover hover:scale-105 transition-transform duration-300" alt="" />
                       </div>
                     ))}
                   </div>
                </motion.div>
              )}

              {activeSection === 'streak' && (
                <motion.div key="streak" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="py-2">
                  <div className="p-6 rounded-2xl border flex flex-col items-center justify-center bg-[#121217] border-white/5 text-center">
                    <Heart className="w-12 h-12 text-rose-400 fill-current animate-pulse mb-3" />
                    <h4 className="text-lg font-bold text-white leading-none">{lovePercent}% Compatibility</h4>
                    <p className="text-[10px] text-neutral-400 mt-2 max-w-[240px]">Based on matched creative tags and shared project interests.</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Footer Panel */}
        {isGuest ? (
          <div className="p-5 pb-8 bg-[#121217] border-t border-white/5 flex items-center justify-between gap-4 shrink-0 rounded-b-[2.5rem]">
            <div className="text-left">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#DDF639]">Connect on Anvio Talk</p>
              <p className="text-[9px] text-neutral-400 mt-0.5">Log in to handshake with {displayName}.</p>
            </div>
            <button onClick={onNavigateToLogin} className="h-9 px-5 bg-[#DDF639] text-black rounded-full text-[10px] font-black uppercase cursor-pointer shadow-lg active:scale-95 transition">Sign Up</button>
          </div>
        ) : (
          <div className="p-5 pb-8 bg-[#121217] border-t border-white/5 flex-shrink-0 flex gap-3">
             <button
                onClick={() => {
                  const isMutual = isAccepted && incomingStatus === "accepted";
                  const allowsAnyone = !!realProfile?.allowMessagesFromAnyone;
                  if (isMutual || allowsAnyone) {
                    onNavigateToTab?.('chat', userChat?.id || null);
                    onClose();
                  } else {
                    onConnect(creator);
                  }
                }}
                className={`flex-1 h-11 rounded-full text-[11px] font-black uppercase tracking-wider shadow-lg active:scale-95 transition cursor-pointer ${
                  (isAccepted && incomingStatus === "accepted") || !!realProfile?.allowMessagesFromAnyone
                    ? 'bg-emerald-500 text-white'
                    : 'bg-[#DDF639] text-black hover:bg-[#cbe32d]'
                }`}
             >
                {(isAccepted && incomingStatus === "accepted") || !!realProfile?.allowMessagesFromAnyone
                  ? 'Open Secure Chat 💬'
                  : isPending
                  ? 'Handshake Pending 🤝'
                  : 'Connect Concept 🤝'}
             </button>
          </div>
        )}
        </>
        )}
        
        {/* Lightbox Image Expansion Modal */}
        <AnimatePresence>
          {selectedLightboxImage && (
            <div 
              className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-md flex items-center justify-center p-4 select-none"
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

        {/* Copy Link Toast Notification */}
        <AnimatePresence>
          {showCopyToast && (
            <motion.div 
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] bg-[#1A1A1A] text-white text-[11px] font-extrabold uppercase tracking-wider px-6 py-3.5 rounded-full shadow-2xl flex items-center gap-2.5 border border-[#2A2A2A]"
            >
              <Check className="w-4 h-4 text-[#E5FF3B]" />
              <span>Profile link copied to clipboard!</span>
            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>
    </div>
  );
}
