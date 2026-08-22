export const EPIC_COLORS = [
  '#4f46e5',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
];

export function nextEpicColor(index: number): string {
  return EPIC_COLORS[index % EPIC_COLORS.length];
}
