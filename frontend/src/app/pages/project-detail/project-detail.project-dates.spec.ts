import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ProjectService } from '../../services/project.service';
import { TeamService } from '../../services/team.service';
import { ProjectDetail, User } from '../../models';
import { ProjectDetailComponent } from './project-detail.component';

const owner: User = {
  id: 'user-1',
  name: 'Owner',
  email: 'owner@test.com',
  emailNotifications: true,
  webNotifications: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function sprint(number: number, startDate: string, endDate: string) {
  const id = `sprint-${number}`;
  return {
    id,
    number,
    startDate,
    endDate,
    workingDays: 10,
    weeks: ([1, 2] as const).map((week) => ({
      week,
      startDate,
      endDate,
      workingDays: 5,
      cellKey: `${id}:w${week}`,
    })),
  };
}

function project(): ProjectDetail {
  return {
    id: 'project-1',
    name: 'Plan',
    startDate: '2026-01-05',
    endDate: '2026-03-31',
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
    sprints: [
      sprint(1, '2026-01-05', '2026-01-18'),
      sprint(2, '2026-01-19', '2026-02-01'),
    ],
    participants: [{ id: owner.id, name: owner.name, email: owner.email, cells: {} }],
    epics: [],
    holidays: [],
    ptos: [],
  };
}

describe('ProjectDetailComponent project dates', () => {
  let fixture: ComponentFixture<ProjectDetailComponent>;

  beforeEach(async () => {
    const projectService = jasmine.createSpyObj<ProjectService>('ProjectService', ['getProject']);
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

  it('shows a read-only end date set from the start date in the edit form', () => {
    const component = fixture.componentInstance;
    component.openEdit();
    fixture.detectChanges();

    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[name="editEndDate"]',
    );
    expect(input?.readOnly).toBeTrue();
    expect(component.editEndDate).toBe('2026-03-31');

    component.editStartDate = '2026-02-10';
    component.onEditStartDateChange();
    expect(component.editEndDate).toBe('2026-04-30');
  });

  it('limits PTO and holiday dates to the end of the last sprint', () => {
    const component = fixture.componentInstance;

    expect(component.projectDateMax).toBe('2026-02-01');

    component.openAddHoliday();
    component.holidayStartDate = '2026-02-02';
    component.holidayEndDate = '2026-02-02';
    expect(component.canAddHoliday()).toBeFalse();

    component.holidayStartDate = '2026-02-01';
    component.holidayEndDate = '2026-02-01';
    expect(component.canAddHoliday()).toBeTrue();
  });
});
