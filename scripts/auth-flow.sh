#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:3000}
EMAIL=${EMAIL:-test-$(date +%s)@example.com}
NAME=${NAME:-TestUser}
PASSWORD=${PASSWORD:-StrongPass#123}

json_extract() {
  local key=$1
  sed -n "s/.*\"$key\":\"\([^\"]*\)\".*/\1/p"
}

echo "== DB test =="
curl -sS -i "$BASE_URL/db-test"

echo

echo "== Cleanup expired sessions =="
curl -sS -i -X POST "$BASE_URL/sessions/cleanup"

echo

echo "== Register =="
register_resp=$(curl -sS -X POST "$BASE_URL/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"name\":\"$NAME\",\"password\":\"$PASSWORD\"}")

echo "$register_resp"

echo

echo "== Login =="
login_resp=$(curl -sS -X POST "$BASE_URL/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

echo "$login_resp"

access_token=$(printf '%s' "$login_resp" | json_extract access_token)
refresh_token=$(printf '%s' "$login_resp" | json_extract refresh_token)

if [[ -z "$access_token" || -z "$refresh_token" ]]; then
  echo "Failed to get tokens" >&2
  exit 1
fi

echo

echo "== /me =="
curl -sS -i -H "Authorization: Bearer $access_token" "$BASE_URL/me"

echo

echo "== Refresh (rotate) =="
refresh_resp=$(curl -sS -X POST "$BASE_URL/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$refresh_token\"}")

echo "$refresh_resp"

new_refresh_token=$(printf '%s' "$refresh_resp" | json_extract refresh_token)

if [[ -z "$new_refresh_token" ]]; then
  echo "Failed to rotate refresh token" >&2
  exit 1
fi

echo

echo "== Logout =="
curl -sS -i -X POST "$BASE_URL/logout" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$new_refresh_token\"}"

echo

echo "Done. Email used: $EMAIL"
