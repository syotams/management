import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TaskList } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const DEFAULT_TASK_LIST_NAME = 'My Tasks';
const OPEN_STATUSES = ['todo', 'in_progress'];

@Injectable()
export class TaskListsService {
  constructor(private prisma: PrismaService) {}

  /** The user's lists ordered by position; creates the default list if none exist. */
  async ensureLists(userId: string): Promise<TaskList[]> {
    const lists = await this.orderedLists(userId);
    if (lists.length) return lists;
    try {
      await this.prisma.taskList.create({
        data: { userId, name: DEFAULT_TASK_LIST_NAME, position: 0 },
      });
    } catch (err) {
      if (!this.isUniqueViolation(err)) throw err;
    }
    return this.orderedLists(userId);
  }

  async getDefaultList(userId: string): Promise<TaskList> {
    const [first] = await this.ensureLists(userId);
    return first!;
  }

  async findAll(userId: string) {
    const lists = await this.ensureLists(userId);
    const defaultId = lists[0]!.id;
    const tasks = await this.prisma.task.findMany({
      where: { ...this.accessible(userId), status: { in: OPEN_STATUSES } },
      select: { placements: { where: { userId }, select: { listId: true } } },
    });
    const counts = new Map<string, number>();
    for (const task of tasks) {
      const listId = task.placements[0]?.listId ?? defaultId;
      counts.set(listId, (counts.get(listId) ?? 0) + 1);
    }
    return lists.map((list) => ({
      id: list.id,
      name: list.name,
      position: list.position,
      taskCount: counts.get(list.id) ?? 0,
    }));
  }

  async create(userId: string, name: string) {
    const lists = await this.ensureLists(userId);
    const position = Math.max(...lists.map((l) => l.position)) + 1;
    try {
      const list = await this.prisma.taskList.create({ data: { userId, name, position } });
      return { id: list.id, name: list.name, position: list.position, taskCount: 0 };
    } catch (err) {
      if (this.isUniqueViolation(err)) throw new ConflictException('A list with this name already exists');
      throw err;
    }
  }

  async rename(userId: string, listId: string, name: string) {
    await this.getOwnedList(userId, listId);
    try {
      const list = await this.prisma.taskList.update({ where: { id: listId }, data: { name } });
      return { id: list.id, name: list.name, position: list.position };
    } catch (err) {
      if (this.isUniqueViolation(err)) throw new ConflictException('A list with this name already exists');
      throw err;
    }
  }

  async remove(userId: string, listId: string, moveTo?: string) {
    const lists = await this.ensureLists(userId);
    const list = lists.find((l) => l.id === listId);
    if (!list) throw new NotFoundException('List not found');
    if (lists.length === 1) throw new ConflictException('You must keep at least one list');

    const isDefault = lists[0]!.id === listId;
    const taskIds = await this.taskIdsInList(userId, listId, isDefault);

    if (taskIds.placed.length + taskIds.unplaced.length > 0) {
      if (!moveTo) {
        throw new ConflictException({
          message: 'This list has tasks; choose a list to move them to',
          taskCount: taskIds.placed.length + taskIds.unplaced.length,
        });
      }
      if (moveTo === listId || !lists.some((l) => l.id === moveTo)) {
        throw new BadRequestException('Invalid target list');
      }
    }

    await this.prisma.$transaction([
      ...(moveTo
        ? [
            this.prisma.taskPlacement.updateMany({
              where: { userId, listId },
              data: { listId: moveTo },
            }),
            ...taskIds.unplaced.map((taskId) =>
              this.prisma.taskPlacement.create({ data: { taskId, userId, listId: moveTo } }),
            ),
          ]
        : []),
      this.prisma.taskList.delete({ where: { id: listId } }),
    ]);

    return { success: true };
  }

  /** Validates `listId` belongs to the user, falling back to their default list. */
  async resolveListId(userId: string, listId?: string | null): Promise<string> {
    if (!listId) return (await this.getDefaultList(userId)).id;
    await this.getOwnedList(userId, listId);
    return listId;
  }

  private async taskIdsInList(userId: string, listId: string, isDefault: boolean) {
    const placed = await this.prisma.taskPlacement.findMany({
      where: { userId, listId, task: this.accessible(userId) },
      select: { taskId: true },
    });
    const unplaced = isDefault
      ? await this.prisma.task.findMany({
          where: { ...this.accessible(userId), placements: { none: { userId } } },
          select: { id: true },
        })
      : [];
    return { placed: placed.map((p) => p.taskId), unplaced: unplaced.map((t) => t.id) };
  }

  private async getOwnedList(userId: string, listId: string) {
    const list = await this.prisma.taskList.findFirst({ where: { id: listId, userId } });
    if (!list) throw new NotFoundException('List not found');
    return list;
  }

  private orderedLists(userId: string) {
    return this.prisma.taskList.findMany({
      where: { userId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private accessible(userId: string): Prisma.TaskWhereInput {
    return { OR: [{ ownerId: userId }, { assigneeId: userId }] };
  }

  private isUniqueViolation(err: unknown) {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
  }
}
