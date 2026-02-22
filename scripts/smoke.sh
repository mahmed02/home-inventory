#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-}"
QUERY="${QUERY:-tool}"
CHECK_UPLOADS="${CHECK_UPLOADS:-false}"
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
  echo "BASE_URL is required (example: BASE_URL=https://staging-api.example.com)" >&2
  exit 1
fi

BASE_URL="${BASE_URL%/}"

assert_status_200() {
  local name="$1"
  local url="$2"

  local status
  status=$(curl -sS "${AUTH_ARGS[@]}" -o /tmp/home_inventory_smoke_body.json -w "%{http_code}" "$url")

  if [[ "$status" != "200" ]]; then
    echo "[FAIL] $name returned HTTP $status" >&2
    cat /tmp/home_inventory_smoke_body.json >&2 || true
    exit 1
  fi

  echo "[OK] $name"
}

assert_json_contains() {
  local name="$1"
  local pattern="$2"
  if ! grep -q "$pattern" /tmp/home_inventory_smoke_body.json; then
    echo "[FAIL] $name response missing pattern: $pattern" >&2
    cat /tmp/home_inventory_smoke_body.json >&2 || true
    exit 1
  fi
}

echo "Running smoke checks against: $BASE_URL"

assert_status_200 "Health" "$BASE_URL/health"
assert_json_contains "Health" '"ok":true'

assert_status_200 "Search" "$BASE_URL/items/search?q=${QUERY}&limit=1&offset=0"
assert_json_contains "Search" '"ok":true'
assert_json_contains "Search" '"results"'

assert_status_200 "Siri lookup" "$BASE_URL/api/items/lookup?q=${QUERY}"
assert_json_contains "Siri lookup" '"item"'
assert_json_contains "Siri lookup" '"location_path"'

if [[ "$CHECK_UPLOADS" == "true" ]]; then
  status=$(curl -sS -o /tmp/home_inventory_smoke_body.json -w "%{http_code}" \
    "${AUTH_ARGS[@]}" \
    -X POST "$BASE_URL/uploads/presign" \
    -H "Content-Type: application/json" \
    -d '{"filename":"smoke.jpg","content_type":"image/jpeg","scope":"item"}')

  if [[ "$status" != "200" ]]; then
    echo "[FAIL] Upload presign returned HTTP $status" >&2
    cat /tmp/home_inventory_smoke_body.json >&2 || true
    exit 1
  fi

  assert_json_contains "Upload presign" '"ok":true'
  assert_json_contains "Upload presign" '"upload_url"'
  assert_json_contains "Upload presign" '"image_url"'
  echo "[OK] Upload presign"
else
  echo "[SKIP] Upload presign check (set CHECK_UPLOADS=true to enable)"
fi

echo "Smoke checks passed."
