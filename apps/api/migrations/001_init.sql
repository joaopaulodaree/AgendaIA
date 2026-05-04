CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'profissional')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  is_all_day boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'tentative', 'cancelled')),
  external_provider text,
  external_event_id text,
  sync_direction text NOT NULL DEFAULT 'bidirectional' CHECK (sync_direction IN ('local_to_external', 'external_to_local', 'bidirectional')),
  sync_status text NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'error')),
  last_synced_at timestamptz,
  sync_error text,
  sync_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_events_time_window_check CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS app_events_external_lookup
  ON app_events (external_provider, external_event_id)
  WHERE external_provider IS NOT NULL AND external_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS app_events_owner_range_idx
  ON app_events (owner_user_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS app_event_recurrence (
  event_id uuid PRIMARY KEY REFERENCES app_events(id) ON DELETE CASCADE,
  rrule text NOT NULL,
  timezone text NOT NULL,
  dtstart timestamptz NOT NULL,
  until_at timestamptz,
  count integer CHECK (count IS NULL OR count > 0),
  exdates timestamptz[] NOT NULL DEFAULT '{}'::timestamptz[]
);

CREATE TABLE IF NOT EXISTS app_event_participants (
  event_id uuid NOT NULL REFERENCES app_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  response_status text NOT NULL DEFAULT 'needs_action' CHECK (response_status IN ('needs_action', 'accepted', 'declined', 'tentative')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS app_event_resources (
  event_id uuid NOT NULL REFERENCES app_events(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES app_resources(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, resource_id)
);
