import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { TaskList } from '../models';

@Injectable({ providedIn: 'root' })
export class TaskListService {
  constructor(private api: ApiService) {}

  getLists() {
    return this.api.get<TaskList[]>('/task-lists');
  }

  createList(name: string) {
    return this.api.post<TaskList>('/task-lists', { name });
  }

  renameList(id: string, name: string) {
    return this.api.patch<TaskList>(`/task-lists/${id}`, { name });
  }

  deleteList(id: string, moveTo?: string) {
    const query = moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : '';
    return this.api.delete<{ success: boolean }>(`/task-lists/${id}${query}`);
  }
}
