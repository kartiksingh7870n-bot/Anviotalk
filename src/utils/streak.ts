import { ChatThread } from '../data';

/**
 * Parses a textual timestamp (e.g., 'Just now', 'Yesterday, 4:15 PM', '2 hours ago', '3 days ago')
 * or a numerical milliseconds timestamp into a YYYY-MM-DD date string.
 */
export function getLocalDateString(timestamp: string, createdTime?: number): string {
  if (createdTime) {
    const d = new Date(createdTime);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  
  const now = new Date();
  const lowerTs = (timestamp || '').toLowerCase().trim();
  
  if (!lowerTs || lowerTs === 'just now' || lowerTs === 'active now' || lowerTs.includes('min') || lowerTs.includes('hour') || lowerTs.includes('sec')) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  
  if (lowerTs.includes('yesterday')) {
    const prev = new Date();
    prev.setDate(now.getDate() - 1);
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
  }
  
  const daysAgoMatch = lowerTs.match(/(\d+)\s+days?\s+ago/);
  if (daysAgoMatch) {
    const offset = parseInt(daysAgoMatch[1], 10);
    const prev = new Date();
    prev.setDate(now.getDate() - offset);
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
  }
  
  // Try direct parsing fallback
  try {
    const parsed = Date.parse(timestamp);
    if (!isNaN(parsed)) {
      const d = new Date(parsed);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  } catch (e) {
    // ignore
  }
  
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Calculates consecutive days of mutual messaging streak between 'me' and another user.
 * A day counts as a mutual exchange day if BOTH 'me' and the other user sent at least one message.
 */
export function calculateStreak(chat: ChatThread, otherUserId: string): number {
  if (chat.isGroup) return 0;
  
  // Group messages by local calendar date (YYYY-MM-DD)
  const dateMap: { [date: string]: { hasUser: boolean; hasOther: boolean } } = {};
  
  chat.messages.forEach(msg => {
    const dateKey = getLocalDateString(msg.timestamp, (msg as any).createdTime);
    if (!dateMap[dateKey]) {
      dateMap[dateKey] = { hasUser: false, hasOther: false };
    }
    if (msg.senderId === 'me') {
      dateMap[dateKey].hasUser = true;
    } else if (msg.senderId === otherUserId) {
      dateMap[dateKey].hasOther = true;
    }
  });
  
  const now = new Date();
  
  const getFormattedDate = (d: Date) => {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  
  const isMutual = (dateStr: string) => {
    const val = dateMap[dateStr];
    return val ? (val.hasUser && val.hasOther) : false;
  };
  
  const todayStr = getFormattedDate(now);
  
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const yesterdayStr = getFormattedDate(yesterday);
  
  let startCheckingFrom: Date;
  
  if (isMutual(todayStr)) {
    startCheckingFrom = now;
  } else if (isMutual(yesterdayStr)) {
    startCheckingFrom = yesterday;
  } else {
    return 0; // Streak not active or broken
  }
  
  let currentStreak = 0;
  const testDate = new Date(startCheckingFrom);
  
  // Count consecutive days backward
  for (let i = 0; i < 365; i++) { // Limit to a year to prevent any infinite loops
    const testStr = getFormattedDate(testDate);
    if (isMutual(testStr)) {
      currentStreak++;
      testDate.setDate(testDate.getDate() - 1);
    } else {
      break;
    }
  }
  
  return currentStreak;
}

/**
 * Calculates a thematic compatibility percentage (Love %) between two profiles
 * based on their shared interests/skills, with a natural floor of 60% and ceiling of 99%.
 */
export function calculateLovePercentage(userInterests: string[] = [], otherInterests: string[] = []): number {
  if (!userInterests || !otherInterests || userInterests.length === 0 || otherInterests.length === 0) {
    return 65; // High-fidelity baseline
  }
  const cleanUser = userInterests.map(i => i.toLowerCase().trim());
  const cleanOther = otherInterests.map(i => i.toLowerCase().trim());
  const shared = cleanUser.filter(i => cleanOther.includes(i));
  
  const totalUnique = Array.from(new Set([...cleanUser, ...cleanOther])).length;
  if (totalUnique === 0) return 65;

  const ratio = shared.length / totalUnique;
  // Map ratio linearly between 65% and 99%
  const percentage = Math.floor(65 + (ratio * 34));
  return Math.min(percentage, 99);
}
