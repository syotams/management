import { NgTemplateOutlet } from '@angular/common';
import { Component, HostListener, OnInit } from '@angular/core';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDropList,
  CdkDropListGroup,
} from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { QuarterService } from '../../services/quarter.service';
import { TeamService } from '../../services/team.service';
import {
  AssignableMember,
  EpicChip,
  QuarterComparison,
  QuarterDetail,
  QuarterEpic,
  QuarterPlanView,
  Team,
} from '../../models';
import { contrastText, formatDateOnly, toDateInput } from '../../utils/date';

const EPIC_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

type CellDropData = { participantId: string; sprintId: string };

@Component({
  selector: 'app-quarter-detail',
  standalone: true,
  imports: [FormsModule, RouterLink, NgTemplateOutlet, CdkDropListGroup, CdkDropList, CdkDrag],
  templateUrl: './quarter-detail.component.html',
  styleUrl: './quarter-detail.component.scss',
})
export class QuarterDetailComponent implements OnInit {
  quarter: QuarterDetail | null = null;
  teams: Team[] = [];
  members: AssignableMember[] = [];
  loading = true;
  error = '';
  actionsOpen = false;
  showEdit = false;
  saving = false;

  epicTitle = '';
  epicWorkingDays: number | null = 5;
  epicStartSprint = 1;
  epicColor = EPIC_COLORS[0];
  epicAssigneeIds: string[] = [];
  addingEpic = false;
  colors = EPIC_COLORS;

  showEditEpic = false;
  editingEpic: QuarterEpic | null = null;
  editEpicTitle = '';
  editEpicWorkingDays: number | null = 5;
  editEpicStartSprint = 1;
  editEpicColor = EPIC_COLORS[0];
  editEpicAssigneeIds: string[] = [];
  savingEpic = false;
  movingEpic = false;

  showCompare = false;
  comparison: QuarterComparison | null = null;
  loadingCompare = false;

  editName = '';
  editStartDate = '';
  editEndDate = '';
  editTeamId = '';

  contrastText = contrastText;

  constructor(
    private route: ActivatedRoute,
    private quarterService: QuarterService,
    private teamService: TeamService,
    public auth: AuthService,
  ) {}

  @HostListener('document:click')
  onDocumentClick() {
    this.actionsOpen = false;
  }

  ngOnInit() {
    this.teamService.getTeams().subscribe((teams) => (this.teams = teams));
    this.teamService.getAssignableMembers().subscribe((members) => (this.members = members));
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) this.load(id);
    });
  }

  get isManager(): boolean {
    return this.quarter?.createdBy === this.auth.currentUser()?.id;
  }

  get isDraft(): boolean {
    return this.quarter?.status === 'draft';
  }

  get isInProgress(): boolean {
    return this.quarter?.status === 'in_progress';
  }

  get isCompleted(): boolean {
    return this.quarter?.status === 'completed';
  }

  get canEditEpics(): boolean {
    return this.isManager && !this.isCompleted;
  }

  get canCompare(): boolean {
    return !!this.quarter && this.quarter.status !== 'draft' && this.quarter.versionCount > 0;
  }

  get statusLabel(): string {
    if (!this.quarter) return '';
    if (this.quarter.status === 'draft') return 'Draft';
    if (this.quarter.status === 'in_progress') return 'In progress';
    return 'Completed';
  }

  get assigneeOptions(): { id: string; name: string }[] {
    if (!this.quarter) return [];
    if (this.quarter.teamId) {
      return this.quarter.participants.map((p) => ({ id: p.id, name: p.name }));
    }
    const me = this.auth.currentUser();
    const options = new Map<string, string>();
    if (me) options.set(me.id, me.name);
    for (const m of this.members) options.set(m.id, m.name);
    return Array.from(options, ([id, name]) => ({ id, name }));
  }

  load(id: string) {
    this.loading = true;
    this.error = '';
    this.quarterService.getQuarter(id).subscribe({
      next: (quarter) => {
        this.quarter = quarter;
        this.loading = false;
        this.syncEpicAssignees();
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load quarter';
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

  toggleActions(event: Event) {
    event.stopPropagation();
    this.actionsOpen = !this.actionsOpen;
  }

  openEdit(event?: Event) {
    event?.stopPropagation();
    this.actionsOpen = false;
    if (!this.quarter || this.isCompleted) return;
    this.editName = this.quarter.name;
    this.editStartDate = toDateInput(this.quarter.startDate);
    this.editEndDate = toDateInput(this.quarter.endDate);
    this.editTeamId = this.quarter.teamId || '';
    this.showEdit = true;
  }

  saveEdit() {
    if (!this.quarter || !this.editName.trim()) return;
    this.saving = true;
    this.error = '';
    this.quarterService
      .updateQuarter(this.quarter.id, {
        name: this.editName.trim(),
        startDate: this.editStartDate,
        endDate: this.editEndDate,
        teamId: this.editTeamId || null,
      })
      .subscribe({
        next: (quarter) => {
          this.quarter = quarter;
          this.saving = false;
          this.showEdit = false;
          this.syncEpicAssignees();
        },
        error: (err) => {
          this.saving = false;
          const msg = err.error?.message;
          this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to update quarter';
        },
      });
  }

  startQuarter(event?: Event) {
    event?.stopPropagation();
    this.actionsOpen = false;
    if (!this.quarter) return;
    if (!this.quarter.epics.length) {
      this.error = 'Add at least one epic before starting the quarter';
      return;
    }
    if (
      !confirm(
        'Start this quarter? The current plan will be saved as the original version. Later changes will create new versions.',
      )
    ) {
      return;
    }
    this.quarterService.startQuarter(this.quarter.id).subscribe({
      next: (quarter) => (this.quarter = quarter),
      error: (err) => {
        const msg = err.error?.message;
        this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to start quarter';
      },
    });
  }

  completeQuarter(event?: Event) {
    event?.stopPropagation();
    this.actionsOpen = false;
    if (!this.quarter) return;
    if (
      !confirm(
        'Mark this quarter as complete? You will not be able to edit it further, and you will see the original plan vs the final version.',
      )
    ) {
      return;
    }
    this.quarterService.completeQuarter(this.quarter.id).subscribe({
      next: (quarter) => (this.quarter = quarter),
      error: (err) => {
        const msg = err.error?.message;
        this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to complete quarter';
      },
    });
  }

  openCompare(event?: Event) {
    event?.stopPropagation();
    this.actionsOpen = false;
    if (!this.quarter || !this.canCompare) return;

    if (this.quarter.comparison) {
      this.comparison = this.quarter.comparison;
      this.showCompare = true;
      return;
    }

    this.loadingCompare = true;
    this.error = '';
    this.quarterService.compareQuarter(this.quarter.id).subscribe({
      next: (comparison) => {
        this.comparison = comparison;
        this.loadingCompare = false;
        this.showCompare = true;
      },
      error: (err) => {
        this.loadingCompare = false;
        const msg = err.error?.message;
        this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to load comparison';
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

  isEditAssigneeSelected(id: string) {
    return this.editEpicAssigneeIds.includes(id);
  }

  toggleEditAssignee(id: string) {
    if (this.editEpicAssigneeIds.includes(id)) {
      this.editEpicAssigneeIds = this.editEpicAssigneeIds.filter((value) => value !== id);
    } else {
      this.editEpicAssigneeIds = [...this.editEpicAssigneeIds, id];
    }
  }

  canAddEpic() {
    return (
      !!this.epicTitle.trim() &&
      !!this.epicWorkingDays &&
      this.epicWorkingDays > 0 &&
      !!this.epicStartSprint &&
      this.epicStartSprint > 0 &&
      this.epicAssigneeIds.length > 0 &&
      !!this.epicColor
    );
  }

  canSaveEpic() {
    return (
      !!this.editEpicTitle.trim() &&
      !!this.editEpicWorkingDays &&
      this.editEpicWorkingDays > 0 &&
      !!this.editEpicStartSprint &&
      this.editEpicStartSprint > 0 &&
      this.editEpicAssigneeIds.length > 0 &&
      !!this.editEpicColor
    );
  }

  addEpic() {
    if (!this.quarter || !this.canAddEpic()) return;
    this.addingEpic = true;
    this.error = '';
    this.quarterService
      .addEpic(this.quarter.id, {
        title: this.epicTitle.trim(),
        workingDays: Number(this.epicWorkingDays),
        startSprintNumber: Number(this.epicStartSprint),
        assigneeIds: this.epicAssigneeIds,
        backgroundColor: this.epicColor,
      })
      .subscribe({
        next: (quarter) => {
          this.quarter = quarter;
          this.addingEpic = false;
          this.epicTitle = '';
          this.epicWorkingDays = 5;
          this.epicStartSprint = 1;
          this.epicColor = this.colors[(this.quarter.epics.length) % this.colors.length];
          this.syncEpicAssignees();
        },
        error: (err) => {
          this.addingEpic = false;
          const msg = err.error?.message;
          this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to add epic';
        },
      });
  }

  openEditEpic(epicId: string, event?: Event) {
    event?.stopPropagation();
    if (!this.quarter || !this.canEditEpics) return;
    const epic = this.quarter.epics.find((e) => e.id === epicId);
    if (!epic) return;
    this.editingEpic = epic;
    this.editEpicTitle = epic.title;
    this.editEpicWorkingDays = epic.workingDays;
    this.editEpicStartSprint = epic.startSprintNumber;
    this.editEpicColor = epic.backgroundColor;
    this.editEpicAssigneeIds = epic.assignees.map((a) => a.id);
    this.showEditEpic = true;
  }

  saveEditEpic() {
    if (!this.quarter || !this.editingEpic || !this.canSaveEpic()) return;
    this.savingEpic = true;
    this.error = '';
    this.quarterService
      .updateEpic(this.quarter.id, this.editingEpic.id, {
        title: this.editEpicTitle.trim(),
        workingDays: Number(this.editEpicWorkingDays),
        startSprintNumber: Number(this.editEpicStartSprint),
        assigneeIds: this.editEpicAssigneeIds,
        backgroundColor: this.editEpicColor,
      })
      .subscribe({
        next: (quarter) => {
          this.quarter = quarter;
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
    if (!this.quarter || !this.canEditEpics) return;
    if (!confirm('Delete this epic?')) return;
    this.error = '';
    this.quarterService.deleteEpic(this.quarter.id, epicId).subscribe({
      next: (quarter) => {
        this.quarter = quarter;
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

  onEpicDrop(event: CdkDragDrop<CellDropData>) {
    if (!this.quarter || !this.canEditEpics || this.movingEpic) return;
    if (event.previousContainer === event.container) return;

    const from = event.previousContainer.data;
    const to = event.container.data;
    const chip = event.item.data as EpicChip;
    if (!chip?.epicId) return;

    const epic = this.quarter.epics.find((e) => e.id === chip.epicId);
    const targetSprint = this.quarter.sprints.find((s) => s.id === to.sprintId);
    if (!epic || !targetSprint) return;

    let assigneeIds = epic.assignees.map((a) => a.id);
    if (from.participantId !== to.participantId) {
      assigneeIds = assigneeIds.filter((id) => id !== from.participantId);
      if (!assigneeIds.includes(to.participantId)) {
        assigneeIds.push(to.participantId);
      }
      if (!assigneeIds.length) assigneeIds = [to.participantId];
    }

    const startSprintNumber = targetSprint.number;
    const sameAssignees =
      assigneeIds.length === epic.assignees.length &&
      assigneeIds.every((id) => epic.assignees.some((a) => a.id === id));
    if (sameAssignees && startSprintNumber === epic.startSprintNumber) return;

    this.movingEpic = true;
    this.error = '';
    this.quarterService
      .updateEpic(this.quarter.id, epic.id, { startSprintNumber, assigneeIds })
      .subscribe({
        next: (quarter) => {
          this.quarter = quarter;
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
    return this.quarter?.participants.find((p) => p.id === participantId)?.cells?.[sprintId] ?? [];
  }

  planCells(plan: QuarterPlanView, participantId: string, sprintId: string) {
    return plan.participants.find((p) => p.id === participantId)?.cells?.[sprintId] ?? [];
  }

  private syncEpicAssignees() {
    const ids = this.assigneeOptions.map((o) => o.id);
    this.epicAssigneeIds = this.epicAssigneeIds.filter((id) => ids.includes(id));
    if (!this.epicAssigneeIds.length && ids.length === 1) {
      this.epicAssigneeIds = [ids[0]];
    }
    const maxSprint = this.quarter?.sprints[this.quarter.sprints.length - 1]?.number ?? 1;
    if (!this.epicStartSprint || this.epicStartSprint > maxSprint) {
      this.epicStartSprint = 1;
    }
    this.editEpicAssigneeIds = this.editEpicAssigneeIds.filter((id) => ids.includes(id));
    if (this.editEpicStartSprint > maxSprint) {
      this.editEpicStartSprint = 1;
    }
  }
}
