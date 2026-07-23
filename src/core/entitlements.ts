/**
 * Entitlement / monetization rules for Embrace HD.
 *
 * Non-premium   → ads ON (full-time bottom banner)
 * Trial active  → HD export allowed
 * Trial expired → HD export blocked
 * Premium user  → ads OFF + HD export allowed
 *
 * Watermark burn-in is disabled for all users.
 */

export type EntitlementSnapshot = {
  isSubscribed: boolean;
  trialPhase: 'not_started' | 'active' | 'expired' | null;
};

export type EntitlementFlags = {
  isPremiumUser: boolean;
  isTrialActive: boolean;
  isTrialExpired: boolean;
  /** Always false — watermark burn-in removed */
  shouldApplyWatermark: boolean;
  /** Bottom Google Ads banner */
  shouldShowAds: boolean;
  /** Allow HD Status export pipeline */
  canExportHd: boolean;
};

export function resolveEntitlements(snapshot: EntitlementSnapshot): EntitlementFlags {
  const isPremiumUser = snapshot.isSubscribed;
  const isTrialActive = !isPremiumUser && snapshot.trialPhase === 'active';
  const isTrialExpired = !isPremiumUser && snapshot.trialPhase === 'expired';

  return {
    isPremiumUser,
    isTrialActive,
    isTrialExpired,
    shouldApplyWatermark: false,
    // Full-time bottom banner for every non-premium user
    shouldShowAds: !isPremiumUser,
    // HD export only while trial is active or user is premium
    canExportHd: isPremiumUser || isTrialActive,
  };
}
