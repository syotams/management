import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { Task, TaskDetail, Comment } from '../models';

@Injectable({ providedIn: 'root' })
export class TaskService {
  constructor(private api: ApiService) {}

  getTasks(options?: { includeClosed?: boolean; closedDays?: 7 | 30 }) {
    const params = new URLSearchParams();
    if (options?.includeClosed) {
      params.set('includeClosed', 'true');
      params.set('closedDays', String(options.closedDays ?? 7));
    }
    const query = params.toString();
    return this.api.get<Task[]>(`/tasks${query ? `?${query}` : ''}`);
  }

  getTask(id: string) {
    return this.api.get<TaskDetail>(`/tasks/${id}`);
  }

  createTask(data: {
    title: string;
    description?: string;
    dueDate?: string;
    priority?: string;
    ownerId?: string;
    assigneeId?: string;
    teamId?: string;
    alertAt?: string;
  }) {
    return this.api.post<Task>('/tasks', data);
  }

  start(id: string) {
    return this.api.patch<Task>(`/tasks/${id}/start`);
  }

  complete(id: string) {
    return this.api.patch<Task>(`/tasks/${id}/complete`);
  }

  archive(id: string) {
    return this.api.patch<Task>(`/tasks/${id}/archive`);
  }

  postpone(id: string, dueDate: string, alertAt?: string, updateAlert = true) {
    return this.api.patch<Task>(`/tasks/${id}/postpone`, { dueDate, alertAt, updateAlert });
  }

  updateTask(id: string, data: Record<string, unknown>) {
    return this.api.patch<Task>(`/tasks/${id}`, data);
  }

  addComment(taskId: string, body: string) {
    return this.api.post<Comment>(`/tasks/${taskId}/comments`, { body });
  }

  deleteComment(taskId: string, commentId: string) {
    return this.api.delete(`/tasks/${taskId}/comments/${commentId}`);
  }

  getPendingAlerts() {
    return this.api.get<{ id: string; title: string; dueDate: string; priority: string }[]>('/tasks/alerts/pending');
  }
}
