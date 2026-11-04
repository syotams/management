/**
 * One-time cleanup for projects created while the last sprint could run past
 * the project end date.
 *
 * Deletes sprints that end after their project's end date. A sprint is kept,
 * and reported, when an assignment starts in it or later, so no placed work
 * disappears from the board. Completed projects are left as they were.
 *
 * Usage: npm run db:trim-overflow-sprints -- [--dry-run]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const projects = await prisma.project.findMany({
    where: { status: { not: 'completed' } },
    include: {
      sprints: { orderBy: { number: 'asc' } },
      epics: { include: { assignments: { select: { startSprintNumber: true } } } },
    },
  });

  let trimmed = 0;
  const blocked: string[] = [];

  for (const project of projects) {
    const overflow = project.sprints.filter((sprint) => sprint.endDate > project.endDate);
    if (!overflow.length) continue;

    const firstOverflow = overflow[0].number;
    const startsInOverflow = project.epics
      .flatMap((epic) => epic.assignments)
      .filter((assignment) => assignment.startSprintNumber >= firstOverflow);
    if (startsInOverflow.length) {
      blocked.push(
        `${project.id} (${project.name}): ${startsInOverflow.length} assignment(s) start in sprint ${firstOverflow} or later`,
      );
      continue;
    }

    if (!dryRun) {
      await prisma.sprint.deleteMany({
        where: { id: { in: overflow.map((sprint) => sprint.id) } },
      });
    }
    trimmed += 1;
  }

  const verb = dryRun ? 'Would trim' : 'Trimmed';
  console.log(`${verb} the last sprint of ${trimmed} project(s).`);
  if (blocked.length) {
    console.log(`Skipped ${blocked.length} project(s) with work in that sprint:`);
    for (const line of blocked) console.log(`  ${line}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
