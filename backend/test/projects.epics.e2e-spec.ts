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
    await prisma.sprint.deleteMany();
    await prisma.projectParticipant.deleteMany();
    await prisma.project.deleteMany();
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
      .send({ assigneeId, startSprintNumber: 1, startSprintWeek: 1 })
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
      .send({ assigneeId, startSprintNumber: 1, startSprintWeek: 1 })
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
});
