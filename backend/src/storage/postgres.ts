import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

/** Embedded so Docker images never miss schema.sql on disk. */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY,
  phone_e164    TEXT NOT NULL,
  phone_lookup  TEXT NOT NULL UNIQUE,
  name          TEXT,
  device_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);

-- Upgrade path if an older users table exists without phone_lookup
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_lookup TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_lookup_uidx ON users (phone_lookup);

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
`;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      host: env.dbHost,
      port: env.dbPort,
      database: env.dbName,
      user: env.dbUser,
      password: env.dbPassword,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (err) => {
      console.error('[postgres] idle client error', err);
    });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/** Create tables if missing (idempotent). */
export async function migratePostgres(): Promise<void> {
  await query(SCHEMA_SQL);
  // Verify the critical table exists
  const { rows } = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'users'
     ) AS exists`
  );
  if (!rows[0]?.exists) {
    throw new Error('Migration ran but public.users still missing — check DB privileges');
  }
}

export async function checkPostgres(): Promise<{ ok: boolean; detail?: string }> {
  try {
    await query('SELECT 1 AS ok');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function closePostgres(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
