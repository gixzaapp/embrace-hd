import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../middleware/errorHandler.js';
import { getAppConfig } from '../services/configStore.js';
import { resolveEntitlementFlags } from '../services/entitlements.js';
import { verifySubscription } from '../services/revenueCat.js';
import { claimTrial } from '../services/trialStore.js';
import type { EntitlementsResponse } from '../types.js';

export const entitlementsRouter = Router();

const querySchema = z.object({
  deviceId: z.string().min(1),
  appUserId: z.string().min(1).optional(),
});

entitlementsRouter.get('/', async (req, res, next) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, 'deviceId query param is required', parsed.error.flatten());
    }

    const deviceId = parsed.data.deviceId;
    const appUserId = parsed.data.appUserId?.trim() || deviceId;

    const config = await getAppConfig();
    const [trial, subscription] = await Promise.all([
      claimTrial(deviceId),
      verifySubscription(appUserId),
    ]);

    const flags = resolveEntitlementFlags(subscription.isPremium, trial, config);

    const body: EntitlementsResponse = {
      deviceId,
      appUserId,
      subscription,
      trial,
      flags,
      config: {
        trialDurationDays: config.trialDurationDays,
        adsEnabled: config.adsEnabled,
        featureFlags: config.featureFlags,
        minAppVersion: config.minAppVersion,
      },
      verifiedAt: new Date().toISOString(),
    };

    res.json(body);
  } catch (err) {
    next(err);
  }
});
