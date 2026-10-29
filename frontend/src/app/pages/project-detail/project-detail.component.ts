import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
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
  GridChip,
  ProjectDetail,
  ProjectEpic,
  ProjectPlanView,
  Team,
} from '../../models';
import { contrastText, formatDateOnly, projectEndDateFromStart, toDateInput, addUtcDaysToDateInput } from '../../utils/date';
import { formatApiError } from '../../utils/api-error';
import { EPIC_COLOR_OPTIONS, EPIC_COLORS, nextUnusedEpicColor } from '../../utils/epic-colors';
import { truncateEpicTitle } from '../../utils/text';

type CellDropData = { participantId: string; sprintId: string; week: 1 | 2; cellKey: string };
type BacklogDropData = { backlog: true };
type DropData = CellDropData | BacklogDropData;
type CellAssignMenuState = {
  key: string;
  cell: CellDropData;
  sprintNumber: number;
  weekStartDate: string;
  top: number;
  left: number;
};

const BACKLOG_DROP_DATA: BacklogDropData = { backlog: true };
const SHOW_WEEK_HEADERS_KEY = 'project-plan-show-week-headers';
const CELL_ASSIGN_MENU_WIDTH = 256;
const CELL_ASSIGN_MENU_MAX_HEIGHT = 224;

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [FormsModule, RouterLink, CdkDropListGroup, CdkDropList, CdkDrag],
  templateUrl: './project-detail.component.html',
  styleUrl: './project-detail.component.scss',
})
export class ProjectDetailComponent implements OnInit, OnDestroy {
  project: ProjectDetail | null = null;
  teams: Team[] = [];
  loading = true;
  error = '';
  showEdit = false;
  saving = false;

  epicTitle = '';
  epicWorkingDays: number | null = 5;
  epicStartSprint: number | null = null;
  epicStartWeek: number | null = null;
  epicColor = EPIC_COLORS[0];
  epicAssigneeIds: string[] = [];
  addingEpic = false;
  showAddEpic = false;
  addEpicError = '';
  colors = EPIC_COLOR_OPTIONS;

  showEditEpic = false;
  editingEpic: ProjectEpic | null = null;
  editEpicTitle = '';
  editEpicWorkingDays: number | null = 5;
  editEpicStartSprint: number | null = null;
  editEpicStartWeek: number | null = null;
  editEpicColor = EPIC_COLORS[0];
  editEpicAssigneeId = '';
  savingEpic = false;
  editEpicError = '';
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
  editMaxWorkingDaysPerSprint: number | null = 8;
  editTeamIds: string[] = [];

  backlogDropData = BACKLOG_DROP_DATA;
  rejectBacklogDrop = () => false;
  showWeekHeaders = localStorage.getItem(SHOW_WEEK_HEADERS_KEY) === 'true';
  showDetailMetrics = false;
  cellAssignMenu: CellAssignMenuState | null = null;
  showAssignDays = false;
  assignDaysValue: number | null = null;
  assignDaysMax = 1;
  assignDaysTitle = '';
  assignDaysError = '';
  private assignDaysTarget: { templateEpicId: string; cell: CellDropData } | null = null;
  private readonly closeCellAssignMenuOnScroll = (event: Event) => {
    const target = event.target;
    if (target instanceof Node) {
      const menuEl = target instanceof Element ? target : target.parentElement;
      if (menuEl?.closest('.cell-assign-menu')) return;
    }
    this.closeCellAssignMenu();
  };

  contrastText = contrastText;
  truncateEpicTitle = truncateEpicTitle;

  constructor(
    private route: ActivatedRoute,
    private projectService: ProjectService,
    private teamService: TeamService,
    public auth: AuthService,
  ) {}

  @HostListener('document:click')
  onDocumentClick() {
    this.closeCellAssignMenu();
  }

  @HostListener('window:resize')
  onWindowResize() {
    this.closeCellAssignMenu();
  }

  ngOnInit() {
    document.addEventListener('scroll', this.closeCellAssignMenuOnScroll, true);
    this.teamService.getTeams().subscribe((teams) => (this.teams = teams));
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) this.load(id);
    });
  }

  ngOnDestroy() {
    document.removeEventListener('scroll', this.closeCellAssignMenuOnScroll, true);
  }

  toggleWeekHeaders() {
    this.showWeekHeaders = !this.showWeekHeaders;
    localStorage.setItem(SHOW_WEEK_HEADERS_KEY, String(this.showWeekHeaders));
  }

  closeCellAssignMenu() {
    this.cellAssignMenu = null;
  }

  isCellAssignMenuOpen(participantId: string, cellKey: string) {
    return this.cellAssignMenu?.key === `${participantId}:${cellKey}`;
  }

  openCellAssignMenu(
    event: MouseEvent,
    participantId: string,
    sprintId: string,
    sprintNumber: number,
    week: 1 | 2,
    cellKey: string,
    weekStartDate: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canEditEpics || this.movingEpic) return;

    const key = `${participantId}:${cellKey}`;
    if (this.cellAssignMenu?.key === key) {
      this.closeCellAssignMenu();
      return;
    }

    const trigger = event.currentTarget as HTMLElement;
    const placeholder =
      trigger.closest('.plan-cell')?.querySelector('.epic-stack') ?? trigger;
    const rect = placeholder.getBoundingClientRect();
    let left = rect.left;
    if (left + CELL_ASSIGN_MENU_WIDTH > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - CELL_ASSIGN_MENU_WIDTH - 8);
    } else {
      left = Math.max(8, left);
    }
    const openBelow = rect.bottom + 4 + CELL_ASSIGN_MENU_MAX_HEIGHT <= window.innerHeight;
    const top = openBelow
      ? rect.bottom + 4
      : Math.max(8, rect.top - CELL_ASSIGN_MENU_MAX_HEIGHT - 4);

    this.cellAssignMenu = {
      key,
      cell: this.cellDropData(participantId, sprintId, week, cellKey),
      sprintNumber,
      weekStartDate,
      top,
      left,
    };
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

  get canRemoveParticipants(): boolean {
    return this.isManager && this.isDraft;
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
    return this.project.participants.map((person) => ({ id: person.id, name: person.name }));
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

  get projectMetrics(): { label: string; value: number; hint: string; tone?: 'match' | 'over'; supplemental?: boolean }[] {
    if (!this.project) return [];
    const sprintCount = this.project.sprints.length;
    const totalPto = (this.project.capacity ?? []).reduce((sum, row) => sum + row.ptoDays, 0);
    const totalHolidays = (this.project.holidays ?? []).reduce((sum, holiday) => sum + holiday.workingDays, 0);
    const totalCapacity = (this.project.capacity ?? []).reduce((sum, row) => sum + row.totalCapacity, 0);
    const assigned = (this.project.capacity ?? []).reduce((sum, row) => sum + row.epicDaysAssigned, 0);
    return [
      {
        label: 'Total working days',
        value: this.project.maxWorkingDaysPerSprint * sprintCount,
        hint: 'Working days per sprint × number of sprints',
        supplemental: true,
      },
      {
        label: 'Total PTO',
        value: totalPto,
        hint: 'PTO days users have taken in this project',
        supplemental: true,
      },
      {
        label: 'Total holidays',
        value: totalHolidays,
        hint: 'Holiday days in this project',
        supplemental: true,
      },
      {
        label: 'Total capacity',
        value: totalCapacity,
        hint: 'Sum of each user’s capacity',
      },
      {
        label: 'Assigned',
        value: assigned,
        hint: 'Working days assigned to users',
        tone: this.capacityFillTone(assigned, totalCapacity),
      },
      {
        label: 'Backlog',
        value: this.backlogWorkingDays,
        hint: 'Working days set on backlog epics',
        tone: this.capacityFillTone(this.backlogWorkingDays, totalCapacity),
      },
    ];
  }

  get primaryMetrics() {
    return this.projectMetrics.filter((metric) => !metric.supplemental);
  }

  get supplementalMetrics() {
    return this.projectMetrics.filter((metric) => metric.supplemental);
  }

  get backlogEpics(): ProjectEpic[] {
    if (!this.project) return [];
    return this.project.epics
      .filter(
        (epic) =>
          !epic.sourceEpicId &&
          !epic.assignees.length &&
          epic.startSprintNumber == null &&
          epic.startSprintWeek == null,
      )
      .sort((a, b) => {
        const priorityDelta = (b.priority ?? 0) - (a.priority ?? 0);
        if (priorityDelta !== 0) return priorityDelta;
        return a.createdAt.localeCompare(b.createdAt);
      });
  }

  get backlogWorkingDays(): number {
    return this.backlogEpics.reduce((sum, epic) => sum + epic.workingDays, 0);
  }

  assignedWorkingDays(templateEpicId: string): number {
    if (!this.project) return 0;
    return this.project.epics
      .filter((epic) => epic.sourceEpicId === templateEpicId)
      .reduce((sum, epic) => sum + epic.workingDays, 0);
  }

  isBacklogFullyAssigned(epic: ProjectEpic): boolean {
    return this.assignedWorkingDays(epic.id) >= epic.workingDays;
  }

  backlogEpicTitle(epic: ProjectEpic): string {
    const assigned = this.assignedWorkingDays(epic.id);
    return `${epic.title} · ${assigned}/${epic.workingDays}d assigned`;
  }

  get weekColumnCount(): number {
    if (!this.project) return 0;
    return this.project.sprints.reduce((sum, sprint) => sum + (sprint.weeks?.length ?? 2), 0);
  }

  onEpicStartSprintChange(sprint: number | null) {
    this.epicStartSprint = sprint;
    if (sprint == null) this.epicStartWeek = null;
    else if (this.epicStartWeek == null) this.epicStartWeek = 1;
  }

  onEditEpicStartSprintChange(sprint: number | null) {
    this.editEpicStartSprint = sprint;
    if (sprint == null) this.editEpicStartWeek = null;
    else if (this.editEpicStartWeek == null) this.editEpicStartWeek = 1;
  }

  isAssignedToUser(
    templateEpicId: string,
    userId: string,
    startSprintNumber?: number | null,
    startSprintWeek?: number | null,
  ): boolean {
    if (!this.project) return false;
    return this.project.epics.some(
      (epic) =>
        epic.sourceEpicId === templateEpicId &&
        epic.assignees.some((assignee) => assignee.id === userId) &&
        (startSprintNumber == null || epic.startSprintNumber === startSprintNumber) &&
        (startSprintWeek == null || epic.startSprintWeek === startSprintWeek),
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
      sprintSummaries: project.sprintSummaries ?? [],
      sprints: (project.sprints ?? []).map((sprint) => ({
        ...sprint,
        weeks:
          sprint.weeks?.length === 2
            ? sprint.weeks
            : [
                {
                  week: 1 as const,
                  startDate: sprint.startDate,
                  endDate: sprint.endDate,
                  workingDays: sprint.workingDays,
                  cellKey: `${sprint.id}:w1`,
                },
                {
                  week: 2 as const,
                  startDate: sprint.startDate,
                  endDate: sprint.endDate,
                  workingDays: 0,
                  cellKey: `${sprint.id}:w2`,
                },
              ],
      })),
    };
  }

  load(id: string) {
    this.loading = true;
    this.error = '';
    this.projectService.getProject(id).subscribe({
      next: (project) => {
        this.project = this.normalizeProject(project);
        this.loading = false;
        this.epicColor = this.pickNextEpicColor(project);
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
    this.editMaxWorkingDaysPerSprint = this.project.maxWorkingDaysPerSprint ?? 8;
    const linked = this.project.teams?.map((team) => team.id) ?? [];
    this.editTeamIds = linked.length ? [...linked] : this.project.teamId ? [this.project.teamId] : [];
    this.showEdit = true;
  }

  isEditTeamSelected(id: string) {
    return this.editTeamIds.includes(id);
  }

  toggleEditTeam(id: string) {
    if (this.editTeamIds.includes(id)) {
      this.editTeamIds = this.editTeamIds.filter((value) => value !== id);
    } else {
      this.editTeamIds = [...this.editTeamIds, id];
    }
  }

  isMaxWorkingDaysValid(value: number | null) {
    return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 10;
  }

  saveEdit() {
    if (!this.project || !this.editName.trim() || !this.isMaxWorkingDaysValid(this.editMaxWorkingDaysPerSprint)) return;
    this.saving = true;
    this.error = '';
    this.projectService
      .updateProject(this.project.id, {
        name: this.editName.trim(),
        startDate: this.editStartDate,
        endDate: this.editEndDate,
        maxWorkingDaysPerSprint: Number(this.editMaxWorkingDaysPerSprint),
        teamIds: this.editTeamIds,
      })
      .subscribe({
        next: (project) => {
          this.project = this.normalizeProject(project);
          this.saving = false;
          this.showEdit = false;
          this.syncEpicAssignees();
          this.loadAddableParticipants();
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

  capacityFillTone(value: number, totalCapacity: number): 'match' | 'over' | undefined {
    if (value > totalCapacity) return 'over';
    if (value >= totalCapacity * 0.95) return 'match';
    return undefined;
  }

  capacityClass(assigned: number, total: number): string {
    if (total <= 0) return '';
    if (assigned > total) return 'capacity-over';
    if (assigned >= total * 0.9) return 'capacity-high';
    return '';
  }

  sprintSummaryDates(sprintId: string): string {
    const sprint = this.project?.sprints.find((entry) => entry.id === sprintId);
    if (!sprint) return '';
    return this.sprintDates(sprint.startDate, sprint.endDate);
  }

  openAddPto(ctx?: { userId: string; startDate: string; endDate: string }) {
    this.ptoError = '';
    this.ptoName = 'PTO';
    if (ctx) {
      this.ptoStartDate = toDateInput(ctx.startDate);
      this.ptoEndDate = toDateInput(ctx.endDate);
      this.ptoAssignmentMode = 'individual';
      this.ptoTeamId = '';
      this.ptoUserIds = [ctx.userId];
    } else {
      this.ptoStartDate = '';
      this.ptoEndDate = '';
      this.ptoAssignmentMode = this.ptoTeamOptions.length ? 'team' : 'individual';
      this.ptoTeamId = this.ptoTeamOptions[0]?.id ?? '';
      this.ptoUserIds = [];
    }
    this.showAddPto = true;
  }

  openAddPtoFromCell(participantId: string, weekStartDate: string) {
    this.closeCellAssignMenu();
    const startDate = toDateInput(weekStartDate);
    this.openAddPto({
      userId: participantId,
      startDate,
      endDate: addUtcDaysToDateInput(startDate, 1),
    });
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

  removeParticipant(person: { id: string; name: string }) {
    if (!this.project || !this.canRemoveParticipants) return;
    if (
      !confirm(
        `Remove ${person.name} from this project? Their epic assignments, PTO, and holidays on this project will be removed.`,
      )
    ) {
      return;
    }
    this.error = '';
    this.projectService.removeParticipant(this.project.id, person.id).subscribe({
      next: (project) => {
        this.project = this.normalizeProject(project);
        this.syncEpicAssignees();
        this.loadAddableParticipants();
      },
      error: (err) => {
        const msg = err.error?.message;
        this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to remove participant';
      },
    });
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
    if (!this.epicAssigneeIds.length) {
      this.epicStartSprint = null;
      this.epicStartWeek = null;
    }
  }

  canAddEpic() {
    const hasAssignees = this.epicAssigneeIds.length > 0;
    return (
      !!this.epicTitle.trim() &&
      !!this.epicWorkingDays &&
      this.epicWorkingDays > 0 &&
      !!this.epicColor &&
      (!hasAssignees || (this.epicStartSprint != null && this.epicStartWeek != null))
    );
  }

  canSaveEpic() {
    const hasSchedule = this.editEpicStartSprint != null || !!this.editEpicAssigneeId;
    return (
      !!this.editEpicTitle.trim() &&
      !!this.editEpicWorkingDays &&
      this.editEpicWorkingDays > 0 &&
      !!this.editEpicColor &&
      (!hasSchedule || (this.editEpicStartSprint != null && this.editEpicStartWeek != null))
    );
  }

  private isEpicTitleTaken(title: string, excludeEpicId?: string | null) {
    if (!this.project) return false;
    const normalized = title.trim();
    return this.project.epics.some(
      (epic) =>
        !epic.sourceEpicId &&
        epic.title === normalized &&
        epic.id !== excludeEpicId,
    );
  }

  private pickNextEpicColor(project: ProjectDetail = this.project!) {
    // Only backlog templates own a unique color; assignment copies share theirs.
    const used = project.epics
      .filter((epic) => !epic.sourceEpicId)
      .map((epic) => epic.backgroundColor);
    return nextUnusedEpicColor(used);
  }

  private advanceEpicColor() {
    if (!this.project) return;
    this.epicColor = this.pickNextEpicColor();
  }

  openAddEpic() {
    if (!this.canEditEpics) return;
    this.addEpicError = '';
    this.epicTitle = '';
    this.epicWorkingDays = 5;
    this.epicStartSprint = null;
    this.epicStartWeek = null;
    this.epicAssigneeIds = [];
    this.epicColor = this.project ? this.pickNextEpicColor() : EPIC_COLORS[0];
    this.showAddEpic = true;
  }

  addEpic() {
    if (!this.project || !this.canAddEpic()) return;
    this.addingEpic = true;
    this.addEpicError = '';
    this.error = '';
    if (this.isEpicTitleTaken(this.epicTitle)) {
      this.addingEpic = false;
      this.addEpicError = 'An epic with this name already exists in this project';
      return;
    }
    this.projectService
      .addEpic(this.project.id, {
        title: this.epicTitle.trim(),
        workingDays: Number(this.epicWorkingDays),
        startSprintNumber: this.epicStartSprint,
        startSprintWeek: this.epicStartWeek,
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
          this.epicStartWeek = null;
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
    this.editEpicError = '';
    this.editEpicTitle = epic.title;
    this.editEpicWorkingDays = epic.workingDays;
    this.editEpicStartSprint = epic.startSprintNumber;
    this.editEpicStartWeek =
      epic.startSprintWeek ?? (epic.startSprintNumber != null ? 1 : null);
    this.editEpicColor = epic.backgroundColor;
    this.editEpicAssigneeId = epic.assignees[0]?.id ?? '';
    this.showEditEpic = true;
  }

  saveEditEpic() {
    if (!this.project || !this.editingEpic || !this.canSaveEpic()) return;
    this.savingEpic = true;
    this.editEpicError = '';
    this.error = '';

    const isAssignment = !!this.editingEpic.sourceEpicId;
    const titleOwnerId = isAssignment ? this.editingEpic.sourceEpicId : this.editingEpic.id;
    if (this.isEpicTitleTaken(this.editEpicTitle, titleOwnerId)) {
      this.savingEpic = false;
      this.editEpicError = 'An epic with this name already exists in this project';
      return;
    }

    const payload = isAssignment
      ? {
          workingDays: Number(this.editEpicWorkingDays),
          startSprintNumber: this.editEpicStartSprint,
          startSprintWeek: this.editEpicStartWeek,
          assigneeIds: this.editEpicAssigneeId ? [this.editEpicAssigneeId] : [],
        }
      : {
          title: this.editEpicTitle.trim(),
          workingDays: Number(this.editEpicWorkingDays),
          backgroundColor: this.editEpicColor,
        };

    const sharedChanged =
      isAssignment &&
      (this.editEpicTitle.trim() !== this.editingEpic.title ||
        this.editEpicColor !== this.editingEpic.backgroundColor);

    if (sharedChanged) {
      this.projectService
        .updateEpic(this.project.id, this.editingEpic.sourceEpicId!, {
          title: this.editEpicTitle.trim(),
          backgroundColor: this.editEpicColor,
        })
        .subscribe({
          next: () => {
            this.projectService.updateEpic(this.project!.id, this.editingEpic!.id, payload).subscribe({
              next: (project) => this.finishEpicSave(project),
              error: (err) => this.failEpicSave(err),
            });
          },
          error: (err) => this.failEpicSave(err),
        });
      return;
    }

    this.projectService.updateEpic(this.project.id, this.editingEpic.id, payload).subscribe({
      next: (project) => this.finishEpicSave(project),
      error: (err) => this.failEpicSave(err),
    });
  }

  private finishEpicSave(project: ProjectDetail) {
    this.project = this.normalizeProject(project);
    this.savingEpic = false;
    this.showEditEpic = false;
    this.editingEpic = null;
    this.editEpicError = '';
    this.syncEpicAssignees();
  }

  private failEpicSave(err: { error?: { message?: string | string[] } }) {
    this.savingEpic = false;
    const msg = err.error?.message;
    this.editEpicError = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to update epic';
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

  cellDropData(participantId: string, sprintId: string, week: 1 | 2, cellKey: string): CellDropData {
    return { participantId, sprintId, week, cellKey };
  }

  isCellEmpty(participantId: string, cellKey: string) {
    return this.cellsFor(participantId, cellKey).length === 0;
  }

  assignBacklogEpicToCell(templateEpicId: string, cell: CellDropData) {
    if (!this.project || !this.canEditEpics || this.movingEpic) return;

    const template = this.project.epics.find((e) => e.id === templateEpicId && !e.sourceEpicId);
    const targetSprint = this.project.sprints.find((s) => s.id === cell.sprintId);
    if (!template || !targetSprint) return;

    const startSprintNumber = targetSprint.number;
    const startSprintWeek = cell.week;

    if (this.isAssignedToUser(template.id, cell.participantId, startSprintNumber, startSprintWeek)) {
      this.error = 'This epic is already assigned to that user in that sprint week';
      return;
    }

    this.closeCellAssignMenu();
    const alreadyAssigned = this.project.epics.some((epic) => epic.sourceEpicId === template.id);
    if (!alreadyAssigned && this.spansMoreThanTwoSprints(template, cell)) {
      this.assignDaysTarget = { templateEpicId: template.id, cell };
      this.assignDaysTitle = template.title;
      this.assignDaysMax = template.workingDays;
      this.assignDaysValue = template.workingDays;
      this.assignDaysError = '';
      this.showAssignDays = true;
      return;
    }

    this.commitBacklogAssign(template.id, cell);
  }

  cancelAssignDays() {
    this.showAssignDays = false;
    this.assignDaysTarget = null;
    this.assignDaysError = '';
  }

  confirmAssignDays() {
    if (!this.assignDaysTarget) return;
    const days = Number(this.assignDaysValue);
    if (!Number.isInteger(days) || days < 1 || days > this.assignDaysMax) {
      this.assignDaysError = `Enter a whole number from 1 to ${this.assignDaysMax}`;
      return;
    }
    const { templateEpicId, cell } = this.assignDaysTarget;
    this.showAssignDays = false;
    this.assignDaysTarget = null;
    this.commitBacklogAssign(templateEpicId, cell, days);
  }

  private spansMoreThanTwoSprints(epic: ProjectEpic, cell: CellDropData): boolean {
    if (!this.project) return false;
    const startSprint = this.project.sprints.find((sprint) => sprint.id === cell.sprintId);
    if (!startSprint) return false;
    const cap = this.project.maxWorkingDaysPerSprint;
    const absences = [
      ...(this.project.ptos ?? []).filter((pto) => pto.userId === cell.participantId),
      ...(this.project.holidays ?? []),
    ];
    let daysLeft = epic.workingDays;
    const used = new Set<number>();
    for (const sprint of this.project.sprints) {
      if (sprint.number < startSprint.number || daysLeft <= 0) continue;
      const alreadyInSprint = sprint.weeks.reduce(
        (sum, week) => sum + this.epicDaysInCell(cell.participantId, week.cellKey),
        0,
      );
      let capLeft = Math.max(0, cap - alreadyInSprint);
      for (const week of sprint.weeks) {
        if (daysLeft <= 0 || capLeft <= 0) break;
        if (sprint.number === startSprint.number && week.week < cell.week) continue;
        const blocked = absences.reduce(
          (sum, absence) =>
            sum + this.inclusiveDayOverlap(absence.startDate, absence.endDate, week.startDate, week.endDate),
          0,
        );
        const capacity = Math.max(
          0,
          week.workingDays - blocked - this.epicDaysInCell(cell.participantId, week.cellKey),
        );
        if (capacity <= 0) continue;
        const taken = Math.min(daysLeft, capacity, capLeft);
        if (taken > 0) used.add(sprint.number);
        daysLeft -= taken;
        capLeft -= taken;
      }
    }
    return used.size + (daysLeft > 0 ? 1 : 0) > 2;
  }

  private epicDaysInCell(participantId: string, cellKey: string): number {
    return this.cellsFor(participantId, cellKey)
      .filter((chip) => chip.type === 'epic')
      .reduce((sum, chip) => sum + chip.daysInSprint, 0);
  }

  /** Inclusive calendar days shared by two ranges. 1 Nov through 3 Nov is 3 days. */
  private inclusiveDayOverlap(startA: string, endA: string, startB: string, endB: string): number {
    const start = toDateInput(startA) > toDateInput(startB) ? toDateInput(startA) : toDateInput(startB);
    const end = toDateInput(endA) < toDateInput(endB) ? toDateInput(endA) : toDateInput(endB);
    if (!start || !end || start > end) return 0;
    let count = 0;
    let cursor = start;
    while (cursor <= end) {
      count += 1;
      cursor = addUtcDaysToDateInput(cursor, 1);
    }
    return count;
  }

  private commitBacklogAssign(templateEpicId: string, cell: CellDropData, workingDays?: number) {
    if (!this.project || !this.canEditEpics || this.movingEpic) return;
    const targetSprint = this.project.sprints.find((sprint) => sprint.id === cell.sprintId);
    if (!targetSprint) return;

    this.movingEpic = true;
    this.error = '';
    this.projectService
      .assignEpic(
        this.project.id,
        templateEpicId,
        cell.participantId,
        targetSprint.number,
        cell.week,
        workingDays,
      )
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
  }

  onBacklogDrop(event: CdkDragDrop<BacklogDropData>) {
    if (!this.project || !this.canEditEpics || this.movingEpic) return;
    if (event.previousContainer !== event.container) return;
    if (event.previousIndex === event.currentIndex) return;

    const ordered = [...this.backlogEpics];
    const [moved] = ordered.splice(event.previousIndex, 1);
    if (!moved) return;
    ordered.splice(event.currentIndex, 0, moved);

    const count = ordered.length;
    const priorityById = new Map(
      ordered.map((epic, index) => [epic.id, Math.min(99, count - 1 - index)]),
    );
    const previousEpics = this.project.epics;
    this.project = {
      ...this.project,
      epics: this.project.epics.map((epic) => {
        const priority = priorityById.get(epic.id);
        return priority === undefined ? epic : { ...epic, priority };
      }),
    };

    this.movingEpic = true;
    this.error = '';
    this.projectService.reorderEpics(this.project.id, ordered.map((epic) => epic.id)).subscribe({
      next: (project) => {
        this.project = this.normalizeProject(project);
        this.movingEpic = false;
      },
      error: (err) => {
        if (this.project) {
          this.project = { ...this.project, epics: previousEpics };
        }
        this.movingEpic = false;
        const msg = err.error?.message;
        this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to reorder epics';
      },
    });
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

    if ('backlog' in from) {
      this.assignBacklogEpicToCell(epic.id, to);
      return;
    }

    const assigneeIds = [to.participantId];
    const startSprintNumber = targetSprint.number;
    const startSprintWeek = to.week;
    const currentAssignee = epic.assignees[0]?.id;
    if (
      currentAssignee === to.participantId &&
      startSprintNumber === epic.startSprintNumber &&
      startSprintWeek === epic.startSprintWeek
    ) {
      return;
    }

    this.movingEpic = true;
    this.error = '';
    this.projectService
      .updateEpic(this.project.id, epic.id, { startSprintNumber, startSprintWeek, assigneeIds })
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

  cellsFor(participantId: string, cellKey: string) {
    return this.project?.participants.find((p) => p.id === participantId)?.cells?.[cellKey] ?? [];
  }

  planCells(plan: ProjectPlanView, participantId: string, cellKey: string) {
    return plan.participants.find((p) => p.id === participantId)?.cells?.[cellKey] ?? [];
  }

  private syncEpicAssignees() {
    const ids = this.assigneeOptions.map((o) => o.id);
    this.epicAssigneeIds = this.epicAssigneeIds.filter((id) => ids.includes(id));
    const maxSprint = this.project?.sprints[this.project.sprints.length - 1]?.number ?? 1;
    if (this.epicStartSprint != null && (!this.epicAssigneeIds.length || this.epicStartSprint > maxSprint)) {
      this.epicStartSprint = null;
      this.epicStartWeek = null;
    }
    if (this.epicStartSprint == null) {
      this.epicStartWeek = null;
    }
    if (this.editEpicAssigneeId && !ids.includes(this.editEpicAssigneeId)) {
      this.editEpicAssigneeId = '';
    }
    if (this.editEpicStartSprint != null && this.editEpicStartSprint > maxSprint) {
      this.editEpicStartSprint = null;
      this.editEpicStartWeek = null;
    }
    if (this.editEpicStartSprint == null) {
      this.editEpicStartWeek = null;
    }
  }
}
