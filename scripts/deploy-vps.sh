#!/usr/bin/env bash
set -euo pipefail
set -E

APP_DIR="${SIGNAL_HUB_APP_DIR:-/home/ubuntu/signal-hub}"
BRANCH="${SIGNAL_HUB_BRANCH:-main}"
NODE_BIN="${SIGNAL_HUB_NODE_BIN:-/usr/bin/node}"
PNPM_BIN="${SIGNAL_HUB_PNPM_BIN:-/usr/bin/pnpm}"
RELEASES_DIR="${SIGNAL_HUB_RELEASES_DIR:-${APP_DIR}-releases}"
CURRENT_LINK="${SIGNAL_HUB_CURRENT_LINK:-${APP_DIR}-current}"

cd "$APP_DIR"
"$NODE_BIN" -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 5)) { throw new Error("Signal Hub requires Node.js >=22.5.0 for node:sqlite"); } require("node:sqlite");'
if [[ "${SIGNAL_HUB_DEPLOY_REEXEC:-0}" != "1" ]]; then
  previous_commit="$(git rev-parse HEAD)"
  git pull --ff-only origin "$BRANCH"
  exec env SIGNAL_HUB_DEPLOY_REEXEC=1 SIGNAL_HUB_PREVIOUS_COMMIT="$previous_commit" bash "$APP_DIR/scripts/deploy-vps.sh"
fi

exec 9>"$APP_DIR/.signal-hub-deploy.lock"
flock -n 9 || { echo "Another deployment is in progress" >&2; exit 1; }
[[ ! -e "$CURRENT_LINK" || -L "$CURRENT_LINK" ]] || { echo "Current release path must be a symlink" >&2; exit 1; }
mkdir -p "$RELEASES_DIR" "$APP_DIR/.signal-hub"

link_env() {
  local target="$1"
  for env_file in .env .env.local .env.production .env.production.local; do
    if [[ -f "$APP_DIR/$env_file" ]]; then ln -s "$APP_DIR/$env_file" "$target/$env_file"; fi
  done
}

previous_release="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
if [[ ! -L "$CURRENT_LINK" ]]; then
  previous_release=""
  if [[ -d "$APP_DIR/.next" && -d "$APP_DIR/node_modules" ]]; then
    previous_release="$(mktemp -d "$RELEASES_DIR/legacy-XXXXXXXX")"
    git archive "${SIGNAL_HUB_PREVIOUS_COMMIT:-HEAD}" | tar -x -C "$previous_release"
    cp -a "$APP_DIR/.next" "$APP_DIR/node_modules" "$previous_release/"
    ln -s "$APP_DIR/.signal-hub" "$previous_release/.signal-hub"
    link_env "$previous_release"
  fi
fi

release="$(mktemp -d "$RELEASES_DIR/$(git rev-parse --short HEAD)-XXXXXXXX")"
git archive HEAD | tar -x -C "$release"
link_env "$release"
cd "$release"
CI=true "$PNPM_BIN" install --frozen-lockfile --ignore-scripts
SIGNAL_HUB_RUNTIME_DIR="$release/.build-runtime" "$NODE_BIN" scripts/run-tests.mjs
"$NODE_BIN" node_modules/eslint/bin/eslint.js .
SIGNAL_HUB_RUNTIME_DIR="$release/.build-runtime" "$NODE_BIN" node_modules/next/dist/bin/next build
# Turbopack cannot trace a data symlink outside the release while building.
if [[ -d "$release/.signal-hub" ]]; then
  mv "$release/.signal-hub" "$release/.build-runtime-default"
fi
ln -s "$APP_DIR/.signal-hub" "$release/.signal-hub"

services=(
  signal-hub-web signal-hub-stocks-cache signal-hub-alpha-summary
  signal-hub-daily-brief signal-hub-telegram signal-hub-x-hybrid
  signal-hub-monitor985 signal-hub-tiger-holdings signal-hub-douyin
  signal-hub-market-volatility-rest signal-hub-market-volatility-ws
  signal-hub-market-squeeze signal-hub-market-opportunity
)
scripts=(
  "" stocks-cache-worker.mjs alpha-summary-worker.mjs daily-brief-worker.mjs
  telegram-pipeline-worker.mjs x-hybrid-worker.mjs monitor985-worker.mjs
  tiger-holdings-worker.mjs douyin-worker.mjs market-volatility-rest-worker.mjs
  market-volatility-ws-worker.mjs market-squeeze-worker.mjs market-opportunity-worker.mjs
)

activate() {
  local target="$1"
  local pending_link="${CURRENT_LINK}.pending-$$"
  ln -s "$target" "$pending_link"
  mv -Tf "$pending_link" "$CURRENT_LINK"
}

rollback() {
  local result=$?
  trap - ERR
  if [[ -n "$previous_release" ]]; then
    echo "Deployment failed; restoring $previous_release" >&2
    activate "$previous_release"
    sudo systemctl daemon-reload
    sudo systemctl restart "${services[@]}" || true
  fi
  exit "$result"
}
trap rollback ERR

# A final drop-in preserves existing environment, resource and security settings.
for index in "${!services[@]}"; do
  service="${services[$index]}"
  if ! systemctl cat "$service" >/dev/null 2>&1; then
    sudo tee "/etc/systemd/system/$service.service" >/dev/null <<EOF
[Unit]
Description=Signal Hub $service
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=ubuntu
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
EOF
  fi
  sudo mkdir -p "/etc/systemd/system/$service.service.d"
  if [[ "$service" == "signal-hub-web" ]]; then
    command="$NODE_BIN node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000"
  else
    command="$NODE_BIN --experimental-strip-types --experimental-transform-types scripts/${scripts[$index]}"
  fi
  sudo tee "/etc/systemd/system/$service.service.d/zz-release.conf" >/dev/null <<EOF
[Service]
WorkingDirectory=$CURRENT_LINK
Environment=NODE_ENV=production
Environment=SIGNAL_HUB_RUNTIME_DIR=$APP_DIR/.signal-hub
EnvironmentFile=-$APP_DIR/.env.local
ExecStart=
ExecStart=$command
EOF
done

activate "$release"
sudo systemctl daemon-reload
sudo systemctl enable "${services[@]}" >/dev/null
sudo systemctl restart "${services[@]}"
"$NODE_BIN" --experimental-strip-types --experimental-transform-types scripts/check-deployment.mjs
for service in "${services[@]}"; do systemctl is-active --quiet "$service"; done
trap - ERR
echo "Active release: $release"
echo "Previous release: ${previous_release:-none}"
