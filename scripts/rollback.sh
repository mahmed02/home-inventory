#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/home_inventory}"
ROLLBACK_REF="${ROLLBACK_REF:-}"

if [[ -z "$ROLLBACK_REF" ]]; then
  echo "ROLLBACK_REF is required (example: ROLLBACK_REF=<git-sha>)" >&2
  exit 1
fi

cd "$APP_DIR"

echo "[rollback] Running rollback to ref: $ROLLBACK_REF"
APP_DIR="$APP_DIR" DEPLOY_REF="$ROLLBACK_REF" ./scripts/deploy.sh

echo "[rollback] Completed"
