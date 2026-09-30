#!/usr/bin/env bash
# Droplet-side helper for deploy/release.sh. Runs from the deployment root
# (DEPLOY_DIR, e.g. /home/deploy/management) and is synced there on every release.
#
# Usage: deploy/remote.sh <command> [args]
#   check              verify .env exists and the old auto-update timer is off
#   backup             mysqldump into backups/, keep the last 5
#   current-tag        tag of the running release (last line of releases.log)
#   previous-tag       tag to roll back to (second-to-last line of releases.log)
#   activate <tag>     retag <tag> as :current and recreate containers
#   record <tag>       append <tag> to releases.log
#   pop                drop the last release from releases.log (after a rollback)
#   prune              remove management-* images, keeping the 3 newest tags
#   logs               recent backend/nginx logs
set -euo pipefail

cd "$(dirname "$0")/.."

RELEASES=releases.log
KEEP_BACKUPS=5
KEEP_IMAGES=3
REPOS=(management-backend management-nginx)

compose() { docker compose --env-file .env "$@"; }

image_exists() { docker image inspect "$1" >/dev/null 2>&1; }

tag_exists() {
  local repo
  for repo in "${REPOS[@]}"; do
    image_exists "$repo:$1" || return 1
  done
}

# Releases made before release.sh existed were built on the droplet as :latest.
legacy_tag() { tag_exists latest && echo latest || true; }

cmd="${1:-}"
shift || true

case "$cmd" in
  check)
    if [ ! -f .env ]; then
      echo "Missing $(pwd)/.env (copy it from the old clone: cp /home/deploy/management/.env $(pwd)/.env)" >&2
      exit 1
    fi
    if [ "$(systemctl is-enabled management-update.timer 2>/dev/null || true)" = "enabled" ]; then
      echo "management-update.timer is still enabled and would rebuild over releases." >&2
      echo "Disable it once: sudo systemctl disable --now management-update.timer" >&2
      exit 1
    fi
    ;;

  backup)
    mkdir -p backups
    if ! compose ps --status running --services 2>/dev/null | grep -qx mysql; then
      echo "MySQL is not running; skipping backup (first deploy?)"
      exit 0
    fi
    file="backups/management-$(date +%Y%m%d-%H%M%S).sql.gz"
    # shellcheck disable=SC2016 # expanded inside the mysql container
    compose exec -T mysql sh -c \
      'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --no-tablespaces "$MYSQL_DATABASE"' \
      2>/dev/null | gzip > "$file"
    if [ "$(gzip -dc "$file" | head -c 4096 | wc -c)" -lt 100 ]; then
      rm -f "$file"
      echo "Backup looks empty; aborting" >&2
      exit 1
    fi
    echo "Backup written: $(pwd)/$file ($(du -h "$file" | cut -f1))"
    # shellcheck disable=SC2012 # names are generated above, no odd characters
    ls -1t backups/management-*.sql.gz | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
    ;;

  current-tag)
    if [ -s "$RELEASES" ]; then tail -n1 "$RELEASES" | awk '{print $2}'; else legacy_tag; fi
    ;;

  previous-tag)
    lines="$( [ -f "$RELEASES" ] && wc -l < "$RELEASES" || echo 0)"
    if [ "$lines" -ge 2 ]; then
      tail -n2 "$RELEASES" | head -n1 | awk '{print $2}'
    elif [ "$lines" -eq 1 ]; then
      legacy_tag
    fi
    ;;

  activate)
    tag="${1:?tag required}"
    if ! tag_exists "$tag"; then
      echo "Images for tag $tag are not on this host" >&2
      exit 1
    fi
    for repo in "${REPOS[@]}"; do
      docker tag "$repo:$tag" "$repo:current"
    done
    compose up -d --no-build
    compose ps
    ;;

  record)
    tag="${1:?tag required}"
    echo "$(date -Is) $tag" >> "$RELEASES"
    ;;

  pop)
    [ -s "$RELEASES" ] && sed -i '$d' "$RELEASES"
    ;;

  prune)
    current="$(tail -n1 "$RELEASES" 2>/dev/null | awk '{print $2}')"
    for repo in "${REPOS[@]}"; do
      # `docker images` lists newest first.
      docker images "$repo" --format '{{.Tag}}' \
        | grep -vx -e current -e "$current" -e '<none>' \
        | tail -n +"$KEEP_IMAGES" \
        | while read -r tag; do docker rmi "$repo:$tag" >/dev/null || true; done
    done
    docker image prune -f >/dev/null
    ;;

  logs)
    compose logs --tail=80 backend nginx || true
    ;;

  *)
    sed -n '2,16p' "$0"
    exit 2
    ;;
esac
