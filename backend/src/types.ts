export type SubscriptionPlanId = 'monthly' | 'yearly' | 'lifetime';

export type AppConfig = {
  appId: string;
  trialDurationDays: number;
  adsEnabled: boolean;
  premiumEntitlementId: string;
  products: Record<SubscriptionPlanId, string>;
  featureFlags: {
    lifetimePlan: boolean;
    imageToVideo: boolean;
    nativeWatermark: boolean;
  };
  minAppVersion: string;
  updatedAt: string;
};

export type SubscriptionVerifyResult = {
  isPremium: boolean;
  entitlementId: string;
  activePlan: SubscriptionPlanId | null;
  productIdentifier: string | null;
  expirationDate: string | null;
  willRenew: boolean;
  verifiedAt: string;
};

export type TrialPhase = 'not_started' | 'active' | 'expired';

export type TrialClaimResult = {
  phase: TrialPhase;
  startDateIso: string | null;
  daysRemaining: number;
  isExpired: boolean;
  premiumUnlocked: boolean;
  durationDays: number;
};

export type EntitlementFlags = {
  isPremiumUser: boolean;
  isTrialActive: boolean;
  isTrialExpired: boolean;
  shouldApplyWatermark: boolean;
  shouldShowAds: boolean;
  canExportHd: boolean;
};

export type EntitlementsResponse = {
  deviceId: string;
  appUserId: string;
  subscription: SubscriptionVerifyResult;
  trial: TrialClaimResult;
  flags: EntitlementFlags;
  config: Pick<AppConfig, 'trialDurationDays' | 'adsEnabled' | 'featureFlags' | 'minAppVersion'>;
  verifiedAt: string;
};

export type TrialRecord = {
  deviceId: string;
  startDateIso: string;
  claimedAt: string;
};

export type AuthUser = {
  id: string;
  phoneE164: string;
  name?: string;
  deviceIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type OtpRecord = {
  phoneE164: string;
  codeHash: string;
  mode: 'login' | 'register';
  name?: string;
  deviceId?: string;
  attempts: number;
  expiresAt: string;
  createdAt: string;
};

export type SessionRecord = {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};
