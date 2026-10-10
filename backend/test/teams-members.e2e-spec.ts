import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/common/email.service';
import { resetTestDatabase } from './test-utils';

describe('Team members (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    resetTestDatabase('test-teams-members');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailService)
      .useValue({
        sendAlert: jest.fn().mockResolvedValue(undefined),
        sendInvite: jest.fn().mockResolvedValue(undefined),
        sendPasswordReset: jest.fn().mockResolvedValue(undefined),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const as = (token: string) => ({
    get: (url: string) => request(server()).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) =>
      request(server()).post(url).set('Authorization', `Bearer ${token}`).send(body),
  });

  async function register(name: string, email: string) {
    const res = await request(server())
      .post('/auth/register')
      .send({ name, email, password: 'password123' })
      .expect(201);
    return res.body.accessToken as string;
  }

  it('lists joined users with their name, email and role', async () => {
    const ownerToken = await register('team_owner', 'owner@test.com');
    const team = await as(ownerToken).post('/teams', { name: 'Platform' }).expect(201);

    const invite = await as(ownerToken)
      .post(`/teams/${team.body.id}/invites`, { email: 'joiner@test.com' })
      .expect(201);

    const joinerToken = await register('team_joiner', 'joiner@test.com');
    await as(joinerToken).post(`/invites/${invite.body.token}/accept`).expect(201);

    const res = await as(ownerToken).get(`/teams/${team.body.id}/members`).expect(200);

    const rows = res.body.members.map((m: { role: string; user: { name: string; email: string } }) => ({
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    }));
    expect(rows).toEqual(
      expect.arrayContaining([
        { name: 'team_owner', email: 'owner@test.com', role: 'owner' },
        { name: 'team_joiner', email: 'joiner@test.com', role: 'member' },
      ]),
    );
    expect(rows).toHaveLength(2);
    for (const m of res.body.members) {
      expect(m.user).not.toHaveProperty('passwordHash');
    }

    const joinedInvite = res.body.invites.find((i: { email: string }) => i.email === 'joiner@test.com');
    expect(joinedInvite).toBeUndefined();
  });
});
