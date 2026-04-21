ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_reset_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;
