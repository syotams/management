import {
  addUtcDays,
  countInclusiveDays,
  countWeekdays,
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

function overlapsProjectEnd(sprint: { startDate: Date; endDate: Date }, projectEnd: Date) {
  return (
    sprint.startDate.getTime() <= projectEnd.getTime() &&
    sprint.endDate.getTime() > projectEnd.getTime()
  );
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

describe('generateSprints', () => {
  it('keeps a sprint that ends on the project end date', () => {
    const start = new Date(Date.UTC(2026, 0, 5));
    const end = addUtcDays(start, 13);

    expect(generateSprints(start, end)).toEqual([
      { number: 1, startDate: start, endDate: end },
    ]);
  });

  it('omits a last sprint that runs past the suggested end date', () => {
    const start = new Date(Date.UTC(2026, 10, 4));
    const end = new Date(Date.UTC(2027, 0, 31));

    const generated = generateSprints(start, end);

    expect(generated).toHaveLength(6);
    expect(generated[0]).toEqual({
      number: 1,
      startDate: new Date(Date.UTC(2026, 10, 4)),
      endDate: new Date(Date.UTC(2026, 10, 17)),
    });
    expect(generated[5]).toEqual({
      number: 6,
      startDate: new Date(Date.UTC(2027, 0, 13)),
      endDate: new Date(Date.UTC(2027, 0, 26)),
    });
  });

  it('keeps the last sprint when the end date is that sprint end', () => {
    const start = new Date(Date.UTC(2026, 10, 4));
    const end = new Date(Date.UTC(2027, 1, 9));

    const generated = generateSprints(start, end);

    expect(generated).toHaveLength(7);
    expect(generated[6]).toEqual({
      number: 7,
      startDate: new Date(Date.UTC(2027, 0, 27)),
      endDate: end,
    });
  });

  it('omits the last sprint when the end date falls inside it', () => {
    const start = new Date(Date.UTC(2026, 10, 4));
    const end = new Date(Date.UTC(2027, 1, 8));

    const generated = generateSprints(start, end);

    expect(generated).toHaveLength(6);
    expect(generated[5].endDate).toEqual(new Date(Date.UTC(2027, 0, 26)));
  });

  it('creates no sprints when the range is shorter than one sprint', () => {
    const start = new Date(Date.UTC(2026, 10, 4));
    const end = new Date(Date.UTC(2026, 10, 10));

    expect(generateSprints(start, end)).toEqual([]);
  });

  it('does not create a last sprint that overlaps the project end date', () => {
    const start = new Date(Date.UTC(2026, 10, 4));
    const projectEnds = [
      new Date(Date.UTC(2027, 0, 31)),
      new Date(Date.UTC(2027, 0, 20)),
      new Date(Date.UTC(2026, 10, 18)),
    ];

    for (const projectEnd of projectEnds) {
      const generated = generateSprints(start, projectEnd);
      const last = generated[generated.length - 1];

      expect(last).toBeDefined();
      expect(generated.some((sprint) => overlapsProjectEnd(sprint, projectEnd))).toBe(false);
      expect(last!.endDate.getTime()).toBeLessThanOrEqual(projectEnd.getTime());
      expect(last!.endDate).toEqual(addUtcDays(last!.startDate, 13));
    }
  });

  it('keeps 14 calendar days when a sprint starts on Sunday and ends on Saturday', () => {
    const start = new Date(Date.UTC(2026, 10, 1));
    const end = addUtcDays(start, 13);

    expect(start.getUTCDay()).toBe(0);
    expect(end.getUTCDay()).toBe(6);

    const [sprint] = generateSprints(start, end);

    expect(sprint).toEqual({ number: 1, startDate: start, endDate: end });
    expect(countWeekdays(sprint.startDate, sprint.endDate)).toBe(10);
    expect(sprintWeekRange(sprint, 1)).toEqual({
      startDate: start,
      endDate: addUtcDays(start, 6),
    });
    expect(sprintWeekRange(sprint, 2)).toEqual({
      startDate: addUtcDays(start, 7),
      endDate: end,
    });
  });
});

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
