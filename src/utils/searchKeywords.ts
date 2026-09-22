/**
 * Helper to generate search prefix keywords and token substrings for Firestore array-contains lookup.
 * Generates lowercase sub-prefixes for fast, live indexing of name, username, specialty, city, and skill tags.
 */
export function generateSearchKeywords(
  name: string = "",
  username: string = "",
  specialty: string = "",
  city: string = "",
  tags: string[] = []
): string[] {
  const safeTags = Array.isArray(tags) ? tags : [];
  const text = `${name || ""} ${username || ""} ${specialty || ""} ${city || ""} ${safeTags.join(" ")}`.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const keywordsSet = new Set<string>();

  words.forEach((w) => {
    // Limit sub-string length to 40 characters max per token to prevent unbounded arrays
    const maxLen = Math.min(w.length, 40);
    for (let i = 1; i <= maxLen; i++) {
      keywordsSet.add(w.slice(0, i));
    }
  });

  return Array.from(keywordsSet);
}
