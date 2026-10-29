import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ProjectService } from '../../services/project.service';
import { TeamService } from '../../services/team.service';
import { ProjectDetail, User } from '../../models';
import { ProjectDetailComponent } from './project-detail.component';

const STORAGE_KEY = 'project-plan-show-detail-metrics';

const viewer: User = {
  id: 'viewer',
  name: 'Viewer',
  email: 'viewer@test.com',
  emailNotifications: true,
  webNotifications: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

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
        id: viewer.id,
        name: viewer.name,
        email: viewer.email,
        cells: {},
      },
    ],
    epics: [
      {
        id: 'epic-1',
        groupKey: null,
        sourceEpicId: null,
        title: 'Backlog epic',
        workingDays: 6,
        priority: 0,
        startSprintNumber: null,
        startSprintWeek: null,
        backgroundColor: '#4f46e5',
        createdAt: '2026-01-01T00:00:00.000Z',
        assignees: [],
      },
    ],
    holidays: [
      {
        id: 'holiday-1',
        groupKey: 'holiday-1',
        name: 'New Year',
        startDate: '2026-01-01',
        endDate: '2026-01-01',
        workingDays: 2,
      },
    ],
    ptos: [],
    capacity: [
      {
        userId: viewer.id,
        name: viewer.name,
        ptoDays: 3,
        holidayDays: 2,
        totalCapacity: 10,
        sprintCapacity: 10,
        epicDaysAssigned: 4,
      },
    ],
  };
}

describe('ProjectDetailComponent detail metrics', () => {
  let fixture: ComponentFixture<ProjectDetailComponent>;

  beforeEach(async () => {
    localStorage.removeItem(STORAGE_KEY);

    const teamService = jasmine.createSpyObj<TeamService>('TeamService', ['getTeams']);
    teamService.getTeams.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [ProjectDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ProjectService, useValue: jasmine.createSpyObj('ProjectService', ['getProject']) },
        { provide: TeamService, useValue: teamService },
        { provide: AuthService, useValue: { currentUser: signal(viewer) } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  function mount(): ComponentFixture<ProjectDetailComponent> {
    fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();
    fixture.componentInstance.loading = false;
    fixture.componentInstance.project = project();
    fixture.detectChanges();
    return fixture;
  }

  function row(): HTMLElement {
    const metrics = fixture.nativeElement.querySelector('.project-metrics');
    if (!(metrics instanceof HTMLElement)) throw new Error('metrics row was not rendered');
    return metrics;
  }

  function toggle(): HTMLButtonElement {
    const button = row().querySelector('.metric-toggle');
    if (!(button instanceof HTMLButtonElement)) throw new Error('metrics toggle was not rendered');
    return button;
  }

  function extraSlots(): HTMLElement[] {
    return Array.from(row().querySelectorAll('.metric-slot-extra'));
  }

  function metricText(slot: Element): string {
    const label = slot.querySelector('.stat-label')?.textContent?.trim();
    const value = slot.querySelector('.stat-value')?.textContent?.trim();
    return `${label} ${value}`;
  }

  it('hides working days, PTO, and holidays until the user opens them', () => {
    mount();

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(row().classList.contains('is-open')).toBeFalse();
    expect(extraSlots().map(metricText)).toEqual([
      'Total working days 8d',
      'Total PTO 3d',
      'Total holidays 2d',
    ]);
    for (const slot of extraSlots()) {
      expect(slot.getAttribute('aria-hidden')).toBe('true');
      expect(slot.getBoundingClientRect().height).toBe(0);
    }
    expect(row().textContent).toContain('Total capacity');
    expect(row().textContent).toContain('Assigned');
    expect(row().textContent).toContain('Backlog');
  });

  it('keeps an opened row open the next time the page loads', () => {
    mount();
    toggle().click();
    fixture.detectChanges();

    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(row().classList.contains('is-open')).toBeTrue();
    for (const slot of extraSlots()) {
      expect(slot.getAttribute('aria-hidden')).toBe('false');
      expect(slot.getBoundingClientRect().height).toBeGreaterThan(0);
    }

    fixture.destroy();
    mount();

    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(row().classList.contains('is-open')).toBeTrue();
    for (const slot of extraSlots()) {
      expect(slot.getBoundingClientRect().height).toBeGreaterThan(0);
    }
  });

  it('keeps a closed row closed the next time the page loads', () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    mount();
    toggle().click();
    fixture.detectChanges();

    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(row().classList.contains('is-open')).toBeFalse();
    for (const slot of extraSlots()) {
      expect(slot.getBoundingClientRect().height).toBe(0);
    }

    fixture.destroy();
    mount();

    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(row().classList.contains('is-open')).toBeFalse();
    for (const slot of extraSlots()) {
      expect(slot.getBoundingClientRect().height).toBe(0);
    }
  });
});
