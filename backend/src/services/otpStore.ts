import { createHash, randomInt } from 'node:crypto';
import { env } from '../config/env.js';
import type { OtpRecord } from '../types.js';
import { otpsRepo } from '../storage/repositories.js';
import { redactPhone } from './whatsappOtp.js';

export type { OtpRecord };

const MAX_ATTEMPTS = 5;

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function saveOtp(options: {
  phoneE164: string;
  code: string;
  mode: 'login' | 'register';
  name?: string;
  deviceId?: string;
}): Promise<OtpRecord> {
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + Math.max(60, env.authOtpTtlSec) * 1000
  ).toISOString();

  const record: OtpRecord = {
    phoneE164: options.phoneE164,
    codeHash: hashCode(options.code),
    mode: options.mode,
    name: options.name,
    deviceId: options.deviceId,
    attempts: 0,
    expiresAt,
    createdAt: now.toISOString(),
  };
  await otpsRepo.put(record);
  return record;
}

export type VerifyOtpResult =
  | { ok: true; record: OtpRecord }
  | { ok: false; reason: 'missing' | 'expired' | 'invalid' | 'locked' };

export async function verifyOtp(
  phoneE164: string,
  code: string
): Promise<VerifyOtpResult> {
  const record = await otpsRepo.get(phoneE164);

  // Testing bypass: a fixed OTP always verifies (if configured).
  if (env.authTestOtp && code.trim() === env.authTestOtp) {
    if (record) {
      await otpsRepo.delete(phoneE164);
    }
    console.warn(`[Auth OTP] test OTP accepted for ${redactPhone(phoneE164)}`);
    return {
      ok: true,
      record:
        record ?? {
          phoneE164,
          codeHash: hashCode(code.trim()),
          mode: 'login',
          attempts: 0,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          createdAt: new Date().toISOString(),
        },
    };
  }

  if (!record) return { ok: false, reason: 'missing' };

  if (new Date(record.expiresAt).getTime() < Date.now()) {
    await otpsRepo.delete(phoneE164);
    return { ok: false, reason: 'expired' };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'locked' };
  }

  if (record.codeHash !== hashCode(code.trim())) {
    record.attempts += 1;
    await otpsRepo.put(record);
    if (record.attempts >= MAX_ATTEMPTS) {
      return { ok: false, reason: 'locked' };
    }
    return { ok: false, reason: 'invalid' };
  }

  await otpsRepo.delete(phoneE164);
  return { ok: true, record };
}
