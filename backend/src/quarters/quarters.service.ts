import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddQuarterParticipantDto,
  AssignEpicDto,
  CreateEpicDto,
  CreateHolidayDto,
  CreatePtoDto,
  CreateQuarterDto,
  UpdateEpicDto,
  UpdateQuarterDto,
} from './dto/quarter.dto';
import {
  countWeekdays,
  countWeekdaysOverlap,
  generateSprints,
  parseDateOnly,
} from './sprint.util';

const PTO_CHIP_COLOR = '#94a3b8';
const HOLIDAY_CHIP_COLOR = '#64748b';

const userSelect = { id: true, name: true, email: true };

type EpicWithAssignees = {
  id: string;
  groupKey: string | null;
  title: string;
  workingDays: number;
  startSprintNumber: number | null;
  backgroundColor: string;
  createdAt: Date | string;
  assignees: { userId?: string; user: { id: string; name: string; email: string } }[];
};

type PlanSnapshot = {
  name: string;
  startDate: string;
  endDate: string;
  teamId: string | null;
  teamIds: string[];
  team: { id: string; name: string } | null;
  teams: { id: string; name: string }[];
  participantUserIds: string[];
  sprints: {
    id: string;
    number: number;
    startDate: string;
    endDate: string;
  }[];
  epics: {
    id: string;
    groupKey: string | null;
    sourceEpicId: string | null;
    title: string;
    workingDays: number;
    startSprintNumber: number | null;
    backgroundColor: string;
    createdAt: string;
    assignees: { id: string; name: string; email: string }[];
  }[];
};

type SnapshotEpic = PlanSnapshot['epics'][number];

@Injectable()
export class QuartersService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateQuarterDto) {
    const { startDate, endDate } = this.parseRange(dto.startDate, dto.endDate);
    const teamIds = await this.resolveTeamIds(userId, dto.teamIds, dto.teamId);
    const userIds = await this.resolveParticipantUserIds(userId, dto.userIds);

    const quarter = await this.prisma.quarter.create({
      data: {
        name: dto.name.trim(),
        startDate,
        endDate,
        teamId: teamIds[0] ?? null,
        status: 'draft',
        createdBy: userId,
        sprints: { create: generateSprints(startDate, endDate) },
        quarterTeams: teamIds.length
          ? { create: teamIds.map((teamId) => ({ teamId })) }
          : undefined,
        participants: userIds.length
          ? { create: userIds.map((uid) => ({ userId: uid })) }
          : undefined,
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
        OR: [
          { createdBy: userId },
          { teamId: { in: teamIds } },
          { quarterTeams: { some: { teamId: { in: teamIds } } } },
          { participants: { some: { userId } } },
        ],
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
    return this.toDetail(quarter);
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

  async addParticipant(id: string, userId: string, dto: AddQuarterParticipantDto) {
    const quarter = await this.loadQuarter(id);
    this.ensureCreator(quarter, userId);
    this.ensureEditable(quarter);

    await this.ensureAssignable(quarter, userId, [dto.userId]);

    const existing = quarter.participants.find((p) => p.userId === dto.userId);
    if (existing) {
      throw new BadRequestException('User is already a quarter participant');
    }

    await this.prisma.quarterParticipant.create({
      data: { quarterId: id, userId: dto.userId },
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

    const assigneeIds = dto.assigneeIds ? [...new Set(dto.assigneeIds)] : [];
    const startSprintNumber = dto.startSprintNumber ?? null;

    if (startSprintNumber !== null) {
      this.assertStartSprint(quarter, startSprintNumber);
    }

    if (assigneeIds.length) {
      await this.ensureAssignable(quarter, userId, assigneeIds);
    }

    if (!assigneeIds.length) {
      await this.prisma.epic.create({
        data: {
          quarterId,
          title: dto.title.trim(),
          workingDays: dto.workingDays,
          startSprintNumber,
          backgroundColor: dto.backgroundColor.toLowerCase(),
          createdBy: userId,
        },
      });
    } else {
      const groupKey = randomUUID();
      await this.prisma.$transaction(
        assigneeIds.map((assigneeId) =>
          this.prisma.epic.create({
            data: {
              quarterId,
              groupKey,
              title: dto.title.trim(),
              workingDays: dto.workingDays,
              startSprintNumber,
              backgroundColor: dto.backgroundColor.toLowerCase(),
              createdBy: userId,
              assignees: { create: { userId: assigneeId } },
            },
          }),
        ),
      );
    }

    await this.maybeVersionAfterChange(quarterId, userId);
    return this.findOne(quarterId, userId);
  }

  async assignEpic(
    quarterId: string,
    templateEpicId: string,
    userId: string,
    dto: AssignEpicDto,
  ) {
    const quarter = await this.loadQuarter(quarterId);
    this.ensureCreator(quarter, userId);
    this.ensureEditable(quarter);

    const template = quarter.epics.find((e) => e.id === templateEpicId);
    if (!template) throw new NotFoundException('Epic not found');
    if (!this.isBacklogTemplate(template)) {
      throw new BadRequestException('Only backlog epics can be assigned from the list');
    }

    this.assertStartSprint(quarter, dto.startSprintNumber);
    await this.ensureAssignable(quarter, userId, [dto.assigneeId]);

    const duplicate = await this.prisma.epic.findFirst({
      where: {
        sourceEpicId: templateEpicId,
        assignees: { some: { userId: dto.assigneeId } },
      },
    });
    if (duplicate) {
      throw new BadRequestException('This epic is already assigned to that user');
    }

    await this.prisma.epic.create({
      data: {
        quarterId,
        sourceEpicId: templateEpicId,
        groupKey: template.groupKey ?? templateEpicId,
        title: template.title,
        workingDays: template.workingDays,
        startSprintNumber: dto.startSprintNumber,
        backgroundColor: template.backgroundColor,
        createdBy: userId,
        assignees: { create: { userId: dto.assigneeId } },
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

    const assigneeIds = dto.assigneeIds ? [...new Set(dto.assigneeIds)] : undefined;
    if (assigneeIds) {
      if (assigneeIds.length > 1) {
        throw new BadRequestException('Each epic entry has at most one assignee');
      }
      if (assigneeIds.length === 1) {
        await this.ensureAssignable(quarter, userId, assigneeIds);
        if (epic.sourceEpicId) {
          const duplicate = await this.prisma.epic.findFirst({
            where: {
              sourceEpicId: epic.sourceEpicId,
              id: { not: epicId },
              assignees: { some: { userId: assigneeIds[0] } },
            },
          });
          if (duplicate) {
            throw new BadRequestException('This epic is already assigned to that user');
          }
        }
      }
    }

    if (dto.startSprintNumber !== undefined && dto.startSprintNumber !== null) {
      this.assertStartSprint(quarter, dto.startSprintNumber);
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

      if (assigneeIds !== undefined) {
        await tx.epicAssignee.deleteMany({ where: { epicId } });
        if (assigneeIds.length) {
          await tx.epicAssignee.createMany({
            data: assigneeIds.map((id) => ({ epicId, userId: id })),
          });
        }
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

  async addHoliday(quarterId: string, userId: string, dto: CreateHolidayDto) {
    const quarter = await this.loadQuarter(quarterId);
    this.ensureCreator(quarter, userId);
    this.ensureEditable(quarter);

    const { startDate, endDate } = this.parseRange(dto.startDate, dto.endDate);
    this.assertWithinQuarter(quarter, startDate, endDate);

    const participants = await this.resolveParticipants(quarter);
    if (!participants.length) {
      throw new BadRequestException('Add participants before creating a holiday');
    }

    const name = (dto.name?.trim() || 'Holiday').slice(0, 200);
    const groupKey = randomUUID();
    await this.prisma.quarterHoliday.createMany({
      data: participants.map((p) => ({
        quarterId,
        userId: p.id,
        groupKey,
        name,
        startDate,
        endDate,
        createdBy: userId,
      })),
    });

    await this.maybeVersionAfterChange(quarterId, userId);
    return this.findOne(quarterId, userId);
  }

  async deleteHoliday(quarterId: string, holidayId: string, userId: string) {
    const quarter = await this.loadQuarter(quarterId);
    this.ensureCreator(quarter, userId);
    this.ensureEditable(quarter);

    const holiday = quarter.holidays.find((h) => h.id === holidayId);
    if (!holiday) throw new NotFoundException('Holiday not found');

    await this.prisma.quarterHoliday.delete({ where: { id: holidayId } });
    await this.maybeVersionAfterChange(quarterId, userId);
    return this.findOne(quarterId, userId);
  }

  async deleteHolidayGroup(quarterId: string, groupKey: string, userId: string) {
    const quarter = await this.loadQuarter(quarterId);
    this.ensureCreator(quarter, userId);
    this.ensureEditable(quarter);

    const matching = quarter.holidays.filter((h) => h.groupKey === groupKey);
    if (!matching.length) throw new NotFoundException('Holiday not found');

    await this.prisma.quarterHoliday.deleteMany({
      where: { quarterId, groupKey },
    });
    await this.maybeVersionAfterChange(quarterId, userId);
    return this.findOne(quarterId, userId);
  }

  async addPto(quarterId: string, userId: string, dto: CreatePtoDto) {
    const quarter = await this.loadQuarter(quarterId);
    this.ensureCreator(quarter, userId);
    this.ensureEditable(quarter);

    const { startDate, endDate } = this.parseRange(dto.startDate, dto.endDate);
    this.assertWithinQuarter(quarter, startDate, endDate);

    const targetUserIds = await this.resolvePtoTargetUserIds(quarter, userId, dto);
    if (!targetUserIds.length) {
      throw new BadRequestException('Select a team or at least one user for PTO');
    }

    const name = (dto.name?.trim() || 'PTO').slice(0, 200);
    await this.prisma.quarterPto.createMany({
      data: targetUserIds.map((uid) => ({
        quarterId,
        userId: uid,
        name,
        startDate,
        endDate,
        createdBy: userId,
      })),
    });

    await this.maybeVersionAfterChange(quarterId, userId);
    return this.findOne(quarterId, userId);
  }

  async deletePto(quarterId: string, ptoId: string, userId: string) {
    const quarter = await this.loadQuarter(quarterId);
    this.ensureCreator(quarter, userId);
    this.ensureEditable(quarter);

    const pto = quarter.ptos.find((p) => p.id === ptoId);
    if (!pto) throw new NotFoundException('PTO entry not found');

    await this.prisma.quarterPto.delete({ where: { id: ptoId } });
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
    const teams = quarter.quarterTeams.map((qt) => qt.team);
    return {
      name: quarter.name,
      startDate: quarter.startDate.toISOString(),
      endDate: quarter.endDate.toISOString(),
      teamId: quarter.teamId,
      teamIds: teams.map((t) => t.id),
      team: quarter.team,
      teams,
      participantUserIds: quarter.participants.map((p) => p.userId),
      sprints: quarter.sprints.map((s) => ({
        id: s.id,
        number: s.number,
        startDate: s.startDate.toISOString(),
        endDate: s.endDate.toISOString(),
      })),
      epics: quarter.epics.map((epic) => ({
        id: epic.id,
        groupKey: epic.groupKey,
        sourceEpicId: epic.sourceEpicId,
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

    const originalSnapshot = JSON.parse(versions[0].snapshot) as PlanSnapshot;
    const latestSnapshot = JSON.parse(versions[versions.length - 1].snapshot) as PlanSnapshot;

    const original = await this.planFromSnapshot(originalSnapshot);
    const latest = await this.planFromSnapshot(latestSnapshot);
    const stats = this.computeComparisonStats(
      this.scheduledEpics(originalSnapshot.epics),
      this.scheduledEpics(latestSnapshot.epics),
    );

    return {
      original,
      latest,
      originalVersion: versions[0].versionNumber,
      latestVersion: versions[versions.length - 1].versionNumber,
      stats,
    };
  }

  private toComparisonEpicEntry(
    epic: SnapshotEpic,
    status: 'unchanged' | 'changed' | 'added' | 'removed',
    changes?: string[],
  ) {
    return {
      id: epic.id,
      title: epic.title,
      assignee: epic.assignees[0]?.name ?? null,
      workingDays: epic.workingDays,
      startSprintNumber: epic.startSprintNumber,
      status,
      changes: changes ?? [],
    };
  }

  private describeEpicChanges(orig: SnapshotEpic, latest: SnapshotEpic) {
    const changes: string[] = [];
    if (orig.title !== latest.title) changes.push(`Title: "${orig.title}" → "${latest.title}"`);
    if (orig.workingDays !== latest.workingDays) {
      changes.push(`Working days: ${orig.workingDays} → ${latest.workingDays}`);
    }
    if (orig.startSprintNumber !== latest.startSprintNumber) {
      const from = orig.startSprintNumber ?? 'unscheduled';
      const to = latest.startSprintNumber ?? 'unscheduled';
      changes.push(`Start sprint: ${from} → ${to}`);
    }
    const origAssignee = orig.assignees[0]?.name ?? 'unassigned';
    const latestAssignee = latest.assignees[0]?.name ?? 'unassigned';
    if (origAssignee !== latestAssignee) changes.push(`Assignee: ${origAssignee} → ${latestAssignee}`);
    if (orig.backgroundColor !== latest.backgroundColor) changes.push('Color changed');
    return changes;
  }

  private scheduledEpics(epics: SnapshotEpic[]) {
    return epics.filter((e) => e.assignees.length > 0 && e.startSprintNumber != null);
  }

  private computeComparisonStats(originalEpics: SnapshotEpic[], latestEpics: SnapshotEpic[]) {
    const originalTotalWorkingDays = originalEpics.reduce((sum, e) => sum + e.workingDays, 0);
    const latestTotalWorkingDays = latestEpics.reduce((sum, e) => sum + e.workingDays, 0);

    const usedLatest = new Set<string>();
    const matchedOriginal = new Set<string>();

    let unchangedCount = 0;
    let changedCount = 0;
    let extendedEpicCount = 0;
    const unchangedEpics: ReturnType<QuartersService['toComparisonEpicEntry']>[] = [];
    const changedEpics: ReturnType<QuartersService['toComparisonEpicEntry']>[] = [];

    for (const orig of originalEpics) {
      const match = this.findLatestMatch(orig, latestEpics, usedLatest);
      if (!match) {
        changedCount++;
        changedEpics.push(this.toComparisonEpicEntry(orig, 'removed', ['Removed from plan']));
        continue;
      }
      usedLatest.add(match.id);
      matchedOriginal.add(orig.id);
      if (this.epicsEqual(orig, match)) {
        unchangedCount++;
        unchangedEpics.push(this.toComparisonEpicEntry(orig, 'unchanged'));
      } else {
        changedCount++;
        const changes = this.describeEpicChanges(orig, match);
        changedEpics.push(this.toComparisonEpicEntry(match, 'changed', changes));
        if (match.workingDays > orig.workingDays) {
          extendedEpicCount++;
        }
      }
    }

    let addedCount = 0;
    for (const epic of latestEpics) {
      if (usedLatest.has(epic.id)) continue;
      const origMatch = this.findOriginalMatch(epic, originalEpics, matchedOriginal);
      if (!origMatch) {
        addedCount++;
        changedCount++;
        changedEpics.push(this.toComparisonEpicEntry(epic, 'added', ['Added to plan']));
      }
    }

    return {
      unchangedCount,
      changedCount,
      addedCount,
      removedCount: originalEpics.filter((o) => !matchedOriginal.has(o.id)).length,
      originalTotalWorkingDays,
      latestTotalWorkingDays,
      workingDaysDiff: latestTotalWorkingDays - originalTotalWorkingDays,
      extendedEpicCount,
      unchangedEpics,
      changedEpics,
    };
  }

  private findLatestMatch(
    orig: SnapshotEpic,
    latestEpics: SnapshotEpic[],
    usedLatest: Set<string>,
  ): SnapshotEpic | undefined {
    const assigneeId = orig.assignees[0]?.id ?? '';
    const candidates = latestEpics.filter((e) => !usedLatest.has(e.id));

    const byKey = candidates.find((e) => this.epicMatchKey(e) === this.epicMatchKey(orig));
    if (byKey) return byKey;

    const byTitle = candidates.find(
      (e) =>
        e.title === orig.title &&
        (e.assignees[0]?.id ?? '') === assigneeId,
    );
    if (byTitle) return byTitle;

    const byTemplate = candidates.find(
      (e) => e.groupKey === orig.id && (e.assignees[0]?.id ?? '') === assigneeId,
    );
    if (byTemplate) return byTemplate;

    if (orig.groupKey) {
      const byGroup = candidates.find(
        (e) => e.groupKey === orig.groupKey && (e.assignees[0]?.id ?? '') === assigneeId,
      );
      if (byGroup) return byGroup;
    }

    if (orig.sourceEpicId) {
      const bySource = candidates.find(
        (e) =>
          (e.id === orig.sourceEpicId || e.groupKey === orig.sourceEpicId) &&
          (e.assignees[0]?.id ?? '') === assigneeId,
      );
      if (bySource) return bySource;
    }

    return undefined;
  }

  private findOriginalMatch(
    latest: SnapshotEpic,
    originalEpics: SnapshotEpic[],
    matchedOriginal: Set<string>,
  ): SnapshotEpic | undefined {
    const assigneeId = latest.assignees[0]?.id ?? '';
    const candidates = originalEpics.filter((e) => !matchedOriginal.has(e.id));

    const byKey = candidates.find((e) => this.epicMatchKey(e) === this.epicMatchKey(latest));
    if (byKey) return byKey;

    const byTitle = candidates.find(
      (e) =>
        e.title === latest.title &&
        (e.assignees[0]?.id ?? '') === assigneeId,
    );
    if (byTitle) return byTitle;

    if (latest.groupKey) {
      const byGroup = candidates.find(
        (e) =>
          (e.id === latest.groupKey || e.groupKey === latest.groupKey) &&
          (e.assignees[0]?.id ?? '') === assigneeId,
      );
      if (byGroup) return byGroup;
    }

    return undefined;
  }

  private epicMatchKey(epic: SnapshotEpic) {
    const assigneeId = epic.assignees[0]?.id ?? '';
    if (epic.groupKey) return `${epic.groupKey}:${assigneeId}`;
    return `${epic.id}:${assigneeId}`;
  }

  private epicsEqual(a: SnapshotEpic, b: SnapshotEpic) {
    const aAssignee = a.assignees[0]?.id ?? '';
    const bAssignee = b.assignees[0]?.id ?? '';
    return (
      a.title === b.title &&
      a.workingDays === b.workingDays &&
      a.startSprintNumber === b.startSprintNumber &&
      a.backgroundColor === b.backgroundColor &&
      aAssignee === bAssignee
    );
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
      groupKey: epic.groupKey ?? null,
      title: epic.title,
      workingDays: epic.workingDays,
      startSprintNumber: epic.startSprintNumber,
      backgroundColor: epic.backgroundColor,
      createdAt: epic.createdAt,
      assignees: epic.assignees.map((user) => ({ userId: user.id, user })),
    }));

    const participants = await this.resolveParticipantsFromSnapshot(snapshot);
    const participantIds = participants.map((p) => p.id);
    const grid = this.buildGrid(sprints, epics, participantIds, [], []);

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

    const teamIds = snapshot.teamIds?.length
      ? snapshot.teamIds
      : snapshot.teamId
        ? [snapshot.teamId]
        : [];

    if (teamIds.length) {
      const members = await this.prisma.teamMember.findMany({
        where: { teamId: { in: teamIds } },
        include: { user: { select: userSelect } },
        orderBy: { joinedAt: 'asc' },
      });
      for (const m of members) byId.set(m.user.id, m.user);
    }

    if (snapshot.participantUserIds?.length) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: snapshot.participantUserIds } },
        select: userSelect,
      });
      for (const user of users) byId.set(user.id, user);
    }

    for (const epic of snapshot.epics) {
      for (const user of epic.assignees) {
        if (!byId.has(user.id)) byId.set(user.id, user);
      }
    }

    return Array.from(byId.values());
  }

  private async loadQuarter(id: string) {
    const quarter = await this.prisma.quarter.findUnique({
      where: { id },
      include: {
        team: { select: { id: true, name: true } },
        quarterTeams: { include: { team: { select: { id: true, name: true } } } },
        participants: { include: { user: { select: userSelect } } },
        sprints: { orderBy: { number: 'asc' } },
        epics: {
          orderBy: { createdAt: 'asc' },
          include: {
            assignees: { include: { user: { select: userSelect } } },
          },
        },
        holidays: {
          orderBy: { startDate: 'asc' },
          include: { user: { select: userSelect } },
        },
        ptos: {
          orderBy: { startDate: 'asc' },
          include: { user: { select: userSelect } },
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
    const holidays = quarter.holidays;
    const ptos = quarter.ptos;
    const grid = this.buildGrid(
      quarter.sprints,
      quarter.epics,
      participantIds,
      ptos,
      holidays,
    );
    const capacity = this.computeCapacity(
      quarter.sprints,
      participants,
      ptos,
      holidays,
      quarter.epics,
    );
    const capacityByUser = new Map(capacity.map((c) => [c.userId, c]));
    const status = this.normalizeStatus(quarter.status);
    const teams = quarter.quarterTeams.map((qt) => qt.team);

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
      teams,
      addedParticipants: quarter.participants.map((p) => p.user),
      versionCount: quarter._count.versions,
      currentVersion: quarter.versions[0]?.versionNumber ?? null,
      sprints: quarter.sprints.map((s) => ({
        id: s.id,
        number: s.number,
        startDate: s.startDate,
        endDate: s.endDate,
        workingDays: countWeekdays(s.startDate, s.endDate),
      })),
      participants: participants.map((p) => {
        const cap = capacityByUser.get(p.id);
        return {
          ...p,
          cells: grid[p.id] || {},
          epicDaysAssigned: cap?.epicDaysAssigned ?? 0,
          totalWorkingDays: cap?.totalCapacity ?? 0,
        };
      }),
      capacity,
      holidays: this.groupHolidays(holidays, quarter.sprints),
      ptos: ptos.map((p) => ({
        id: p.id,
        name: p.name,
        startDate: p.startDate,
        endDate: p.endDate,
        userId: p.userId,
        user: p.user,
        workingDays: this.ptoWorkingDays(p, quarter.sprints),
      })),
      epics: quarter.epics.map((epic) => ({
        id: epic.id,
        groupKey: epic.groupKey,
        sourceEpicId: epic.sourceEpicId,
        title: epic.title,
        workingDays: epic.workingDays,
        startSprintNumber: epic.startSprintNumber,
        backgroundColor: epic.backgroundColor,
        createdAt: epic.createdAt,
        assignees: epic.assignees.map((a) => a.user),
      })),
    };
  }

  private groupHolidays(
    holidays: {
      id: string;
      groupKey: string;
      name: string;
      startDate: Date;
      endDate: Date;
      userId: string;
    }[],
    sprints: { startDate: Date; endDate: Date }[],
  ) {
    const byGroup = new Map<
      string,
      {
        groupKey: string;
        name: string;
        startDate: Date;
        endDate: Date;
        userIds: string[];
      }
    >();

    for (const holiday of holidays) {
      const existing = byGroup.get(holiday.groupKey);
      if (existing) {
        existing.userIds.push(holiday.userId);
      } else {
        byGroup.set(holiday.groupKey, {
          groupKey: holiday.groupKey,
          name: holiday.name,
          startDate: holiday.startDate,
          endDate: holiday.endDate,
          userIds: [holiday.userId],
        });
      }
    }

    return Array.from(byGroup.values()).map((group) => ({
      id: group.groupKey,
      groupKey: group.groupKey,
      name: group.name,
      startDate: group.startDate,
      endDate: group.endDate,
      workingDays: this.holidayWorkingDays(group, sprints),
      userCount: group.userIds.length,
    }));
  }

  private isBacklogTemplate(epic: {
    sourceEpicId: string | null;
    assignees: unknown[];
    startSprintNumber: number | null;
  }) {
    return !epic.sourceEpicId && !epic.assignees.length && epic.startSprintNumber == null;
  }

  async listAddableParticipants(id: string, userId: string) {
    const quarter = await this.loadQuarter(id);
    this.ensureCreator(quarter, userId);
    this.ensureEditable(quarter);

    const onPlan = await this.resolveParticipants(quarter);
    const onPlanIds = new Set(onPlan.map((p) => p.id));
    const allowed = await this.getAllowedAssigneeIds(userId, quarter);

    const users = await this.prisma.user.findMany({
      where: { id: { in: Array.from(allowed) } },
      select: userSelect,
      orderBy: { name: 'asc' },
    });

    return users.filter((user) => !onPlanIds.has(user.id));
  }

  private async resolveParticipants(
    quarter: Awaited<ReturnType<QuartersService['loadQuarter']>>,
  ) {
    const byId = new Map<string, { id: string; name: string; email: string }>();
    byId.set(quarter.creator.id, quarter.creator);

    const teamIds = quarter.quarterTeams.length
      ? quarter.quarterTeams.map((qt) => qt.teamId)
      : quarter.teamId
        ? [quarter.teamId]
        : [];

    if (teamIds.length) {
      const members = await this.prisma.teamMember.findMany({
        where: { teamId: { in: teamIds } },
        include: { user: { select: userSelect } },
        orderBy: { joinedAt: 'asc' },
      });
      for (const m of members) byId.set(m.user.id, m.user);
    }

    for (const participant of quarter.participants) {
      byId.set(participant.user.id, participant.user);
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
    ptos: { id: string; userId: string; name: string; startDate: Date; endDate: Date }[],
    holidays: { id: string; userId: string; name: string; startDate: Date; endDate: Date }[],
  ) {
    const grid: Record<string, Record<string, {
      type: 'epic' | 'pto' | 'holiday';
      id: string;
      title: string;
      backgroundColor: string;
      daysInSprint: number;
    }[]>> = {};

    const remaining = new Map<string, Map<string, number>>();

    for (const userId of participantIds) {
      remaining.set(userId, new Map());
      grid[userId] = {};
      for (const sprint of sprints) {
        grid[userId][sprint.id] = [];
        remaining.get(userId)!.set(
          sprint.id,
          Math.max(0, countWeekdays(sprint.startDate, sprint.endDate)),
        );
      }
    }

    for (const holiday of holidays) {
      if (!grid[holiday.userId]) continue;
      for (const sprint of sprints) {
        const days = countWeekdaysOverlap(
          holiday.startDate,
          holiday.endDate,
          sprint.startDate,
          sprint.endDate,
        );
        if (days <= 0) continue;
        grid[holiday.userId][sprint.id].push({
          type: 'holiday',
          id: holiday.id,
          title: holiday.name,
          backgroundColor: HOLIDAY_CHIP_COLOR,
          daysInSprint: days,
        });
        const rem = remaining.get(holiday.userId)!.get(sprint.id) ?? 0;
        remaining.get(holiday.userId)!.set(sprint.id, Math.max(0, rem - days));
      }
    }

    for (const pto of ptos) {
      if (!grid[pto.userId]) continue;
      for (const sprint of sprints) {
        const days = countWeekdaysOverlap(
          pto.startDate,
          pto.endDate,
          sprint.startDate,
          sprint.endDate,
        );
        if (days <= 0) continue;
        grid[pto.userId][sprint.id].push({
          type: 'pto',
          id: pto.id,
          title: pto.name,
          backgroundColor: PTO_CHIP_COLOR,
          daysInSprint: days,
        });
        const rem = remaining.get(pto.userId)!.get(sprint.id) ?? 0;
        remaining.get(pto.userId)!.set(sprint.id, Math.max(0, rem - days));
      }
    }

    for (const epic of epics) {
      if (!epic.assignees.length || epic.startSprintNumber == null) continue;
      const startFrom = epic.startSprintNumber;
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
            type: 'epic',
            id: epic.id,
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
          const existing = chips.find((c) => c.type === 'epic' && c.id === epic.id);
          if (existing) existing.daysInSprint += daysLeft;
          else {
            chips.push({
              type: 'epic',
              id: epic.id,
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

  private quarterSpan(sprints: { startDate: Date; endDate: Date }[]) {
    if (!sprints.length) return null;
    return { start: sprints[0].startDate, end: sprints[sprints.length - 1].endDate };
  }

  private holidayWorkingDays(
    holiday: { startDate: Date; endDate: Date },
    sprints: { startDate: Date; endDate: Date }[],
  ) {
    const span = this.quarterSpan(sprints);
    if (!span) return 0;
    return countWeekdaysOverlap(holiday.startDate, holiday.endDate, span.start, span.end);
  }

  private ptoWorkingDays(
    pto: { startDate: Date; endDate: Date },
    sprints: { startDate: Date; endDate: Date }[],
  ) {
    const span = this.quarterSpan(sprints);
    if (!span) return 0;
    return countWeekdaysOverlap(pto.startDate, pto.endDate, span.start, span.end);
  }

  private computeCapacity(
    sprints: { startDate: Date; endDate: Date }[],
    participants: { id: string; name: string }[],
    ptos: { userId: string; startDate: Date; endDate: Date }[],
    holidays: { userId: string; startDate: Date; endDate: Date }[],
    epics: EpicWithAssignees[],
  ) {
    const span = this.quarterSpan(sprints);
    const totalSprintDays = sprints.reduce(
      (sum, s) => sum + countWeekdays(s.startDate, s.endDate),
      0,
    );

    return participants.map((person) => {
      const userPtos = ptos.filter((p) => p.userId === person.id);
      const userHolidays = holidays.filter((h) => h.userId === person.id);
      const ptoDays = span
        ? userPtos.reduce(
            (sum, p) =>
              sum + countWeekdaysOverlap(p.startDate, p.endDate, span.start, span.end),
            0,
          )
        : 0;
      const holidayDays = span
        ? userHolidays.reduce(
            (sum, h) =>
              sum + countWeekdaysOverlap(h.startDate, h.endDate, span.start, span.end),
            0,
          )
        : 0;
      const epicDaysAssigned = epics
        .filter(
          (e) =>
            e.startSprintNumber != null &&
            e.assignees.some((a) => (a.userId ?? a.user.id) === person.id),
        )
        .reduce((sum, e) => sum + e.workingDays, 0);

      return {
        userId: person.id,
        name: person.name,
        ptoDays,
        holidayDays,
        totalCapacity: Math.max(0, totalSprintDays - holidayDays - ptoDays),
        epicDaysAssigned,
      };
    });
  }

  private assertWithinQuarter(
    quarter: { startDate: Date; endDate: Date },
    startDate: Date,
    endDate: Date,
  ) {
    const qStart = parseDateOnly(quarter.startDate);
    const qEnd = parseDateOnly(quarter.endDate);
    if (startDate < qStart || endDate > qEnd) {
      throw new BadRequestException('Dates must fall within the quarter range');
    }
  }

  private async resolvePtoTargetUserIds(
    quarter: Awaited<ReturnType<QuartersService['loadQuarter']>>,
    creatorId: string,
    dto: CreatePtoDto,
  ) {
    if (dto.teamId && dto.userIds?.length) {
      throw new BadRequestException('Assign PTO to either a team or individual users, not both');
    }

    if (dto.teamId) {
      const linkedTeamIds = quarter.quarterTeams.map((qt) => qt.teamId);
      if (quarter.teamId) linkedTeamIds.push(quarter.teamId);
      if (!linkedTeamIds.includes(dto.teamId)) {
        throw new BadRequestException('Team is not linked to this quarter');
      }
      await this.resolveTeamId(creatorId, dto.teamId);
      const members = await this.prisma.teamMember.findMany({
        where: { teamId: dto.teamId },
        select: { userId: true },
      });
      return [...new Set(members.map((m) => m.userId))];
    }

    if (dto.userIds?.length) {
      const unique = [...new Set(dto.userIds)];
      await this.ensureAssignable(quarter, creatorId, unique);
      return unique;
    }

    return [];
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

  private async resolveTeamIds(userId: string, teamIds?: string[], teamId?: string) {
    const ids = [...new Set([...(teamIds ?? []), ...(teamId ? [teamId] : [])])];
    for (const id of ids) {
      await this.resolveTeamId(userId, id);
    }
    return ids;
  }

  private async resolveParticipantUserIds(userId: string, userIds?: string[]) {
    if (!userIds?.length) return [];
    const unique = [...new Set(userIds)];
    await this.ensureTeammates(userId, unique);
    return unique;
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
    quarter: {
      id: string;
      createdBy: string;
      teamId: string | null;
      quarterTeams: { teamId: string }[];
      participants: { userId: string }[];
    },
    userId: string,
  ) {
    if (quarter.createdBy === userId) return;
    if (quarter.participants.some((p) => p.userId === userId)) return;

    const teamIds = quarter.quarterTeams.length
      ? quarter.quarterTeams.map((qt) => qt.teamId)
      : quarter.teamId
        ? [quarter.teamId]
        : [];

    if (!teamIds.length) throw new ForbiddenException('Not allowed to view this quarter');

    const member = await this.prisma.teamMember.findFirst({
      where: { teamId: { in: teamIds }, userId },
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
    quarter: {
      teamId: string | null;
      participants: { userId: string }[];
    },
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

    const allowed = await this.getAllowedAssigneeIds(creatorId, quarter);
    if (assigneeIds.some((id) => !allowed.has(id))) {
      throw new BadRequestException('Assignees must be teammates you can assign work to');
    }
  }

  private async ensureTeammates(creatorId: string, userIds: string[]) {
    const allowed = await this.getAllowedAssigneeIds(creatorId, { participants: [] });
    if (userIds.some((id) => !allowed.has(id))) {
      throw new BadRequestException('Users must be teammates you can assign work to');
    }
  }

  private async getAllowedAssigneeIds(
    creatorId: string,
    quarter: { participants: { userId: string }[] },
  ) {
    const allowed = new Set<string>([creatorId]);
    for (const p of quarter.participants) allowed.add(p.userId);

    const memberships = await this.prisma.teamMember.findMany({
      where: { userId: creatorId },
      select: { teamId: true },
    });
    const teamIds = memberships.map((m) => m.teamId);
    if (teamIds.length) {
      const teammates = await this.prisma.teamMember.findMany({
        where: { teamId: { in: teamIds } },
        select: { userId: true },
      });
      for (const t of teammates) allowed.add(t.userId);
    }
    return allowed;
  }
}
