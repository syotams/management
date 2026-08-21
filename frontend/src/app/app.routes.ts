import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'tasks', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent),
    canActivate: [guestGuard],
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/register/register.component').then(m => m.RegisterComponent),
    canActivate: [guestGuard],
  },
  {
    path: 'tasks',
    loadComponent: () => import('./pages/task-list/task-list.component').then(m => m.TaskListComponent),
    canActivate: [authGuard],
  },
  {
    path: 'tasks/:id',
    loadComponent: () => import('./pages/task-detail/task-detail.component').then(m => m.TaskDetailComponent),
    canActivate: [authGuard],
  },
  {
    path: 'teams',
    loadComponent: () => import('./pages/teams/teams.component').then(m => m.TeamsComponent),
    canActivate: [authGuard],
  },
  {
    path: 'quarters',
    loadComponent: () => import('./pages/quarters/quarters.component').then(m => m.QuartersComponent),
    canActivate: [authGuard],
  },
  {
    path: 'quarters/:id',
    loadComponent: () => import('./pages/quarter-detail/quarter-detail.component').then(m => m.QuarterDetailComponent),
    canActivate: [authGuard],
  },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings/settings.component').then(m => m.SettingsComponent),
    canActivate: [authGuard],
  },
  {
    path: 'invites/:token',
    loadComponent: () => import('./pages/invite-accept/invite-accept.component').then(m => m.InviteAcceptComponent),
  },
];
