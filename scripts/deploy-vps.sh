#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${SIGNAL_HUB_APP_DIR:-/home/ubuntu/signal-hub}"
BRANCH="${SIGNAL_HUB_BRANCH:-main}"
NODE_BIN="${SIGNAL_HUB_NODE_BIN:-/usr/bin/node}"
PNPM_BIN="${SIGNAL_HUB_PNPM_BIN:-/usr/bin/pnpm}"

cd "$APP_DIR"

"$NODE_BIN" -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 5)) { throw new Error("Signal Hub requires Node.js >=22.5.0 for node:sqlite"); } require("node:sqlite");'

git pull --ff-only origin "$BRANCH"
CI=true "$PNPM_BIN" install --frozen-lockfile --ignore-scripts
"$NODE_BIN" scripts/run-tests.mjs
"$NODE_BIN" node_modules/eslint/bin/eslint.js .
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

if ! systemctl list-unit-files --type=service | grep -q '^signal-hub-daily-brief.service'; then
  sudo tee /etc/systemd/system/signal-hub-daily-brief.service >/dev/null <<EOF
[Unit]
Description=Signal Hub daily investment brief worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=SIGNAL_HUB_RUNTIME_DIR=$APP_DIR/.signal-hub
ExecStart=$NODE_BIN --experimental-strip-types --experimental-transform-types $APP_DIR/scripts/daily-brief-worker.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable signal-hub-daily-brief
fi

sudo systemctl daemon-reload
sudo systemctl restart \
  signal-hub-web \
  signal-hub-stocks-cache \
  signal-hub-alpha-summary \
  signal-hub-daily-brief \
  signal-hub-telegram \
  signal-hub-x-hybrid \
  signal-hub-monitor985 \
  signal-hub-tiger-holdings \
  signal-hub-douyin

systemctl --no-pager --plain --type=service --state=running | grep signal-hub || true
