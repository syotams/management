type HttpErrorLike = {
  status?: number;
  error?: { message?: string | string[] };
};

export function formatApiError(err: HttpErrorLike, fallback: string): string {
  const msg = err.error?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  if (typeof msg === 'string') {
    if (err.status === 404 && msg.startsWith('Cannot ')) {
      return 'Server endpoint not found. Restart the backend (npm run backend) after updating.';
    }
    return msg;
  }
  if (err.status === 0) return 'Could not reach the server. Is the backend running?';
  return fallback;
}
