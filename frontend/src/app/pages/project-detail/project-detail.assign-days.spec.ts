import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ProjectService } from '../../services/project.service';
import { TeamService } from '../../services/team.service';
import { GridChip, ProjectDetail, ProjectEpic, User } from '../../models';
import { ProjectDetailComponent } from './project-detail.component';

const owner: User = {
  id: 'user-1',
  name: 'Owner',
  email: 'owner@test.com',
  emailNotifications: true,
  webNotifications: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function sprint(number: number) {
  const id = `sprint-${number}`;
  return {
    id,
    number,
    startDate: '2026-01-05',
    endDate: '2026-01-18',
    workingDays: 10,
    weeks: ([1, 2] as const).map((week) => ({
      week,
      startDate: '2026-01-05',
      endDate: '2026-01-11',
      workingDays: 5,
      cellKey: `${id}:w${week}`,
    })),
  };
}

function epic(workingDays: number): ProjectEpic {
  return {
    id: 'epic-1',
    groupKey: null,
    sourceEpicId: null,
    title: 'Auth',
    workingDays,
    startSprintNumber: null,
    startSprintWeek: null,
    backgroundColor: '#4f46e5',
    createdAt: '2026-01-01T00:00:00.000Z',
    assignees: [],
  };
}

function project(workingDays: number, sprintOneDays = 0): ProjectDetail {
  const sprints = [sprint(1), sprint(2), sprint(3)];
  const chips: GridChip[] =
    sprintOneDays > 0
      ? [
          {
            type: 'epic',
            id: 'other-epic',
            title: 'Other',
            backgroundColor: '#22c55e',
            daysInSprint: sprintOneDays,
          },
        ]
      : [];
  return {
    id: 'project-1',
    name: 'Plan',
    startDate: '2026-01-05',
    endDate: '2026-03-01',
    maxWorkingDaysPerSprint: 8,
    teamId: null,
    status: 'draft',
    createdBy: owner.id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    team: null,
    teams: [],
    addedParticipants: [],
    versionCount: 0,
    currentVersion: null,
    sprints,
    participants: [
      {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        cells: { [`${sprints[0].id}:w1`]: chips },
      },
    ],
    epics: [epic(workingDays)],
    holidays: [],
    ptos: [],
  };
}

describe('ProjectDetailComponent assign days popup', () => {
  let fixture: ComponentFixture<ProjectDetailComponent>;
  let projectService: jasmine.SpyObj<ProjectService>;

  beforeEach(async () => {
    projectService = jasmine.createSpyObj<ProjectService>('ProjectService', ['assignEpic']);
    projectService.assignEpic.and.returnValue(of(project(15)));

    const teamService = jasmine.createSpyObj<TeamService>('TeamService', [
      'getTeams',
      'getAssignableMembers',
    ]);
    teamService.getTeams.and.returnValue(of([]));
    teamService.getAssignableMembers.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [ProjectDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ProjectService, useValue: projectService },
        { provide: TeamService, useValue: teamService },
        { provide: AuthService, useValue: { currentUser: signal(owner) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();
  });

  function drop(workingDays: number, sprintOneDays = 0) {
    fixture.componentInstance.project = project(workingDays, sprintOneDays);
    fixture.componentInstance.assignBacklogEpicToCell('epic-1', {
      participantId: owner.id,
      sprintId: 'sprint-1',
      week: 1,
      cellKey: 'sprint-1:w1',
    });
  }

  it('assigns a two-sprint epic without asking for days', () => {
    drop(15);

    expect(fixture.componentInstance.showAssignDays).toBeFalse();
    expect(projectService.assignEpic).toHaveBeenCalledOnceWith(
      'project-1',
      'epic-1',
      owner.id,
      1,
      1,
      undefined,
    );
  });

  it('asks for days when the epic reaches a third sprint and sends the confirmed amount', () => {
    drop(17);

    expect(fixture.componentInstance.showAssignDays).toBeTrue();
    expect(projectService.assignEpic).not.toHaveBeenCalled();

    fixture.componentInstance.assignDaysValue = 7;
    fixture.componentInstance.confirmAssignDays();

    expect(fixture.componentInstance.showAssignDays).toBeFalse();
    expect(projectService.assignEpic).toHaveBeenCalledOnceWith(
      'project-1',
      'epic-1',
      owner.id,
      1,
      1,
      7,
    );
  });

  it('writes nothing when the day popup is cancelled', () => {
    drop(17);
    fixture.componentInstance.cancelAssignDays();

    expect(fixture.componentInstance.showAssignDays).toBeFalse();
    expect(projectService.assignEpic).not.toHaveBeenCalled();
  });

  it('asks for days when the sprint already has 6 days and the remainder reaches a third sprint', () => {
    drop(15, 6);

    expect(fixture.componentInstance.showAssignDays).toBeTrue();
    expect(projectService.assignEpic).not.toHaveBeenCalled();
  });
});
