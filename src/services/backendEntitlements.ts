import type { SubscriptionPlanId, SubscriptionStatus } from '../core/subscription';
import type { TrialStatus } from '../core/trial';
import type { EntitlementFlags } from '../core/entitlements';
import { apiFetch, isBackendEnabled } from './apiClient';

export type RemoteAppConfig = {
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

export type BackendSubscriptionVerify = SubscriptionStatus & {
  verifiedAt: string;
};

export type BackendEntitlementsResponse = {
  deviceId: string;
  appUserId: string;
  subscription: BackendSubscriptionVerify;
  trial: TrialStatus;
  flags: EntitlementFlags;
  config: {
    trialDurationDays: number;
    adsEnabled: boolean;
    featureFlags: RemoteAppConfig['featureFlags'];
    minAppVersion: string;
  };
  verifiedAt: string;
};

export async function fetchRemoteConfig(): Promise<RemoteAppConfig> {
  return apiFetch<RemoteAppConfig>('/v1/config');
}

export async function verifySubscriptionRemote(
  appUserId: string
): Promise<BackendSubscriptionVerify> {
  return apiFetch<BackendSubscriptionVerify>('/v1/subscription/verify', {
    method: 'POST',
    body: JSON.stringify({ appUserId }),
  });
}

export async function claimTrialRemote(deviceId: string): Promise<TrialStatus> {
  return apiFetch<TrialStatus>('/v1/trial/claim', {
    method: 'POST',
    body: JSON.stringify({ deviceId }),
  });
}

export async function fetchEntitlementsRemote(
  deviceId: string,
  appUserId?: string
): Promise<BackendEntitlementsResponse> {
  const params = new URLSearchParams({ deviceId });
  if (appUserId) params.set('appUserId', appUserId);
  return apiFetch<BackendEntitlementsResponse>(`/v1/entitlements?${params}`);
}

export { isBackendEnabled };
