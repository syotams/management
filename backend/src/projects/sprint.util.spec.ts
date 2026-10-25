import {
  addUtcDays,
  countInclusiveDays,
  DUPLICATE_SPRINT_ASSIGNMENT_MESSAGE,
  generateSprints,
  planAssignmentSpan,
  sprintsUsedByAssignment,
  sprintWeekRange,
  weekCapacity,
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

describe('countInclusiveDays', () => {
  it('counts the end date, so 1 Nov through 3 Nov is 3 days', () => {
    const start = new Date(Date.UTC(2026, 10, 1));
    const end = new Date(Date.UTC(2026, 10, 3));
    expect(countInclusiveDays(start, end)).toBe(3);
  });
});

describe('weekCapacity', () => {
  it('removes every PTO day in the range, including the weekend and the end date', () => {
    const sprint = {
      number: 1,
      startDate: new Date(Date.UTC(2026, 9, 24)),
      endDate: new Date(Date.UTC(2026, 10, 6)),
    };
    const pto = {
      startDate: new Date(Date.UTC(2026, 10, 1)),
      endDate: new Date(Date.UTC(2026, 10, 3)),
    };

    expect(weekCapacity(sprint, 2, [])).toBe(5);
    expect(weekCapacity(sprint, 2, [pto])).toBe(2);
  });
});

describe('sprintsUsedByAssignment', () => {
  it('counts two sprints for 15 days at a cap of 8', () => {
    expect(
      sprintsUsedByAssignment({
        workingDays: 15,
        maxWorkingDaysPerSprint: 8,
        startSprintNumber: 1,
        startSprintWeek: 1,
        sprints: sprints(3),
      }),
    ).toBe(2);
  });

  it('counts more than two sprints when a third sprint is required', () => {
    expect(
      sprintsUsedByAssignment({
        workingDays: 17,
        maxWorkingDaysPerSprint: 8,
        startSprintNumber: 1,
        startSprintWeek: 1,
        sprints: sprints(3),
      }),
    ).toBe(3);
  });
});

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
          { workingDays: 2, startSprintNumber: 2, startSprintWeek: 1 },
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

  it('skips a later week once that sprint cap is already full', () => {
    expect(
      plan({
        workingDays: 1,
        startSprintWeek: 2,
        existingPlacements: [
          { workingDays: 8, startSprintNumber: 1, startSprintWeek: 1 },
        ],
      }),
    ).toEqual({
      ok: true,
      weeks: [{ sprintNumber: 2, week: 1, days: 1 }],
    });
  });

  it('paints 15 days at a cap of 8 across two empty sprints', () => {
    expect(plan({ workingDays: 15 })).toEqual({
      ok: true,
      weeks: [
        { sprintNumber: 1, week: 1, days: 5 },
        { sprintNumber: 1, week: 2, days: 3 },
        { sprintNumber: 2, week: 1, days: 5 },
        { sprintNumber: 2, week: 2, days: 2 },
      ],
    });
  });

  it('uses the 3 days left after 5 days are already painted in the sprint', () => {
    expect(
      plan({
        workingDays: 6,
        priorAssignments: [
          { workingDays: 5, startSprintNumber: 1, startSprintWeek: 1 },
        ],
      }),
    ).toEqual({
      ok: true,
      weeks: [
        { sprintNumber: 1, week: 2, days: 3 },
        { sprintNumber: 2, week: 1, days: 3 },
      ],
    });
  });

  it('skips a sprint that has no cap left and paints the next sprint', () => {
    expect(
      plan({
        workingDays: 4,
        priorAssignments: [
          { workingDays: 8, startSprintNumber: 1, startSprintWeek: 1 },
        ],
      }),
    ).toEqual({
      ok: true,
      weeks: [{ sprintNumber: 2, week: 1, days: 4 }],
    });
  });

  it('rejects an assign whose remainder runs past the last sprint', () => {
    expect(
      plan({
        workingDays: 1,
        sprints: sprints(1),
        priorAssignments: [
          { workingDays: 8, startSprintNumber: 1, startSprintWeek: 1 },
        ],
      }),
    ).toEqual({
      ok: false,
      reason: 'overflow',
      message:
        'Not enough sprint capacity to assign this epic. 1 working day would extend past the last sprint.',
    });
  });
});
