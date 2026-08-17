import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { CreateTaskDto, PostponeTaskDto, UpdateTaskDto, CreateCommentDto } from './dto/task.dto';

const userSelect = { id: true, email: true };

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async findAll(userId: string) {
    const tasks = await this.prisma.task.findMany({
      where: {
        status: { in: ['todo', 'in_progress'] },
        OR: [{ ownerId: userId }, { assigneeId: userId }],
      },
      include: {
        owner: { select: userSelect },
        assignee: { select: userSelect },
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { user: { select: userSelect } },
        },
      },
      orderBy: [{ dueDate: 'asc' }],
    });

    return tasks.map((t) => ({
      ...t,
      lastComment: t.comments[0] || null,
      comments: undefined,
    }));
  }

  async findOne(taskId: string, userId: string) {
    const task = await this.getAccessibleTask(taskId, userId);
    const comments = await this.prisma.comment.findMany({
      where: { taskId },
      include: { user: { select: userSelect } },
      orderBy: { createdAt: 'asc' },
    });
    const history = await this.prisma.taskAuditLog.findMany({
      where: { taskId },
      include: { user: { select: userSelect } },
      orderBy: { createdAt: 'desc' },
    });
    return { ...task, comments, history };
  }

  async create(userId: string, dto: CreateTaskDto) {
    const now = new Date();
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : this.endOfToday();
    const alertAt = dto.alertAt ? new Date(dto.alertAt) : dueDate;
    const ownerId = dto.ownerId || userId;
    const assigneeId = dto.assigneeId || userId;

    if (ownerId !== userId) {
      await this.ensureTeamPeer(userId, ownerId);
    }
    if (assigneeId !== userId) {
      await this.ensureTeamPeer(userId, assigneeId);
    }

    const task = await this.prisma.task.create({
      data: {
        title: dto.title,
        description: dto.description ?? null,
        dueDate,
        priority: dto.priority || 'medium',
        status: 'todo',
        ownerId,
        assigneeId,
        teamId: dto.teamId ?? null,
        createdBy: userId,
        alertAt,
        alertSent: false,
      },
      include: {
        owner: { select: userSelect },
        assignee: { select: userSelect },
      },
    });

    await this.audit.log(task.id, userId, 'CREATED');
    return task;
  }

  async update(taskId: string, userId: string, dto: UpdateTaskDto) {
    const task = await this.getAccessibleTask(taskId, userId);
    const isOwner = task.ownerId === userId;

    if (dto.alertAt !== undefined && !isOwner) {
      throw new ForbiddenException('Only the task owner can change the alert time');
    }
    if ((dto.ownerId !== undefined || dto.assigneeId !== undefined) && !isOwner) {
      throw new ForbiddenException('Only the task owner can change owner/assignee');
    }

    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.priority !== undefined) {
      data.priority = dto.priority;
      await this.audit.log(taskId, userId, 'PRIORITY_CHANGED', 'priority', task.priority, dto.priority);
    }
    if (dto.assigneeId !== undefined) {
      await this.ensureTeamPeer(userId, dto.assigneeId);
      data.assigneeId = dto.assigneeId;
      await this.audit.log(taskId, userId, 'ASSIGNEE_CHANGED', 'assigneeId', task.assigneeId, dto.assigneeId);
    }
    if (dto.ownerId !== undefined) {
      await this.ensureTeamPeer(userId, dto.ownerId);
      data.ownerId = dto.ownerId;
      await this.audit.log(taskId, userId, 'OWNER_CHANGED', 'ownerId', task.ownerId, dto.ownerId);
    }
    if (dto.alertAt !== undefined) {
      data.alertAt = new Date(dto.alertAt);
      data.alertSent = false;
      await this.audit.log(taskId, userId, 'ALERT_CHANGED', 'alertAt', task.alertAt.toISOString(), dto.alertAt);
    }

    return this.prisma.task.update({
      where: { id: taskId },
      data,
      include: { owner: { select: userSelect }, assignee: { select: userSelect } },
    });
  }

  async start(taskId: string, userId: string) {
    return this.changeStatus(taskId, userId, 'in_progress', 'STATUS_CHANGED');
  }

  async complete(taskId: string, userId: string) {
    return this.changeStatus(taskId, userId, 'completed', 'COMPLETED');
  }

  async archive(taskId: string, userId: string) {
    return this.changeStatus(taskId, userId, 'archived', 'ARCHIVED');
  }

  async postpone(taskId: string, userId: string, dto: PostponeTaskDto) {
    const task = await this.getAccessibleTask(taskId, userId);
    if (task.ownerId !== userId) {
      throw new ForbiddenException('Only the task owner can change the due date');
    }

    const newDueDate = new Date(dto.dueDate);
    const data: Record<string, unknown> = { dueDate: newDueDate };

    if (dto.updateAlert !== false && dto.alertAt) {
      data.alertAt = new Date(dto.alertAt);
      data.alertSent = false;
    } else if (dto.updateAlert !== false) {
      const delta = newDueDate.getTime() - task.dueDate.getTime();
      data.alertAt = new Date(task.alertAt.getTime() + delta);
      data.alertSent = false;
    }

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data,
      include: { owner: { select: userSelect }, assignee: { select: userSelect } },
    });

    await this.audit.log(
      taskId,
      userId,
      'DUE_DATE_CHANGED',
      'dueDate',
      task.dueDate.toISOString(),
      newDueDate.toISOString(),
    );

    return updated;
  }

  async addComment(taskId: string, userId: string, dto: CreateCommentDto) {
    await this.getAccessibleTask(taskId, userId);
    const comment = await this.prisma.comment.create({
      data: { taskId, userId, body: dto.body },
      include: { user: { select: userSelect } },
    });
    await this.audit.log(taskId, userId, 'COMMENT_ADDED', 'comment', null, dto.body);
    return comment;
  }

  async getPendingAlerts(userId: string) {
    const twoMinutesAgo = new Date(Date.now() - 120000);
    return this.prisma.task.findMany({
      where: {
        OR: [{ ownerId: userId }, { assigneeId: userId }],
        status: { in: ['todo', 'in_progress'] },
        alertSent: true,
        alertAt: { lte: new Date(), gte: twoMinutesAgo },
      },
      select: { id: true, title: true, dueDate: true, priority: true, alertAt: true },
    });
  }

  private async changeStatus(taskId: string, userId: string, status: string, action: string) {
    const task = await this.getAccessibleTask(taskId, userId);
    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: { status },
      include: { owner: { select: userSelect }, assignee: { select: userSelect } },
    });
    await this.audit.log(taskId, userId, action, 'status', task.status, status);
    return updated;
  }

  private async getAccessibleTask(taskId: string, userId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { owner: { select: userSelect }, assignee: { select: userSelect } },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.ownerId !== userId && task.assigneeId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return task;
  }

  private async ensureTeamPeer(userId: string, peerId: string) {
    if (userId === peerId) return;
    const myTeams = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    });
    const peer = await this.prisma.teamMember.findFirst({
      where: { userId: peerId, teamId: { in: myTeams.map((t) => t.teamId) } },
    });
    if (!peer) throw new ForbiddenException('User is not in your team');
  }

  private endOfToday() {
    const d = new Date();
    d.setHours(17, 0, 0, 0);
    return d;
  }
}
