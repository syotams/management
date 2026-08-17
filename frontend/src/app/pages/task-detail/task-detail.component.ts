import { NgClass } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TaskService } from '../../services/task.service';
import { AuthService } from '../../services/auth.service';
import { TeamService } from '../../services/team.service';
import { AssignableMember, Priority, TaskDetail } from '../../models';
import { toDatetimeLocal, displayName, PRIORITIES, statusLabel, statusClass } from '../../utils/task-grouping';
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
    private taskService: TaskService,
    private teamService: TeamService,
    public auth: AuthService,
  ) {}

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.taskService.getTask(id).subscribe({
      next: (task) => {
        this.task = task;
        this.loading = false;
      },
    });
    this.teamService.getAssignableMembers().subscribe((m) => (this.members = m));
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
    this.taskService.updateTask(this.editTask.id, data).subscribe(() => {
      this.editTask = null;
      this.reload();
    });
  }

  reload() {
    if (!this.task) return;
    this.taskService.getTask(this.task.id).subscribe((t) => {
      this.task = t;
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
