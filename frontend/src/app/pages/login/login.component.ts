import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-container">
      <div class="card auth-card">
        <div class="card-body">
          <h2 class="card-title mb-4">Login</h2>
          @if (error) {
            <div class="alert alert-danger">{{ error }}</div>
          }
          <form (ngSubmit)="onSubmit()">
            <div class="mb-3">
              <label class="form-label">Email</label>
              <input type="email" class="form-control" [(ngModel)]="email" name="email" required>
            </div>
            <div class="mb-3">
              <label class="form-label">Password</label>
              <input type="password" class="form-control" [(ngModel)]="password" name="password" required>
            </div>
            <button type="submit" class="btn btn-primary w-100" [disabled]="loading">
              {{ loading ? 'Logging in...' : 'Login' }}
            </button>
          </form>
          <p class="mt-3 mb-0 text-center">
            Don't have an account? <a routerLink="/register">Register</a>
          </p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .auth-container { display: flex; justify-content: center; align-items: center; min-height: 80vh; }
    .auth-card { width: 100%; max-width: 400px; }
  `],
})
export class LoginComponent {
  email = '';
  password = '';
  error = '';
  loading = false;

  constructor(private auth: AuthService, private router: Router) {}

  onSubmit() {
    this.loading = true;
    this.error = '';
    this.auth.login(this.email, this.password).subscribe({
      next: () => this.router.navigate(['/tasks']),
      error: (err) => {
        this.error = err.error?.message || 'Login failed';
        this.loading = false;
      },
    });
  }
}
