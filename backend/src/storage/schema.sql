-- Embrace HD — PostgreSQL schema (idempotent)

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY,
  phone_e164    TEXT NOT NULL,
  phone_lookup  TEXT NOT NULL UNIQUE,
  name          TEXT,
  device_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_inbound_whatsapp_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_inbound_whatsapp_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS otps (
  phone_lookup  TEXT PRIMARY KEY,
  phone_e164    TEXT NOT NULL,
  code_hash     TEXT NOT NULL,
  mode          TEXT NOT NULL CHECK (mode IN ('login', 'register')),
  name          TEXT,
  device_id     TEXT,
  attempts      INT NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token         TEXT PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS trials (
  device_id       TEXT PRIMARY KEY,
  start_date_iso  TIMESTAMPTZ NOT NULL,
  claimed_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS app_config (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config      JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS export_jobs (
  job_id              UUID PRIMARY KEY,
  status              TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'done', 'failed')),
  error               TEXT,
  filename            TEXT,
  download_path       TEXT,
  preset              TEXT NOT NULL,
  status_length_sec   INT NOT NULL,
  delivery            TEXT NOT NULL,
  size_bytes          BIGINT,
  created_at          TIMESTAMPTZ NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS export_jobs_status_idx ON export_jobs (status);
CREATE INDEX IF NOT EXISTS export_jobs_updated_at_idx ON export_jobs (updated_at);
