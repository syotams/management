import { Task, DayGroup, GroupedTasks } from '../models';
import { localDayKey, fromDatetimeLocal, userTimeZone } from './date';

export { dayKeyToDueDate, toDatetimeLocal } from './date';

const PRIORITY_ORDER: Record<string, number> = { urgent: -1, high: 0, medium: 1, low: 2 };
const CLOSED_STATUSES = new Set(['completed', 'archived']);

export function isClosedStatus(status: string): boolean {
  return CLOSED_STATUSES.has(status);
}

export function flattenGroupedTasks(grouped: GroupedTasks, includeClosed = false): Task[] {
  const result: Task[] = [...grouped.urgent];
  for (const g of grouped.groups) {
    result.push(...g.tasks);
  }
  if (includeClosed) {
    result.push(...grouped.completed, ...grouped.archived);
  }
  return result;
}

export function groupTasks(tasks: Task[]): GroupedTasks {
  const active = tasks.filter((t) => !isClosedStatus(t.status));
  const completed = tasks.filter((t) => t.status === 'completed').sort(sortClosedFn);
  const archived = tasks.filter((t) => t.status === 'archived').sort(sortClosedFn);
  const urgent = active.filter((t) => t.priority === 'urgent').sort(sortFn);
  const nonUrgent = active.filter((t) => t.priority !== 'urgent');
  return { urgent, groups: groupTasksByDay(nonUrgent), completed, archived };
}

export function groupTasksByDay(tasks: Task[]): DayGroup[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const overdue: Task[] = [];
  const byDay = new Map<string, Task[]>();

  for (const task of tasks) {
    const due = new Date(task.dueDate);
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());

    if (dueDay < startOfToday) {
      overdue.push(task);
    } else {
      const key = localDayKey(due);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(task);
    }
  }

  overdue.sort(sortFn);

  const groups: DayGroup[] = [];
  if (overdue.length) {
    groups.push({ key: 'overdue', label: 'Overdue', isOverdue: true, tasks: overdue });
  }

  const sortedKeys = Array.from(byDay.keys()).sort();
  for (const key of sortedKeys) {
    const dayTasks = byDay.get(key)!.sort(sortFn);
    groups.push({
      key,
      label: formatDayLabel(fromDatetimeLocal(`${key}T12:00:00`)),
      isOverdue: false,
      tasks: dayTasks,
    });
  }

  return groups;
}

function sortFn(a: Task, b: Task) {
  const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  if (p !== 0) return p;
  return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
}

function sortClosedFn(a: Task, b: Task) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

export function formatDayLabel(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const formatted = date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: userTimeZone(),
  });

  if (target.getTime() === today.getTime()) return `Today — ${formatted}`;
  if (target.getTime() === tomorrow.getTime()) return `Tomorrow — ${formatted}`;
  return formatted;
}

export function displayName(user: { name?: string; email?: string }): string {
  return user.name || user.email || 'Unknown';
}

export const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;

const STATUS_LABELS: Record<string, string> = {
  todo: 'Todo',
  in_progress: 'In Progress',
  completed: 'Completed',
  archived: 'Archived',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] || status;
}

export function statusClass(status: string): string {
  return `status-${status}`;
}
