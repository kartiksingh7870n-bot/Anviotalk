import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

admin.initializeApp();

/**
 * FUNCTION A: sendItemNotification
 * Triggered on creation of a document at notifications/{userId}/items/{notifId}
 * Sends a push notification to the recipient user's registered FCM tokens.
 */
export const sendItemNotification = onDocumentCreated(
  "notifications/{userId}/items/{notifId}",
  async (event) => {
    try {
      const snapshot = event.data;
      if (!snapshot) return;

      const notifData = snapshot.data();
      if (!notifData) return;

      // Idempotency: skip if the push was already sent (protects against function retries)
      if (notifData.pushSent === true) return;

      const userId = event.params.userId;
      const notifId = event.params.notifId;

      const fromUsername = notifData.fromUsername || "Someone";
      const fromUid = notifData.fromUid || "";
      const targetId = notifData.targetId || "";
      const notifType = notifData.type || "";

      // Look up target user's profile to retrieve FCM tokens
      const userDoc = await admin.firestore().doc(`users/${userId}`).get();
      if (!userDoc.exists) return;

      const userData = userDoc.data();
      const rawTokens: any[] = userData?.fcmTokens || [];
      const tokens: string[] = Array.from(
        new Set(
          rawTokens.filter(
            (t): t is string => typeof t === "string" && t.trim().length > 0
          )
        )
      );

      if (tokens.length === 0) return;

      // Construct title and body based on notification type
      let title = "New Notification";
      let body = `${fromUsername} interacted with you`;

      switch (notifType) {
        case "follow_request":
          title = "New follow request";
          body = `${fromUsername} wants to follow you`;
          break;
        case "follow_accepted":
          title = "Follow accepted";
          body = `${fromUsername} accepted your follow request`;
          break;
        case "story_view":
          title = "Story view";
          body = `${fromUsername} viewed your story`;
          break;
        case "message":
          title = "New message";
          body = `${fromUsername} sent you a message`;
          break;
        case "new_follower_post":
          title = "New Story";
          body = `@${fromUsername} published a new story.`;
          break;
        case "story_like":
          title = "Story Liked! ❤️";
          body = `@${fromUsername} liked your story.`;
          break;
        case "story_comment":
          title = "New Story Comment! 💬";
          body = `@${fromUsername} commented on your story.`;
          break;
        case "profile_view":
          title = "Profile View! 👤";
          body = `@${fromUsername} viewed your profile.`;
          break;
        default:
          if (notifData.title) title = String(notifData.title);
          if (notifData.description || notifData.text) body = String(notifData.description || notifData.text);
          break;
      }

      // Extract image for "Big Picture" style notification.
      // Only include it when non-empty: FCM rejects the entire message if the image URL is empty/invalid.
      const notificationImage = notifData.mediaUrl || notifData.fromAvatar || notifData.imageUrl || "";
      const imagePayload = notificationImage ? { image: notificationImage } : {};

      const multicastPayload = {
        tokens,
        notification: {
          title,
          body,
          ...imagePayload
        },
        data: {
          type: String(notifType),
          fromUid: String(fromUid),
          targetId: String(targetId),
          notifId: String(notifId),
        },
        android: {
          priority: "high" as const,
          notification: {
            channelId: "social_activity",
            priority: "high" as const,
            sound: "default",
            ...(notificationImage ? { imageUrl: notificationImage } : {})
          }
        }
      };

      const response = await admin
        .messaging()
        .sendEachForMulticast(multicastPayload);

      // Mark the notification doc as pushed so retries / other senders skip it
      await snapshot.ref
        .update({
          pushSent: true,
          pushSentAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        .catch((err) =>
          console.error("Failed to mark notification as pushSent:", err)
        );

      // Clean up dead/invalid tokens if any failed
      const tokensToRemove: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errCode = resp.error?.code;
          if (
            errCode === "messaging/invalid-registration-token" ||
            errCode === "messaging/registration-token-not-registered"
          ) {
            tokensToRemove.push(tokens[idx]);
          }
        }
      });

      if (tokensToRemove.length > 0) {
        await admin
          .firestore()
          .doc(`users/${userId}`)
          .update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(...tokensToRemove),
          })
          .catch((err) =>
            console.error("Failed to prune invalid FCM tokens:", err)
          );
      }
    } catch (err) {
      console.error("Error in sendItemNotification Cloud Function:", err);
    }
  }
);

/**
 * FUNCTION B: sendChatMessageNotification
 * Triggered on creation of a document at chats/{chatId}/messages/{messageId}
 * Sends a push notification to all other participants in the chat thread.
 */
export const sendChatMessageNotification = onDocumentCreated(
  "chats/{chatId}/messages/{messageId}",
  async (event) => {
    try {
      const snapshot = event.data;
      if (!snapshot) return;

      const msgData = snapshot.data();
      if (!msgData) return;

      // Idempotency: skip if the push was already sent (protects against function retries)
      if (msgData.pushSent === true) return;

      const chatId = event.params.chatId;
      const messageId = event.params.messageId;

      const senderId = msgData.senderId || msgData.senderUid || "";
      if (!senderId) return;

      // Read parent chat doc to identify members/participants
      const chatDoc = await admin.firestore().doc(`chats/${chatId}`).get();
      if (!chatDoc.exists) return;

      const chatData = chatDoc.data() || {};
      const members: string[] = Array.isArray(chatData.members)
        ? chatData.members
        : Array.isArray(chatData.participants)
        ? chatData.participants
        : [];

      // Filter out sender to get recipient uids
      const recipients = members.filter((uid) => uid && uid !== senderId);
      if (recipients.length === 0) return;

      // Determine sender display name
      let senderName = msgData.senderName;
      if (!senderName) {
        const senderDoc = await admin
          .firestore()
          .doc(`users/${senderId}`)
          .get();
        if (senderDoc.exists) {
          const sData = senderDoc.data();
          senderName =
            sData?.displayName ||
            sData?.fullName ||
            sData?.username ||
            "New Message";
        } else {
          senderName = "New Message";
        }
      }

      // Determine notification body text
      let bodyText = "Sent a message";
      if (typeof msgData.text === "string" && msgData.text.trim().length > 0) {
        const cleanText = msgData.text.trim();
        bodyText =
          cleanText.length > 80
            ? cleanText.substring(0, 77) + "..."
            : cleanText;
      } else if (
        msgData.mediaUrl ||
        msgData.imageUrl ||
        msgData.type === "image"
      ) {
        bodyText = "Sent a photo";
      } else if (
        msgData.audioUrl ||
        msgData.type === "voice" ||
        msgData.type === "audio"
      ) {
        bodyText = "Sent a voice message";
      }

      // Group chats show "Sender • Group Name" as the push title
      const notificationTitle = chatData.isGroup
        ? `${senderName} • ${chatData.name || "Group"}`
        : senderName;

      // Send notifications to each recipient
      for (const recipientUid of recipients) {
        try {
          const recipientDoc = await admin
            .firestore()
            .doc(`users/${recipientUid}`)
            .get();
          if (!recipientDoc.exists) continue;

          const rData = recipientDoc.data();
          const rawTokens: any[] = rData?.fcmTokens || [];
          const tokens: string[] = Array.from(
            new Set(
              rawTokens.filter(
                (t): t is string => typeof t === "string" && t.trim().length > 0
              )
            )
          );

          if (tokens.length === 0) continue;

          // Extract image for "Big Picture" style notification.
          // Only include it when non-empty: FCM rejects the entire message if the image URL is empty/invalid.
          const mediaUrl = msgData.mediaUrl || msgData.imageUrl || "";
          const imagePayload = mediaUrl ? { image: mediaUrl } : {};

          const multicastPayload = {
            tokens,
            notification: {
              title: String(notificationTitle),
              body: String(bodyText),
              ...imagePayload
            },
            data: {
              type: "chat_message",
              chatId: String(chatId),
              messageId: String(messageId),
              senderId: String(senderId),
            },
            android: {
              priority: "high" as const,
              notification: {
                channelId: "social_activity",
                priority: "high" as const,
                sound: "default",
                ...(mediaUrl ? { imageUrl: mediaUrl } : {})
              }
            }
          };

          const response = await admin
            .messaging()
            .sendEachForMulticast(multicastPayload);

          // Clean up invalid tokens for recipient
          const tokensToRemove: string[] = [];
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              const errCode = resp.error?.code;
              if (
                errCode === "messaging/invalid-registration-token" ||
                errCode === "messaging/registration-token-not-registered"
              ) {
                tokensToRemove.push(tokens[idx]);
              }
            }
          });

          if (tokensToRemove.length > 0) {
            await admin
              .firestore()
              .doc(`users/${recipientUid}`)
              .update({
                fcmTokens: admin.firestore.FieldValue.arrayRemove(
                  ...tokensToRemove
                ),
              })
              .catch((err) =>
                console.error("Failed to prune invalid recipient tokens:", err)
              );
          }
        } catch (recipErr) {
          console.error(
            `Error sending chat notification to recipient ${recipientUid}:`,
            recipErr
          );
        }
      }

      // Mark the message doc as pushed so retries / other senders skip it
      await snapshot.ref
        .update({
          pushSent: true,
          pushSentAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        .catch((err) =>
          console.error("Failed to mark message as pushSent:", err)
        );
    } catch (err) {
      console.error("Error in sendChatMessageNotification Cloud Function:", err);
    }
  }
);
