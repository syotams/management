import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { QuarterDetail, QuarterSummary } from '../models';

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

@Injectable({ providedIn: 'root' })
export class QuarterService {
  constructor(private api: ApiService) {}

  getQuarters() {
    return this.api.get<QuarterSummary[]>('/quarters');
  }

  getQuarter(id: string) {
    return this.api.get<QuarterDetail>(`/quarters/${id}`);
  }

  createQuarter(payload: CreateQuarterPayload) {
    return this.api.post<QuarterDetail>('/quarters', payload);
  }

  updateQuarter(id: string, payload: UpdateQuarterPayload) {
    return this.api.patch<QuarterDetail>(`/quarters/${id}`, payload);
  }

  completeQuarter(id: string) {
    return this.api.patch<QuarterDetail>(`/quarters/${id}/complete`, {});
  }

  addEpic(quarterId: string, payload: CreateEpicPayload) {
    return this.api.post<QuarterDetail>(`/quarters/${quarterId}/epics`, payload);
  }
}
