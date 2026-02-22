#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
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

if ! [[ "$RETAIN_DAYS" =~ ^[0-9]+$ ]]; then
  echo "RETAIN_DAYS must be a non-negative integer" >&2
  exit 1
fi

BASE_URL="${BASE_URL%/}"
mkdir -p "$BACKUP_DIR"

stamp="$(date -u +"%Y%m%dT%H%M%SZ")"
out_file="$BACKUP_DIR/inventory-$stamp.json"
tmp_file="$out_file.tmp"

curl -fsS "${AUTH_ARGS[@]}" "$BASE_URL/export/inventory" -o "$tmp_file"

node -e '
const fs = require("node:fs");
const file = process.argv[1];
const text = fs.readFileSync(file, "utf8");
const parsed = JSON.parse(text);
if (parsed && typeof parsed === "object" && parsed.ok === true && parsed.data) {
  fs.writeFileSync(file, JSON.stringify(parsed.data, null, 2) + "\n");
  process.exit(0);
}
if (parsed && typeof parsed === "object" && Array.isArray(parsed.locations) && Array.isArray(parsed.items)) {
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n");
  process.exit(0);
}
throw new Error("Unexpected export payload shape");
' "$tmp_file"

mv "$tmp_file" "$out_file"

echo "Saved backup: $out_file"

if [[ "$RETAIN_DAYS" -gt 0 ]]; then
  find "$BACKUP_DIR" -type f -name 'inventory-*.json' -mtime +"$RETAIN_DAYS" -print -delete
fi
