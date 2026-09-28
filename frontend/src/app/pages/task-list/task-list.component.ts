import { NgClass } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, switchMap } from 'rxjs';
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
import { TaskListService } from '../../services/task-list.service';
import { AuthService } from '../../services/auth.service';
import { TeamService } from '../../services/team.service';
import { NotificationService } from '../../services/notification.service';
import { TaskNavigationService } from '../../services/task-navigation.service';
import { Task, AssignableMember, Priority, TaskList } from '../../models';
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
export class TaskListComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('newDescriptionInput') newDescriptionInput?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('listNameInput') listNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('tabsScroll') tabsScroll?: ElementRef<HTMLDivElement>;
  @ViewChild('tabsList') tabsList?: ElementRef<HTMLUListElement>;

  tabsOverflow = false;
  canScrollTabsLeft = false;
  canScrollTabsRight = false;
  private tabsResizeObserver?: ResizeObserver;

  lists: TaskList[] = [];
  activeListId: string | null = null;
  listError = '';
  listMenuId: string | null = null;
  creatingList = false;
  savingList = false;
  newListName = '';
  renamingListId: string | null = null;
  renameListName = '';
  deleteListTarget: (TaskList & { taskCount: number }) | null = null;
  deleteMoveToId = '';
  deletingList = false;

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
    listId: '',
  };

  openDropdownId: string | null = null;
  showClosed = false;
  closedDays: 7 | 30 = 7;

  displayName = displayName;
  statusLabel = statusLabel;
  statusClass = statusClass;

  constructor(
    private taskService: TaskService,
    private taskListService: TaskListService,
    public auth: AuthService,
    private teamService: TeamService,
    private notificationService: NotificationService,
    private taskNav: TaskNavigationService,
    private router: Router,
    private zone: NgZone,
  ) {}

  ngAfterViewInit() {
    const scroll = this.tabsScroll?.nativeElement;
    const list = this.tabsList?.nativeElement;
    if (!scroll || !list || typeof ResizeObserver === 'undefined') return;
    this.tabsResizeObserver = new ResizeObserver(() => this.zone.run(() => this.updateTabScroll()));
    this.tabsResizeObserver.observe(scroll);
    this.tabsResizeObserver.observe(list);
  }

  ngOnDestroy() {
    this.tabsResizeObserver?.disconnect();
  }

  updateTabScroll() {
    const el = this.tabsScroll?.nativeElement;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    this.tabsOverflow = maxScroll > 1;
    this.canScrollTabsLeft = el.scrollLeft > 1;
    this.canScrollTabsRight = el.scrollLeft < maxScroll - 1;
  }

  scrollTabs(direction: 1 | -1) {
    const el = this.tabsScroll?.nativeElement;
    if (!el) return;
    this.listMenuId = null;
    el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: 'smooth' });
  }

  @HostListener('document:click')
  onDocumentClick() {
    this.openDropdownId = null;
    this.listMenuId = null;
  }

  ngOnInit() {
    this.notificationService.startPolling();
    this.activeListId = this.taskNav.getActiveListId();
    this.loadLists(() => this.loadTasks({ refreshCounts: false }));
    this.teamService.getAssignableMembers().subscribe((m) => (this.members = m));
  }

  loadLists(then?: () => void) {
    this.taskListService.getLists().subscribe({
      next: (lists) => {
        this.lists = lists;
        if (this.activeListId && !lists.some((l) => l.id === this.activeListId)) {
          this.selectList(null, { reload: false });
        }
        then?.();
      },
      error: () => {
        this.listError = 'Failed to load lists';
        then?.();
      },
    });
  }

  get defaultList(): TaskList | undefined {
    return this.lists[0];
  }

  get activeList(): TaskList | undefined {
    return this.lists.find((l) => l.id === this.activeListId);
  }

  get totalOpenCount(): number {
    return this.lists.reduce((sum, l) => sum + l.taskCount, 0);
  }

  listName(listId: string | undefined): string {
    return this.lists.find((l) => l.id === listId)?.name ?? '';
  }

  selectList(listId: string | null, options?: { reload?: boolean }) {
    this.activeListId = listId;
    this.taskNav.setActiveListId(listId);
    this.scrollActiveTabIntoView();
    if (options?.reload !== false) this.loadTasks();
  }

  private scrollActiveTabIntoView() {
    setTimeout(() => {
      this.tabsScroll?.nativeElement
        .querySelector('.nav-link.active')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }, 0);
  }

  toggleListMenu(listId: string, event: Event) {
    event.stopPropagation();
    this.openDropdownId = null;
    this.listMenuId = this.listMenuId === listId ? null : listId;
  }

  startCreateList() {
    this.listError = '';
    this.cancelRenameList();
    this.creatingList = true;
    this.newListName = '';
    this.focusListNameInput();
  }

  private focusListNameInput() {
    setTimeout(() => this.listNameInput?.nativeElement.select(), 0);
  }

  cancelCreateList() {
    this.creatingList = false;
    this.newListName = '';
  }

  createList() {
    if (this.savingList) return;
    const name = this.newListName.trim();
    if (!name) {
      this.cancelCreateList();
      return;
    }
    this.savingList = true;
    this.taskListService.createList(name).subscribe({
      next: (list) => {
        this.savingList = false;
        this.cancelCreateList();
        this.lists = [...this.lists, list];
        this.selectList(list.id);
      },
      error: (err) => {
        this.savingList = false;
        this.listError = this.errorMessage(err, 'Failed to create list');
      },
    });
  }

  onNewListKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.createList();
    } else if (event.key === 'Escape') {
      this.cancelCreateList();
    }
  }

  startRenameList(list: TaskList, event: Event) {
    event.stopPropagation();
    this.listMenuId = null;
    this.listError = '';
    this.cancelCreateList();
    this.renamingListId = list.id;
    this.renameListName = list.name;
    this.focusListNameInput();
  }

  cancelRenameList() {
    this.renamingListId = null;
    this.renameListName = '';
  }

  saveRenameList() {
    const listId = this.renamingListId;
    const name = this.renameListName.trim();
    const current = this.lists.find((l) => l.id === listId);
    if (!listId || !current || !name || name === current.name) {
      this.cancelRenameList();
      return;
    }
    this.taskListService.renameList(listId, name).subscribe({
      next: (updated) => {
        this.lists = this.lists.map((l) => (l.id === listId ? { ...l, name: updated.name } : l));
        this.cancelRenameList();
      },
      error: (err) => (this.listError = this.errorMessage(err, 'Failed to rename list')),
    });
  }

  onRenameListKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.saveRenameList();
    } else if (event.key === 'Escape') {
      this.cancelRenameList();
    }
  }

  requestDeleteList(list: TaskList, event: Event) {
    event.stopPropagation();
    this.listMenuId = null;
    this.listError = '';
    if (this.lists.length <= 1) return;
    if (list.taskCount > 0) {
      this.openDeleteListModal(list, list.taskCount);
      return;
    }
    if (!confirm(`Delete the list "${list.name}"?`)) return;
    this.taskListService.deleteList(list.id).subscribe({
      next: () => this.afterListDeleted(list.id, null),
      error: (err) => {
        const taskCount = err.status === 409 ? err.error?.taskCount : undefined;
        if (typeof taskCount === 'number') {
          this.openDeleteListModal(list, taskCount);
        } else {
          this.listError = this.errorMessage(err, 'Failed to delete list');
        }
      },
    });
  }

  otherLists(listId: string): TaskList[] {
    return this.lists.filter((l) => l.id !== listId);
  }

  confirmDeleteList() {
    const target = this.deleteListTarget;
    if (!target || !this.deleteMoveToId) return;
    this.deletingList = true;
    this.taskListService.deleteList(target.id, this.deleteMoveToId).subscribe({
      next: () => {
        const moveTo = this.deleteMoveToId;
        this.deletingList = false;
        this.deleteListTarget = null;
        this.afterListDeleted(target.id, moveTo);
      },
      error: (err) => {
        this.deletingList = false;
        this.listError = this.errorMessage(err, 'Failed to delete list');
        this.deleteListTarget = null;
      },
    });
  }

  private openDeleteListModal(list: TaskList, taskCount: number) {
    this.deleteListTarget = { ...list, taskCount };
    this.deleteMoveToId = this.otherLists(list.id)[0]?.id ?? '';
  }

  private afterListDeleted(listId: string, moveTo: string | null) {
    this.lists = this.lists.filter((l) => l.id !== listId);
    if (this.activeListId === listId) {
      this.selectList(moveTo);
    } else {
      this.loadTasks({ silent: true });
    }
  }

  private errorMessage(err: { error?: { message?: string | string[] } }, fallback: string): string {
    const msg = err.error?.message;
    return Array.isArray(msg) ? msg.join(', ') : (msg || fallback);
  }

  private refreshListCounts() {
    this.taskListService.getLists().subscribe((lists) => {
      const counts = new Map(lists.map((l) => [l.id, l.taskCount]));
      this.lists = this.lists.map((l) => ({ ...l, taskCount: counts.get(l.id) ?? l.taskCount }));
    });
  }

  loadTasks(options?: { silent?: boolean; refreshCounts?: boolean }) {
    if (!options?.silent) {
      this.loading = true;
    }
    if (options?.refreshCounts !== false) {
      this.refreshListCounts();
    }
    this.taskService
      .getTasks({
        ...(this.showClosed && { includeClosed: true, closedDays: this.closedDays }),
        listId: this.activeListId,
      })
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
            listId: this.activeListId,
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
      ...(this.activeListId && { listId: this.activeListId }),
    };

    this.taskService.createTask(data).subscribe({
      next: () => {
        this.resetNewTaskForm();
        this.loadTasks();
      },
      error: (err) => {
        this.error = this.errorMessage(err, 'Failed to create task');
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
    this.listMenuId = null;
    this.openDropdownId = this.openDropdownId === taskId ? null : taskId;
  }

  sectionHasOpenDropdown(section: TaskSection): boolean {
    return (
      !!this.openDropdownId &&
      section.tasks.some((task) => task.id === this.openDropdownId || this.moveMenuId(task) === this.openDropdownId)
    );
  }

  moveMenuId(task: Task): string {
    return `move:${task.id}`;
  }

  moveTaskToList(task: Task, listId: string, event: Event) {
    event.stopPropagation();
    this.closeDropdown();
    if (task.listId === listId) return;
    this.taskService.moveToList(task.id, listId).subscribe({
      next: () => this.loadTasks({ silent: true }),
      error: (err) => (this.error = this.errorMessage(err, 'Failed to move task')),
    });
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
      listId: task.listId ?? this.defaultList?.id ?? '',
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
    const task = this.editTask;
    const listId = this.editForm.listId;
    const update$ = this.taskService.updateTask(task.id, data);
    const save$: Observable<unknown> = listId && listId !== task.listId
      ? update$.pipe(switchMap(() => this.taskService.moveToList(task.id, listId)))
      : update$;
    save$.subscribe({
      next: () => {
        this.editTask = null;
        this.loadTasks();
      },
      error: (err) => (this.error = this.errorMessage(err, 'Failed to save task')),
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
