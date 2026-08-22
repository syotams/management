import { Component, HostListener } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="navbar navbar-expand-lg app-navbar">
      <div class="container-fluid">
        <a class="navbar-brand" routerLink="/tasks">
          <i class="bi bi-check2-square me-2"></i>Task Manager
        </a>
        <div class="navbar-nav ms-auto flex-row gap-2 align-items-center">
          @if (auth.currentUser()) {
            <a class="nav-link px-2" routerLink="/tasks" routerLinkActive="active">Tasks</a>
            <a class="nav-link px-2" routerLink="/projects" routerLinkActive="active">Projects</a>
            <a class="nav-link px-2" routerLink="/teams" routerLinkActive="active">Teams</a>
            <div class="dropdown user-menu">
              <button
                class="btn btn-user-menu dropdown-toggle"
                type="button"
                (click)="toggleUserMenu($event)"
                [attr.aria-expanded]="userMenuOpen"
              >
                <i class="bi bi-person-circle me-1"></i>
                {{ auth.currentUser()?.name }}
              </button>
              @if (userMenuOpen) {
                <ul class="dropdown-menu dropdown-menu-end show" (click)="$event.stopPropagation()">
                  <li>
                    <button class="dropdown-item" type="button" (click)="theme.toggle()">
                      @if (theme.isDark()) {
                        <i class="bi bi-sun-fill me-2"></i>Light mode
                      } @else {
                        <i class="bi bi-moon-fill me-2"></i>Dark mode
                      }
                    </button>
                  </li>
                  <li>
                    <a class="dropdown-item" routerLink="/settings" (click)="closeUserMenu()">
                      <i class="bi bi-gear me-2"></i>Settings
                    </a>
                  </li>
                  <li><hr class="dropdown-divider"></li>
                  <li>
                    <button class="dropdown-item" type="button" (click)="logout()">
                      <i class="bi bi-box-arrow-right me-2"></i>Logout
                    </button>
                  </li>
                </ul>
              }
            </div>
          } @else {
            <button
              class="btn btn-theme-toggle"
              (click)="theme.toggle()"
              [title]="theme.isDark() ? 'Switch to light mode' : 'Switch to dark mode'"
            >
              @if (theme.isDark()) {
                <i class="bi bi-sun-fill"></i>
              } @else {
                <i class="bi bi-moon-fill"></i>
              }
            </button>
          }
        </div>
      </div>
    </nav>
  `,
})
export class NavbarComponent {
  userMenuOpen = false;

  constructor(
    public auth: AuthService,
    public theme: ThemeService,
  ) {}

  @HostListener('document:click')
  onDocumentClick() {
    this.userMenuOpen = false;
  }

  toggleUserMenu(event: Event) {
    event.stopPropagation();
    this.userMenuOpen = !this.userMenuOpen;
  }

  closeUserMenu() {
    this.userMenuOpen = false;
  }

  logout() {
    this.closeUserMenu();
    this.auth.logout();
  }
}
