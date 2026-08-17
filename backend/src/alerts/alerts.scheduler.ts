import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../common/email.service';

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
        assignee: { select: { email: true } },
        owner: { select: { email: true } },
      },
    });

    for (const task of tasks) {
      const subject = `Task alert: ${task.title}`;
      const body = `Your task "${task.title}" is due ${task.dueDate.toISOString()}. Priority: ${task.priority}.`;
      await this.email.sendAlert(task.assignee.email, subject, body);
      await this.email.sendAlert(task.owner.email, subject, body);

      await this.prisma.task.update({
        where: { id: task.id },
        data: { alertSent: true },
      });

      this.logger.log(`Alert sent for task ${task.id}`);
    }
  }
}
