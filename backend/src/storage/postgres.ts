import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

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
  const schemaPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'schema.sql'
  );
  // In production the compiled file lives in dist/storage/ — ship schema next to it.
  const candidates = [
    schemaPath,
    path.resolve(process.cwd(), 'src/storage/schema.sql'),
    path.resolve(process.cwd(), 'dist/storage/schema.sql'),
  ];

  let sql: string | null = null;
  for (const candidate of candidates) {
    try {
      sql = await fs.readFile(candidate, 'utf8');
      break;
    } catch {
      // try next
    }
  }
  if (!sql) {
    throw new Error('Postgres schema.sql not found');
  }

  await query(sql);
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
