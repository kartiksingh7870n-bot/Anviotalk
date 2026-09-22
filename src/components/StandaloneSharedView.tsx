import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { DeepLinkTarget, triggerShare } from '../utils/deeplink';
import { getUserAvatar, getDefaultAvatar } from '../utils/avatar';
import { 
  Heart, 
  MessageCircle, 
  Share2, 
  Users, 
  MapPin, 
  BadgeCheck, 
  Calendar, 
  Sparkles, 
  Lock, 
  ArrowRight, 
  CheckCircle2, 
  Globe, 
  Music,
  Plus,
  ArrowUpRight,
  Loader2,
  ShieldAlert,
  AlertCircle,
  Ban
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getShareUrl } from '../utils/deeplink';
import { db } from '../firebase';
import { doc, onSnapshot, collection, query, where, getDocs, getDoc } from 'firebase/firestore';
import { recordProfileViewClient } from '../utils/recordProfileView';
import AdPlacement from './AdPlacement';

interface StandaloneSharedViewProps {
  target: DeepLinkTarget;
  onLoginRequest: () => void;
  onOpenFullApp: () => void;
}

export default function StandaloneSharedView({
  target,
  onLoginRequest,
  onOpenFullApp
}: StandaloneSharedViewProps) {
  const { currentUser, isGuest, continueAsGuest } = useAuth();
  
  // Likes & interactions state
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);

  // Loading & error state
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [dataNotFound, setDataNotFound] = useState(false);
  const [isPermissionDenied, setIsPermissionDenied] = useState(false);

  // Real fetched data states
  const [realGroup, setRealGroup] = useState<any>(null);
  const [realGroupMessages, setRealGroupMessages] = useState<any[]>([]);
  const [realProfileData, setRealProfileData] = useState<any>(null);
  const [realUserStories, setRealUserStories] = useState<any[]>([]);
  const [realStoryData, setRealStoryData] = useState<any>(null);
  const [hasJoinedGroup, setHasJoinedGroup] = useState(false);

  const handleOpenApp = () => {
    if ((target?.type === 'profile' || target?.type === 'creator') && target?.id) {
      sessionStorage.setItem('pending_profile_id', target.id);
    } else if ((target?.type === 'group' || target?.type === 'invite') && target?.id) {
      sessionStorage.setItem('pending_group_invite_id', target.id);
    }
    onOpenFullApp();
  };

  const handleConnectRequest = () => {
    if ((target?.type === 'profile' || target?.type === 'creator') && target?.id) {
      sessionStorage.setItem('pending_profile_id', target.id);
    } else if ((target?.type === 'group' || target?.type === 'invite') && target?.id) {
      sessionStorage.setItem('pending_group_invite_id', target.id);
    }
    onLoginRequest();
  };

  useEffect(() => {
    let isMounted = true;
    setIsLoadingData(true);
    setDataNotFound(false);
    setIsPermissionDenied(false);

    if (!target || !target.id) {
      setIsLoadingData(false);
      setDataNotFound(true);
      return;
    }

    if (target.type === 'group' || target.type === 'invite') {
      let unsubMsgs: (() => void) | null = null;

      const unsubDoc = onSnapshot(doc(db, "chats", target.id), (docSnap) => {
        if (!isMounted) return;
        if (docSnap.exists()) {
          const gData = { id: docSnap.id, ...docSnap.data() };
          setRealGroup(gData);
          if (currentUser?.uid && (gData as any).members?.includes(currentUser.uid)) {
            setHasJoinedGroup(true);
          }
          setIsLoadingData(false);
          setDataNotFound(false);
          setIsPermissionDenied(false);

          const isPub = (gData as any).visibility === 'public' || (gData as any).isPublic === true;

          if (isPub) {
            if (!unsubMsgs) {
              unsubMsgs = onSnapshot(collection(db, "chats", target.id, "messages"), (snap) => {
                if (!isMounted) return;
                const msgs: any[] = [];
                snap.forEach((m) => msgs.push({ id: m.id, ...m.data() }));
                msgs.sort((a, b) => {
                  const tA = a.createdAt?.toMillis?.() || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
                  const tB = b.createdAt?.toMillis?.() || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
                  return tA - tB;
                });
                setRealGroupMessages(msgs);
              }, (err) => {
                console.warn("Public messages snapshot notice:", err);
              });
            }
          } else {
            if (unsubMsgs) {
              unsubMsgs();
              unsubMsgs = null;
            }
            setRealGroupMessages([]);
          }
        } else {
          setRealGroup(null);
          setIsLoadingData(false);
          setDataNotFound(true);
        }
      }, (err) => {
        console.warn("Group fetch error:", err);
        if (isMounted) {
          setIsLoadingData(false);
          if (err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
            setIsPermissionDenied(true);
          } else {
            setDataNotFound(true);
          }
        }
      });

      return () => {
        isMounted = false;
        unsubDoc();
        if (unsubMsgs) unsubMsgs();
      };
    } else if (target.type === 'profile' || target.type === 'creator') {
      const unsubUser = onSnapshot(doc(db, "users", target.id), (userSnap) => {
        if (!isMounted) return;
        if (userSnap.exists()) {
          const uData = { id: userSnap.id, ...userSnap.data() };
          setRealProfileData(uData);
          setIsLoadingData(false);
          setDataNotFound(false);
          setIsPermissionDenied(false);

          if (currentUser?.uid && uData.id && currentUser.uid !== uData.id && !isGuest) {
            recordProfileViewClient(uData.id, currentUser.uid);
          }

          // Fetch user's real active stories
          const storiesQ = query(collection(db, "stories"), where("authorUid", "==", uData.id));
          getDocs(storiesQ).then((sSnap) => {
            if (!isMounted) return;
            const sList: any[] = [];
            sSnap.forEach((sDoc) => sList.push({ id: sDoc.id, ...sDoc.data() }));
            setRealUserStories(sList);
          }).catch(() => {});
        } else {
          const q = query(collection(db, "users"), where("username", "==", target.id.toLowerCase().trim()));
          getDocs(q).then((snap) => {
            if (!isMounted) return;
            if (!snap.empty) {
              const uDoc = snap.docs[0];
              const uData = { id: uDoc.id, ...uDoc.data() };
              setRealProfileData(uData);
              setIsLoadingData(false);
              setDataNotFound(false);
              setIsPermissionDenied(false);

              // Fetch user's real active stories
              const storiesQ = query(collection(db, "stories"), where("authorUid", "==", uData.id));
              getDocs(storiesQ).then((sSnap) => {
                if (!isMounted) return;
                const sList: any[] = [];
                sSnap.forEach((sDoc) => sList.push({ id: sDoc.id, ...sDoc.data() }));
                setRealUserStories(sList);
              }).catch(() => {});
            } else {
              setRealProfileData(null);
              setIsLoadingData(false);
              setDataNotFound(true);
            }
          }).catch((err) => {
            if (isMounted) {
              setIsLoadingData(false);
              if (err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
                setIsPermissionDenied(true);
              } else {
                setDataNotFound(true);
              }
            }
          });
        }
      }, (err) => {
        console.warn("User fetch error:", err);
        if (isMounted) {
          setIsLoadingData(false);
          if (err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
            setIsPermissionDenied(true);
          } else {
            setDataNotFound(true);
          }
        }
      });

      return () => {
        isMounted = false;
        unsubUser();
      };
    } else if (target.type === 'story' || target.type === 'image') {
      const unsubStory = onSnapshot(doc(db, "stories", target.id), (storySnap) => {
        if (!isMounted) return;
        if (storySnap.exists()) {
          const sData = { id: storySnap.id, ...storySnap.data() };
          setRealStoryData(sData);
          setLikesCount((sData as any).likesCount || 0);
          setIsLoadingData(false);
          setDataNotFound(false);
          setIsPermissionDenied(false);
        } else {
          setRealStoryData(null);
          setIsLoadingData(false);
          setDataNotFound(true);
        }
      }, (err) => {
        console.warn("Story fetch error:", err);
        if (isMounted) {
          setIsLoadingData(false);
          if (err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
            setIsPermissionDenied(true);
          } else {
            setDataNotFound(true);
          }
        }
      });

      return () => {
        isMounted = false;
        unsubStory();
      };
    } else {
      setIsLoadingData(false);
      setDataNotFound(true);
    }
  }, [target, currentUser]);

  const handleShareClick = async () => {
    const url = getShareUrl(target.type, target.id);
    await triggerShare({
      title: realGroup?.name || realProfileData?.displayName || realStoryData?.authorName || 'Shared Link on Anvio Talk',
      text: realGroup?.description || realProfileData?.bio || realStoryData?.text || 'Check this out on Anvio Talk!',
      url
    });
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-[#0d0e10] text-white font-sans overflow-y-auto select-none relative custom-scrollbar">
      
      {/* Top Standalone Header */}
      <header 
        className="sticky top-0 z-40 bg-[#121316]/90 backdrop-blur-md border-b border-white/10 px-6 flex items-center justify-between"
        style={{
          paddingTop: 'calc(0.875rem + env(safe-area-inset-top, 0px))',
          paddingBottom: '0.875rem'
        }}
      >
        <div className="flex items-center gap-3">
          <div>
            <span className="text-base font-black text-white tracking-tight">Anvio Talk</span>
            <span className="text-[10px] text-[#feb7df] font-bold uppercase tracking-wider block">Shared Link Preview</span>
          </div>
        </div>

        <button
          onClick={handleOpenApp}
          className="bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-bold px-4 py-2 rounded-full flex items-center gap-1.5 transition-all cursor-pointer"
        >
          <span>Open Full App</span>
          <ArrowUpRight className="w-3.5 h-3.5 text-[#feb7df]" />
        </button>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-xl mx-auto w-full p-4 sm:p-6 pb-40">
        
        {/* LOADING STATE */}
        {isLoadingData && (
          <div className="py-24 text-center flex flex-col items-center justify-center space-y-4">
            <Loader2 className="w-10 h-10 text-[#E5FF3B] animate-spin" />
            <p className="text-xs font-bold text-slate-300">Fetching real shared content...</p>
          </div>
        )}

        {/* NOT FOUND STATE */}
        {!isLoadingData && !isPermissionDenied && (dataNotFound || (!realGroup && !realProfileData && !realStoryData)) && (
          <div className="bg-[#17181c] border border-white/10 rounded-[2.5rem] p-8 text-center space-y-4 shadow-2xl my-12">
            <div className="w-14 h-14 bg-rose-500/10 text-rose-400 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-lg font-black text-white">Shared Content Not Found</h3>
              <p className="text-xs text-slate-400 font-medium leading-relaxed max-w-xs mx-auto mt-1">
                This shared profile, group, or post is private, expired, or no longer exists.
              </p>
            </div>
            <button
              onClick={handleOpenApp}
              className="bg-[#E5FF3B] hover:bg-[#E5FF3B]/90 text-black text-xs font-black px-6 py-3 rounded-full shadow-lg transition-all cursor-pointer uppercase tracking-wider"
            >
              Explore Anvio Talk
            </button>
          </div>
        )}

        {/* TYPE: STORY / SHARED IMAGE */}
        {!isLoadingData && (target.type === 'story' || target.type === 'image') && realStoryData && (
          <div className="bg-[#17181c] border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl text-left">
            {/* Author bar */}
            <div className="p-5 flex items-center justify-between border-b border-white/5">
              <div className="flex items-center gap-3">
                <img 
                  src={realStoryData.authorAvatar || getDefaultAvatar()} 
                  alt="" 
                  className="w-12 h-12 rounded-full object-cover border-2 border-[#854c6f]" 
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-base font-extrabold text-white">{realStoryData.authorName || 'Anvio Talk Member'}</h3>
                    <BadgeCheck className="w-4 h-4 text-sky-400 fill-sky-400/20" />
                  </div>
                  <p className="text-xs text-slate-400 font-medium">Shared Image</p>
                </div>
              </div>

              <button 
                onClick={handleShareClick}
                className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-slate-300 cursor-pointer"
                title="Copy / Share Link"
              >
                <Share2 className="w-4 h-4" />
              </button>
            </div>

            {/* Media */}
            {(realStoryData.mediaUrl || realStoryData.imageUrl) && (
              <div className="relative aspect-[4/3] bg-black overflow-hidden">
                <img src={realStoryData.mediaUrl || realStoryData.imageUrl} alt="Shared Photo" className="w-full h-full object-cover" />
                {realStoryData.location && (
                  <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md text-white text-[10px] font-bold px-3 py-1 rounded-full flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-[#feb7df]" />
                    <span>{realStoryData.location}</span>
                  </div>
                )}
              </div>
            )}

            {/* Text & Interactions */}
            <div className="p-5 space-y-4">
              {realStoryData.text && (
                <p className="text-sm text-slate-200 font-medium leading-relaxed">
                  {realStoryData.text}
                </p>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-white/5">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => {
                      setLiked(!liked);
                      setLikesCount(prev => liked ? Math.max(0, prev - 1) : prev + 1);
                    }}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-300 hover:text-rose-400 cursor-pointer"
                  >
                    <Heart className={`w-5 h-5 ${liked ? 'fill-rose-500 text-rose-500' : ''}`} />
                    <span>{likesCount}</span>
                  </button>

                  <button 
                    onClick={onLoginRequest}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-300 hover:text-sky-400 cursor-pointer"
                  >
                    <MessageCircle className="w-5 h-5" />
                    <span>Comment</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Sponsored ad in shared story/post view */}
            <div className="p-4 pt-0">
              <AdPlacement
                placement="stories_feed"
                format="inline-card"
                adIndex={2}
              />
            </div>
          </div>
        )}

        {/* TYPE: PROFILE */}
        {!isLoadingData && (target.type === 'profile' || target.type === 'creator') && realProfileData && (
          (realProfileData.accountStatus === 'suspended' || realProfileData.accountStatus === 'banned' || realProfileData.status === 'suspended' || realProfileData.status === 'banned') ? (
            <div className="bg-[#17181c] border border-rose-500/30 rounded-[2.5rem] p-8 text-center space-y-4 shadow-2xl my-12">
              <div className="w-14 h-14 bg-rose-500/10 text-rose-400 rounded-full flex items-center justify-center mx-auto">
                <Ban className="w-7 h-7" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-black text-white">Profile Unavailable</h3>
                <p className="text-xs text-slate-300 font-medium leading-relaxed max-w-xs mx-auto mt-1">
                  This account has been {(realProfileData.accountStatus || realProfileData.status) === 'banned' ? 'permanently banned' : 'temporarily suspended'} for violating community guidelines.
                </p>
              </div>
              <div className="flex justify-center pt-2">
                <button
                  onClick={handleOpenApp}
                  className="bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#2A2A2A] text-white text-xs font-bold px-6 py-2.5 rounded-full transition-all cursor-pointer shadow-lg"
                >
                  Return to App
                </button>
              </div>
            </div>
          ) : (
          <div className="bg-[#17181c] border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl text-left">
            <div className="h-36 bg-gradient-to-r from-[#854c6f] to-[#feb7df] relative">
              {realProfileData.coverPhotoUrl && (
                <img 
                  src={realProfileData.coverPhotoUrl} 
                  alt="" 
                  className="w-full h-full object-cover opacity-50" 
                />
              )}
            </div>
            
            <div className="px-6 pb-6 relative">
              <div className="flex justify-between items-end -mt-12 mb-4">
                <img 
                  src={getUserAvatar(realProfileData) || getDefaultAvatar()} 
                  alt="" 
                  className="w-24 h-24 rounded-[2rem] object-cover border-4 border-[#17181c] shadow-2xl bg-slate-800" 
                />

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleShareClick}
                    className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                    title="Share Profile Link"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>

                  <button
                    onClick={handleConnectRequest}
                    className="bg-[#854c6f] hover:bg-[#854c6f]/90 text-white text-xs font-bold px-5 py-2.5 rounded-full shadow-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Connect / Message</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-black text-white">{realProfileData.displayName || realProfileData.name || 'Anvio Talk Member'}</h2>
                  <BadgeCheck className="w-5 h-5 text-sky-400 fill-sky-400/20" />
                </div>
                {realProfileData.username && (
                  <p className="text-xs text-[#feb7df] font-bold uppercase tracking-wider">@{realProfileData.username}</p>
                )}
                {realProfileData.bio && (
                  <p className="text-xs text-slate-300 font-medium leading-relaxed pt-1">
                    "{realProfileData.bio}"
                  </p>
                )}
              </div>

              {/* Sponsored ad in shared profile link view */}
              <div className="mt-5 pt-3 border-t border-white/5">
                <AdPlacement
                  placement="other_profile"
                  format="inline-card"
                  adIndex={0}
                  creatorId={realProfileData.id || target.id}
                />
              </div>

              {/* Portfolio / Stories Grid */}
              {realUserStories.length > 0 && (
                <div className="mt-4 pt-4 border-t border-white/5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-3">Active Stories & Photos</span>
                  <div className="grid grid-cols-3 gap-2">
                    {realUserStories.map((s, i) => (
                      <div key={i} className="aspect-square rounded-2xl overflow-hidden border border-white/10 bg-slate-800">
                        {s.mediaUrl && <img src={s.mediaUrl} alt="" className="w-full h-full object-cover" />}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action options matching group share UI */}
              <div className="mt-6 pt-5 border-t border-white/10 flex flex-col sm:flex-row gap-2.5">
                <button
                  onClick={handleConnectRequest}
                  className="flex-1 bg-[#854c6f] hover:bg-[#854c6f]/90 text-white font-extrabold text-xs py-3 px-5 rounded-2xl flex items-center justify-center gap-2 shadow-lg cursor-pointer transition-all active:scale-95"
                >
                  <Plus className="w-4 h-4" />
                  <span>Log In / Sign Up to Message</span>
                </button>
                <button
                  onClick={() => {
                    continueAsGuest();
                    handleOpenApp();
                  }}
                  className="bg-white/10 hover:bg-white/20 text-white font-bold text-xs py-3 px-5 rounded-2xl flex items-center justify-center gap-2 cursor-pointer border border-white/10 transition-all active:scale-95"
                >
                  <span>Continue as Guest</span>
                </button>
              </div>
            </div>
          </div>
          )
        )}

        {/* PERMISSION DENIED STATE */}
        {!isLoadingData && isPermissionDenied && (
          <div className="bg-[#17181c] border border-amber-500/30 rounded-[2.5rem] p-8 text-center space-y-4 shadow-2xl my-12 text-left">
            <div className="w-14 h-14 bg-amber-500/10 text-amber-400 rounded-full flex items-center justify-center mx-auto">
              <Lock className="w-7 h-7" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-black text-white">Log In Required</h3>
              <p className="text-xs text-slate-300 font-medium leading-relaxed max-w-xs mx-auto mt-1">
                You need to log in to view this content.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                onClick={onLoginRequest}
                className="w-full sm:w-auto bg-[#E5FF3B] hover:bg-[#E5FF3B]/90 text-black text-xs font-black px-6 py-3 rounded-full shadow-lg transition-all cursor-pointer uppercase tracking-wider"
              >
                Log In / Sign Up
              </button>
              <button
                onClick={() => {
                  continueAsGuest();
                  handleOpenApp();
                }}
                className="w-full sm:w-auto bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-6 py-3 rounded-full border border-white/15 transition-all cursor-pointer"
              >
                Continue as Guest
              </button>
            </div>
          </div>
        )}

        {/* TYPE: GROUP */}
        {!isLoadingData && (target.type === 'group' || target.type === 'invite') && realGroup && (
          <div className="bg-[#141414] border border-[#2A2A2A] rounded-[2rem] overflow-hidden shadow-2xl text-left relative">
            <div className="h-40 relative">
              <img 
                src={realGroup.avatar || realGroup.photoUrl || 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=800&q=80'} 
                alt="" 
                className="w-full h-full object-cover" 
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/60 to-transparent" />
            </div>

            <div className="p-6 space-y-4 -mt-12 relative z-10">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-extrabold text-white">{realGroup.name || 'Group Chat'}</h2>
                    {(realGroup.visibility === 'public' || realGroup.isPublic === true) ? (
                      <span className="bg-[#E5FF3B]/10 border border-[#E5FF3B]/30 text-[#E5FF3B] text-[10px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Globe className="w-3 h-3 text-[#E5FF3B]" />
                        <span>PUBLIC</span>
                      </span>
                    ) : (
                      <span className="bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Lock className="w-3 h-3 text-amber-400" />
                        <span>PRIVATE</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#B5B5B5] font-bold flex items-center gap-1.5 mt-1">
                    <Users className="w-3.5 h-3.5 text-[#E5FF3B]" />
                    <span>{realGroup.members?.length || 1} Members</span>
                  </p>
                </div>

                <button
                  onClick={handleShareClick}
                  className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                  title="Share Group Link"
                >
                  <Share2 className="w-4 h-4" />
                </button>
              </div>

              {(realGroup.description || realGroup.desc) && (
                <p className="text-xs text-[#E8E8E8] font-medium leading-relaxed">
                  {realGroup.description || realGroup.desc}
                </p>
              )}

              {/* Join / Open Action */}
              <div className="pt-1">
                {hasJoinedGroup ? (
                  <button
                    onClick={handleOpenApp}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs py-3.5 px-6 rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer"
                  >
                    <CheckCircle2 className="w-4.5 h-4.5 text-white" />
                    <span>Open Group Chat</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      sessionStorage.setItem('pending_group_invite_id', target.id);
                      if (!currentUser || isGuest) {
                        handleConnectRequest();
                      } else {
                        setHasJoinedGroup(true);
                        handleOpenApp();
                      }
                    }}
                    className="w-full bg-[#E5FF3B] hover:bg-[#E5FF3B]/90 text-black font-extrabold text-xs py-3.5 px-6 rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer"
                  >
                    <Users className="w-4.5 h-4.5 text-black" />
                    <span>Log in to Join Group</span>
                  </button>
                )}
              </div>

              {/* Sponsored ad in shared group landing view */}
              <div className="pt-2">
                <AdPlacement
                  placement="group_chat"
                  format="inline-card"
                  adIndex={1}
                />
              </div>

              {/* Live Public Channel Feed (PUBLIC GROUPS ONLY) */}
              {(realGroup.visibility === 'public' || realGroup.isPublic === true) && (
                <div className="bg-[#0A0A0A] border border-[#2A2A2A] rounded-2xl p-4 space-y-3.5 mt-4">
                  <div className="flex items-center justify-between border-b border-[#2A2A2A] pb-2">
                    <span className="text-[10px] font-extrabold text-[#E5FF3B] uppercase tracking-wider flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-[#E5FF3B]" />
                      <span>Public Channel Preview</span>
                    </span>
                    <span className="text-[10px] text-[#B5B5B5] font-semibold">Read-only feed</span>
                  </div>

                  {realGroupMessages.length > 0 ? (
                    <div className="space-y-3 max-h-[420px] overflow-y-auto custom-scrollbar pr-1">
                      {realGroupMessages.map((m, i) => (
                        <div key={m.id || i} className="text-xs flex items-start gap-3 bg-[#141414] p-3 rounded-xl border border-[#2A2A2A]">
                          <img 
                            src={m.senderAvatar || getDefaultAvatar()} 
                            alt={m.senderName || 'Member'} 
                            className="w-8 h-8 rounded-full object-cover shrink-0 border border-[#2A2A2A]" 
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-extrabold text-white text-xs">{m.senderName || 'Member'}</span>
                            </div>
                            {m.text && (
                              <p className="text-xs text-[#E8E8E8] font-medium leading-relaxed whitespace-pre-wrap">{m.text}</p>
                            )}
                            {(m.mediaUrl || m.imageUrl || m.image) && (
                              <div className="mt-2 rounded-lg overflow-hidden border border-[#2A2A2A] max-w-[280px]">
                                <img 
                                  src={m.mediaUrl || m.imageUrl || m.image} 
                                  alt="Shared media" 
                                  className="w-full h-auto object-cover max-h-60 rounded-lg" 
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-6 text-center text-xs text-[#B5B5B5] font-medium">
                      No public messages in this group yet.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

      </main>

      {/* Non-blocking Unauthenticated Login Banner */}
      {!currentUser && (
        <div 
          className="fixed bottom-0 left-0 w-full z-50 p-4 sm:p-6 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/95 to-transparent"
          style={{
            paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))'
          }}
        >
          <div className="max-w-xl mx-auto bg-[#141414]/95 border border-[#2A2A2A] rounded-[2rem] p-4.5 backdrop-blur-xl shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-left">
              <h4 className="text-sm font-extrabold text-white flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-[#E5FF3B]" />
                <span>Log in to Join Conversation</span>
              </h4>
              <p className="text-[11px] text-[#B5B5B5] font-medium mt-0.5">
                Connect with creators, chat in groups, and share media.
              </p>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={onLoginRequest}
                className="flex-1 sm:flex-initial bg-[#E5FF3B] hover:bg-[#E5FF3B]/90 text-black text-xs font-extrabold px-5 py-2.5 rounded-full transition-all shadow-md cursor-pointer whitespace-nowrap"
              >
                Log In / Sign Up
              </button>

              <button
                onClick={() => {
                  continueAsGuest();
                  onOpenFullApp();
                }}
                className="bg-[#1A1A1A] hover:bg-[#2A2A2A] text-[#E8E8E8] text-xs font-bold px-4 py-2.5 rounded-full border border-[#2A2A2A] transition-colors cursor-pointer"
              >
                Guest View
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

