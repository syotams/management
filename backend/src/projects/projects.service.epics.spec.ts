import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from './projects.service';
import { resetTestDatabase, seedEpicFixture } from '../../test/test-utils';

describe('ProjectsService epic derivation', () => {
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
    await prisma.projectVersion.deleteMany();
    await prisma.sprint.deleteMany();
    await prisma.projectParticipant.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    const fixture = await seedEpicFixture(prisma);
    creatorId = fixture.creator.id;
    assigneeId = fixture.assignee.id;
    projectId = fixture.project.id;

    const prismaService = prisma as unknown as PrismaService;
    service = new ProjectsService(prismaService);
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

  it('assign creates an assignment, not a second Epic row', async () => {
    const before = await createBacklogEpic();
    const backlog = before.epics.find((e) => !e.sourceEpicId)!;

    await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    expect(await prisma.epic.count({ where: { projectId } })).toBe(1);
    expect(await prisma.epicAssignment.count()).toBe(1);

    const detail = await service.findOne(projectId, creatorId);
    const assignment = detail.epics.find((e) => e.sourceEpicId === backlog.id);
    expect(assignment).toMatchObject({
      title: 'Auth',
      backgroundColor: '#4f46e5',
      workingDays: 5,
      startSprintNumber: 1,
      assignees: [expect.objectContaining({ id: assigneeId })],
    });
  });

  it('propagates backlog title and color to assignment rows on read', async () => {
    const created = await createBacklogEpic();
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;
    await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    await service.updateEpic(projectId, backlog.id, creatorId, {
      title: 'Auth v2',
      backgroundColor: '#22c55e',
    });

    const detail = await service.findOne(projectId, creatorId);
    const assignment = detail.epics.find((e) => e.sourceEpicId === backlog.id)!;
    expect(assignment.title).toBe('Auth v2');
    expect(assignment.backgroundColor).toBe('#22c55e');
  });

  it('keeps assignment workingDays independent from backlog estimate', async () => {
    const created = await createBacklogEpic({ workingDays: 5 });
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;
    const assigned = await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });
    const assignmentId = assigned.epics.find((e) => e.sourceEpicId === backlog.id)!.id;

    await service.updateEpic(projectId, assignmentId, creatorId, { workingDays: 8 });
    await service.updateEpic(projectId, backlog.id, creatorId, { workingDays: 3 });

    const detail = await service.findOne(projectId, creatorId);
    expect(detail.epics.find((e) => e.id === backlog.id)!.workingDays).toBe(3);
    expect(detail.epics.find((e) => e.id === assignmentId)!.workingDays).toBe(8);
  });

  it('allows assigning the same epic to the same user in different sprints', async () => {
    const created = await createBacklogEpic({ workingDays: 10 });
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;

    await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
      workingDays: 4,
    });
    await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 3,
      startSprintWeek: 1,
    });

    expect(await prisma.epicAssignment.count()).toBe(2);
    const detail = await service.findOne(projectId, creatorId);
    const placements = detail.epics.filter((e) => e.sourceEpicId === backlog.id);
    expect(placements).toHaveLength(2);
    expect(placements.map((p) => p.startSprintNumber).sort()).toEqual([1, 3]);
  });

  it('rejects duplicate epic+user+sprint placement', async () => {
    const created = await createBacklogEpic();
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;
    await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    await expect(
      service.assignEpic(projectId, backlog.id, creatorId, {
        assigneeId,
        startSprintNumber: 1,
        startSprintWeek: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate epic titles within the same project', async () => {
    await createBacklogEpic({ title: 'Auth' });

    await expect(createBacklogEpic({ title: 'Auth' })).rejects.toBeInstanceOf(ConflictException);
    await expect(createBacklogEpic({ title: '  Auth  ' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('allows renaming an epic to its own title and rejects collisions', async () => {
    await createBacklogEpic({ title: 'Auth' });
    await createBacklogEpic({ title: 'Billing' });
    const detail = await service.findOne(projectId, creatorId);
    const auth = detail.epics.find((e) => !e.sourceEpicId && e.title === 'Auth')!;
    const billing = detail.epics.find((e) => !e.sourceEpicId && e.title === 'Billing')!;

    await service.updateEpic(projectId, auth.id, creatorId, { title: 'Auth' });

    await expect(
      service.updateEpic(projectId, billing.id, creatorId, { title: 'Auth' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows the same epic title in different projects', async () => {
    await createBacklogEpic({ title: 'Auth' });

    const other = await prisma.project.create({
      data: {
        name: 'Other',
        startDate: new Date('2026-01-05'),
        endDate: new Date('2026-03-27'),
        status: 'draft',
        createdBy: creatorId,
        sprints: {
          create: [
            {
              number: 1,
              startDate: new Date('2026-01-05'),
              endDate: new Date('2026-01-16'),
            },
          ],
        },
      },
    });

    await expect(
      service.addEpic(other.id, creatorId, {
        title: 'Auth',
        workingDays: 3,
        backgroundColor: '#4f46e5',
      }),
    ).resolves.toMatchObject({
      epics: expect.arrayContaining([expect.objectContaining({ title: 'Auth' })]),
    });
  });

  it('deletes only one assignment when deleting assignment id', async () => {
    const created = await createBacklogEpic({ workingDays: 10 });
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;
    await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
      workingDays: 4,
    });
    await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 2,
      startSprintWeek: 1,
    });
    const detail = await service.findOne(projectId, creatorId);
    const first = detail.epics.find(
      (e) => e.sourceEpicId === backlog.id && e.startSprintNumber === 1,
    )!;

    await service.deleteEpic(projectId, first.id, creatorId);

    expect(await prisma.epic.count({ where: { projectId } })).toBe(1);
    expect(await prisma.epicAssignment.count()).toBe(1);
  });

  it('cascades assignments when deleting backlog epic', async () => {
    const created = await createBacklogEpic();
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;
    await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    await service.deleteEpic(projectId, backlog.id, creatorId);

    expect(await prisma.epic.count({ where: { projectId } })).toBe(0);
    expect(await prisma.epicAssignment.count()).toBe(0);
  });

  it('uses derived title and color in grid chips', async () => {
    const created = await createBacklogEpic({
      title: 'Payments',
      backgroundColor: '#ef4444',
    });
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;
    await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });
    await service.updateEpic(projectId, backlog.id, creatorId, {
      title: 'Billing',
      backgroundColor: '#0ea5e9',
    });

    const detail = await service.findOne(projectId, creatorId);
    const chips = Object.values(detail.participants.find((p) => p.id === assigneeId)!.cells)
      .flat()
      .filter((c) => c.type === 'epic');
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.every((c) => c.title === 'Billing' && c.backgroundColor === '#0ea5e9')).toBe(
      true,
    );
  });

  function placementsFor(
    detail: Awaited<ReturnType<ProjectsService['findOne']>>,
    backlogId: string,
  ) {
    return detail.epics
      .filter((epic) => epic.sourceEpicId === backlogId)
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

  function epicDaysBySprint(
    detail: Awaited<ReturnType<ProjectsService['findOne']>>,
    userId: string,
    assignmentId: string,
  ) {
    const participant = detail.participants.find((person) => person.id === userId)!;
    return detail.sprints
      .map((sprint) => ({
        sprint: sprint.number,
        days: sprint.weeks.reduce((sum, week) => {
          const chips = participant.cells[week.cellKey] ?? [];
          return (
            sum +
            chips
              .filter((chip) => chip.type === 'epic' && chip.id === assignmentId)
              .reduce((chipSum, chip) => chipSum + chip.daysInSprint, 0)
          );
        }, 0),
      }))
      .filter((row) => row.days > 0);
  }

  it('keeps a 5-day assign as one assignment on the default cap of 8', async () => {
    const detail = await service.findOne(projectId, creatorId);
    expect(detail.maxWorkingDaysPerSprint).toBe(8);

    const created = await createBacklogEpic({ workingDays: 5 });
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;
    const assigned = await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    expect(await prisma.epicAssignment.count()).toBe(1);
    expect(assigned.epics.find((e) => e.id === backlog.id)!.workingDays).toBe(5);
    expect(placementsFor(assigned, backlog.id)).toEqual([
      expect.objectContaining({ workingDays: 5, startSprintNumber: 1, startSprintWeek: 1 }),
    ]);
  });

  it('keeps a 9-day epic as one assignment painted across two sprints', async () => {
    const created = await createBacklogEpic({ workingDays: 9 });
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;

    const assigned = await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    expect(await prisma.epic.count({ where: { projectId } })).toBe(1);
    expect(await prisma.epicAssignment.count()).toBe(1);
    expect(assigned.epics.find((e) => e.id === backlog.id)!.workingDays).toBe(9);
    const placement = placementsFor(assigned, backlog.id);
    expect(placement).toEqual([
      expect.objectContaining({ workingDays: 9, startSprintNumber: 1, startSprintWeek: 1 }),
    ]);
    expect(epicDaysBySprint(assigned, assigneeId, placement[0].id)).toEqual([
      { sprint: 1, days: 8 },
      { sprint: 2, days: 1 },
    ]);

    const cleared = await service.deleteEpic(projectId, placement[0].id, creatorId);
    expect(await prisma.epicAssignment.count()).toBe(0);
    expect(cleared.epics.find((e) => e.id === backlog.id)!.workingDays).toBe(9);
    expect(epicDaysBySprint(cleared, assigneeId, placement[0].id)).toEqual([]);
  });

  it('keeps a second assign of the same epic as its own row', async () => {
    const created = await createBacklogEpic({ workingDays: 9 });
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;
    await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
      workingDays: 4,
    });

    const again = await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 2,
      startSprintWeek: 2,
    });

    const placements = placementsFor(again, backlog.id);
    expect(placements).toEqual([
      expect.objectContaining({ workingDays: 4, startSprintNumber: 1, startSprintWeek: 1 }),
      expect.objectContaining({ workingDays: 5, startSprintNumber: 2, startSprintWeek: 2 }),
    ]);

    const remaining = await service.deleteEpic(projectId, placements[0].id, creatorId);
    expect(placementsFor(remaining, backlog.id)).toEqual([
      expect.objectContaining({
        id: placements[1].id,
        workingDays: 5,
        startSprintNumber: 2,
        startSprintWeek: 2,
      }),
    ]);
    expect(epicDaysBySprint(remaining, assigneeId, placements[0].id)).toEqual([]);
    expect(epicDaysBySprint(remaining, assigneeId, placements[1].id)).toEqual([
      { sprint: 2, days: 5 },
    ]);
  });

  it('leaves zero assignments when the epic does not fit', async () => {
    const created = await createBacklogEpic({ workingDays: 25 });
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;

    await expect(
      service.assignEpic(projectId, backlog.id, creatorId, {
        assigneeId,
        startSprintNumber: 1,
        startSprintWeek: 1,
      }),
    ).rejects.toThrow(/extend past the last sprint/);

    expect(await prisma.epicAssignment.count()).toBe(0);
    const detail = await service.findOne(projectId, creatorId);
    expect(detail.epics.find((e) => e.id === backlog.id)!.workingDays).toBe(25);
    expect(placementsFor(detail, backlog.id)).toEqual([]);
  });

  it('starts a week-2 assign in that week and continues at week 1 of the next sprint', async () => {
    const created = await createBacklogEpic({ workingDays: 9 });
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;

    const assigned = await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 2,
    });

    const placement = placementsFor(assigned, backlog.id);
    expect(placement).toEqual([
      expect.objectContaining({ workingDays: 9, startSprintNumber: 1, startSprintWeek: 2 }),
    ]);
    expect(epicDaysBySprint(assigned, assigneeId, placement[0].id)).toEqual([
      { sprint: 1, days: 5 },
      { sprint: 2, days: 4 },
    ]);
  });

  it('counts a PTO through its end date, including weekend days', async () => {
    const detail = await service.addPto(projectId, creatorId, {
      name: 'PTO',
      startDate: '2026-01-31',
      endDate: '2026-02-02',
      userIds: [assigneeId],
    });

    const pto = detail.ptos.find((entry) => entry.userId === assigneeId);
    expect(pto?.workingDays).toBe(3);

    const participant = detail.participants.find((person) => person.id === assigneeId)!;
    const painted = Object.values(participant.cells)
      .flat()
      .filter((chip) => chip.type === 'pto')
      .reduce((sum, chip) => sum + chip.daysInSprint, 0);
    expect(painted).toBe(3);
    expect(detail.capacity.find((row) => row.userId === assigneeId)?.ptoDays).toBe(3);
  });

  it('shrinks the first chunk when the assignee has PTO in that sprint', async () => {
    await service.addPto(projectId, creatorId, {
      name: 'PTO',
      startDate: '2026-01-05',
      endDate: '2026-01-07',
      userIds: [assigneeId],
    });
    const created = await createBacklogEpic({ workingDays: 10 });
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;

    const assigned = await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    expect(assigned.epics.find((e) => e.id === backlog.id)!.workingDays).toBe(10);
    const placement = placementsFor(assigned, backlog.id);
    expect(placement).toEqual([
      expect.objectContaining({ workingDays: 10, startSprintNumber: 1, startSprintWeek: 1 }),
    ]);
    expect(epicDaysBySprint(assigned, assigneeId, placement[0].id)).toEqual([
      { sprint: 1, days: 7 },
      { sprint: 2, days: 3 },
    ]);
  });

  it('rejects a split that would duplicate a later sprint week and writes nothing new', async () => {
    const created = await createBacklogEpic({ workingDays: 15 });
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;
    await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 2,
      startSprintWeek: 1,
      workingDays: 2,
    });

    await expect(
      service.assignEpic(projectId, backlog.id, creatorId, {
        assigneeId,
        startSprintNumber: 1,
        startSprintWeek: 1,
      }),
    ).rejects.toThrow(/already assigned/);

    expect(await prisma.epicAssignment.count()).toBe(1);
    const detail = await service.findOne(projectId, creatorId);
    expect(detail.epics.find((e) => e.id === backlog.id)!.workingDays).toBe(15);
    expect(placementsFor(detail, backlog.id)).toEqual([
      expect.objectContaining({ workingDays: 2, startSprintNumber: 2, startSprintWeek: 1 }),
    ]);
  });

  it('does not re-split when an existing board chip is moved', async () => {
    const created = await createBacklogEpic({ workingDays: 5 });
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;
    const assigned = await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });
    const assignmentId = assigned.epics.find((e) => e.sourceEpicId === backlog.id)!.id;

    await service.updateEpic(projectId, assignmentId, creatorId, { workingDays: 12 });
    const moved = await service.updateEpic(projectId, assignmentId, creatorId, {
      startSprintNumber: 3,
      startSprintWeek: 2,
    });

    expect(await prisma.epic.count({ where: { projectId } })).toBe(1);
    expect(await prisma.epicAssignment.count()).toBe(1);
    expect(moved.epics.find((e) => e.id === assignmentId)).toMatchObject({
      workingDays: 12,
      startSprintNumber: 3,
      startSprintWeek: 2,
    });
  });

  it('does not rewrite existing assignments when the cap changes', async () => {
    const created = await createBacklogEpic({ workingDays: 5 });
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;
    await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    const updated = await service.update(projectId, creatorId, { maxWorkingDaysPerSprint: 4 });
    expect(updated.maxWorkingDaysPerSprint).toBe(4);
    expect(placementsFor(updated, backlog.id)).toEqual([
      expect.objectContaining({ workingDays: 5, startSprintNumber: 1, startSprintWeek: 1 }),
    ]);

    const bigger = await createBacklogEpic({ title: 'Bigger', workingDays: 7 });
    const biggerBacklog = bigger.epics.find((e) => e.title === 'Bigger' && !e.sourceEpicId)!;
    const assigned = await service.assignEpic(projectId, biggerBacklog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    expect(placementsFor(assigned, backlog.id)).toEqual([
      expect.objectContaining({ workingDays: 5, startSprintNumber: 1, startSprintWeek: 1 }),
    ]);
    const biggerPlacement = placementsFor(assigned, biggerBacklog.id);
    expect(biggerPlacement).toEqual([
      expect.objectContaining({ workingDays: 7, startSprintNumber: 1, startSprintWeek: 1 }),
    ]);
    expect(epicDaysBySprint(assigned, assigneeId, biggerPlacement[0].id)).toEqual([
      { sprint: 2, days: 3 },
      { sprint: 3, days: 4 },
    ]);
  });

  it('splits a scheduled epic create and writes nothing when that split does not fit', async () => {
    const created = await service.addEpic(projectId, creatorId, {
      title: 'Scheduled',
      workingDays: 9,
      backgroundColor: '#4f46e5',
      assigneeIds: [assigneeId],
      startSprintNumber: 1,
      startSprintWeek: 1,
    });
    const backlog = created.epics.find((e) => e.title === 'Scheduled' && !e.sourceEpicId)!;
    expect(backlog.workingDays).toBe(9);
    expect(placementsFor(created, backlog.id)).toEqual([
      expect.objectContaining({ workingDays: 9, startSprintNumber: 1, startSprintWeek: 1 }),
    ]);

    await expect(
      service.addEpic(projectId, creatorId, {
        title: 'Too big',
        workingDays: 25,
        backgroundColor: '#4f46e5',
        assigneeIds: [assigneeId],
        startSprintNumber: 1,
        startSprintWeek: 1,
      }),
    ).rejects.toThrow(/extend past the last sprint/);

    expect(await prisma.epic.count({ where: { title: 'Too big' } })).toBe(0);
    expect(await prisma.epicAssignment.count()).toBe(1);
  });

  it('stores the cap on create, update, and detail, and rejects values outside 1-10', async () => {
    const created = await service.create(creatorId, {
      name: 'Capped',
      startDate: '2026-04-06',
      endDate: '2026-05-03',
      maxWorkingDaysPerSprint: 4,
    });
    expect(created.maxWorkingDaysPerSprint).toBe(4);
    expect((await service.findOne(created.id, creatorId)).maxWorkingDaysPerSprint).toBe(4);

    const omitted = await service.create(creatorId, {
      name: 'Default cap',
      startDate: '2026-06-01',
      endDate: '2026-06-28',
    });
    expect(omitted.maxWorkingDaysPerSprint).toBe(8);

    await expect(
      service.create(creatorId, {
        name: 'Too high',
        startDate: '2026-07-06',
        endDate: '2026-07-19',
        maxWorkingDaysPerSprint: 11,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.project.count({ where: { name: 'Too high' } })).toBe(0);

    await expect(
      service.update(projectId, creatorId, { maxWorkingDaysPerSprint: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await service.findOne(projectId, creatorId)).maxWorkingDaysPerSprint).toBe(8);
  });

  it('stores the cap on new plan snapshots and still reads snapshots that omit it', async () => {
    await createBacklogEpic();
    await service.update(projectId, creatorId, { maxWorkingDaysPerSprint: 6 });
    await service.start(projectId, creatorId);

    const first = await prisma.projectVersion.findFirstOrThrow({
      where: { projectId },
      orderBy: { versionNumber: 'asc' },
    });
    const stored = JSON.parse(first.snapshot) as { maxWorkingDaysPerSprint?: number };
    expect(stored.maxWorkingDaysPerSprint).toBe(6);

    delete stored.maxWorkingDaysPerSprint;
    await prisma.projectVersion.update({
      where: { id: first.id },
      data: { snapshot: JSON.stringify(stored) },
    });

    await service.update(projectId, creatorId, { maxWorkingDaysPerSprint: 7 });
    const comparison = await service.compare(projectId, creatorId);
    expect(comparison.original.maxWorkingDaysPerSprint).toBe(8);
    expect(comparison.latest.maxWorkingDaysPerSprint).toBe(7);
  });

  it('assigns the full total when a first assign spans two sprints', async () => {
    const created = await createBacklogEpic({ workingDays: 15 });
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;

    const assigned = await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    expect(assigned.epics.find((e) => e.id === backlog.id)!.workingDays).toBe(15);
    expect(placementsFor(assigned, backlog.id)).toEqual([
      expect.objectContaining({ workingDays: 15, startSprintNumber: 1, startSprintWeek: 1 }),
    ]);
    expect(
      epicDaysBySprint(
        assigned,
        assigneeId,
        placementsFor(assigned, backlog.id)[0].id,
      ),
    ).toEqual([
      { sprint: 1, days: 8 },
      { sprint: 2, days: 7 },
    ]);
  });

  it('stores the chosen days on a three-sprint first assign and the remainder on the next user', async () => {
    const created = await createBacklogEpic({ workingDays: 17 });
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;

    const first = await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
      workingDays: 7,
    });
    expect(first.epics.find((e) => e.id === backlog.id)!.workingDays).toBe(17);
    expect(placementsFor(first, backlog.id)).toEqual([
      expect.objectContaining({ workingDays: 7, startSprintNumber: 1, startSprintWeek: 1 }),
    ]);

    const second = await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId: creatorId,
      startSprintNumber: 2,
      startSprintWeek: 1,
    });
    expect(second.epics.find((e) => e.id === backlog.id)!.workingDays).toBe(17);
    expect(placementsFor(second, backlog.id)).toEqual([
      expect.objectContaining({ workingDays: 7, startSprintNumber: 1, startSprintWeek: 1 }),
      expect.objectContaining({ workingDays: 10, startSprintNumber: 2, startSprintWeek: 1 }),
    ]);

    await expect(
      service.assignEpic(projectId, backlog.id, creatorId, {
        assigneeId,
        startSprintNumber: 3,
        startSprintWeek: 2,
      }),
    ).rejects.toThrow(/no working days left/);
    expect(await prisma.epicAssignment.count()).toBe(2);
  });

  it('rejects a first-assign day count outside the backlog total', async () => {
    const created = await createBacklogEpic({ workingDays: 17 });
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;

    await expect(
      service.assignEpic(projectId, backlog.id, creatorId, {
        assigneeId,
        startSprintNumber: 1,
        startSprintWeek: 1,
        workingDays: 18,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.epicAssignment.count()).toBe(0);
  });

  it('paints a later epic into the days left in the sprint and the next sprint', async () => {
    const firstEpic = await createBacklogEpic({ title: 'Auth', workingDays: 5 });
    const first = firstEpic.epics.find((epic) => !epic.sourceEpicId)!;
    await service.assignEpic(projectId, first.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    const secondEpic = await createBacklogEpic({ title: 'Billing', workingDays: 6 });
    const second = secondEpic.epics.find((epic) => epic.id !== first.id && !epic.sourceEpicId)!;
    const assigned = await service.assignEpic(projectId, second.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    expect(assigned.epics.find((epic) => epic.id === second.id)!.workingDays).toBe(6);
    const placement = placementsFor(assigned, second.id);
    expect(placement).toEqual([
      expect.objectContaining({ workingDays: 6, startSprintNumber: 1, startSprintWeek: 1 }),
    ]);
    expect(epicDaysBySprint(assigned, assigneeId, placement[0].id)).toEqual([
      { sprint: 1, days: 3 },
      { sprint: 2, days: 3 },
    ]);
  });

  it('skips a full sprint and paints the next one that has room', async () => {
    const firstEpic = await createBacklogEpic({ title: 'Auth', workingDays: 8 });
    const first = firstEpic.epics.find((epic) => !epic.sourceEpicId)!;
    await service.assignEpic(projectId, first.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    const secondEpic = await createBacklogEpic({ title: 'Billing', workingDays: 4 });
    const second = secondEpic.epics.find((epic) => epic.id !== first.id && !epic.sourceEpicId)!;
    const assigned = await service.assignEpic(projectId, second.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    const placement = placementsFor(assigned, second.id);
    expect(placement).toEqual([
      expect.objectContaining({ workingDays: 4, startSprintNumber: 1, startSprintWeek: 1 }),
    ]);
    expect(epicDaysBySprint(assigned, assigneeId, placement[0].id)).toEqual([
      { sprint: 2, days: 4 },
    ]);
  });

  it('rejects an assign that runs past the last sprint after earlier work and writes nothing', async () => {
    const firstEpic = await createBacklogEpic({ title: 'Auth', workingDays: 24 });
    const first = firstEpic.epics.find((epic) => !epic.sourceEpicId)!;
    await service.assignEpic(projectId, first.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
      startSprintWeek: 1,
    });

    const secondEpic = await createBacklogEpic({ title: 'Billing', workingDays: 1 });
    const second = secondEpic.epics.find((epic) => epic.id !== first.id && !epic.sourceEpicId)!;
    await expect(
      service.assignEpic(projectId, second.id, creatorId, {
        assigneeId,
        startSprintNumber: 1,
        startSprintWeek: 1,
      }),
    ).rejects.toThrow(/extend past the last sprint/);

    expect(await prisma.epicAssignment.count()).toBe(1);
    const detail = await service.findOne(projectId, creatorId);
    expect(detail.epics.find((epic) => epic.id === second.id)!.workingDays).toBe(1);
    expect(placementsFor(detail, second.id)).toEqual([]);
  });
});
