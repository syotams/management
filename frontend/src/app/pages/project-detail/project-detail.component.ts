import { Component, OnInit } from '@angular/core';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDropList,
  CdkDropListGroup,
} from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ProjectService } from '../../services/project.service';
import { TeamService } from '../../services/team.service';
import {
  AssignableMember,
  GridChip,
  ParticipantCapacity,
  ProjectDetail,
  ProjectEpic,
  ProjectPlanView,
  Team,
} from '../../models';
import { contrastText, formatDateOnly, projectEndDateFromStart, toDateInput } from '../../utils/date';
import { formatApiError } from '../../utils/api-error';
import { EPIC_COLORS, nextEpicColor } from '../../utils/epic-colors';

type CellDropData = { participantId: string; sprintId: string };
type BacklogDropData = { backlog: true };
type DropData = CellDropData | BacklogDropData;

const BACKLOG_DROP_DATA: BacklogDropData = { backlog: true };

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [FormsModule, RouterLink, CdkDropListGroup, CdkDropList, CdkDrag],
  templateUrl: './project-detail.component.html',
  styleUrl: './project-detail.component.scss',
})
export class ProjectDetailComponent implements OnInit {
  project: ProjectDetail | null = null;
  teams: Team[] = [];
  members: AssignableMember[] = [];
  loading = true;
  error = '';
  showEdit = false;
  saving = false;

  epicTitle = '';
  epicWorkingDays: number | null = 5;
  epicStartSprint: number | null = null;
  epicColor = EPIC_COLORS[0];
  epicAssigneeIds: string[] = [];
  addingEpic = false;
  showAddEpic = false;
  addEpicError = '';
  colors = EPIC_COLORS;
  private colorIndex = 0;

  showEditEpic = false;
  editingEpic: ProjectEpic | null = null;
  editEpicTitle = '';
  editEpicWorkingDays: number | null = 5;
  editEpicStartSprint: number | null = null;
  editEpicColor = EPIC_COLORS[0];
  editEpicAssigneeId = '';
  savingEpic = false;
  movingEpic = false;

  showAddParticipant = false;
  newParticipantId = '';
  addingParticipant = false;
  addableParticipants: { id: string; name: string }[] = [];
  participantError = '';

  showAddPto = false;
  ptoName = 'PTO';
  ptoStartDate = '';
  ptoEndDate = '';
  ptoAssignmentMode: 'team' | 'individual' = 'individual';
  ptoTeamId = '';
  ptoUserIds: string[] = [];
  addingPto = false;
  ptoError = '';

  showAddHoliday = false;
  holidayName = 'Holiday';
  holidayStartDate = '';
  holidayEndDate = '';
  addingHoliday = false;
  holidayError = '';

  editName = '';
  editStartDate = '';
  editEndDate = '';
  editTeamId = '';

  backlogDropData = BACKLOG_DROP_DATA;
  rejectBacklogDrop = () => false;

  contrastText = contrastText;

  constructor(
    private route: ActivatedRoute,
    private projectService: ProjectService,
    private teamService: TeamService,
    public auth: AuthService,
  ) {}

  ngOnInit() {
    this.teamService.getTeams().subscribe((teams) => (this.teams = teams));
    this.teamService.getAssignableMembers().subscribe((members) => (this.members = members));
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) this.load(id);
    });
  }

  get isManager(): boolean {
    return this.project?.createdBy === this.auth.currentUser()?.id;
  }

  get isDraft(): boolean {
    return this.project?.status === 'draft';
  }

  get isInProgress(): boolean {
    return this.project?.status === 'in_progress';
  }

  get isCompleted(): boolean {
    return this.project?.status === 'completed';
  }

  get canEditEpics(): boolean {
    return this.isManager && !this.isCompleted;
  }

  get canCompare(): boolean {
    return !!this.project && this.project.status !== 'draft' && this.project.versionCount > 0;
  }

  get statusLabel(): string {
    if (!this.project) return '';
    if (this.project.status === 'draft') return 'Draft';
    if (this.project.status === 'in_progress') return 'In progress';
    return 'Completed';
  }

  get assigneeOptions(): { id: string; name: string }[] {
    if (!this.project) return [];
    const options = new Map<string, string>();
    for (const p of this.project.participants) options.set(p.id, p.name);
    for (const p of this.addableParticipants) options.set(p.id, p.name);
    for (const m of this.members) options.set(m.id, m.name);
    const me = this.auth.currentUser();
    if (me) options.set(me.id, me.name);
    return Array.from(options, ([id, name]) => ({ id, name }));
  }

  private loadAddableParticipants() {
    if (!this.project || !this.isManager || this.isCompleted) {
      this.addableParticipants = [];
      return;
    }
    this.projectService.getAddableParticipants(this.project.id).subscribe({
      next: (participants) => {
        this.addableParticipants = participants.map((p) => ({ id: p.id, name: p.name }));
      },
      error: () => {
        this.addableParticipants = [];
      },
    });
  }

  get teamsLabel(): string {
    if (!this.project) return '';
    const teams = this.project.teams ?? [];
    if (teams.length) return teams.map((t) => t.name).join(', ');
    return this.project.team?.name || 'No team';
  }

  get backlogEpics(): ProjectEpic[] {
    if (!this.project) return [];
    return this.project.epics.filter(
      (epic) => !epic.sourceEpicId && !epic.assignees.length && epic.startSprintNumber == null,
    );
  }

  isAssignedToUser(templateEpicId: string, userId: string): boolean {
    if (!this.project) return false;
    return this.project.epics.some(
      (epic) =>
        epic.sourceEpicId === templateEpicId &&
        epic.assignees.some((assignee) => assignee.id === userId),
    );
  }


  private normalizeProject(project: ProjectDetail): ProjectDetail {
    return {
      ...project,
      teams: project.teams ?? [],
      addedParticipants: project.addedParticipants ?? [],
      holidays: project.holidays ?? [],
      ptos: project.ptos ?? [],
      capacity: project.capacity ?? [],
    };
  }

  load(id: string) {
    this.loading = true;
    this.error = '';
    this.projectService.getProject(id).subscribe({
      next: (project) => {
        this.project = this.normalizeProject(project);
        this.loading = false;
        this.colorIndex = project.epics.length;
        this.epicColor = nextEpicColor(this.colorIndex);
        this.syncEpicAssignees();
        this.loadAddableParticipants();
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load project';
        this.loading = false;
      },
    });
  }

  formatRange(start: string, end: string) {
    return `${formatDateOnly(start)} – ${formatDateOnly(end)}`;
  }

  sprintDates(start: string, end: string) {
    return `${formatDateOnly(start, false)} – ${formatDateOnly(end, false)}`;
  }

  onEditStartDateChange() {
    this.editEndDate = projectEndDateFromStart(this.editStartDate);
  }

  openEdit() {
    if (!this.project || this.isCompleted) return;
    this.editName = this.project.name;
    this.editStartDate = toDateInput(this.project.startDate);
    this.editEndDate = projectEndDateFromStart(this.editStartDate);
    this.editTeamId = this.project.teamId || '';
    this.showEdit = true;
  }

  saveEdit() {
    if (!this.project || !this.editName.trim()) return;
    this.saving = true;
    this.error = '';
    this.projectService
      .updateProject(this.project.id, {
        name: this.editName.trim(),
        startDate: this.editStartDate,
        endDate: this.editEndDate,
        teamId: this.editTeamId || null,
      })
      .subscribe({
        next: (project) => {
          this.project = this.normalizeProject(project);
          this.saving = false;
          this.showEdit = false;
          this.syncEpicAssignees();
        },
        error: (err) => {
          this.saving = false;
          const msg = err.error?.message;
          this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to update project';
        },
      });
  }

  startProject() {
    if (!this.project) return;
    if (!this.project.epics.length) {
      this.error = 'Add at least one epic before starting the project';
      return;
    }
    if (
      !confirm(
        'Start this project? The current plan will be saved as the original version. Later changes will create new versions.',
      )
    ) {
      return;
    }
    this.projectService.startProject(this.project.id).subscribe({
      next: (project) => (this.project = this.normalizeProject(project)),
      error: (err) => {
        const msg = err.error?.message;
        this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to start project';
      },
    });
  }

  completeProject() {
    if (!this.project) return;
    if (
      !confirm(
        'Mark this project as complete? You will not be able to edit it further.',
      )
    ) {
      return;
    }
    this.projectService.completeProject(this.project.id).subscribe({
      next: (project) => (this.project = this.normalizeProject(project)),
      error: (err) => {
        const msg = err.error?.message;
        this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to complete project';
      },
    });
  }

  get ptoTeamOptions(): { id: string; name: string }[] {
    if (!this.project) return [];
    const teams = this.project.teams ?? [];
    if (teams.length) return teams;
    if (this.project.team) return [this.project.team];
    return [];
  }

  get projectDateMin(): string {
    return this.project ? toDateInput(this.project.startDate) : '';
  }

  get projectDateMax(): string {
    return this.project ? toDateInput(this.project.endDate) : '';
  }

  capacityClass(assigned: number, total: number): string {
    if (total <= 0) return '';
    if (assigned > total) return 'capacity-over';
    if (assigned >= total * 0.9) return 'capacity-high';
    return '';
  }

  committedTooltip(row: ParticipantCapacity): string {
    const sprintCapacity = row.sprintCapacity ?? row.totalCapacity;
    return [
      `${row.epicDaysAssigned}/${row.totalCapacity}/${sprintCapacity}`,
      '',
      `Committed (${row.epicDaysAssigned}): epic days assigned to the user`,
      `Capacity (${row.totalCapacity}): available working days after PTO and holidays`,
      `Sprint capacity (${sprintCapacity}): total working days across all sprints`,
    ].join('\n');
  }

  openAddPto() {
    this.ptoError = '';
    this.ptoName = 'PTO';
    this.ptoStartDate = '';
    this.ptoEndDate = '';
    this.ptoAssignmentMode = this.ptoTeamOptions.length ? 'team' : 'individual';
    this.ptoTeamId = this.ptoTeamOptions[0]?.id ?? '';
    this.ptoUserIds = [];
    this.showAddPto = true;
  }

  isPtoUserSelected(id: string) {
    return this.ptoUserIds.includes(id);
  }

  togglePtoUser(id: string) {
    if (this.ptoUserIds.includes(id)) {
      this.ptoUserIds = this.ptoUserIds.filter((value) => value !== id);
    } else {
      this.ptoUserIds = [...this.ptoUserIds, id];
    }
  }

  canAddPto() {
    if (!this.ptoStartDate || !this.ptoEndDate) return false;
    if (!this.isWithinProjectRange(this.ptoStartDate, this.ptoEndDate)) return false;
    if (this.ptoAssignmentMode === 'team') return !!this.ptoTeamId;
    return this.ptoUserIds.length > 0;
  }

  addPto() {
    if (!this.project || !this.canAddPto()) return;
    this.addingPto = true;
    this.ptoError = '';
    this.error = '';
    const payload =
      this.ptoAssignmentMode === 'team'
        ? {
            name: this.ptoName.trim() || 'PTO',
            startDate: this.ptoStartDate,
            endDate: this.ptoEndDate,
            teamId: this.ptoTeamId,
          }
        : {
            name: this.ptoName.trim() || 'PTO',
            startDate: this.ptoStartDate,
            endDate: this.ptoEndDate,
            userIds: this.ptoUserIds,
          };
    this.projectService.addPto(this.project.id, payload).subscribe({
      next: (project) => {
        this.project = this.normalizeProject(project);
        this.addingPto = false;
        this.showAddPto = false;
      },
      error: (err) => {
        this.addingPto = false;
        this.ptoError = formatApiError(err, 'Failed to add PTO');
      },
    });
  }

  deletePto(ptoId: string, event?: Event) {
    event?.stopPropagation();
    if (!this.project || !this.canEditEpics) return;
    if (!confirm('Remove this PTO entry?')) return;
    this.error = '';
    this.projectService.deletePto(this.project.id, ptoId).subscribe({
      next: (project) => (this.project = this.normalizeProject(project)),
      error: (err) => {
        const msg = err.error?.message;
        this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to remove PTO';
      },
    });
  }

  openAddHoliday() {
    this.holidayError = '';
    this.holidayName = 'Holiday';
    this.holidayStartDate = '';
    this.holidayEndDate = '';
    this.showAddHoliday = true;
  }

  canAddHoliday() {
    return (
      !!this.holidayStartDate &&
      !!this.holidayEndDate &&
      this.isWithinProjectRange(this.holidayStartDate, this.holidayEndDate)
    );
  }

  private isWithinProjectRange(startDate: string, endDate: string) {
    if (!this.projectDateMin || !this.projectDateMax) return false;
    if (startDate > endDate) return false;
    return startDate >= this.projectDateMin && endDate <= this.projectDateMax;
  }

  addHoliday() {
    if (!this.project || !this.canAddHoliday()) return;
    this.addingHoliday = true;
    this.holidayError = '';
    this.error = '';
    this.projectService
      .addHoliday(this.project.id, {
        name: this.holidayName.trim() || 'Holiday',
        startDate: this.holidayStartDate,
        endDate: this.holidayEndDate,
      })
      .subscribe({
        next: (project) => {
          this.project = this.normalizeProject(project);
          this.addingHoliday = false;
          this.showAddHoliday = false;
        },
        error: (err) => {
          this.addingHoliday = false;
          this.holidayError = formatApiError(err, 'Failed to add holiday');
        },
      });
  }

  deleteHoliday(holidayId: string, event?: Event) {
    event?.stopPropagation();
    if (!this.project || !this.canEditEpics) return;
    if (!confirm('Remove this holiday for this user?')) return;
    this.error = '';
    this.projectService.deleteHoliday(this.project.id, holidayId).subscribe({
      next: (project) => (this.project = this.normalizeProject(project)),
      error: (err) => {
        const msg = err.error?.message;
        this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to remove holiday';
      },
    });
  }

  deleteHolidayGroup(groupKey: string) {
    if (!this.project || !this.canEditEpics) return;
    if (!confirm('Remove this holiday for all participants?')) return;
    this.error = '';
    this.projectService.deleteHolidayGroup(this.project.id, groupKey).subscribe({
      next: (project) => (this.project = this.normalizeProject(project)),
      error: (err) => {
        const msg = err.error?.message;
        this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to remove holiday';
      },
    });
  }

  openAddParticipant() {
    this.participantError = '';
    this.newParticipantId = this.addableParticipants[0]?.id ?? '';
    this.showAddParticipant = true;
  }

  addParticipant() {
    if (!this.project || !this.newParticipantId) return;
    this.addingParticipant = true;
    this.participantError = '';
    this.error = '';
    this.projectService.addParticipant(this.project.id, this.newParticipantId).subscribe({
      next: (project) => {
        this.project = this.normalizeProject(project);
        this.addingParticipant = false;
        this.showAddParticipant = false;
        this.syncEpicAssignees();
        this.loadAddableParticipants();
      },
      error: (err) => {
        this.addingParticipant = false;
        const msg = err.error?.message;
        this.participantError = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to add participant';
      },
    });
  }

  isAssigneeSelected(id: string) {
    return this.epicAssigneeIds.includes(id);
  }

  toggleAssignee(id: string) {
    if (this.epicAssigneeIds.includes(id)) {
      this.epicAssigneeIds = this.epicAssigneeIds.filter((value) => value !== id);
    } else {
      this.epicAssigneeIds = [...this.epicAssigneeIds, id];
    }
  }

  canAddEpic() {
    return (
      !!this.epicTitle.trim() &&
      !!this.epicWorkingDays &&
      this.epicWorkingDays > 0 &&
      !!this.epicColor
    );
  }

  canSaveEpic() {
    return (
      !!this.editEpicTitle.trim() &&
      !!this.editEpicWorkingDays &&
      this.editEpicWorkingDays > 0 &&
      !!this.editEpicColor
    );
  }

  private advanceEpicColor() {
    this.colorIndex += 1;
    this.epicColor = nextEpicColor(this.colorIndex);
  }

  openAddEpic() {
    if (!this.canEditEpics) return;
    this.addEpicError = '';
    this.epicTitle = '';
    this.epicWorkingDays = 5;
    this.epicStartSprint = null;
    this.epicAssigneeIds = [];
    this.epicColor = nextEpicColor(this.colorIndex);
    this.showAddEpic = true;
  }

  addEpic() {
    if (!this.project || !this.canAddEpic()) return;
    this.addingEpic = true;
    this.addEpicError = '';
    this.error = '';
    this.projectService
      .addEpic(this.project.id, {
        title: this.epicTitle.trim(),
        workingDays: Number(this.epicWorkingDays),
        startSprintNumber: this.epicStartSprint,
        assigneeIds: this.epicAssigneeIds.length ? this.epicAssigneeIds : undefined,
        backgroundColor: this.epicColor,
      })
      .subscribe({
        next: (project) => {
          this.project = this.normalizeProject(project);
          this.addingEpic = false;
          this.showAddEpic = false;
          this.epicTitle = '';
          this.epicWorkingDays = 5;
          this.epicStartSprint = null;
          this.epicAssigneeIds = [];
          this.advanceEpicColor();
          this.syncEpicAssignees();
        },
        error: (err) => {
          this.addingEpic = false;
          const msg = err.error?.message;
          this.addEpicError = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to add epic';
        },
      });
  }

  openEditEpic(epicId: string, event?: Event) {
    event?.stopPropagation();
    if (!this.project || !this.canEditEpics) return;
    const epic = this.project.epics.find((e) => e.id === epicId);
    if (!epic) return;
    this.editingEpic = epic;
    this.editEpicTitle = epic.title;
    this.editEpicWorkingDays = epic.workingDays;
    this.editEpicStartSprint = epic.startSprintNumber;
    this.editEpicColor = epic.backgroundColor;
    this.editEpicAssigneeId = epic.assignees[0]?.id ?? '';
    this.showEditEpic = true;
  }

  saveEditEpic() {
    if (!this.project || !this.editingEpic || !this.canSaveEpic()) return;
    this.savingEpic = true;
    this.error = '';
    this.projectService
      .updateEpic(this.project.id, this.editingEpic.id, {
        title: this.editEpicTitle.trim(),
        workingDays: Number(this.editEpicWorkingDays),
        startSprintNumber: this.editEpicStartSprint,
        assigneeIds: this.editEpicAssigneeId ? [this.editEpicAssigneeId] : [],
        backgroundColor: this.editEpicColor,
      })
      .subscribe({
        next: (project) => {
          this.project = this.normalizeProject(project);
          this.savingEpic = false;
          this.showEditEpic = false;
          this.editingEpic = null;
          this.syncEpicAssignees();
        },
        error: (err) => {
          this.savingEpic = false;
          const msg = err.error?.message;
          this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to update epic';
        },
      });
  }

  deleteEpic(epicId: string, event?: Event) {
    event?.stopPropagation();
    if (!this.project || !this.canEditEpics) return;
    if (!confirm('Delete this epic entry?')) return;
    this.error = '';
    this.projectService.deleteEpic(this.project.id, epicId).subscribe({
      next: (project) => {
        this.project = this.normalizeProject(project);
        if (this.editingEpic?.id === epicId) {
          this.showEditEpic = false;
          this.editingEpic = null;
        }
        this.syncEpicAssignees();
      },
      error: (err) => {
        const msg = err.error?.message;
        this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to delete epic';
      },
    });
  }

  cellDropData(participantId: string, sprintId: string): CellDropData {
    return { participantId, sprintId };
  }

  onEpicDrop(event: CdkDragDrop<unknown>) {
    if (!this.project || !this.canEditEpics || this.movingEpic) return;
    if (event.previousContainer === event.container) return;

    const to = event.container.data as DropData;
    if (!('participantId' in to)) return;

    const from = event.previousContainer.data as DropData;
    let epicId: string;
    if ('backlog' in from) {
      epicId = (event.item.data as ProjectEpic).id;
    } else {
      const chip = event.item.data as GridChip;
      if (chip.type !== 'epic') return;
      epicId = chip.id;
    }

    const epic = this.project.epics.find((e) => e.id === epicId);
    const targetSprint = this.project.sprints.find((s) => s.id === to.sprintId);
    if (!epic || !targetSprint) return;

    const assigneeIds = [to.participantId];
    const startSprintNumber = targetSprint.number;

    if ('backlog' in from) {
      const template = epic;
      if (this.isAssignedToUser(template.id, to.participantId)) {
        this.error = 'This epic is already assigned to that user';
        return;
      }
      this.movingEpic = true;
      this.error = '';
      this.projectService
        .assignEpic(this.project.id, template.id, to.participantId, startSprintNumber)
        .subscribe({
          next: (project) => {
            this.project = this.normalizeProject(project);
            this.movingEpic = false;
            this.syncEpicAssignees();
          },
          error: (err) => {
            this.movingEpic = false;
            const msg = err.error?.message;
            this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to assign epic';
          },
        });
      return;
    }

    const currentAssignee = epic.assignees[0]?.id;
    if (currentAssignee === to.participantId && startSprintNumber === epic.startSprintNumber) return;

    this.movingEpic = true;
    this.error = '';
    this.projectService
      .updateEpic(this.project.id, epic.id, { startSprintNumber, assigneeIds })
      .subscribe({
        next: (project) => {
          this.project = this.normalizeProject(project);
          this.movingEpic = false;
          this.syncEpicAssignees();
        },
        error: (err) => {
          this.movingEpic = false;
          const msg = err.error?.message;
          this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to move epic';
        },
      });
  }

  cellsFor(participantId: string, sprintId: string) {
    return this.project?.participants.find((p) => p.id === participantId)?.cells?.[sprintId] ?? [];
  }

  planCells(plan: ProjectPlanView, participantId: string, sprintId: string) {
    return plan.participants.find((p) => p.id === participantId)?.cells?.[sprintId] ?? [];
  }

  private syncEpicAssignees() {
    const ids = this.assigneeOptions.map((o) => o.id);
    this.epicAssigneeIds = this.epicAssigneeIds.filter((id) => ids.includes(id));
    const maxSprint = this.project?.sprints[this.project.sprints.length - 1]?.number ?? 1;
    if (this.epicStartSprint != null && this.epicStartSprint > maxSprint) {
      this.epicStartSprint = null;
    }
    if (this.editEpicAssigneeId && !ids.includes(this.editEpicAssigneeId)) {
      this.editEpicAssigneeId = '';
    }
    if (this.editEpicStartSprint != null && this.editEpicStartSprint > maxSprint) {
      this.editEpicStartSprint = null;
    }
  }
}
