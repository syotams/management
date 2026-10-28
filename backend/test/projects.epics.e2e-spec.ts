import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetTestDatabase, seedEpicFixture } from './test-utils';

describe('Projects epics (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let creatorId: string;
  let assigneeId: string;
  let projectId: string;

  beforeAll(async () => {
    resetTestDatabase();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.epicAssignment.deleteMany();
    await prisma.epic.deleteMany();
    await prisma.projectVersion.deleteMany();
    await prisma.projectHoliday.deleteMany();
    await prisma.projectPto.deleteMany();
    await prisma.sprint.deleteMany();
    await prisma.projectParticipant.deleteMany();
    await prisma.projectTeam.deleteMany();
    await prisma.project.deleteMany();
    await prisma.teamInvite.deleteMany();
    await prisma.teamMember.deleteMany();
    await prisma.team.deleteMany();
    await prisma.user.deleteMany();

    const fixture = await seedEpicFixture(prisma);
    creatorId = fixture.creator.id;
    assigneeId = fixture.assignee.id;
    projectId = fixture.project.id;

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'creator@test.com', password: 'password123' })
      .expect(201);

    token = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createBacklog() {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/epics`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Auth',
        workingDays: 5,
        backgroundColor: '#4f46e5',
      })
      .expect(201);
    return res.body.epics.find((e: { sourceEpicId: string | null }) => !e.sourceEpicId);
  }

  it('creates backlog-only epic', async () => {
    const backlog = await createBacklog();
    expect(backlog).toMatchObject({
      title: 'Auth',
      sourceEpicId: null,
      startSprintNumber: null,
      assignees: [],
    });
    expect(await prisma.epic.count()).toBe(1);
    expect(await prisma.epicAssignment.count()).toBe(0);
  });

  it('assigns same user twice in different sprints and shares title/color', async () => {
    const backlog = await createBacklog();

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/epics/${backlog.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigneeId, startSprintNumber: 1, startSprintWeek: 1, workingDays: 2 })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/projects/${projectId}/epics/${backlog.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigneeId, startSprintNumber: 3, startSprintWeek: 1 })
      .expect(201);

    const placements = second.body.epics.filter(
      (e: { sourceEpicId: string | null }) => e.sourceEpicId === backlog.id,
    );
    expect(placements).toHaveLength(2);
    expect(placements.every((p: { title: string }) => p.title === 'Auth')).toBe(true);
    expect(placements.every((p: { backgroundColor: string }) => p.backgroundColor === '#4f46e5')).toBe(
      true,
    );
  });

  it('propagates backlog rename and recolor to assignment rows', async () => {
    const backlog = await createBacklog();
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/epics/${backlog.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigneeId, startSprintNumber: 1, startSprintWeek: 1 })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .patch(`/projects/${projectId}/epics/${backlog.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Auth v2', backgroundColor: '#22c55e' })
      .expect(200);

    const assignment = updated.body.epics.find(
      (e: { sourceEpicId: string | null }) => e.sourceEpicId === backlog.id,
    );
    expect(assignment).toMatchObject({
      title: 'Auth v2',
      backgroundColor: '#22c55e',
    });
  });

  it('updates assignment workingDays without changing backlog estimate', async () => {
    const backlog = await createBacklog();
    const assigned = await request(app.getHttpServer())
      .post(`/projects/${projectId}/epics/${backlog.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigneeId, startSprintNumber: 1, startSprintWeek: 1 })
      .expect(201);
    const assignmentId = assigned.body.epics.find(
      (e: { sourceEpicId: string | null }) => e.sourceEpicId === backlog.id,
    ).id;

    const updated = await request(app.getHttpServer())
      .patch(`/projects/${projectId}/epics/${assignmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ workingDays: 9 })
      .expect(200);

    expect(updated.body.epics.find((e: { id: string }) => e.id === backlog.id).workingDays).toBe(5);
    expect(updated.body.epics.find((e: { id: string }) => e.id === assignmentId).workingDays).toBe(9);
  });

  it('rejects same user and sprint duplicate assign', async () => {
    const backlog = await createBacklog();
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/epics/${backlog.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigneeId, startSprintNumber: 1, startSprintWeek: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/epics/${backlog.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigneeId, startSprintNumber: 1, startSprintWeek: 1 })
      .expect(400);
  });

  it('deletes assignment without removing backlog, and deletes backlog with cascade', async () => {
    const backlog = await createBacklog();
    const assigned = await request(app.getHttpServer())
      .post(`/projects/${projectId}/epics/${backlog.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigneeId, startSprintNumber: 1, startSprintWeek: 1, workingDays: 2 })
      .expect(201);
    const assignmentId = assigned.body.epics.find(
      (e: { sourceEpicId: string | null }) => e.sourceEpicId === backlog.id,
    ).id;

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/epics/${backlog.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigneeId, startSprintNumber: 2, startSprintWeek: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/projects/${projectId}/epics/${assignmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(await prisma.epic.count()).toBe(1);
    expect(await prisma.epicAssignment.count()).toBe(1);

    await request(app.getHttpServer())
      .delete(`/projects/${projectId}/epics/${backlog.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(await prisma.epic.count()).toBe(0);
    expect(await prisma.epicAssignment.count()).toBe(0);
  });

  it('copies the creator and current team members, and leaves later joiners off the plan', async () => {
    const early = await prisma.user.create({
      data: { email: 'early@test.com', name: 'Early', passwordHash: 'unused' },
    });
    const late = await prisma.user.create({
      data: { email: 'late@test.com', name: 'Late', passwordHash: 'unused' },
    });
    const joiner = await prisma.user.create({
      data: { email: 'joiner@test.com', name: 'Joiner', passwordHash: 'unused' },
    });
    const team = await prisma.team.create({
      data: {
        name: 'Platform',
        createdBy: creatorId,
        members: {
          create: [
            { userId: early.id, role: 'member', joinedAt: new Date('2026-01-01T00:00:00.000Z') },
            { userId: creatorId, role: 'owner', joinedAt: new Date('2026-01-02T00:00:00.000Z') },
            { userId: late.id, role: 'member', joinedAt: new Date('2026-01-03T00:00:00.000Z') },
          ],
        },
      },
    });
    await prisma.team.create({
      data: {
        name: 'Other',
        createdBy: creatorId,
        members: {
          create: [
            { userId: creatorId, role: 'owner' },
            { userId: assigneeId, role: 'member' },
          ],
        },
      },
    });

    const created = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Roster',
        startDate: '2026-04-06',
        endDate: '2026-05-03',
        teamIds: [team.id],
        userIds: [assigneeId],
      })
      .expect(201);

    expect(created.body.participants.map((person: { id: string }) => person.id)).toEqual([
      creatorId,
      early.id,
      late.id,
      assigneeId,
    ]);

    await prisma.teamMember.create({
      data: { teamId: team.id, userId: joiner.id, role: 'member' },
    });

    const reloaded = await request(app.getHttpServer())
      .get(`/projects/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(reloaded.body.participants.map((person: { id: string }) => person.id)).toEqual([
      creatorId,
      early.id,
      late.id,
      assigneeId,
    ]);
  });

  it('removes a participant, their project work, and lets the planner add them again', async () => {
    const member = await prisma.user.create({
      data: { email: 'member@test.com', name: 'Member', passwordHash: 'unused' },
    });
    await prisma.team.create({
      data: {
        name: 'Platform',
        createdBy: creatorId,
        members: {
          create: [
            { userId: creatorId, role: 'owner' },
            { userId: member.id, role: 'member' },
          ],
        },
      },
    });
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/participants`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: member.id })
      .expect(201);

    const backlog = await createBacklog();
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/epics/${backlog.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigneeId: member.id, startSprintNumber: 1, startSprintWeek: 1, workingDays: 2 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/pto`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'PTO', startDate: '2026-01-06', endDate: '2026-01-06', userIds: [member.id] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/holidays`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Holiday', startDate: '2026-01-07', endDate: '2026-01-07' })
      .expect(201);

    const removed = await request(app.getHttpServer())
      .delete(`/projects/${projectId}/participants/${member.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(removed.body.participants.map((person: { id: string }) => person.id)).not.toContain(member.id);
    expect(removed.body.epics.find((epic: { id: string }) => epic.id === backlog.id)).toMatchObject({
      title: 'Auth',
      assignees: [],
    });
    expect(await prisma.epicAssignment.count()).toBe(0);
    expect(await prisma.projectPto.count({ where: { userId: member.id } })).toBe(0);
    expect(await prisma.projectHoliday.count({ where: { userId: member.id } })).toBe(0);
    expect(await prisma.teamMember.count({ where: { userId: member.id } })).toBe(1);
    expect(await prisma.epic.count()).toBe(1);

    const addable = await request(app.getHttpServer())
      .get(`/projects/${projectId}/addable-participants`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(addable.body.map((person: { id: string }) => person.id)).toContain(member.id);

    const added = await request(app.getHttpServer())
      .post(`/projects/${projectId}/participants`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: member.id })
      .expect(201);
    expect(added.body.participants.map((person: { id: string }) => person.id)).toContain(member.id);
  });

  it('lets the creator remove their own row and still edit the project', async () => {
    const removed = await request(app.getHttpServer())
      .delete(`/projects/${projectId}/participants/${creatorId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(removed.body.participants.map((person: { id: string }) => person.id)).not.toContain(creatorId);
    expect(removed.body.createdBy).toBe(creatorId);

    const updated = await request(app.getHttpServer())
      .patch(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Still editable' })
      .expect(200);
    expect(updated.body.name).toBe('Still editable');
  });

  it('rejects assigning an epic to someone who is not a participant', async () => {
    const outsider = await prisma.user.create({
      data: { email: 'outsider@test.com', name: 'Outsider', passwordHash: 'unused' },
    });
    await prisma.team.create({
      data: {
        name: 'Platform',
        createdBy: creatorId,
        members: {
          create: [
            { userId: creatorId, role: 'owner' },
            { userId: outsider.id, role: 'member' },
          ],
        },
      },
    });
    const backlog = await createBacklog();

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/epics/${backlog.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigneeId: outsider.id, startSprintNumber: 1, startSprintWeek: 1 })
      .expect(400);
    expect(await prisma.epicAssignment.count()).toBe(0);
  });

  it('rejects participant removal from a non-creator and after the project leaves draft', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'assignee@test.com', password: 'password123' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/projects/${projectId}/participants/${assigneeId}`)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(403);

    await createBacklog();
    await request(app.getHttpServer())
      .patch(`/projects/${projectId}/start`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/projects/${projectId}/participants/${assigneeId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/projects/${projectId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/projects/${projectId}/participants/${assigneeId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });
});
