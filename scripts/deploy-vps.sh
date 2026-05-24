#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${SIGNAL_HUB_APP_DIR:-/home/ubuntu/signal-hub}"
BRANCH="${SIGNAL_HUB_BRANCH:-main}"
NODE_BIN="${SIGNAL_HUB_NODE_BIN:-/usr/bin/node}"

cd "$APP_DIR"

git pull --ff-only origin "$BRANCH"
"$NODE_BIN" node_modules/next/dist/bin/next build

if ! systemctl list-unit-files --type=service | grep -q '^signal-hub-douyin.service'; then
  sudo tee /etc/systemd/system/signal-hub-douyin.service >/dev/null <<EOF
[Unit]
Description=Signal Hub Douyin worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=SIGNAL_HUB_RUNTIME_DIR=$APP_DIR/.signal-hub
ExecStart=$NODE_BIN --experimental-strip-types --experimental-transform-types $APP_DIR/scripts/douyin-worker.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable signal-hub-douyin
fi

sudo systemctl daemon-reload
sudo systemctl restart \
  signal-hub-web \
  signal-hub-stocks-cache \
  signal-hub-alpha-summary \
  signal-hub-telegram \
  signal-hub-x-hybrid \
  signal-hub-monitor985 \
  signal-hub-tiger-holdings \
  signal-hub-douyin

systemctl --no-pager --plain --type=service --state=running | grep signal-hub || true
