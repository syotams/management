import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-container">
      <div class="card auth-card">
        <div class="card-body">
          <h2 class="card-title mb-4">Choose a new password</h2>
          @if (!token) {
            <div class="alert alert-danger">This reset link is invalid or has expired.</div>
          } @else {
            @if (error) {
              <div class="alert alert-danger">{{ error }}</div>
            }
            <form (ngSubmit)="onSubmit()">
              <div class="mb-3">
                <label class="form-label">New password</label>
                <input type="password" class="form-control" [(ngModel)]="password" name="password" required minlength="6" autocomplete="new-password">
              </div>
              <button type="submit" class="btn btn-primary w-100" [disabled]="loading">
                {{ loading ? 'Saving...' : 'Update password' }}
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
export class ResetPasswordComponent implements OnInit {
  token = '';
  password = '';
  error = '';
  loading = false;

  constructor(
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit() {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
  }

  onSubmit() {
    if (!this.token) return;
    this.loading = true;
    this.error = '';
    this.auth.resetPassword(this.token, this.password).subscribe({
      next: () => this.router.navigate(['/login'], { queryParams: { reset: '1' } }),
      error: (err) => {
        this.error = err.error?.message || 'Could not update password';
        this.loading = false;
      },
    });
  }
}
