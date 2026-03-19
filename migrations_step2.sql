-- Step 2: refresh token hashing + reuse detection

-- Add columns for hashed token and reuse tracking
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS refresh_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replaced_by UUID;

-- Backfill legacy SHA-256 hash from existing refresh_token (if any).
-- New code uses HMAC-SHA256 and will upgrade legacy hashes on use.
UPDATE sessions
SET refresh_token_hash = encode(digest(refresh_token, 'sha256'), 'hex')
WHERE refresh_token_hash IS NULL AND refresh_token IS NOT NULL;

-- Enforce hash presence for new rows
ALTER TABLE sessions
  ALTER COLUMN refresh_token_hash SET NOT NULL;

-- Optional: keep refresh_token for now (compat). Remove later if desired.

-- Index for lookup by hash
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_refresh_token_hash ON sessions(refresh_token_hash);

COMMENT ON INDEX idx_sessions_refresh_token_hash IS 'Lookup by hashed refresh token (SHA-256).';
