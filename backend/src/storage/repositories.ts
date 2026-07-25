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
import {
  decryptPhone,
  encryptPhone,
  isEncryptedPhone,
  phoneLookupHash,
} from '../services/phoneCrypto.js';

const driver = env.storageDriver;

type StoredUser = AuthUser & { phoneLookup: string };

function toPublicUser(stored: StoredUser): AuthUser {
  return {
    id: stored.id,
    phoneE164: decryptPhone(stored.phoneE164),
    name: stored.name,
    deviceIds: stored.deviceIds ?? [],
    lastInboundWhatsAppAt: stored.lastInboundWhatsAppAt,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

function toStoredUser(user: AuthUser): StoredUser {
  const plain = user.phoneE164;
  return {
    ...user,
    phoneE164: isEncryptedPhone(plain) ? plain : encryptPhone(plain),
    phoneLookup: phoneLookupHash(
      isEncryptedPhone(plain) ? decryptPhone(plain) : plain
    ),
  };
}

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
    await reencryptLegacyPostgresPhones();
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

/** Encrypt any legacy plaintext phone rows and fill phone_lookup. */
async function reencryptLegacyPostgresPhones(): Promise<void> {
  await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_e164_key`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_lookup TEXT`);
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS users_phone_lookup_uidx ON users (phone_lookup)`
  );

  const { rows } = await query<{
    id: string;
    phone_e164: string;
    phone_lookup: string | null;
  }>('SELECT id, phone_e164, phone_lookup FROM users');

  for (const row of rows) {
    const needsEncrypt = !isEncryptedPhone(row.phone_e164);
    const needsLookup = !row.phone_lookup;
    if (!needsEncrypt && !needsLookup) continue;

    const plain = decryptPhone(row.phone_e164);
    const cipher = needsEncrypt ? encryptPhone(plain) : row.phone_e164;
    const lookup = phoneLookupHash(plain);
    await query(
      `UPDATE users SET phone_e164 = $1, phone_lookup = $2 WHERE id = $3`,
      [cipher, lookup, row.id]
    );
  }

  // OTPs are short-lived — recreate with encrypted schema
  await query(`DROP TABLE IF EXISTS otps`);
  await query(`
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
    )
  `);
}

/* ----------------------------- Users ----------------------------- */

export interface UsersRepo {
  getById(id: string): Promise<AuthUser | null>;
  findByPhone(phoneE164: string): Promise<AuthUser | null>;
  put(user: AuthUser): Promise<void>;
}

function mapUserRow(row: {
  id: string;
  phone_e164: string;
  phone_lookup?: string | null;
  name: string | null;
  device_ids: string[] | unknown;
  last_inbound_whatsapp_at?: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}): AuthUser {
  const deviceIds = Array.isArray(row.device_ids)
    ? (row.device_ids as string[])
    : [];
  return {
    id: row.id,
    phoneE164: decryptPhone(row.phone_e164),
    name: row.name ?? undefined,
    deviceIds,
    lastInboundWhatsAppAt: row.last_inbound_whatsapp_at
      ? new Date(row.last_inbound_whatsapp_at).toISOString()
      : undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const fileUsersRepo = (): UsersRepo => {
  const c = createFileCollection<StoredUser>('users.json');
  return {
    async getById(id) {
      const stored = await c.get(id);
      return stored ? toPublicUser(stored) : null;
    },
    async findByPhone(phoneE164) {
      const lookup = phoneLookupHash(phoneE164);
      const all = await c.values();
      const stored = all.find((u) => u.phoneLookup === lookup) ?? null;
      return stored ? toPublicUser(stored) : null;
    },
    async put(user) {
      await c.put(user.id, toStoredUser(user));
    },
  };
};

const dynamoUsersRepo = (): UsersRepo => ({
  async getById(id) {
    const item = await ddbGet<StoredUser>(`USER#${id}`, 'USER');
    return item ? toPublicUser(item) : null;
  },
  async findByPhone(phoneE164) {
    const lookup = phoneLookupHash(phoneE164);
    const items = await ddbQueryByGsi1<StoredUser>(`PHONE#${lookup}`);
    return items.length ? toPublicUser(items[0]) : null;
  },
  async put(user) {
    const stored = toStoredUser(user);
    await ddbPut({
      pk: `USER#${stored.id}`,
      sk: 'USER',
      gsi1pk: `PHONE#${stored.phoneLookup}`,
      ...stored,
    });
  },
});

const postgresUsersRepo = (): UsersRepo => ({
  async getById(id) {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? mapUserRow(rows[0] as Parameters<typeof mapUserRow>[0]) : null;
  },
  async findByPhone(phoneE164) {
    const lookup = phoneLookupHash(phoneE164);
    const { rows } = await query('SELECT * FROM users WHERE phone_lookup = $1', [
      lookup,
    ]);
    return rows[0] ? mapUserRow(rows[0] as Parameters<typeof mapUserRow>[0]) : null;
  },
  async put(user) {
    const stored = toStoredUser(user);
    await query(
      `INSERT INTO users (
         id, phone_e164, phone_lookup, name, device_ids,
         last_inbound_whatsapp_at, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         phone_e164 = EXCLUDED.phone_e164,
         phone_lookup = EXCLUDED.phone_lookup,
         name = EXCLUDED.name,
         device_ids = EXCLUDED.device_ids,
         last_inbound_whatsapp_at = EXCLUDED.last_inbound_whatsapp_at,
         updated_at = EXCLUDED.updated_at`,
      [
        stored.id,
        stored.phoneE164,
        stored.phoneLookup,
        stored.name ?? null,
        JSON.stringify(stored.deviceIds ?? []),
        stored.lastInboundWhatsAppAt ?? null,
        stored.createdAt,
        stored.updatedAt,
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

type StoredOtp = OtpRecord & { phoneLookup: string };

function mapOtpRow(row: {
  phone_e164: string;
  phone_lookup?: string;
  code_hash: string;
  mode: 'login' | 'register';
  name: string | null;
  device_id: string | null;
  attempts: number;
  expires_at: Date | string;
  created_at: Date | string;
}): OtpRecord {
  return {
    phoneE164: decryptPhone(row.phone_e164),
    codeHash: row.code_hash,
    mode: row.mode,
    name: row.name ?? undefined,
    deviceId: row.device_id ?? undefined,
    attempts: row.attempts,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function toStoredOtp(record: OtpRecord): StoredOtp {
  const plain = record.phoneE164;
  return {
    ...record,
    phoneE164: isEncryptedPhone(plain) ? plain : encryptPhone(plain),
    phoneLookup: phoneLookupHash(
      isEncryptedPhone(plain) ? decryptPhone(plain) : plain
    ),
  };
}

const fileOtpsRepo = (): OtpsRepo => {
  const c = createFileCollection<StoredOtp>('otps.json');
  return {
    async get(phone) {
      const stored = await c.get(phoneLookupHash(phone));
      if (!stored) return null;
      return { ...stored, phoneE164: decryptPhone(stored.phoneE164) };
    },
    async put(record) {
      const stored = toStoredOtp(record);
      await c.put(stored.phoneLookup, stored);
    },
    async delete(phone) {
      await c.delete(phoneLookupHash(phone));
    },
  };
};

const dynamoOtpsRepo = (): OtpsRepo => ({
  async get(phone) {
    const lookup = phoneLookupHash(phone);
    const item = await ddbGet<StoredOtp>(`OTP#${lookup}`, 'OTP');
    if (!item) return null;
    return { ...item, phoneE164: decryptPhone(item.phoneE164) };
  },
  async put(record) {
    const stored = toStoredOtp(record);
    await ddbPut({
      pk: `OTP#${stored.phoneLookup}`,
      sk: 'OTP',
      ttl: epochSeconds(stored.expiresAt),
      ...stored,
    });
  },
  async delete(phone) {
    await ddbDelete(`OTP#${phoneLookupHash(phone)}`, 'OTP');
  },
});

const postgresOtpsRepo = (): OtpsRepo => ({
  async get(phoneE164) {
    const lookup = phoneLookupHash(phoneE164);
    const { rows } = await query('SELECT * FROM otps WHERE phone_lookup = $1', [
      lookup,
    ]);
    return rows[0] ? mapOtpRow(rows[0] as Parameters<typeof mapOtpRow>[0]) : null;
  },
  async put(record) {
    const stored = toStoredOtp(record);
    await query(
      `INSERT INTO otps (phone_lookup, phone_e164, code_hash, mode, name, device_id, attempts, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (phone_lookup) DO UPDATE SET
         phone_e164 = EXCLUDED.phone_e164,
         code_hash = EXCLUDED.code_hash,
         mode = EXCLUDED.mode,
         name = EXCLUDED.name,
         device_id = EXCLUDED.device_id,
         attempts = EXCLUDED.attempts,
         expires_at = EXCLUDED.expires_at,
         created_at = EXCLUDED.created_at`,
      [
        stored.phoneLookup,
        stored.phoneE164,
        stored.codeHash,
        stored.mode,
        stored.name ?? null,
        stored.deviceId ?? null,
        stored.attempts,
        stored.expiresAt,
        stored.createdAt,
      ]
    );
  },
  async delete(phoneE164) {
    await query('DELETE FROM otps WHERE phone_lookup = $1', [
      phoneLookupHash(phoneE164),
    ]);
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
