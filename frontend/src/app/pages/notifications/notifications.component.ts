import { Component, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { NotificationService } from '../../services/notification.service';
import { AppNotification } from '../../models';
import { formatUserDateTime } from '../../utils/date';
import { formatApiError } from '../../utils/api-error';

@Component({
  selector: 'app-notifications',
  standalone: true,
  styles: [`
    .notification-item {
      display: flex;
      gap: 0.75rem;
      align-items: flex-start;
      padding: 0.85rem 1rem;
      border-bottom: 1px solid var(--app-border-subtle);
    }
    .notification-item:last-child {
      border-bottom: none;
    }
    .notification-item.unread {
      background: color-mix(in srgb, var(--app-primary) 7%, transparent);
    }
    .notification-item.unread .notification-title {
      font-weight: 600;
    }
    .notification-icon {
      font-size: 1.1rem;
      color: var(--app-primary);
      width: 1.5rem;
      text-align: center;
    }
    .notification-body {
      flex: 1;
      min-width: 0;
    }
    .notification-actions {
      display: flex;
      gap: 0.35rem;
      white-space: nowrap;
    }
    .unread-dot {
      display: inline-block;
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      background: var(--app-primary);
      margin-right: 0.4rem;
      vertical-align: middle;
    }
  `],
  template: `
    <div class="py-2">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-4">
        <h2 class="page-title mb-0">Notifications</h2>
        <div class="d-flex gap-2">
          <button
            class="btn btn-outline-secondary btn-sm"
            (click)="markAllRead()"
            [disabled]="!hasUnread() || busy"
          >
            <i class="bi bi-check2-all me-1"></i>Mark all as read
          </button>
          <button
            class="btn btn-outline-danger btn-sm"
            (click)="deleteSelected()"
            [disabled]="!selected.size || busy"
          >
            <i class="bi bi-trash me-1"></i>Delete selected{{ selected.size ? ' (' + selected.size + ')' : '' }}
          </button>
        </div>
      </div>

      @if (error) {
        <div class="alert alert-danger">{{ error }}</div>
      }

      @if (loading) {
        <div class="spinner-border"></div>
      } @else {
        <div class="card">
          @if (items.length) {
            <div class="card-header d-flex align-items-center gap-2">
              <input
                class="form-check-input mt-0"
                type="checkbox"
                id="select-all-notifications"
                [checked]="allSelected()"
                (change)="toggleAll()"
              >
              <label class="form-check-label small text-muted" for="select-all-notifications">
                Select all · showing the last 14 days
              </label>
            </div>
          }
          <div class="card-body p-0">
            @for (n of items; track n.id) {
              <div class="notification-item" [class.unread]="!n.readAt">
                <input
                  class="form-check-input mt-1"
                  type="checkbox"
                  [checked]="selected.has(n.id)"
                  (change)="toggle(n.id)"
                  [attr.aria-label]="'Select notification: ' + n.title"
                >
                <i
                  class="bi notification-icon"
                  [class.bi-bell-fill]="n.type === 'task_alert'"
                  [class.bi-at]="n.type === 'mention'"
                ></i>
                <div class="notification-body">
                  <div class="notification-title">
                    @if (!n.readAt) {
                      <span class="unread-dot" aria-label="Unread"></span>
                    }
                    {{ n.title }}
                  </div>
                  <div class="text-muted small">{{ n.body }}</div>
                  <div class="text-muted small mt-1" [title]="formatDate(n.createdAt)">
                    {{ relativeTime(n.createdAt) }}
                    @if (n.task) {
                      · {{ n.task.title }}
                    }
                  </div>
                </div>
                <div class="notification-actions">
                  @if (n.taskId) {
                    <button class="btn btn-sm btn-primary" (click)="open(n)">View task</button>
                  }
                  @if (!n.readAt) {
                    <button
                      class="btn btn-sm btn-outline-secondary"
                      title="Mark as read"
                      (click)="markRead(n)"
                    >
                      <i class="bi bi-check2"></i>
                    </button>
                  }
                  <button class="btn btn-sm btn-outline-danger" title="Delete" (click)="deleteOne(n)">
                    <i class="bi bi-trash"></i>
                  </button>
                </div>
              </div>
            } @empty {
              <p class="text-muted text-center py-5 mb-0">No notifications in the last 14 days.</p>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class NotificationsComponent implements OnInit {
  items: AppNotification[] = [];
  selected = new Set<string>();
  loading = true;
  busy = false;
  error = '';

  constructor(
    private notifications: NotificationService,
    private router: Router,
  ) {}

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading = true;
    this.notifications.list().subscribe({
      next: (items) => {
        this.items = items;
        this.selected = new Set([...this.selected].filter((id) => items.some((n) => n.id === id)));
        this.notifications.unreadCount.set(items.filter((n) => !n.readAt).length);
        this.loading = false;
      },
      error: (err) => {
        this.error = formatApiError(err, 'Failed to load notifications');
        this.loading = false;
      },
    });
  }

  hasUnread() {
    return this.items.some((n) => !n.readAt);
  }

  allSelected() {
    return this.items.length > 0 && this.selected.size === this.items.length;
  }

  toggle(id: string) {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
  }

  toggleAll() {
    this.selected = this.allSelected() ? new Set() : new Set(this.items.map((n) => n.id));
  }

  open(n: AppNotification) {
    if (!n.readAt) this.markRead(n);
    this.router.navigate(['/tasks', n.taskId]);
  }

  markRead(n: AppNotification) {
    this.notifications.markRead([n.id]).subscribe(() => this.setRead([n.id]));
  }

  markAllRead() {
    this.busy = true;
    this.notifications.markAllRead().subscribe({
      next: () => {
        this.setRead(this.items.map((n) => n.id));
        this.busy = false;
      },
      error: (err) => this.fail(err, 'Failed to mark notifications as read'),
    });
  }

  deleteOne(n: AppNotification) {
    this.remove([n.id]);
  }

  deleteSelected() {
    if (!confirm(`Delete ${this.selected.size} notification(s)?`)) return;
    this.remove([...this.selected]);
  }

  formatDate(d: string) {
    return formatUserDateTime(d);
  }

  relativeTime(d: string) {
    const minutes = Math.round((Date.now() - new Date(d).getTime()) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? 'yesterday' : `${days} days ago`;
  }

  private remove(ids: string[]) {
    const unreadDeleted = this.items.filter((n) => ids.includes(n.id) && !n.readAt).length;
    this.busy = true;
    this.notifications.delete(ids, unreadDeleted).subscribe({
      next: () => {
        this.items = this.items.filter((n) => !ids.includes(n.id));
        ids.forEach((id) => this.selected.delete(id));
        this.busy = false;
      },
      error: (err) => this.fail(err, 'Failed to delete notifications'),
    });
  }

  private setRead(ids: string[]) {
    const now = new Date().toISOString();
    this.items = this.items.map((n) => (ids.includes(n.id) && !n.readAt ? { ...n, readAt: now } : n));
  }

  private fail(err: HttpErrorResponse, fallback: string) {
    this.error = formatApiError(err, fallback);
    this.busy = false;
  }
}
