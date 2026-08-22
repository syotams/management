import { NgTemplateOutlet } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { QuarterService } from '../../services/quarter.service';
import { QuarterComparison, QuarterDetail, QuarterPlanView } from '../../models';
import { contrastText, formatDateOnly } from '../../utils/date';

@Component({
  selector: 'app-quarter-compare',
  standalone: true,
  imports: [RouterLink, NgTemplateOutlet],
  templateUrl: './quarter-compare.component.html',
  styleUrl: './quarter-compare.component.scss',
})
export class QuarterCompareComponent implements OnInit {
  quarter: QuarterDetail | null = null;
  comparison: QuarterComparison | null = null;
  loading = true;
  error = '';
  contrastText = contrastText;

  constructor(
    private route: ActivatedRoute,
    private quarterService: QuarterService,
  ) {}

  ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) this.load(id);
    });
  }

  get isCompleted(): boolean {
    return this.quarter?.status === 'completed';
  }

  load(id: string) {
    this.loading = true;
    this.error = '';
    this.quarterService.getQuarter(id).subscribe({
      next: (quarter) => {
        this.quarter = quarter;
        if (quarter.status === 'draft') {
          this.error = 'Start the quarter before comparing plan versions';
          this.loading = false;
          return;
        }
        this.quarterService.compareQuarter(id).subscribe({
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

  planCells(plan: QuarterPlanView, participantId: string, sprintId: string) {
    return plan.participants.find((p) => p.id === participantId)?.cells?.[sprintId] ?? [];
  }

  diffLabel(value: number) {
    if (value > 0) return `+${value}`;
    return String(value);
  }
}
