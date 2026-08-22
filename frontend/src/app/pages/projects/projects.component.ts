import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ProjectService } from '../../services/project.service';
import { TeamService } from '../../services/team.service';
import { AssignableMember, ProjectSummary, Team } from '../../models';
import { formatDateOnly, localDateInput, projectEndDateFromStart } from '../../utils/date';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="py-2">
      <h2 class="page-title mb-4">Projects</h2>

      @if (error) {
        <div class="alert alert-danger">{{ error }}</div>
      }

      <div class="card mb-4">
        <div class="card-header"><i class="bi bi-calendar-plus me-2"></i>New Project</div>
        <div class="card-body">
          <form (ngSubmit)="createProject()">
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
                <input type="date" class="form-control" name="startDate" [(ngModel)]="startDate" (ngModelChange)="onStartDateChange()" required>
              </div>
              <div class="col-md-3">
                <label class="form-label">End date</label>
                <input type="date" class="form-control" name="endDate" [(ngModel)]="endDate" required>
              </div>
            </div>

            <div class="row g-3 mt-1">
              <div class="col-md-6">
                <label class="form-label">Teams</label>
                <div class="picker-list">
                  @for (team of teams; track team.id) {
                    <label class="form-check">
                      <input
                        class="form-check-input"
                        type="checkbox"
                        [checked]="isTeamSelected(team.id)"
                        (change)="toggleTeam(team.id)"
                      >
                      <span class="form-check-label">{{ team.name }}</span>
                    </label>
                  } @empty {
                    <div class="text-muted small">No teams available</div>
                  }
                </div>
              </div>
              <div class="col-md-6">
                <label class="form-label">Individual users</label>
                <div class="picker-list">
                  @for (person of members; track person.id) {
                    <label class="form-check">
                      <input
                        class="form-check-input"
                        type="checkbox"
                        [checked]="isUserSelected(person.id)"
                        (change)="toggleUser(person.id)"
                      >
                      <span class="form-check-label">{{ person.name }} <span class="text-muted">({{ person.teamName }})</span></span>
                    </label>
                  } @empty {
                    <div class="text-muted small">No teammates available</div>
                  }
                </div>
              </div>
            </div>

            <div class="mt-3">
              <button type="submit" class="btn btn-primary" [disabled]="saving || !canCreate()">
                {{ saving ? 'Creating...' : 'Create project' }}
              </button>
            </div>
          </form>
        </div>
      </div>

      @if (loading) {
        <div class="text-center py-5"><div class="spinner-border text-primary"></div></div>
      } @else {
        @for (project of projects; track project.id) {
          <a class="card project-card mb-3" [routerLink]="['/projects', project.id]">
            <div class="card-body d-flex justify-content-between align-items-center gap-3">
              <div>
                <h5 class="mb-1">{{ project.name || formatRange(project.startDate, project.endDate) }}</h5>
                <div class="text-muted">
                  {{ formatRange(project.startDate, project.endDate) }}
                  · {{ project.team?.name || 'No team' }}
                  · {{ project._count.sprints }} sprints
                  · {{ project._count.epics }} epics
                </div>
              </div>
              <span
                class="badge status-badge"
                [class.status-todo]="project.status === 'draft'"
                [class.status-in_progress]="project.status === 'in_progress'"
                [class.status-completed]="project.status === 'completed'"
              >
                {{
                  project.status === 'draft'
                    ? 'Draft'
                    : project.status === 'in_progress'
                      ? 'In progress'
                      : 'Completed'
                }}
              </span>
            </div>
          </a>
        } @empty {
          <p class="text-muted">No projects yet. Create one above to start planning.</p>
        }
      }
    </div>
  `,
  styles: `
    .project-card {
      display: block;
      color: inherit;
      text-decoration: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .project-card:hover {
      border-color: var(--app-primary);
      text-decoration: none;
      color: inherit;
    }
    .picker-list {
      max-height: 10rem;
      overflow: auto;
      border: 1px solid var(--app-border-subtle);
      border-radius: 8px;
      padding: 0.5rem 0.75rem;
      background: var(--app-input-bg);
    }
    .picker-list .form-check {
      margin-bottom: 0.25rem;
    }
  `,
})
export class ProjectsComponent implements OnInit {
  projects: ProjectSummary[] = [];
  teams: Team[] = [];
  members: AssignableMember[] = [];
  name = '';
  startDate = localDateInput();
  endDate = projectEndDateFromStart(localDateInput());
  selectedTeamIds: string[] = [];
  selectedUserIds: string[] = [];
  loading = true;
  saving = false;
  error = '';

  constructor(
    private projectService: ProjectService,
    private teamService: TeamService,
    private router: Router,
  ) {}

  ngOnInit() {
    this.teamService.getTeams().subscribe((teams) => (this.teams = teams));
    this.teamService.getAssignableMembers().subscribe((members) => (this.members = members));
    this.loadProjects();
  }

  loadProjects() {
    this.loading = true;
    this.projectService.getProjects().subscribe({
      next: (projects) => {
        this.projects = projects;
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load projects';
        this.loading = false;
      },
    });
  }

  isTeamSelected(id: string) {
    return this.selectedTeamIds.includes(id);
  }

  toggleTeam(id: string) {
    if (this.selectedTeamIds.includes(id)) {
      this.selectedTeamIds = this.selectedTeamIds.filter((value) => value !== id);
    } else {
      this.selectedTeamIds = [...this.selectedTeamIds, id];
    }
  }

  isUserSelected(id: string) {
    return this.selectedUserIds.includes(id);
  }

  toggleUser(id: string) {
    if (this.selectedUserIds.includes(id)) {
      this.selectedUserIds = this.selectedUserIds.filter((value) => value !== id);
    } else {
      this.selectedUserIds = [...this.selectedUserIds, id];
    }
  }

  onStartDateChange() {
    if (this.startDate) {
      this.endDate = projectEndDateFromStart(this.startDate);
    }
  }

  canCreate() {
    return !!this.name.trim() && !!this.startDate && !!this.endDate && this.endDate >= this.startDate;
  }

  createProject() {
    if (!this.canCreate()) return;
    this.saving = true;
    this.error = '';
    this.projectService
      .createProject({
        name: this.name.trim(),
        startDate: this.startDate,
        endDate: this.endDate,
        teamIds: this.selectedTeamIds.length ? this.selectedTeamIds : undefined,
        userIds: this.selectedUserIds.length ? this.selectedUserIds : undefined,
      })
      .subscribe({
        next: (project) => {
          this.saving = false;
          this.router.navigate(['/projects', project.id]);
        },
        error: (err) => {
          this.saving = false;
          const msg = err.error?.message;
          this.error = Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to create project';
        },
      });
  }

  formatRange(start: string, end: string) {
    return `${formatDateOnly(start)} – ${formatDateOnly(end)}`;
  }
}
