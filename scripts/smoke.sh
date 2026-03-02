#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-}"
QUERY="${QUERY:-tool}"
QUANTITY_QUERY="${QUANTITY_QUERY:-$QUERY}"
CHECK_UPLOADS="${CHECK_UPLOADS:-false}"
CHECK_QUANTITY="${CHECK_QUANTITY:-false}"
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

cleanup_temp_files() {
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
fi

if [[ -n "$AUTH_BEARER_TOKEN" && ( -n "$AUTH_EMAIL" || -n "$AUTH_PASSWORD" ) ]]; then
  echo "Use either AUTH_BEARER_TOKEN or AUTH_EMAIL/AUTH_PASSWORD, not both." >&2
  exit 1
fi

if [[ -n "$AUTH_BEARER_TOKEN" && ( -n "$BASIC_AUTH_USER" || -n "$BASIC_AUTH_PASS" ) ]]; then
  echo "AUTH_BEARER_TOKEN cannot be used with BASIC_AUTH_USER/BASIC_AUTH_PASS (Authorization header conflict)." >&2
  exit 1
fi

if [[ -n "$BASIC_AUTH_USER" ]]; then
  AUTH_ARGS=(-u "${BASIC_AUTH_USER}:${BASIC_AUTH_PASS}")
fi

if [[ -n "$AUTH_EMAIL" || -n "$AUTH_PASSWORD" ]]; then
  if [[ -z "$AUTH_EMAIL" || -z "$AUTH_PASSWORD" ]]; then
    echo "Both AUTH_EMAIL and AUTH_PASSWORD are required when using user-account auth." >&2
    exit 1
  fi
fi

if [[ -z "$BASE_URL" ]]; then
  echo "BASE_URL is required (example: BASE_URL=https://staging-api.example.com)" >&2
  exit 1
fi

BASE_URL="${BASE_URL%/}"

if [[ -n "$AUTH_EMAIL" ]]; then
  COOKIE_JAR="$(mktemp /tmp/home_inventory_smoke_cookie.XXXXXX)"
  LOGIN_BODY_FILE="$(mktemp /tmp/home_inventory_smoke_login.XXXXXX.json)"
  login_payload=$(node -e 'process.stdout.write(JSON.stringify({ email: process.argv[1], password: process.argv[2] }));' "$AUTH_EMAIL" "$AUTH_PASSWORD")
  login_status=$(curl -sS "${AUTH_ARGS[@]}" -c "$COOKIE_JAR" -o "$LOGIN_BODY_FILE" -w "%{http_code}" \
    -X POST "$BASE_URL/auth/login" \
    -H "Content-Type: application/json" \
    --data "$login_payload")

  if [[ "$login_status" != "200" ]]; then
    echo "Login failed with HTTP $login_status while preparing smoke auth context." >&2
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
  HOUSEHOLDS_BODY_FILE="$(mktemp /tmp/home_inventory_smoke_households.XXXXXX.json)"
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
      echo "Multiple households detected. Set HOUSEHOLD_ID explicitly for deterministic smoke checks." >&2
      exit 1
    fi
  elif [[ "$households_status" == "401" || "$households_status" == "403" ]]; then
    echo "Failed to resolve household scope: HTTP $households_status from /households." >&2
    cat "$HOUSEHOLDS_BODY_FILE" >&2 || true
    exit 1
  fi
fi

urlencode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1] || ""))' "$1"
}

request_http_status() {
  local method="$1"
  local url="$2"
  local body="${3:-}"

  local curl_args
  curl_args=( -sS "${AUTH_ARGS[@]}" "${HEADER_ARGS[@]}" "${SESSION_ARGS[@]}" -o /tmp/home_inventory_smoke_body.json -w "%{http_code}" -X "$method" )

  if [[ -n "$body" ]]; then
    curl_args+=( -H "Content-Type: application/json" --data "$body" )
  fi

  curl_args+=( "$url" )
  curl "${curl_args[@]}"
}

assert_status_200() {
  local name="$1"
  local method="$2"
  local url="$3"
  local body="${4:-}"

  local status
  if [[ -n "$body" ]]; then
    status=$(request_http_status "$method" "$url" "$body")
  else
    status=$(request_http_status "$method" "$url")
  fi

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

extract_data_field() {
  local field="$1"
  node - "$field" <<'NODE'
const fs = require("fs");
const field = process.argv[2];
const payload = JSON.parse(fs.readFileSync("/tmp/home_inventory_smoke_body.json", "utf8"));
const data = payload && typeof payload === "object" && payload.ok ? payload.data : payload;
if (!data || typeof data !== "object") {
  process.exit(1);
}
const value = data[field];
if (value === undefined) {
  process.exit(1);
}
if (value === null) {
  process.stdout.write("null");
} else {
  process.stdout.write(String(value));
}
NODE
}

extract_first_result_field() {
  local field="$1"
  node - "$field" <<'NODE'
const fs = require("fs");
const field = process.argv[2];
const payload = JSON.parse(fs.readFileSync("/tmp/home_inventory_smoke_body.json", "utf8"));
const data = payload && typeof payload === "object" && payload.ok ? payload.data : payload;
const first = data && Array.isArray(data.results) ? data.results[0] : null;
if (!first || typeof first !== "object") {
  process.exit(1);
}
const value = first[field];
if (value === undefined || value === null || String(value).length === 0) {
  process.exit(1);
}
process.stdout.write(String(value));
NODE
}

echo "Running smoke checks against: $BASE_URL"

assert_status_200 "Health" "GET" "$BASE_URL/health"
assert_json_contains "Health" '"ok":true'

SEARCH_QUERY_ENCODED=$(urlencode "$QUERY")
assert_status_200 "Search" "GET" "$BASE_URL/items/search?q=${SEARCH_QUERY_ENCODED}&limit=1&offset=0"
assert_json_contains "Search" '"ok":true'
assert_json_contains "Search" '"results"'

assert_status_200 "Siri lookup" "GET" "$BASE_URL/api/items/lookup?q=${SEARCH_QUERY_ENCODED}"
assert_json_contains "Siri lookup" '"item"'
assert_json_contains "Siri lookup" '"location_path"'

if [[ "$CHECK_QUANTITY" == "true" ]]; then
  QUANTITY_QUERY_ENCODED=$(urlencode "$QUANTITY_QUERY")
  assert_status_200 "Quantity seed search" "GET" "$BASE_URL/items/search?q=${QUANTITY_QUERY_ENCODED}&limit=1&offset=0"

  ITEM_ID=$(extract_first_result_field "id") || {
    echo "[FAIL] Quantity seed search did not return a usable item id" >&2
    exit 1
  }
  ITEM_NAME=$(extract_first_result_field "name") || {
    echo "[FAIL] Quantity seed search did not return a usable item name" >&2
    exit 1
  }

  assert_status_200 "Quantity read" "GET" "$BASE_URL/items/${ITEM_ID}/quantity"
  INITIAL_QUANTITY=$(extract_data_field "quantity") || {
    echo "[FAIL] Quantity read response did not include quantity" >&2
    exit 1
  }

  assert_status_200 "Quantity add" "PATCH" "$BASE_URL/items/${ITEM_ID}/quantity" '{"op":"add","amount":1}'
  assert_json_contains "Quantity add" '"quantity"'

  assert_status_200 "Quantity remove" "PATCH" "$BASE_URL/items/${ITEM_ID}/quantity" '{"op":"remove","amount":1}'
  assert_json_contains "Quantity remove" '"quantity"'

  DRY_RUN_QUERY=$(urlencode "add 1 ${ITEM_NAME}")
  assert_status_200 "Siri quantity dry run" "GET" "$BASE_URL/api/items/lookup?q=${DRY_RUN_QUERY}"
  assert_json_contains "Siri quantity dry run" '"requires_confirmation":true'

  IDEMPOTENCY_KEY="smoke-$(date +%s)-$RANDOM"
  assert_status_200 "Siri quantity confirmed add" "GET" "$BASE_URL/api/items/lookup?q=${DRY_RUN_QUERY}&confirm=true&idempotency_key=${IDEMPOTENCY_KEY}"
  assert_json_contains "Siri quantity confirmed add" '"quantity_operation":"add"'
  FIRST_CONFIRMED_QUANTITY=$(extract_data_field "quantity") || {
    echo "[FAIL] Siri quantity confirmed add response missing quantity" >&2
    exit 1
  }

  assert_status_200 "Siri quantity idempotent replay" "GET" "$BASE_URL/api/items/lookup?q=${DRY_RUN_QUERY}&confirm=true&idempotency_key=${IDEMPOTENCY_KEY}"
  SECOND_CONFIRMED_QUANTITY=$(extract_data_field "quantity") || {
    echo "[FAIL] Siri quantity idempotent replay response missing quantity" >&2
    exit 1
  }
  if [[ "$FIRST_CONFIRMED_QUANTITY" != "$SECOND_CONFIRMED_QUANTITY" ]]; then
    echo "[FAIL] Siri idempotent replay changed quantity unexpectedly" >&2
    cat /tmp/home_inventory_smoke_body.json >&2 || true
    exit 1
  fi

  RESTORE_REMOVE_QUERY=$(urlencode "remove 1 ${ITEM_NAME}")
  assert_status_200 "Siri quantity restore remove" "GET" "$BASE_URL/api/items/lookup?q=${RESTORE_REMOVE_QUERY}&confirm=true&idempotency_key=${IDEMPOTENCY_KEY}-restore"

  if [[ "$INITIAL_QUANTITY" == "null" ]]; then
    assert_status_200 "Quantity restore null" "PATCH" "$BASE_URL/items/${ITEM_ID}" '{"quantity":null}'
  else
    assert_status_200 "Quantity restore set" "PATCH" "$BASE_URL/items/${ITEM_ID}/quantity" "{\"op\":\"set\",\"quantity\":${INITIAL_QUANTITY}}"
  fi

  echo "[OK] Quantity checks"
else
  echo "[SKIP] Quantity checks (set CHECK_QUANTITY=true to enable)"
fi

if [[ "$CHECK_UPLOADS" == "true" ]]; then
  status=$(request_http_status "POST" "$BASE_URL/uploads/presign" '{"filename":"smoke.jpg","content_type":"image/jpeg","scope":"item"}')

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
