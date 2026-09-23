/**
 * Production data migrations that must run before `prisma db push`.
 * Idempotent. Safe to run on every container start.
 *
 * 1) Epic copy rows (sourceEpicId) -> EpicAssignment
 * 2) Backfill EpicAssignment.startSprintWeek (week model) for existing rows
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

async function indexExists(prisma, table, indexName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 AS ok
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    table,
    indexName,
  );
  return rows.length > 0;
}

async function migrateEpicCopiesToAssignments(prisma) {
  if (!(await tableExists(prisma, 'Epic'))) {
    console.log('Skipping epic assignment migration (no Epic table yet)');
    return;
  }

  if (!(await columnExists(prisma, 'Epic', 'sourceEpicId'))) {
    console.log('Skipping epic copy migration (already on derived schema)');
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
      \`startSprintWeek\` INTEGER NOT NULL DEFAULT 1,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`EpicAssignment_epicId_userId_startSprintNumber_startSprintWeek_key\` (\`epicId\`, \`userId\`, \`startSprintNumber\`, \`startSprintWeek\`),
      INDEX \`EpicAssignment_epicId_idx\` (\`epicId\`),
      INDEX \`EpicAssignment_userId_idx\` (\`userId\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  if (await tableExists(prisma, 'EpicAssignee')) {
    // Copy rows (sourceEpicId set) → assignment on the backlog epic
    await prisma.$executeRawUnsafe(`
      INSERT IGNORE INTO \`EpicAssignment\`
        (\`id\`, \`epicId\`, \`userId\`, \`workingDays\`, \`startSprintNumber\`, \`startSprintWeek\`, \`createdAt\`, \`updatedAt\`)
      SELECT
        e.\`id\`,
        e.\`sourceEpicId\`,
        a.\`userId\`,
        e.\`workingDays\`,
        e.\`startSprintNumber\`,
        1,
        e.\`createdAt\`,
        e.\`updatedAt\`
      FROM \`Epic\` e
      INNER JOIN \`EpicAssignee\` a ON a.\`epicId\` = e.\`id\`
      WHERE e.\`sourceEpicId\` IS NOT NULL
        AND e.\`startSprintNumber\` IS NOT NULL
    `);

    // Edge case: scheduled rows without sourceEpicId (assignee on the epic itself)
    await prisma.$executeRawUnsafe(`
      INSERT IGNORE INTO \`EpicAssignment\`
        (\`id\`, \`epicId\`, \`userId\`, \`workingDays\`, \`startSprintNumber\`, \`startSprintWeek\`, \`createdAt\`, \`updatedAt\`)
      SELECT
        CONCAT(e.\`id\`, '-', a.\`userId\`),
        e.\`id\`,
        a.\`userId\`,
        e.\`workingDays\`,
        e.\`startSprintNumber\`,
        1,
        e.\`createdAt\`,
        e.\`updatedAt\`
      FROM \`Epic\` e
      INNER JOIN \`EpicAssignee\` a ON a.\`epicId\` = e.\`id\`
      WHERE e.\`sourceEpicId\` IS NULL
        AND e.\`startSprintNumber\` IS NOT NULL
    `);

    // Assignee join is fully replaced by EpicAssignment
    await prisma.$executeRawUnsafe(`DELETE FROM \`EpicAssignee\``);
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
}

/**
 * Production already has EpicAssignment rows from the derived-schema deploy.
 * Add startSprintWeek (default week 1) and widen the unique key before db push.
 */
async function migrateStartSprintWeek(prisma) {
  if (!(await tableExists(prisma, 'EpicAssignment'))) {
    console.log('Skipping startSprintWeek migration (no EpicAssignment table yet)');
    return;
  }

  if (await columnExists(prisma, 'EpicAssignment', 'startSprintWeek')) {
    console.log('Skipping startSprintWeek migration (column already present)');
  } else {
    console.log('Adding EpicAssignment.startSprintWeek (default 1) for existing rows...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`EpicAssignment\`
        ADD COLUMN \`startSprintWeek\` INTEGER NOT NULL DEFAULT 1
    `);
  }

  const oldUnique = 'EpicAssignment_epicId_userId_startSprintNumber_key';
  const newUnique = 'EpicAssignment_epicId_userId_startSprintNumber_startSprintWeek_key';

  if (await indexExists(prisma, 'EpicAssignment', oldUnique)) {
    console.log(`Dropping obsolete unique index ${oldUnique}...`);
    await prisma.$executeRawUnsafe(`ALTER TABLE \`EpicAssignment\` DROP INDEX \`${oldUnique}\``);
  }

  if (!(await indexExists(prisma, 'EpicAssignment', newUnique))) {
    console.log(`Creating unique index ${newUnique}...`);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX \`${newUnique}\`
      ON \`EpicAssignment\` (\`epicId\`, \`userId\`, \`startSprintNumber\`, \`startSprintWeek\`)
    `);
  }

  console.log('startSprintWeek migration complete');
}

async function migrate() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('mysql')) {
    console.log('Skipping epic migrations (not MySQL)');
    return;
  }

  const prisma = new PrismaClient();
  try {
    await migrateEpicCopiesToAssignments(prisma);
    await migrateStartSprintWeek(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

migrate().catch((err) => {
  console.error('Epic assignment migration failed:', err);
  process.exit(1);
});
