#!/usr/bin/env bash
# shellcheck disable=SC2029 # remote commands are built locally on purpose
# Test, build, verify and ship a release to the production droplet.
#
# Usage:
#   ./deploy/release.sh                 full release
#   ./deploy/release.sh --no-deploy     everything up to (not including) touching the droplet
#   ./deploy/release.sh --rollback      switch the droplet back to the previous release
#
# Options:
#   --allow-dirty   allow uncommitted changes (only with --no-deploy)
#
# Config: .env.deploy (see .env.deploy.example).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NO_DEPLOY=0
ROLLBACK=0
ALLOW_DIRTY=0
for arg in "$@"; do
  case "$arg" in
    --no-deploy) NO_DEPLOY=1 ;;
    --rollback) ROLLBACK=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -h|--help) sed -n '3,13p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ "$ALLOW_DIRTY" -eq 1 ] && [ "$NO_DEPLOY" -eq 0 ]; then
  echo "--allow-dirty is only allowed with --no-deploy; production releases must match a commit." >&2
  exit 2
fi

if [ -f .env.deploy ]; then
  set -a
  # shellcheck source=/dev/null
  source .env.deploy
  set +a
fi

DEPLOY_DIR="${DEPLOY_DIR:-/home/deploy/management}"
DOMAIN="${DOMAIN:-sp.matheager.com}"
read -r -a SSH_ARGS <<< "${SSH_OPTS:-}"

RELEASE_PROJECT=management-release
RELEASE_HTTP_PORT="${RELEASE_HTTP_PORT:-18080}"
RELEASE_ENV_FILE="$(mktemp)"
STARTED=$SECONDS

step() { echo; echo "==> [$((SECONDS - STARTED))s] $*"; }
die() { echo; echo "RELEASE FAILED: $*" >&2; exit 1; }

remote() { ssh "${SSH_ARGS[@]}" "$DEPLOY_HOST" "cd '$DEPLOY_DIR' && ./deploy/remote.sh $*"; }

release_compose() {
  docker compose -p "$RELEASE_PROJECT" -f docker-compose.local.yml --env-file "$RELEASE_ENV_FILE" "$@"
}

cleanup() {
  if [ -s "$RELEASE_ENV_FILE" ]; then
    release_compose down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -f "$RELEASE_ENV_FILE"
}
trap cleanup EXIT

require_deploy_config() {
  [ -n "${DEPLOY_HOST:-}" ] || die "DEPLOY_HOST is not set (copy .env.deploy.example to .env.deploy)"
}

# Only the helper script: safe to upload before tests pass.
sync_remote_helper() {
  ssh "${SSH_ARGS[@]}" "$DEPLOY_HOST" "mkdir -p '$DEPLOY_DIR/deploy' '$DEPLOY_DIR/backups'"
  rsync -azR -e "ssh ${SSH_ARGS[*]}" deploy/remote.sh "$DEPLOY_HOST:$DEPLOY_DIR/"
}

# Files the production compose stack reads from disk.
sync_stack_files() {
  rsync -azR -e "ssh ${SSH_ARGS[*]}" \
    docker-compose.yml deploy/mysql/ deploy/certbot/ deploy/sanity.sh deploy/remote.sh \
    "$DEPLOY_HOST:$DEPLOY_DIR/"
}

prod_sanity() {
  SANITY_WAIT="${SANITY_WAIT:-240}" ./deploy/sanity.sh --readonly "https://$DOMAIN"
}

# ---------------------------------------------------------------- rollback
if [ "$ROLLBACK" -eq 1 ]; then
  require_deploy_config
  step "Rolling back $DEPLOY_HOST:$DEPLOY_DIR"
  sync_remote_helper
  current="$(remote current-tag)"
  previous="$(remote previous-tag)"
  [ -n "$previous" ] || die "no previous release recorded to roll back to"
  echo "Current: ${current:-unknown}  ->  rolling back to: $previous"
  remote activate "$previous"
  remote pop
  step "Production sanity checks"
  prod_sanity || { remote logs; die "rolled back to $previous but sanity checks fail"; }
  echo
  echo "Rolled back to $previous."
  exit 0
fi

# ---------------------------------------------------------------- 1. preflight
step "Preflight"
command -v docker >/dev/null || die "docker is not installed"
docker compose version >/dev/null || die "docker compose v2 is required"

TAG="$(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain)" ]; then
  [ "$ALLOW_DIRTY" -eq 1 ] || die "working tree has uncommitted changes; commit or stash them first"
  TAG="${TAG}-dirty"
fi
echo "Release tag: $TAG"

if [ "$NO_DEPLOY" -eq 0 ]; then
  require_deploy_config
  command -v rsync >/dev/null || die "rsync is not installed"
  ssh "${SSH_ARGS[@]}" -o BatchMode=yes -o ConnectTimeout=10 "$DEPLOY_HOST" true \
    || die "cannot ssh to $DEPLOY_HOST"
  sync_remote_helper
  remote check || die "droplet preflight failed"
  echo "Droplet $DEPLOY_HOST:$DEPLOY_DIR is ready"
fi

# ---------------------------------------------------------------- 2. tests
step "Backend: install, build, unit + e2e tests"
(cd backend && npm ci --no-audit --no-fund && npm run build && npm test) || die "backend tests failed"

step "Frontend: install and production build"
(cd frontend && npm ci --no-audit --no-fund && npx ng build) || die "frontend build failed"
if find frontend/src -name '*.spec.ts' | grep -q .; then
  step "Frontend: unit tests"
  (cd frontend && npx ng test --watch=false --browsers=ChromeHeadless) || die "frontend tests failed"
fi

# ---------------------------------------------------------------- 3. build images
cat > "$RELEASE_ENV_FILE" <<EOF
IMAGE_TAG=$TAG
MYSQL_ROOT_PASSWORD=release-root-$RANDOM$RANDOM
MYSQL_DATABASE=management
MYSQL_USER=management
MYSQL_PASSWORD=release-db-$RANDOM$RANDOM
MYSQL_HOST_PORT=$((RELEASE_HTTP_PORT + 1))
JWT_SECRET=release-jwt-$RANDOM$RANDOM$RANDOM
DOMAIN=localhost
HTTP_PORT=$RELEASE_HTTP_PORT
HTTPS_PORT=$((RELEASE_HTTP_PORT + 2))
APP_URL=http://localhost:$RELEASE_HTTP_PORT
CORS_ORIGIN=http://localhost:$RELEASE_HTTP_PORT
EOF

step "Building images management-backend:$TAG and management-nginx:$TAG (linux/amd64)"
export DOCKER_DEFAULT_PLATFORM=linux/amd64
release_compose build backend nginx || die "image build failed"

# ---------------------------------------------------------------- 4-5. container sanity
step "Starting throwaway stack '$RELEASE_PROJECT' from the built images"
release_compose down -v --remove-orphans >/dev/null 2>&1 || true
release_compose up -d --no-build || die "could not start the release stack"

step "Container sanity tests"
if ! ./deploy/sanity.sh --full "http://127.0.0.1:$RELEASE_HTTP_PORT"; then
  release_compose logs --tail=80 backend nginx || true
  die "container sanity tests failed"
fi
release_compose down -v --remove-orphans >/dev/null 2>&1 || true

if [ "$NO_DEPLOY" -eq 1 ]; then
  echo
  echo "All checks passed for $TAG. Skipping deploy (--no-deploy)."
  exit 0
fi

# ---------------------------------------------------------------- 6. ship
step "Shipping images to $DEPLOY_HOST"
docker save "management-backend:$TAG" "management-nginx:$TAG" \
  | gzip \
  | ssh "${SSH_ARGS[@]}" "$DEPLOY_HOST" 'gunzip | docker load' \
  || die "failed to transfer images"
sync_stack_files || die "failed to sync compose files"

# ---------------------------------------------------------------- 7. backup
step "Backing up production MySQL"
remote backup || die "database backup failed; production untouched"

# ---------------------------------------------------------------- 8. swap
PREVIOUS="$(remote current-tag)"
echo "Currently running: ${PREVIOUS:-none}"

step "Activating $TAG"
if ! remote activate "$TAG"; then
  [ -n "$PREVIOUS" ] && remote activate "$PREVIOUS" || true
  die "failed to start $TAG; restored ${PREVIOUS:-nothing}"
fi

# ---------------------------------------------------------------- 9. production checks
step "Production sanity checks (https://$DOMAIN)"
if ! prod_sanity; then
  remote logs
  if [ -n "$PREVIOUS" ]; then
    step "Rolling back to $PREVIOUS"
    remote activate "$PREVIOUS" || true
    prod_sanity || echo "WARNING: sanity checks still failing after rollback" >&2
    die "$TAG failed production checks; rolled back to $PREVIOUS"
  fi
  die "$TAG failed production checks and there is no previous release to roll back to"
fi

step "Recording release and pruning old images"
remote record "$TAG"
remote prune

echo
echo "Released $TAG to https://$DOMAIN in $((SECONDS - STARTED))s."
