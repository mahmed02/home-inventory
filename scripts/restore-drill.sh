#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-}"
BACKUP_FILE="${BACKUP_FILE:-}"
DRILL_MODE="${DRILL_MODE:-validate}" # validate | replace | merge
ALLOW_DESTRUCTIVE="${ALLOW_DESTRUCTIVE:-false}"
BASIC_AUTH_USER="${BASIC_AUTH_USER:-}"
BASIC_AUTH_PASS="${BASIC_AUTH_PASS:-}"

AUTH_ARGS=()
if [[ -n "$BASIC_AUTH_USER" || -n "$BASIC_AUTH_PASS" ]]; then
  if [[ -z "$BASIC_AUTH_USER" || -z "$BASIC_AUTH_PASS" ]]; then
    echo "Both BASIC_AUTH_USER and BASIC_AUTH_PASS are required when using basic auth." >&2
    exit 1
  fi
  AUTH_ARGS=(-u "${BASIC_AUTH_USER}:${BASIC_AUTH_PASS}")
fi

if [[ -z "$BASE_URL" ]]; then
  echo "BASE_URL is required (example: BASE_URL=https://staging-inventory.example.com)" >&2
  exit 1
fi

if [[ "$DRILL_MODE" != "validate" && "$DRILL_MODE" != "replace" && "$DRILL_MODE" != "merge" ]]; then
  echo "DRILL_MODE must be one of: validate, replace, merge" >&2
  exit 1
fi

if [[ "$DRILL_MODE" == "replace" && "$ALLOW_DESTRUCTIVE" != "true" ]]; then
  echo "Refusing destructive restore. Set ALLOW_DESTRUCTIVE=true for DRILL_MODE=replace." >&2
  exit 1
fi

BASE_URL="${BASE_URL%/}"
cleanup_file=""

if [[ -z "$BACKUP_FILE" ]]; then
  cleanup_file="$(mktemp -t inventory-restore-drill-XXXXXX.json)"
  BACKUP_FILE="$cleanup_file"
  curl -fsS "${AUTH_ARGS[@]}" "$BASE_URL/export/inventory" -o "$BACKUP_FILE"

  node -e '
const fs = require("node:fs");
const file = process.argv[1];
const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
if (parsed && typeof parsed === "object" && parsed.ok === true && parsed.data) {
  fs.writeFileSync(file, JSON.stringify(parsed.data));
  process.exit(0);
}
if (parsed && typeof parsed === "object" && Array.isArray(parsed.locations) && Array.isArray(parsed.items)) {
  fs.writeFileSync(file, JSON.stringify(parsed));
  process.exit(0);
}
throw new Error("Unexpected export payload shape");
' "$BACKUP_FILE"
fi

query="validate_only=true"
if [[ "$DRILL_MODE" == "replace" ]]; then
  query=""
elif [[ "$DRILL_MODE" == "merge" ]]; then
  query="remap_ids=true"
fi

import_url="$BASE_URL/import/inventory"
if [[ -n "$query" ]]; then
  import_url="$import_url?$query"
fi

http_status=$(curl -sS "${AUTH_ARGS[@]}" -o /tmp/home_inventory_restore_drill.json -w "%{http_code}" \
  -X POST "$import_url" \
  -H "Content-Type: application/json" \
  --data-binary "@$BACKUP_FILE")

if [[ "$http_status" != "200" ]]; then
  echo "[FAIL] Restore drill failed with HTTP $http_status" >&2
  cat /tmp/home_inventory_restore_drill.json >&2 || true
  [[ -n "$cleanup_file" ]] && rm -f "$cleanup_file"
  exit 1
fi

node -e '
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (payload && payload.ok === true) {
  console.log(JSON.stringify(payload.data, null, 2));
} else {
  console.log(JSON.stringify(payload, null, 2));
}
' /tmp/home_inventory_restore_drill.json

echo "Restore drill succeeded (mode=$DRILL_MODE)."

if [[ -n "$cleanup_file" ]]; then
  rm -f "$cleanup_file"
fi
