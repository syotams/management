import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../common/email.service';
import { NotificationsService } from './notifications.service';
import { resetTestDatabase } from '../../test/test-utils';

describe('NotificationsService', () => {
  let prisma: PrismaClient;
  let service: NotificationsService;
  let sendAlert: jest.Mock;
  let owner: { id: string };
  let assignee: { id: string };
  let outsider: { id: string };
  let task: { id: string; title: string; ownerId: string; assigneeId: string };

  beforeAll(() => {
    resetTestDatabase('test-notifications');
  });

  beforeEach(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    await prisma.notification.deleteMany();
    await prisma.task.deleteMany();
    await prisma.user.deleteMany();

    const passwordHash = await bcrypt.hash('password123', 4);
    owner = await prisma.user.create({ data: { email: 'owner@test.com', name: 'Owner', passwordHash } });
    assignee = await prisma.user.create({
      data: { email: 'assignee@test.com', name: 'Assignee', passwordHash, emailNotifications: true },
    });
    outsider = await prisma.user.create({ data: { email: 'out@test.com', name: 'Outsider', passwordHash } });
    task = await prisma.task.create({
      data: {
        title: 'Ship it',
        dueDate: new Date(),
        ownerId: owner.id,
        assigneeId: assignee.id,
        createdBy: owner.id,
      },
    });

    sendAlert = jest.fn().mockResolvedValue(undefined);
    service = new NotificationsService(
      prisma as unknown as PrismaService,
      { sendAlert } as unknown as EmailService,
    );
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  describe('notifyMentions', () => {
    it('notifies mentioned owner/assignee but not the author or outsiders', async () => {
      const created = await service.notifyMentions({
        task,
        authorId: owner.id,
        source: 'comment',
        text: '@owner @ASSIGNEE @outsider please check',
      });

      expect(created.map((n) => n.userId)).toEqual([assignee.id]);
      expect(created[0]).toMatchObject({ type: 'mention', taskId: task.id, actorId: owner.id });
      expect(sendAlert).toHaveBeenCalledTimes(1);
      expect(sendAlert).toHaveBeenCalledWith('assignee@test.com', expect.any(String), expect.any(String));
    });

    it('skips email for users who opted out', async () => {
      await service.notifyMentions({ task, authorId: assignee.id, source: 'comment', text: '@Owner' });
      expect(await prisma.notification.count({ where: { userId: owner.id } })).toBe(1);
      expect(sendAlert).not.toHaveBeenCalled();
    });

    it('only notifies mentions that are new compared to the previous text', async () => {
      const created = await service.notifyMentions({
        task,
        authorId: outsider.id,
        source: 'description',
        text: '@Owner and now @Assignee',
        previousText: 'cc @owner',
      });
      expect(created.map((n) => n.userId)).toEqual([assignee.id]);
    });
  });

  describe('scoping', () => {
    it('only reads, marks and deletes the current user notifications', async () => {
      const mine = await service.create({ userId: owner.id, type: 'task_alert', taskId: task.id, title: 'a', body: 'b' });
      const theirs = await service.create({ userId: assignee.id, type: 'task_alert', taskId: task.id, title: 'a', body: 'b' });

      expect((await service.findRecent(owner.id)).map((n) => n.id)).toEqual([mine.id]);
      expect(await service.markRead(owner.id, [mine.id, theirs.id])).toEqual({ count: 1 });
      expect((await service.unread(assignee.id)).count).toBe(1);
      expect(await service.remove(owner.id, [mine.id, theirs.id])).toEqual({ count: 1 });
      expect(await prisma.notification.findUnique({ where: { id: theirs.id } })).not.toBeNull();
    });

    it('excludes notifications older than 14 days', async () => {
      await prisma.notification.create({
        data: {
          userId: owner.id,
          type: 'task_alert',
          title: 'old',
          body: 'old',
          createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
        },
      });
      expect(await service.findRecent(owner.id)).toEqual([]);
      await service.purgeExpired();
      expect(await prisma.notification.count()).toBe(0);
    });
  });
});
