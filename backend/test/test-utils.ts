import { mkdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

export const TEST_DB_PATH = join(__dirname, '..', 'prisma', 'test.db');
export const TEST_DATABASE_URL = `file:${TEST_DB_PATH}`;

export function resetTestDatabase() {
  const dir = join(__dirname, '..', 'prisma');
  mkdirSync(dir, { recursive: true });
  if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}

export async function seedEpicFixture(prisma: PrismaClient) {
  const passwordHash = await bcrypt.hash('password123', 10);
  const creator = await prisma.user.create({
    data: {
      email: 'creator@test.com',
      name: 'Creator',
      passwordHash,
    },
  });
  const assignee = await prisma.user.create({
    data: {
      email: 'assignee@test.com',
      name: 'Assignee',
      passwordHash,
    },
  });

  const startDate = new Date(Date.UTC(2026, 0, 5));
  const endDate = new Date(Date.UTC(2026, 2, 1));

  const project = await prisma.project.create({
    data: {
      name: 'Test Project',
      startDate,
      endDate,
      status: 'draft',
      createdBy: creator.id,
      participants: { create: [{ userId: assignee.id }, { userId: creator.id }] },
      sprints: {
        create: [
          {
            number: 1,
            startDate: new Date(Date.UTC(2026, 0, 5)),
            endDate: new Date(Date.UTC(2026, 0, 18)),
          },
          {
            number: 2,
            startDate: new Date(Date.UTC(2026, 0, 19)),
            endDate: new Date(Date.UTC(2026, 1, 1)),
          },
          {
            number: 3,
            startDate: new Date(Date.UTC(2026, 1, 2)),
            endDate: new Date(Date.UTC(2026, 1, 15)),
          },
        ],
      },
    },
  });

  return { creator, assignee, project };
}
