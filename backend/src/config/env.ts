import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function parseOrigins(raw: string | undefined): string[] | '*' {
  if (!raw || raw.trim() === '*') return '*';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseStorageDriver(): 'file' | 'dynamodb' | 'postgres' {
  const raw = process.env.STORAGE_DRIVER?.trim().toLowerCase() ?? '';
  if (raw === 'dynamodb') return 'dynamodb';
  if (raw === 'postgres' || raw === 'postgresql') return 'postgres';
  return 'file';
}

/**
 * Inside Docker, localhost/127.0.0.1 is the container — not the Hetzner host
 * where Postgres usually listens. Remap to the Compose host gateway name.
 */
function resolveDbHost(): string {
  const raw = process.env.DB_HOST?.trim() || 'localhost';
  const inDocker =
    process.env.RUNNING_IN_DOCKER === '1' || fs.existsSync('/.dockerenv');
  if (inDocker && (raw === 'localhost' || raw === '127.0.0.1')) {
    return 'host.docker.internal';
  }
  return raw;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  revenueCatSecretKey: process.env.REVENUECAT_SECRET_API_KEY?.trim() ?? '',
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
  dataDir: path.resolve(
    process.env.DATA_DIR
      ? path.isAbsolute(process.env.DATA_DIR)
        ? process.env.DATA_DIR
        : path.resolve(process.cwd(), process.env.DATA_DIR)
      : path.resolve(__dirname, '../../data')
  ),
  /** WhatsApp Cloud API (optional — mock OTP when unset) */
  whatsappToken: process.env.WHATSAPP_TOKEN?.trim() ?? '',
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? '',
  /** Meta webhook verify token (GET hub.verify_token) */
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN?.trim() ?? '',
  /** Approved authentication template name (business-initiated OTP). Empty → free-form text. */
  whatsappOtpTemplate: process.env.WHATSAPP_OTP_TEMPLATE?.trim() ?? '',
  /** Template language code, e.g. en_US */
  whatsappOtpTemplateLang: process.env.WHATSAPP_OTP_TEMPLATE_LANG?.trim() ?? 'en_US',
  /** Whether the auth template includes the standard copy-code button */
  whatsappOtpTemplateHasButton:
    process.env.WHATSAPP_OTP_TEMPLATE_HAS_BUTTON !== 'false',
  /**
   * Public WhatsApp business number (E.164) for wa.me deep links.
   * Falls back to display number used for enroll if unset.
   */
  whatsappBusinessE164: process.env.WHATSAPP_BUSINESS_E164?.trim() ?? '',
  authOtpTtlSec: Number(process.env.AUTH_OTP_TTL_SEC ?? 300),
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
  /** Max OTP send requests per phone within the rate window */
  authOtpMaxPerWindow: Number(process.env.AUTH_OTP_MAX_PER_WINDOW ?? 2),
  /** Rate-limit window in seconds (default 1 hour) */
  authOtpWindowSec: Number(process.env.AUTH_OTP_WINDOW_SEC ?? 3600),
  /** Minimum seconds between OTP requests for the same phone */
  authOtpCooldownSec: Number(process.env.AUTH_OTP_COOLDOWN_SEC ?? 60),
  /** Return OTP in API JSON when mock / local testing */
  authAllowOtpHint: process.env.AUTH_ALLOW_OTP_HINT !== 'false',
  /** Fixed OTP that always verifies (testing only — leave empty to disable) */
  authTestOtp: process.env.AUTH_TEST_OTP?.trim() ?? '',
  nodeEnv: process.env.NODE_ENV?.trim() ?? 'development',
  /** How often (seconds) to log the request-count summary. 0 disables periodic logs. */
  requestLogIntervalSec: Number(process.env.REQUEST_LOG_INTERVAL_SEC ?? 60),
  /**
   * Persistence backend:
   * - file (local JSON)
   * - dynamodb (AWS)
   * - postgres (Hetzner / self-hosted)
   */
  storageDriver: parseStorageDriver(),
  /** AWS region for the DynamoDB client */
  awsRegion:
    process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || 'eu-west-2',
  ddbTable: process.env.DDB_TABLE?.trim() || 'embrace-hd',
  ddbEndpoint: process.env.DDB_ENDPOINT?.trim() || '',
  /** PostgreSQL (when STORAGE_DRIVER=postgres) */
  dbHost: resolveDbHost(),
  dbPort: Number(process.env.DB_PORT ?? 5432),
  dbName: process.env.DB_NAME?.trim() || 'embrace_hd_prod',
  dbUser: process.env.DB_USER?.trim() || 'embrace_app',
  dbPassword: process.env.DB_PASSWORD ?? '',
  /**
   * 32-byte master key as hex (64 chars). Used to derive AES-256-GCM + HMAC keys
   * for WhatsApp phone numbers at rest. Required when storing auth users.
   */
  phoneDataKey: process.env.PHONE_DATA_KEY?.trim() ?? '',
  /**
   * Master AdMob switch. When set, overrides app_config.adsEnabled from the DB.
   * unset → use DB / default; false/0/off → ads off; true/1/on → ads on.
   */
  adsEnabledOverride: parseAdsEnabledOverride(process.env.ADS_ENABLED),
};

/** null = do not override DB; boolean = force that value */
function parseAdsEnabledOverride(raw: string | undefined): boolean | null {
  const v = raw?.trim().toLowerCase();
  if (!v) return null;
  if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false;
  if (v === 'true' || v === '1' || v === 'on' || v === 'yes') return true;
  return null;
}
