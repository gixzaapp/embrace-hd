import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import {
  getRequestMetrics,
  requestCounter,
  startRequestLogging,
} from './middleware/requestCounter.js';
import { authRouter } from './routes/auth.js';
import { configRouter } from './routes/config.js';
import { entitlementsRouter } from './routes/entitlements.js';
import { exportRouter } from './routes/export.js';
import { subscriptionRouter } from './routes/subscription.js';
import { trialRouter } from './routes/trial.js';
import { whatsappWebhookRouter } from './routes/whatsappWebhook.js';
import { ensureDataDir } from './services/configStore.js';
import { checkStorage } from './storage/repositories.js';

/** Capacitor WebView origins — always allowed alongside CORS_ORIGINS. */
const CAPACITOR_ORIGINS = new Set([
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost',
]);

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // curl / same-origin / non-browser
  if (env.corsOrigins === '*') return true;
  if (CAPACITOR_ORIGINS.has(origin)) return true;
  return env.corsOrigins.includes(origin);
}

export async function createApp() {
  await ensureDataDir();
  const base =
    `[storage] driver=${env.storageDriver}` +
    (env.storageDriver === 'dynamodb'
      ? ` table=${env.ddbTable} region=${env.awsRegion}`
      : ` dir=${env.dataDir}`);
  const probe = await checkStorage();
  if (probe.ok) {
    console.log(`${base} — reachable`);
  } else {
    console.error(`${base} — NOT reachable: ${probe.detail}`);
  }

  const app = express();
  app.use(
    cors({
      origin(origin, callback) {
        // Never reject with an Error — that omits CORS headers and looks like a
        // network/CORS failure in the browser even when the real issue is elsewhere.
        callback(null, isAllowedOrigin(origin));
      },
      exposedHeaders: [
        'X-Embrace-Job-Id',
        'X-Embrace-Preset',
        'X-Embrace-Length',
        'X-Embrace-Size',
      ],
    })
  );
  app.use(express.json({ limit: '64kb' }));
  app.use(requestCounter);
  startRequestLogging();

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'embrace-hd-backend',
      storage:
        env.storageDriver === 'dynamodb'
          ? { driver: 'dynamodb', table: env.ddbTable, region: env.awsRegion }
          : { driver: 'file' },
      requests: getRequestMetrics(),
    });
  });

  app.use('/v1/auth', authRouter);
  app.use('/v1/whatsapp', whatsappWebhookRouter);
  app.use('/v1/config', configRouter);
  app.use('/v1/subscription', subscriptionRouter);
  app.use('/v1/trial', trialRouter);
  app.use('/v1/entitlements', entitlementsRouter);
  app.use('/v1/export', exportRouter);

  app.use(errorHandler);
  return app;
}
