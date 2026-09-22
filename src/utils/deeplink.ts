import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

export type DeepLinkType = 'profile' | 'story' | 'group' | 'invite' | 'event' | 'community' | 'creator' | 'image';

export interface DeepLinkTarget {
  type: DeepLinkType;
  id: string;
}

/**
 * Generates a clean public deep link URL for sharing using path-based routes
 */
export const PRODUCTION_URL = 'https://anviotalk.in';

export function getShareUrl(type: DeepLinkType, id: string): string {
  return `${PRODUCTION_URL}/${type}/${encodeURIComponent(id)}`;
}

/**
 * Triggers native system share sheet if supported, or copies the URL to clipboard.
 */
export async function triggerShare(options: {
  title?: string;
  text?: string;
  url: string;
}): Promise<boolean> {
  const { title = 'Anvio Talk', text = 'Check out this link on Anvio Talk', url } = options;

  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ title, text, url, dialogTitle: title });
      return true;
    } catch (err) {
      console.warn('Native share dismissed or failed:', err);
    }
  }

  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return true;
    } catch (err) {
      // User cancelled native share or not supported
    }
  }

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }
    return true;
  } catch (err) {
    console.error("Clipboard copy failed:", err);
    return false;
  }
}

/**
 * Parses current window location for deep links
 */
export function parseDeepLink(pathname: string, search: string): DeepLinkTarget | null {
  const types: DeepLinkType[] = ['story', 'profile', 'group', 'invite', 'event', 'community', 'creator', 'image'];

  // 1. Check Pathname first (e.g. /story/123, /profile/alex, /group/xyz)
  for (const t of types) {
    const prefix = `/${t}/`;
    if (pathname.includes(prefix)) {
      const parts = pathname.split(prefix);
      const idPart = parts[1]?.split('/')[0]?.split('?')[0];
      if (idPart) {
        return { type: t, id: decodeURIComponent(idPart) };
      }
    }
  }

  // 2. Check Query Params fallback (e.g. ?story=123, ?profile=alex, ?group=xyz)
  const searchParams = new URLSearchParams(search);
  for (const t of types) {
    const val = searchParams.get(t);
    if (val) {
      return { type: t, id: val };
    }
  }

  return null;
}

