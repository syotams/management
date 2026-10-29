import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ProjectDetail, ProjectEpic, User } from '../../models';
import { ProjectService } from '../../services/project.service';
import { TeamService } from '../../services/team.service';
import { ProjectDetailComponent } from './project-detail.component';

const owner: User = {
  id: 'user-1',
  name: 'Owner',
  email: 'owner@test.com',
  emailNotifications: true,
  webNotifications: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const fullColor = '#4f46e5';
const partialColor = '#22c55e';

function epic(overrides: Partial<ProjectEpic> & Pick<ProjectEpic, 'id' | 'title' | 'workingDays'>): ProjectEpic {
  return {
    groupKey: null,
    sourceEpicId: null,
    priority: 0,
    startSprintNumber: null,
    startSprintWeek: null,
    backgroundColor: fullColor,
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
    endDate: '2026-01-18',
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
        id: owner.id,
        name: owner.name,
        email: owner.email,
        cells: {},
      },
    ],
    epics: [
      epic({
        id: 'epic-full',
        title: 'Full epic',
        workingDays: 5,
        priority: 2,
        backgroundColor: fullColor,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      epic({
        id: 'epic-full-copy',
        title: 'Full epic',
        workingDays: 5,
        sourceEpicId: 'epic-full',
        startSprintNumber: 1,
        startSprintWeek: 2,
        backgroundColor: fullColor,
        createdAt: '2026-01-02T00:00:00.000Z',
        assignees: [owner],
      }),
      epic({
        id: 'epic-partial',
        title: 'Partial epic',
        workingDays: 8,
        priority: 1,
        backgroundColor: partialColor,
        createdAt: '2026-01-03T00:00:00.000Z',
      }),
      epic({
        id: 'epic-partial-copy',
        title: 'Partial epic',
        workingDays: 3,
        sourceEpicId: 'epic-partial',
        startSprintNumber: 1,
        startSprintWeek: 2,
        backgroundColor: partialColor,
        createdAt: '2026-01-04T00:00:00.000Z',
        assignees: [owner],
      }),
    ],
    holidays: [],
    ptos: [],
  };
}

function themeColor(token: '--app-text-disabled'): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

function painted(value: string): string {
  const probe = document.createElement('span');
  probe.style.backgroundColor = value;
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return color;
}

describe('ProjectDetailComponent plus menu full epics', () => {
  let fixture: ComponentFixture<ProjectDetailComponent>;
  let projectService: jasmine.SpyObj<ProjectService>;
  let previousTheme: string | null;

  beforeEach(async () => {
    previousTheme = document.documentElement.getAttribute('data-bs-theme');
    document.documentElement.setAttribute('data-bs-theme', 'light');

    projectService = jasmine.createSpyObj<ProjectService>('ProjectService', ['assignEpic']);
    projectService.assignEpic.and.returnValue(of(project()));

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
    fixture.componentInstance.loading = false;
    fixture.componentInstance.project = project();
    fixture.detectChanges();
  });

  afterEach(() => {
    if (previousTheme == null) document.documentElement.removeAttribute('data-bs-theme');
    else document.documentElement.setAttribute('data-bs-theme', previousTheme);
  });

  function openPlusMenu() {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.addEventListener('click', (event) => {
      fixture.componentInstance.openCellAssignMenu(
        event,
        owner.id,
        'sprint-1',
        1,
        1,
        'sprint-1:w1',
        '2026-01-05',
      );
    });
    trigger.click();
    trigger.remove();
    fixture.detectChanges();
  }

  function menuButton(title: string): HTMLButtonElement {
    const button = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.cell-assign-menu .cell-assign-item',
      ) as NodeListOf<HTMLButtonElement>,
    ).find((el) => el.querySelector('.cell-assign-title')?.textContent?.trim() === title);
    if (!button) throw new Error(`Menu button for ${title} was not rendered`);
    return button;
  }

  it('grays and disables a fully assigned epic so it cannot be assigned', () => {
    openPlusMenu();

    const button = menuButton('Full epic');
    const swatch = button.querySelector('.cell-assign-swatch');
    const label = button.querySelector('.cell-assign-title');
    if (!(swatch instanceof HTMLElement) || !(label instanceof HTMLElement)) {
      throw new Error('Full epic swatch was not rendered');
    }
    const disabled = themeColor('--app-text-disabled');

    expect(button.disabled).toBeTrue();
    expect(button.classList.contains('cell-assign-item-full')).toBeTrue();
    expect(button.title).toBe('Full epic · 5/5d assigned');
    expect(swatch.style.background).toBe('');
    expect(getComputedStyle(button).opacity).toBe('1');
    expect(getComputedStyle(label).color).toBe(disabled);
    expect(getComputedStyle(swatch).backgroundColor).toBe(disabled);

    button.click();

    expect(projectService.assignEpic).not.toHaveBeenCalled();
  });

  it('keeps a partial epic enabled and colored', () => {
    openPlusMenu();

    const button = menuButton('Partial epic');
    const swatch = button.querySelector('.cell-assign-swatch');
    if (!(swatch instanceof HTMLElement)) {
      throw new Error('Partial epic swatch was not rendered');
    }

    expect(button.disabled).toBeFalse();
    expect(button.classList.contains('cell-assign-item-full')).toBeFalse();
    expect(button.title).toBe('Assign Partial epic');
    expect(getComputedStyle(swatch).backgroundColor).toBe(painted(partialColor));
  });
});
