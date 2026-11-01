import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ProjectService } from '../../services/project.service';
import { TeamService } from '../../services/team.service';
import { ProjectDetail, ProjectEpic, User } from '../../models';
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

function epic(overrides: Partial<ProjectEpic> = {}): ProjectEpic {
  return {
    id: 'epic-1',
    groupKey: null,
    sourceEpicId: null,
    title: 'Auth',
    workingDays: 5,
    priority: 0,
    startSprintNumber: null,
    startSprintWeek: null,
    backgroundColor: '#4f46e5',
    createdAt: '2026-01-01T00:00:00.000Z',
    assignees: [],
    ...overrides,
  };
}

function project(): ProjectDetail {
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
    sprints: [sprint(1), sprint(2), sprint(3)],
    participants: [
      {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        cells: {},
      },
    ],
    epics: [
      epic(),
      epic({
        id: 'assignment-1',
        sourceEpicId: 'epic-1',
        startSprintNumber: 1,
        startSprintWeek: 1,
        assignees: [owner],
      }),
    ],
    holidays: [],
    ptos: [],
  };
}

describe('ProjectDetailComponent repeat assignment', () => {
  let fixture: ComponentFixture<ProjectDetailComponent>;
  let projectService: jasmine.SpyObj<ProjectService>;

  beforeEach(async () => {
    projectService = jasmine.createSpyObj<ProjectService>('ProjectService', ['updateEpic']);
    projectService.updateEpic.and.returnValue(of(project()));

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
    fixture.componentInstance.project = project();
    fixture.detectChanges();
  });

  function repeatInputs(): { every: HTMLInputElement | null; count: HTMLInputElement | null } {
    const root = fixture.nativeElement as HTMLElement;
    return {
      every: root.querySelector('input[name="editRepeatEveryWeeks"]'),
      count: root.querySelector('input[name="editRepeatCount"]'),
    };
  }

  it('renders empty repeat fields when editing an assignment', () => {
    fixture.componentInstance.openEditEpic('assignment-1');
    fixture.detectChanges();

    const inputs = repeatInputs();
    expect(inputs.every).not.toBeNull();
    expect(inputs.count).not.toBeNull();
    expect(inputs.every!.value).toBe('');
    expect(inputs.count!.value).toBe('');
    expect(inputs.every!.min).toBe('1');
    expect(inputs.count!.min).toBe('2');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      "removes this person's other assignments of the epic",
    );
  });

  it('hides repeat fields when editing a backlog epic', () => {
    fixture.componentInstance.openEditEpic('epic-1');
    fixture.detectChanges();

    const inputs = repeatInputs();
    expect(inputs.every).toBeNull();
    expect(inputs.count).toBeNull();
  });

  it('sends both repeat values when saving a filled assignment repeat', () => {
    fixture.componentInstance.openEditEpic('assignment-1');
    fixture.componentInstance.editRepeatEveryWeeks = 2;
    fixture.componentInstance.editRepeatCount = 3;
    fixture.componentInstance.saveEditEpic();

    expect(projectService.updateEpic).toHaveBeenCalledOnceWith('project-1', 'assignment-1', {
      workingDays: 5,
      repeatEveryWeeks: 2,
      repeatCount: 3,
    });
  });
});
