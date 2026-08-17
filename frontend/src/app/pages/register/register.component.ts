import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-container">
      <div class="card auth-card">
        <div class="card-body">
          <h2 class="card-title mb-4">Register</h2>
          @if (error) {
            <div class="alert alert-danger">{{ error }}</div>
          }
          <form (ngSubmit)="onSubmit()">
            <div class="mb-3">
              <label class="form-label">Username</label>
              <input type="text" class="form-control" [(ngModel)]="name" name="name" required minlength="3" pattern="[a-zA-Z0-9_-]+">
              <small class="text-muted">Letters, numbers, underscores and hyphens only</small>
            </div>
            <div class="mb-3">
              <label class="form-label">Email</label>
              <input type="email" class="form-control" [(ngModel)]="email" name="email" required>
            </div>
            <div class="mb-3">
              <label class="form-label">Password</label>
              <input type="password" class="form-control" [(ngModel)]="password" name="password" required minlength="6">
            </div>
            <button type="submit" class="btn btn-primary w-100" [disabled]="loading">
              {{ loading ? 'Creating account...' : 'Register' }}
            </button>
          </form>
          <p class="mt-3 mb-0 text-center">
            Already have an account? <a routerLink="/login">Login</a>
          </p>
        </div>
      </div>
    </div>
  `,
  styles: [`:host { display: block; }`],
})
export class RegisterComponent {
  name = '';
  email = '';
  password = '';
  error = '';
  loading = false;

  constructor(private auth: AuthService, private router: Router) {}

  onSubmit() {
    this.loading = true;
    this.error = '';
    this.auth.register(this.email, this.password, this.name).subscribe({
      next: () => this.router.navigate(['/tasks']),
      error: (err) => {
        this.error = err.error?.message || 'Registration failed';
        this.loading = false;
      },
    });
  }
}
