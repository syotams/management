import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { QuarterService } from '../../services/quarter.service';
import { TeamService } from '../../services/team.service';
import { QuarterSummary, Team } from '../../models';
import { formatDateOnly, localDateInput } from '../../utils/date';

@Component({
  selector: 'app-quarters',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="py-2">
      <h2 class="page-title mb-4">Quarters</h2>

      @if (error) {
        <div class="alert alert-danger">{{ error }}</div>
      }

      <div class="card mb-4">
        <div class="card-header"><i class="bi bi-calendar-plus me-2"></i>New Quarter</div>
        <div class="card-body">
          <form (ngSubmit)="createQuarter()">
            <div class="row g-3 align-items-end">
              <div class="col-md-4">
                <label class="form-label">Name</label>
                <input
                  type="text"
                  class="form-control"
                  name="name"
                  [(ngModel)]="name"
                  placeholder="Q3 2026"
                  required
                >
              </div>
              <div class="col-md-3">
                <label class="form-label">Start date</label>
                <input type="date" class="form-control" name="startDate" [(ngModel)]="startDate" required>
              </div>
              <div class="col-md-3">
                <label class="form-label">End date</label>
                <input type="date" class="form-control" name="endDate" [(ngModel)]="endDate" required>
              </div>
              <div class="col-md-2">
                <label class="form-label">Team <span class="text-muted fw-normal">(optional)</span></label>
                <select class="form-select" name="teamId" [(ngModel)]="teamId">
                  <option value="">No team</option>
                  @for (team of teams; track team.id) {
                    <option [value]="team.id">{{ team.name }}</option>
                  }
                </select>
              </div>
            </div>
            <div class="mt-3">
              <button type="submit" class="btn btn-primary" [disabled]="saving || !canCreate()">
                {{ saving ? 'Creating...' : 'Create quarter' }}
              </button>
            </div>
          </form>
        </div>
      </div>

      @if (loading) {
        <div class="text-center py-5"><div class="spinner-border text-primary"></div></div>
      } @else {
        @for (quarter of quarters; track quarter.id) {
          <a class="card quarter-card mb-3" [routerLink]="['/quarters', quarter.id]">
            <div class="card-body d-flex justify-content-between align-items-center gap-3">
              <div>
                <h5 class="mb-1">{{ quarter.name || formatRange(quarter.startDate, quarter.endDate) }}</h5>
                <div class="text-muted">
                  {{ formatRange(quarter.startDate, quarter.endDate) }}
                  · {{ quarter.team?.name || 'No team' }}
                  · {{ quarter._count.sprints }} sprints
                  · {{ quarter._count.epics }} epics
                </div>
              </div>
              <span
                class="badge status-badge"
                [class.status-todo]="quarter.status === 'draft'"
                [class.status-in_progress]="quarter.status === 'in_progress'"
                [class.status-completed]="quarter.status === 'completed'"
              >
                {{
                  quarter.status === 'draft'
                    ? 'Draft'
                    : quarter.status === 'in_progress'
                      ? 'In progress'
                      : 'Completed'
                }}
              </span>
            </div>
          </a>
        } @empty {
          <p class="text-muted">No quarters yet. Create one above to start planning.</p>
        }
      }
    </div>
  `,
  styles: `
    .quarter-card {
      display: block;
      color: inherit;
      text-decoration: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .quarter-card:hover {
      border-color: var(--app-primary);
      text-decoration: none;
      color: inherit;
    }
  `,
})
export class QuartersComponent implements OnInit {
  quarters: QuarterSummary[] = [];
  teams: Team[] = [];
  name = '';
  startDate = localDateInput();
  endDate = localDateInput(new Date(Date.now() + 91 * 24 * 60 * 60 * 1000));
  teamId = '';
  loading = true;
  saving = false;
  error = '';

  constructor(
    private quarterService: QuarterService,
    private teamService: TeamService,
    private router: Router,
  ) {}

  ngOnInit() {
    this.teamService.getTeams().subscribe((teams) => (this.teams = teams));
    this.loadQuarters();
  }

  loadQuarters() {
    this.loading = true;
    this.quarterService.getQuarters().subscribe({
      next: (quarters) => {
        this.quarters = quarters;
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load quarters';
        this.loading = false;
      },
    });
  }

  canCreate() {
    return !!this.name.trim() && !!this.startDate && !!this.endDate && this.endDate >= this.startDate;
  }

  createQuarter() {
    if (!this.canCreate()) return;
    this.saving = true;
    this.error = '';
    this.quarterService
      .createQuarter({
        name: this.name.trim(),
        startDate: this.startDate,
        endDate: this.endDate,
        teamId: this.teamId || undefined,
      })
      .subscribe({
        next: (quarter) => {
          this.saving = false;
          this.router.navigate(['/quarters', quarter.id]);
        },
        error: (err) => {
          this.saving = false;
          const msg = err.error?.message;
          this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to create quarter';
        },
      });
  }

  formatRange(start: string, end: string) {
    return `${formatDateOnly(start)} – ${formatDateOnly(end)}`;
  }
}
