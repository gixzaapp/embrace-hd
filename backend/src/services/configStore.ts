import fs from 'node:fs/promises';
import { env } from '../config/env.js';
import type { AppConfig } from '../types.js';
import { configRepo } from '../storage/repositories.js';

const DEFAULT_CONFIG: AppConfig = {
  appId: 'uk.co.embraceapp.app',
  trialDurationDays: 21,
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
    showLogout: true,
    showUnlockPremium: false,
    /** New servers advertise Edit-recipe Convert support for clients. */
    editRecipe: true,
    /** In-app preview of the converted video, in addition to WhatsApp. */
    convertPreview: true,
  },
  minAppVersion: '0.1.0',
  updatedAt: new Date().toISOString(),
};

/** Apply ADS_ENABLED env override when set (takes precedence over DB). */
function withRuntimeOverrides(config: AppConfig): AppConfig {
  let next = config;
  if (env.adsEnabledOverride !== null) {
    next = { ...next, adsEnabled: env.adsEnabledOverride };
  }
  if (env.convertPreviewOverride !== null) {
    next = {
      ...next,
      featureFlags: {
        ...next.featureFlags,
        convertPreview: env.convertPreviewOverride,
      },
    };
  }
  return next;
}

/** Ensure the local data dir exists (used for file storage + video exports). */
export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(env.dataDir, { recursive: true });
}

export async function getAppConfig(): Promise<AppConfig> {
  const stored = await configRepo.get();
  if (!stored) {
    const seeded = withRuntimeOverrides({ ...DEFAULT_CONFIG });
    await configRepo.put({
      ...seeded,
      // Persist DB defaults without baking a temporary env kill-switch into storage
      adsEnabled: DEFAULT_CONFIG.adsEnabled,
      featureFlags: {
        ...seeded.featureFlags,
        convertPreview: DEFAULT_CONFIG.featureFlags.convertPreview,
      },
    });
    return seeded;
  }
  return withRuntimeOverrides({
    ...DEFAULT_CONFIG,
    ...stored,
    products: { ...DEFAULT_CONFIG.products, ...stored.products },
    featureFlags: { ...DEFAULT_CONFIG.featureFlags, ...stored.featureFlags },
  });
}

export { DEFAULT_CONFIG };
