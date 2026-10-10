import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TeamsComponent } from './teams.component';
import { TeamService } from '../../services/team.service';
import { AuthService } from '../../services/auth.service';
import { Team, TeamMember, User } from '../../models';

function user(id: string, name: string, email: string): User {
  return { id, name, email, emailNotifications: true, webNotifications: true, createdAt: '2026-01-01T00:00:00Z' };
}

describe('TeamsComponent members table', () => {
  let fixture: ComponentFixture<TeamsComponent>;

  const owner = user('u-owner', 'team_owner', 'owner@test.com');
  const joiner = user('u-joiner', 'team_joiner', 'joiner@test.com');
  const team: Team = { id: 't1', name: 'Platform', createdBy: owner.id, createdAt: '2026-01-01T00:00:00Z' };
  const members: TeamMember[] = [
    { id: 'm1', teamId: team.id, userId: owner.id, role: 'owner', user: owner },
    { id: 'm2', teamId: team.id, userId: joiner.id, role: 'member', user: joiner },
  ];

  beforeEach(async () => {
    const teamService = jasmine.createSpyObj<TeamService>('TeamService', [
      'getTeams',
      'getMembers',
      'getMyPendingInvites',
    ]);
    teamService.getTeams.and.returnValue(of([team]));
    teamService.getMembers.and.returnValue(of({ members, invites: [] }));
    teamService.getMyPendingInvites.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [TeamsComponent],
      providers: [
        { provide: TeamService, useValue: teamService },
        { provide: AuthService, useValue: { currentUser: signal(owner) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TeamsComponent);
    fixture.detectChanges();
  });

  it('shows name, email and role columns for each joined member', () => {
    const table: HTMLTableElement = fixture.nativeElement.querySelector('table.members-table');
    expect(table).withContext('members table should render').not.toBeNull();

    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent?.trim());
    expect(headers).toEqual(['Name', 'Email', 'Role', 'Actions']);

    const rows = Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td'))
        .slice(0, 3)
        .map((td) => td.textContent?.trim()),
    );
    expect(rows).toEqual([
      ['team_owner', 'owner@test.com', 'owner'],
      ['team_joiner', 'joiner@test.com', 'member'],
    ]);
  });
});
