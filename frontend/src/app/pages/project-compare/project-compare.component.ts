import { NgTemplateOutlet } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ProjectService } from '../../services/project.service';
import { ProjectComparison, ProjectDetail, ProjectPlanView } from '../../models';
import { contrastText, formatDateOnly } from '../../utils/date';
import { truncateEpicTitle } from '../../utils/text';

@Component({
  selector: 'app-project-compare',
  standalone: true,
  imports: [RouterLink, NgTemplateOutlet],
  templateUrl: './project-compare.component.html',
  styleUrl: './project-compare.component.scss',
})
export class ProjectCompareComponent implements OnInit {
  project: ProjectDetail | null = null;
  comparison: ProjectComparison | null = null;
  loading = true;
  error = '';
  contrastText = contrastText;
  truncateEpicTitle = truncateEpicTitle;

  constructor(
    private route: ActivatedRoute,
    private projectService: ProjectService,
  ) {}

  ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) this.load(id);
    });
  }

  get isCompleted(): boolean {
    return this.project?.status === 'completed';
  }

  load(id: string) {
    this.loading = true;
    this.error = '';
    this.projectService.getProject(id).subscribe({
      next: (project) => {
        this.project = project;
        if (project.status === 'draft') {
          this.error = 'Start the project before comparing plan versions';
          this.loading = false;
          return;
        }
        this.projectService.compareProject(id).subscribe({
          next: (comparison) => {
            this.comparison = comparison;
            this.loading = false;
          },
          error: (err) => {
            this.error = err.error?.message || 'Failed to load comparison';
            this.loading = false;
          },
        });
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

  planCells(plan: ProjectPlanView, participantId: string, cellKey: string) {
    return plan.participants.find((p) => p.id === participantId)?.cells?.[cellKey] ?? [];
  }

  weekColumnCount(plan: ProjectPlanView): number {
    return plan.sprints.reduce((sum, sprint) => sum + (sprint.weeks?.length ?? 2), 0);
  }

  sprintLabel(epic: { startSprintNumber: number | null; startSprintWeek?: number | null }) {
    if (!epic.startSprintNumber) return 'Unscheduled';
    const week = epic.startSprintWeek ?? 1;
    return `Sprint ${epic.startSprintNumber} · Week ${week}`;
  }

  diffLabel(value: number) {
    if (value > 0) return `+${value}`;
    return String(value);
  }
}
