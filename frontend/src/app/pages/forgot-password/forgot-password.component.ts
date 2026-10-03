import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-container">
      <div class="card auth-card">
        <div class="card-body">
          <h2 class="card-title mb-4">Forgot password</h2>
          @if (message) {
            <div class="alert alert-success">{{ message }}</div>
          }
          @if (error) {
            <div class="alert alert-danger">{{ error }}</div>
          }
          @if (!message) {
            <form (ngSubmit)="onSubmit()">
              <div class="mb-3">
                <label class="form-label">Email</label>
                <input type="email" class="form-control" [(ngModel)]="email" name="email" required>
              </div>
              <button type="submit" class="btn btn-primary w-100" [disabled]="loading">
                {{ loading ? 'Sending...' : 'Send reset link' }}
              </button>
            </form>
          }
          <p class="mt-3 mb-0 text-center">
            <a routerLink="/login">Back to login</a>
          </p>
        </div>
      </div>
    </div>
  `,
  styles: [`:host { display: block; }`],
})
export class ForgotPasswordComponent {
  email = '';
  message = '';
  error = '';
  loading = false;

  constructor(private auth: AuthService) {}

  onSubmit() {
    this.loading = true;
    this.error = '';
    this.auth.forgotPassword(this.email.trim()).subscribe({
      next: (res) => {
        this.message = res.message;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Could not send reset link';
        this.loading = false;
      },
    });
  }
}
