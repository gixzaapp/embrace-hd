import { Capacitor } from '@capacitor/core';
import {
  LOG_LEVEL,
  PACKAGE_TYPE,
  Purchases,
  type CustomerInfo,
  type PurchasesPackage,
} from '@revenuecat/purchases-capacitor';
import {
  PREMIUM_ENTITLEMENT_ID,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_PRODUCT_IDS,
  getRevenueCatApiKey,
  type SubscriptionPlanId,
  type SubscriptionStatus,
} from '../core/subscription';

function packageTypeForPlan(plan: SubscriptionPlanId): PACKAGE_TYPE {
  switch (plan) {
    case 'monthly':
      return PACKAGE_TYPE.MONTHLY;
    case 'yearly':
      return PACKAGE_TYPE.ANNUAL;
    case 'lifetime':
      return PACKAGE_TYPE.LIFETIME;
  }
}

function planFromProductId(productId: string): SubscriptionPlanId | null {
  const entries = Object.entries(SUBSCRIPTION_PRODUCT_IDS) as [SubscriptionPlanId, string][];
  const match = entries.find(([, id]) => id === productId);
  return match?.[0] ?? null;
}

function planFromPackage(pkg: PurchasesPackage): SubscriptionPlanId | null {
  if (pkg.packageType === PACKAGE_TYPE.MONTHLY) return 'monthly';
  if (pkg.packageType === PACKAGE_TYPE.ANNUAL) return 'yearly';
  if (pkg.packageType === PACKAGE_TYPE.LIFETIME) return 'lifetime';
  return planFromProductId(pkg.product.identifier);
}

function statusFromCustomerInfo(info: CustomerInfo): SubscriptionStatus {
  const entitlement = info.entitlements.active[PREMIUM_ENTITLEMENT_ID];
  if (!entitlement?.isActive) {
    return {
      isPremium: false,
      entitlementId: PREMIUM_ENTITLEMENT_ID,
      activePlan: null,
      productIdentifier: null,
      expirationDate: null,
      willRenew: false,
    };
  }

  return {
    isPremium: true,
    entitlementId: PREMIUM_ENTITLEMENT_ID,
    activePlan: planFromProductId(entitlement.productIdentifier),
    productIdentifier: entitlement.productIdentifier,
    expirationDate: entitlement.expirationDate,
    willRenew: Boolean(entitlement.willRenew),
  };
}

/**
 * Capacitor Purchases (RevenueCat) — monthly, yearly, optional lifetime.
 */
export class PurchaseManager {
  private configured = false;
  private appUserId: string | null = null;

  async configure(appUserId?: string): Promise<void> {
    if (this.configured) {
      if (appUserId && appUserId !== this.appUserId) {
        await this.logIn(appUserId);
      }
      return;
    }

    const platform = Capacitor.getPlatform();
    const apiKey = getRevenueCatApiKey(platform);

    if (!apiKey) {
      console.warn(
        '[PurchaseManager] Missing RevenueCat API key. Set VITE_REVENUECAT_APPLE_API_KEY / VITE_REVENUECAT_GOOGLE_API_KEY.'
      );
      return;
    }

    if (import.meta.env.DEV) {
      await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });
    }

    await Purchases.configure({
      apiKey,
      ...(appUserId ? { appUserID: appUserId } : {}),
    });
    this.configured = true;
    this.appUserId = appUserId ?? null;
  }

  async logIn(appUserId: string): Promise<void> {
    if (!this.configured) {
      await this.configure(appUserId);
      return;
    }
    if (!appUserId || appUserId === this.appUserId) return;
    await Purchases.logIn({ appUserID: appUserId });
    this.appUserId = appUserId;
  }

  getAppUserId(): string | null {
    return this.appUserId;
  }

  private async ensureConfigured(): Promise<boolean> {
    await this.configure();
    return this.configured;
  }

  async checkSubscription(): Promise<SubscriptionStatus> {
    const ready = await this.ensureConfigured();
    if (!ready) {
      return {
        isPremium: false,
        entitlementId: PREMIUM_ENTITLEMENT_ID,
        activePlan: null,
        productIdentifier: null,
        expirationDate: null,
        willRenew: false,
      };
    }

    const { customerInfo } = await Purchases.getCustomerInfo();
    return statusFromCustomerInfo(customerInfo);
  }

  async restorePurchases(): Promise<SubscriptionStatus> {
    const ready = await this.ensureConfigured();
    if (!ready) {
      throw new Error('Purchases not configured — add RevenueCat API keys');
    }

    const { customerInfo } = await Purchases.restorePurchases();
    return statusFromCustomerInfo(customerInfo);
  }

  async isPremiumUser(): Promise<boolean> {
    const status = await this.checkSubscription();
    return status.isPremium;
  }

  /** Resolve store packages for monthly / yearly / lifetime (lifetime optional). */
  async getAvailablePlans(): Promise<
    Partial<Record<SubscriptionPlanId, PurchasesPackage>>
  > {
    const ready = await this.ensureConfigured();
    if (!ready) return {};

    const offerings = await Purchases.getOfferings();
    const current = offerings.current;
    if (!current) return {};

    const byPlan: Partial<Record<SubscriptionPlanId, PurchasesPackage>> = {};

    for (const pkg of current.availablePackages) {
      const plan = planFromPackage(pkg);
      if (plan) byPlan[plan] = pkg;
    }

    // Prefer typed package slots when present
    if (current.monthly) byPlan.monthly = current.monthly;
    if (current.annual) byPlan.yearly = current.annual;
    if (current.lifetime) byPlan.lifetime = current.lifetime;

    return byPlan;
  }

  async purchasePlan(plan: SubscriptionPlanId): Promise<SubscriptionStatus> {
    const ready = await this.ensureConfigured();
    if (!ready) {
      throw new Error('Purchases not configured — add RevenueCat API keys');
    }

    const plans = await this.getAvailablePlans();
    let pkg = plans[plan];

    if (!pkg) {
      // Fallback: find by PACKAGE_TYPE in current offering
      const offerings = await Purchases.getOfferings();
      const wanted = packageTypeForPlan(plan);
      pkg = offerings.current?.availablePackages.find((p) => p.packageType === wanted);
    }

    if (!pkg) {
      throw new Error(`${SUBSCRIPTION_PLANS[plan].label} plan is not available in the store`);
    }

    const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
    return statusFromCustomerInfo(customerInfo);
  }
}

export const purchaseManager = new PurchaseManager();

export const checkSubscription = () => purchaseManager.checkSubscription();
export const restorePurchases = () => purchaseManager.restorePurchases();
export const isPremiumUser = () => purchaseManager.isPremiumUser();
