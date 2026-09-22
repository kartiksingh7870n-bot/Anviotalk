import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Heart, MessageSquare, Share2, Eye, Bookmark, MoreHorizontal,
  CheckCircle2, Send, Trash2, X, RefreshCw, Film, Sparkles,
  UserPlus, UserCheck, MessageCircle, Copy, Flag, Lock, Globe, Plus, MapPin
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getUserAvatar, getDefaultAvatar, resolveAvatarUrl } from '../utils/avatar';
import { getShareUrl } from '../utils/deeplink';
import ShareLinkModal from './ShareLinkModal';
import StoryViewer, { StoryDoc } from './StoryViewer';
import ReportModal, { ReportTarget } from './ReportModal';
import AdPlacement from './AdPlacement';
import { MOCK_STORIES } from '../data';
import { db } from '../firebase';
import { 
  collection, query, orderBy, onSnapshot, doc, updateDoc,
  deleteDoc, setDoc, addDoc, arrayUnion, arrayRemove, increment, serverTimestamp, where, limit
} from 'firebase/firestore';
import { StoryGridSkeleton, ProgressiveImage } from './Skeletons';

interface StoriesFeedScreenProps {
  onSelectCreator?: (creator: any) => void;
  onOpenChat?: (authorUid: string) => void;
}

export default function StoriesFeedScreen({ onSelectCreator, onOpenChat }: StoriesFeedScreenProps) {
  const { currentUser, userProfile, isGuest, isFirestoreAvailable } = useAuth();
  const [activeStories, setActiveStories] = useState<StoryDoc[]>([]);
  const [isLoadingStories, setIsLoadingStories] = useState(true);
  const [followsMap, setFollowsMap] = useState<{ [targetUid: string]: boolean }>({});
  const [selectedViewerStoryId, setSelectedViewerStoryId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Load Stories from Firebase
  useEffect(() => {
    if (!isFirestoreAvailable) {
      setIsLoadingStories(false);
      return;
    }
    setIsLoadingStories(true);
    // Query with limit(20) to prevent fetching massive story history
    const q = query(collection(db, 'stories'), limit(20));
    return onSnapshot(q, (snapshot) => {
      const now = new Date();
      const loaded: StoryDoc[] = [];
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
          loaded.push({
            id: docSnap.id,
            authorUid: data.authorUid || 'anonymous',
            authorUsername: data.authorUsername || 'user',
            authorName: data.authorName || 'Anonymous',
            authorAvatar: resolveAvatarUrl(data.authorAvatar),
            mediaUrl: data.mediaUrl || '',
            caption: data.caption || '',
            audience: data.audience || 'everyone',
            createdAt: data.createdAt,
            expiresAt: data.expiresAt,
            likes: data.likes || [],
            likesCount: data.likesCount || 0,
            commentsCount: data.commentsCount || 0,
            sharesCount: data.sharesCount || 0,
            viewedBy: data.viewedBy || []
          });
        }
      });
      // In-memory sort by createdAt
      loaded.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : Date.now());
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : Date.now());
        return timeB - timeA;
      });
      setActiveStories(loaded);
      setIsLoadingStories(false);
    }, (err) => {
      console.warn("Stories feed snapshot error:", err);
      setIsLoadingStories(false);
    });
  }, [isFirestoreAvailable]);

  // Load Follows
  useEffect(() => {
    if (!currentUser?.uid || !isFirestoreAvailable) return;
    const q = query(collection(db, 'follows'), where('fromUid', '==', currentUser.uid));
    return onSnapshot(q, (snapshot) => {
      const follows: { [targetUid: string]: boolean } = {};
      snapshot.forEach((docSnap) => { follows[docSnap.data().toUid] = true; });
      setFollowsMap(follows);
    });
  }, [currentUser?.uid, isFirestoreAvailable]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const spotlightStory = activeStories[0] || null;
  const gridStories = activeStories.slice(1);

  if (isLoadingStories) {
    return (
      <div className="w-full h-full bg-black text-white overflow-y-auto no-scrollbar">
        <StoryGridSkeleton />
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-black text-white overflow-y-auto no-scrollbar selection:bg-[#ddf639] selection:text-black">
      <div className="max-w-[480px] mx-auto min-h-full flex flex-col pb-32">

        {/* PREMIUM HEADER matching code.html style */}
        <header className="px-6 pt-12 pb-6 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-2.5 h-2.5 rounded-full bg-[#ddf639] shadow-[0_0_12px_#ddf639]"></div>
            <h1 className="text-[13px] font-bold uppercase tracking-[0.2em] text-zinc-400">Stories Feed • {activeStories.length} Live</h1>
          </div>
          <button onClick={handleRefresh} className={`text-[#ddf639] ${isRefreshing ? 'animate-spin' : ''}`}>
            <RefreshCw className="w-4 h-4" />
          </button>
        </header>

        {activeStories.length === 0 ? (
          <div className="p-12 text-center text-[#A1A1AA] space-y-3">
            <Film className="w-10 h-10 text-[#DDF639] mx-auto opacity-70" />
            <h3 className="text-base font-bold text-white">No active stories</h3>
            <p className="text-xs text-[#71717A] max-w-xs mx-auto">Be the first to create a story or check back later when creators publish updates!</p>
          </div>
        ) : (
          <>

        {/* 1. SPOTLIGHT CARD */}
        {spotlightStory && (
          <section className="px-4 mb-8">
            <div
              onClick={() => setSelectedViewerStoryId(spotlightStory.id)}
              className="relative w-full aspect-[4/5] rounded-[32px] overflow-hidden border border-white/10 shadow-2xl group cursor-pointer"
            >
              {/* Progress Bars */}
              <div className="absolute top-4 inset-x-4 flex space-x-1.5 z-30">
                <div className="h-1 flex-1 bg-[#ddf639] rounded-full shadow-[0_0_10px_#ddf639]"></div>
                <div className="h-1 flex-1 bg-white/30 rounded-full"></div>
                <div className="h-1 flex-1 bg-white/10 rounded-full"></div>
              </div>

              {/* Status Tag */}
              <div className="absolute top-8 left-4 z-20 flex items-center space-x-2 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-xl border border-white/10 text-[10px] font-bold text-white uppercase tracking-widest">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ddf639] animate-pulse"></span>
                <span>Active Concept</span>
              </div>

              {/* Image */}
              <img src={spotlightStory.mediaUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" alt="" />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-80" />

              {/* Float Actions */}
              <div className="absolute right-4 bottom-20 z-30 flex flex-col space-y-3">
                <button className="w-11 h-11 rounded-full bg-white/10 backdrop-blur-2xl border border-white/20 flex items-center justify-center text-white shadow-xl active:scale-90 transition-all">
                  <MessageCircle className="w-5 h-5" />
                </button>
                <button className="w-11 h-11 rounded-full bg-white/10 backdrop-blur-2xl border border-white/20 flex items-center justify-center text-white shadow-xl active:scale-90 transition-all">
                  <UserPlus className="w-5 h-5" />
                </button>
                <button className="w-11 h-11 rounded-full bg-[#ddf639] flex items-center justify-center text-black shadow-[0_0_15px_rgba(221,246,57,0.4)] active:scale-90 transition-all">
                  <Sparkles className="w-5 h-5" />
                </button>
              </div>

              {/* Info Overlay */}
              <div className="absolute bottom-6 left-6 right-16 z-20 space-y-1.5 text-left">
                <div className="flex items-center space-x-2 text-[11px] font-bold text-white/60">
                  <span className="flex items-center text-[#ddf639]"><MapPin className="w-3 h-3 mr-1" /> Nearby</span>
                  <span>•</span>
                  <span>Featured Artist</span>
                </div>
                <h2 className="text-2xl font-black tracking-tight flex items-center space-x-2">
                  <span>{spotlightStory.authorName}</span>
                  <CheckCircle2 className="w-5 h-5 text-[#ddf639]" />
                </h2>
                <p className="text-xs text-white/80 line-clamp-1 font-medium">{spotlightStory.caption}</p>
              </div>
            </div>
          </section>
        )}

        {/* 2. STAGGERED MOSAIC GRID */}
        <div className="px-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Column 1 */}
            <div className="flex flex-col space-y-4">
              {gridStories.filter((_, i) => i % 2 === 0).map((s) => (
                <StoryCard key={s.id} story={s} onClick={() => setSelectedViewerStoryId(s.id)} isTall={true} currentUser={currentUser} />
              ))}
            </div>
            {/* Column 2 */}
            <div className="flex flex-col space-y-4 pt-8">
              {gridStories.filter((_, i) => i % 2 !== 0).map((s) => (
                <StoryCard key={s.id} story={s} onClick={() => setSelectedViewerStoryId(s.id)} isTall={false} currentUser={currentUser} />
              ))}
            </div>
          </div>
        </div>
        </>
        )}

      </div>

      {/* VIEWER OVERLAY */}
      <AnimatePresence>
        {selectedViewerStoryId && (
          <StoryViewer initialStoryId={selectedViewerStoryId} onClose={() => setSelectedViewerStoryId(null)} onOpenChat={onOpenChat} />
        )}
      </AnimatePresence>
    </div>
  );
}

function StoryCard({ story, onClick, isTall, currentUser }: any) {
  const isFullyViewed = (story.viewedBy || []).includes(currentUser?.uid || '');

  return (
    <article
      onClick={onClick}
      className={`relative ${isTall ? 'h-[280px]' : 'h-[200px]'} rounded-[24px] overflow-hidden group border border-white/5 hover:border-[#ddf639]/40 transition-all duration-500 cursor-pointer shadow-lg`}
    >
      <img src={story.mediaUrl} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" alt="" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent opacity-80" />

      {/* Live Ring */}
      <div className={`absolute top-3 left-3 p-0.5 rounded-full ${
        isFullyViewed ? 'bg-zinc-700' : 'bg-gradient-to-r from-[#ddf639] to-emerald-400'
      }`}>
        <div className="w-1.5 h-1.5 rounded-full bg-black"></div>
      </div>

      {/* Info */}
      <div className="absolute bottom-3 inset-x-3 text-center">
        <h4 className={`text-xs font-bold tracking-tight line-clamp-1 ${isFullyViewed ? 'text-white/40' : 'text-white'}`}>{story.authorName}</h4>
        <div className="mt-1.5 flex justify-center">
          <img src={resolveAvatarUrl(story.authorAvatar)} className={`w-6 h-6 rounded-full border border-white/20 object-cover ${isFullyViewed ? 'opacity-40' : ''}`} alt="" />
        </div>
      </div>
    </article>
  );
}
