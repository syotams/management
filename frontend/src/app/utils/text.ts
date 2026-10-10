const EPIC_CHIP_TITLE_MAX = 25;
const MENTION_PATTERN = /(^|[^\w@])@([a-zA-Z0-9_-]{3,})/g;

export interface TextSegment {
  text: string;
  mention: boolean;
}

/** Split text into plain and `@name` segments so mentions can be styled without innerHTML. */
export function mentionSegments(text: string | null | undefined): TextSegment[] {
  if (!text) return [];
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const start = match.index! + match[1].length;
    if (start > last) segments.push({ text: text.slice(last, start), mention: false });
    const end = start + match[2].length + 1;
    segments.push({ text: text.slice(start, end), mention: true });
    last = end;
  }
  if (last < text.length) segments.push({ text: text.slice(last), mention: false });
  return segments;
}

export function truncateEpicTitle(title: string, max = EPIC_CHIP_TITLE_MAX): string {
  if (title.length <= max) return title;
  return `${title.slice(0, max)}…`;
}
