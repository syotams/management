#!/usr/bin/env bash
set -euo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "Run with sudo: sudo ./deploy/install-auto-update.sh"
  exit 1
fi

DEPLOY_USER="${DEPLOY_USER:-deploy}"
REPO_DIR="${REPO_DIR:-/home/$DEPLOY_USER/management}"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "Repo not found at $REPO_DIR"
  echo "Set REPO_DIR if your clone lives elsewhere, e.g.:"
  echo "  sudo REPO_DIR=/home/deploy/management ./deploy/install-auto-update.sh"
  exit 1
fi

chmod +x "$REPO_DIR/deploy/update.sh"

SERVICE_FILE="/etc/systemd/system/management-update.service"
TIMER_FILE="/etc/systemd/system/management-update.timer"

sed \
  -e "s|User=deploy|User=$DEPLOY_USER|g" \
  -e "s|Group=deploy|Group=$DEPLOY_USER|g" \
  -e "s|WorkingDirectory=/home/deploy/management|WorkingDirectory=$REPO_DIR|g" \
  -e "s|ExecStart=/home/deploy/management/deploy/update.sh|ExecStart=$REPO_DIR/deploy/update.sh|g" \
  "$REPO_DIR/deploy/management-update.service" > "$SERVICE_FILE"

cp "$REPO_DIR/deploy/management-update.timer" "$TIMER_FILE"

systemctl daemon-reload
systemctl enable --now management-update.timer

echo "Auto-update installed."
echo "  Timer status: systemctl status management-update.timer"
echo "  Run now:      sudo systemctl start management-update.service"
echo "  Logs:         tail -f $REPO_DIR/deploy/update.log"
