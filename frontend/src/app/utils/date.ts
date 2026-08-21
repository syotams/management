/** IANA timezone of the current user (browser). */
export function userTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Short timezone label for UI, e.g. "GMT+3" or "IDT". */
export function userTimezoneLabel(): string {
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZone: userTimeZone(),
    timeZoneName: 'short',
  }).formatToParts(new Date());
  return parts.find((p) => p.type === 'timeZoneName')?.value || userTimeZone();
}

/**
 * Parse a `datetime-local` value as the user's local wall time.
 * Never use `new Date("YYYY-MM-DDTHH:mm")` — some engines treat that as UTC.
 */
export function fromDatetimeLocal(value: string): Date {
  const [datePart, timePart = '00:00'] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second = 0] = timePart.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute, second || 0);
}

/** Format a Date as `YYYY-MM-DDTHH:mm` in the user's timezone (for datetime-local inputs). */
export function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Convert user-local datetime-local input to a UTC ISO-8601 instant for the API. */
export function datetimeLocalToUtcIso(value: string): string {
  return fromDatetimeLocal(value).toISOString();
}

/** Calendar day key `YYYY-MM-DD` in the user's timezone (not UTC). */
export function localDayKey(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Keep the existing local time of day, move it onto `dayKey`, store as UTC. */
export function dayKeyToDueDate(dayKey: string, existingDue: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const time = `${pad(existingDue.getHours())}:${pad(existingDue.getMinutes())}:${pad(existingDue.getSeconds())}`;
  return datetimeLocalToUtcIso(`${dayKey}T${time}`);
}

/** Display an instant (UTC ISO from the API) as date only in the user's timezone. */
export function formatUserDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    timeZone: userTimeZone(),
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Display an instant (UTC ISO from the API) in the user's timezone. */
export function formatUserDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    timeZone: userTimeZone(),
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Format a date-only UTC instant without shifting the calendar day. */
export function formatDateOnly(value: string | Date, includeYear = true): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' as const } : {}),
  });
}

/** `YYYY-MM-DD` for date inputs from a date-only UTC instant. */
export function toDateInput(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

/** Today's local calendar date as `YYYY-MM-DD`. */
export function localDateInput(date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Contrast text color for a hex background. */
export function contrastText(hex: string): string {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) return '#ffffff';
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? '#1a2332' : '#ffffff';
}
