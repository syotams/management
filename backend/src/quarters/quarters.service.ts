import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEpicDto, CreateQuarterDto, UpdateQuarterDto } from './dto/quarter.dto';
import { countWeekdays, generateSprints, parseDateOnly } from './sprint.util';

const userSelect = { id: true, name: true, email: true };

type EpicWithAssignees = {
  id: string;
  title: string;
  workingDays: number;
  startSprintNumber: number;
  backgroundColor: string;
  createdAt: Date;
  assignees: { userId: string; user: { id: string; name: string; email: string } }[];
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
        _count: { select: { sprints: true, epics: true } },
      },
      orderBy: { startDate: 'desc' },
    });

    return quarters;
  }

  async findOne(id: string, userId: string) {
    const quarter = await this.loadQuarter(id);
    await this.ensureCanView(quarter, userId);
    return this.toDetail(quarter);
  }

  async update(id: string, userId: string, dto: UpdateQuarterDto) {
    const quarter = await this.loadQuarter(id);
    this.ensureCreator(quarter, userId);

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

    return this.findOne(id, userId);
  }

  async complete(id: string, userId: string) {
    const quarter = await this.loadQuarter(id);
    this.ensureCreator(quarter, userId);
    if (quarter.status === 'completed') {
      throw new BadRequestException('Quarter is already completed');
    }

    await this.prisma.quarter.update({
      where: { id },
      data: { status: 'completed' },
    });

    return this.findOne(id, userId);
  }

  async addEpic(quarterId: string, userId: string, dto: CreateEpicDto) {
    const quarter = await this.loadQuarter(quarterId);
    this.ensureCreator(quarter, userId);
    if (quarter.status === 'completed') {
      throw new BadRequestException('Cannot add epics to a completed quarter');
    }

    const maxSprint = quarter.sprints[quarter.sprints.length - 1]?.number ?? 0;
    if (!maxSprint || dto.startSprintNumber > maxSprint) {
      throw new BadRequestException(
        maxSprint
          ? `startSprintNumber must be between 1 and ${maxSprint}`
          : 'Quarter has no sprints to place an epic in',
      );
    }

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

    return this.findOne(quarterId, userId);
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

    return {
      id: quarter.id,
      name: quarter.name,
      startDate: quarter.startDate,
      endDate: quarter.endDate,
      teamId: quarter.teamId,
      status: quarter.status,
      createdBy: quarter.createdBy,
      createdAt: quarter.createdAt,
      updatedAt: quarter.updatedAt,
      team: quarter.team,
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
        const userId = assignee.userId;
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
