import React from "react";
import { motion } from "motion/react";
import { Check, X, Bell, UserPlus, Heart, Sparkles, MessageSquare, ShieldCheck } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { doc, writeBatch, deleteDoc, collection, serverTimestamp, getFirestore, increment, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { getUserAvatar, getDefaultAvatar } from "../utils/avatar";
import AdPlacement from "./AdPlacement";
import { NotificationItemSkeleton } from "./Skeletons";

interface NotificationsTabProps {
  notifications: any[];
  onNavigateToCreator: (creatorId: string) => void;
  onDeleteNotification: (notifId: string) => void;
  onLaunchStory?: (creatorId: string) => void;
}

export default function NotificationsTab({ notifications, onNavigateToCreator, onDeleteNotification, onLaunchStory }: NotificationsTabProps) {
  const { currentUser, userProfile, isFirebase } = useAuth();
  const [localStatusMap, setLocalStatusMap] = React.useState<{ [notifId: string]: 'accepted' | 'declined' }>({});

  const handleAccept = async (notif: any) => {
    const fromUid = notif.fromUid || notif.metadata?.fromUid || (notif.metadata?.targetId ? notif.metadata.targetId.split('_')[0] : null);
    if (!fromUid) return;

    // Optimistically update local UI immediately
    setLocalStatusMap(prev => ({ ...prev, [notif.id]: 'accepted' }));

    if (!isFirebase || !currentUser) return;

    try {
      const batch = writeBatch(db);

      // 1. Update follow edge to accepted (their request to us)
      const followRef = doc(db, "follows", `${fromUid}_${currentUser.uid}`);
      batch.set(followRef, {
        fromUid: fromUid,
        toUid: currentUser.uid,
        status: "accepted",
        respondedAt: serverTimestamp(),
      }, { merge: true });

      // 2. Also set our follow edge to accepted (mutual connection)
      const ourFollowRef = doc(db, "follows", `${currentUser.uid}_${fromUid}`);
      batch.set(ourFollowRef, {
        fromUid: currentUser.uid,
        toUid: fromUid,
        status: "accepted",
        createdAt: serverTimestamp(),
        respondedAt: serverTimestamp()
      }, { merge: true });

      // 3. Increment counts safely using set with merge
      const followerRef = doc(db, "users", fromUid);
      batch.set(followerRef, {
        followingCount: increment(1)
      }, { merge: true });

      const followingRef = doc(db, "users", currentUser.uid);
      batch.set(followingRef, {
        followersCount: increment(1)
      }, { merge: true });

      // 4. Ensure a mutual chat thread exists
      const chatId = [currentUser.uid, fromUid].sort().join('_');
      const chatDocRef = doc(db, "chats", chatId);
      batch.set(chatDocRef, {
        participants: [currentUser.uid, fromUid],
        members: [currentUser.uid, fromUid],
        isGroup: false,
        createdAt: serverTimestamp(),
        lastMessageText: "",
        lastMessageSenderName: userProfile?.displayName || userProfile?.fullName || currentUser.displayName || "User",
        lastMessageSenderAvatar: getUserAvatar(userProfile),
        lastMessageAt: serverTimestamp()
      }, { merge: true });

      // 5. Mark notification as read and accepted
      const notifRef = doc(db, "notifications", currentUser.uid, "items", notif.id);
      batch.set(notifRef, { 
        read: true,
        status: "accepted",
        respondedAt: serverTimestamp()
      }, { merge: true });

      // 6. Create follow_accepted notification for the follower
      const recipientNotifRef = doc(collection(db, "notifications", fromUid, "items"));
      batch.set(recipientNotifRef, {
        type: "follow_accepted",
        fromUid: currentUser.uid,
        fromUsername: userProfile?.username || currentUser.displayName || "user",
        fromAvatar: getUserAvatar(userProfile),
        createdAt: serverTimestamp(),
        read: false,
        targetId: `${fromUid}_${currentUser.uid}`,
      });

      await batch.commit();
    } catch (err) {
      console.error("Error accepting follow request:", err);
    }
  };

  const handleDecline = async (notif: any) => {
    const fromUid = notif.fromUid || notif.metadata?.fromUid || (notif.metadata?.targetId ? notif.metadata.targetId.split('_')[0] : null);
    if (!fromUid) return;

    // Optimistically update local UI immediately
    setLocalStatusMap(prev => ({ ...prev, [notif.id]: 'declined' }));

    if (!isFirebase || !currentUser) return;

    try {
      const batch = writeBatch(db);

      // 1. Delete follow edge
      const followRef = doc(db, "follows", `${fromUid}_${currentUser.uid}`);
      batch.delete(followRef);

      const ourFollowRef = doc(db, "follows", `${currentUser.uid}_${fromUid}`);
      batch.delete(ourFollowRef);

      // 2. Mark notification status as declined so it remains in history
      const notifRef = doc(db, "notifications", currentUser.uid, "items", notif.id);
      batch.set(notifRef, { 
        status: "declined",
        read: true,
        respondedAt: serverTimestamp()
      }, { merge: true });

      await batch.commit();
    } catch (err) {
      console.error("Error declining follow request:", err);
    }
  };

  const handleMarkRead = async (notif: any) => {
    if (!isFirebase || !currentUser || notif.isRead) return;

    try {
      // Statically imported
      const notifRef = doc(db, "notifications", currentUser.uid, "items", notif.id);
      await updateDoc(notifRef, { read: true });
    } catch (err) {
      console.error("Error marking notification read:", err);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "follow":
      case "follow_request":
        return <UserPlus className="w-4 h-4 text-[#D7FF3F]" />;
      case "match":
      case "follow_accepted":
        return <Sparkles className="w-4 h-4 text-[#D7FF3F]" />;
      case "message":
        return <MessageSquare className="w-4 h-4 text-blue-400" />;
      case "like":
        return <Heart className="w-4 h-4 text-rose-500 fill-current" />;
      case "comment":
        return <MessageSquare className="w-4 h-4 text-emerald-400" />;
      default:
        return <Bell className="w-4 h-4 text-[#B5B5B5]" />;
    }
  };

  return (
    <div
      className="flex flex-col w-full h-full bg-[#0A0A0A] text-white p-6 overflow-y-auto"
      style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-white">Notifications</h2>
          <p className="text-xs text-[#B5B5B5] font-medium">Keep track of your circle activity</p>
        </div>
        <Bell className="w-6 h-6 text-[#D7FF3F]" />
      </div>

      {notifications.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-[#1A1F12] flex items-center justify-center text-[#B5B5B5] mb-4 border border-dashed border-[#2C3222]">
            <Bell className="w-6 h-6 text-[#D7FF3F]" />
          </div>
          <p className="font-extrabold text-white text-sm">No new notifications</p>
          <p className="text-xs text-[#B5B5B5] max-w-[240px] mt-1">
            When users follow you, accept requests, or message you, they will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3.5">
          {notifications.map((notif, idx) => {
            const type = notif.type || notif.metadata?.type;
            const status = localStatusMap[notif.id] || notif.status || notif.metadata?.status;
            const fromUid = notif.fromUid || notif.metadata?.fromUid || (notif.metadata?.targetId ? notif.metadata.targetId.split('_')[0] : null);
            const isPendingRequest = type === "follow_request" && status !== "accepted" && status !== "declined";
            
            return (
              <React.Fragment key={notif.id}>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-4 rounded-3xl border transition-all text-left flex gap-3.5 relative overflow-hidden ${
                    notif.isRead 
                      ? "bg-[#141414] border-[#2C3222]" 
                      : "bg-[#1A1F12] border-[#D7FF3F]/40 shadow-xs ring-1 ring-[#D7FF3F]/10"
                  }`}
                  onClick={() => {
                    if (type !== "follow_request") {
                      handleMarkRead(notif);
                    }
                    if (type === "new_story" && onLaunchStory) {
                      if (fromUid) onLaunchStory(fromUid);
                    }
                  }}
                >
                  {/* Unread dot marker */}
                  {!notif.isRead && (
                    <span className="absolute top-4.5 right-10 w-2 h-2 bg-[#D7FF3F] rounded-full shadow-[0_0_8px_#D7FF3F]" />
                  )}

                  {/* Dismiss notification button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteNotification(notif.id);
                    }}
                    className="absolute top-3 right-3 p-1 rounded-full text-[#707070] hover:text-rose-400 hover:bg-[#202515] transition-colors cursor-pointer z-10"
                    title="Remove notification"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>

                  {/* Avatar with type badge */}
                  <div className="relative flex-shrink-0">
                    <img
                      src={getUserAvatar(notif, notif.gender)}
                      alt=""
                      className="w-12 h-12 rounded-2xl object-cover border border-[#2C3222] cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (fromUid) onNavigateToCreator(fromUid);
                      }}
                    />
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-[#141414] rounded-full flex items-center justify-center shadow-xs border border-[#2C3222]">
                      {getIcon(type)}
                    </div>
                  </div>

                  {/* Notification body */}
                  <div className="flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[10px] text-[#B5B5B5] font-extrabold uppercase tracking-wider">
                        {notif.timestamp}
                      </span>
                    </div>

                    <h4 className="font-extrabold text-[13px] text-white tracking-tight mt-0.5">
                      {notif.title}
                    </h4>
                    <p className="text-[12px] text-[#B5B5B5] font-semibold leading-relaxed mt-1">
                      {notif.description}
                    </p>

                    {/* Accept/Decline Actions for follow requests */}
                    {isPendingRequest && (
                      <div className="flex gap-2 mt-3.5 pt-3 border-t border-[#2C3222]">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAccept(notif);
                          }}
                          className="flex-1 h-9 bg-[#D7FF3F] text-black font-black rounded-full text-[10px] uppercase tracking-wider flex items-center justify-center gap-1 active:scale-95 transition-all cursor-pointer shadow-xs hover:bg-[#D7FF3F]/90"
                        >
                          <Check className="w-3.5 h-3.5" /> Accept
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDecline(notif);
                          }}
                          className="flex-1 h-9 bg-[#1A1F12] hover:bg-[#202515] text-[#B5B5B5] hover:text-white rounded-full font-extrabold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1 active:scale-95 transition-all cursor-pointer border border-[#2C3222]"
                        >
                          <X className="w-3.5 h-3.5" /> Decline
                        </button>
                      </div>
                    )}

                    {/* Status Badges for completed requests */}
                    {!isPendingRequest && type === "follow_request" && (
                      <div className="mt-3.5 pt-3 border-t border-[#2C3222] flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-wider">
                        {status === "accepted" ? (
                          <span className="text-[#D7FF3F] bg-[#1A1F12] px-3 py-1.5 rounded-full flex items-center gap-1.5 border border-[#2C3222]">
                            <Check className="w-3.5 h-3.5 text-[#D7FF3F]" /> Accepted
                          </span>
                        ) : status === "declined" ? (
                          <span className="text-rose-400 bg-rose-950/40 px-3 py-1.5 rounded-full flex items-center gap-1.5 border border-rose-800">
                            <X className="w-3.5 h-3.5 text-rose-400" /> Declined
                          </span>
                        ) : null}
                      </div>
                    )}
                  </div>
                </motion.div>

                {/* Inject multi-size ad banner every 3 notifications */}
                {(idx + 1) % 3 === 0 && (
                  <div className="w-full py-1">
                    <AdPlacement 
                      placement="notifications"
                      format="inline-card"
                      adIndex={idx}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}

          {/* Bottom Ad Card for notifications feed */}
          {notifications.length > 0 && notifications.length < 3 && (
            <div className="w-full pt-2">
              <AdPlacement 
                placement="notifications"
                format="inline-card"
                adIndex={0}
              />
            </div>
          )}

          <div className="h-28 w-full" /> {/* Bottom spacer for nav bar */}
        </div>
      )}
    </div>
  );
}
