import { Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { QuarterService } from '../../services/quarter.service';
import { TeamService } from '../../services/team.service';
import { AssignableMember, QuarterDetail, Team } from '../../models';
import { contrastText, formatDateOnly, toDateInput } from '../../utils/date';

const EPIC_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

@Component({
  selector: 'app-quarter-detail',
  standalone: true,
  imports: [FormsModule, RouterLink],
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

  get isCompleted(): boolean {
    return this.quarter?.status === 'completed';
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
    if (!this.quarter) return;
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

  completeQuarter(event?: Event) {
    event?.stopPropagation();
    this.actionsOpen = false;
    if (!this.quarter) return;
    if (!confirm('Mark this quarter as complete? You will not be able to add more epics.')) return;
    this.quarterService.completeQuarter(this.quarter.id).subscribe({
      next: (quarter) => (this.quarter = quarter),
      error: (err) => {
        this.error = err.error?.message || 'Failed to complete quarter';
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
      !!this.epicStartSprint &&
      this.epicStartSprint > 0 &&
      this.epicAssigneeIds.length > 0 &&
      !!this.epicColor
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

  cellsFor(participantId: string, sprintId: string) {
    return this.quarter?.participants.find((p) => p.id === participantId)?.cells?.[sprintId] ?? [];
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
  }
}
