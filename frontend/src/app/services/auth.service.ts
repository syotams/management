import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';
import { ApiService } from './api.service';
import { AuthResponse, User } from '../models';
import { userTimeZone } from '../utils/date';

@Injectable({ providedIn: 'root' })
export class AuthService {
  currentUser = signal<User | null>(null);

  constructor(private api: ApiService, private router: Router) {
    const token = localStorage.getItem('token');
    if (token) {
      this.api.get<User>('/auth/me').subscribe({
        next: (user) => {
          this.currentUser.set(user);
          this.syncTimezone();
        },
        error: () => this.logout(),
      });
    }
  }

  register(email: string, password: string, name: string) {
    return this.api.postPublic<AuthResponse>('/auth/register', {
      email,
      password,
      name,
      timezone: userTimeZone(),
    }).pipe(
      tap((res) => this.setSession(res)),
    );
  }

  login(email: string, password: string) {
    return this.api.postPublic<AuthResponse>('/auth/login', {
      email,
      password,
      timezone: userTimeZone(),
    }).pipe(
      tap((res) => this.setSession(res)),
    );
  }

  logout() {
    localStorage.removeItem('token');
    this.currentUser.set(null);
    this.router.navigate(['/login']);
  }

  isLoggedIn(): boolean {
    return !!localStorage.getItem('token');
  }

  private setSession(res: AuthResponse) {
    localStorage.setItem('token', res.accessToken);
    this.currentUser.set(res.user);
  }

  private syncTimezone() {
    const timezone = userTimeZone();
    if (this.currentUser()?.timezone === timezone) return;
    this.api.patch<User>('/auth/me', { timezone }).subscribe({
      next: (user) => this.currentUser.set(user),
    });
  }
}
