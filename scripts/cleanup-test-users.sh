#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set" >&2
  exit 1
fi

psql "$DATABASE_URL" -c "DELETE FROM users WHERE email LIKE 'verify%test.com' OR email LIKE 'step2test%example.com' OR email LIKE 'test-%@example.com' OR email IN ('verify1@test.com','verify2@test.com','verify3@test.com','verify4@test.com','verify5@test.com','step2test2@example.com','bob@test.com');"

echo "Cleanup complete"
