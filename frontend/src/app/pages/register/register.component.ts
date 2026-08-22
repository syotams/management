import { Component, OnInit, isDevMode } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
          <form (ngSubmit)="onSubmit()" [attr.autocomplete]="autocomplete">
            <div class="mb-3">
              <label class="form-label">Username</label>
              <input
                type="text"
                class="form-control"
                [(ngModel)]="name"
                name="name"
                required
                minlength="3"
                pattern="[a-zA-Z0-9_-]+"
                [attr.autocomplete]="autocomplete"
              >
              <small class="text-muted">Letters, numbers, underscores and hyphens only</small>
            </div>
            <div class="mb-3">
              <label class="form-label">Email</label>
              <input
                type="email"
                class="form-control"
                [(ngModel)]="email"
                name="email"
                required
                [attr.autocomplete]="allowAutofill ? 'email' : 'off'"
              >
            </div>
            <div class="mb-3">
              <label class="form-label">Password</label>
              <input
                type="password"
                class="form-control"
                [(ngModel)]="password"
                name="password"
                required
                minlength="6"
                [attr.autocomplete]="allowAutofill ? 'new-password' : 'off'"
              >
            </div>
            <button type="submit" class="btn btn-primary w-100" [disabled]="loading">
              {{ loading ? 'Creating account...' : 'Register' }}
            </button>
          </form>
          <p class="mt-3 mb-0 text-center">
            Already have an account? <a [routerLink]="['/login']" [queryParams]="loginQueryParams">Login</a>
          </p>
        </div>
      </div>
    </div>
  `,
  styles: [`:host { display: block; }`],
})
export class RegisterComponent implements OnInit {
  name = '';
  email = '';
  password = '';
  error = '';
  loading = false;
  readonly allowAutofill = isDevMode();
  readonly autocomplete = this.allowAutofill ? 'on' : 'off';
  private returnUrl = '/tasks';

  get loginQueryParams() {
    const params: Record<string, string> = {};
    if (this.returnUrl && this.returnUrl !== '/tasks') params['returnUrl'] = this.returnUrl;
    if (this.email) params['email'] = this.email;
    return params;
  }

  constructor(
    private auth: AuthService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  ngOnInit() {
    const q = this.route.snapshot.queryParamMap;
    const raw = q.get('returnUrl') || '/tasks';
    this.returnUrl = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/tasks';
    this.email = q.get('email') || '';
  }

  onSubmit() {
    this.loading = true;
    this.error = '';
    this.auth.register(this.email, this.password, this.name).subscribe({
      next: () => this.router.navigateByUrl(this.returnUrl),
      error: (err) => {
        this.error = err.error?.message || 'Registration failed';
        this.loading = false;
      },
    });
  }
}
