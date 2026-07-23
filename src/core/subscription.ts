/** RevenueCat / IAP subscription configuration */

export type SubscriptionPlanId = 'monthly' | 'yearly' | 'lifetime';

export const PREMIUM_ENTITLEMENT_ID = 'premium';

/**
 * Product identifiers — match App Store / Play Console / RevenueCat dashboard.
 * Override via env if needed.
 */
export const SUBSCRIPTION_PRODUCT_IDS = {
  monthly: 'embrace_hd_monthly',
  yearly: 'embrace_hd_yearly',
  lifetime: 'embrace_hd_lifetime',
} as const satisfies Record<SubscriptionPlanId, string>;

export const SUBSCRIPTION_PLANS: Record<
  SubscriptionPlanId,
  { id: SubscriptionPlanId; label: string; productId: string; optional?: boolean }
> = {
  monthly: {
    id: 'monthly',
    label: 'Monthly',
    productId: SUBSCRIPTION_PRODUCT_IDS.monthly,
  },
  yearly: {
    id: 'yearly',
    label: 'Yearly',
    productId: SUBSCRIPTION_PRODUCT_IDS.yearly,
  },
  lifetime: {
    id: 'lifetime',
    label: 'Lifetime',
    productId: SUBSCRIPTION_PRODUCT_IDS.lifetime,
    optional: true,
  },
};

export type SubscriptionStatus = {
  isPremium: boolean;
  entitlementId: string;
  activePlan: SubscriptionPlanId | null;
  productIdentifier: string | null;
  expirationDate: string | null;
  willRenew: boolean;
};

export function getRevenueCatApiKey(platform: string): string {
  const apple =
    import.meta.env.VITE_REVENUECAT_APPLE_API_KEY ??
    import.meta.env.VITE_REVENUECAT_API_KEY ??
    '';
  const google =
    import.meta.env.VITE_REVENUECAT_GOOGLE_API_KEY ??
    import.meta.env.VITE_REVENUECAT_API_KEY ??
    '';

  if (platform === 'ios') return apple;
  if (platform === 'android') return google;
  // Web / unknown — prefer apple key or generic for SDK configure in dev
  return apple || google;
}
