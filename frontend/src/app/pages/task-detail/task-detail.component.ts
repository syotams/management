import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TaskService } from '../../services/task.service';
import { AuthService } from '../../services/auth.service';
import { TaskDetail } from '../../models';
import { toDatetimeLocal } from '../../utils/task-grouping';

@Component({
  selector: 'app-task-detail',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="container py-4">
      <a routerLink="/tasks" class="btn btn-link mb-3">&larr; Back to tasks</a>

      @if (loading) {
        <div class="spinner-border"></div>
      } @else if (task) {
        <div class="card mb-4">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-start">
              <h3>{{ task.title }}</h3>
              <span class="badge" [class]="'priority-' + task.priority">{{ task.priority }}</span>
            </div>
            <p class="text-muted">{{ task.description || 'No description' }}</p>
            <div class="row">
              <div class="col-md-6">
                <p><strong>Status:</strong> {{ task.status }}</p>
                <p><strong>Due:</strong> {{ formatDate(task.dueDate) }}</p>
                <p><strong>Created:</strong> {{ formatDate(task.createdAt) }}</p>
              </div>
              <div class="col-md-6">
                <p><strong>Owner:</strong> {{ task.owner.email }}</p>
                <p><strong>Assignee:</strong> {{ task.assignee.email }}</p>
                @if (isOwner()) {
                  <div class="mb-2">
                    <label class="form-label"><strong>Alert at</strong></label>
                    <div class="input-group input-group-sm">
                      <input type="datetime-local" class="form-control" [(ngModel)]="alertAtLocal">
                      <button class="btn btn-outline-primary" (click)="saveAlert()">Save</button>
                    </div>
                  </div>
                } @else {
                  <p><strong>Alert at:</strong> {{ formatDate(task.alertAt) }}</p>
                }
              </div>
            </div>
          </div>
        </div>

        <!-- Comments -->
        <div class="card mb-4">
          <div class="card-header"><h5 class="mb-0">Comments</h5></div>
          <div class="card-body">
            @for (comment of task.comments; track comment.id) {
              <div class="border-bottom pb-2 mb-2">
                <div class="d-flex justify-content-between">
                  <strong>{{ comment.user.email }}</strong>
                  <small class="text-muted">{{ formatDate(comment.createdAt) }}</small>
                </div>
                <p class="mb-0">{{ comment.body }}</p>
              </div>
            } @empty {
              <p class="text-muted">No comments yet.</p>
            }
            <div class="mt-3">
              <textarea class="form-control mb-2" rows="2" [(ngModel)]="newComment" placeholder="Add a comment..."></textarea>
              <button class="btn btn-primary btn-sm" (click)="addComment()" [disabled]="!newComment.trim()">Post</button>
            </div>
          </div>
        </div>

        <!-- History -->
        <div class="card">
          <div class="card-header"><h5 class="mb-0">History</h5></div>
          <div class="card-body">
            @for (entry of task.history; track entry.id) {
              <div class="border-bottom pb-2 mb-2">
                <small class="text-muted">{{ formatDate(entry.createdAt) }}</small>
                <p class="mb-0">
                  <strong>{{ entry.user.email }}</strong> — {{ formatAction(entry) }}
                </p>
              </div>
            } @empty {
              <p class="text-muted">No history yet.</p>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .priority-high { background: #dc3545; color: #fff; }
    .priority-medium { background: #fd7e14; color: #fff; }
    .priority-low { background: #6c757d; color: #fff; }
  `],
})
export class TaskDetailComponent implements OnInit {
  task: TaskDetail | null = null;
  loading = true;
  newComment = '';
  alertAtLocal = '';

  constructor(
    private route: ActivatedRoute,
    private taskService: TaskService,
    public auth: AuthService,
  ) {}

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.taskService.getTask(id).subscribe({
      next: (task) => {
        this.task = task;
        this.alertAtLocal = toDatetimeLocal(new Date(task.alertAt));
        this.loading = false;
      },
    });
  }

  isOwner(): boolean {
    return this.task?.ownerId === this.auth.currentUser()?.id;
  }

  addComment() {
    if (!this.task || !this.newComment.trim()) return;
    this.taskService.addComment(this.task.id, this.newComment.trim()).subscribe({
      next: () => {
        this.newComment = '';
        this.reload();
      },
    });
  }

  saveAlert() {
    if (!this.task) return;
    this.taskService.updateTask(this.task.id, {
      alertAt: new Date(this.alertAtLocal).toISOString(),
    }).subscribe(() => this.reload());
  }

  reload() {
    if (!this.task) return;
    this.taskService.getTask(this.task.id).subscribe((t) => {
      this.task = t;
      this.alertAtLocal = toDatetimeLocal(new Date(t.alertAt));
    });
  }

  formatDate(d: string): string {
    return new Date(d).toLocaleString();
  }

  formatAction(entry: { action: string; fieldName: string | null; oldValue: string | null; newValue: string | null }): string {
    switch (entry.action) {
      case 'CREATED': return 'created the task';
      case 'COMPLETED': return 'marked as completed';
      case 'ARCHIVED': return 'archived the task';
      case 'STATUS_CHANGED': return `changed status from ${entry.oldValue} to ${entry.newValue}`;
      case 'DUE_DATE_CHANGED': return `changed due date from ${this.formatDate(entry.oldValue!)} to ${this.formatDate(entry.newValue!)}`;
      case 'PRIORITY_CHANGED': return `changed priority from ${entry.oldValue} to ${entry.newValue}`;
      case 'ASSIGNEE_CHANGED': return 'changed assignee';
      case 'OWNER_CHANGED': return 'changed owner';
      case 'ALERT_CHANGED': return `changed alert from ${this.formatDate(entry.oldValue!)} to ${this.formatDate(entry.newValue!)}`;
      case 'COMMENT_ADDED': return `added comment: "${entry.newValue}"`;
      default: return entry.action;
    }
  }
}
