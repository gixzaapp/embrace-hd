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

const usingDynamo = env.storageDriver === 'dynamodb';

/**
 * Lightweight connectivity/permission probe. For DynamoDB it does a single
 * GetItem on a dummy key (uses only the GetItem permission we already grant),
 * so a missing table or IAM policy surfaces immediately at boot.
 */
export async function checkStorage(): Promise<{
  driver: 'file' | 'dynamodb';
  ok: boolean;
  detail?: string;
}> {
  if (!usingDynamo) return { driver: 'file', ok: true };
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

export const usersRepo: UsersRepo = usingDynamo ? dynamoUsersRepo() : fileUsersRepo();

/* ------------------------------ OTPs ------------------------------ */

export interface OtpsRepo {
  get(phoneE164: string): Promise<OtpRecord | null>;
  put(record: OtpRecord): Promise<void>;
  delete(phoneE164: string): Promise<void>;
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

export const otpsRepo: OtpsRepo = usingDynamo ? dynamoOtpsRepo() : fileOtpsRepo();

/* ---------------------------- Sessions ---------------------------- */

export interface SessionsRepo {
  get(token: string): Promise<SessionRecord | null>;
  put(record: SessionRecord): Promise<void>;
  delete(token: string): Promise<void>;
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

export const sessionsRepo: SessionsRepo = usingDynamo
  ? dynamoSessionsRepo()
  : fileSessionsRepo();

/* ----------------------------- Trials ----------------------------- */

export interface TrialsRepo {
  get(deviceId: string): Promise<TrialRecord | null>;
  put(record: TrialRecord): Promise<void>;
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

export const trialsRepo: TrialsRepo = usingDynamo
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

export const configRepo: ConfigRepo = usingDynamo
  ? dynamoConfigRepo()
  : fileConfigRepo();
