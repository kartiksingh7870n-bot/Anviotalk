import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

export async function openExternalUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await Browser.open({ url });
      return;
    } catch (err) {
      console.warn('[openExternalUrl] Capacitor Browser failed, falling back to window.open:', err);
    }
  }

  // On web browsers, open in a new tab
  window.open(url, '_blank', 'noopener,noreferrer');
}

