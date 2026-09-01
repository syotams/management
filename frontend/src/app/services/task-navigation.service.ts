import { Injectable } from '@angular/core';
import { Task } from '../models';

export interface TaskListOptions {
  showClosed: boolean;
  closedDays: 7 | 30;
}

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
  private listOptions: TaskListOptions = { showClosed: false, closedDays: 7 };

  setTaskList(tasks: Task[], options?: Partial<TaskListOptions>) {
    this.taskIds = tasks.map((t) => t.id);
    this.taskCache = new Map(tasks.map((t) => [t.id, t]));
    if (options) {
      this.listOptions = {
        showClosed: options.showClosed ?? this.listOptions.showClosed,
        closedDays: options.closedDays ?? this.listOptions.closedDays,
      };
    }
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

  get hasList(): boolean {
    return this.taskIds.length > 0;
  }

  getListOptions(): TaskListOptions {
    return this.listOptions;
  }
}
