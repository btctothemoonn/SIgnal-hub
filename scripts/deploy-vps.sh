#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${SIGNAL_HUB_APP_DIR:-/home/ubuntu/signal-hub}"
BRANCH="${SIGNAL_HUB_BRANCH:-main}"
NODE_BIN="${SIGNAL_HUB_NODE_BIN:-/usr/bin/node}"

cd "$APP_DIR"

git pull --ff-only origin "$BRANCH"
"$NODE_BIN" node_modules/next/dist/bin/next build

sudo systemctl daemon-reload
sudo systemctl restart \
  signal-hub-web \
  signal-hub-stocks-cache \
  signal-hub-alpha-summary \
  signal-hub-telegram \
  signal-hub-x-hybrid \
  signal-hub-monitor985 \
  signal-hub-tiger-holdings

systemctl --no-pager --plain --type=service --state=running | grep signal-hub || true
