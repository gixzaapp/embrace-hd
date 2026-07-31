/**
 * Entitlement / monetization rules for Embrace HD.
 *
 * Non-premium   → ads ON (full-time bottom banner)
 * Trial active  → HD export + 30s/60s Status
 * Trial expired → HD export allowed, 30s only (60s locked)
 * Premium user  → ads OFF + HD export + 30s/60s
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
  /** 60s Status length (premium or active trial only) */
  canUse60sStatus: boolean;
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
    // Convert stays available after trial (length capped separately)
    canExportHd: true,
    // 60s only while trial is still valid or user is premium
    canUse60sStatus: isPremiumUser || !isTrialExpired,
  };
}
