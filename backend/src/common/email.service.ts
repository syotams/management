import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter | null;

  constructor(private config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST')?.trim();
    if (!host) {
      this.transporter = null;
      return;
    }

    const port = Number(this.config.get<string>('SMTP_PORT') || 587);
    const secureSetting = this.config.get<string>('SMTP_SECURE')?.trim().toLowerCase();
    const secure = secureSetting === 'true' || secureSetting === '1' || (secureSetting !== 'false' && secureSetting !== '0' && port === 465);
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const pass = this.config.get<string>('SMTP_PASS') ?? '';

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
    });
  }

  async sendAlert(to: string, subject: string, body: string) {
    if (!this.transporter) {
      this.logger.log(`Email to ${to}: ${subject} — ${body}`);
      return;
    }

    const from = this.config.get<string>('SMTP_FROM')?.trim()
      || this.config.get<string>('SMTP_USER')?.trim()
      || 'noreply@localhost';
    await this.transporter.sendMail({ from, to, subject, text: body });
  }

  async sendInvite(to: string, teamName: string, inviteLink: string) {
    const subject = `You've been invited to join ${teamName}`;
    const body = `Click to join: ${inviteLink}`;
    await this.sendAlert(to, subject, body);
  }

  async sendPasswordReset(to: string, resetLink: string) {
    const subject = 'Reset your password';
    const body = `Click to choose a new password: ${resetLink}\n\nThis link expires in 1 hour.`;
    await this.sendAlert(to, subject, body);
  }
}
