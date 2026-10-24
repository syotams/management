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

export type CapacitySlot = {
  sprintNumber: number;
  week: SprintWeekNumber;
  capacity: number;
};

export type PaintedWeek = {
  sprintNumber: number;
  week: SprintWeekNumber;
  days: number;
};

export type ExistingAssignmentSpan = {
  workingDays: number;
  startSprintNumber: number;
  startSprintWeek: SprintWeekNumber;
};

export type PlanAssignmentResult =
  | { ok: true; weeks: PaintedWeek[] }
  | { ok: false; reason: 'invalid' | 'overflow' | 'overlap'; message: string };

export function pastLastSprintMessage(daysLeft: number): string {
  const noun = daysLeft === 1 ? 'day' : 'days';
  return `Not enough sprint capacity to assign this epic. ${daysLeft} working ${noun} would extend past the last sprint.`;
}

export function weekCapacity(sprint: DatedSprint, week: SprintWeekNumber, absences: DateRange[]): number {
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
  return Math.max(0, remaining);
}

export function assignmentSlots(
  sprints: DatedSprint[],
  startSprintNumber: number,
  startSprintWeek: SprintWeekNumber,
  absences: DateRange[] = [],
): CapacitySlot[] | null {
  const ordered = [...sprints].sort((a, b) => a.number - b.number);
  const startIndex = ordered.findIndex((sprint) => sprint.number === startSprintNumber);
  if (startIndex < 0) return null;

  const slots: CapacitySlot[] = [];
  for (let index = startIndex; index < ordered.length; index += 1) {
    const sprint = ordered[index];
    const weeks: SprintWeekNumber[] =
      index === startIndex ? (startSprintWeek === 2 ? [2] : [1, 2]) : [1, 2];
    for (const week of weeks) {
      slots.push({
        sprintNumber: sprint.number,
        week,
        capacity: weekCapacity(sprint, week, absences),
      });
    }
  }
  return slots;
}

// Walks week slots from the assignment start. Each sprint gets a fresh cap.
// A week takes min(days left, free weekdays, cap still left in that sprint).
// Empty weeks are skipped. Leftover days stay unplaced unless dumpRemainder is set,
// which matches the grid's last-cell overflow for assignments already on the board.
export function paintAssignmentWeeks(
  workingDays: number,
  maxWorkingDaysPerSprint: number,
  slots: CapacitySlot[],
  options?: { dumpRemainder?: boolean },
): { weeks: PaintedWeek[]; daysLeft: number } {
  const weeks: PaintedWeek[] = [];
  let daysLeft = workingDays;
  let currentSprint: number | null = null;
  let capLeft = 0;

  for (const slot of slots) {
    if (daysLeft <= 0) break;
    if (slot.sprintNumber !== currentSprint) {
      currentSprint = slot.sprintNumber;
      capLeft = maxWorkingDaysPerSprint;
    }
    if (slot.capacity <= 0 || capLeft <= 0) continue;
    const used = Math.min(daysLeft, slot.capacity, capLeft);
    weeks.push({ sprintNumber: slot.sprintNumber, week: slot.week, days: used });
    daysLeft -= used;
    capLeft -= used;
  }

  if (options?.dumpRemainder && daysLeft > 0 && slots.length) {
    const last = slots[slots.length - 1];
    const existing = weeks.find(
      (week) => week.sprintNumber === last.sprintNumber && week.week === last.week,
    );
    if (existing) existing.days += daysLeft;
    else weeks.push({ sprintNumber: last.sprintNumber, week: last.week, days: daysLeft });
    daysLeft = 0;
  }

  return { weeks, daysLeft };
}

function weekKey(week: { sprintNumber: number; week: SprintWeekNumber }): string {
  return `${week.sprintNumber}:${week.week}`;
}

// One assignment keeps the full working-day total and its start cell.
// Later sprints are painted, not stored. A second assignment of the same epic
// and user is rejected only when the painted weeks overlap.
export function planAssignmentSpan(input: {
  workingDays: number;
  maxWorkingDaysPerSprint: number;
  startSprintNumber: number;
  startSprintWeek: SprintWeekNumber;
  sprints: DatedSprint[];
  absences?: DateRange[];
  existingPlacements?: ExistingAssignmentSpan[];
  allowOverflow?: boolean;
}): PlanAssignmentResult {
  const {
    workingDays,
    maxWorkingDaysPerSprint,
    startSprintNumber,
    startSprintWeek,
    absences = [],
    existingPlacements = [],
    allowOverflow = false,
  } = input;

  if (!Number.isInteger(workingDays) || workingDays < 1) {
    return { ok: false, reason: 'invalid', message: 'workingDays must be at least 1' };
  }
  if (!Number.isInteger(maxWorkingDaysPerSprint) || maxWorkingDaysPerSprint < 1) {
    return { ok: false, reason: 'invalid', message: 'maxWorkingDaysPerSprint must be at least 1' };
  }
  if (startSprintWeek !== 1 && startSprintWeek !== 2) {
    return { ok: false, reason: 'invalid', message: 'startSprintWeek must be 1 or 2' };
  }

  const slots = assignmentSlots(input.sprints, startSprintNumber, startSprintWeek, absences);
  if (!slots) {
    return { ok: false, reason: 'invalid', message: 'Project has no sprint with that number' };
  }

  const painted = paintAssignmentWeeks(workingDays, maxWorkingDaysPerSprint, slots, {
    dumpRemainder: allowOverflow,
  });
  if (!allowOverflow && painted.daysLeft > 0) {
    return {
      ok: false,
      reason: 'overflow',
      message: pastLastSprintMessage(painted.daysLeft),
    };
  }

  const occupied = new Set(painted.weeks.filter((week) => week.days > 0).map(weekKey));
  for (const existing of existingPlacements) {
    const existingSlots = assignmentSlots(
      input.sprints,
      existing.startSprintNumber,
      existing.startSprintWeek,
      absences,
    );
    if (!existingSlots) continue;
    const existingPaint = paintAssignmentWeeks(
      existing.workingDays,
      maxWorkingDaysPerSprint,
      existingSlots,
      { dumpRemainder: true },
    );
    const overlaps = existingPaint.weeks.some(
      (week) => week.days > 0 && occupied.has(weekKey(week)),
    );
    if (overlaps) {
      return { ok: false, reason: 'overlap', message: DUPLICATE_SPRINT_ASSIGNMENT_MESSAGE };
    }
  }

  return { ok: true, weeks: painted.weeks.filter((week) => week.days > 0) };
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
