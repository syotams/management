const EPIC_CHIP_TITLE_MAX = 25;

export function truncateEpicTitle(title: string, max = EPIC_CHIP_TITLE_MAX): string {
  if (title.length <= max) return title;
  return `${title.slice(0, max)}…`;
}
