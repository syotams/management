#!/usr/bin/env bash
# Build and run the production-like local stack, then smoke-check it.
# Usage: ./deploy/local-up.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.local.yml --env-file .env.local)
HTTP_PORT=8080

if [ ! -f .env.local ]; then
  cp .env.local.example .env.local
  echo "Created .env.local from .env.local.example"
fi

# shellcheck disable=SC1091
set -a
# shellcheck source=/dev/null
source .env.local
set +a
HTTP_PORT="${HTTP_PORT:-8080}"
BASE="http://127.0.0.1:${HTTP_PORT}"

echo "Building and starting local stack..."
"${COMPOSE[@]}" up -d --build

echo "Waiting for nginx at ${BASE}/ ..."
ok=0
for _ in $(seq 1 90); do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "${BASE}/" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    ok=1
    break
  fi
  # Surface backend crash early (migrations / db push).
  if ! "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx backend; then
    echo
    echo "Backend is not running. Recent logs:"
    "${COMPOSE[@]}" logs --tail=80 backend || true
    exit 1
  fi
  sleep 2
done

if [ "$ok" -ne 1 ]; then
  echo "Timed out waiting for ${BASE}/"
  "${COMPOSE[@]}" ps
  "${COMPOSE[@]}" logs --tail=80 backend nginx || true
  exit 1
fi

echo "Waiting for API (register smoke test)..."
email="local-check-$(date +%s)@example.com"
api_ok=0
for _ in $(seq 1 30); do
  code="$(curl -sS -o /tmp/management-local-register.json -w '%{http_code}' --max-time 5 \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${email}\",\"password\":\"Password1!\",\"name\":\"LocalCheck\"}" \
    "${BASE}/api/auth/register" 2>/dev/null || echo 000)"
  if [ "$code" = "201" ] || [ "$code" = "200" ]; then
    api_ok=1
    break
  fi
  if [ "$code" = "409" ]; then
    api_ok=1
    break
  fi
  sleep 2
done

if [ "$api_ok" -ne 1 ]; then
  echo "API smoke test failed (last HTTP ${code}). Body:"
  cat /tmp/management-local-register.json 2>/dev/null || true
  echo
  "${COMPOSE[@]}" logs --tail=80 backend || true
  exit 1
fi

echo
echo "Local stack is up."
echo "  App:  ${BASE}"
echo "  MySQL: localhost:${MYSQL_HOST_PORT:-3307}"
echo
echo "Useful commands:"
echo "  ${COMPOSE[*]} logs -f backend"
echo "  ${COMPOSE[*]} ps"
echo "  ${COMPOSE[*]} down          # stop, keep DB volume"
echo "  ${COMPOSE[*]} down -v       # stop and wipe local DB"
