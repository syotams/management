import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async sendAlert(to: string, subject: string, body: string) {
    this.logger.log(`Email to ${to}: ${subject} — ${body}`);
  }

  async sendInvite(to: string, teamName: string, inviteLink: string) {
    const subject = `You've been invited to join ${teamName}`;
    const body = `Click to join: ${inviteLink}`;
    await this.sendAlert(to, subject, body);
  }
}
