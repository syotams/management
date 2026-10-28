/**
 * One-time materialization of the plan roster that existed before participant
 * rows were the only source of people on a project.
 *
 * For each project, the ordered roster is: creator, current members of linked
 * teams (by join time), explicit participants, then epic assignees. Missing
 * rows are inserted and addedAt is rewritten so the grid keeps that order.
 *
 * Run once, before or as this roster change is deployed. A later run restores
 * anyone the old rules would have shown, including people removed afterward.
 *
 * Usage: npm run db:backfill-participants
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function legacyRoster(project: {
  createdBy: string;
  teamId: string | null;
  projectTeams: { teamId: string }[];
  participants: { userId: string; addedAt: Date }[];
  epics: { assignments: { userId: string; createdAt: Date }[] }[];
}) {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (userId: string) => {
    if (seen.has(userId)) return;
    seen.add(userId);
    ordered.push(userId);
  };

  push(project.createdBy);

  const teamIds = project.projectTeams.length
    ? project.projectTeams.map((link) => link.teamId)
    : project.teamId
      ? [project.teamId]
      : [];

  if (teamIds.length) {
    const members = await prisma.teamMember.findMany({
      where: { teamId: { in: teamIds } },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      select: { userId: true },
    });
    for (const member of members) push(member.userId);
  }

  const explicit = [...project.participants].sort(
    (a, b) => a.addedAt.getTime() - b.addedAt.getTime(),
  );
  for (const participant of explicit) push(participant.userId);

  const assignments = project.epics
    .flatMap((epic) => epic.assignments)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const assignment of assignments) push(assignment.userId);

  return ordered;
}

async function main() {
  const projects = await prisma.project.findMany({
    include: {
      projectTeams: true,
      participants: true,
      epics: { include: { assignments: true } },
    },
  });

  const addedAtBase = new Date('2020-01-01T00:00:00.000Z').getTime();
  for (const project of projects) {
    const roster = await legacyRoster(project);
    await prisma.$transaction(async (tx) => {
      for (const [index, userId] of roster.entries()) {
        const addedAt = new Date(addedAtBase + index * 1000);
        await tx.projectParticipant.upsert({
          where: { projectId_userId: { projectId: project.id, userId } },
          create: { projectId: project.id, userId, addedAt },
          update: { addedAt },
        });
      }
    });
  }

  console.log(`Backfilled participants for ${projects.length} project(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
