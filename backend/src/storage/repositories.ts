import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import type {
  AppConfig,
  AuthUser,
  OtpRecord,
  SessionRecord,
  TrialRecord,
} from '../types.js';
import { createFileCollection } from './fileCollection.js';
import {
  ddbDelete,
  ddbGet,
  ddbPut,
  ddbQueryByGsi1,
  epochSeconds,
} from './dynamo.js';
import {
  checkPostgres,
  migratePostgres,
  query,
} from './postgres.js';

const driver = env.storageDriver;

/**
 * Boot-time connectivity probe + schema migrate for Postgres.
 */
export async function checkStorage(): Promise<{
  driver: 'file' | 'dynamodb' | 'postgres';
  ok: boolean;
  detail?: string;
}> {
  if (driver === 'file') return { driver: 'file', ok: true };

  if (driver === 'dynamodb') {
    try {
      await ddbGet('HEALTH#probe', 'HEALTH');
      return { driver: 'dynamodb', ok: true };
    } catch (err) {
      return {
        driver: 'dynamodb',
        ok: false,
        detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      };
    }
  }

  try {
    await migratePostgres();
    const probe = await checkPostgres();
    return { driver: 'postgres', ...probe };
  } catch (err) {
    return {
      driver: 'postgres',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ----------------------------- Users ----------------------------- */

export interface UsersRepo {
  getById(id: string): Promise<AuthUser | null>;
  findByPhone(phoneE164: string): Promise<AuthUser | null>;
  put(user: AuthUser): Promise<void>;
}

function toUser(item: Record<string, unknown> | AuthUser): AuthUser {
  const u = item as AuthUser;
  return {
    id: u.id,
    phoneE164: u.phoneE164,
    name: u.name,
    deviceIds: u.deviceIds ?? [],
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

function mapUserRow(row: {
  id: string;
  phone_e164: string;
  name: string | null;
  device_ids: string[] | unknown;
  created_at: Date | string;
  updated_at: Date | string;
}): AuthUser {
  const deviceIds = Array.isArray(row.device_ids)
    ? (row.device_ids as string[])
    : [];
  return {
    id: row.id,
    phoneE164: row.phone_e164,
    name: row.name ?? undefined,
    deviceIds,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const fileUsersRepo = (): UsersRepo => {
  const c = createFileCollection<AuthUser>('users.json');
  return {
    getById: (id) => c.get(id),
    async findByPhone(phoneE164) {
      const all = await c.values();
      return all.find((u) => u.phoneE164 === phoneE164) ?? null;
    },
    put: (user) => c.put(user.id, user),
  };
};

const dynamoUsersRepo = (): UsersRepo => ({
  async getById(id) {
    const item = await ddbGet<AuthUser>(`USER#${id}`, 'USER');
    return item ? toUser(item) : null;
  },
  async findByPhone(phoneE164) {
    const items = await ddbQueryByGsi1<AuthUser>(`PHONE#${phoneE164}`);
    return items.length ? toUser(items[0]) : null;
  },
  async put(user) {
    await ddbPut({
      pk: `USER#${user.id}`,
      sk: 'USER',
      gsi1pk: `PHONE#${user.phoneE164}`,
      ...user,
    });
  },
});

const postgresUsersRepo = (): UsersRepo => ({
  async getById(id) {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? mapUserRow(rows[0] as Parameters<typeof mapUserRow>[0]) : null;
  },
  async findByPhone(phoneE164) {
    const { rows } = await query('SELECT * FROM users WHERE phone_e164 = $1', [
      phoneE164,
    ]);
    return rows[0] ? mapUserRow(rows[0] as Parameters<typeof mapUserRow>[0]) : null;
  },
  async put(user) {
    await query(
      `INSERT INTO users (id, phone_e164, name, device_ids, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         phone_e164 = EXCLUDED.phone_e164,
         name = EXCLUDED.name,
         device_ids = EXCLUDED.device_ids,
         updated_at = EXCLUDED.updated_at`,
      [
        user.id,
        user.phoneE164,
        user.name ?? null,
        JSON.stringify(user.deviceIds ?? []),
        user.createdAt,
        user.updatedAt,
      ]
    );
  },
});

export const usersRepo: UsersRepo =
  driver === 'postgres'
    ? postgresUsersRepo()
    : driver === 'dynamodb'
      ? dynamoUsersRepo()
      : fileUsersRepo();

/* ------------------------------ OTPs ------------------------------ */

export interface OtpsRepo {
  get(phoneE164: string): Promise<OtpRecord | null>;
  put(record: OtpRecord): Promise<void>;
  delete(phoneE164: string): Promise<void>;
}

function mapOtpRow(row: {
  phone_e164: string;
  code_hash: string;
  mode: 'login' | 'register';
  name: string | null;
  device_id: string | null;
  attempts: number;
  expires_at: Date | string;
  created_at: Date | string;
}): OtpRecord {
  return {
    phoneE164: row.phone_e164,
    codeHash: row.code_hash,
    mode: row.mode,
    name: row.name ?? undefined,
    deviceId: row.device_id ?? undefined,
    attempts: row.attempts,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

const fileOtpsRepo = (): OtpsRepo => {
  const c = createFileCollection<OtpRecord>('otps.json');
  return {
    get: (phone) => c.get(phone),
    put: (record) => c.put(record.phoneE164, record),
    delete: (phone) => c.delete(phone),
  };
};

const dynamoOtpsRepo = (): OtpsRepo => ({
  get: (phone) => ddbGet<OtpRecord>(`OTP#${phone}`, 'OTP'),
  async put(record) {
    await ddbPut({
      pk: `OTP#${record.phoneE164}`,
      sk: 'OTP',
      ttl: epochSeconds(record.expiresAt),
      ...record,
    });
  },
  delete: (phone) => ddbDelete(`OTP#${phone}`, 'OTP'),
});

const postgresOtpsRepo = (): OtpsRepo => ({
  async get(phoneE164) {
    const { rows } = await query('SELECT * FROM otps WHERE phone_e164 = $1', [
      phoneE164,
    ]);
    return rows[0] ? mapOtpRow(rows[0] as Parameters<typeof mapOtpRow>[0]) : null;
  },
  async put(record) {
    await query(
      `INSERT INTO otps (phone_e164, code_hash, mode, name, device_id, attempts, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (phone_e164) DO UPDATE SET
         code_hash = EXCLUDED.code_hash,
         mode = EXCLUDED.mode,
         name = EXCLUDED.name,
         device_id = EXCLUDED.device_id,
         attempts = EXCLUDED.attempts,
         expires_at = EXCLUDED.expires_at,
         created_at = EXCLUDED.created_at`,
      [
        record.phoneE164,
        record.codeHash,
        record.mode,
        record.name ?? null,
        record.deviceId ?? null,
        record.attempts,
        record.expiresAt,
        record.createdAt,
      ]
    );
  },
  async delete(phoneE164) {
    await query('DELETE FROM otps WHERE phone_e164 = $1', [phoneE164]);
  },
});

export const otpsRepo: OtpsRepo =
  driver === 'postgres'
    ? postgresOtpsRepo()
    : driver === 'dynamodb'
      ? dynamoOtpsRepo()
      : fileOtpsRepo();

/* ---------------------------- Sessions ---------------------------- */

export interface SessionsRepo {
  get(token: string): Promise<SessionRecord | null>;
  put(record: SessionRecord): Promise<void>;
  delete(token: string): Promise<void>;
}

function mapSessionRow(row: {
  token: string;
  user_id: string;
  created_at: Date | string;
  expires_at: Date | string;
}): SessionRecord {
  return {
    token: row.token,
    userId: row.user_id,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

const fileSessionsRepo = (): SessionsRepo => {
  const c = createFileCollection<SessionRecord>('sessions.json');
  return {
    get: (token) => c.get(token),
    put: (record) => c.put(record.token, record),
    delete: (token) => c.delete(token),
  };
};

const dynamoSessionsRepo = (): SessionsRepo => ({
  get: (token) => ddbGet<SessionRecord>(`SESSION#${token}`, 'SESSION'),
  async put(record) {
    await ddbPut({
      pk: `SESSION#${record.token}`,
      sk: 'SESSION',
      ttl: epochSeconds(record.expiresAt),
      ...record,
    });
  },
  delete: (token) => ddbDelete(`SESSION#${token}`, 'SESSION'),
});

const postgresSessionsRepo = (): SessionsRepo => ({
  async get(token) {
    const { rows } = await query('SELECT * FROM sessions WHERE token = $1', [
      token,
    ]);
    return rows[0]
      ? mapSessionRow(rows[0] as Parameters<typeof mapSessionRow>[0])
      : null;
  },
  async put(record) {
    await query(
      `INSERT INTO sessions (token, user_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (token) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         created_at = EXCLUDED.created_at,
         expires_at = EXCLUDED.expires_at`,
      [record.token, record.userId, record.createdAt, record.expiresAt]
    );
  },
  async delete(token) {
    await query('DELETE FROM sessions WHERE token = $1', [token]);
  },
});

export const sessionsRepo: SessionsRepo =
  driver === 'postgres'
    ? postgresSessionsRepo()
    : driver === 'dynamodb'
      ? dynamoSessionsRepo()
      : fileSessionsRepo();

/* ----------------------------- Trials ----------------------------- */

export interface TrialsRepo {
  get(deviceId: string): Promise<TrialRecord | null>;
  put(record: TrialRecord): Promise<void>;
}

function mapTrialRow(row: {
  device_id: string;
  start_date_iso: Date | string;
  claimed_at: Date | string;
}): TrialRecord {
  return {
    deviceId: row.device_id,
    startDateIso: new Date(row.start_date_iso).toISOString(),
    claimedAt: new Date(row.claimed_at).toISOString(),
  };
}

const fileTrialsRepo = (): TrialsRepo => {
  const c = createFileCollection<TrialRecord>('trials.json');
  return {
    get: (deviceId) => c.get(deviceId),
    put: (record) => c.put(record.deviceId, record),
  };
};

const dynamoTrialsRepo = (): TrialsRepo => ({
  get: (deviceId) => ddbGet<TrialRecord>(`TRIAL#${deviceId}`, 'TRIAL'),
  async put(record) {
    await ddbPut({
      pk: `TRIAL#${record.deviceId}`,
      sk: 'TRIAL',
      ...record,
    });
  },
});

const postgresTrialsRepo = (): TrialsRepo => ({
  async get(deviceId) {
    const { rows } = await query('SELECT * FROM trials WHERE device_id = $1', [
      deviceId,
    ]);
    return rows[0]
      ? mapTrialRow(rows[0] as Parameters<typeof mapTrialRow>[0])
      : null;
  },
  async put(record) {
    await query(
      `INSERT INTO trials (device_id, start_date_iso, claimed_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (device_id) DO UPDATE SET
         start_date_iso = EXCLUDED.start_date_iso,
         claimed_at = EXCLUDED.claimed_at`,
      [record.deviceId, record.startDateIso, record.claimedAt]
    );
  },
});

export const trialsRepo: TrialsRepo =
  driver === 'postgres'
    ? postgresTrialsRepo()
    : driver === 'dynamodb'
      ? dynamoTrialsRepo()
      : fileTrialsRepo();

/* ----------------------------- Config ----------------------------- */

export interface ConfigRepo {
  get(): Promise<AppConfig | null>;
  put(config: AppConfig): Promise<void>;
}

const fileConfigRepo = (): ConfigRepo => {
  const configPath = (): string => path.join(env.dataDir, 'config.json');
  return {
    async get() {
      try {
        const raw = await fs.readFile(configPath(), 'utf8');
        return JSON.parse(raw) as AppConfig;
      } catch {
        return null;
      }
    },
    async put(config) {
      await fs.mkdir(env.dataDir, { recursive: true });
      await fs.writeFile(configPath(), JSON.stringify(config, null, 2), 'utf8');
    },
  };
};

const dynamoConfigRepo = (): ConfigRepo => ({
  async get() {
    const item = await ddbGet<AppConfig & { pk?: string; sk?: string }>(
      'CONFIG',
      'CONFIG'
    );
    if (!item) return null;
    const { pk: _pk, sk: _sk, ...config } = item;
    return config as AppConfig;
  },
  put: (config) => ddbPut({ pk: 'CONFIG', sk: 'CONFIG', ...config }),
});

const postgresConfigRepo = (): ConfigRepo => ({
  async get() {
    const { rows } = await query<{ config: AppConfig }>(
      'SELECT config FROM app_config WHERE id = 1'
    );
    return rows[0]?.config ?? null;
  },
  async put(config) {
    await query(
      `INSERT INTO app_config (id, config, updated_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET
         config = EXCLUDED.config,
         updated_at = NOW()`,
      [JSON.stringify(config)]
    );
  },
});

export const configRepo: ConfigRepo =
  driver === 'postgres'
    ? postgresConfigRepo()
    : driver === 'dynamodb'
      ? dynamoConfigRepo()
      : fileConfigRepo();
