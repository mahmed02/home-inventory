#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/home_inventory}"
DEPLOY_REF="${DEPLOY_REF:-origin/main}"
PROCESS_NAME="${PROCESS_NAME:-home-inventory-api}"

cd "$APP_DIR"

echo "[deploy] Fetching repository updates"
git fetch --all --prune

echo "[deploy] Checking out ref: $DEPLOY_REF"
git checkout "$DEPLOY_REF"

if [[ -f "api/package-lock.json" ]]; then
  echo "[deploy] Installing API dependencies with npm ci"
  npm --prefix ./api ci
else
  echo "[deploy] package-lock.json missing; falling back to npm install"
  npm --prefix ./api install
fi

# Ensure S3 presign dependencies exist for upload endpoint runtime.
npm --prefix ./api install --no-save @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

echo "[deploy] Running migrations"
npm --prefix ./api run migrate

echo "[deploy] Building API"
npm --prefix ./api run build

echo "[deploy] Restarting PM2 process: $PROCESS_NAME"
if pm2 describe "$PROCESS_NAME" >/dev/null 2>&1; then
  pm2 restart "$PROCESS_NAME"
else
  pm2 start "npm --prefix ./api run start" --name "$PROCESS_NAME"
fi
pm2 save >/dev/null

echo "[deploy] Running local health checks"
health_body=$(curl -sS http://127.0.0.1:4000/health)
if ! grep -q '"ok":true' <<<"$health_body"; then
  echo "[deploy] Health check failed: $health_body" >&2
  exit 1
fi

search_body=$(curl -sS "http://127.0.0.1:4000/items/search?q=tool&limit=1&offset=0")
if ! grep -q '"ok":true' <<<"$search_body"; then
  echo "[deploy] Search check failed: $search_body" >&2
  exit 1
fi

echo "[deploy] Deployment completed successfully"
