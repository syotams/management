import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TeamService } from '../../services/team.service';
import { AuthService } from '../../services/auth.service';
import { Team, TeamMember, TeamInvite } from '../../models';

@Component({
  selector: 'app-teams',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="container py-4">
      <h2 class="mb-4">Teams</h2>

      <div class="card mb-4">
        <div class="card-body">
          <h5>Create Team</h5>
          <div class="input-group">
            <input type="text" class="form-control" [(ngModel)]="newTeamName" placeholder="Team name">
            <button class="btn btn-primary" (click)="createTeam()" [disabled]="!newTeamName.trim()">Create</button>
          </div>
        </div>
      </div>

      @for (team of teams; track team.id) {
        <div class="card mb-4">
          <div class="card-header d-flex justify-content-between align-items-center">
            <h5 class="mb-0">{{ team.name }}</h5>
            <button class="btn btn-sm btn-outline-primary" (click)="loadMembers(team.id)">
              {{ selectedTeamId === team.id ? 'Refresh' : 'Manage Members' }}
            </button>
          </div>

          @if (selectedTeamId === team.id && members) {
            <div class="card-body">
              <!-- Invite -->
              @if (isOwner(team)) {
                <div class="mb-4">
                  <h6>Invite Member</h6>
                  <div class="input-group">
                    <input type="email" class="form-control" [(ngModel)]="inviteEmail" placeholder="email@example.com">
                    <button class="btn btn-primary" (click)="sendInvite(team.id)">Send Invite</button>
                  </div>
                  @if (inviteMessage) {
                    <div class="alert alert-info mt-2">{{ inviteMessage }}</div>
                  }
                </div>
              }

              <!-- Members table -->
              <h6>Members</h6>
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  @for (m of members.members; track m.id) {
                    <tr>
                      <td>{{ m.user.email }}</td>
                      <td><span class="badge bg-secondary">{{ m.role }}</span></td>
                      <td>
                        @if (isOwner(team) && m.role !== 'owner' && m.userId !== auth.currentUser()?.id) {
                          <button class="btn btn-sm btn-outline-danger" (click)="removeMember(team.id, m.userId)">Remove</button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>

              <!-- Pending invites -->
              @if (members.invites.length) {
                <h6 class="mt-3">Pending Invites</h6>
                <table class="table table-sm">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Status</th>
                      <th>Expires</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (inv of members.invites; track inv.id) {
                      <tr>
                        <td>{{ inv.email }}</td>
                        <td>
                          <span class="badge" [class.bg-warning]="inv.status === 'pending'" [class.bg-secondary]="inv.status === 'expired'">
                            {{ inv.status }}
                          </span>
                        </td>
                        <td>
                          @if (inv.status === 'pending') {
                            {{ inv.daysUntilExpiry }} days left
                          } @else {
                            Expired
                          }
                        </td>
                        <td>
                          @if (inv.inviteLink) {
                            <button class="btn btn-sm btn-outline-primary me-1" (click)="copyLink(inv.inviteLink!)">
                              <i class="bi bi-clipboard"></i> Copy Link
                            </button>
                          }
                          @if (inv.status === 'expired' && isOwner(team)) {
                            <button class="btn btn-sm btn-outline-success me-1" (click)="reinvite(team.id, inv.id)">Re-invite</button>
                          }
                          @if (isOwner(team) && inv.status === 'pending') {
                            <button class="btn btn-sm btn-outline-danger" (click)="revokeInvite(team.id, inv.id)">Revoke</button>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
            </div>
          }
        </div>
      } @empty {
        <p class="text-muted">No teams yet. Create one above!</p>
      }
    </div>
  `,
})
export class TeamsComponent implements OnInit {
  teams: Team[] = [];
  newTeamName = '';
  selectedTeamId = '';
  members: { members: TeamMember[]; invites: TeamInvite[] } | null = null;
  inviteEmail = '';
  inviteMessage = '';

  constructor(public teamService: TeamService, public auth: AuthService) {}

  ngOnInit() {
    this.loadTeams();
  }

  loadTeams() {
    this.teamService.getTeams().subscribe((t) => (this.teams = t));
  }

  createTeam() {
    this.teamService.createTeam(this.newTeamName.trim()).subscribe(() => {
      this.newTeamName = '';
      this.loadTeams();
    });
  }

  loadMembers(teamId: string) {
    this.selectedTeamId = teamId;
    this.teamService.getMembers(teamId).subscribe((m) => (this.members = m));
  }

  isOwner(team: Team): boolean {
    return team.createdBy === this.auth.currentUser()?.id;
  }

  sendInvite(teamId: string) {
    if (!this.inviteEmail.trim()) return;
    this.teamService.invite(teamId, this.inviteEmail.trim()).subscribe({
      next: (inv) => {
        this.inviteMessage = `Invite sent! Link: ${inv.inviteLink}`;
        this.inviteEmail = '';
        this.loadMembers(teamId);
      },
      error: (err) => {
        this.inviteMessage = err.error?.message || 'Failed to send invite';
      },
    });
  }

  copyLink(link: string) {
    navigator.clipboard.writeText(link);
    this.inviteMessage = 'Link copied to clipboard!';
  }

  removeMember(teamId: string, userId: string) {
    if (!confirm('Remove this member from the team?')) return;
    this.teamService.removeMember(teamId, userId).subscribe(() => this.loadMembers(teamId));
  }

  revokeInvite(teamId: string, inviteId: string) {
    this.teamService.revokeInvite(teamId, inviteId).subscribe(() => this.loadMembers(teamId));
  }

  reinvite(teamId: string, inviteId: string) {
    this.teamService.reinvite(teamId, inviteId).subscribe(() => this.loadMembers(teamId));
  }
}
