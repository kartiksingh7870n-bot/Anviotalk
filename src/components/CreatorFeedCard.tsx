import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Heart, MessageSquare, Send, Bookmark, MoreHorizontal, 
  CheckCircle2, Share2, CornerDownRight, Check, Repeat, MapPin
} from 'lucide-react';
import { Creator, Story } from '../data';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { getUserAvatar, getDefaultAvatar } from '../utils/avatar';
import { getShareUrl, triggerShare } from '../utils/deeplink';
import { formatUserFriendlyErrorMessage } from '../utils/errorMessage';
import { collection, query, where, orderBy, onSnapshot, addDoc, doc, setDoc, deleteDoc, serverTimestamp, limit } from 'firebase/firestore';
import { ProgressiveImage } from './Skeletons';

interface CreatorFeedCardProps {
  key?: React.Key;
  creator: Creator;
  story?: Story;
  storyStatus?: 'gradient' | 'grey' | 'none';
  isGuest: boolean;
  onNavigateToLogin?: () => void;
  onSelectCreator: (creator: Creator) => void;
  onMessageInterest: (creator: Creator) => void;
  onOpenChat: (authorUid: string) => void;
  isSaved?: boolean;
  onToggleSave?: () => void;
}

export default function CreatorFeedCard({
  creator,
  story,
  storyStatus = 'none',
  isGuest,
  onNavigateToLogin,
  onSelectCreator,
  onMessageInterest,
  onOpenChat,
  isSaved,
  onToggleSave
}: CreatorFeedCardProps) {
  const { currentUser, isFirebase, userProfile } = useAuth();
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState("");
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectSuccess, setConnectSuccess] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isFollowedBy, setIsFollowedBy] = useState(false);

  // Synchronize Like status from Firestore
  useEffect(() => {
    if (!isFirebase || !currentUser?.uid || !creator?.id) return;
    try {
      const likeDocRef = doc(db, "likes", `${currentUser.uid}_${creator.id}`);
      return onSnapshot(likeDocRef, (snap) => setIsLiked(snap.exists()));
    } catch (e) {}
  }, [isFirebase, currentUser, creator?.id]);

  // Synchronize Follow status from Firestore (Both directions)
  useEffect(() => {
    if (!isFirebase || !currentUser?.uid || !creator?.id) return;
    try {
      const followDocRef = doc(db, "follows", `${currentUser.uid}_${creator.id}`);
      const followedByDocRef = doc(db, "follows", `${creator.id}_${currentUser.uid}`);

      const unsub1 = onSnapshot(followDocRef, (snap) => {
        setIsFollowing(snap.exists() && snap.data()?.status === 'accepted');
      });
      const unsub2 = onSnapshot(followedByDocRef, (snap) => {
        setIsFollowedBy(snap.exists() && snap.data()?.status === 'accepted');
      });

      return () => { unsub1(); unsub2(); };
    } catch (e) {}
  }, [isFirebase, currentUser, creator?.id]);

  const isMutual = isFollowing && isFollowedBy;

  // Synchronize Likes count from Firestore
  useEffect(() => {
    if (!isFirebase || !creator?.id) {
      setLikesCount(0);
      return;
    }
    try {
      const q = query(collection(db, "likes"), where("postId", "==", creator.id));
      return onSnapshot(q, (snap) => setLikesCount(snap.size));
    } catch (e) {}
  }, [isFirebase, creator?.id]);

  // Synchronize Comments from Firestore
  useEffect(() => {
    if (!isFirebase || !creator?.id) return;
    try {
      const q = query(collection(db, "comments"), where("postId", "==", creator.id), limit(30));
      return onSnapshot(q, (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        list.sort((a: any, b: any) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setComments(list);
      });
    } catch (e) {}
  }, [isFirebase, creator?.id]);

  if (!creator) return null;

  const username = creator.username || (creator.name ? creator.name.toLowerCase().replace(/\s+/g, '_') : 'creator');

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isGuest) {
      if (onNavigateToLogin) onNavigateToLogin();
      return;
    }
    if (!creator?.id || !isFirebase || !currentUser) return;

    const nextLiked = !isLiked;
    setIsLiked(nextLiked);
    try {
      const likeDocRef = doc(db, "likes", `${currentUser.uid}_${creator.id}`);
      if (!nextLiked) {
        await deleteDoc(likeDocRef);
      } else {
        await setDoc(likeDocRef, {
          postId: creator.id,
          uid: currentUser.uid,
          createdAt: serverTimestamp()
        });
      }
    } catch (e) {
      console.error("[CreatorFeedCard] Like error:", e);
    }
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const shareUrl = getShareUrl('profile', creator.username || creator.id);
      await triggerShare({
        title: `${creator.name} on Anvio Talk`,
        text: creator.activeProject,
        url: shareUrl
      });
    } catch (err) {
      console.error("[CreatorFeedCard] Share error:", err);
    }
  };

  const handleConnectClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isGuest) {
      if (onNavigateToLogin) onNavigateToLogin();
      return;
    }

    if (isFollowing) {
      onOpenChat(creator.id);
      return;
    }

    if (isConnecting || connectSuccess) return;

    try {
      setIsConnecting(true);
      await onMessageInterest(creator);
      setConnectSuccess(true);
    } catch (err) {
      console.error(err);
    } finally {
      setIsConnecting(false);
    }
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newComment.trim();
    if (!trimmed || isPostingComment || !creator?.id || !currentUser) return;
    setIsPostingComment(true);
    try {
      setNewComment("");
      await addDoc(collection(db, "comments"), {
        postId: creator.id,
        authorUid: currentUser.uid,
        authorName: userProfile?.displayName || userProfile?.fullName || "Anonymous",
        authorAvatar: getUserAvatar(userProfile),
        text: trimmed,
        createdAt: serverTimestamp()
      });
    } catch (err) {} finally { setIsPostingComment(false); }
  };

  return (
    <article className="p-4 bg-[#09090b] hover:bg-[#111113]/40 transition-colors border-b border-[#27272a]/40" onClick={() => onSelectCreator(creator)}>
      <div className="flex items-start space-x-3">
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          <div className={`w-10 h-10 rounded-full p-[2px] ${storyStatus === 'gradient' ? 'bg-gradient-to-tr from-[#DDF639] via-[#8B5CF6] to-[#DDF639] live-glow' : 'bg-[#27272a]'}`}>
            <img alt={creator.name} className="w-full h-full rounded-full object-cover border-2 border-[#09090b]" src={getUserAvatar(creator)} />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1.5 truncate">
              <span className="font-bold text-sm text-white tracking-tight truncate">{creator.name}</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-[#DDF639] fill-[#DDF639]/10" />
              <span className="text-xs text-[#71717A]">@{username}</span>
            </div>
            <button className="text-[#71717A] hover:text-white"><MoreHorizontal className="w-4 h-4" /></button>
          </div>

          <p className="text-[13.5px] leading-relaxed text-zinc-200 mt-1.5 font-normal">
            Ready to collaborate on fresh spatial concepts. ✨
          </p>

          <div className="mt-3 rounded-2xl overflow-hidden border border-[#27272a] bg-gradient-to-br from-[#6D28D9]/20 via-[#18181b] to-[#09090b] p-3 relative group">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                <span className="bg-[#8B5CF6]/30 text-[#DDF639] text-[10px] font-bold px-2 py-0.5 rounded-md uppercase">
                  {creator.specialty || 'Creator'}
                </span>
                <span className="text-[11px] text-[#A1A1AA] flex items-center space-x-1">
                  <MapPin className="w-3 h-3 text-[#DDF639]" />
                  <span>{creator.distance || 'Nearby'}</span>
                </span>
              </div>
              <button
                onClick={handleConnectClick}
                disabled={isConnecting}
                className={`text-[10.5px] font-black px-4 py-1.5 rounded-full active:scale-95 transition-all shadow-md cursor-pointer ${
                  isMutual
                    ? 'bg-white/10 text-white border border-white/10'
                    : isFollowing
                    ? 'bg-white/5 text-zinc-400 border border-white/5'
                    : connectSuccess
                    ? 'bg-emerald-500 text-white'
                    : 'bg-[#DDF639] text-black hover:bg-[#cbe32d]'
                } disabled:opacity-70`}
              >
                {isConnecting ? "FOLLOWING..." : isMutual ? "MESSAGE" : isFollowing ? "FOLLOWING" : connectSuccess ? "FOLLOWED ✅" : "FOLLOW"}
              </button>
            </div>

            <div className="relative h-48 w-full rounded-xl overflow-hidden bg-[#111113]">
              <ProgressiveImage
                src={creator.portfolioPhotos?.[0] || getUserAvatar(creator)}
                fallbackSrc={getUserAvatar(creator)}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                alt={creator.name}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
              <div className="absolute bottom-2 left-3"><h3 className="text-sm font-bold text-white">{creator.activeProject}</h3></div>
            </div>
          </div>

          {/* Interactions */}
          <div className="flex items-center justify-between mt-4 text-[#71717A] max-w-[280px]">
            <button
              onClick={handleLike}
              className="flex items-center gap-1.5 hover:text-rose-500 active:scale-90 transition-all cursor-pointer"
              title="Like"
            >
              <Heart className={`w-5 h-5 ${isLiked ? 'fill-[#FF3B30] text-[#FF3B30]' : ''}`} />
              <span className="text-xs font-bold">{likesCount || 0}</span>
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isGuest) {
                  if (onNavigateToLogin) onNavigateToLogin();
                  return;
                }
                setShowComments(!showComments);
              }}
              className="flex items-center gap-1.5 hover:text-sky-400 active:scale-90 transition-all cursor-pointer"
              title="Comment"
            >
              <MessageSquare className="w-5 h-5" />
              <span className="text-xs font-bold">{comments.length || 0}</span>
            </button>

            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 hover:text-[#DDF639] active:scale-90 transition-all cursor-pointer"
              title="Share"
            >
              <Share2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
