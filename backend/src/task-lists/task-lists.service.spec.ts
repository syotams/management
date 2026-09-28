import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_TASK_LIST_NAME, TaskListsService } from './task-lists.service';
import { resetTestDatabase, seedTaskListUsers } from '../../test/test-utils';

describe('TaskListsService', () => {
  let prisma: PrismaClient;
  let service: TaskListsService;
  let aliceId: string;
  let bobId: string;

  beforeAll(() => {
    resetTestDatabase('test-task-lists');
  });

  beforeEach(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    await prisma.taskPlacement.deleteMany();
    await prisma.taskList.deleteMany();
    await prisma.task.deleteMany();
    await prisma.user.deleteMany();

    const users = await seedTaskListUsers(prisma);
    aliceId = users.alice.id;
    bobId = users.bob.id;
    service = new TaskListsService(prisma as unknown as PrismaService);
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  async function createTask(ownerId: string, assigneeId = ownerId, status = 'todo') {
    const now = new Date();
    return prisma.task.create({
      data: {
        title: 'Task',
        dueDate: now,
        alertAt: now,
        ownerId,
        assigneeId,
        createdBy: ownerId,
        status,
      },
    });
  }

  it('lazily creates a single default list', async () => {
    const [first, second] = await Promise.all([service.findAll(aliceId), service.findAll(aliceId)]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]!.name).toBe(DEFAULT_TASK_LIST_NAME);
    expect(await prisma.taskList.count({ where: { userId: aliceId } })).toBe(1);
  });

  it('counts unplaced open tasks in the default list', async () => {
    await createTask(aliceId);
    await createTask(bobId, aliceId);
    await createTask(aliceId, aliceId, 'completed');
    const lists = await service.findAll(aliceId);
    expect(lists[0]!.taskCount).toBe(2);
  });

  it('rejects duplicate names', async () => {
    await service.create(aliceId, 'Work');
    await expect(service.create(aliceId, 'Work')).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks deleting the last list', async () => {
    const [only] = await service.ensureLists(aliceId);
    await expect(service.remove(aliceId, only!.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes an empty list without a target', async () => {
    const work = await service.create(aliceId, 'Work');
    await service.remove(aliceId, work.id);
    expect(await prisma.taskList.count({ where: { userId: aliceId } })).toBe(1);
  });

  it('requires a valid moveTo when the list has tasks', async () => {
    const work = await service.create(aliceId, 'Work');
    const task = await createTask(aliceId);
    await prisma.taskPlacement.create({ data: { taskId: task.id, userId: aliceId, listId: work.id } });

    await expect(service.remove(aliceId, work.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.remove(aliceId, work.id, work.id)).rejects.toBeInstanceOf(BadRequestException);

    const home = await service.create(aliceId, 'Home');
    await service.remove(aliceId, work.id, home.id);
    const placement = await prisma.taskPlacement.findUniqueOrThrow({
      where: { taskId_userId: { taskId: task.id, userId: aliceId } },
    });
    expect(placement.listId).toBe(home.id);
  });

  it('moves unplaced tasks when the default list is deleted', async () => {
    const [defaultList] = await service.ensureLists(aliceId);
    const work = await service.create(aliceId, 'Work');
    const task = await createTask(bobId, aliceId);

    await service.remove(aliceId, defaultList!.id, work.id);

    const placement = await prisma.taskPlacement.findUniqueOrThrow({
      where: { taskId_userId: { taskId: task.id, userId: aliceId } },
    });
    expect(placement.listId).toBe(work.id);
    const lists = await service.findAll(aliceId);
    expect(lists.map((l) => l.id)).toEqual([work.id]);
    expect(lists[0]!.taskCount).toBe(1);
  });

  it("does not touch another user's placements", async () => {
    const task = await createTask(aliceId, bobId);
    const [bobDefault] = await service.ensureLists(bobId);
    const bobOther = await service.create(bobId, 'Other');
    await prisma.taskPlacement.create({ data: { taskId: task.id, userId: bobId, listId: bobOther.id } });

    const aliceWork = await service.create(aliceId, 'Work');
    const [aliceDefault] = await service.ensureLists(aliceId);
    await service.remove(aliceId, aliceDefault!.id, aliceWork.id);

    const bobPlacement = await prisma.taskPlacement.findUniqueOrThrow({
      where: { taskId_userId: { taskId: task.id, userId: bobId } },
    });
    expect(bobPlacement.listId).toBe(bobOther.id);
    expect(bobDefault).toBeDefined();
  });
});
