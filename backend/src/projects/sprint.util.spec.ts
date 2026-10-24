import {
  addUtcDays,
  DUPLICATE_SPRINT_ASSIGNMENT_MESSAGE,
  generateSprints,
  splitEpicAcrossSprints,
  sprintWeekRange,
} from './sprint.util';

function sprints(count: number) {
  const start = new Date(Date.UTC(2026, 0, 5));
  return generateSprints(start, addUtcDays(start, count * 14 - 1));
}

describe('splitEpicAcrossSprints', () => {
  it('keeps an epic that fits under the cap in one sprint', () => {
    expect(
      splitEpicAcrossSprints({
        workingDays: 5,
        maxWorkingDaysPerSprint: 8,
        startSprintNumber: 1,
        startSprintWeek: 1,
        sprints: sprints(3),
      }),
    ).toEqual({
      ok: true,
      chunks: [{ startSprintNumber: 1, startSprintWeek: 1, workingDays: 5 }],
    });
  });

  it('splits 25 days at a cap of 8 across later sprints', () => {
    expect(
      splitEpicAcrossSprints({
        workingDays: 25,
        maxWorkingDaysPerSprint: 8,
        startSprintNumber: 1,
        startSprintWeek: 1,
        sprints: sprints(4),
      }),
    ).toEqual({
      ok: true,
      chunks: [
        { startSprintNumber: 1, startSprintWeek: 1, workingDays: 8 },
        { startSprintNumber: 2, startSprintWeek: 1, workingDays: 8 },
        { startSprintNumber: 3, startSprintWeek: 1, workingDays: 8 },
        { startSprintNumber: 4, startSprintWeek: 1, workingDays: 1 },
      ],
    });
  });

  it('uses only the 5 weekdays of week 2 when the drop starts there', () => {
    expect(
      splitEpicAcrossSprints({
        workingDays: 9,
        maxWorkingDaysPerSprint: 8,
        startSprintNumber: 1,
        startSprintWeek: 2,
        sprints: sprints(2),
      }),
    ).toEqual({
      ok: true,
      chunks: [
        { startSprintNumber: 1, startSprintWeek: 2, workingDays: 5 },
        { startSprintNumber: 2, startSprintWeek: 1, workingDays: 4 },
      ],
    });
  });

  it('shrinks a chunk when PTO removes weekdays below the cap', () => {
    const generated = sprints(2);
    const pto = {
      startDate: generated[0].startDate,
      endDate: addUtcDays(generated[0].startDate, 2),
    };

    expect(
      splitEpicAcrossSprints({
        workingDays: 10,
        maxWorkingDaysPerSprint: 8,
        startSprintNumber: 1,
        startSprintWeek: 1,
        sprints: generated,
        absences: [pto],
      }),
    ).toEqual({
      ok: true,
      chunks: [
        { startSprintNumber: 1, startSprintWeek: 1, workingDays: 7 },
        { startSprintNumber: 2, startSprintWeek: 1, workingDays: 3 },
      ],
    });
  });

  it('shrinks a chunk when a holiday blocks the rest of the sprint', () => {
    const generated = sprints(2);
    const holiday = sprintWeekRange(generated[0], 2);

    expect(
      splitEpicAcrossSprints({
        workingDays: 9,
        maxWorkingDaysPerSprint: 8,
        startSprintNumber: 1,
        startSprintWeek: 1,
        sprints: generated,
        absences: [holiday],
      }),
    ).toEqual({
      ok: true,
      chunks: [
        { startSprintNumber: 1, startSprintWeek: 1, workingDays: 5 },
        { startSprintNumber: 2, startSprintWeek: 1, workingDays: 4 },
      ],
    });
  });

  it('skips a sprint that has no free weekdays', () => {
    const generated = sprints(3);
    const blocked = generated[1];

    expect(
      splitEpicAcrossSprints({
        workingDays: 9,
        maxWorkingDaysPerSprint: 8,
        startSprintNumber: 1,
        startSprintWeek: 1,
        sprints: generated,
        absences: [{ startDate: blocked.startDate, endDate: blocked.endDate }],
      }),
    ).toEqual({
      ok: true,
      chunks: [
        { startSprintNumber: 1, startSprintWeek: 1, workingDays: 8 },
        { startSprintNumber: 3, startSprintWeek: 1, workingDays: 1 },
      ],
    });
  });

  it('fails with no chunks when days remain after the last sprint', () => {
    expect(
      splitEpicAcrossSprints({
        workingDays: 9,
        maxWorkingDaysPerSprint: 8,
        startSprintNumber: 1,
        startSprintWeek: 1,
        sprints: sprints(1),
      }),
    ).toEqual({
      ok: false,
      message:
        'Not enough sprint capacity to assign this epic. 1 working day would extend past the last sprint.',
    });
  });

  it('rejects the whole split when a later chunk would duplicate a placement', () => {
    expect(
      splitEpicAcrossSprints({
        workingDays: 9,
        maxWorkingDaysPerSprint: 8,
        startSprintNumber: 1,
        startSprintWeek: 1,
        sprints: sprints(3),
        existingPlacements: [{ startSprintNumber: 2, startSprintWeek: 1 }],
      }),
    ).toEqual({
      ok: false,
      message: DUPLICATE_SPRINT_ASSIGNMENT_MESSAGE,
    });
  });
});
