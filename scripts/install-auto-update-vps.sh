#!/usr/bin/env bash
set -euo pipefail
APP_DIR="${SIGNAL_HUB_APP_DIR:-/home/ubuntu/signal-hub}"
[[ "$APP_DIR" == "/home/ubuntu/signal-hub" ]] || { echo "Review unit paths before using another installation directory" >&2; exit 1; }
cd "$APP_DIR"
for unit in signal-hub-auto-update.service signal-hub-auto-update.timer; do
  sudo install -m 0644 "deploy/systemd/$unit" "/etc/systemd/system/$unit"
done
sudo systemctl daemon-reload
sudo systemctl enable --now signal-hub-auto-update.timer
systemctl list-timers --all signal-hub-auto-update.timer --no-pager
