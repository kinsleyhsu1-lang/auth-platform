-- Step 6: lockout + refresh token salt per user

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failed_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lockout_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refresh_token_salt TEXT;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS refresh_token_lookup TEXT;

-- Backfill salt
UPDATE users
SET refresh_token_salt = gen_random_uuid()::text
WHERE refresh_token_salt IS NULL;

ALTER TABLE users
  ALTER COLUMN refresh_token_salt SET NOT NULL,
  ALTER COLUMN refresh_token_salt SET DEFAULT gen_random_uuid()::text;
