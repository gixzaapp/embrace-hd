import { env } from '../config/env.js';
import { HttpError } from '../middleware/errorHandler.js';
import type { AppConfig, SubscriptionPlanId, SubscriptionVerifyResult } from '../types.js';
import { getAppConfig } from './configStore.js';

type RcEntitlement = {
  expires_date: string | null;
  product_identifier: string;
  purchase_date?: string;
};

type RcSubscriberResponse = {
  subscriber: {
    entitlements: Record<string, RcEntitlement>;
    subscriptions: Record<
      string,
      {
        expires_date: string | null;
        unsubscribe_detected_at: string | null;
        billing_issues_detected_at: string | null;
      }
    >;
    non_subscriptions?: Record<string, unknown[]>;
  };
};

function planFromProductId(
  productId: string,
  products: AppConfig['products']
): SubscriptionPlanId | null {
  const entries = Object.entries(products) as [SubscriptionPlanId, string][];
  const match = entries.find(([, id]) => id === productId);
  return match?.[0] ?? null;
}

function isEntitlementActive(expiresDate: string | null): boolean {
  if (!expiresDate) return true; // lifetime / non-expiring
  const exp = new Date(expiresDate).getTime();
  if (Number.isNaN(exp)) return false;
  return exp > Date.now();
}

/**
 * Verify premium via RevenueCat REST API.
 * https://www.revenuecat.com/docs/api-v1#tag/customers/operation/subscribers
 */
export async function verifySubscription(
  appUserId: string
): Promise<SubscriptionVerifyResult> {
  const id = appUserId.trim();
  if (!id) {
    throw new HttpError(400, 'appUserId is required');
  }

  const config = await getAppConfig();
  const verifiedAt = new Date().toISOString();
  const empty: SubscriptionVerifyResult = {
    isPremium: false,
    entitlementId: config.premiumEntitlementId,
    activePlan: null,
    productIdentifier: null,
    expirationDate: null,
    willRenew: false,
    verifiedAt,
  };

  if (!env.revenueCatSecretKey) {
    console.warn(
      '[RevenueCat] REVENUECAT_SECRET_API_KEY missing — verify returns non-premium'
    );
    return empty;
  }

  const url = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.revenueCatSecretKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  if (res.status === 404) {
    return empty;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new HttpError(502, 'RevenueCat verification failed', {
      status: res.status,
      body: body.slice(0, 500),
    });
  }

  const data = (await res.json()) as RcSubscriberResponse;
  const entitlement = data.subscriber.entitlements[config.premiumEntitlementId];

  if (!entitlement || !isEntitlementActive(entitlement.expires_date)) {
    return empty;
  }

  const productId = entitlement.product_identifier;
  const sub = data.subscriber.subscriptions[productId];
  const willRenew = Boolean(
    sub && !sub.unsubscribe_detected_at && !sub.billing_issues_detected_at
  );

  return {
    isPremium: true,
    entitlementId: config.premiumEntitlementId,
    activePlan: planFromProductId(productId, config.products),
    productIdentifier: productId,
    expirationDate: entitlement.expires_date,
    willRenew,
    verifiedAt,
  };
}
