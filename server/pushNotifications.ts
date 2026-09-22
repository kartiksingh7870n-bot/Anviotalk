import { adminDb, adminMessaging, isServiceAccountConfigured, FieldValue, Timestamp } from "./firebaseAdmin";

let isListenerStarted = false;

export async function startPushNotificationListeners() {
  if (isListenerStarted) {
    return;
  }

  // Cloud Functions (functions/src/index.ts) are the primary FCM sender. These Express
  // listeners are a fallback for self-hosted deployments only. Enable explicitly with
  // ENABLE_SERVER_PUSH_LISTENERS=1 to avoid duplicate push notifications.
  if (process.env.ENABLE_SERVER_PUSH_LISTENERS !== "1") {
    console.log("[PushNotifications] ENABLE_SERVER_PUSH_LISTENERS not set to '1'. Skipping background Firestore push notification listeners (Cloud Functions handle push)." );
    return;
  }

  // Without a valid service account credential, Admin Firestore listeners fail with permission errors
  if (!isServiceAccountConfigured) {
    console.log("[PushNotifications] Service account credentials not provided in environment. Skipping background Firestore push notification listeners.");
    return;
  }

  try {
    const db = adminDb;
    if (!db) {
      console.log("[PushNotifications] Firestore instance not available. Skipping push notification listeners.");
      return;
    }

    isListenerStarted = true;
    const serverStartTime = Timestamp.now();

    console.log("[PushNotifications] Starting Firestore listeners for real-time push notifications...");

    // =========================================================================
    // LISTENER A: In-App Notification Items -> FCM Push Notifications
    // Removed orderBy("createdAt") to avoid mandatory composite index requirement
    db.collectionGroup("items")
      .where("createdAt", ">", serverStartTime)
      .onSnapshot((snapshot) => {
        console.log(`[PushNotifications] Items listener triggered: ${snapshot.size} docs`);
        snapshot.docChanges().forEach(async (change) => {
          if (change.type !== "added") return;

          const docSnap = change.doc;
          const data = docSnap.data();

          // Idempotency check: Skip if already processed
          if (data?.pushSent === true) return;

          try {
            // Document path format: notifications/{userId}/items/{notifId}
            const userDocRef = docSnap.ref.parent.parent;
            if (!userDocRef) return;
            const targetUserId = userDocRef.id;

            // Fetch recipient's FCM tokens from users/{targetUserId}
            const userSnap = await db.collection("users").doc(targetUserId).get();
            if (!userSnap.exists) return;

            const userData = userSnap.data();
            const fcmTokens: string[] = Array.isArray(userData?.fcmTokens) ? userData.fcmTokens : [];
            console.log(`[PushNotifications] Found ${fcmTokens.length} tokens for user ${targetUserId}`);
            if (fcmTokens.length === 0) return;

            // Map notification fields to push title & body
            const notifType = data.type || "notification";
            const fromUsername = data.fromUsername || "Someone";

            let title = "New Notification";
            let body = `${fromUsername} interacted with your account.`;

            switch (notifType) {
              case "follow_request":
                title = "New Follow Request";
                body = `@${fromUsername} sent you a follow request.`;
                break;
              case "follow_accepted":
                title = "Follow Request Accepted";
                body = `@${fromUsername} accepted your follow request.`;
                break;
              case "profile_view":
                title = "Profile View";
                body = `@${fromUsername} viewed your profile.`;
                break;
              case "story_view":
                title = "Story View";
                body = `@${fromUsername} viewed your story.`;
                break;
              case "message":
                title = `Message from @${fromUsername}`;
                body = data.text || data.body || "Sent you a direct message.";
                break;
              case "new_follower_post":
                title = "New Story";
                body = `@${fromUsername} published a new story.`;
                break;
              case "like":
              case "story_like":
              case "post_like":
                title = "New Like";
                body = `@${fromUsername} liked your ${notifType === 'story_like' ? 'story' : 'post'}.`;
                break;
              case "comment":
              case "story_comment":
                title = "New Comment";
                body = `@${fromUsername} left a comment on your ${notifType === 'story_comment' ? 'story' : 'post'}.`;
                break;
              case "group_added":
                title = "Added to Group";
                body = `@${fromUsername} added you to a group.`;
                break;
              default:
                if (data.title) title = String(data.title);
                if (data.body || data.text) body = String(data.body || data.text);
                break;
            }

            // Prepare payload data (all string values required by FCM)
            const payloadData: Record<string, string> = {
              notificationId: docSnap.id,
              type: String(notifType),
              fromUid: String(data.fromUid || ""),
              targetId: String(data.targetId || "")
            };

            // Extract image for "Big Picture" style notification
            const notificationImage = data.mediaUrl || data.fromAvatar || data.imageUrl || "";

            // Send FCM Multicast
            const response = await adminMessaging.sendEachForMulticast({
              tokens: fcmTokens,
              notification: {
                title,
                body,
                image: notificationImage
              },
              data: payloadData,
              android: {
                priority: "high",
                notification: {
                  channelId: "social_activity",
                  priority: "high",
                  sound: "default",
                  imageUrl: notificationImage
                }
              }
            });

            // Mark document as pushSent to ensure idempotency
            await docSnap.ref.update({
              pushSent: true,
              pushSentAt: FieldValue.serverTimestamp()
            });

            console.log(`[PushNotifications] Successfully sent push for item ${docSnap.id} to ${targetUserId}`);

            // Clean up invalid/unregistered tokens
            if (response.failureCount > 0) {
              const failedTokens: string[] = [];
              response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                  const errCode = resp.error?.code;
                  if (
                    errCode === "messaging/invalid-registration-token" ||
                    errCode === "messaging/registration-token-not-registered"
                  ) {
                    failedTokens.push(fcmTokens[idx]);
                  }
                }
              });

              if (failedTokens.length > 0) {
                await db.collection("users").doc(targetUserId).update({
                  fcmTokens: FieldValue.arrayRemove(...failedTokens)
                });
                console.log(`[PushNotifications] Cleaned up ${failedTokens.length} stale FCM tokens for user ${targetUserId}`);
              }
            }
          } catch (err) {
            console.error(`[PushNotifications] Error processing notification doc ${docSnap.id}:`, err);
          }
        });
      }, (err) => {
        console.warn("[PushNotifications] Note on collectionGroup('items') listener:", err?.message || err);
      });

    // =========================================================================
    // LISTENER B: Chat Messages -> FCM Push Notifications
    // Removed orderBy("createdAt") to avoid mandatory composite index requirement
    db.collectionGroup("messages")
      .where("createdAt", ">", serverStartTime)
      .onSnapshot((snapshot) => {
        console.log(`[PushNotifications] Messages listener triggered: ${snapshot.size} docs`);
        snapshot.docChanges().forEach(async (change) => {
          if (change.type !== "added") return;

          const docSnap = change.doc;
          const data = docSnap.data();

          // Idempotency check: Skip if already processed
          if (data?.pushSent === true) return;

          try {
            // Path format: chats/{chatId}/messages/{messageId}
            const chatDocRef = docSnap.ref.parent.parent;
            if (!chatDocRef) return;
            const chatId = chatDocRef.id;

            const chatSnap = await chatDocRef.get();
            if (!chatSnap.exists) return;
            const chatData = chatSnap.data();

            const members: string[] = Array.isArray(chatData?.members)
              ? chatData.members
              : (Array.isArray(chatData?.participants) ? chatData.participants : []);

            const senderUid = data.senderId;
            if (!senderUid) return;

            // Resolve sender's display name
            let senderName = data.senderName;
            if (!senderName || senderName === "You" || senderName === "Creator") {
              const senderUserSnap = await db.collection("users").doc(senderUid).get();
              if (senderUserSnap.exists) {
                const sData = senderUserSnap.data();
                senderName = sData?.displayName || sData?.username || sData?.name || "Someone";
              } else {
                senderName = "Someone";
              }
            }

            // Determine body preview text (~80 chars max)
            let bodyPreview = "";
            const textMsg = (data.text || "").trim();
            const mediaUrl = data.mediaUrl || data.imageUrl || "";
            const typeMsg = data.type || "";

            if (textMsg) {
              bodyPreview = textMsg.length > 80 ? textMsg.substring(0, 77) + "..." : textMsg;
            } else if (mediaUrl || typeMsg.includes("image") || typeMsg.includes("photo")) {
              bodyPreview = "Sent a photo 🖼️";
            } else if (typeMsg.includes("audio") || typeMsg.includes("voice")) {
              bodyPreview = "Sent a voice message 🎵";
            } else if (typeMsg.includes("video")) {
              bodyPreview = "Sent a video 🎥";
            } else {
              bodyPreview = "Sent a message 📩";
            }

            const title = chatData?.isGroup ? `${senderName} in ${chatData.name || 'Group'}` : senderName;

            // Notify all chat members except the sender
            const recipientUids = members.filter(uid => uid !== senderUid);

            for (const recipientUid of recipientUids) {
              try {
                const recipientSnap = await db.collection("users").doc(recipientUid).get();
                if (!recipientSnap.exists) continue;

                const rData = recipientSnap.data();
                const fcmTokens: string[] = Array.isArray(rData?.fcmTokens) ? rData.fcmTokens : [];
                if (fcmTokens.length === 0) continue;

                const payloadData: Record<string, string> = {
                  chatId: String(chatId),
                  messageId: docSnap.id,
                  senderUid: String(senderUid),
                  type: "chat_message"
                };

                const response = await adminMessaging.sendEachForMulticast({
                  tokens: fcmTokens,
                  notification: {
                    title,
                    body: bodyPreview,
                    image: mediaUrl
                  },
                  data: payloadData,
                  android: {
                    priority: "high",
                    notification: {
                      channelId: "social_activity",
                      priority: "high",
                      sound: "default",
                      imageUrl: mediaUrl
                    }
                  }
                });

                if (response.failureCount > 0) {
                  const failedTokens: string[] = [];
                  response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                      const errCode = resp.error?.code;
                      if (
                        errCode === "messaging/invalid-registration-token" ||
                        errCode === "messaging/registration-token-not-registered"
                      ) {
                        failedTokens.push(fcmTokens[idx]);
                      }
                    }
                  });

                  if (failedTokens.length > 0) {
                    await db.collection("users").doc(recipientUid).update({
                      fcmTokens: FieldValue.arrayRemove(...failedTokens)
                    });
                  }
                }
              } catch (err) {
                console.error(`[PushNotifications] Error sending chat push to recipient ${recipientUid}:`, err);
              }
            }

            // Mark message doc as pushSent
            await docSnap.ref.update({
              pushSent: true,
              pushSentAt: FieldValue.serverTimestamp()
            });

          } catch (err) {
            console.error(`[PushNotifications] Error processing message doc ${docSnap.id}:`, err);
          }
        });
      }, (err) => {
        console.warn("[PushNotifications] Note on collectionGroup('messages') listener:", err?.message || err);
      });

    // =========================================================================
    // LISTENER C: New Stories -> Notify Followers
    // =========================================================================
    db.collection("stories")
      .where("createdAt", ">", serverStartTime)
      .onSnapshot((snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
          if (change.type !== "added") return;

          const docSnap = change.doc;
          const data = docSnap.data();

          if (data?.pushSent === true) return;

          try {
            const authorUid = data.authorUid;
            if (!authorUid) return;

            // Fetch followers of the author
            const followersSnap = await db.collection("follows")
              .where("toUid", "==", authorUid)
              .where("status", "==", "accepted")
              .get();

            if (followersSnap.empty) return;

            const followerUids = followersSnap.docs.map(d => d.data().fromUid);
            const authorName = data.authorName || "Someone";

            for (const followerUid of followerUids) {
              const notifRef = db.collection("notifications").doc(followerUid).collection("items").doc();
              await notifRef.set({
                type: "new_follower_post",
                fromUid: authorUid,
                fromUsername: authorName,
                createdAt: FieldValue.serverTimestamp(),
                read: false,
                title: "New Story",
                description: `@${authorName} published a new story.`,
                targetId: docSnap.id,
                mediaUrl: data.mediaUrl || "",
                pushSent: false
              });
            }

            await docSnap.ref.update({ pushSent: true });

          } catch (err) {
            console.error(`[PushNotifications] Error processing story doc ${docSnap.id}:`, err);
          }
        });
      }, (err) => {
        console.warn("[PushNotifications] Note on stories listener:", err?.message || err);
      });

  } catch (err) {
    console.error("[PushNotifications] Failed to initialize push notification listeners:", err);
  }
}
