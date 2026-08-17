import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink],
  template: `
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
      <div class="container-fluid">
        <a class="navbar-brand" routerLink="/tasks">Task Manager</a>
        <div class="navbar-nav ms-auto flex-row gap-3 align-items-center">
          @if (auth.currentUser()) {
            <a class="nav-link text-white" routerLink="/tasks">Tasks</a>
            <a class="nav-link text-white" routerLink="/teams">Teams</a>
            <span class="navbar-text text-white-50">{{ auth.currentUser()?.email }}</span>
            <button class="btn btn-outline-light btn-sm" (click)="auth.logout()">Logout</button>
          }
        </div>
      </div>
    </nav>
  `,
})
export class NavbarComponent {
  constructor(public auth: AuthService) {}
}
