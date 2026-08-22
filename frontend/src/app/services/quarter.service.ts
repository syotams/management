import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { QuarterComparison, QuarterDetail, QuarterSummary } from '../models';

export interface CreateQuarterPayload {
  name: string;
  startDate: string;
  endDate: string;
  teamId?: string | null;
}

export interface UpdateQuarterPayload {
  name?: string;
  startDate?: string;
  endDate?: string;
  teamId?: string | null;
}

export interface CreateEpicPayload {
  title: string;
  workingDays: number;
  startSprintNumber: number;
  assigneeIds: string[];
  backgroundColor: string;
}

export interface UpdateEpicPayload {
  title?: string;
  workingDays?: number;
  startSprintNumber?: number;
  assigneeIds?: string[];
  backgroundColor?: string;
}

@Injectable({ providedIn: 'root' })
export class QuarterService {
  constructor(private api: ApiService) {}

  getQuarters() {
    return this.api.get<QuarterSummary[]>('/quarters');
  }

  getQuarter(id: string) {
    return this.api.get<QuarterDetail>(`/quarters/${id}`);
  }

  compareQuarter(id: string) {
    return this.api.get<QuarterComparison>(`/quarters/${id}/compare`);
  }

  createQuarter(payload: CreateQuarterPayload) {
    return this.api.post<QuarterDetail>('/quarters', payload);
  }

  updateQuarter(id: string, payload: UpdateQuarterPayload) {
    return this.api.patch<QuarterDetail>(`/quarters/${id}`, payload);
  }

  startQuarter(id: string) {
    return this.api.patch<QuarterDetail>(`/quarters/${id}/start`, {});
  }

  completeQuarter(id: string) {
    return this.api.patch<QuarterDetail>(`/quarters/${id}/complete`, {});
  }

  addEpic(quarterId: string, payload: CreateEpicPayload) {
    return this.api.post<QuarterDetail>(`/quarters/${quarterId}/epics`, payload);
  }

  updateEpic(quarterId: string, epicId: string, payload: UpdateEpicPayload) {
    return this.api.patch<QuarterDetail>(`/quarters/${quarterId}/epics/${epicId}`, payload);
  }

  deleteEpic(quarterId: string, epicId: string) {
    return this.api.delete<QuarterDetail>(`/quarters/${quarterId}/epics/${epicId}`);
  }
}
