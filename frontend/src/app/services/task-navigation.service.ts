import { Injectable } from '@angular/core';
import { Task } from '../models';

export interface TaskListOptions {
  showClosed: boolean;
  closedDays: 7 | 30;
  /** `null` means the "All tasks" view. */
  listId: string | null;
}

const ACTIVE_LIST_STORAGE_KEY = 'tasks.activeListId';

export interface TaskNavigation {
  prevId: string | null;
  nextId: string | null;
  index: number;
  total: number;
}

@Injectable({ providedIn: 'root' })
export class TaskNavigationService {
  private taskIds: string[] = [];
  private taskCache = new Map<string, Task>();
  private listOptions: TaskListOptions = {
    showClosed: false,
    closedDays: 7,
    listId: localStorage.getItem(ACTIVE_LIST_STORAGE_KEY),
  };

  setTaskList(tasks: Task[], options?: Partial<TaskListOptions>) {
    this.taskIds = tasks.map((t) => t.id);
    this.taskCache = new Map(tasks.map((t) => [t.id, t]));
    if (options) {
      this.listOptions = {
        showClosed: options.showClosed ?? this.listOptions.showClosed,
        closedDays: options.closedDays ?? this.listOptions.closedDays,
        listId: options.listId !== undefined ? options.listId : this.listOptions.listId,
      };
    }
  }

  getActiveListId(): string | null {
    return this.listOptions.listId;
  }

  setActiveListId(listId: string | null) {
    this.listOptions = { ...this.listOptions, listId };
    if (listId) localStorage.setItem(ACTIVE_LIST_STORAGE_KEY, listId);
    else localStorage.removeItem(ACTIVE_LIST_STORAGE_KEY);
  }

  getNavigation(taskId: string): TaskNavigation | null {
    const index = this.taskIds.indexOf(taskId);
    if (index === -1) return null;
    return {
      prevId: index > 0 ? this.taskIds[index - 1]! : null,
      nextId: index < this.taskIds.length - 1 ? this.taskIds[index + 1]! : null,
      index,
      total: this.taskIds.length,
    };
  }

  getCachedTask(id: string): Task | null {
    return this.taskCache.get(id) ?? null;
  }

  updateCachedTask(task: Task) {
    if (this.taskCache.has(task.id)) {
      this.taskCache.set(task.id, task);
    }
  }

  removeTask(taskId: string) {
    this.taskIds = this.taskIds.filter((id) => id !== taskId);
    this.taskCache.delete(taskId);
  }

  get hasList(): boolean {
    return this.taskIds.length > 0;
  }

  getListOptions(): TaskListOptions {
    return this.listOptions;
  }
}
