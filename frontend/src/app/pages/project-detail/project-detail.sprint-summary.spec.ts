import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ProjectDetail, SprintUserSummary, User } from '../../models';
import { ProjectService } from '../../services/project.service';
import { TeamService } from '../../services/team.service';
import { ProjectDetailComponent } from './project-detail.component';

const viewer: User = {
  id: 'viewer',
  name: 'Viewer',
  email: 'viewer@test.com',
  emailNotifications: true,
  webNotifications: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function summaryUser(
  name: string,
  committedDays: number,
  totalCapacity: number,
): SprintUserSummary {
  return {
    userId: name.toLowerCase(),
    name,
    offlineDays: 0,
    ptoDays: 0,
    holidayDays: 0,
    committedDays,
    totalCapacity,
  };
}

function project(): ProjectDetail {
  return {
    id: 'project-1',
    name: 'Plan',
    startDate: '2026-01-05',
    endDate: '2026-01-18',
    maxWorkingDaysPerSprint: 8,
    teamId: null,
    status: 'draft',
    createdBy: 'manager',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    team: null,
    teams: [],
    addedParticipants: [],
    versionCount: 0,
    currentVersion: null,
    sprints: [
      {
        id: 'sprint-1',
        number: 1,
        startDate: '2026-01-05',
        endDate: '2026-01-18',
        workingDays: 10,
        weeks: [
          {
            week: 1,
            startDate: '2026-01-05',
            endDate: '2026-01-11',
            workingDays: 5,
            cellKey: 'sprint-1:w1',
          },
          {
            week: 2,
            startDate: '2026-01-12',
            endDate: '2026-01-18',
            workingDays: 5,
            cellKey: 'sprint-1:w2',
          },
        ],
      },
    ],
    participants: [
      {
        id: 'viewer',
        name: 'Viewer',
        email: 'viewer@test.com',
        cells: {},
      },
    ],
    epics: [],
    holidays: [],
    ptos: [],
    capacity: [],
    sprintSummaries: [
      {
        sprintId: 'sprint-1',
        sprintNumber: 1,
        users: [
          summaryUser('At capacity', 8, 8),
          summaryUser('Over capacity', 9, 8),
          summaryUser('Under capacity', 3, 8),
          summaryUser('No days', 0, 0),
        ],
      },
    ],
  };
}

function themeColor(token: '--app-success' | '--app-error'): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

describe('ProjectDetailComponent sprint summary assigned color', () => {
  let fixture: ComponentFixture<ProjectDetailComponent>;
  let previousTheme: string | null;

  beforeEach(async () => {
    previousTheme = document.documentElement.getAttribute('data-bs-theme');
    document.documentElement.setAttribute('data-bs-theme', 'light');

    const projectService = jasmine.createSpyObj<ProjectService>('ProjectService', ['getProject']);
    const teamService = jasmine.createSpyObj<TeamService>('TeamService', ['getTeams']);
    teamService.getTeams.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [ProjectDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ProjectService, useValue: projectService },
        { provide: TeamService, useValue: teamService },
        { provide: AuthService, useValue: { currentUser: signal(viewer) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();
    fixture.componentInstance.loading = false;
    fixture.componentInstance.project = project();
    fixture.detectChanges();
  });

  afterEach(() => {
    if (previousTheme == null) document.documentElement.removeAttribute('data-bs-theme');
    else document.documentElement.setAttribute('data-bs-theme', previousTheme);
  });

  function assignedCell(name: string): HTMLElement {
    const header = Array.from(
      fixture.nativeElement.querySelectorAll('.card-header') as NodeListOf<HTMLElement>,
    ).find((el) => el.textContent?.includes('Sprint summary'));
    const table = header?.closest('.card')?.querySelector('table');
    const row = Array.from(table?.querySelectorAll('tbody tr') ?? []).find((tr) =>
      tr.textContent?.includes(name),
    );
    const cells = row?.querySelectorAll('td') ?? [];
    const cell = cells[cells.length - 1];
    if (!(cell instanceof HTMLElement)) {
      throw new Error(`Assigned cell for ${name} was not rendered`);
    }
    return cell;
  }

  it('uses theme green when assigned equals capacity', () => {
    const cell = assignedCell('At capacity');

    expect(cell.classList.contains('tone-match')).toBeTrue();
    expect(cell.classList.contains('tone-over')).toBeFalse();
    expect(getComputedStyle(cell).color).toBe(themeColor('--app-success'));
  });

  it('uses theme green when assigned and capacity are both zero', () => {
    const cell = assignedCell('No days');

    expect(cell.classList.contains('tone-match')).toBeTrue();
    expect(getComputedStyle(cell).color).toBe(themeColor('--app-success'));
  });

  it('uses theme red when assigned is above capacity', () => {
    const cell = assignedCell('Over capacity');

    expect(cell.classList.contains('tone-over')).toBeTrue();
    expect(cell.classList.contains('tone-match')).toBeFalse();
    expect(getComputedStyle(cell).color).toBe(themeColor('--app-error'));
  });

  it('caps the summary height and scrolls the rows', () => {
    const summary = fixture.componentInstance.project?.sprintSummaries?.[0];
    if (!summary) throw new Error('Sprint summary was not rendered');
    summary.users = Array.from({ length: 30 }, (_, index) =>
      summaryUser(`Person ${index}`, 1, 8),
    );
    fixture.detectChanges();

    const header = Array.from(
      fixture.nativeElement.querySelectorAll('.card-header') as NodeListOf<HTMLElement>,
    ).find((el) => el.textContent?.includes('Sprint summary'));
    const scroller = header?.closest('.card')?.querySelector('.sprint-summary-scroll');
    if (!(scroller instanceof HTMLElement)) {
      throw new Error('Sprint summary scroller was not rendered');
    }

    const style = getComputedStyle(scroller);
    expect(style.maxHeight).toBe('320px');
    expect(style.overflowY).toBe('auto');
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
  });

  it('keeps the default text color when assigned is under capacity', () => {
    const cell = assignedCell('Under capacity');

    expect(cell.classList.contains('tone-match')).toBeFalse();
    expect(cell.classList.contains('tone-over')).toBeFalse();
    expect(getComputedStyle(cell).color).not.toBe(themeColor('--app-success'));
    expect(getComputedStyle(cell).color).not.toBe(themeColor('--app-error'));
  });
});
