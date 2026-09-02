import { NgClass } from '@angular/common';
import { Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDragPreview,
  CdkDropList,
  CdkDropListGroup,
  moveItemInArray,
  transferArrayItem,
} from '@angular/cdk/drag-drop';
import { TaskService } from '../../services/task.service';
import { AuthService } from '../../services/auth.service';
import { TeamService } from '../../services/team.service';
import { NotificationService } from '../../services/notification.service';
import { TaskNavigationService } from '../../services/task-navigation.service';
import { Task, AssignableMember, Priority } from '../../models';
import {
  groupTasks,
  flattenGroupedTasks,
  toDatetimeLocal,
  dayKeyToDueDate,
  displayName,
  PRIORITIES,
  statusLabel,
  statusClass,
} from '../../utils/task-grouping';
import { datetimeLocalToUtcIso, formatUserDate, formatUserDateTime, fromDatetimeLocal } from '../../utils/date';

interface TaskSection {
  key: string;
  label: string;
  tasks: Task[];
  droppable: boolean;
  isOverdue: boolean;
  isUrgent: boolean;
  isClosed: boolean;
}

@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [FormsModule, NgClass, CdkDropListGroup, CdkDropList, CdkDrag, CdkDragHandle, CdkDragPreview],
  templateUrl: './task-list.component.html',
  styleUrl: './task-list.component.scss',
})
export class TaskListComponent implements OnInit {
  @ViewChild('newDescriptionInput') newDescriptionInput?: ElementRef<HTMLTextAreaElement>;

  sections: TaskSection[] = [];
  loading = true;
  error = '';
  priorities = PRIORITIES;

  newTitle = '';
  newDescription = '';
  newDueDate = '';
  newAlertAt = '';
  newAssigneeId = '';
  showDescriptionField = false;
  showDueDateField = false;
  showAlertField = false;
  showAssigneeField = false;
  members: AssignableMember[] = [];

  postponeTask: Task | null = null;
  postponeDate = '';
  postponeAlertAt = '';
  updateAlertOnPostpone = true;

  editTask: Task | null = null;
  editForm = {
    title: '',
    description: '',
    priority: 'medium' as Priority,
    dueDate: '',
    alertAt: '',
    assigneeId: '',
  };

  openDropdownId: string | null = null;
  showClosed = false;
  closedDays: 7 | 30 = 7;

  displayName = displayName;
  statusLabel = statusLabel;
  statusClass = statusClass;

  constructor(
    private taskService: TaskService,
    public auth: AuthService,
    private teamService: TeamService,
    private notificationService: NotificationService,
    private taskNav: TaskNavigationService,
    private router: Router,
  ) {}

  @HostListener('document:click')
  onDocumentClick() {
    this.openDropdownId = null;
  }

  ngOnInit() {
    this.notificationService.startPolling();
    this.loadTasks();
    this.teamService.getAssignableMembers().subscribe((m) => (this.members = m));
  }

  loadTasks(options?: { silent?: boolean }) {
    if (!options?.silent) {
      this.loading = true;
    }
    this.taskService
      .getTasks(this.showClosed ? { includeClosed: true, closedDays: this.closedDays } : undefined)
      .subscribe({
        next: (tasks) => {
          const grouped = groupTasks(tasks);
          this.sections = [];
          if (grouped.urgent.length) {
            this.sections.push({
              key: 'urgent',
              label: 'Urgent',
              tasks: grouped.urgent,
              droppable: false,
              isOverdue: false,
              isUrgent: true,
              isClosed: false,
            });
          }
          for (const g of grouped.groups) {
            this.sections.push({
              key: g.key,
              label: g.label,
              tasks: g.tasks,
              droppable: true,
              isOverdue: g.isOverdue,
              isUrgent: false,
              isClosed: false,
            });
          }
          if (this.showClosed) {
            const period = this.closedDays === 30 ? 'last 30 days' : 'last week';
            this.sections.push({
              key: 'completed',
              label: `Completed — ${period}`,
              tasks: grouped.completed,
              droppable: false,
              isOverdue: false,
              isUrgent: false,
              isClosed: true,
            });
            this.sections.push({
              key: 'archived',
              label: `Archived — ${period}`,
              tasks: grouped.archived,
              droppable: false,
              isOverdue: false,
              isUrgent: false,
              isClosed: true,
            });
          }
          const flatTasks = flattenGroupedTasks(grouped, this.showClosed);
          this.taskNav.setTaskList(flatTasks, {
            showClosed: this.showClosed,
            closedDays: this.closedDays,
          });
          this.loading = false;
        },
        error: () => {
          this.error = 'Failed to load tasks';
          this.loading = false;
        },
      });
  }

  onShowClosedChange() {
    this.loadTasks();
  }

  setClosedDays(days: 7 | 30) {
    if (this.closedDays === days) return;
    this.closedDays = days;
    if (this.showClosed) {
      this.loadTasks();
    }
  }

  emptySectionMessage(section: TaskSection): string {
    if (section.key === 'completed') {
      return `No completed tasks in the ${this.closedPeriodLabel()}`;
    }
    if (section.key === 'archived') {
      return `No archived tasks in the ${this.closedPeriodLabel()}`;
    }
    return 'No tasks in this group';
  }

  closedPeriodLabel(): string {
    return this.closedDays === 30 ? 'last 30 days' : 'last week';
  }

  hasStatusActions(task: Task): boolean {
    return task.status !== 'archived';
  }

  onTitleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.shiftKey) {
      this.showDescriptionInput();
      return;
    }
    this.addTask();
  }

  addTask() {
    if (!this.newTitle.trim()) return;
    this.error = '';
    const dueDate = this.showDueDateField && this.newDueDate
      ? fromDatetimeLocal(this.newDueDate)
      : this.defaultDueDate();
    const description = this.showDescriptionField ? this.newDescription.trim() : '';
    const data = {
      title: this.newTitle.trim(),
      dueDate: dueDate.toISOString(),
      ...(description && { description }),
      ...(this.showAlertField && this.newAlertAt && { alertAt: datetimeLocalToUtcIso(this.newAlertAt) }),
      ...(this.showAssigneeField && this.newAssigneeId && { assigneeId: this.newAssigneeId }),
    };

    this.taskService.createTask(data).subscribe({
      next: () => {
        this.resetNewTaskForm();
        this.loadTasks();
      },
      error: (err) => {
        const msg = err.error?.message;
        this.error = Array.isArray(msg) ? msg.join(', ') : (msg || 'Failed to create task');
        if (err.status === 401) {
          this.auth.logout();
        }
      },
    });
  }

  showDescriptionInput() {
    this.showDescriptionField = true;
    setTimeout(() => this.newDescriptionInput?.nativeElement.focus(), 0);
  }

  showDueDateInput() {
    this.showDueDateField = true;
    this.newDueDate = toDatetimeLocal(this.defaultDueDate());
  }

  showAlertInput() {
    this.showAlertField = true;
    const base = this.showDueDateField && this.newDueDate
      ? fromDatetimeLocal(this.newDueDate)
      : this.defaultDueDate();
    this.newAlertAt = toDatetimeLocal(base);
  }

  showAssigneeInput() {
    this.showAssigneeField = true;
  }

  private defaultDueDate(): Date {
    return new Date(Date.now() + 60 * 60 * 1000);
  }

  private resetNewTaskForm() {
    this.newTitle = '';
    this.newDescription = '';
    this.newDueDate = '';
    this.newAlertAt = '';
    this.newAssigneeId = '';
    this.showDescriptionField = false;
    this.showDueDateField = false;
    this.showAlertField = false;
    this.showAssigneeField = false;
  }

  isOwner(task: Task): boolean {
    return task.ownerId === this.auth.currentUser()?.id;
  }

  toggleDropdown(taskId: string, event: Event) {
    event.stopPropagation();
    this.openDropdownId = this.openDropdownId === taskId ? null : taskId;
  }

  sectionHasOpenDropdown(section: TaskSection): boolean {
    return !!this.openDropdownId && section.tasks.some((task) => task.id === this.openDropdownId);
  }

  closeDropdown() {
    this.openDropdownId = null;
  }

  start(task: Task, event: Event) {
    event.stopPropagation();
    this.closeDropdown();
    this.taskService.start(task.id).subscribe(() => this.loadTasks({ silent: true }));
  }

  complete(task: Task, event: Event) {
    event.stopPropagation();
    this.closeDropdown();
    this.taskService.complete(task.id).subscribe(() => this.loadTasks({ silent: true }));
  }

  archive(task: Task, event: Event) {
    event.stopPropagation();
    this.closeDropdown();
    this.taskService.archive(task.id).subscribe(() => this.loadTasks({ silent: true }));
  }

  openPostpone(task: Task, event: Event) {
    event.stopPropagation();
    this.postponeTask = task;
    this.postponeDate = toDatetimeLocal(new Date(task.dueDate));
    this.updateAlertOnPostpone = true;
    this.postponeAlertAt = this.postponeDate;
  }

  onPostponeDateChange() {
    if (this.updateAlertOnPostpone) {
      this.postponeAlertAt = this.postponeDate;
    }
  }

  onUpdateAlertChange() {
    if (this.updateAlertOnPostpone) {
      this.postponeAlertAt = this.postponeDate;
    } else if (this.postponeTask) {
      this.postponeAlertAt = toDatetimeLocal(new Date(this.postponeTask.alertAt));
    }
  }

  confirmPostpone() {
    if (!this.postponeTask) return;
    const alertAt = this.updateAlertOnPostpone
      ? datetimeLocalToUtcIso(this.postponeDate)
      : datetimeLocalToUtcIso(this.postponeAlertAt);
    this.taskService
      .postpone(this.postponeTask.id, datetimeLocalToUtcIso(this.postponeDate), alertAt, true)
      .subscribe(() => {
        this.postponeTask = null;
        this.loadTasks();
      });
  }

  openEditModal(task: Task, event: Event) {
    event.stopPropagation();
    this.editTask = task;
    this.editForm = {
      title: task.title,
      description: task.description || '',
      priority: task.priority,
      dueDate: toDatetimeLocal(new Date(task.dueDate)),
      alertAt: toDatetimeLocal(new Date(task.alertAt)),
      assigneeId: task.assigneeId,
    };
  }

  saveEditModal() {
    if (!this.editTask) return;
    const data: Record<string, string> = {
      title: this.editForm.title.trim(),
      description: this.editForm.description,
      priority: this.editForm.priority,
    };
    if (this.isOwner(this.editTask)) {
      data['assigneeId'] = this.editForm.assigneeId;
      data['dueDate'] = datetimeLocalToUtcIso(this.editForm.dueDate);
      data['alertAt'] = datetimeLocalToUtcIso(this.editForm.alertAt);
    }
    this.taskService.updateTask(this.editTask.id, data).subscribe(() => {
      this.editTask = null;
      this.loadTasks();
    });
  }

  onRowClick(task: Task) {
    this.router.navigate(['/tasks', task.id]);
  }

  onDrop(event: CdkDragDrop<Task[]>, section: TaskSection) {
    if (!section.droppable) return;
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
      return;
    }

    const task = event.previousContainer.data[event.previousIndex];
    if (!this.isOwner(task)) return;
    if (section.isOverdue) return;

    transferArrayItem(
      event.previousContainer.data,
      event.container.data,
      event.previousIndex,
      event.currentIndex,
    );

    const newDue = dayKeyToDueDate(section.key, new Date(task.dueDate));
    this.taskService.postpone(task.id, newDue).subscribe({
      error: () => this.loadTasks(),
    });
  }

  getConnectedLists(): string[] {
    return this.sections.filter((s) => s.droppable && !s.isOverdue).map((s) => s.key);
  }

  priorityClass(priority: string): string {
    return `priority-${priority}`;
  }

  formatDate(d: string): string {
    return formatUserDate(d);
  }

  formatDateTime(d: string): string {
    return formatUserDateTime(d);
  }
}
