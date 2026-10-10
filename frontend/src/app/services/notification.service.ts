import { Injectable, NgZone, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { AppNotification } from '../models';

export type BrowserNotificationPermission = NotificationPermission | 'unsupported';

const POLL_INTERVAL_MS = 30000;
const POPUP_MAX_AGE_MS = 120000;

@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly unreadCount = signal(0);
  private shownPopups = new Set<string>();
  private polling = false;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private router: Router,
    private zone: NgZone,
  ) {}

  browserPermission(): BrowserNotificationPermission {
    return 'Notification' in window ? Notification.permission : 'unsupported';
  }

  async requestPermission(): Promise<BrowserNotificationPermission> {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    return this.browserPermission();
  }

  /** Safe to call repeatedly (e.g. on each login); only one interval is ever created. */
  startPolling() {
    if (!this.polling) {
      this.polling = true;
      setInterval(() => this.refresh(), POLL_INTERVAL_MS);
    }
    if (this.webNotificationsEnabled()) this.requestPermission();
    this.refresh();
  }

  refresh() {
    if (!this.auth.isLoggedIn()) {
      this.unreadCount.set(0);
      return;
    }
    this.api.get<{ count: number; items: AppNotification[] }>('/notifications/unread').subscribe({
      next: ({ count, items }) => {
        this.unreadCount.set(count);
        this.showPopups(items);
      },
    });
  }

  list() {
    return this.api.get<AppNotification[]>('/notifications');
  }

  markRead(ids: string[]): Observable<{ count: number }> {
    return this.api
      .patch<{ count: number }>('/notifications/read', { ids })
      .pipe(tap(({ count }) => this.decrementUnread(count)));
  }

  markAllRead(): Observable<{ count: number }> {
    return this.api
      .patch<{ count: number }>('/notifications/read-all')
      .pipe(tap(() => this.unreadCount.set(0)));
  }

  delete(ids: string[], unreadDeleted = 0): Observable<{ count: number }> {
    return this.api
      .post<{ count: number }>('/notifications/delete', { ids })
      .pipe(tap(() => this.decrementUnread(unreadDeleted)));
  }

  private decrementUnread(by: number) {
    this.unreadCount.update((n) => Math.max(0, n - by));
  }

  private webNotificationsEnabled() {
    return this.auth.currentUser()?.webNotifications !== false;
  }

  private showPopups(items: AppNotification[]) {
    if (!this.webNotificationsEnabled()) return;
    if (this.browserPermission() !== 'granted') return;

    const cutoff = Date.now() - POPUP_MAX_AGE_MS;
    for (const item of items) {
      if (this.shownPopups.has(item.id)) continue;
      if (new Date(item.createdAt).getTime() < cutoff) continue;
      this.shownPopups.add(item.id);

      const popup = new Notification(item.title, { body: item.body, icon: '/favicon.ico', tag: item.id });
      popup.onclick = () =>
        this.zone.run(() => {
          window.focus();
          if (item.taskId) this.router.navigate(['/tasks', item.taskId]);
          popup.close();
        });
      popup.onclose = () => this.zone.run(() => this.markRead([item.id]).subscribe());
    }
  }
}
