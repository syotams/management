import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { ProjectComparison, ProjectDetail, ProjectSummary } from '../models';

export interface CreateProjectPayload {
  name: string;
  startDate: string;
  endDate: string;
  teamId?: string | null;
  teamIds?: string[];
  userIds?: string[];
}

export interface UpdateProjectPayload {
  name?: string;
  startDate?: string;
  endDate?: string;
  teamId?: string | null;
}

export interface CreateEpicPayload {
  title: string;
  workingDays: number;
  startSprintNumber?: number | null;
  assigneeIds?: string[];
  backgroundColor: string;
}

export interface UpdateEpicPayload {
  title?: string;
  workingDays?: number;
  startSprintNumber?: number | null;
  assigneeIds?: string[];
  backgroundColor?: string;
}

@Injectable({ providedIn: 'root' })
export class ProjectService {
  constructor(private api: ApiService) {}

  getProjects() {
    return this.api.get<ProjectSummary[]>('/projects');
  }

  getProject(id: string) {
    return this.api.get<ProjectDetail>(`/projects/${id}`);
  }

  compareProject(id: string) {
    return this.api.get<ProjectComparison>(`/projects/${id}/compare`);
  }

  createProject(payload: CreateProjectPayload) {
    return this.api.post<ProjectDetail>('/projects', payload);
  }

  updateProject(id: string, payload: UpdateProjectPayload) {
    return this.api.patch<ProjectDetail>(`/projects/${id}`, payload);
  }

  startProject(id: string) {
    return this.api.patch<ProjectDetail>(`/projects/${id}/start`, {});
  }

  completeProject(id: string) {
    return this.api.patch<ProjectDetail>(`/projects/${id}/complete`, {});
  }

  addEpic(projectId: string, payload: CreateEpicPayload) {
    return this.api.post<ProjectDetail>(`/projects/${projectId}/epics`, payload);
  }

  updateEpic(projectId: string, epicId: string, payload: UpdateEpicPayload) {
    return this.api.patch<ProjectDetail>(`/projects/${projectId}/epics/${epicId}`, payload);
  }

  deleteEpic(projectId: string, epicId: string) {
    return this.api.delete<ProjectDetail>(`/projects/${projectId}/epics/${epicId}`);
  }

  assignEpic(projectId: string, epicId: string, assigneeId: string, startSprintNumber: number) {
    return this.api.post<ProjectDetail>(`/projects/${projectId}/epics/${epicId}/assign`, {
      assigneeId,
      startSprintNumber,
    });
  }

  addParticipant(projectId: string, userId: string) {
    return this.api.post<ProjectDetail>(`/projects/${projectId}/participants`, { userId });
  }

  getAddableParticipants(projectId: string) {
    return this.api.get<{ id: string; name: string; email: string }[]>(
      `/projects/${projectId}/addable-participants`,
    );
  }

  addHoliday(projectId: string, payload: { name?: string; startDate: string; endDate: string }) {
    return this.api.post<ProjectDetail>(`/projects/${projectId}/holidays`, payload);
  }

  deleteHoliday(projectId: string, holidayId: string) {
    return this.api.delete<ProjectDetail>(`/projects/${projectId}/holidays/${holidayId}`);
  }

  deleteHolidayGroup(projectId: string, groupKey: string) {
    return this.api.delete<ProjectDetail>(`/projects/${projectId}/holiday-groups/${groupKey}`);
  }

  addPto(
    projectId: string,
    payload: {
      name?: string;
      startDate: string;
      endDate: string;
      teamId?: string;
      userIds?: string[];
    },
  ) {
    return this.api.post<ProjectDetail>(`/projects/${projectId}/pto`, payload);
  }

  deletePto(projectId: string, ptoId: string) {
    return this.api.delete<ProjectDetail>(`/projects/${projectId}/pto/${ptoId}`);
  }
}
