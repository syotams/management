#!/usr/bin/env bash
# Sanity checks against a running stack (nginx + backend + MySQL).
#
# Usage:
#   deploy/sanity.sh --readonly https://sp.matheager.com   # production: creates no data
#   deploy/sanity.sh --full http://127.0.0.1:18080         # throwaway stack: full API workflow
#
# Env:
#   SANITY_WAIT      seconds to wait for the backend to answer (default 180)
#   SANITY_EMAIL     optional; with SANITY_PASSWORD, --readonly also logs in and reads data
#   SANITY_PASSWORD
set -euo pipefail

MODE=""
BASE=""
for arg in "$@"; do
  case "$arg" in
    --readonly) MODE="readonly" ;;
    --full) MODE="full" ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) BASE="${arg%/}" ;;
  esac
done

if [ -z "$MODE" ] || [ -z "$BASE" ]; then
  echo "Usage: $0 --readonly|--full <base-url>" >&2
  exit 2
fi

WAIT_SECONDS="${SANITY_WAIT:-180}"
BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

CODE=""
BODY=""
FAILURES=0

pass() { echo "  ok    $*"; }
fail() { echo "  FAIL  $*"; FAILURES=$((FAILURES + 1)); }

# request METHOD PATH [JSON_BODY] [TOKEN] -> sets CODE and BODY
request() {
  local method="$1" path="$2" data="${3:-}" token="${4:-}"
  local args=(-sS -o "$BODY_FILE" -w '%{http_code}' --max-time 15 -X "$method")
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' --data "$data")
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  CODE="$(curl "${args[@]}" "${BASE}${path}" 2>/dev/null || true)"
  CODE="${CODE:-000}"
  BODY="$(cat "$BODY_FILE" 2>/dev/null || true)"
}

# json_field NAME -> first "NAME":"value" in BODY
json_field() {
  printf '%s' "$BODY" | sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" | head -n1
}

# first_id -> id of the first object in a JSON array/object BODY
first_id() {
  printf '%s' "$BODY" | grep -o '"id":"[^"]*"' | head -n1 | cut -d'"' -f4
}

expect() {
  local want="$1" label="$2"
  if [ "$CODE" = "$want" ]; then
    pass "$label ($CODE)"
    return 0
  fi
  fail "$label: expected $want, got $CODE ${BODY:0:200}"
  return 1
}

echo "Sanity checks ($MODE) against $BASE"

echo "Waiting up to ${WAIT_SECONDS}s for the backend..."
deadline=$((SECONDS + WAIT_SECONDS))
until request GET /api/auth/me && [ "$CODE" = "401" ]; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    fail "backend did not answer /api/auth/me with 401 (last $CODE)"
    exit 1
  fi
  sleep 3
done

request GET /
if expect 200 "GET / serves the app"; then
  if grep -q '<app-root' <<<"$BODY"; then pass "app shell present"; else fail "app shell (<app-root>) missing from /"; fi
fi

request GET /tasks
if expect 200 "SPA deep link /tasks"; then
  if grep -q '<app-root' <<<"$BODY"; then pass "deep link returns app shell"; else fail "deep link did not return app shell"; fi
fi

request GET /api/auth/me
expect 401 "API reachable through nginx (unauthenticated /api/auth/me)" || true

if [[ "$BASE" == https://* ]]; then
  if curl -sS -o /dev/null --max-time 10 "$BASE/" 2>/dev/null; then
    pass "TLS certificate is valid"
  else
    fail "TLS certificate is not trusted"
  fi
  http_base="http://${BASE#https://}"
  redirect="$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 10 "$http_base/tasks" 2>/dev/null || true)"
  if [[ "$redirect" == 301\ https://* ]]; then
    pass "HTTP redirects to HTTPS"
  else
    fail "HTTP did not redirect to HTTPS (got: $redirect)"
  fi
fi

if [ "$MODE" = "readonly" ]; then
  if [ -n "${SANITY_EMAIL:-}" ] && [ -n "${SANITY_PASSWORD:-}" ]; then
    request POST /api/auth/login "{\"email\":\"${SANITY_EMAIL}\",\"password\":\"${SANITY_PASSWORD}\"}"
    if expect 201 "login as sanity user"; then
      token="$(json_field accessToken)"
      request GET /api/tasks "" "$token"
      expect 200 "GET /api/tasks" || true
      request GET /api/task-lists "" "$token"
      expect 200 "GET /api/task-lists" || true
    fi
  fi
else
  stamp="$(date +%s)$RANDOM"
  email="sanity-${stamp}@example.com"
  password="Sanity-${stamp}"

  request POST /api/auth/register "{\"email\":\"${email}\",\"name\":\"sanity${stamp}\",\"password\":\"${password}\"}"
  expect 201 "register" || exit 1

  request POST /api/auth/login "{\"email\":\"${email}\",\"password\":\"${password}\"}"
  expect 201 "login" || exit 1
  token="$(json_field accessToken)"

  request GET /api/auth/me "" "$token"
  expect 200 "GET /api/auth/me" || true

  request GET /api/task-lists "" "$token"
  expect 200 "GET /api/task-lists (creates default list)" || exit 1
  default_list="$(first_id)"

  request POST /api/task-lists '{"name":"Sanity list"}' "$token"
  expect 201 "create task list" || exit 1
  list_id="$(first_id)"

  request POST /api/tasks "{\"title\":\"Sanity task ${stamp}\",\"listId\":\"${list_id}\"}" "$token"
  expect 201 "create task in list" || exit 1
  task_id="$(first_id)"

  request GET "/api/tasks?listId=${list_id}" "" "$token"
  if expect 200 "list tasks filtered by list" && grep -q "$task_id" <<<"$BODY"; then
    pass "task appears in its list"
  else
    fail "task missing from its list"
  fi

  request PATCH "/api/tasks/${task_id}/list" "{\"listId\":\"${default_list}\"}" "$token"
  expect 200 "move task to default list" || true

  request PATCH "/api/tasks/${task_id}/list" "{\"listId\":\"${list_id}\"}" "$token"
  expect 200 "move task back" || true

  request DELETE "/api/task-lists/${list_id}" "" "$token"
  expect 409 "delete non-empty list without moveTo is refused" || true

  request DELETE "/api/task-lists/${list_id}?moveTo=${default_list}" "" "$token"
  expect 200 "delete list with moveTo" || true

  request GET "/api/tasks?listId=${default_list}" "" "$token"
  if expect 200 "list default list tasks" && grep -q "$task_id" <<<"$BODY"; then
    pass "task moved to default list on delete"
  else
    fail "task not found in default list after delete"
  fi
fi

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "Sanity checks FAILED ($FAILURES failure(s))"
  exit 1
fi
echo "Sanity checks passed"
