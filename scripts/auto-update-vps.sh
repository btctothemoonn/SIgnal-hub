#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_DIR="${SIGNAL_HUB_APP_DIR:-/home/ubuntu/signal-hub}"
CURRENT_LINK="${SIGNAL_HUB_CURRENT_LINK:-${APP_DIR}-current}"
ATTEMPT="$APP_DIR/.signal-hub-auto-update-attempt"
cd "$APP_DIR"
exec 8>"$APP_DIR/.signal-hub-auto-update.lock"
flock -n 8 || { echo "Auto update already running; skipped"; exit 0; }
export GIT_TERMINAL_PROMPT=0

remote="$(timeout 45 git ls-remote --exit-code origin refs/heads/main)"
read -r latest ref <<< "$remote"
[[ "$latest" =~ ^([a-f0-9]{40}|[a-f0-9]{64})$ && "$ref" == "refs/heads/main" ]] || { echo "Invalid main revision" >&2; exit 1; }

if [[ -f "$CURRENT_LINK/.release-commit" ]]; then
  active="$(<"$CURRENT_LINK/.release-commit")"
else
  # Older releases encode their revision in the release directory name.
  release="$(basename "$(readlink -f "$CURRENT_LINK")")"
  prefix="${release%%-*}"
  [[ "$prefix" =~ ^[a-f0-9]{7,40}$ ]] || { echo "Cannot identify active release" >&2; exit 1; }
  active="$(git rev-parse --verify "$prefix^{commit}")"
fi
[[ "$active" =~ ^([a-f0-9]{40}|[a-f0-9]{64})$ ]] || { echo "Invalid active revision" >&2; exit 1; }
if [[ "$latest" == "$active" ]]; then
  echo "Up to date: $latest (no build)"
  exit 0
fi
if [[ -f "$ATTEMPT" && "$(<"$ATTEMPT")" == "$latest" ]]; then
  echo "Previously failed or interrupted revision $latest; waiting for a new commit"
  exit 0
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Tracked local changes present; skipped" >&2
  exit 1
fi
available_kib="$(df -Pk "$APP_DIR" | awk 'NR == 2 {print $4}')"
if [[ ! "$available_kib" =~ ^[0-9]+$ ]] || (( available_kib < 8388608 )); then
  echo "Less than 8 GiB free; skipped without deleting releases" >&2
  exit 1
fi

printf '%s\n' "$latest" > "$ATTEMPT.pending"
mv -f "$ATTEMPT.pending" "$ATTEMPT"
echo "Deploying main: $active -> $latest"
if timeout --kill-after=120s 45m env SIGNAL_HUB_BRANCH=main bash "$APP_DIR/scripts/deploy-vps.sh"; then
  rm -f "$ATTEMPT"
  echo "Automatic deployment completed"
else
  result=$?
  if [[ "$result" == "75" ]]; then
    rm -f "$ATTEMPT"
    echo "Manual deployment in progress; retry on the next check"
    exit 0
  fi
  echo "Deployment failed ($result); same revision will not be rebuilt automatically" >&2
  exit "$result"
fi
