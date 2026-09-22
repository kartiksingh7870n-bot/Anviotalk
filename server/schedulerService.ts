import cron from 'node-cron';
import { adminDb, adminMessaging, FieldValue } from './firebaseAdmin';
import { NOTIFICATIONS_100 } from './notificationData';

/**
 * Initializes the background scheduler for rotating push notifications.
 * Trigger Times: 10:00 AM, 02:00 PM, 10:00 PM, 12:00 AM (Midnight)
 */
export async function startNotificationScheduler() {
  console.log("[Scheduler] Initializing rotating push notification service...");

  // Schedule for: 10:00 AM, 2:00 PM (14:00), 10:00 PM (22:00), 12:00 AM (00:00)
  // Format: 'minute hour day-of-month month day-of-week'
  const schedule = '0 0,10,14,22 * * *';

  cron.schedule(schedule, async () => {
    console.log(`[Scheduler] Triggered at ${new Date().toISOString()}. Dispatching next notification...`);
    await dispatchNextNotification();
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata" // Setting to IST as requested by context time
  });
}

/**
 * Fetches the current rotation index, sends the notification to all users, and increments the index.
 */
async function dispatchNextNotification() {
  try {
    const db = adminDb;
    const systemRef = db.collection("system").doc("notification_state");

    // 1. Get current index from Firestore
    const stateSnap = await systemRef.get();
    let currentIndex = 0;

    if (stateSnap.exists) {
      currentIndex = stateSnap.data()?.currentIndex || 0;
    } else {
      await systemRef.set({ currentIndex: 0 });
    }

    // 2. Pick message (wrap around if >= 100)
    const messageIndex = currentIndex % NOTIFICATIONS_100.length;
    const messageBody = NOTIFICATIONS_100[messageIndex];
    const title = "AnvioTalk";

    console.log(`[Scheduler] Selected message #${messageIndex + 1}: "${messageBody}"`);

    // 3. Gather all unique FCM tokens from users collection
    const usersSnap = await db.collection("users").get();
    const allTokens: string[] = [];

    usersSnap.forEach(userDoc => {
      const userData = userDoc.data();
      if (Array.isArray(userData.fcmTokens)) {
        userData.fcmTokens.forEach((t: string) => {
          if (t && !allTokens.includes(t)) {
            allTokens.push(t);
          }
        });
      }
    });

    if (allTokens.length === 0) {
      console.log("[Scheduler] No FCM tokens found. Skipping broadcast.");
    } else {
      // 4. Send multicast push
      // FCM allows max 500 tokens per multicast call.
      for (let i = 0; i < allTokens.length; i += 500) {
        const batch = allTokens.slice(i, i + 500);
        try {
          const response = await adminMessaging.sendEachForMulticast({
            tokens: batch,
            notification: { title, body: messageBody },
            data: { type: "scheduled_rotation", index: String(messageIndex) }
          });
          console.log(`[Scheduler] Broadcast batch sent. Success: ${response.successCount}, Failure: ${response.failureCount}`);
        } catch (sendErr) {
          console.error("[Scheduler] Multicast batch send error:", sendErr);
        }
      }
    }

    // 5. Update index for next time
    await systemRef.update({
      currentIndex: currentIndex + 1,
      lastSentAt: FieldValue.serverTimestamp(),
      lastMessage: messageBody
    });

  } catch (err) {
    console.error("[Scheduler] Fatal error in dispatchNextNotification:", err);
  }
}

/**
 * Utility to trigger a notification manually for testing.
 */
export async function triggerTestNotification() {
  console.log("[Scheduler] Manual test trigger initiated...");
  await dispatchNextNotification();
}
