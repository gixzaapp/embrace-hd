import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/errorHandler.js';
import { phoneLookupHash } from './phoneCrypto.js';
import { query } from '../storage/postgres.js';

type RateFileStore = Record<string, number[]>;

function rateFilePath(): string {
  return path.join(env.dataDir, 'otp_request_log.json');
}

async function readFileStore(): Promise<RateFileStore> {
  try {
    const raw = await fs.readFile(rateFilePath(), 'utf8');
    return JSON.parse(raw) as RateFileStore;
  } catch {
    return {};
  }
}

async function writeFileStore(store: RateFileStore): Promise<void> {
  await fs.mkdir(env.dataDir, { recursive: true });
  await fs.writeFile(rateFilePath(), JSON.stringify(store), 'utf8');
}

async function listRecentTimestamps(
  phoneLookup: string,
  sinceMs: number
): Promise<number[]> {
  if (env.storageDriver === 'postgres') {
    const { rows } = await query<{ requested_at: Date | string }>(
      `SELECT requested_at FROM otp_request_log
       WHERE phone_lookup = $1 AND requested_at >= $2
       ORDER BY requested_at DESC`,
      [phoneLookup, new Date(sinceMs).toISOString()]
    );
    return rows.map((r) => new Date(r.requested_at).getTime());
  }

  const store = await readFileStore();
  const all = store[phoneLookup] ?? [];
  return all.filter((t) => t >= sinceMs).sort((a, b) => b - a);
}

async function recordTimestamp(phoneLookup: string, atMs: number): Promise<void> {
  if (env.storageDriver === 'postgres') {
    await query(
      `INSERT INTO otp_request_log (phone_lookup, requested_at) VALUES ($1, $2)`,
      [phoneLookup, new Date(atMs).toISOString()]
    );
    const pruneBefore = atMs - Math.max(env.authOtpWindowSec, 3600) * 2 * 1000;
    await query(
      `DELETE FROM otp_request_log WHERE phone_lookup = $1 AND requested_at < $2`,
      [phoneLookup, new Date(pruneBefore).toISOString()]
    );
    return;
  }

  const store = await readFileStore();
  const pruneBefore = atMs - Math.max(env.authOtpWindowSec, 3600) * 2 * 1000;
  const next = [...(store[phoneLookup] ?? []), atMs].filter((t) => t >= pruneBefore);
  store[phoneLookup] = next;
  await writeFileStore(store);
}

/**
 * Enforce OTP send limits for a phone number (does not write a log row yet).
 * Defaults: max 2 / hour, 60s cooldown.
 * DB errors soft-fail so login is never blocked by rate-limit storage issues.
 */
export async function assertCanRequestOtp(phoneE164: string): Promise<void> {
  const max = Math.max(1, env.authOtpMaxPerWindow);
  const windowMs = Math.max(60, env.authOtpWindowSec) * 1000;
  const cooldownMs = Math.max(0, env.authOtpCooldownSec) * 1000;
  const now = Date.now();

  let recent: number[];
  try {
    const lookup = phoneLookupHash(phoneE164);
    recent = await listRecentTimestamps(lookup, now - windowMs);
  } catch (err) {
    console.error(
      '[OTP rate limit] check failed — allowing OTP request',
      err instanceof Error ? err.message : err
    );
    return;
  }

  if (cooldownMs > 0 && recent.length > 0) {
    const last = recent[0];
    const elapsed = now - last;
    if (elapsed < cooldownMs) {
      const waitSec = Math.ceil((cooldownMs - elapsed) / 1000);
      throw new HttpError(
        429,
        `Please wait ${waitSec}s before requesting another code`,
        { retryAfterSec: waitSec, limit: max, windowSec: env.authOtpWindowSec }
      );
    }
  }

  if (recent.length >= max) {
    const oldestInWindow = recent[recent.length - 1];
    const retryAfterSec = Math.max(
      1,
      Math.ceil((oldestInWindow + windowMs - now) / 1000)
    );
    throw new HttpError(
      429,
      `Too many OTP requests for this number. Limit is ${max} per ${Math.round(env.authOtpWindowSec / 60)} minutes — try again in ${retryAfterSec}s`,
      { retryAfterSec, limit: max, windowSec: env.authOtpWindowSec }
    );
  }
}

/** Persist a successful OTP send attempt for rate limiting. */
export async function recordOtpRequest(phoneE164: string): Promise<void> {
  try {
    const lookup = phoneLookupHash(phoneE164);
    await recordTimestamp(lookup, Date.now());
  } catch (err) {
    console.error(
      '[OTP rate limit] record failed',
      err instanceof Error ? err.message : err
    );
  }
}
