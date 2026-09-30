import { datetimeLocalToUtcIso, toDatetimeLocal } from './date';

export type AlertMode = 'same' | 'none' | 'custom';

/** Pick the radio option that matches a task's stored alert. */
export function initialAlertMode(alertAt: string | null, dueDate: string): AlertMode {
  if (!alertAt) return 'none';
  return toDatetimeLocal(new Date(alertAt)) === toDatetimeLocal(new Date(dueDate)) ? 'same' : 'custom';
}

/** `datetime-local` value for the custom alert input, or '' when the task has no alert. */
export function alertAtToLocal(alertAt: string | null): string {
  return alertAt ? toDatetimeLocal(new Date(alertAt)) : '';
}

/** UTC ISO alert for the API; `null` means no alert (including an empty custom time). */
export function resolveAlertAt(mode: AlertMode, dueDateLocal: string, customAlertLocal: string): string | null {
  if (mode === 'same') return datetimeLocalToUtcIso(dueDateLocal);
  if (mode === 'custom' && customAlertLocal) return datetimeLocalToUtcIso(customAlertLocal);
  return null;
}
