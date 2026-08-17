import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink],
  template: `
    <nav class="navbar navbar-expand-lg app-navbar">
      <div class="container-fluid">
        <a class="navbar-brand" routerLink="/tasks">
          <i class="bi bi-check2-square me-2"></i>Task Manager
        </a>
        <div class="navbar-nav ms-auto flex-row gap-2 align-items-center">
          <button
            class="btn btn-theme-toggle"
            (click)="theme.toggle()"
            [title]="theme.current() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          >
            @if (theme.current() === 'dark') {
              <i class="bi bi-sun-fill"></i>
            } @else {
              <i class="bi bi-moon-fill"></i>
            }
          </button>
          @if (auth.currentUser()) {
            <a class="nav-link px-2" routerLink="/tasks">Tasks</a>
            <a class="nav-link px-2" routerLink="/teams">Teams</a>
            <span class="navbar-text px-2">{{ auth.currentUser()?.name }}</span>
            <button class="btn btn-outline-secondary btn-sm btn-logout" (click)="auth.logout()">Logout</button>
          }
        </div>
      </div>
    </nav>
  `,
})
export class NavbarComponent {
  constructor(
    public auth: AuthService,
    public theme: ThemeService,
  ) {}
}
