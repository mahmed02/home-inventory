#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-}"
BACKUP_FILE="${BACKUP_FILE:-}"
DRILL_MODE="${DRILL_MODE:-validate}" # validate | replace | merge
ALLOW_DESTRUCTIVE="${ALLOW_DESTRUCTIVE:-false}"
BASIC_AUTH_USER="${BASIC_AUTH_USER:-}"
BASIC_AUTH_PASS="${BASIC_AUTH_PASS:-}"
AUTH_BEARER_TOKEN="${AUTH_BEARER_TOKEN:-}"
AUTH_EMAIL="${AUTH_EMAIL:-}"
AUTH_PASSWORD="${AUTH_PASSWORD:-}"
HOUSEHOLD_ID="${HOUSEHOLD_ID:-}"

AUTH_ARGS=()
HEADER_ARGS=()
SESSION_ARGS=()
COOKIE_JAR=""
LOGIN_BODY_FILE=""
HOUSEHOLDS_BODY_FILE=""
cleanup_file=""

cleanup_temp_files() {
  [[ -n "$cleanup_file" ]] && rm -f "$cleanup_file"
  [[ -n "$COOKIE_JAR" ]] && rm -f "$COOKIE_JAR"
  [[ -n "$LOGIN_BODY_FILE" ]] && rm -f "$LOGIN_BODY_FILE"
  [[ -n "$HOUSEHOLDS_BODY_FILE" ]] && rm -f "$HOUSEHOLDS_BODY_FILE"
}
trap cleanup_temp_files EXIT

if [[ -n "$BASIC_AUTH_USER" || -n "$BASIC_AUTH_PASS" ]]; then
  if [[ -z "$BASIC_AUTH_USER" || -z "$BASIC_AUTH_PASS" ]]; then
    echo "Both BASIC_AUTH_USER and BASIC_AUTH_PASS are required when using basic auth." >&2
    exit 1
  fi
  AUTH_ARGS=(-u "${BASIC_AUTH_USER}:${BASIC_AUTH_PASS}")
fi

if [[ -n "$AUTH_BEARER_TOKEN" && ( -n "$AUTH_EMAIL" || -n "$AUTH_PASSWORD" ) ]]; then
  echo "Use either AUTH_BEARER_TOKEN or AUTH_EMAIL/AUTH_PASSWORD, not both." >&2
  exit 1
fi

if [[ -n "$AUTH_BEARER_TOKEN" && ( -n "$BASIC_AUTH_USER" || -n "$BASIC_AUTH_PASS" ) ]]; then
  echo "AUTH_BEARER_TOKEN cannot be used with BASIC_AUTH_USER/BASIC_AUTH_PASS (Authorization header conflict)." >&2
  exit 1
fi

if [[ -n "$AUTH_EMAIL" || -n "$AUTH_PASSWORD" ]]; then
  if [[ -z "$AUTH_EMAIL" || -z "$AUTH_PASSWORD" ]]; then
    echo "Both AUTH_EMAIL and AUTH_PASSWORD are required when using user-account auth." >&2
    exit 1
  fi
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

if [[ -n "$AUTH_EMAIL" ]]; then
  COOKIE_JAR="$(mktemp /tmp/home_inventory_restore_cookie.XXXXXX)"
  LOGIN_BODY_FILE="$(mktemp /tmp/home_inventory_restore_login.XXXXXX.json)"
  login_payload=$(node -e 'process.stdout.write(JSON.stringify({ email: process.argv[1], password: process.argv[2] }));' "$AUTH_EMAIL" "$AUTH_PASSWORD")
  login_status=$(curl -sS "${AUTH_ARGS[@]}" -c "$COOKIE_JAR" -o "$LOGIN_BODY_FILE" -w "%{http_code}" \
    -X POST "$BASE_URL/auth/login" \
    -H "Content-Type: application/json" \
    --data "$login_payload")

  if [[ "$login_status" != "200" ]]; then
    echo "Login failed with HTTP $login_status while preparing restore auth context." >&2
    cat "$LOGIN_BODY_FILE" >&2 || true
    exit 1
  fi

  login_token=$(node -e '
const fs = require("node:fs");
try {
  const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (payload && typeof payload.token === "string" && payload.token.length > 0) {
    process.stdout.write(payload.token);
  }
} catch {
  // Ignore parse errors. Cookie mode does not require token extraction.
}
' "$LOGIN_BODY_FILE")

  if [[ -n "$login_token" && -z "$BASIC_AUTH_USER" ]]; then
    HEADER_ARGS+=( -H "Authorization: Bearer ${login_token}" )
  else
    SESSION_ARGS+=( -b "$COOKIE_JAR" )
  fi
elif [[ -n "$AUTH_BEARER_TOKEN" ]]; then
  HEADER_ARGS+=( -H "Authorization: Bearer ${AUTH_BEARER_TOKEN}" )
fi

if [[ -n "$HOUSEHOLD_ID" ]]; then
  HEADER_ARGS+=( -H "x-household-id: ${HOUSEHOLD_ID}" )
elif [[ -n "$AUTH_BEARER_TOKEN" || -n "$AUTH_EMAIL" ]]; then
  HOUSEHOLDS_BODY_FILE="$(mktemp /tmp/home_inventory_restore_households.XXXXXX.json)"
  households_status=$(curl -sS "${AUTH_ARGS[@]}" "${HEADER_ARGS[@]}" "${SESSION_ARGS[@]}" \
    -o "$HOUSEHOLDS_BODY_FILE" \
    -w "%{http_code}" \
    "$BASE_URL/households")

  if [[ "$households_status" == "200" ]]; then
    read -r household_count first_household_id < <(node -e '
const fs = require("node:fs");
try {
  const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const households = Array.isArray(payload?.households) ? payload.households : [];
  const first = households[0] && typeof households[0].id === "string" ? households[0].id : "";
  process.stdout.write(`${households.length} ${first}`);
} catch {
  process.stdout.write("0 ");
}
' "$HOUSEHOLDS_BODY_FILE")

    if [[ "$household_count" == "1" && -n "$first_household_id" ]]; then
      HEADER_ARGS+=( -H "x-household-id: ${first_household_id}" )
      echo "Using discovered household scope: ${first_household_id}"
    elif [[ "$household_count" -gt 1 ]]; then
      echo "Multiple households detected. Set HOUSEHOLD_ID explicitly for deterministic restore drills." >&2
      exit 1
    fi
  elif [[ "$households_status" == "401" || "$households_status" == "403" ]]; then
    echo "Failed to resolve household scope: HTTP $households_status from /households." >&2
    cat "$HOUSEHOLDS_BODY_FILE" >&2 || true
    exit 1
  fi
fi

if [[ -z "$BACKUP_FILE" ]]; then
  cleanup_file="$(mktemp -t inventory-restore-drill-XXXXXX.json)"
  BACKUP_FILE="$cleanup_file"
  curl -fsS "${AUTH_ARGS[@]}" "${HEADER_ARGS[@]}" "${SESSION_ARGS[@]}" "$BASE_URL/export/inventory" -o "$BACKUP_FILE"

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

http_status=$(curl -sS "${AUTH_ARGS[@]}" "${HEADER_ARGS[@]}" "${SESSION_ARGS[@]}" -o /tmp/home_inventory_restore_drill.json -w "%{http_code}" \
  -X POST "$import_url" \
  -H "Content-Type: application/json" \
  --data-binary "@$BACKUP_FILE")

if [[ "$http_status" != "200" ]]; then
  echo "[FAIL] Restore drill failed with HTTP $http_status" >&2
  cat /tmp/home_inventory_restore_drill.json >&2 || true
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
