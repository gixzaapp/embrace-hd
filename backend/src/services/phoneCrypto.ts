import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '../config/env.js';

const PREFIX = 'enc:v1:';

type DerivedKeys = {
  aesKey: Buffer;
  hmacKey: Buffer;
};

let cachedKeys: DerivedKeys | null = null;

function requireMasterKey(): Buffer {
  const raw = env.phoneDataKey.trim();
  if (!raw) {
    throw new Error(
      'PHONE_DATA_KEY is required (64 hex chars / 32 bytes). Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) {
    throw new Error('PHONE_DATA_KEY must be exactly 32 bytes (64 hex characters)');
  }
  return key;
}

function keys(): DerivedKeys {
  if (cachedKeys) return cachedKeys;
  const master = requireMasterKey();
  cachedKeys = {
    aesKey: Buffer.from(
      hkdfSync('sha256', master, 'embrace-hd', 'phone-aes-256-gcm', 32)
    ),
    hmacKey: Buffer.from(
      hkdfSync('sha256', master, 'embrace-hd', 'phone-hmac-sha256', 32)
    ),
  };
  return cachedKeys;
}

/** Deterministic blind index for DB lookups (never store plaintext as the key). */
export function phoneLookupHash(phoneE164: string): string {
  return createHmac('sha256', keys().hmacKey).update(phoneE164, 'utf8').digest('hex');
}

/** AES-256-GCM ciphertext; includes random IV + auth tag. */
export function encryptPhone(phoneE164: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys().aesKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(phoneE164, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

/**
 * Decrypt a stored value. Legacy plaintext (pre-encryption) is returned as-is
 * so existing rows can be upgraded on next write.
 */
export function decryptPhone(stored: string): string {
  if (!stored.startsWith(PREFIX)) {
    return stored;
  }
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64url');
  if (buf.length < 12 + 16 + 1) {
    throw new Error('Invalid encrypted phone payload');
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', keys().aesKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function isEncryptedPhone(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

/** Constant-time compare of two lookup hashes. */
export function lookupEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
