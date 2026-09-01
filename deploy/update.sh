#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BRANCH="${DEPLOY_BRANCH:-main}"
LOG_FILE="${DEPLOY_LOG_FILE:-$REPO_DIR/deploy/update.log}"
LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/management-update.lock}"

log() {
  echo "$(date -Is) $*" | tee -a "$LOG_FILE"
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "Another update is already running, skipping"
  exit 0
fi

cd "$REPO_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

log "Checking for updates on $BRANCH..."

git fetch origin "$BRANCH" --quiet

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL" = "$REMOTE" ]; then
  log "Already up to date ($LOCAL)"
  exit 0
fi

log "Updating $LOCAL -> $REMOTE"
git pull --ff-only origin "$BRANCH"

log "Rebuilding and restarting containers..."
docker compose up -d --build

log "Pruning unused images..."
docker image prune -f >/dev/null

log "Deploy finished successfully"
