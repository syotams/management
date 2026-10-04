import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey: string | null;

  constructor(private config: ConfigService) {
    const key = this.config.get<string>('BREVO_API_KEY')?.trim();
    this.apiKey = key || null;
    if (!this.apiKey) {
      this.logger.warn('BREVO_API_KEY is empty; emails will be logged instead of sent');
    }
  }

  async sendAlert(to: string, subject: string, body: string) {
    if (!this.apiKey) {
      this.logger.log(`Email to ${to}: ${subject} — ${body}`);
      return;
    }

    const sender = this.sender();
    const response = await fetch(BREVO_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': this.apiKey,
      },
      body: JSON.stringify({
        sender,
        to: [{ email: to }],
        subject,
        textContent: body,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Brevo rejected email to ${to} (${response.status}): ${detail}`);
    }
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

  private sender(): { email: string; name?: string } {
    const email = this.config.get<string>('EMAIL_FROM')?.trim();
    if (!email) {
      throw new Error('EMAIL_FROM is required to send mail through Brevo');
    }
    const name = this.config.get<string>('EMAIL_FROM_NAME')?.trim();
    return name ? { email, name } : { email };
  }
}
