#!/usr/bin/env bash
# Run the backend and frontend in dev mode.
# Usage: ./dev.sh
set -euo pipefail
set -m

ROOT="$(cd "$(dirname "$0")" && pwd)"
pids=()

cleanup() {
  trap - INT TERM EXIT
  local pid
  for pid in "${pids[@]}"; do
    kill -- "-${pid}" 2>/dev/null || true
  done
}
trap cleanup INT TERM EXIT

if [[ ! -d "$ROOT/backend/node_modules" || ! -d "$ROOT/frontend/node_modules" ]]; then
  echo "Missing dependencies. From the repo root, run:"
  echo "  (cd backend && npm install) && (cd frontend && npm install)"
  exit 1
fi

echo "Compiling backend..."
(cd "$ROOT/backend" && npm run build)

echo "Starting backend (http://localhost:3000) and frontend (http://localhost:4200)"
echo "Press Ctrl+C to stop both."

(cd "$ROOT/backend" && npm run start:dev) &
pids+=($!)

(cd "$ROOT/frontend" && npm start) &
pids+=($!)

wait || true
