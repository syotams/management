import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../common/email.service';
import { formatInTimeZone } from '../common/date.util';

@Injectable()
export class AlertsScheduler {
  private readonly logger = new Logger(AlertsScheduler.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
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
        assignee: { select: { email: true, timezone: true } },
        owner: { select: { email: true, timezone: true } },
      },
    });

    for (const task of tasks) {
      const subject = `Task alert: ${task.title}`;
      const assigneeDue = formatInTimeZone(task.dueDate, task.assignee.timezone);
      const ownerDue = formatInTimeZone(task.dueDate, task.owner.timezone);
      await this.email.sendAlert(
        task.assignee.email,
        subject,
        `Your task "${task.title}" is due ${assigneeDue}. Priority: ${task.priority}.`,
      );
      await this.email.sendAlert(
        task.owner.email,
        subject,
        `Your task "${task.title}" is due ${ownerDue}. Priority: ${task.priority}.`,
      );

      await this.prisma.task.update({
        where: { id: task.id },
        data: { alertSent: true },
      });

      this.logger.log(`Alert sent for task ${task.id}`);
    }
  }
}
