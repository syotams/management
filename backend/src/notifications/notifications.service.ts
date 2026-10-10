import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Notification } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../common/email.service';
import { extractMentions } from '../common/mentions.util';

export const NOTIFICATION_RETENTION_DAYS = 14;

export type NotificationType = 'task_alert' | 'mention';

export interface MentionContext {
  task: { id: string; title: string; ownerId: string; assigneeId: string };
  authorId: string;
  source: 'comment' | 'description';
  text: string | null | undefined;
  previousText?: string | null;
}

const notificationInclude = {
  actor: { select: { id: true, name: true } },
  task: { select: { id: true, title: true } },
} as const;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
  ) {}

  create(data: {
    userId: string;
    type: NotificationType;
    taskId?: string | null;
    actorId?: string | null;
    title: string;
    body: string;
  }) {
    return this.prisma.notification.create({ data });
  }

  /** Only the task's owner and assignee can open it, so other mentions are ignored. */
  async notifyMentions({ task, authorId, source, text, previousText }: MentionContext) {
    const previous = new Set(extractMentions(previousText));
    const mentioned = extractMentions(text).filter((name) => !previous.has(name));
    if (!mentioned.length) return [];

    const candidateIds = [...new Set([task.ownerId, task.assigneeId])].filter((id) => id !== authorId);
    if (!candidateIds.length) return [];

    const [author, candidates] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: authorId }, select: { name: true } }),
      this.prisma.user.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true, name: true, email: true, emailNotifications: true },
      }),
    ]);
    const recipients = candidates.filter((u) => mentioned.includes(u.name.toLowerCase()));
    const authorName = author?.name ?? 'Someone';
    const where = source === 'comment' ? 'a comment on' : 'the description of';
    const title = `${authorName} mentioned you`;
    const body = `${authorName} mentioned you in ${where} "${task.title}".`;

    const created: Notification[] = [];
    for (const recipient of recipients) {
      created.push(
        await this.create({
          userId: recipient.id,
          type: 'mention',
          taskId: task.id,
          actorId: authorId,
          title,
          body,
        }),
      );
      if (recipient.emailNotifications) {
        try {
          await this.email.sendAlert(recipient.email, title, body);
        } catch (err) {
          this.logger.error(`Failed to email mention to ${recipient.id}: ${(err as Error).message}`);
        }
      }
    }
    return created;
  }

  findRecent(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId, createdAt: { gte: this.retentionCutoff() } },
      include: notificationInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async unread(userId: string) {
    const items = await this.prisma.notification.findMany({
      where: { userId, readAt: null, createdAt: { gte: this.retentionCutoff() } },
      include: notificationInclude,
      orderBy: { createdAt: 'desc' },
    });
    return { count: items.length, items };
  }

  async markRead(userId: string, ids: string[]) {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, id: { in: ids }, readAt: null },
      data: { readAt: new Date() },
    });
    return { count };
  }

  async markAllRead(userId: string) {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count };
  }

  async remove(userId: string, ids: string[]) {
    const { count } = await this.prisma.notification.deleteMany({
      where: { userId, id: { in: ids } },
    });
    return { count };
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpired() {
    const { count } = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: this.retentionCutoff() } },
    });
    if (count) this.logger.log(`Purged ${count} expired notifications`);
  }

  private retentionCutoff() {
    return new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  }
}
