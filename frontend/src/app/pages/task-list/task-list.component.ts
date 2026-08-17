import { NgClass } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDropList,
  CdkDropListGroup,
  moveItemInArray,
  transferArrayItem,
} from '@angular/cdk/drag-drop';
import { TaskService } from '../../services/task.service';
import { AuthService } from '../../services/auth.service';
import { TeamService } from '../../services/team.service';
import { NotificationService } from '../../services/notification.service';
import { Task, DayGroup, AssignableMember } from '../../models';
import { groupTasksByDay, toDatetimeLocal, dayKeyToDueDate } from '../../utils/task-grouping';

@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [FormsModule, NgClass, CdkDropListGroup, CdkDropList, CdkDrag],
  templateUrl: './task-list.component.html',
  styleUrl: './task-list.component.scss',
})
export class TaskListComponent implements OnInit {
  groups: DayGroup[] = [];
  loading = true;
  error = '';

  newTitle = '';
  newAlertAt = '';
  showAdvanced = false;
  newAssigneeId = '';
  members: AssignableMember[] = [];

  postponeTask: Task | null = null;
  postponeDate = '';
  postponeAlertAt = '';
  updateAlertOnPostpone = true;

  constructor(
    private taskService: TaskService,
    public auth: AuthService,
    private teamService: TeamService,
    private notificationService: NotificationService,
    private router: Router,
  ) {}

  ngOnInit() {
    this.notificationService.startPolling();
    this.loadTasks();
    this.teamService.getAssignableMembers().subscribe((m) => (this.members = m));
  }

  loadTasks() {
    this.loading = true;
    this.taskService.getTasks().subscribe({
      next: (tasks) => {
        this.groups = groupTasksByDay(tasks);
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load tasks';
        this.loading = false;
      },
    });
  }

  addTask() {
    if (!this.newTitle.trim()) return;
    const now = new Date();
    now.setHours(17, 0, 0, 0);
    const data = {
      title: this.newTitle.trim(),
      dueDate: now.toISOString(),
      ...(this.newAlertAt && { alertAt: new Date(this.newAlertAt).toISOString() }),
      ...(this.newAssigneeId && { assigneeId: this.newAssigneeId }),
    };

    this.taskService.createTask(data).subscribe({
      next: () => {
        this.newTitle = '';
        this.newAlertAt = '';
        this.newAssigneeId = '';
        this.loadTasks();
      },
    });
  }

  isOwner(task: Task): boolean {
    return task.ownerId === this.auth.currentUser()?.id;
  }

  start(task: Task) {
    this.taskService.start(task.id).subscribe(() => this.loadTasks());
  }

  complete(task: Task) {
    this.taskService.complete(task.id).subscribe(() => this.loadTasks());
  }

  archive(task: Task) {
    this.taskService.archive(task.id).subscribe(() => this.loadTasks());
  }

  openPostpone(task: Task) {
    this.postponeTask = task;
    this.postponeDate = toDatetimeLocal(new Date(task.dueDate));
    this.postponeAlertAt = toDatetimeLocal(new Date(task.alertAt));
    this.updateAlertOnPostpone = true;
  }

  confirmPostpone() {
    if (!this.postponeTask) return;
    const alertAt = this.updateAlertOnPostpone ? new Date(this.postponeAlertAt).toISOString() : undefined;
    this.taskService
      .postpone(this.postponeTask.id, new Date(this.postponeDate).toISOString(), alertAt, this.updateAlertOnPostpone)
      .subscribe(() => {
        this.postponeTask = null;
        this.loadTasks();
      });
  }

  onDrop(event: CdkDragDrop<Task[]>, targetGroup: DayGroup) {
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
      return;
    }

    const task = event.previousContainer.data[event.previousIndex];
    if (!this.isOwner(task)) return;
    if (targetGroup.isOverdue || targetGroup.key === 'overdue') return;

    transferArrayItem(
      event.previousContainer.data,
      event.container.data,
      event.previousIndex,
      event.currentIndex,
    );

    const newDue = dayKeyToDueDate(targetGroup.key, new Date(task.dueDate));
    this.taskService.postpone(task.id, newDue).subscribe({
      error: () => this.loadTasks(),
    });
  }

  getConnectedLists(): string[] {
    return this.groups.filter((g) => !g.isOverdue).map((g) => g.key);
  }

  priorityClass(priority: string): string {
    return `priority-${priority}`;
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      todo: 'Todo',
      in_progress: 'In Progress',
      completed: 'Completed',
      archived: 'Archived',
    };
    return labels[status] || status;
  }

  formatDate(d: string): string {
    return new Date(d).toLocaleString();
  }

  lastCommentText(task: Task): string {
    if (!task.lastComment) return '—';
    const c = task.lastComment;
    const truncated = c.body.length > 50 ? c.body.slice(0, 50) + '…' : c.body;
    return `${truncated} — ${c.user.email}, ${this.formatDate(c.createdAt)}`;
  }

  openDetail(task: Task) {
    this.router.navigate(['/tasks', task.id]);
  }
}
