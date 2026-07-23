import fs from 'node:fs/promises';
import { env } from '../config/env.js';
import type { AppConfig } from '../types.js';
import { configRepo } from '../storage/repositories.js';

const DEFAULT_CONFIG: AppConfig = {
  appId: 'com.embracehd.app',
  trialDurationDays: 7,
  adsEnabled: true,
  premiumEntitlementId: 'premium',
  products: {
    monthly: 'embrace_hd_monthly',
    yearly: 'embrace_hd_yearly',
    lifetime: 'embrace_hd_lifetime',
  },
  featureFlags: {
    lifetimePlan: true,
    imageToVideo: false,
    nativeWatermark: false,
  },
  minAppVersion: '0.1.0',
  updatedAt: new Date().toISOString(),
};

/** Ensure the local data dir exists (used for file storage + video exports). */
export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(env.dataDir, { recursive: true });
}

export async function getAppConfig(): Promise<AppConfig> {
  const stored = await configRepo.get();
  if (!stored) {
    const seeded = { ...DEFAULT_CONFIG };
    await configRepo.put(seeded);
    return seeded;
  }
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    products: { ...DEFAULT_CONFIG.products, ...stored.products },
    featureFlags: { ...DEFAULT_CONFIG.featureFlags, ...stored.featureFlags },
  };
}

export { DEFAULT_CONFIG };
