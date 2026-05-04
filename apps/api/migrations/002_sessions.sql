CREATE TABLE IF NOT EXISTS app_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_sessions_user_id_idx
  ON app_sessions (user_id);

CREATE INDEX IF NOT EXISTS app_sessions_expires_at_idx
  ON app_sessions (expires_at);
