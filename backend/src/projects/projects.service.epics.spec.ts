import { BadRequestException } from '@nestjs/common';
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
    });
    const assignmentId = assigned.epics.find((e) => e.sourceEpicId === backlog.id)!.id;

    await service.updateEpic(projectId, assignmentId, creatorId, { workingDays: 8 });
    await service.updateEpic(projectId, backlog.id, creatorId, { workingDays: 3 });

    const detail = await service.findOne(projectId, creatorId);
    expect(detail.epics.find((e) => e.id === backlog.id)!.workingDays).toBe(3);
    expect(detail.epics.find((e) => e.id === assignmentId)!.workingDays).toBe(8);
  });

  it('allows assigning the same epic to the same user in different sprints', async () => {
    const created = await createBacklogEpic();
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;

    await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
    });
    await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 3,
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
    });

    await expect(
      service.assignEpic(projectId, backlog.id, creatorId, {
        assigneeId,
        startSprintNumber: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deletes only one assignment when deleting assignment id', async () => {
    const created = await createBacklogEpic();
    const backlog = created.epics.find((e) => !e.sourceEpicId)!;
    await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 1,
    });
    await service.assignEpic(projectId, backlog.id, creatorId, {
      assigneeId,
      startSprintNumber: 2,
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
});
