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
    // Always emit a full sprint length. The last sprint may extend past the project end.
    const sprintEnd = addUtcDays(current, SPRINT_LENGTH_DAYS - 1);
    sprints.push({ number, startDate: current, endDate: sprintEnd });
    current = addUtcDays(sprintEnd, 1);
    number += 1;
  }

  return sprints;
}

export type SprintWeekNumber = 1 | 2;

export function sprintWeekRange(
  sprint: { startDate: Date; endDate: Date },
  week: SprintWeekNumber,
): { startDate: Date; endDate: Date } {
  const start = startOfUtcDay(sprint.startDate);
  if (week === 1) {
    return { startDate: start, endDate: addUtcDays(start, 6) };
  }
  return { startDate: addUtcDays(start, 7), endDate: startOfUtcDay(sprint.endDate) };
}

export function weekCellKey(sprintId: string, week: SprintWeekNumber): string {
  return `${sprintId}:w${week}`;
}

export function sprintWeekSlots(
  sprints: { id: string; number: number; startDate: Date; endDate: Date }[],
): {
  sprintId: string;
  sprintNumber: number;
  week: SprintWeekNumber;
  startDate: Date;
  endDate: Date;
  cellKey: string;
}[] {
  const slots: {
    sprintId: string;
    sprintNumber: number;
    week: SprintWeekNumber;
    startDate: Date;
    endDate: Date;
    cellKey: string;
  }[] = [];
  for (const sprint of sprints) {
    for (const week of [1, 2] as SprintWeekNumber[]) {
      const range = sprintWeekRange(sprint, week);
      slots.push({
        sprintId: sprint.id,
        sprintNumber: sprint.number,
        week,
        startDate: range.startDate,
        endDate: range.endDate,
        cellKey: weekCellKey(sprint.id, week),
      });
    }
  }
  return slots;
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

export const MIN_MAX_WORKING_DAYS_PER_SPRINT = 1;
export const MAX_MAX_WORKING_DAYS_PER_SPRINT = 10;
export const DEFAULT_MAX_WORKING_DAYS_PER_SPRINT = 8;

export const DUPLICATE_SPRINT_ASSIGNMENT_MESSAGE =
  'This epic is already assigned to that user in that sprint week';

export type DatedSprint = {
  number: number;
  startDate: Date;
  endDate: Date;
};

export type DateRange = {
  startDate: Date;
  endDate: Date;
};

export type SprintPlacement = {
  startSprintNumber: number;
  startSprintWeek: SprintWeekNumber;
};

export type WorkingDayChunk = SprintPlacement & {
  workingDays: number;
};

export type SplitEpicResult =
  | { ok: true; chunks: WorkingDayChunk[] }
  | { ok: false; message: string };

export function pastLastSprintMessage(daysLeft: number): string {
  const noun = daysLeft === 1 ? 'day' : 'days';
  return `Not enough sprint capacity to assign this epic. ${daysLeft} working ${noun} would extend past the last sprint.`;
}

// First chunk keeps the dropped sprint and week. Later chunks start at week 1.
// Each chunk is capped by the project max and by free weekdays from that start week
// through the end of the sprint. Absences are subtracted one range at a time, matching
// the grid, so the chunk stays inside its sprint. Empty sprints are skipped.
// Failure returns no chunks.
export function splitEpicAcrossSprints(input: {
  workingDays: number;
  maxWorkingDaysPerSprint: number;
  startSprintNumber: number;
  startSprintWeek: SprintWeekNumber;
  sprints: DatedSprint[];
  absences?: DateRange[];
  existingPlacements?: SprintPlacement[];
}): SplitEpicResult {
  const {
    workingDays,
    maxWorkingDaysPerSprint,
    startSprintNumber,
    startSprintWeek,
    absences = [],
    existingPlacements = [],
  } = input;

  if (!Number.isInteger(workingDays) || workingDays < 1) {
    return { ok: false, message: 'workingDays must be at least 1' };
  }
  if (!Number.isInteger(maxWorkingDaysPerSprint) || maxWorkingDaysPerSprint < 1) {
    return { ok: false, message: 'maxWorkingDaysPerSprint must be at least 1' };
  }
  if (startSprintWeek !== 1 && startSprintWeek !== 2) {
    return { ok: false, message: 'startSprintWeek must be 1 or 2' };
  }

  const ordered = [...input.sprints].sort((a, b) => a.number - b.number);
  const startIndex = ordered.findIndex((sprint) => sprint.number === startSprintNumber);
  if (startIndex < 0) {
    return { ok: false, message: 'Project has no sprint with that number' };
  }

  const taken = new Set(
    existingPlacements.map(
      (placement) => `${placement.startSprintNumber}:${placement.startSprintWeek}`,
    ),
  );
  const chunks: WorkingDayChunk[] = [];
  let daysLeft = workingDays;

  for (let index = startIndex; index < ordered.length && daysLeft > 0; index += 1) {
    const sprint = ordered[index];
    const week: SprintWeekNumber = index === startIndex ? startSprintWeek : 1;
    const capacity = freeWeekdaysFromWeek(sprint, week, absences);
    if (capacity <= 0) continue;

    const chunkDays = Math.min(daysLeft, maxWorkingDaysPerSprint, capacity);
    const key = `${sprint.number}:${week}`;
    if (taken.has(key)) {
      return { ok: false, message: DUPLICATE_SPRINT_ASSIGNMENT_MESSAGE };
    }
    taken.add(key);
    chunks.push({
      startSprintNumber: sprint.number,
      startSprintWeek: week,
      workingDays: chunkDays,
    });
    daysLeft -= chunkDays;
  }

  if (daysLeft > 0) {
    return { ok: false, message: pastLastSprintMessage(daysLeft) };
  }

  return { ok: true, chunks };
}

function freeWeekdaysFromWeek(
  sprint: DatedSprint,
  startWeek: SprintWeekNumber,
  absences: DateRange[],
): number {
  const weeks: SprintWeekNumber[] = startWeek === 1 ? [1, 2] : [2];
  let free = 0;
  for (const week of weeks) {
    const range = sprintWeekRange(sprint, week);
    let remaining = countWeekdays(range.startDate, range.endDate);
    for (const absence of absences) {
      remaining -= countWeekdaysOverlap(
        absence.startDate,
        absence.endDate,
        range.startDate,
        range.endDate,
      );
    }
    free += Math.max(0, remaining);
  }
  return free;
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
