import { randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import type { SessionRecord } from '../types.js';
import { sessionsRepo } from '../storage/repositories.js';

export type { SessionRecord };

export function createSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export async function createSession(userId: string): Promise<SessionRecord> {
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + Math.max(1, env.sessionTtlDays) * 24 * 60 * 60 * 1000
  ).toISOString();
  const token = createSessionToken();
  const record: SessionRecord = {
    token,
    userId,
    createdAt: now.toISOString(),
    expiresAt,
  };
  await sessionsRepo.put(record);
  return record;
}

export async function getSession(token: string): Promise<SessionRecord | null> {
  const record = await sessionsRepo.get(token);
  if (!record) return null;
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    await sessionsRepo.delete(token);
    return null;
  }
  return record;
}

export async function revokeSession(token: string): Promise<void> {
  await sessionsRepo.delete(token);
}
