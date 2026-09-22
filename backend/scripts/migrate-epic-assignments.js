/**
 * One-shot production data migration: Epic copy rows -> EpicAssignment.
 * Idempotent. Safe to run on every container start before `prisma db push`.
 * No-ops when already on the new schema or DB is empty.
 */
const { PrismaClient } = require('@prisma/client');

async function tableExists(prisma, table) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 AS ok
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     LIMIT 1`,
    table,
  );
  return rows.length > 0;
}

async function columnExists(prisma, table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 AS ok
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    table,
    column,
  );
  return rows.length > 0;
}

async function migrate() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('mysql')) {
    console.log('Skipping epic assignment migration (not MySQL)');
    return;
  }

  const prisma = new PrismaClient();
  try {
    if (!(await tableExists(prisma, 'Epic'))) {
      console.log('Skipping epic assignment migration (no Epic table yet)');
      return;
    }

    if (!(await columnExists(prisma, 'Epic', 'sourceEpicId'))) {
      console.log('Skipping epic assignment migration (already on derived schema)');
      return;
    }

    console.log('Migrating epic copies to EpicAssignment...');

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`EpicAssignment\` (
        \`id\` VARCHAR(191) NOT NULL,
        \`epicId\` VARCHAR(191) NOT NULL,
        \`userId\` VARCHAR(191) NOT NULL,
        \`workingDays\` INTEGER NOT NULL,
        \`startSprintNumber\` INTEGER NOT NULL,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`EpicAssignment_epicId_userId_startSprintNumber_key\` (\`epicId\`, \`userId\`, \`startSprintNumber\`),
        INDEX \`EpicAssignment_epicId_idx\` (\`epicId\`),
        INDEX \`EpicAssignment_userId_idx\` (\`userId\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    if (await tableExists(prisma, 'EpicAssignee')) {
      await prisma.$executeRawUnsafe(`
        INSERT IGNORE INTO \`EpicAssignment\`
          (\`id\`, \`epicId\`, \`userId\`, \`workingDays\`, \`startSprintNumber\`, \`createdAt\`, \`updatedAt\`)
        SELECT
          e.\`id\`,
          e.\`sourceEpicId\`,
          a.\`userId\`,
          e.\`workingDays\`,
          e.\`startSprintNumber\`,
          e.\`createdAt\`,
          e.\`updatedAt\`
        FROM \`Epic\` e
        INNER JOIN \`EpicAssignee\` a ON a.\`epicId\` = e.\`id\`
        WHERE e.\`sourceEpicId\` IS NOT NULL
          AND e.\`startSprintNumber\` IS NOT NULL
      `);

      await prisma.$executeRawUnsafe(`
        DELETE a FROM \`EpicAssignee\` a
        INNER JOIN \`Epic\` e ON e.\`id\` = a.\`epicId\`
        WHERE e.\`sourceEpicId\` IS NOT NULL
      `);
    }

    await prisma.$executeRawUnsafe(`
      DELETE FROM \`Epic\` WHERE \`sourceEpicId\` IS NOT NULL
    `);

    // FKs may already exist from a previous partial run
    try {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE \`EpicAssignment\`
          ADD CONSTRAINT \`EpicAssignment_epicId_fkey\`
          FOREIGN KEY (\`epicId\`) REFERENCES \`Epic\`(\`id\`)
          ON DELETE CASCADE ON UPDATE CASCADE
      `);
    } catch (_) {
      /* already exists */
    }
    try {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE \`EpicAssignment\`
          ADD CONSTRAINT \`EpicAssignment_userId_fkey\`
          FOREIGN KEY (\`userId\`) REFERENCES \`User\`(\`id\`)
          ON DELETE CASCADE ON UPDATE CASCADE
      `);
    } catch (_) {
      /* already exists */
    }

    const [{ count }] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS count FROM \`EpicAssignment\``,
    );
    console.log(`Epic assignment migration complete (${Number(count)} assignment row(s))`);
  } finally {
    await prisma.$disconnect();
  }
}

migrate().catch((err) => {
  console.error('Epic assignment migration failed:', err);
  process.exit(1);
});
