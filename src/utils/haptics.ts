import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export async function triggerHapticMatch() {
  if (Capacitor.isNativePlatform()) {
    try {
      await Haptics.notification({ type: NotificationType.Success });
    } catch (e) {
      console.warn('Native haptics error:', e);
    }
  } else if (typeof window !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([100, 50, 100, 50, 200]);
    } catch (e) {}
  }
}

export async function triggerHapticMessage() {
  if (Capacitor.isNativePlatform()) {
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch (e) {
      console.warn('Native haptics error:', e);
    }
  } else if (typeof window !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([100]);
    } catch (e) {}
  }
}
