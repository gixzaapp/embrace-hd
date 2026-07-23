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
  authOtpTtlSec: Number(process.env.AUTH_OTP_TTL_SEC ?? 300),
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
  /** Return OTP in API JSON when mock / local testing */
  authAllowOtpHint: process.env.AUTH_ALLOW_OTP_HINT !== 'false',
  /** Fixed OTP that always verifies (testing only — leave empty to disable) */
  authTestOtp: process.env.AUTH_TEST_OTP?.trim() ?? '',
  nodeEnv: process.env.NODE_ENV?.trim() ?? 'development',
  /** How often (seconds) to log the request-count summary. 0 disables periodic logs. */
  requestLogIntervalSec: Number(process.env.REQUEST_LOG_INTERVAL_SEC ?? 60),
  /** Persistence backend: 'file' (local JSON, default) or 'dynamodb' (HA / multi-instance). */
  storageDriver: (process.env.STORAGE_DRIVER?.trim().toLowerCase() === 'dynamodb'
    ? 'dynamodb'
    : 'file') as 'file' | 'dynamodb',
  /** AWS region for the DynamoDB client (EB sets AWS_REGION automatically). */
  awsRegion:
    process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || 'eu-west-2',
  /** Single-table DynamoDB table name. */
  ddbTable: process.env.DDB_TABLE?.trim() || 'embrace-hd',
  /** Optional custom endpoint (e.g. http://localhost:8000 for DynamoDB Local). */
  ddbEndpoint: process.env.DDB_ENDPOINT?.trim() || '',
};
