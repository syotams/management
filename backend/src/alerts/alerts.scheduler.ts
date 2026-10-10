import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../common/email.service';
import { formatInTimeZone } from '../common/date.util';
import { NotificationsService } from '../notifications/notifications.service';

const recipientSelect = { id: true, email: true, timezone: true, emailNotifications: true } as const;

@Injectable()
export class AlertsScheduler {
  private readonly logger = new Logger(AlertsScheduler.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processAlerts() {
    const now = new Date();
    const tasks = await this.prisma.task.findMany({
      where: {
        status: { in: ['todo', 'in_progress'] },
        alertAt: { lte: now },
        alertSent: false,
      },
      include: {
        assignee: { select: recipientSelect },
        owner: { select: recipientSelect },
      },
    });

    for (const task of tasks) {
      const subject = `Task alert: ${task.title}`;
      const recipients = [task.assignee, task.owner].filter(
        (r, i, all) => all.findIndex((o) => o.id === r.id) === i,
      );
      for (const recipient of recipients) {
        const due = formatInTimeZone(task.dueDate, recipient.timezone);
        const body = `Your task "${task.title}" is due ${due}. Priority: ${task.priority}.`;
        await this.notifications.create({
          userId: recipient.id,
          type: 'task_alert',
          taskId: task.id,
          title: subject,
          body,
        });
        if (!recipient.emailNotifications) continue;
        await this.email.sendAlert(recipient.email, subject, body);
      }

      await this.prisma.task.update({
        where: { id: task.id },
        data: { alertSent: true },
      });

      this.logger.log(`Alert sent for task ${task.id}`);
    }
  }
}
