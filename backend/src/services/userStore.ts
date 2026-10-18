import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import type { AuthUser } from '../types.js';
import { getPool } from '../storage/postgres.js';
import {
  otpsRepo,
  sessionsRepo,
  userTrialsRepo,
  usersRepo,
} from '../storage/repositories.js';
import { clearOtpRequestLog } from './otpRateLimit.js';
import { phoneLookupHash } from './phoneCrypto.js';

export type { AuthUser };

export function normalizePhoneE164(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  if (!digits) return null;
  const withPlus = digits.startsWith('+') ? digits : `+${digits}`;
  const only = withPlus.replace(/[^\d]/g, '');
  if (only.length < 8 || only.length > 15) return null;
  return `+${only}`;
}

export async function findUserByPhone(phoneE164: string): Promise<AuthUser | null> {
  return usersRepo.findByPhone(phoneE164);
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  return usersRepo.getById(id);
}

export async function countUsers(): Promise<number> {
  return usersRepo.count();
}

export async function listRecentUserNames(limit = 10): Promise<
  Array<{ name: string; createdAt: string }>
> {
  return usersRepo.listRecent(limit);
}

export async function upsertUserForAuth(options: {
  phoneE164: string;
  name?: string;
  deviceId?: string;
  mode: 'login' | 'register';
}): Promise<{ user: AuthUser; created: boolean }> {
  const existing = await usersRepo.findByPhone(options.phoneE164);
  const now = new Date().toISOString();

  if (existing) {
    if (options.mode === 'register' && options.name?.trim()) {
      existing.name = options.name.trim();
    }
    if (options.deviceId?.trim()) {
      const id = options.deviceId.trim();
      if (!existing.deviceIds.includes(id)) {
        existing.deviceIds.push(id);
      }
    }
    existing.updatedAt = now;
    await usersRepo.put(existing);
    return { user: existing, created: false };
  }

  const id = randomUUID();
  const user: AuthUser = {
    id,
    phoneE164: options.phoneE164,
    name: options.name?.trim() || undefined,
    deviceIds: options.deviceId?.trim() ? [options.deviceId.trim()] : [],
    createdAt: now,
    updatedAt: now,
  };
  await usersRepo.put(user);
  return { user, created: true };
}

export async function ensureUser(
  phoneE164: string,
  options?: { name?: string; deviceId?: string }
): Promise<AuthUser> {
  const found = await findUserByPhone(phoneE164);
  const { user } = await upsertUserForAuth({
    phoneE164,
    name: options?.name,
    deviceId: options?.deviceId,
    mode: found ? 'login' : 'register',
  });
  return user;
}

/** Record an inbound WhatsApp message — refreshes the Cloud API 24h customer window. */
export async function touchLastInboundWhatsApp(
  phoneE164: string
): Promise<AuthUser | null> {
  const user = await findUserByPhone(phoneE164);
  if (!user) return null;
  const now = new Date().toISOString();
  user.lastInboundWhatsAppAt = now;
  user.updatedAt = now;
  await usersRepo.put(user);
  return user;
}

export const CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isConversationWindowOpen(
  lastInboundWhatsAppAt: string | undefined | null
): boolean {
  if (!lastInboundWhatsAppAt) return false;
  const t = new Date(lastInboundWhatsAppAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < CONVERSATION_WINDOW_MS;
}

/**
 * Permanently remove the account and the personal data stored for it:
 * user row, sessions, trial binding, pending OTP, and OTP request log.
 */
export async function deleteAccount(user: AuthUser): Promise<void> {
  if (env.storageDriver === 'postgres') {
    const lookup = phoneLookupHash(user.phoneE164);
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM otps WHERE phone_lookup = $1', [lookup]);
      await client.query('DELETE FROM otp_request_log WHERE phone_lookup = $1', [
        lookup,
      ]);
      await client.query('DELETE FROM users WHERE id = $1', [user.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    return;
  }

  await otpsRepo.delete(user.phoneE164);
  await clearOtpRequestLog(user.phoneE164);
  await sessionsRepo.deleteByUserId(user.id);
  await userTrialsRepo.delete(user.id);
  await usersRepo.delete(user.id);
}

export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    phoneE164: user.phoneE164,
    name: user.name ?? null,
    createdAt: user.createdAt,
  };
}
