import {
  addUtcDays,
  DUPLICATE_SPRINT_ASSIGNMENT_MESSAGE,
  generateSprints,
  planAssignmentSpan,
  sprintWeekRange,
} from './sprint.util';

function sprints(count: number) {
  const start = new Date(Date.UTC(2026, 0, 5));
  return generateSprints(start, addUtcDays(start, count * 14 - 1));
}

function plan(
  overrides: Partial<Parameters<typeof planAssignmentSpan>[0]> & { workingDays: number },
) {
  return planAssignmentSpan({
    maxWorkingDaysPerSprint: 8,
    startSprintNumber: 1,
    startSprintWeek: 1,
    sprints: sprints(3),
    ...overrides,
  });
}

describe('planAssignmentSpan', () => {
  it('keeps an epic that fits under the cap in the first sprint', () => {
    expect(plan({ workingDays: 5 })).toEqual({
      ok: true,
      weeks: [{ sprintNumber: 1, week: 1, days: 5 }],
    });
  });

  it('paints 25 days at a cap of 8 across later sprints', () => {
    expect(
      plan({
        workingDays: 25,
        sprints: sprints(4),
      }),
    ).toEqual({
      ok: true,
      weeks: [
        { sprintNumber: 1, week: 1, days: 5 },
        { sprintNumber: 1, week: 2, days: 3 },
        { sprintNumber: 2, week: 1, days: 5 },
        { sprintNumber: 2, week: 2, days: 3 },
        { sprintNumber: 3, week: 1, days: 5 },
        { sprintNumber: 3, week: 2, days: 3 },
        { sprintNumber: 4, week: 1, days: 1 },
      ],
    });
  });

  it('uses only the 5 weekdays of week 2 when the drop starts there', () => {
    expect(
      plan({
        workingDays: 9,
        startSprintWeek: 2,
        sprints: sprints(2),
      }),
    ).toEqual({
      ok: true,
      weeks: [
        { sprintNumber: 1, week: 2, days: 5 },
        { sprintNumber: 2, week: 1, days: 4 },
      ],
    });
  });

  it('shrinks the first sprint when PTO removes weekdays below the cap', () => {
    const generated = sprints(2);
    const pto = {
      startDate: generated[0].startDate,
      endDate: addUtcDays(generated[0].startDate, 2),
    };

    expect(
      plan({
        workingDays: 10,
        sprints: generated,
        absences: [pto],
      }),
    ).toEqual({
      ok: true,
      weeks: [
        { sprintNumber: 1, week: 1, days: 2 },
        { sprintNumber: 1, week: 2, days: 5 },
        { sprintNumber: 2, week: 1, days: 3 },
      ],
    });
  });

  it('skips a holiday that blocks the rest of the sprint', () => {
    const generated = sprints(2);
    const holiday = sprintWeekRange(generated[0], 2);

    expect(
      plan({
        workingDays: 9,
        sprints: generated,
        absences: [holiday],
      }),
    ).toEqual({
      ok: true,
      weeks: [
        { sprintNumber: 1, week: 1, days: 5 },
        { sprintNumber: 2, week: 1, days: 4 },
      ],
    });
  });

  it('skips a sprint that has no free weekdays', () => {
    const generated = sprints(3);
    const blocked = generated[1];

    expect(
      plan({
        workingDays: 9,
        sprints: generated,
        absences: [{ startDate: blocked.startDate, endDate: blocked.endDate }],
      }),
    ).toEqual({
      ok: true,
      weeks: [
        { sprintNumber: 1, week: 1, days: 5 },
        { sprintNumber: 1, week: 2, days: 3 },
        { sprintNumber: 3, week: 1, days: 1 },
      ],
    });
  });

  it('fails when days remain after the last sprint', () => {
    expect(
      plan({
        workingDays: 9,
        sprints: sprints(1),
      }),
    ).toEqual({
      ok: false,
      reason: 'overflow',
      message:
        'Not enough sprint capacity to assign this epic. 1 working day would extend past the last sprint.',
    });
  });

  it('rejects a span that would paint onto a week another assignment occupies', () => {
    expect(
      plan({
        workingDays: 9,
        existingPlacements: [
          { workingDays: 5, startSprintNumber: 2, startSprintWeek: 1 },
        ],
      }),
    ).toEqual({
      ok: false,
      reason: 'overlap',
      message: DUPLICATE_SPRINT_ASSIGNMENT_MESSAGE,
    });
  });

  it('allows a later assignment that starts after the first span ends', () => {
    expect(
      plan({
        workingDays: 5,
        startSprintNumber: 3,
        existingPlacements: [
          { workingDays: 9, startSprintNumber: 1, startSprintWeek: 1 },
        ],
      }),
    ).toEqual({
      ok: true,
      weeks: [{ sprintNumber: 3, week: 1, days: 5 }],
    });
  });

  it('rejects a start on a later week of a sprint the first assignment already fills', () => {
    expect(
      plan({
        workingDays: 1,
        startSprintWeek: 2,
        existingPlacements: [
          { workingDays: 8, startSprintNumber: 1, startSprintWeek: 1 },
        ],
      }),
    ).toEqual({
      ok: false,
      reason: 'overlap',
      message: DUPLICATE_SPRINT_ASSIGNMENT_MESSAGE,
    });
  });
});
