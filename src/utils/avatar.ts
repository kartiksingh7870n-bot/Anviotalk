export const boyDefault = 'https://res.cloudinary.com/wvksp4fz/image/upload/v1788956001/Boy_Avatar.jpg';
export const girlDefault = 'https://res.cloudinary.com/wvksp4fz/image/upload/v1788956001/Girl_Avatar.jpg';
export const logoFallback = 'https://res.cloudinary.com/dpvpnwhm4/image/upload/v1785045725/Anvio_Talk_logo_ofe2a0.png';

/**
 * Returns the default avatar image based on gender.
 */
export function getDefaultAvatar(gender?: string | null): string {
  if (!gender) return boyDefault;
  const g = String(gender).trim().toLowerCase();
  if (g.includes('female') || g.includes('woman') || g === 'f') {
    return girlDefault;
  }
  return boyDefault;
}

/**
 * Checks whether an avatar URL is missing or is an old placeholder.
 */
export function isDefaultOrPlaceholderAvatar(url?: string | null): boolean {
  if (!url || typeof url !== 'string' || !url.trim()) return true;
  const lower = url.toLowerCase();

  // 1. Current premium defaults are EXEMPT
  if (lower === boyDefault.toLowerCase() || lower === girlDefault.toLowerCase()) return false;
  if (lower.includes('wvksp4fz/image/upload')) return false;

  // 2. Strict blacklist for placeholders
  const placeholders = [
    'dicebear', 'robohash', 'pravatar', 'ui-avatars', 'joeschmoe',
    'iran.liara', 'avataaars', 'bottts', 'adventurer', 'open-peeps',
    'miniavs', 'micah', 'pixel-art', 'lorelei', 'notionists', 'big-smile',
    'placeholder', 'default', 'anonymous', 'user-icon', 'avatar', 'unsplash'
  ];

  if (placeholders.some(p => lower.includes(p))) return true;

  // 3. File type check (Real photos are almost never SVG)
  if (lower.endsWith('.svg') || lower.includes('.svg?')) return true;

  // 4. Logo fallback is also considered a placeholder for profile icons
  if (lower.includes('anvio_talk_logo_ofe2a0')) return true;

  // 5. Short local paths that aren't the current ones
  if (lower.startsWith('/') && !lower.includes('Avatar.jpg')) return true;

  return false;
}

/**
 * Safe process for raw URL strings.
 */
export function resolveAvatarUrl(url?: string | null, gender?: string | null): string {
  if (isDefaultOrPlaceholderAvatar(url)) {
    return getDefaultAvatar(gender);
  }
  return url!;
}

/**
 * Resolves a user's avatar image URL from a profile object.
 */
export function getUserAvatar(userObj?: any, fallbackGender?: string): string {
  if (!userObj) return getDefaultAvatar(fallbackGender);

  const customAvatar = userObj.avatarUrl || userObj.avatar || userObj.photoURL;
  const gender = userObj.gender || fallbackGender || userObj.authorGender;

  if (customAvatar && !isDefaultOrPlaceholderAvatar(customAvatar)) {
    return customAvatar;
  }

  if (Array.isArray(userObj.photos) && userObj.photos.length > 0 && !isDefaultOrPlaceholderAvatar(userObj.photos[0])) {
    return userObj.photos[0];
  }

  return getDefaultAvatar(gender);
}
