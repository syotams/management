import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddProjectParticipantDto,
  AssignEpicDto,
  CreateEpicDto,
  CreateHolidayDto,
  CreatePtoDto,
  CreateProjectDto,
  UpdateEpicDto,
  UpdateProjectDto,
} from './dto/project.dto';
import {
  countInclusiveDaysOverlap,
  countWeekdays,
  DEFAULT_MAX_WORKING_DAYS_PER_SPRINT,
  generateSprints,
  MAX_MAX_WORKING_DAYS_PER_SPRINT,
  MIN_MAX_WORKING_DAYS_PER_SPRINT,
  paintAssignmentWeeks,
  parseDateOnly,
  planAssignmentSpan,
  sprintWeekSlots,
  type SprintWeekNumber,
} from './sprint.util';

const PTO_CHIP_COLOR = '#94a3b8';
const HOLIDAY_CHIP_COLOR = '#64748b';

const userSelect = { id: true, name: true, email: true };

type EpicWithAssignees = {
  id: string;
  groupKey: string | null;
  sourceEpicId?: string | null;
  title: string;
  workingDays: number;
  priority: number;
  startSprintNumber: number | null;
  startSprintWeek: number | null;
  backgroundColor: string;
  createdAt: Date | string;
  assignees: { userId?: string; user: { id: string; name: string; email: string } }[];
};

type PlanSnapshot = {
  name: string;
  maxWorkingDaysPerSprint?: number;
  startDate: string;
  endDate: string;
  teamId: string | null;
  teamIds: string[];
  team: { id: string; name: string } | null;
  teams: { id: string; name: string }[];
  participantUserIds: string[];
  explicitRoster?: boolean;
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
    priority?: number;
    startSprintNumber: number | null;
    startSprintWeek?: number | null;
    backgroundColor: string;
    createdAt: string;
    assignees: { id: string; name: string; email: string }[];
  }[];
};

type SnapshotEpic = PlanSnapshot['epics'][number];

function assignmentCreatedAt(value: Date | string): number {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateProjectDto) {
    if (dto.maxWorkingDaysPerSprint !== undefined) {
      this.assertMaxWorkingDaysPerSprint(dto.maxWorkingDaysPerSprint);
    }
    const { startDate, endDate } = this.parseRange(dto.startDate, dto.endDate);
    const teamIds = await this.resolveTeamIds(userId, dto.teamIds, dto.teamId);
    const selectedUserIds = await this.resolveParticipantUserIds(userId, dto.userIds);
    const roster = await this.buildCreateRoster(userId, teamIds, selectedUserIds);
    const addedAtBase = Date.now();

    const project = await this.prisma.project.create({
      data: {
        name: dto.name.trim(),
        startDate,
        endDate,
        ...(dto.maxWorkingDaysPerSprint !== undefined
          ? { maxWorkingDaysPerSprint: dto.maxWorkingDaysPerSprint }
          : {}),
        teamId: teamIds[0] ?? null,
        status: 'draft',
        createdBy: userId,
        sprints: { create: generateSprints(startDate, endDate) },
        projectTeams: teamIds.length
          ? { create: teamIds.map((teamId) => ({ teamId })) }
          : undefined,
        participants: {
          create: roster.map((uid, index) => ({
            userId: uid,
            addedAt: new Date(addedAtBase + index),
          })),
        },
      },
    });

    return this.findOne(project.id, userId);
  }

  async findAll(userId: string) {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    });
    const teamIds = memberships.map((m) => m.teamId);

    const projects = await this.prisma.project.findMany({
      where: {
        OR: [
          { createdBy: userId },
          { teamId: { in: teamIds } },
          { projectTeams: { some: { teamId: { in: teamIds } } } },
          { participants: { some: { userId } } },
        ],
      },
      include: {
        team: { select: { id: true, name: true } },
        _count: { select: { sprints: true, epics: true, versions: true } },
      },
      orderBy: { startDate: 'desc' },
    });

    return projects.map((q) => ({
      ...q,
      status: this.normalizeStatus(q.status),
    }));
  }

  async findOne(id: string, userId: string) {
    const project = await this.loadProject(id);
    await this.ensureCanView(project, userId);
    return this.toDetail(project);
  }

  async compare(id: string, userId: string) {
    const project = await this.loadProject(id);
    await this.ensureCanView(project, userId);
    const status = this.normalizeStatus(project.status);
    if (status === 'draft') {
      throw new BadRequestException('Start the project before comparing plan versions');
    }
    const comparison = await this.buildComparison(id);
    if (!comparison) {
      throw new BadRequestException('No plan versions available to compare');
    }
    return comparison;
  }

  async update(id: string, userId: string, dto: UpdateProjectDto) {
    const project = await this.loadProject(id);
    this.ensureCreator(project, userId);
    this.ensureEditable(project);
    if (dto.maxWorkingDaysPerSprint !== undefined) {
      this.assertMaxWorkingDaysPerSprint(dto.maxWorkingDaysPerSprint);
    }

    const startDate = dto.startDate ? parseDateOnly(dto.startDate) : project.startDate;
    const endDate = dto.endDate ? parseDateOnly(dto.endDate) : project.endDate;
    this.assertRange(startDate, endDate);

    const currentTeamIds = project.projectTeams.map((link) => link.teamId);
    const nextTeamIds =
      dto.teamIds !== undefined ? await this.resolveTeamIds(userId, dto.teamIds) : null;
    const explicitTeamId =
      dto.teamId === undefined ? undefined : await this.resolveTeamId(userId, dto.teamId);

    const addedTeamIds = nextTeamIds
      ? nextTeamIds.filter((teamId) => !currentTeamIds.includes(teamId))
      : [];
    if (
      nextTeamIds === null &&
      explicitTeamId &&
      !currentTeamIds.includes(explicitTeamId)
    ) {
      addedTeamIds.push(explicitTeamId);
    }
    const removedTeamIds = nextTeamIds
      ? currentTeamIds.filter((teamId) => !nextTeamIds.includes(teamId))
      : [];

    const teamsToSync =
      nextTeamIds !== null ? nextTeamIds : explicitTeamId ? [explicitTeamId] : null;
    const alreadyOnPlan = new Set(project.participants.map((participant) => participant.userId));
    const participantsToAdd = teamsToSync
      ? (await this.orderedTeamMemberIds(teamsToSync)).filter(
          (memberId) => !alreadyOnPlan.has(memberId),
        )
      : [];
    const addedAtBase = Date.now();
    const primaryTeamId =
      nextTeamIds !== null
        ? (nextTeamIds[0] ?? null)
        : explicitTeamId !== undefined
          ? explicitTeamId
          : project.teamId;

    const datesChanged =
      startDate.getTime() !== project.startDate.getTime() ||
      endDate.getTime() !== project.endDate.getTime();

    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.maxWorkingDaysPerSprint !== undefined
            ? { maxWorkingDaysPerSprint: dto.maxWorkingDaysPerSprint }
            : {}),
          startDate,
          endDate,
          teamId: primaryTeamId,
        },
      });

      if (removedTeamIds.length) {
        await tx.projectTeam.deleteMany({
          where: { projectId: id, teamId: { in: removedTeamIds } },
        });
      }
      if (addedTeamIds.length) {
        await tx.projectTeam.createMany({
          data: addedTeamIds.map((teamId) => ({ projectId: id, teamId })),
        });
      }
      if (participantsToAdd.length) {
        await tx.projectParticipant.createMany({
          data: participantsToAdd.map((memberId, index) => ({
            projectId: id,
            userId: memberId,
            addedAt: new Date(addedAtBase + index),
          })),
        });
      }

      if (datesChanged) {
        await tx.sprint.deleteMany({ where: { projectId: id } });
        await tx.sprint.createMany({
          data: generateSprints(startDate, endDate).map((s) => ({ ...s, projectId: id })),
        });
      }
    });

    await this.maybeVersionAfterChange(id, userId);
    return this.findOne(id, userId);
  }

  async addParticipant(id: string, userId: string, dto: AddProjectParticipantDto) {
    const project = await this.loadProject(id);
    this.ensureCreator(project, userId);
    this.ensureEditable(project);

    await this.ensureAssignable(project, userId, [dto.userId]);

    const existing = project.participants.find((p) => p.userId === dto.userId);
    if (existing) {
      throw new BadRequestException('User is already a project participant');
    }

    await this.prisma.projectParticipant.create({
      data: { projectId: id, userId: dto.userId },
    });

    await this.maybeVersionAfterChange(id, userId);
    return this.findOne(id, userId);
  }

  async removeParticipant(id: string, memberUserId: string, userId: string) {
    const project = await this.loadProject(id);
    this.ensureCreator(project, userId);
    if (this.normalizeStatus(project.status) !== 'draft') {
      throw new BadRequestException('Users can only be removed from a draft project');
    }

    const existing = project.participants.find((p) => p.userId === memberUserId);
    if (!existing) throw new NotFoundException('Participant not found');

    const epicIds = project.epics.map((epic) => epic.id);
    await this.prisma.$transaction(async (tx) => {
      if (epicIds.length) {
        await tx.epicAssignment.deleteMany({
          where: { epicId: { in: epicIds }, userId: memberUserId },
        });
      }
      await tx.projectPto.deleteMany({ where: { projectId: id, userId: memberUserId } });
      await tx.projectHoliday.deleteMany({ where: { projectId: id, userId: memberUserId } });
      await tx.projectParticipant.delete({
        where: { projectId_userId: { projectId: id, userId: memberUserId } },
      });
    });

    await this.maybeVersionAfterChange(id, userId);
    return this.findOne(id, userId);
  }

  async start(id: string, userId: string) {
    const project = await this.loadProject(id);
    this.ensureCreator(project, userId);
    const status = this.normalizeStatus(project.status);
    if (status !== 'draft') {
      throw new BadRequestException('Only draft projects can be started');
    }
    if (!project.epics.length) {
      throw new BadRequestException('Add at least one epic before starting the project');
    }

    await this.createVersionSnapshot(id, userId);
    await this.prisma.project.update({
      where: { id },
      data: { status: 'in_progress' },
    });

    return this.findOne(id, userId);
  }

  async complete(id: string, userId: string) {
    const project = await this.loadProject(id);
    this.ensureCreator(project, userId);
    const status = this.normalizeStatus(project.status);
    if (status === 'completed') {
      throw new BadRequestException('Project is already completed');
    }
    if (status !== 'in_progress') {
      throw new BadRequestException('Start the project before completing it');
    }

    await this.createVersionSnapshot(id, userId);
    await this.prisma.project.update({
      where: { id },
      data: { status: 'completed' },
    });

    return this.findOne(id, userId);
  }

  async addEpic(projectId: string, userId: string, dto: CreateEpicDto) {
    const project = await this.loadProject(projectId);
    this.ensureCreator(project, userId);
    this.ensureEditable(project);

    const assigneeIds = dto.assigneeIds ? [...new Set(dto.assigneeIds)] : [];
    const startSprintNumber = dto.startSprintNumber ?? null;
    const startSprintWeek = dto.startSprintWeek ?? null;

    if (assigneeIds.length && startSprintNumber === null) {
      throw new BadRequestException('startSprintNumber is required when assigning an epic');
    }
    if (assigneeIds.length && startSprintWeek === null) {
      throw new BadRequestException('startSprintWeek is required when assigning an epic');
    }
    if (startSprintNumber !== null && !assigneeIds.length) {
      throw new BadRequestException('assigneeIds are required when scheduling an epic');
    }
    if (startSprintNumber !== null && startSprintWeek === null) {
      throw new BadRequestException('startSprintWeek is required when scheduling an epic');
    }
    if (startSprintWeek !== null && startSprintNumber === null) {
      throw new BadRequestException('startSprintNumber is required when scheduling an epic');
    }
    if (startSprintNumber !== null && startSprintWeek !== null) {
      this.assertStartSprint(project, startSprintNumber);
      this.assertStartSprintWeek(startSprintWeek);
    }
    if (assigneeIds.length) {
      this.ensureOnRoster(project, assigneeIds);
    }

    const title = dto.title.trim();
    this.assertUniqueEpicTitle(project.epics, title);
    const backgroundColor = dto.backgroundColor.toLowerCase();
    const scheduledDays =
      assigneeIds.length > 0 && startSprintNumber !== null && startSprintWeek !== null
        ? this.planScheduledAssignmentDays(
            project,
            assigneeIds,
            dto.workingDays,
            startSprintNumber,
            startSprintWeek,
          )
        : [];

    await this.prisma.$transaction(async (tx) => {
      const epic = await tx.epic.create({
        data: {
          projectId,
          title,
          workingDays: dto.workingDays,
          priority: dto.priority ?? 0,
          backgroundColor,
          createdBy: userId,
        },
      });

      if (!assigneeIds.length || startSprintNumber === null || startSprintWeek === null) return;

      await tx.epicAssignment.createMany({
        data: scheduledDays.map((row) => ({
          epicId: epic.id,
          userId: row.userId,
          workingDays: row.workingDays,
          startSprintNumber,
          startSprintWeek,
        })),
      });
    });

    await this.maybeVersionAfterChange(projectId, userId);
    return this.findOne(projectId, userId);
  }

  async assignEpic(
    projectId: string,
    templateEpicId: string,
    userId: string,
    dto: AssignEpicDto,
  ) {
    const project = await this.loadProject(projectId);
    this.ensureCreator(project, userId);
    this.ensureEditable(project);

    const template = project.epics.find((e) => e.id === templateEpicId);
    if (!template) throw new NotFoundException('Epic not found');

    this.assertStartSprint(project, dto.startSprintNumber);
    this.assertStartSprintWeek(dto.startSprintWeek);
    this.ensureOnRoster(project, [dto.assigneeId]);

    const workingDays = this.resolveAssignmentWorkingDays(
      template.workingDays,
      template.assignments.map((assignment) => assignment.workingDays),
      dto.workingDays,
    );
    this.assertAssignmentFits(
      project,
      template.id,
      dto.assigneeId,
      workingDays,
      dto.startSprintNumber,
      dto.startSprintWeek,
    );

    await this.prisma.epicAssignment.create({
      data: {
        epicId: template.id,
        userId: dto.assigneeId,
        workingDays,
        startSprintNumber: dto.startSprintNumber,
        startSprintWeek: dto.startSprintWeek,
      },
    });

    await this.maybeVersionAfterChange(projectId, userId);
    return this.findOne(projectId, userId);
  }

  async updateEpic(projectId: string, epicId: string, userId: string, dto: UpdateEpicDto) {
    const project = await this.loadProject(projectId);
    this.ensureCreator(project, userId);
    this.ensureEditable(project);

    const backlogEpic = project.epics.find((e) => e.id === epicId);
    const assignment = backlogEpic
      ? null
      : project.epics
          .flatMap((e) => e.assignments.map((a) => ({ assignment: a, epic: e })))
          .find((row) => row.assignment.id === epicId);

    if (!backlogEpic && !assignment) throw new NotFoundException('Epic not found');

    if (backlogEpic) {
      const title = dto.title !== undefined ? dto.title.trim() : undefined;
      if (title !== undefined) {
        this.assertUniqueEpicTitle(project.epics, title, epicId);
      }

      await this.prisma.epic.update({
        where: { id: epicId },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(dto.workingDays !== undefined ? { workingDays: dto.workingDays } : {}),
          ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
          ...(dto.backgroundColor !== undefined
            ? { backgroundColor: dto.backgroundColor.toLowerCase() }
            : {}),
        },
      });
    } else if (assignment) {
      const assigneeIds = dto.assigneeIds ? [...new Set(dto.assigneeIds)] : undefined;
      if (assigneeIds && assigneeIds.length > 1) {
        throw new BadRequestException('Each epic entry has at most one assignee');
      }

      const nextUserId = assigneeIds !== undefined ? assigneeIds[0] : assignment.assignment.userId;
      const nextSprint =
        dto.startSprintNumber !== undefined
          ? dto.startSprintNumber
          : assignment.assignment.startSprintNumber;
      const nextWeek =
        dto.startSprintWeek !== undefined
          ? dto.startSprintWeek
          : assignment.assignment.startSprintWeek;

      if (!nextUserId || nextSprint == null || nextWeek == null) {
        throw new BadRequestException('Assignments require an assignee, start sprint, and start week');
      }

      this.ensureOnRoster(project, [nextUserId]);
      this.assertStartSprint(project, nextSprint);
      this.assertStartSprintWeek(nextWeek);

      const nextWorkingDays =
        dto.workingDays !== undefined ? dto.workingDays : assignment.assignment.workingDays;
      this.assertAssignmentFits(
        project,
        assignment.epic.id,
        nextUserId,
        nextWorkingDays,
        nextSprint,
        nextWeek,
        { allowOverflow: true, excludeAssignmentId: epicId },
      );

      await this.prisma.epicAssignment.update({
        where: { id: epicId },
        data: {
          userId: nextUserId,
          startSprintNumber: nextSprint,
          startSprintWeek: nextWeek,
          ...(dto.workingDays !== undefined ? { workingDays: dto.workingDays } : {}),
        },
      });
    }

    await this.maybeVersionAfterChange(projectId, userId);
    return this.findOne(projectId, userId);
  }

  async reorderEpics(projectId: string, userId: string, epicIds: string[]) {
    const project = await this.loadProject(projectId);
    this.ensureCreator(project, userId);
    this.ensureEditable(project);

    const backlogIds = project.epics.map((epic) => epic.id);
    const backlogIdSet = new Set(backlogIds);
    const uniqueIds = new Set(epicIds);
    if (
      epicIds.length !== backlogIds.length ||
      uniqueIds.size !== epicIds.length ||
      epicIds.some((id) => !backlogIdSet.has(id))
    ) {
      throw new BadRequestException('epicIds must list each backlog epic once');
    }

    const count = epicIds.length;
    await this.prisma.$transaction(
      epicIds.map((id, index) =>
        this.prisma.epic.update({
          where: { id },
          data: { priority: Math.min(99, count - 1 - index) },
        }),
      ),
    );

    await this.maybeVersionAfterChange(projectId, userId);
    return this.findOne(projectId, userId);
  }

  async deleteEpic(projectId: string, epicId: string, userId: string) {
    const project = await this.loadProject(projectId);
    this.ensureCreator(project, userId);
    this.ensureEditable(project);

    const backlogEpic = project.epics.find((e) => e.id === epicId);
    if (backlogEpic) {
      await this.prisma.epic.delete({ where: { id: epicId } });
    } else {
      const assignment = await this.prisma.epicAssignment.findFirst({
        where: { id: epicId, epic: { projectId } },
      });
      if (!assignment) throw new NotFoundException('Epic not found');
      await this.prisma.epicAssignment.delete({ where: { id: epicId } });
    }

    await this.maybeVersionAfterChange(projectId, userId);
    return this.findOne(projectId, userId);
  }

  async addHoliday(projectId: string, userId: string, dto: CreateHolidayDto) {
    const project = await this.loadProject(projectId);
    this.ensureCreator(project, userId);
    this.ensureEditable(project);

    const { startDate, endDate } = this.parseRange(dto.startDate, dto.endDate);
    this.assertWithinProject(project, startDate, endDate);

    const participants = await this.resolveParticipants(project);
    if (!participants.length) {
      throw new BadRequestException('Add participants before creating a holiday');
    }

    const name = (dto.name?.trim() || 'Holiday').slice(0, 200);
    const groupKey = randomUUID();
    await this.prisma.projectHoliday.createMany({
      data: participants.map((p) => ({
        projectId,
        userId: p.id,
        groupKey,
        name,
        startDate,
        endDate,
        createdBy: userId,
      })),
    });

    await this.maybeVersionAfterChange(projectId, userId);
    return this.findOne(projectId, userId);
  }

  async deleteHoliday(projectId: string, holidayId: string, userId: string) {
    const project = await this.loadProject(projectId);
    this.ensureCreator(project, userId);
    this.ensureEditable(project);

    const holiday = project.holidays.find((h) => h.id === holidayId);
    if (!holiday) throw new NotFoundException('Holiday not found');

    await this.prisma.projectHoliday.delete({ where: { id: holidayId } });
    await this.maybeVersionAfterChange(projectId, userId);
    return this.findOne(projectId, userId);
  }

  async deleteHolidayGroup(projectId: string, groupKey: string, userId: string) {
    const project = await this.loadProject(projectId);
    this.ensureCreator(project, userId);
    this.ensureEditable(project);

    const matching = project.holidays.filter((h) => h.groupKey === groupKey);
    if (!matching.length) throw new NotFoundException('Holiday not found');

    await this.prisma.projectHoliday.deleteMany({
      where: { projectId, groupKey },
    });
    await this.maybeVersionAfterChange(projectId, userId);
    return this.findOne(projectId, userId);
  }

  async addPto(projectId: string, userId: string, dto: CreatePtoDto) {
    const project = await this.loadProject(projectId);
    this.ensureCreator(project, userId);
    this.ensureEditable(project);

    const { startDate, endDate } = this.parseRange(dto.startDate, dto.endDate);
    this.assertWithinProject(project, startDate, endDate);

    const targetUserIds = await this.resolvePtoTargetUserIds(project, userId, dto);
    if (!targetUserIds.length) {
      throw new BadRequestException('Select a team or at least one user for PTO');
    }

    const name = (dto.name?.trim() || 'PTO').slice(0, 200);
    await this.prisma.projectPto.createMany({
      data: targetUserIds.map((uid) => ({
        projectId,
        userId: uid,
        name,
        startDate,
        endDate,
        createdBy: userId,
      })),
    });

    await this.maybeVersionAfterChange(projectId, userId);
    return this.findOne(projectId, userId);
  }

  async deletePto(projectId: string, ptoId: string, userId: string) {
    const project = await this.loadProject(projectId);
    this.ensureCreator(project, userId);
    this.ensureEditable(project);

    const pto = project.ptos.find((p) => p.id === ptoId);
    if (!pto) throw new NotFoundException('PTO entry not found');

    await this.prisma.projectPto.delete({ where: { id: ptoId } });
    await this.maybeVersionAfterChange(projectId, userId);
    return this.findOne(projectId, userId);
  }

  private async maybeVersionAfterChange(projectId: string, userId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { status: true },
    });
    if (!project) return;
    if (this.normalizeStatus(project.status) === 'in_progress') {
      await this.createVersionSnapshot(projectId, userId);
    }
  }

  private async createVersionSnapshot(projectId: string, userId: string) {
    const project = await this.loadProject(projectId);
    const latest = await this.prisma.projectVersion.findFirst({
      where: { projectId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    const snapshot = this.buildSnapshot(project);

    await this.prisma.projectVersion.create({
      data: {
        projectId,
        versionNumber,
        snapshot: JSON.stringify(snapshot),
        createdBy: userId,
      },
    });
  }

  private buildSnapshot(
    project: Awaited<ReturnType<ProjectsService['loadProject']>>,
  ): PlanSnapshot {
    const teams = project.projectTeams.map((qt) => qt.team);
    return {
      name: project.name,
      maxWorkingDaysPerSprint: project.maxWorkingDaysPerSprint,
      startDate: project.startDate.toISOString(),
      endDate: project.endDate.toISOString(),
      teamId: project.teamId,
      teamIds: teams.map((t) => t.id),
      team: project.team,
      teams,
      explicitRoster: true,
      participantUserIds: project.participants.map((p) => p.userId),
      sprints: project.sprints.map((s) => ({
        id: s.id,
        number: s.number,
        startDate: s.startDate.toISOString(),
        endDate: s.endDate.toISOString(),
      })),
      epics: this.flattenEpicsForPlan(project.epics).map((epic) => ({
        id: epic.id,
        groupKey: epic.groupKey,
        sourceEpicId: epic.sourceEpicId ?? null,
        title: epic.title,
        workingDays: epic.workingDays,
        priority: epic.priority ?? 0,
        startSprintNumber: epic.startSprintNumber,
        startSprintWeek: epic.startSprintWeek,
        backgroundColor: epic.backgroundColor,
        createdAt:
          typeof epic.createdAt === 'string' ? epic.createdAt : epic.createdAt.toISOString(),
        assignees: epic.assignees.map((a) => a.user),
      })),
    };
  }

  private async buildComparison(projectId: string) {
    const versions = await this.prisma.projectVersion.findMany({
      where: { projectId },
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
      startSprintWeek: epic.startSprintWeek ?? null,
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
    const origPriority = orig.priority ?? 0;
    const latestPriority = latest.priority ?? 0;
    if (origPriority !== latestPriority) {
      changes.push(`Priority: ${origPriority} → ${latestPriority}`);
    }
    if (orig.startSprintNumber !== latest.startSprintNumber) {
      const from = orig.startSprintNumber ?? 'unscheduled';
      const to = latest.startSprintNumber ?? 'unscheduled';
      changes.push(`Start sprint: ${from} → ${to}`);
    }
    const origWeek = orig.startSprintWeek ?? null;
    const latestWeek = latest.startSprintWeek ?? null;
    if (origWeek !== latestWeek) {
      const from = origWeek ?? 'unscheduled';
      const to = latestWeek ?? 'unscheduled';
      changes.push(`Start week: ${from} → ${to}`);
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
    const unchangedEpics: ReturnType<ProjectsService['toComparisonEpicEntry']>[] = [];
    const changedEpics: ReturnType<ProjectsService['toComparisonEpicEntry']>[] = [];

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
    const source = epic.sourceEpicId ?? epic.groupKey ?? epic.id;
    return `${source}:${assigneeId}:${epic.startSprintNumber ?? ''}:${epic.startSprintWeek ?? ''}`;
  }

  private epicsEqual(a: SnapshotEpic, b: SnapshotEpic) {
    const aAssignee = a.assignees[0]?.id ?? '';
    const bAssignee = b.assignees[0]?.id ?? '';
    return (
      a.title === b.title &&
      a.workingDays === b.workingDays &&
      (a.priority ?? 0) === (b.priority ?? 0) &&
      a.startSprintNumber === b.startSprintNumber &&
      (a.startSprintWeek ?? null) === (b.startSprintWeek ?? null) &&
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
      sourceEpicId: epic.sourceEpicId ?? null,
      title: epic.title,
      workingDays: epic.workingDays,
      priority: epic.priority ?? 0,
      startSprintNumber: epic.startSprintNumber,
      startSprintWeek: epic.startSprintWeek ?? (epic.startSprintNumber != null ? 1 : null),
      backgroundColor: epic.backgroundColor,
      createdAt: epic.createdAt,
      assignees: epic.assignees.map((user) => ({ userId: user.id, user })),
    }));

    const participants = await this.resolveParticipantsFromSnapshot(snapshot);
    const participantIds = participants.map((p) => p.id);
    const grid = this.buildGrid(
      sprints,
      epics,
      participantIds,
      [],
      [],
      snapshot.maxWorkingDaysPerSprint ?? DEFAULT_MAX_WORKING_DAYS_PER_SPRINT,
    );

    return {
      name: snapshot.name,
      maxWorkingDaysPerSprint:
        snapshot.maxWorkingDaysPerSprint ?? DEFAULT_MAX_WORKING_DAYS_PER_SPRINT,
      startDate: snapshot.startDate,
      endDate: snapshot.endDate,
      teamId: snapshot.teamId,
      team: snapshot.team,
      sprints: this.mapSprintsWithWeeks(sprints),
      participants: participants.map((p) => ({
        ...p,
        cells: grid[p.id] || {},
      })),
      epics: snapshot.epics.map((epic) => ({
        ...epic,
        priority: epic.priority ?? 0,
        startSprintWeek: epic.startSprintWeek ?? (epic.startSprintNumber != null ? 1 : null),
      })),
    };
  }

  private async resolveParticipantsFromSnapshot(snapshot: PlanSnapshot) {
    if (snapshot.explicitRoster) {
      if (!snapshot.participantUserIds?.length) return [];
      const users = await this.prisma.user.findMany({
        where: { id: { in: snapshot.participantUserIds } },
        select: userSelect,
      });
      const byId = new Map(users.map((user) => [user.id, user]));
      return snapshot.participantUserIds.flatMap((id) => {
        const user = byId.get(id);
        return user ? [user] : [];
      });
    }

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

  private async loadProject(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        team: { select: { id: true, name: true } },
        projectTeams: { include: { team: { select: { id: true, name: true } } } },
        participants: {
          include: { user: { select: userSelect } },
          orderBy: [{ addedAt: 'asc' }, { id: 'asc' }],
        },
        sprints: { orderBy: { number: 'asc' } },
        epics: {
          orderBy: { createdAt: 'asc' },
          include: {
            assignments: { include: { user: { select: userSelect } } },
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
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private async toDetail(
    project: Awaited<ReturnType<ProjectsService['loadProject']>>,
  ) {
    const participants = await this.resolveParticipants(project);
    const participantIds = participants.map((p) => p.id);
    const holidays = project.holidays;
    const ptos = project.ptos;
    const planEpics = this.flattenEpicsForPlan(project.epics);
    const grid = this.buildGrid(
      project.sprints,
      planEpics,
      participantIds,
      ptos,
      holidays,
      project.maxWorkingDaysPerSprint,
    );
    const capacity = this.computeCapacity(
      project.sprints,
      participants,
      ptos,
      holidays,
      planEpics,
      project.maxWorkingDaysPerSprint,
    );
    const sprintSummaries = this.computeSprintSummaries(
      project.sprints,
      participants,
      ptos,
      holidays,
      grid,
      project.maxWorkingDaysPerSprint,
    );
    const capacityByUser = new Map(capacity.map((c) => [c.userId, c]));
    const status = this.normalizeStatus(project.status);
    const teams = project.projectTeams.map((qt) => qt.team);

    return {
      id: project.id,
      name: project.name,
      startDate: project.startDate,
      endDate: project.endDate,
      maxWorkingDaysPerSprint: project.maxWorkingDaysPerSprint,
      teamId: project.teamId,
      status,
      createdBy: project.createdBy,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      team: project.team,
      teams,
      addedParticipants: project.participants.map((p) => p.user),
      versionCount: project._count.versions,
      currentVersion: project.versions[0]?.versionNumber ?? null,
      sprints: this.mapSprintsWithWeeks(project.sprints),
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
      sprintSummaries,
      holidays: this.groupHolidays(holidays, project.sprints),
      ptos: ptos.map((p) => ({
        id: p.id,
        name: p.name,
        startDate: p.startDate,
        endDate: p.endDate,
        userId: p.userId,
        user: p.user,
        workingDays: this.ptoWorkingDays(p, project.sprints),
      })),
      epics: planEpics.map((epic) => ({
        id: epic.id,
        groupKey: epic.groupKey,
        sourceEpicId: epic.sourceEpicId ?? null,
        title: epic.title,
        workingDays: epic.workingDays,
        priority: epic.priority,
        startSprintNumber: epic.startSprintNumber,
        startSprintWeek: epic.startSprintWeek,
        backgroundColor: epic.backgroundColor,
        createdAt: epic.createdAt,
        assignees: epic.assignees.map((a) => a.user),
      })),
    };
  }

  private flattenEpicsForPlan(
    epics: {
      id: string;
      title: string;
      workingDays: number;
      priority: number;
      backgroundColor: string;
      createdAt: Date;
      assignments: {
        id: string;
        workingDays: number;
        startSprintNumber: number;
        startSprintWeek: number;
        createdAt: Date;
        user: { id: string; name: string; email: string };
      }[];
    }[],
  ): EpicWithAssignees[] {
    const backlog = epics.map((epic) => ({
      id: epic.id,
      groupKey: null as string | null,
      sourceEpicId: null as string | null,
      title: epic.title,
      workingDays: epic.workingDays,
      priority: epic.priority,
      startSprintNumber: null as number | null,
      startSprintWeek: null as number | null,
      backgroundColor: epic.backgroundColor,
      createdAt: epic.createdAt,
      assignees: [] as EpicWithAssignees['assignees'],
    }));

    const assignments = epics.flatMap((epic) =>
      epic.assignments.map((assignment) => ({
        id: assignment.id,
        groupKey: epic.id,
        sourceEpicId: epic.id,
        title: epic.title,
        workingDays: assignment.workingDays,
        priority: 0,
        startSprintNumber: assignment.startSprintNumber,
        startSprintWeek: assignment.startSprintWeek,
        backgroundColor: epic.backgroundColor,
        createdAt: assignment.createdAt,
        assignees: [{ userId: assignment.user.id, user: assignment.user }],
      })),
    );

    return [...backlog, ...assignments];
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

  async listAddableParticipants(id: string, userId: string) {
    const project = await this.loadProject(id);
    this.ensureCreator(project, userId);
    this.ensureEditable(project);

    const onPlan = await this.resolveParticipants(project);
    const onPlanIds = new Set(onPlan.map((p) => p.id));
    const allowed = await this.getAllowedAssigneeIds(userId, project);

    const users = await this.prisma.user.findMany({
      where: { id: { in: Array.from(allowed) } },
      select: userSelect,
      orderBy: { name: 'asc' },
    });

    return users.filter((user) => !onPlanIds.has(user.id));
  }

  private async resolveParticipants(
    project: Awaited<ReturnType<ProjectsService['loadProject']>>,
  ) {
    return project.participants.map((participant) => participant.user);
  }

  private buildGrid(
    sprints: { id: string; number: number; startDate: Date; endDate: Date }[],
    epics: EpicWithAssignees[],
    participantIds: string[],
    ptos: { id: string; userId: string; name: string; startDate: Date; endDate: Date }[],
    holidays: { id: string; userId: string; name: string; startDate: Date; endDate: Date }[],
    maxWorkingDaysPerSprint: number,
  ) {
    const slots = sprintWeekSlots(sprints);
    const grid: Record<string, Record<string, {
      type: 'epic' | 'pto' | 'holiday';
      id: string;
      title: string;
      backgroundColor: string;
      daysInSprint: number;
    }[]>> = {};

    const remaining = new Map<string, Map<string, number>>();
    const capUsed = new Map<string, Map<number, number>>();

    for (const userId of participantIds) {
      remaining.set(userId, new Map());
      capUsed.set(userId, new Map());
      grid[userId] = {};
      for (const slot of slots) {
        grid[userId][slot.cellKey] = [];
        remaining.get(userId)!.set(
          slot.cellKey,
          Math.max(0, countWeekdays(slot.startDate, slot.endDate)),
        );
      }
    }

    for (const holiday of holidays) {
      if (!grid[holiday.userId]) continue;
      for (const slot of slots) {
        const days = countInclusiveDaysOverlap(
          holiday.startDate,
          holiday.endDate,
          slot.startDate,
          slot.endDate,
        );
        if (days <= 0) continue;
        grid[holiday.userId][slot.cellKey].push({
          type: 'holiday',
          id: holiday.id,
          title: holiday.name,
          backgroundColor: HOLIDAY_CHIP_COLOR,
          daysInSprint: days,
        });
        const rem = remaining.get(holiday.userId)!.get(slot.cellKey) ?? 0;
        remaining.get(holiday.userId)!.set(slot.cellKey, Math.max(0, rem - days));
      }
    }

    for (const pto of ptos) {
      if (!grid[pto.userId]) continue;
      for (const slot of slots) {
        const days = countInclusiveDaysOverlap(
          pto.startDate,
          pto.endDate,
          slot.startDate,
          slot.endDate,
        );
        if (days <= 0) continue;
        grid[pto.userId][slot.cellKey].push({
          type: 'pto',
          id: pto.id,
          title: pto.name,
          backgroundColor: PTO_CHIP_COLOR,
          daysInSprint: days,
        });
        const rem = remaining.get(pto.userId)!.get(slot.cellKey) ?? 0;
        remaining.get(pto.userId)!.set(slot.cellKey, Math.max(0, rem - days));
      }
    }

    const scheduled = epics
      .filter((epic) => epic.assignees.length > 0 && epic.startSprintNumber != null)
      .sort((a, b) => assignmentCreatedAt(a.createdAt) - assignmentCreatedAt(b.createdAt));

    for (const epic of scheduled) {
      const startWeek = (epic.startSprintWeek ?? 1) as SprintWeekNumber;
      const eligible = slots.filter(
        (slot) =>
          slot.sprintNumber > epic.startSprintNumber! ||
          (slot.sprintNumber === epic.startSprintNumber && slot.week >= startWeek),
      );
      for (const assignee of epic.assignees) {
        const userId = assignee.userId ?? assignee.user.id;
        if (!grid[userId]) continue;
        const userRemaining = remaining.get(userId)!;
        const userCap = capUsed.get(userId)!;
        const painted = paintAssignmentWeeks(
          epic.workingDays,
          maxWorkingDaysPerSprint,
          eligible.map((slot) => ({
            sprintNumber: slot.sprintNumber,
            week: slot.week,
            capacity: userRemaining.get(slot.cellKey) ?? 0,
          })),
          { dumpRemainder: true, capUsedBySprint: userCap },
        );

        for (const week of painted.weeks) {
          if (week.days <= 0) continue;
          const slot = eligible.find(
            (entry) => entry.sprintNumber === week.sprintNumber && entry.week === week.week,
          );
          if (!slot) continue;
          grid[userId][slot.cellKey].push({
            type: 'epic',
            id: epic.id,
            title: epic.title,
            backgroundColor: epic.backgroundColor,
            daysInSprint: week.days,
          });
          const rem = userRemaining.get(slot.cellKey) ?? 0;
          userRemaining.set(slot.cellKey, Math.max(0, rem - week.days));
          userCap.set(week.sprintNumber, (userCap.get(week.sprintNumber) ?? 0) + week.days);
        }
      }
    }

    return grid;
  }

  private mapSprintsWithWeeks(
    sprints: { id: string; number: number; startDate: Date; endDate: Date }[],
  ) {
    return sprints.map((s) => {
      const weeks = sprintWeekSlots([s]).map((slot) => ({
        week: slot.week,
        startDate: slot.startDate,
        endDate: slot.endDate,
        workingDays: countWeekdays(slot.startDate, slot.endDate),
        cellKey: slot.cellKey,
      }));
      return {
        id: s.id,
        number: s.number,
        startDate: s.startDate,
        endDate: s.endDate,
        workingDays: countWeekdays(s.startDate, s.endDate),
        weeks,
      };
    });
  }

  private projectSpan(sprints: { startDate: Date; endDate: Date }[]) {
    if (!sprints.length) return null;
    return { start: sprints[0].startDate, end: sprints[sprints.length - 1].endDate };
  }

  private holidayWorkingDays(
    holiday: { startDate: Date; endDate: Date },
    sprints: { startDate: Date; endDate: Date }[],
  ) {
    const span = this.projectSpan(sprints);
    if (!span) return 0;
    return countInclusiveDaysOverlap(holiday.startDate, holiday.endDate, span.start, span.end);
  }

  private ptoWorkingDays(
    pto: { startDate: Date; endDate: Date },
    sprints: { startDate: Date; endDate: Date }[],
  ) {
    const span = this.projectSpan(sprints);
    if (!span) return 0;
    return countInclusiveDaysOverlap(pto.startDate, pto.endDate, span.start, span.end);
  }

  private computeCapacity(
    sprints: { startDate: Date; endDate: Date }[],
    participants: { id: string; name: string }[],
    ptos: { userId: string; startDate: Date; endDate: Date }[],
    holidays: { userId: string; startDate: Date; endDate: Date }[],
    epics: EpicWithAssignees[],
    maxWorkingDaysPerSprint: number,
  ) {
    const span = this.projectSpan(sprints);
    const totalSprintDays = sprints.reduce(
      (sum, s) => sum + countWeekdays(s.startDate, s.endDate),
      0,
    );
    const projectWorkingDays = maxWorkingDaysPerSprint * sprints.length;

    return participants.map((person) => {
      const userPtos = ptos.filter((p) => p.userId === person.id);
      const userHolidays = holidays.filter((h) => h.userId === person.id);
      const ptoDays = span
        ? userPtos.reduce(
            (sum, p) =>
              sum + countInclusiveDaysOverlap(p.startDate, p.endDate, span.start, span.end),
            0,
          )
        : 0;
      const holidayDays = span
        ? userHolidays.reduce(
            (sum, h) =>
              sum + countInclusiveDaysOverlap(h.startDate, h.endDate, span.start, span.end),
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
        totalCapacity: Math.max(0, projectWorkingDays - holidayDays - ptoDays),
        sprintCapacity: totalSprintDays,
        epicDaysAssigned,
      };
    });
  }

  private computeSprintSummaries(
    sprints: { id: string; number: number; startDate: Date; endDate: Date }[],
    participants: { id: string; name: string }[],
    ptos: { userId: string; startDate: Date; endDate: Date }[],
    holidays: { userId: string; startDate: Date; endDate: Date }[],
    grid: Record<string, Record<string, { type: string; daysInSprint: number }[]>>,
    maxWorkingDaysPerSprint: number,
  ) {
    const slots = sprintWeekSlots(sprints);
    return [...sprints]
      .sort((a, b) => a.number - b.number)
      .map((sprint) => {
        const cellKeys = slots
          .filter((slot) => slot.sprintNumber === sprint.number)
          .map((slot) => slot.cellKey);
        return {
          sprintId: sprint.id,
          sprintNumber: sprint.number,
          users: participants.map((person) => {
            const ptoDays = ptos
              .filter((pto) => pto.userId === person.id)
              .reduce(
                (sum, pto) =>
                  sum +
                  countInclusiveDaysOverlap(
                    pto.startDate,
                    pto.endDate,
                    sprint.startDate,
                    sprint.endDate,
                  ),
                0,
              );
            const holidayDays = holidays
              .filter((holiday) => holiday.userId === person.id)
              .reduce(
                (sum, holiday) =>
                  sum +
                  countInclusiveDaysOverlap(
                    holiday.startDate,
                    holiday.endDate,
                    sprint.startDate,
                    sprint.endDate,
                  ),
                0,
              );
            const committedDays = cellKeys.reduce((sum, cellKey) => {
              const chips = grid[person.id]?.[cellKey] ?? [];
              return (
                sum +
                chips
                  .filter((chip) => chip.type === 'epic')
                  .reduce((chipSum, chip) => chipSum + chip.daysInSprint, 0)
              );
            }, 0);
            return {
              userId: person.id,
              name: person.name,
              offlineDays: ptoDays + holidayDays,
              ptoDays,
              holidayDays,
              committedDays,
              totalCapacity: Math.max(0, maxWorkingDaysPerSprint - ptoDays - holidayDays),
            };
          }),
        };
      });
  }

  private assertWithinProject(
    project: { startDate: Date; endDate: Date },
    startDate: Date,
    endDate: Date,
  ) {
    const qStart = parseDateOnly(project.startDate);
    const qEnd = parseDateOnly(project.endDate);
    if (startDate < qStart || endDate > qEnd) {
      throw new BadRequestException('Dates must fall within the project range');
    }
  }

  private async resolvePtoTargetUserIds(
    project: Awaited<ReturnType<ProjectsService['loadProject']>>,
    creatorId: string,
    dto: CreatePtoDto,
  ) {
    if (dto.teamId && dto.userIds?.length) {
      throw new BadRequestException('Assign PTO to either a team or individual users, not both');
    }

    if (dto.teamId) {
      const linkedTeamIds = project.projectTeams.map((qt) => qt.teamId);
      if (project.teamId) linkedTeamIds.push(project.teamId);
      if (!linkedTeamIds.includes(dto.teamId)) {
        throw new BadRequestException('Team is not linked to this project');
      }
      await this.resolveTeamId(creatorId, dto.teamId);
      const members = await this.prisma.teamMember.findMany({
        where: { teamId: dto.teamId },
        select: { userId: true },
      });
      const onRoster = new Set(project.participants.map((p) => p.userId));
      return [...new Set(members.map((m) => m.userId))].filter((id) => onRoster.has(id));
    }

    if (dto.userIds?.length) {
      const unique = [...new Set(dto.userIds)];
      this.ensureOnRoster(project, unique);
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

  private async orderedTeamMemberIds(teamIds: string[]) {
    if (!teamIds.length) return [];
    const members = await this.prisma.teamMember.findMany({
      where: { teamId: { in: teamIds } },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      select: { userId: true },
    });
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const member of members) {
      if (seen.has(member.userId)) continue;
      seen.add(member.userId);
      ordered.push(member.userId);
    }
    return ordered;
  }

  private async buildCreateRoster(creatorId: string, teamIds: string[], selectedUserIds: string[]) {
    const ordered: string[] = [creatorId];
    const seen = new Set<string>([creatorId]);

    for (const memberId of await this.orderedTeamMemberIds(teamIds)) {
      if (seen.has(memberId)) continue;
      seen.add(memberId);
      ordered.push(memberId);
    }

    for (const id of selectedUserIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
    }

    return ordered;
  }

  private ensureOnRoster(project: { participants: { userId: string }[] }, userIds: string[]) {
    const onRoster = new Set(project.participants.map((participant) => participant.userId));
    if (userIds.some((id) => !onRoster.has(id))) {
      throw new BadRequestException('Users must already be project participants');
    }
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
    project: {
      id: string;
      createdBy: string;
      teamId: string | null;
      projectTeams: { teamId: string }[];
      participants: { userId: string }[];
    },
    userId: string,
  ) {
    if (project.createdBy === userId) return;
    if (project.participants.some((p) => p.userId === userId)) return;

    const teamIds = project.projectTeams.length
      ? project.projectTeams.map((qt) => qt.teamId)
      : project.teamId
        ? [project.teamId]
        : [];

    if (!teamIds.length) throw new ForbiddenException('Not allowed to view this project');

    const member = await this.prisma.teamMember.findFirst({
      where: { teamId: { in: teamIds }, userId },
    });
    if (!member) throw new ForbiddenException('Not allowed to view this project');
  }

  private ensureCreator(project: { createdBy: string }, userId: string) {
    if (project.createdBy !== userId) {
      throw new ForbiddenException('Only the project manager who created this project can change it');
    }
  }

  private ensureEditable(project: { status: string }) {
    const status = this.normalizeStatus(project.status);
    if (status === 'completed') {
      throw new BadRequestException('Cannot change a completed project');
    }
  }

  private assertStartSprint(
    project: { sprints: { number: number }[] },
    startSprintNumber: number,
  ) {
    const maxSprint = project.sprints[project.sprints.length - 1]?.number ?? 0;
    if (!maxSprint || startSprintNumber < 1 || startSprintNumber > maxSprint) {
      throw new BadRequestException(
        maxSprint
          ? `startSprintNumber must be between 1 and ${maxSprint}`
          : 'Project has no sprints to place an epic in',
      );
    }
  }

  private assertStartSprintWeek(startSprintWeek: number) {
    if (startSprintWeek !== 1 && startSprintWeek !== 2) {
      throw new BadRequestException('startSprintWeek must be 1 or 2');
    }
  }

  private assertMaxWorkingDaysPerSprint(value: number) {
    if (
      !Number.isInteger(value) ||
      value < MIN_MAX_WORKING_DAYS_PER_SPRINT ||
      value > MAX_MAX_WORKING_DAYS_PER_SPRINT
    ) {
      throw new BadRequestException(
        `maxWorkingDaysPerSprint must be an integer between ${MIN_MAX_WORKING_DAYS_PER_SPRINT} and ${MAX_MAX_WORKING_DAYS_PER_SPRINT}`,
      );
    }
  }

  private resolveAssignmentWorkingDays(
    backlogWorkingDays: number,
    existingAssignmentDays: number[],
    requested?: number,
  ): number {
    if (!existingAssignmentDays.length) {
      if (requested === undefined) return backlogWorkingDays;
      if (
        !Number.isInteger(requested) ||
        requested < 1 ||
        requested > backlogWorkingDays
      ) {
        throw new BadRequestException(
          `workingDays must be between 1 and ${backlogWorkingDays}`,
        );
      }
      return requested;
    }

    const remaining =
      backlogWorkingDays - existingAssignmentDays.reduce((sum, days) => sum + days, 0);
    if (remaining < 1) {
      throw new BadRequestException('This epic has no working days left to assign');
    }
    return remaining;
  }

  private planScheduledAssignmentDays(
    project: Awaited<ReturnType<ProjectsService['loadProject']>>,
    assigneeIds: string[],
    backlogWorkingDays: number,
    startSprintNumber: number,
    startSprintWeek: number,
  ): { userId: string; workingDays: number }[] {
    const planned: { userId: string; workingDays: number }[] = [];
    const allocated: number[] = [];
    for (const assigneeId of assigneeIds) {
      const workingDays = this.resolveAssignmentWorkingDays(backlogWorkingDays, allocated);
      this.assertAssignmentFits(
        project,
        null,
        assigneeId,
        workingDays,
        startSprintNumber,
        startSprintWeek,
      );
      planned.push({ userId: assigneeId, workingDays });
      allocated.push(workingDays);
    }
    return planned;
  }

  private assertAssignmentFits(
    project: Awaited<ReturnType<ProjectsService['loadProject']>>,
    epicId: string | null,
    userId: string,
    workingDays: number,
    startSprintNumber: number,
    startSprintWeek: number,
    options?: { allowOverflow?: boolean; excludeAssignmentId?: string },
  ) {
    const priorAssignments = project.epics.flatMap((entry) =>
      entry.assignments
        .filter(
          (assignment) =>
            assignment.userId === userId && assignment.id !== options?.excludeAssignmentId,
        )
        .map((assignment) => ({
          epicId: entry.id,
          workingDays: assignment.workingDays,
          startSprintNumber: assignment.startSprintNumber,
          startSprintWeek: assignment.startSprintWeek as SprintWeekNumber,
          createdAt: assignment.createdAt,
        })),
    );
    const absences = [
      ...project.holidays.filter((holiday) => holiday.userId === userId),
      ...project.ptos.filter((pto) => pto.userId === userId),
    ].map((absence) => ({ startDate: absence.startDate, endDate: absence.endDate }));

    const plan = planAssignmentSpan({
      workingDays,
      maxWorkingDaysPerSprint: project.maxWorkingDaysPerSprint,
      startSprintNumber,
      startSprintWeek: startSprintWeek as SprintWeekNumber,
      sprints: project.sprints,
      absences,
      epicId,
      priorAssignments,
      allowOverflow: options?.allowOverflow,
    });
    if (!plan.ok) throw new BadRequestException(plan.message);
  }

  private assertUniqueEpicTitle(
    epics: { id: string; title: string }[],
    title: string,
    excludeEpicId?: string,
  ) {
    const duplicate = epics.some((epic) => epic.title === title && epic.id !== excludeEpicId);
    if (duplicate) {
      throw new ConflictException('An epic with this name already exists in this project');
    }
  }

  private async ensureAssignable(
    project: {
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

    const allowed = await this.getAllowedAssigneeIds(creatorId, project);
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
    project: { participants: { userId: string }[] },
  ) {
    const allowed = new Set<string>([creatorId]);
    for (const p of project.participants) allowed.add(p.userId);

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
