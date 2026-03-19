#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <email>" >&2
  exit 1
fi

EMAIL=$1

resp=$(curl -sS -X POST http://localhost:3000/request-reset \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\"}")

echo "$resp"

reset_token=$(printf '%s' "$resp" | sed -n 's/.*"reset_token":"\([^"]*\)".*/\1/p')

if [[ -z "$reset_token" ]]; then
  echo "No reset token returned (user may not exist)" >&2
  exit 0
fi

echo "Reset link (stub): http://localhost:3000/reset?token=$reset_token"
