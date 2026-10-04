import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

function config(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as ConfigService;
}

describe('EmailService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('logs the message when BREVO_API_KEY is empty', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new EmailService(config({ EMAIL_FROM: 'noreply@localhost' }));

    await service.sendPasswordReset('user@example.com', 'https://example.com/reset?token=abc');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends plain text through the Brevo HTTPS API', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '{"messageId":"abc"}',
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new EmailService(config({
      BREVO_API_KEY: 'xkeysib-test',
      EMAIL_FROM: 'noreply.sp@matheager.com',
      EMAIL_FROM_NAME: 'Math Eager',
    }));

    await service.sendPasswordReset('user@example.com', 'https://sp.matheager.com/reset-password?token=abc');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'api-key': 'xkeysib-test' }),
      }),
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.sender).toEqual({ email: 'noreply.sp@matheager.com', name: 'Math Eager' });
    expect(body.to).toEqual([{ email: 'user@example.com' }]);
    expect(body.subject).toBe('Reset your password');
    expect(body.textContent).toContain('https://sp.matheager.com/reset-password?token=abc');
    expect(body.htmlContent).toBeUndefined();
  });

  it('throws when Brevo rejects the message', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"message":"Key not found"}',
    }) as unknown as typeof fetch;
    const service = new EmailService(config({
      BREVO_API_KEY: 'bad',
      EMAIL_FROM: 'noreply.sp@matheager.com',
    }));

    await expect(service.sendAlert('a@b.com', 'Hi', 'Body')).rejects.toThrow(/401/);
  });
});
