#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/home_inventory}"
DEPLOY_REF="${DEPLOY_REF:-origin/main}"
PROCESS_NAME="${PROCESS_NAME:-home-inventory-api}"
BASIC_AUTH_USER="${BASIC_AUTH_USER:-}"
BASIC_AUTH_PASS="${BASIC_AUTH_PASS:-}"
export HOME="${HOME:-/root}"
export PM2_HOME="${PM2_HOME:-$HOME/.pm2}"

cd "$APP_DIR"

AUTH_ARGS=()
if [[ -n "$BASIC_AUTH_USER" || -n "$BASIC_AUTH_PASS" ]]; then
  if [[ -z "$BASIC_AUTH_USER" || -z "$BASIC_AUTH_PASS" ]]; then
    echo "[deploy] Both BASIC_AUTH_USER and BASIC_AUTH_PASS are required when using basic auth." >&2
    exit 1
  fi
  AUTH_ARGS=(-u "${BASIC_AUTH_USER}:${BASIC_AUTH_PASS}")
fi

git_safe() {
  git -c safe.directory="$APP_DIR" "$@"
}

echo "[deploy] Fetching repository updates"
git_safe fetch --all --prune

echo "[deploy] Checking out ref: $DEPLOY_REF"
git_safe checkout "$DEPLOY_REF"

if [[ -f "api/package-lock.json" ]]; then
  echo "[deploy] Installing API dependencies with npm ci"
  npm --prefix ./api ci
else
  echo "[deploy] package-lock.json missing; falling back to npm install"
  npm --prefix ./api install
fi

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
health_body=$(curl -sS "${AUTH_ARGS[@]}" http://127.0.0.1:4000/health)
if ! grep -q '"ok":true' <<<"$health_body"; then
  echo "[deploy] Health check failed: $health_body" >&2
  exit 1
fi

search_status=$(curl -sS "${AUTH_ARGS[@]}" \
  -o /tmp/home_inventory_deploy_search.json \
  -w "%{http_code}" \
  "http://127.0.0.1:4000/items/search?q=tool&limit=1&offset=0")

if [[ "$search_status" == "401" && "${#AUTH_ARGS[@]}" -eq 0 ]]; then
  echo "[deploy] Search check skipped (API auth enabled and no BASIC_AUTH_USER/BASIC_AUTH_PASS provided)."
else
  if [[ "$search_status" != "200" ]]; then
    echo "[deploy] Search check failed with HTTP $search_status" >&2
    cat /tmp/home_inventory_deploy_search.json >&2 || true
    exit 1
  fi

  if ! grep -q '"ok":true' /tmp/home_inventory_deploy_search.json; then
    echo "[deploy] Search check failed: $(cat /tmp/home_inventory_deploy_search.json)" >&2
    exit 1
  fi
fi

echo "[deploy] Deployment completed successfully"
