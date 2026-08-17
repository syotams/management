import { Injectable } from '@angular/core';
import { TaskService } from './task.service';
import { formatUserDateTime } from '../utils/date';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private shownAlerts = new Set<string>();
  private polling = false;

  constructor(private taskService: TaskService) {}

  requestPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  startPolling() {
    if (this.polling) return;
    this.polling = true;
    this.requestPermission();
    setInterval(() => this.checkAlerts(), 30000);
    this.checkAlerts();
  }

  private checkAlerts() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

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
