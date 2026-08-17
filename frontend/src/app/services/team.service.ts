import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { Team, TeamInvite, TeamMember, AssignableMember } from '../models';

@Injectable({ providedIn: 'root' })
export class TeamService {
  constructor(private api: ApiService) {}

  getTeams() {
    return this.api.get<Team[]>('/teams');
  }

  createTeam(name: string) {
    return this.api.post<Team>('/teams', { name });
  }

  getMembers(teamId: string) {
    return this.api.get<{ members: TeamMember[]; invites: TeamInvite[] }>(`/teams/${teamId}/members`);
  }

  invite(teamId: string, email: string) {
    return this.api.post<TeamInvite>(`/teams/${teamId}/invites`, { email });
  }

  removeMember(teamId: string, userId: string) {
    return this.api.delete(`/teams/${teamId}/members/${userId}`);
  }

  revokeInvite(teamId: string, inviteId: string) {
    return this.api.delete(`/teams/${teamId}/invites/${inviteId}`);
  }

  reinvite(teamId: string, inviteId: string) {
    return this.api.post(`/teams/${teamId}/invites/${inviteId}/reinvite`, {});
  }

  getAssignableMembers() {
    return this.api.get<AssignableMember[]>('/teams/assignable-members');
  }

  getInviteInfo(token: string) {
    return this.api.getPublic<{ email: string; teamName: string; status: string; expiresAt: string }>(`/invites/${token}`);
  }

  acceptInvite(token: string) {
    return this.api.post<{ teamId: string; teamName: string }>(`/invites/${token}/accept`, {});
  }
}
