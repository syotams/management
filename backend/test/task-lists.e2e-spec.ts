import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetTestDatabase, seedTaskListUsers } from './test-utils';

describe('Task lists (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;

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
    await prisma.taskPlacement.deleteMany();
    await prisma.taskList.deleteMany();
    await prisma.taskAuditLog.deleteMany();
    await prisma.task.deleteMany();
    await prisma.epicAssignment.deleteMany();
    await prisma.epic.deleteMany();
    await prisma.projectVersion.deleteMany();
    await prisma.sprint.deleteMany();
    await prisma.projectParticipant.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    await seedTaskListUsers(prisma);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'alice@test.com', password: 'password123' })
      .expect(201);
    token = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object) =>
      request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object) =>
      request(app.getHttpServer()).patch(url).set('Authorization', `Bearer ${token}`).send(body),
    delete: (url: string) => request(app.getHttpServer()).delete(url).set('Authorization', `Bearer ${token}`),
  });

  it('supports the full list lifecycle', async () => {
    const initial = await api().get('/task-lists').expect(200);
    expect(initial.body).toHaveLength(1);
    const defaultId = initial.body[0].id;

    const work = await api().post('/task-lists', { name: '  Work  ' }).expect(201);
    expect(work.body.name).toBe('Work');

    const task = await api().post('/tasks', { title: 'Ship it', listId: work.body.id }).expect(201);
    expect(task.body.listId).toBe(work.body.id);
    await api().post('/tasks', { title: 'Inbox item' }).expect(201);

    const workTasks = await api().get(`/tasks?listId=${work.body.id}`).expect(200);
    expect(workTasks.body.map((t: { title: string }) => t.title)).toEqual(['Ship it']);
    const defaultTasks = await api().get(`/tasks?listId=${defaultId}`).expect(200);
    expect(defaultTasks.body.map((t: { title: string }) => t.title)).toEqual(['Inbox item']);
    const all = await api().get('/tasks').expect(200);
    expect(all.body).toHaveLength(2);

    await api().patch(`/task-lists/${work.body.id}`, { name: 'Deep work' }).expect(200);

    const blocked = await api().delete(`/task-lists/${work.body.id}`).expect(409);
    expect(blocked.body.taskCount).toBe(1);

    await api().delete(`/task-lists/${work.body.id}?moveTo=${defaultId}`).expect(200);
    const lists = await api().get('/task-lists').expect(200);
    expect(lists.body).toHaveLength(1);
    expect(lists.body[0].taskCount).toBe(2);

    await api().delete(`/task-lists/${defaultId}`).expect(409);
  });

  it('moves a task between lists', async () => {
    const work = await api().post('/task-lists', { name: 'Work' }).expect(201);
    const task = await api().post('/tasks', { title: 'Move me' }).expect(201);

    await api().patch(`/tasks/${task.body.id}/list`, { listId: work.body.id }).expect(200);

    const detail = await api().get(`/tasks/${task.body.id}`).expect(200);
    expect(detail.body.listId).toBe(work.body.id);
  });

  it("rejects another user's list", async () => {
    const bob = await prisma.user.findUniqueOrThrow({ where: { email: 'bob@test.com' } });
    const bobList = await prisma.taskList.create({ data: { userId: bob.id, name: 'Bob list' } });
    await api().post('/tasks', { title: 'Nope', listId: bobList.id }).expect(404);
    await api().patch(`/task-lists/${bobList.id}`, { name: 'Mine' }).expect(404);
  });
});
