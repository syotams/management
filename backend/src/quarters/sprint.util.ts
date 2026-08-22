const SPRINT_LENGTH_DAYS = 14;

export function parseDateOnly(value: string | Date): Date {
  if (value instanceof Date) {
    return startOfUtcDay(value);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }
  return startOfUtcDay(new Date(value));
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

export function generateSprints(startDate: Date, endDate: Date): { number: number; startDate: Date; endDate: Date }[] {
  const start = startOfUtcDay(startDate);
  const end = startOfUtcDay(endDate);
  const sprints: { number: number; startDate: Date; endDate: Date }[] = [];
  let current = start;
  let number = 1;

  while (current <= end) {
    // Always emit a full sprint length. The last sprint may extend past the quarter end.
    const sprintEnd = addUtcDays(current, SPRINT_LENGTH_DAYS - 1);
    sprints.push({ number, startDate: current, endDate: sprintEnd });
    current = addUtcDays(sprintEnd, 1);
    number += 1;
  }

  return sprints;
}

export function countWeekdays(startDate: Date, endDate: Date): number {
  let count = 0;
  let current = startOfUtcDay(startDate);
  const end = startOfUtcDay(endDate);
  while (current <= end) {
    const day = current.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    current = addUtcDays(current, 1);
  }
  return count;
}

export function countWeekdaysOverlap(
  rangeStart: Date,
  rangeEnd: Date,
  clipStart: Date,
  clipEnd: Date,
): number {
  const start = startOfUtcDay(rangeStart);
  const end = startOfUtcDay(rangeEnd);
  const clipS = startOfUtcDay(clipStart);
  const clipE = startOfUtcDay(clipEnd);
  const from = start > clipS ? start : clipS;
  const to = end < clipE ? end : clipE;
  if (from > to) return 0;
  return countWeekdays(from, to);
}
