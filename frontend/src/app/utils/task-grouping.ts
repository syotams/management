import { Task, DayGroup } from '../models';

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

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
      const key = dueDay.toISOString().slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(task);
    }
  }

  const sortFn = (a: Task, b: Task) => {
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (p !== 0) return p;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  };

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
      label: formatDayLabel(new Date(key + 'T12:00:00')),
      isOverdue: false,
      tasks: dayTasks,
    });
  }

  return groups;
}

export function formatDayLabel(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const formatted = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  if (target.getTime() === today.getTime()) return `Today — ${formatted}`;
  if (target.getTime() === tomorrow.getTime()) return `Tomorrow — ${formatted}`;
  return formatted;
}

export function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function dayKeyToDueDate(dayKey: string, existingDue: Date): string {
  const d = new Date(dayKey + 'T' + existingDue.toTimeString().slice(0, 8));
  return d.toISOString();
}
