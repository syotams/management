const MENTION_PATTERN = /(^|[^\w@])@([a-zA-Z0-9_-]{3,})/g;

/** Unique mentioned names, lowercased, in order of first appearance. */
export function extractMentions(text: string | null | undefined): string[] {
  if (!text) return [];
  const names = new Set<string>();
  for (const match of text.matchAll(MENTION_PATTERN)) {
    names.add(match[2].toLowerCase());
  }
  return [...names];
}
