import type { AppConfig, EntitlementFlags, TrialClaimResult } from '../types.js';

/** Same rules as src/core/entitlements.ts */
export function resolveEntitlementFlags(
  isSubscribed: boolean,
  trial: TrialClaimResult,
  config: Pick<AppConfig, 'adsEnabled'>
): EntitlementFlags {
  const isPremiumUser = isSubscribed;
  const isTrialActive = !isPremiumUser && trial.phase === 'active';
  const isTrialExpired = !isPremiumUser && trial.phase === 'expired';

  return {
    isPremiumUser,
    isTrialActive,
    isTrialExpired,
    shouldApplyWatermark: false,
    // Full-time bottom banner for every non-premium user
    shouldShowAds: config.adsEnabled && !isPremiumUser,
    canExportHd: isPremiumUser || isTrialActive,
  };
}
