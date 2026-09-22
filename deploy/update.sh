#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BRANCH="${DEPLOY_BRANCH:-main}"
LOG_FILE="${DEPLOY_LOG_FILE:-$REPO_DIR/deploy/update.log}"
LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/management-update.lock}"

log() {
  echo "$(date -Is) $*" | tee -a "$LOG_FILE"
}

free_disk() {
  log "Disk before prune: $(df -h / | awk 'NR==2 {print $4 " free (" $5 " used)"}')"
  log "Pruning Docker build cache and unused images..."
  docker builder prune -af >/dev/null
  # Unused images only — never prune volumes (would risk MySQL data)
  docker image prune -af >/dev/null
  log "Disk after prune: $(df -h / | awk 'NR==2 {print $4 " free (" $5 " used)"}')"
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

free_disk

log "Rebuilding and restarting containers..."
docker compose up -d --build

log "Pruning images left unused after rebuild..."
docker image prune -af >/dev/null

log "Deploy finished successfully"
