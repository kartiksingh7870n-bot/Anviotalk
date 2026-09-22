import { getMessaging, getToken } from "firebase/messaging";
import { app, db } from "../firebase";
import { doc, updateDoc, arrayUnion } from "firebase/firestore";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

export async function requestNotificationPermissionAndRegisterToken(userId?: string, onDeepLinkReceived?: (url: string) => void): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      let permStatus = await PushNotifications.checkPermissions();
      if (permStatus.receive !== 'granted') {
        permStatus = await PushNotifications.requestPermissions();
      }

      if (permStatus.receive === 'granted') {
        // IMPORTANT: Add listeners BEFORE registering to catch the event
        PushNotifications.removeAllListeners();

        PushNotifications.addListener('registration', async (token) => {
          console.log("[PushNotifications] Device registered with FCM token:", token.value);
          if (token && token.value && userId) {
            try {
              await updateDoc(doc(db, "users", userId), {
                fcmTokens: arrayUnion(token.value),
                fcmToken: token.value, // Save most recent for convenience
                notificationsEnabled: true,
                lastNotificationUpdate: Date.now()
              });
              console.log("[PushNotifications] Token successfully saved to Firestore for user:", userId);
            } catch (e) {
              console.error("[PushNotifications] Failed to save token to Firestore:", e);
            }
          }
        });

        PushNotifications.addListener('registrationError', (error) => {
          console.error("[PushNotifications] Registration error:", error);
        });

        await PushNotifications.register();

        PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
          const data = notification.notification.data || {};
          let targetUrl = '/';
          const type = data.type;

          if (type === 'chat_message' && data.chatId) {
            targetUrl = `/group/${encodeURIComponent(data.chatId)}`;
          } else if ((type === 'story_like' || type === 'story_comment' || type === 'new_follower_post' || type === 'story_view') && data.targetId) {
            targetUrl = `/story/${encodeURIComponent(data.targetId)}`;
          } else if ((type === 'follow_request' || type === 'follow_accepted' || type === 'profile_view') && data.fromUid) {
            targetUrl = `/profile/${encodeURIComponent(data.fromUid)}`;
          } else if (data.url) {
            targetUrl = data.url;
          }

          if (onDeepLinkReceived) {
            onDeepLinkReceived(targetUrl);
          }
        });

        return true;
      } else {
        return false;
      }
    } catch (err) {
      console.error("Native push notification error:", err);
      return false;
    }
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    console.warn("This browser environment does not support web notifications.");
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      try {
        const messaging = getMessaging(app);
        // Register device's FCM web token
        const token = await getToken(messaging, {
          vapidKey: "BEl62iUYgUivxIkv69yViEuiC2PEc042M2hB24B351234567890"
        }).catch((err) => {
          console.warn("FCM getToken notice:", err);
          return null;
        });

        if (token && userId) {
          await updateDoc(doc(db, "users", userId), {
            fcmTokens: arrayUnion(token),
            fcmToken: token,
            notificationsEnabled: true,
            lastNotificationUpdate: Date.now()
          }).catch(e => console.warn("Could not save FCM token to user profile:", e));
        }
      } catch (fcmErr) {
        console.warn("FCM initialization notice:", fcmErr);
      }
      return true;
    } else {
      console.log("Notification permission declined or dismissed:", permission);
      return false;
    }
  } catch (err) {
    console.error("Error requesting notification permission:", err);
    return false;
  }
}

export function getNotificationPermissionStatus(): NotificationPermission | 'unsupported' {
  if (Capacitor.isNativePlatform()) {
    return 'granted';
  }
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

