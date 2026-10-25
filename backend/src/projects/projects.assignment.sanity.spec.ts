import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from './projects.service';
import { resetTestDatabase, seedEpicFixture } from '../../test/test-utils';

describe('assignment sanity', () => {
  let prisma: PrismaClient;
  let service: ProjectsService;
  let creatorId: string;
  let assigneeId: string;
  let projectId: string;

  beforeAll(() => {
    resetTestDatabase();
  });

  beforeEach(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    await prisma.epicAssignment.deleteMany();
    await prisma.epic.deleteMany();
    await prisma.projectHoliday.deleteMany();
    await prisma.projectPto.deleteMany();
    await prisma.projectVersion.deleteMany();
    await prisma.sprint.deleteMany();
    await prisma.projectParticipant.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    const fixture = await seedEpicFixture(prisma);
    creatorId = fixture.creator.id;
    assigneeId = fixture.assignee.id;
    projectId = fixture.project.id;

    service = new ProjectsService(prisma as unknown as PrismaService);
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  async function createBacklogEpic(overrides?: {
    title?: string;
    workingDays?: number;
    backgroundColor?: string;
  }) {
    return service.addEpic(projectId, creatorId, {
      title: overrides?.title ?? 'Auth',
      workingDays: overrides?.workingDays ?? 5,
      backgroundColor: overrides?.backgroundColor ?? '#4f46e5',
    });
  }

  function backlogId(detail: Awaited<ReturnType<ProjectsService['findOne']>>, title = 'Auth') {
    return detail.epics.find((epic) => !epic.sourceEpicId && epic.title === title)!.id;
  }

  function placementsFor(
    detail: Awaited<ReturnType<ProjectsService['findOne']>>,
    sourceId: string,
  ) {
    return detail.epics
      .filter((epic) => epic.sourceEpicId === sourceId)
      .map((epic) => ({
        id: epic.id,
        workingDays: epic.workingDays,
        startSprintNumber: epic.startSprintNumber,
        startSprintWeek: epic.startSprintWeek,
      }))
      .sort(
        (a, b) =>
          a.startSprintNumber! - b.startSprintNumber! ||
          a.startSprintWeek! - b.startSprintWeek!,
      );
  }

  function epicDays(
    detail: Awaited<ReturnType<ProjectsService['findOne']>>,
    userId: string,
    assignmentId: string,
  ) {
    const participant = detail.participants.find((person) => person.id === userId)!;
    return detail.sprints.flatMap((sprint) =>
      sprint.weeks
        .map((week) => ({
          sprint: sprint.number,
          week: week.week,
          days: (participant.cells[week.cellKey] ?? [])
            .filter((chip) => chip.type === 'epic' && chip.id === assignmentId)
            .reduce((sum, chip) => sum + chip.daysInSprint, 0),
        }))
        .filter((row) => row.days > 0),
    );
  }

  function epicDaysBySprint(
    detail: Awaited<ReturnType<ProjectsService['findOne']>>,
    userId: string,
    assignmentId: string,
  ) {
    const bySprint = new Map<number, number>();
    for (const row of epicDays(detail, userId, assignmentId)) {
      bySprint.set(row.sprint, (bySprint.get(row.sprint) ?? 0) + row.days);
    }
    return [...bySprint.entries()].map(([sprint, days]) => ({ sprint, days }));
  }

  it('stores a default cap of 8 and rejects a cap outside 1 through 10', async () => {
    const created = await service.create(creatorId, {
      name: 'Capped',
      startDate: '2026-04-06',
      endDate: '2026-05-03',
    });
    expect(created.maxWorkingDaysPerSprint).toBe(8);

    await expect(
      service.update(created.id, creatorId, { maxWorkingDaysPerSprint: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update(created.id, creatorId, { maxWorkingDaysPerSprint: 11 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await service.findOne(created.id, creatorId)).maxWorkingDaysPerSprint).toBe(8);
  });

  it('stores a 15-day first assign as one row and paints 8 then 7', async () => {
    const created = await createBacklogEpic({ workingDays: 15 });
    const backlog = backlogId(created);
    const assigned = await service.assignEpic(projectId, backlog, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    expect(assigned.epics.find((epic) => epic.id === backlog)!.workingDays).toBe(15);
    const placement = placementsFor(assigned, backlog);
    expect(placement).toEqual([
      expect.objectContaining({ workingDays: 15, startSprintNumber: 1, startSprintWeek: 1 }),
    ]);
    expect(epicDaysBySprint(assigned, assigneeId, placement[0].id)).toEqual([
      { sprint: 1, days: 8 },
      { sprint: 2, days: 7 },
    ]);
  });

  it('stores the chosen first-assign days and gives the next user the remainder', async () => {
    const created = await createBacklogEpic({ workingDays: 17 });
    const backlog = backlogId(created);
    const first = await service.assignEpic(projectId, backlog, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
      workingDays: 7,
    });
    expect(placementsFor(first, backlog)).toEqual([
      expect.objectContaining({ workingDays: 7, startSprintNumber: 1, startSprintWeek: 1 }),
    ]);

    const second = await service.assignEpic(projectId, backlog, creatorId, {
      assigneeId: creatorId,
      startSprintNumber: 2,
      startSprintWeek: 1,
    });
    expect(second.epics.find((epic) => epic.id === backlog)!.workingDays).toBe(17);
    expect(placementsFor(second, backlog)).toEqual([
      expect.objectContaining({ workingDays: 7, startSprintNumber: 1, startSprintWeek: 1 }),
      expect.objectContaining({ workingDays: 10, startSprintNumber: 2, startSprintWeek: 1 }),
    ]);

    await expect(
      service.assignEpic(projectId, backlog, creatorId, {
        assigneeId,
        startSprintNumber: 3,
        startSprintWeek: 2,
      }),
    ).rejects.toThrow(/no working days left/);
    expect(await prisma.epicAssignment.count()).toBe(2);
  });

  it('rejects a first-assign day count above the backlog total and writes nothing', async () => {
    const created = await createBacklogEpic({ workingDays: 17 });
    const backlog = backlogId(created);

    await expect(
      service.assignEpic(projectId, backlog, creatorId, {
        assigneeId,
        startSprintNumber: 1,
        startSprintWeek: 1,
        workingDays: 18,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.epicAssignment.count()).toBe(0);
  });

  it('keeps the other assignment when one row is edited and assigns the new remainder', async () => {
    const created = await createBacklogEpic({ workingDays: 17 });
    const backlog = backlogId(created);
    await service.assignEpic(projectId, backlog, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
      workingDays: 7,
    });
    const second = await service.assignEpic(projectId, backlog, creatorId, {
      assigneeId: creatorId,
      startSprintNumber: 2,
      startSprintWeek: 1,
    });
    const firstRow = placementsFor(second, backlog).find((row) => row.startSprintNumber === 1)!;

    const edited = await service.updateEpic(projectId, firstRow.id, creatorId, { workingDays: 4 });
    expect(placementsFor(edited, backlog)).toEqual([
      expect.objectContaining({ workingDays: 4, startSprintNumber: 1, startSprintWeek: 1 }),
      expect.objectContaining({ workingDays: 10, startSprintNumber: 2, startSprintWeek: 1 }),
    ]);

    const next = await service.assignEpic(projectId, backlog, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 2,
    });
    expect(placementsFor(next, backlog)).toEqual([
      expect.objectContaining({ workingDays: 4, startSprintNumber: 1, startSprintWeek: 1 }),
      expect.objectContaining({ workingDays: 3, startSprintNumber: 1, startSprintWeek: 2 }),
      expect.objectContaining({ workingDays: 10, startSprintNumber: 2, startSprintWeek: 1 }),
    ]);
  });

  it('keeps a later assignment of the same epic and removes both when the backlog epic is deleted', async () => {
    const created = await createBacklogEpic({ workingDays: 10 });
    const backlog = backlogId(created);
    await service.assignEpic(projectId, backlog, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
      workingDays: 4,
    });
    const again = await service.assignEpic(projectId, backlog, creatorId, {
      assigneeId,
      startSprintNumber: 3,
      startSprintWeek: 1,
    });
    const rows = placementsFor(again, backlog);
    expect(rows).toEqual([
      expect.objectContaining({ workingDays: 4, startSprintNumber: 1, startSprintWeek: 1 }),
      expect.objectContaining({ workingDays: 6, startSprintNumber: 3, startSprintWeek: 1 }),
    ]);

    const remaining = await service.deleteEpic(projectId, rows[0].id, creatorId);
    expect(placementsFor(remaining, backlog)).toEqual([
      expect.objectContaining({ id: rows[1].id, workingDays: 6, startSprintNumber: 3, startSprintWeek: 1 }),
    ]);
    expect(epicDaysBySprint(remaining, assigneeId, rows[1].id)).toEqual([{ sprint: 3, days: 6 }]);
    await service.deleteEpic(projectId, backlog, creatorId);

    const both = await createBacklogEpic({ title: 'Both', workingDays: 10 });
    const bothId = backlogId(both, 'Both');
    await service.assignEpic(projectId, bothId, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
      workingDays: 4,
    });
    await service.assignEpic(projectId, bothId, creatorId, {
      assigneeId,
      startSprintNumber: 3,
      startSprintWeek: 1,
    });
    expect(await prisma.epicAssignment.count({ where: { epicId: bothId } })).toBe(2);

    await service.deleteEpic(projectId, bothId, creatorId);
    expect(await prisma.epic.count({ where: { id: bothId } })).toBe(0);
    expect(await prisma.epicAssignment.count({ where: { epicId: bothId } })).toBe(0);
  });

  it('rejects a second assignment that would paint a week the first still occupies', async () => {
    const created = await createBacklogEpic({ workingDays: 15 });
    const backlog = backlogId(created);
    await service.assignEpic(projectId, backlog, creatorId, {
      assigneeId,
      startSprintNumber: 2,
      startSprintWeek: 1,
      workingDays: 2,
    });

    await expect(
      service.assignEpic(projectId, backlog, creatorId, {
        assigneeId,
        startSprintNumber: 1,
        startSprintWeek: 1,
      }),
    ).rejects.toThrow(/already assigned/);

    const detail = await service.findOne(projectId, creatorId);
    expect(placementsFor(detail, backlog)).toEqual([
      expect.objectContaining({ workingDays: 2, startSprintNumber: 2, startSprintWeek: 1 }),
    ]);
  });

  it('clears every painted week when the one assignment row is deleted', async () => {
    const created = await createBacklogEpic({ workingDays: 9 });
    const backlog = backlogId(created);
    const assigned = await service.assignEpic(projectId, backlog, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });
    const placement = placementsFor(assigned, backlog);
    expect(placement).toHaveLength(1);
    expect(epicDaysBySprint(assigned, assigneeId, placement[0].id)).toEqual([
      { sprint: 1, days: 8 },
      { sprint: 2, days: 1 },
    ]);

    const cleared = await service.deleteEpic(projectId, placement[0].id, creatorId);
    expect(cleared.epics.find((epic) => epic.id === backlog)!.workingDays).toBe(9);
    expect(placementsFor(cleared, backlog)).toEqual([]);
    expect(epicDaysBySprint(cleared, assigneeId, placement[0].id)).toEqual([]);
  });

  it('paints a week-2 drop from that week into the next sprint', async () => {
    const created = await createBacklogEpic({ workingDays: 9 });
    const backlog = backlogId(created);
    const assigned = await service.assignEpic(projectId, backlog, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 2,
    });

    const placement = placementsFor(assigned, backlog);
    expect(placement).toEqual([
      expect.objectContaining({ workingDays: 9, startSprintNumber: 1, startSprintWeek: 2 }),
    ]);
    expect(epicDays(assigned, assigneeId, placement[0].id)).toEqual([
      { sprint: 1, week: 2, days: 5 },
      { sprint: 2, week: 1, days: 4 },
    ]);
  });

  it('paints fewer days in a sprint when the assignee has PTO', async () => {
    await service.addPto(projectId, creatorId, {
      name: 'PTO',
      startDate: '2026-01-05',
      endDate: '2026-01-07',
      userIds: [assigneeId],
    });
    const created = await createBacklogEpic({ workingDays: 10 });
    const backlog = backlogId(created);
    const assigned = await service.assignEpic(projectId, backlog, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    const placement = placementsFor(assigned, backlog);
    expect(epicDaysBySprint(assigned, assigneeId, placement[0].id)).toEqual([
      { sprint: 1, days: 7 },
      { sprint: 2, days: 3 },
    ]);
  });

  it('skips a holiday week and continues in the next open week', async () => {
    await service.addHoliday(projectId, creatorId, {
      name: 'Holiday',
      startDate: '2026-01-12',
      endDate: '2026-01-18',
    });
    const created = await createBacklogEpic({ workingDays: 9 });
    const backlog = backlogId(created);
    const assigned = await service.assignEpic(projectId, backlog, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    const placement = placementsFor(assigned, backlog);
    expect(epicDays(assigned, assigneeId, placement[0].id)).toEqual([
      { sprint: 1, week: 1, days: 5 },
      { sprint: 2, week: 1, days: 4 },
    ]);
  });

  it('paints a later epic into the 3 days left in the sprint and the next sprint', async () => {
    const first = await createBacklogEpic({ title: 'Auth', workingDays: 5 });
    const firstId = backlogId(first);
    const firstAssigned = await service.assignEpic(projectId, firstId, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });
    const firstRow = placementsFor(firstAssigned, firstId)[0];

    const second = await createBacklogEpic({ title: 'Billing', workingDays: 6 });
    const secondId = backlogId(second, 'Billing');
    const assigned = await service.assignEpic(projectId, secondId, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    const placement = placementsFor(assigned, secondId);
    expect(placement).toEqual([
      expect.objectContaining({ workingDays: 6, startSprintNumber: 1, startSprintWeek: 1 }),
    ]);
    expect(epicDaysBySprint(assigned, assigneeId, placement[0].id)).toEqual([
      { sprint: 1, days: 3 },
      { sprint: 2, days: 3 },
    ]);
    expect(epicDaysBySprint(assigned, assigneeId, firstRow.id)).toEqual([{ sprint: 1, days: 5 }]);
  });

  it('skips a full sprint and paints the next sprint that has room', async () => {
    const first = await createBacklogEpic({ title: 'Auth', workingDays: 8 });
    await service.assignEpic(projectId, backlogId(first), creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    const second = await createBacklogEpic({ title: 'Billing', workingDays: 4 });
    const secondId = backlogId(second, 'Billing');
    const assigned = await service.assignEpic(projectId, secondId, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    const placement = placementsFor(assigned, secondId);
    expect(epicDaysBySprint(assigned, assigneeId, placement[0].id)).toEqual([{ sprint: 2, days: 4 }]);
  });

  it('shares a week that still has days and continues in the next week', async () => {
    const first = await createBacklogEpic({ title: 'Auth', workingDays: 3 });
    const firstAssigned = await service.assignEpic(projectId, backlogId(first), creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });
    const firstRow = placementsFor(firstAssigned, backlogId(first))[0];

    const second = await createBacklogEpic({ title: 'Billing', workingDays: 4 });
    const secondId = backlogId(second, 'Billing');
    const assigned = await service.assignEpic(projectId, secondId, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    expect(epicDays(assigned, assigneeId, firstRow.id)).toEqual([{ sprint: 1, week: 1, days: 3 }]);
    expect(epicDays(assigned, assigneeId, placementsFor(assigned, secondId)[0].id)).toEqual([
      { sprint: 1, week: 1, days: 2 },
      { sprint: 1, week: 2, days: 2 },
    ]);
  });

  it('rejects an epic that would pass the last sprint after the sprints are full', async () => {
    const first = await createBacklogEpic({ title: 'Auth', workingDays: 24 });
    await service.assignEpic(projectId, backlogId(first), creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    const second = await createBacklogEpic({ title: 'Billing', workingDays: 1 });
    const secondId = backlogId(second, 'Billing');
    await expect(
      service.assignEpic(projectId, secondId, creatorId, {
        assigneeId,
        startSprintNumber: 1,
        startSprintWeek: 1,
      }),
    ).rejects.toThrow(/extend past the last sprint/);

    expect(await prisma.epicAssignment.count()).toBe(1);
    expect(placementsFor(await service.findOne(projectId, creatorId), secondId)).toEqual([]);
  });

  it('repaints a stored row under a lower cap and leaves only the remaining days for the next epic', async () => {
    const created = await createBacklogEpic({ workingDays: 5 });
    const backlog = backlogId(created);
    const assigned = await service.assignEpic(projectId, backlog, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });
    const placement = placementsFor(assigned, backlog)[0];

    const updated = await service.update(projectId, creatorId, { maxWorkingDaysPerSprint: 4 });
    expect(placementsFor(updated, backlog)).toEqual([
      expect.objectContaining({
        id: placement.id,
        workingDays: 5,
        startSprintNumber: 1,
        startSprintWeek: 1,
      }),
    ]);
    expect(epicDaysBySprint(updated, assigneeId, placement.id)).toEqual([
      { sprint: 1, days: 4 },
      { sprint: 2, days: 1 },
    ]);

    const bigger = await createBacklogEpic({ title: 'Bigger', workingDays: 7 });
    const biggerId = backlogId(bigger, 'Bigger');
    const next = await service.assignEpic(projectId, biggerId, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });
    expect(epicDaysBySprint(next, assigneeId, placementsFor(next, biggerId)[0].id)).toEqual([
      { sprint: 2, days: 3 },
      { sprint: 3, days: 4 },
    ]);
  });

  it('paints a moved assignment after the user`s other work and does not count its old days', async () => {
    const blocking = await createBacklogEpic({ title: 'Block', workingDays: 8 });
    const blockingAssigned = await service.assignEpic(projectId, backlogId(blocking, 'Block'), creatorId, {
      assigneeId,
      startSprintNumber: 2,
      startSprintWeek: 1,
    });
    const blockingRow = placementsFor(blockingAssigned, backlogId(blocking, 'Block'))[0];

    const moving = await createBacklogEpic({ title: 'Move', workingDays: 5 });
    const movingId = backlogId(moving, 'Move');
    const movingAssigned = await service.assignEpic(projectId, movingId, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });
    const movingRow = placementsFor(movingAssigned, movingId)[0];

    const moved = await service.updateEpic(projectId, movingRow.id, creatorId, {
      startSprintNumber: 2,
      startSprintWeek: 1,
    });

    expect(placementsFor(moved, movingId)).toEqual([
      expect.objectContaining({
        id: movingRow.id,
        workingDays: 5,
        startSprintNumber: 2,
        startSprintWeek: 1,
      }),
    ]);
    expect(epicDaysBySprint(moved, assigneeId, movingRow.id)).toEqual([{ sprint: 3, days: 5 }]);
    expect(epicDaysBySprint(moved, assigneeId, blockingRow.id)).toEqual([{ sprint: 2, days: 8 }]);
  });

  it('gives an earlier epic`s sprint days back to the later epic after it is deleted', async () => {
    const earlier = await createBacklogEpic({ title: 'Auth', workingDays: 5 });
    const earlierId = backlogId(earlier);
    await service.assignEpic(projectId, earlierId, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    const later = await createBacklogEpic({ title: 'Billing', workingDays: 6 });
    const laterId = backlogId(later, 'Billing');
    const assigned = await service.assignEpic(projectId, laterId, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });
    const laterRow = placementsFor(assigned, laterId)[0];
    expect(epicDaysBySprint(assigned, assigneeId, laterRow.id)).toEqual([
      { sprint: 1, days: 3 },
      { sprint: 2, days: 3 },
    ]);

    const freed = await service.deleteEpic(projectId, earlierId, creatorId);
    expect(epicDaysBySprint(freed, assigneeId, laterRow.id)).toEqual([{ sprint: 1, days: 6 }]);
  });

  it('writes nothing when a scheduled epic is created for two assignees', async () => {
    await expect(
      service.addEpic(projectId, creatorId, {
        title: 'Shared',
        workingDays: 15,
        backgroundColor: '#4f46e5',
        assigneeIds: [assigneeId, creatorId],
        startSprintNumber: 1,
        startSprintWeek: 1,
      }),
    ).rejects.toThrow(/no working days left/);

    expect(await prisma.epic.count({ where: { projectId } })).toBe(0);
    expect(await prisma.epicAssignment.count()).toBe(0);
  });
});
