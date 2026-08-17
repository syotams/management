const DEFAULT_TIMEZONE = 'UTC';

export function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(tz?: string | null): string {
  if (tz && isValidTimeZone(tz)) return tz;
  return DEFAULT_TIMEZONE;
}

/** Format a UTC instant in the user's timezone. */
export function formatInTimeZone(date: Date, timeZone?: string | null): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: resolveTimeZone(timeZone),
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

/** Default due time: one hour from now, stored as a UTC instant. */
export function defaultDueDateUtc(): Date {
  return new Date(Date.now() + 60 * 60 * 1000);
}
