import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEpicDto, CreateQuarterDto, UpdateEpicDto, UpdateQuarterDto } from './dto/quarter.dto';
import { countWeekdays, generateSprints, parseDateOnly } from './sprint.util';

const userSelect = { id: true, name: true, email: true };

type EpicWithAssignees = {
  id: string;
  title: string;
  workingDays: number;
  startSprintNumber: number;
  backgroundColor: string;
  createdAt: Date | string;
  assignees: { userId?: string; user: { id: string; name: string; email: string } }[];
};

type PlanSnapshot = {
  name: string;
  startDate: string;
  endDate: string;
  teamId: string | null;
  team: { id: string; name: string } | null;
  sprints: {
    id: string;
    number: number;
    startDate: string;
    endDate: string;
  }[];
  epics: {
    id: string;
    title: string;
    workingDays: number;
    startSprintNumber: number;
    backgroundColor: string;
    createdAt: string;
    assignees: { id: string; name: string; email: string }[];
  }[];
};

@Injectable()
export class QuartersService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateQuarterDto) {
    const { startDate, endDate } = this.parseRange(dto.startDate, dto.endDate);
    const teamId = await this.resolveTeamId(userId, dto.teamId);

    const quarter = await this.prisma.quarter.create({
      data: {
        name: dto.name.trim(),
        startDate,
        endDate,
        teamId,
        status: 'draft',
        createdBy: userId,
        sprints: { create: generateSprints(startDate, endDate) },
      },
    });

    return this.findOne(quarter.id, userId);
  }

  async findAll(userId: string) {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    });
    const teamIds = memberships.map((m) => m.teamId);

    const quarters = await this.prisma.quarter.findMany({
      where: {
        OR: [{ createdBy: userId }, { teamId: { in: teamIds } }],
      },
      include: {
        team: { select: { id: true, name: true } },
        _count: { select: { sprints: true, epics: true, versions: true } },
      },
      orderBy: { startDate: 'desc' },
    });

    return quarters.map((q) => ({
      ...q,
      status: this.normalizeStatus(q.status),
    }));
  }

  async findOne(id: string, userId: string) {
    const quarter = await this.loadQuarter(id);
    await this.ensureCanView(quarter, userId);
    const detail = await this.toDetail(quarter);

    if (detail.status === 'completed') {
      const comparison = await this.buildComparison(id);
      return { ...detail, comparison };
    }

    return { ...detail, comparison: null };
  }

  async compare(id: string, userId: string) {
    const quarter = await this.loadQuarter(id);
    await this.ensureCanView(quarter, userId);
    const status = this.normalizeStatus(quarter.status);
    if (status === 'draft') {
      throw new BadRequestException('Start the quarter before comparing plan versions');
    }
    const comparison = await this.buildComparison(id);
    if (!comparison) {
      throw new BadRequestException('No plan versions available to compare');
    }
    return comparison;
  }

  async update(id: string, userId: string, dto: UpdateQuarterDto) {
    const quarter = await this.loadQuarter(id);
    this.ensureCreator(quarter, userId);
    this.ensureEditable(quarter);

    const startDate = dto.startDate ? parseDateOnly(dto.startDate) : quarter.startDate;
    const endDate = dto.endDate ? parseDateOnly(dto.endDate) : quarter.endDate;
    this.assertRange(startDate, endDate);

    const teamId =
      dto.teamId === undefined ? quarter.teamId : await this.resolveTeamId(userId, dto.teamId);

    const datesChanged =
      startDate.getTime() !== quarter.startDate.getTime() ||
      endDate.getTime() !== quarter.endDate.getTime();

    await this.prisma.$transaction(async (tx) => {
      await tx.quarter.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          startDate,
          endDate,
          teamId,
        },
      });

      if (datesChanged) {
        await tx.sprint.deleteMany({ where: { quarterId: id } });
        await tx.sprint.createMany({
          data: generateSprints(startDate, endDate).map((s) => ({ ...s, quarterId: id })),
        });
      }
    });

    await this.maybeVersionAfterChange(id, userId);
    return this.findOne(id, userId);
  }

  async start(id: string, userId: string) {
    const quarter = await this.loadQuarter(id);
    this.ensureCreator(quarter, userId);
    const status = this.normalizeStatus(quarter.status);
    if (status !== 'draft') {
      throw new BadRequestException('Only draft quarters can be started');
    }
    if (!quarter.epics.length) {
      throw new BadRequestException('Add at least one epic before starting the quarter');
    }

    await this.createVersionSnapshot(id, userId);
    await this.prisma.quarter.update({
      where: { id },
      data: { status: 'in_progress' },
    });

    return this.findOne(id, userId);
  }

  async complete(id: string, userId: string) {
    const quarter = await this.loadQuarter(id);
    this.ensureCreator(quarter, userId);
    const status = this.normalizeStatus(quarter.status);
    if (status === 'completed') {
      throw new BadRequestException('Quarter is already completed');
    }
    if (status !== 'in_progress') {
      throw new BadRequestException('Start the quarter before completing it');
    }

    await this.createVersionSnapshot(id, userId);
    await this.prisma.quarter.update({
      where: { id },
      data: { status: 'completed' },
    });

    return this.findOne(id, userId);
  }

  async addEpic(quarterId: string, userId: string, dto: CreateEpicDto) {
    const quarter = await this.loadQuarter(quarterId);
    this.ensureCreator(quarter, userId);
    this.ensureEditable(quarter);

    this.assertStartSprint(quarter, dto.startSprintNumber);

    const assigneeIds = [...new Set(dto.assigneeIds)];
    await this.ensureAssignable(quarter, userId, assigneeIds);

    await this.prisma.epic.create({
      data: {
        quarterId,
        title: dto.title.trim(),
        workingDays: dto.workingDays,
        startSprintNumber: dto.startSprintNumber,
        backgroundColor: dto.backgroundColor.toLowerCase(),
        createdBy: userId,
        assignees: { create: assigneeIds.map((id) => ({ userId: id })) },
      },
    });

    await this.maybeVersionAfterChange(quarterId, userId);
    return this.findOne(quarterId, userId);
  }

  async updateEpic(quarterId: string, epicId: string, userId: string, dto: UpdateEpicDto) {
    const quarter = await this.loadQuarter(quarterId);
    this.ensureCreator(quarter, userId);
    this.ensureEditable(quarter);

    const epic = quarter.epics.find((e) => e.id === epicId);
    if (!epic) throw new NotFoundException('Epic not found');

    if (dto.startSprintNumber !== undefined) {
      this.assertStartSprint(quarter, dto.startSprintNumber);
    }

    const assigneeIds = dto.assigneeIds ? [...new Set(dto.assigneeIds)] : undefined;
    if (assigneeIds) {
      await this.ensureAssignable(quarter, userId, assigneeIds);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.epic.update({
        where: { id: epicId },
        data: {
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.workingDays !== undefined ? { workingDays: dto.workingDays } : {}),
          ...(dto.startSprintNumber !== undefined
            ? { startSprintNumber: dto.startSprintNumber }
            : {}),
          ...(dto.backgroundColor !== undefined
            ? { backgroundColor: dto.backgroundColor.toLowerCase() }
            : {}),
        },
      });

      if (assigneeIds) {
        await tx.epicAssignee.deleteMany({ where: { epicId } });
        await tx.epicAssignee.createMany({
          data: assigneeIds.map((id) => ({ epicId, userId: id })),
        });
      }
    });

    await this.maybeVersionAfterChange(quarterId, userId);
    return this.findOne(quarterId, userId);
  }

  async deleteEpic(quarterId: string, epicId: string, userId: string) {
    const quarter = await this.loadQuarter(quarterId);
    this.ensureCreator(quarter, userId);
    this.ensureEditable(quarter);

    const epic = quarter.epics.find((e) => e.id === epicId);
    if (!epic) throw new NotFoundException('Epic not found');

    await this.prisma.epic.delete({ where: { id: epicId } });
    await this.maybeVersionAfterChange(quarterId, userId);
    return this.findOne(quarterId, userId);
  }

  private async maybeVersionAfterChange(quarterId: string, userId: string) {
    const quarter = await this.prisma.quarter.findUnique({
      where: { id: quarterId },
      select: { status: true },
    });
    if (!quarter) return;
    if (this.normalizeStatus(quarter.status) === 'in_progress') {
      await this.createVersionSnapshot(quarterId, userId);
    }
  }

  private async createVersionSnapshot(quarterId: string, userId: string) {
    const quarter = await this.loadQuarter(quarterId);
    const latest = await this.prisma.quarterVersion.findFirst({
      where: { quarterId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    const snapshot = this.buildSnapshot(quarter);

    await this.prisma.quarterVersion.create({
      data: {
        quarterId,
        versionNumber,
        snapshot: JSON.stringify(snapshot),
        createdBy: userId,
      },
    });
  }

  private buildSnapshot(
    quarter: Awaited<ReturnType<QuartersService['loadQuarter']>>,
  ): PlanSnapshot {
    return {
      name: quarter.name,
      startDate: quarter.startDate.toISOString(),
      endDate: quarter.endDate.toISOString(),
      teamId: quarter.teamId,
      team: quarter.team,
      sprints: quarter.sprints.map((s) => ({
        id: s.id,
        number: s.number,
        startDate: s.startDate.toISOString(),
        endDate: s.endDate.toISOString(),
      })),
      epics: quarter.epics.map((epic) => ({
        id: epic.id,
        title: epic.title,
        workingDays: epic.workingDays,
        startSprintNumber: epic.startSprintNumber,
        backgroundColor: epic.backgroundColor,
        createdAt: epic.createdAt.toISOString(),
        assignees: epic.assignees.map((a) => a.user),
      })),
    };
  }

  private async buildComparison(quarterId: string) {
    const versions = await this.prisma.quarterVersion.findMany({
      where: { quarterId },
      orderBy: { versionNumber: 'asc' },
    });
    if (!versions.length) return null;

    const original = await this.planFromSnapshot(JSON.parse(versions[0].snapshot) as PlanSnapshot);
    const latest = await this.planFromSnapshot(
      JSON.parse(versions[versions.length - 1].snapshot) as PlanSnapshot,
    );

    return {
      original,
      latest,
      originalVersion: versions[0].versionNumber,
      latestVersion: versions[versions.length - 1].versionNumber,
    };
  }

  private async planFromSnapshot(snapshot: PlanSnapshot) {
    const sprints = snapshot.sprints.map((s) => ({
      id: s.id,
      number: s.number,
      startDate: new Date(s.startDate),
      endDate: new Date(s.endDate),
    }));
    const epics: EpicWithAssignees[] = snapshot.epics.map((epic) => ({
      id: epic.id,
      title: epic.title,
      workingDays: epic.workingDays,
      startSprintNumber: epic.startSprintNumber,
      backgroundColor: epic.backgroundColor,
      createdAt: epic.createdAt,
      assignees: epic.assignees.map((user) => ({ userId: user.id, user })),
    }));

    const participants = await this.resolveParticipantsFromSnapshot(snapshot);
    const participantIds = participants.map((p) => p.id);
    const grid = this.buildGrid(sprints, epics, participantIds);

    return {
      name: snapshot.name,
      startDate: snapshot.startDate,
      endDate: snapshot.endDate,
      teamId: snapshot.teamId,
      team: snapshot.team,
      sprints: sprints.map((s) => ({
        id: s.id,
        number: s.number,
        startDate: s.startDate,
        endDate: s.endDate,
        workingDays: countWeekdays(s.startDate, s.endDate),
      })),
      participants: participants.map((p) => ({
        ...p,
        cells: grid[p.id] || {},
      })),
      epics: snapshot.epics,
    };
  }

  private async resolveParticipantsFromSnapshot(snapshot: PlanSnapshot) {
    const byId = new Map<string, { id: string; name: string; email: string }>();

    if (snapshot.teamId) {
      const members = await this.prisma.teamMember.findMany({
        where: { teamId: snapshot.teamId },
        include: { user: { select: userSelect } },
        orderBy: { joinedAt: 'asc' },
      });
      for (const m of members) byId.set(m.user.id, m.user);
    }

    for (const epic of snapshot.epics) {
      for (const user of epic.assignees) {
        if (!byId.has(user.id)) byId.set(user.id, user);
      }
    }

    if (!byId.size && snapshot.team) {
      // no members found; keep empty
    }

    return Array.from(byId.values());
  }

  private async loadQuarter(id: string) {
    const quarter = await this.prisma.quarter.findUnique({
      where: { id },
      include: {
        team: { select: { id: true, name: true } },
        sprints: { orderBy: { number: 'asc' } },
        epics: {
          orderBy: { createdAt: 'asc' },
          include: {
            assignees: { include: { user: { select: userSelect } } },
          },
        },
        creator: { select: userSelect },
        versions: {
          select: { versionNumber: true },
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
        _count: { select: { versions: true } },
      },
    });
    if (!quarter) throw new NotFoundException('Quarter not found');
    return quarter;
  }

  private async toDetail(
    quarter: Awaited<ReturnType<QuartersService['loadQuarter']>>,
  ) {
    const participants = await this.resolveParticipants(quarter);
    const participantIds = participants.map((p) => p.id);
    const grid = this.buildGrid(quarter.sprints, quarter.epics, participantIds);
    const status = this.normalizeStatus(quarter.status);

    return {
      id: quarter.id,
      name: quarter.name,
      startDate: quarter.startDate,
      endDate: quarter.endDate,
      teamId: quarter.teamId,
      status,
      createdBy: quarter.createdBy,
      createdAt: quarter.createdAt,
      updatedAt: quarter.updatedAt,
      team: quarter.team,
      versionCount: quarter._count.versions,
      currentVersion: quarter.versions[0]?.versionNumber ?? null,
      sprints: quarter.sprints.map((s) => ({
        id: s.id,
        number: s.number,
        startDate: s.startDate,
        endDate: s.endDate,
        workingDays: countWeekdays(s.startDate, s.endDate),
      })),
      participants: participants.map((p) => ({
        ...p,
        cells: grid[p.id] || {},
      })),
      epics: quarter.epics.map((epic) => ({
        id: epic.id,
        title: epic.title,
        workingDays: epic.workingDays,
        startSprintNumber: epic.startSprintNumber,
        backgroundColor: epic.backgroundColor,
        createdAt: epic.createdAt,
        assignees: epic.assignees.map((a) => a.user),
      })),
    };
  }

  private async resolveParticipants(
    quarter: Awaited<ReturnType<QuartersService['loadQuarter']>>,
  ) {
    const byId = new Map<string, { id: string; name: string; email: string }>();

    if (quarter.teamId) {
      const members = await this.prisma.teamMember.findMany({
        where: { teamId: quarter.teamId },
        include: { user: { select: userSelect } },
        orderBy: { joinedAt: 'asc' },
      });
      for (const m of members) byId.set(m.user.id, m.user);
    } else {
      byId.set(quarter.creator.id, quarter.creator);
    }

    for (const epic of quarter.epics) {
      for (const assignee of epic.assignees) {
        if (!byId.has(assignee.user.id)) byId.set(assignee.user.id, assignee.user);
      }
    }

    return Array.from(byId.values());
  }

  private buildGrid(
    sprints: { id: string; number: number; startDate: Date; endDate: Date }[],
    epics: EpicWithAssignees[],
    participantIds: string[],
  ) {
    const capacity = new Map(
      sprints.map((s) => [s.id, Math.max(1, countWeekdays(s.startDate, s.endDate))]),
    );
    const remaining = new Map<string, Map<string, number>>();
    const grid: Record<string, Record<string, {
      epicId: string;
      title: string;
      backgroundColor: string;
      daysInSprint: number;
    }[]>> = {};

    for (const userId of participantIds) {
      remaining.set(userId, new Map(capacity));
      grid[userId] = {};
      for (const sprint of sprints) grid[userId][sprint.id] = [];
    }

    for (const epic of epics) {
      const startFrom = epic.startSprintNumber ?? 1;
      const eligible = sprints.filter((s) => s.number >= startFrom);
      for (const assignee of epic.assignees) {
        const userId = assignee.userId ?? assignee.user.id;
        if (!grid[userId]) continue;
        let daysLeft = epic.workingDays;

        for (const sprint of eligible) {
          if (daysLeft <= 0) break;
          const rem = remaining.get(userId)!.get(sprint.id) ?? 0;
          if (rem <= 0) continue;
          const used = Math.min(daysLeft, rem);
          grid[userId][sprint.id].push({
            epicId: epic.id,
            title: epic.title,
            backgroundColor: epic.backgroundColor,
            daysInSprint: used,
          });
          remaining.get(userId)!.set(sprint.id, rem - used);
          daysLeft -= used;
        }

        if (daysLeft > 0 && eligible.length) {
          const last = eligible[eligible.length - 1];
          const chips = grid[userId][last.id];
          const existing = chips.find((c) => c.epicId === epic.id);
          if (existing) existing.daysInSprint += daysLeft;
          else {
            chips.push({
              epicId: epic.id,
              title: epic.title,
              backgroundColor: epic.backgroundColor,
              daysInSprint: daysLeft,
            });
          }
        }
      }
    }

    return grid;
  }

  private normalizeStatus(status: string) {
    if (status === 'active') return 'draft';
    return status;
  }

  private parseRange(start: string, end: string) {
    const startDate = parseDateOnly(start);
    const endDate = parseDateOnly(end);
    this.assertRange(startDate, endDate);
    return { startDate, endDate };
  }

  private assertRange(startDate: Date, endDate: Date) {
    if (endDate < startDate) {
      throw new BadRequestException('End date must be on or after start date');
    }
  }

  private async resolveTeamId(userId: string, teamId?: string | null) {
    if (!teamId) return null;
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member) throw new ForbiddenException('You are not a member of this team');
    return teamId;
  }

  private async ensureCanView(
    quarter: { createdBy: string; teamId: string | null },
    userId: string,
  ) {
    if (quarter.createdBy === userId) return;
    if (!quarter.teamId) throw new ForbiddenException('Not allowed to view this quarter');
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: quarter.teamId, userId } },
    });
    if (!member) throw new ForbiddenException('Not allowed to view this quarter');
  }

  private ensureCreator(quarter: { createdBy: string }, userId: string) {
    if (quarter.createdBy !== userId) {
      throw new ForbiddenException('Only the project manager who created this quarter can change it');
    }
  }

  private ensureEditable(quarter: { status: string }) {
    const status = this.normalizeStatus(quarter.status);
    if (status === 'completed') {
      throw new BadRequestException('Cannot change a completed quarter');
    }
  }

  private assertStartSprint(
    quarter: { sprints: { number: number }[] },
    startSprintNumber: number,
  ) {
    const maxSprint = quarter.sprints[quarter.sprints.length - 1]?.number ?? 0;
    if (!maxSprint || startSprintNumber > maxSprint) {
      throw new BadRequestException(
        maxSprint
          ? `startSprintNumber must be between 1 and ${maxSprint}`
          : 'Quarter has no sprints to place an epic in',
      );
    }
  }

  private async ensureAssignable(
    quarter: { teamId: string | null },
    creatorId: string,
    assigneeIds: string[],
  ) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: assigneeIds } },
      select: { id: true },
    });
    if (users.length !== assigneeIds.length) {
      throw new BadRequestException('One or more assignees were not found');
    }

    if (quarter.teamId) {
      const members = await this.prisma.teamMember.findMany({
        where: { teamId: quarter.teamId, userId: { in: assigneeIds } },
        select: { userId: true },
      });
      if (members.length !== assigneeIds.length) {
        throw new BadRequestException('Assignees must be members of the quarter team');
      }
      return;
    }

    const memberships = await this.prisma.teamMember.findMany({
      where: { userId: creatorId },
      select: { teamId: true },
    });
    const teamIds = memberships.map((m) => m.teamId);
    const allowed = new Set<string>([creatorId]);
    if (teamIds.length) {
      const teammates = await this.prisma.teamMember.findMany({
        where: { teamId: { in: teamIds } },
        select: { userId: true },
      });
      for (const t of teammates) allowed.add(t.userId);
    }
    if (assigneeIds.some((id) => !allowed.has(id))) {
      throw new BadRequestException('Assignees must be teammates you can assign work to');
    }
  }
}
