import { Injectable } from '@angular/core';
import { TaskService } from './task.service';
import { AuthService } from './auth.service';
import { formatUserDateTime } from '../utils/date';

export type BrowserNotificationPermission = NotificationPermission | 'unsupported';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private shownAlerts = new Set<string>();
  private polling = false;

  constructor(private taskService: TaskService, private auth: AuthService) {}

  browserPermission(): BrowserNotificationPermission {
    return 'Notification' in window ? Notification.permission : 'unsupported';
  }

  async requestPermission(): Promise<BrowserNotificationPermission> {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    return this.browserPermission();
  }

  startPolling() {
    if (this.polling) return;
    this.polling = true;
    if (this.webNotificationsEnabled()) this.requestPermission();
    setInterval(() => this.checkAlerts(), 30000);
    this.checkAlerts();
  }

  private webNotificationsEnabled() {
    return this.auth.currentUser()?.webNotifications !== false;
  }

  private checkAlerts() {
    if (!this.webNotificationsEnabled()) return;
    if (this.browserPermission() !== 'granted') return;

    this.taskService.getPendingAlerts().subscribe((tasks) => {
      for (const task of tasks) {
        if (this.shownAlerts.has(task.id)) continue;
        this.shownAlerts.add(task.id);
        new Notification(`Task alert: ${task.title}`, {
          body: `Due ${formatUserDateTime(task.dueDate)}. Priority: ${task.priority}.`,
          icon: '/favicon.ico',
        });
      }
    });
  }
}
