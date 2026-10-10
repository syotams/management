import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { Task, TaskDetail, Comment, AuditLog } from '../models';

@Injectable({ providedIn: 'root' })
export class TaskService {
  constructor(private api: ApiService) {}

  getTasks(options?: { includeClosed?: boolean; closedDays?: 7 | 30; listId?: string | null }) {
    const params = new URLSearchParams();
    if (options?.includeClosed) {
      params.set('includeClosed', 'true');
      params.set('closedDays', String(options.closedDays ?? 7));
    }
    if (options?.listId) {
      params.set('listId', options.listId);
    }
    const query = params.toString();
    return this.api.get<Task[]>(`/tasks${query ? `?${query}` : ''}`);
  }

  getTask(id: string) {
    return this.api.get<TaskDetail>(`/tasks/${id}`);
  }

  getComments(taskId: string) {
    return this.api.get<Comment[]>(`/tasks/${taskId}/comments`);
  }

  getHistory(taskId: string) {
    return this.api.get<AuditLog[]>(`/tasks/${taskId}/history`);
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
    listId?: string;
  }) {
    return this.api.post<Task>('/tasks', data);
  }

  moveToList(id: string, listId: string) {
    return this.api.patch<{ taskId: string; listId: string }>(`/tasks/${id}/list`, { listId });
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

  postpone(id: string, dueDate: string, alertAt?: string | null, updateAlert = true) {
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
}
