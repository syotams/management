import { NgClass } from '@angular/common';
import { Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { TaskService } from '../../services/task.service';
import { AuthService } from '../../services/auth.service';
import { TeamService } from '../../services/team.service';
import { TaskNavigation, TaskNavigationService } from '../../services/task-navigation.service';
import { AssignableMember, Priority, Task, TaskDetail } from '../../models';
import {
  toDatetimeLocal,
  displayName,
  PRIORITIES,
  statusLabel,
  statusClass,
  groupTasks,
  flattenGroupedTasks,
} from '../../utils/task-grouping';
import { datetimeLocalToUtcIso, formatUserDateTime } from '../../utils/date';

@Component({
  selector: 'app-task-detail',
  standalone: true,
  imports: [FormsModule, RouterLink, NgClass],
  templateUrl: './task-detail.component.html',
  styleUrl: './task-detail.component.scss',
})
export class TaskDetailComponent implements OnInit {
  task: TaskDetail | null = null;
  loading = true;
  loadingDetails = false;
  navigation: TaskNavigation | null = null;
  openStatusDropdown = false;
  newComment = '';
  displayName = displayName;
  statusLabel = statusLabel;
  statusClass = statusClass;
  priorities = PRIORITIES;
  members: AssignableMember[] = [];
  editTask: TaskDetail | null = null;
  editForm = {
    title: '',
    description: '',
    priority: 'medium' as Priority,
    dueDate: '',
    alertAt: '',
    assigneeId: '',
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private taskService: TaskService,
    private teamService: TeamService,
    private taskNav: TaskNavigationService,
    public auth: AuthService,
  ) {}

  @HostListener('document:click')
  onDocumentClick() {
    this.openStatusDropdown = false;
  }

  ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id')!;
      this.loadTask(id);
    });
    this.teamService.getAssignableMembers().subscribe((m) => (this.members = m));
  }

  loadTask(id: string) {
    this.openStatusDropdown = false;
    this.newComment = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const cached = this.taskNav.getCachedTask(id);
    if (cached) {
      this.task = { ...cached, comments: [], history: [] };
      this.loading = false;
      this.loadingDetails = true;
      this.loadCommentsAndHistory(id);
    } else {
      this.loading = true;
      this.task = null;
      this.taskService.getTask(id).subscribe({
        next: (task) => {
          this.task = task;
          this.loading = false;
          this.loadingDetails = false;
        },
      });
    }

    this.updateNavigation(id);
    if (!this.taskNav.getNavigation(id)) {
      this.ensureTaskListForNavigation(id);
    }
  }

  private loadCommentsAndHistory(id: string) {
    forkJoin({
      comments: this.taskService.getComments(id),
      history: this.taskService.getHistory(id),
    }).subscribe({
      next: ({ comments, history }) => {
        if (this.task?.id === id) {
          this.task = { ...this.task, comments, history };
          this.loadingDetails = false;
        }
      },
      error: () => {
        if (this.task?.id === id) {
          this.loadingDetails = false;
        }
      },
    });
  }

  private updateNavigation(id: string) {
    this.navigation = this.taskNav.getNavigation(id);
  }

  private ensureTaskListForNavigation(currentId: string) {
    const opts = this.taskNav.getListOptions();
    this.taskService
      .getTasks(opts.showClosed ? { includeClosed: true, closedDays: opts.closedDays } : undefined)
      .subscribe((tasks) => {
        const grouped = groupTasks(tasks);
        const flat = flattenGroupedTasks(grouped, opts.showClosed);
        this.taskNav.setTaskList(flat, opts);
        this.updateNavigation(currentId);
      });
  }

  navigateTo(id: string | null) {
    if (!id) return;
    this.router.navigate(['/tasks', id]);
  }

  hasStatusActions(task: Task): boolean {
    return task.status !== 'archived';
  }

  toggleStatusDropdown(event: Event) {
    event.stopPropagation();
    this.openStatusDropdown = !this.openStatusDropdown;
  }

  start(event: Event) {
    event.stopPropagation();
    this.openStatusDropdown = false;
    if (!this.task) return;
    this.taskService.start(this.task.id).subscribe((updated) => this.onStatusChanged(updated));
  }

  complete(event: Event) {
    event.stopPropagation();
    this.openStatusDropdown = false;
    if (!this.task) return;
    const nextId = this.navigation?.nextId ?? this.navigation?.prevId ?? null;
    const completedId = this.task.id;
    this.taskService.complete(completedId).subscribe(() => {
      this.taskNav.removeTask(completedId);
      if (nextId) {
        this.navigateTo(nextId);
      } else {
        this.router.navigate(['/tasks']);
      }
    });
  }

  archive(event: Event) {
    event.stopPropagation();
    this.openStatusDropdown = false;
    if (!this.task) return;
    this.taskService.archive(this.task.id).subscribe((updated) => this.onStatusChanged(updated));
  }

  private onStatusChanged(updated: Task) {
    this.taskNav.updateCachedTask(updated);
    if (this.task) {
      this.task = { ...this.task, ...updated };
    }
    this.reloadHistory();
  }

  private reloadHistory() {
    if (!this.task) return;
    this.taskService.getHistory(this.task.id).subscribe((history) => {
      if (this.task) {
        this.task = { ...this.task, history };
      }
    });
  }

  isOwner(): boolean {
    return this.task?.ownerId === this.auth.currentUser()?.id;
  }

  canDeleteComment(commentUserId: string): boolean {
    return commentUserId === this.auth.currentUser()?.id;
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

  deleteComment(commentId: string) {
    if (!this.task || !confirm('Delete this comment?')) return;
    this.taskService.deleteComment(this.task.id, commentId).subscribe(() => this.reload());
  }

  openEditModal() {
    if (!this.task) return;
    this.editTask = this.task;
    this.editForm = {
      title: this.task.title,
      description: this.task.description || '',
      priority: this.task.priority,
      dueDate: toDatetimeLocal(new Date(this.task.dueDate)),
      alertAt: toDatetimeLocal(new Date(this.task.alertAt)),
      assigneeId: this.task.assigneeId,
    };
  }

  saveEditModal() {
    if (!this.editTask) return;
    const data: Record<string, string> = {
      title: this.editForm.title.trim(),
      description: this.editForm.description,
      priority: this.editForm.priority,
    };
    if (this.isOwner()) {
      data['assigneeId'] = this.editForm.assigneeId;
      data['dueDate'] = datetimeLocalToUtcIso(this.editForm.dueDate);
      data['alertAt'] = datetimeLocalToUtcIso(this.editForm.alertAt);
    }
    this.taskService.updateTask(this.editTask.id, data).subscribe((updated) => {
      this.editTask = null;
      this.taskNav.updateCachedTask(updated);
      if (this.task) {
        this.task = { ...this.task, ...updated };
      }
      this.reloadHistory();
    });
  }

  reload() {
    if (!this.task) return;
    const id = this.task.id;
    this.taskService.getTask(id).subscribe((t) => {
      this.task = t;
      this.taskNav.updateCachedTask(t);
      this.loadingDetails = false;
    });
  }

  formatDate(d: string): string {
    return formatUserDateTime(d);
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
      case 'COMMENT_DELETED': return `deleted comment: "${entry.oldValue}"`;
      default: return entry.action;
    }
  }
}
