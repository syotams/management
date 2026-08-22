import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TeamService } from '../../services/team.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-invite-accept',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="py-5">
      <div class="card mx-auto" style="max-width: 500px">
        <div class="card-body text-center">
          @if (loading) {
            <div class="spinner-border"></div>
          } @else if (error) {
            <div class="alert alert-danger">{{ error }}</div>
            <a routerLink="/teams" class="btn btn-primary">Go to Teams</a>
          } @else if (inviteInfo) {
            <h4>Team Invitation</h4>
            <p>You've been invited to join <strong>{{ inviteInfo.teamName }}</strong></p>
            <p class="text-muted">For: {{ inviteInfo.email }}</p>
            @if (inviteInfo.status === 'expired') {
              <div class="alert alert-warning">This invitation has expired.</div>
            } @else if (inviteInfo.status === 'declined') {
              <div class="alert alert-secondary">This invitation was declined.</div>
              <a routerLink="/teams" class="btn btn-primary">Go to Teams</a>
            } @else if (inviteInfo.status === 'accepted') {
              <div class="alert alert-success">This invitation was already accepted.</div>
              <a routerLink="/teams" class="btn btn-primary">Go to Teams</a>
            } @else if (!auth.isLoggedIn()) {
              <p>Please log in or register with <strong>{{ inviteInfo.email }}</strong> to accept.</p>
              <p class="text-muted small">After signing in, you can also accept or deny from the Teams page.</p>
              <a [routerLink]="['/login']" [queryParams]="authQueryParams" class="btn btn-primary me-2">Login</a>
              <a [routerLink]="['/register']" [queryParams]="authQueryParams" class="btn btn-outline-primary">Register</a>
            } @else {
              <button class="btn btn-success me-2" (click)="accept()" [disabled]="responding">
                {{ responding ? 'Working...' : 'Accept Invitation' }}
              </button>
              <button class="btn btn-outline-danger" (click)="deny()" [disabled]="responding">
                Deny
              </button>
            }
          }
        </div>
      </div>
    </div>
  `,
})
export class InviteAcceptComponent implements OnInit {
  loading = true;
  error = '';
  inviteInfo: { email: string; teamName: string; status: string } | null = null;
  responding = false;
  private token = '';

  get authQueryParams() {
    return {
      returnUrl: '/teams',
      email: this.inviteInfo?.email || '',
    };
  }

  constructor(
    private route: ActivatedRoute,
    private teamService: TeamService,
    public auth: AuthService,
    private router: Router,
  ) {}

  ngOnInit() {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    this.teamService.getInviteInfo(this.token).subscribe({
      next: (info) => {
        this.inviteInfo = info;
        this.loading = false;
      },
      error: () => {
        this.error = 'Invalid or expired invitation link';
        this.loading = false;
      },
    });
  }

  accept() {
    this.responding = true;
    this.teamService.acceptInvite(this.token).subscribe({
      next: () => {
        this.router.navigate(['/teams']);
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to accept invitation';
        this.responding = false;
      },
    });
  }

  deny() {
    if (!confirm('Decline this invitation?')) return;
    this.responding = true;
    this.teamService.denyInvite(this.token).subscribe({
      next: () => {
        this.router.navigate(['/teams']);
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to decline invitation';
        this.responding = false;
      },
    });
  }
}
