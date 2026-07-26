import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { resolveEntitlements, type EntitlementFlags } from '../core/entitlements';
import { formatTrialCountdown, type TrialStatus } from '../core/trial';
import type { SubscriptionStatus } from '../core/subscription';
import { initializeTrialOnLaunch, trialManager } from '../services/trialManager';
import { purchaseManager } from '../services/purchaseManager';
import { adsManager } from '../services/adsManager';
import { getOrCreateDeviceId } from '../services/deviceId';
import {
  fetchEntitlementsRemote,
  isBackendEnabled,
} from '../services/backendEntitlements';

type TrialContextValue = {
  status: TrialStatus | null;
  subscription: SubscriptionStatus | null;
  loading: boolean;
  error: string | null;
  isSubscribed: boolean;
  isTrialActive: boolean;
  isTrialExpired: boolean;
  /** Trial active OR premium — HD export allowed */
  canExportHd: boolean;
  /** @deprecated use canExportHd */
  premiumUnlocked: boolean;
  /** Always false — watermark burn-in removed */
  shouldApplyWatermark: boolean;
  /** Trial active or expired → Google Ads */
  shouldShowAds: boolean;
  /** Settings → Log out (from backend featureFlags.showLogout) */
  showLogout: boolean;
  /** Settings → Unlock Premium (from backend featureFlags.showUnlockPremium) */
  showUnlockPremium: boolean;
  countdownLabel: string | null;
  /** True when last refresh used the Node backend */
  serverVerified: boolean;
  refresh: () => Promise<void>;
};

const TrialContext = createContext<TrialContextValue | null>(null);

const idleTrial: TrialStatus = {
  phase: 'not_started',
  startDateIso: null,
  daysRemaining: trialManager.durationDays,
  isExpired: false,
  premiumUnlocked: false,
  durationDays: trialManager.durationDays,
};

export const TrialProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<TrialStatus | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [serverFlags, setServerFlags] = useState<EntitlementFlags | null>(null);
  const [showLogout, setShowLogout] = useState(false);
  const [showUnlockPremium, setShowUnlockPremium] = useState(false);
  const [serverVerified, setServerVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setServerVerified(false);
    setServerFlags(null);
    setShowLogout(false);
    setShowUnlockPremium(false);

    try {
      const deviceId = await getOrCreateDeviceId();
      await Promise.all([
        purchaseManager.configure(deviceId),
        adsManager.initialize(),
      ]);

      // Always keep local trial clock as offline fallback
      const [localTrial, localSub] = await Promise.all([
        initializeTrialOnLaunch(),
        purchaseManager.checkSubscription().catch(() => null),
      ]);

      setStatus(localTrial);
      setSubscription(localSub);

      if (isBackendEnabled()) {
        try {
          const remote = await fetchEntitlementsRemote(deviceId, deviceId);
          setStatus(remote.trial);
          setSubscription({
            isPremium: remote.subscription.isPremium,
            entitlementId: remote.subscription.entitlementId,
            activePlan: remote.subscription.activePlan,
            productIdentifier: remote.subscription.productIdentifier,
            expirationDate: remote.subscription.expirationDate,
            willRenew: remote.subscription.willRenew,
          });
          setServerFlags(remote.flags);
          setShowLogout(Boolean(remote.config.featureFlags?.showLogout));
          setShowUnlockPremium(Boolean(remote.config.featureFlags?.showUnlockPremium));
          setServerVerified(true);
        } catch (apiErr) {
          console.warn('[TrialProvider] Backend entitlements failed; using local', apiErr);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load entitlement status');
      setStatus(idleTrial);
      setSubscription(null);
      setServerFlags(null);
      setShowLogout(false);
      setShowUnlockPremium(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<TrialContextValue>(() => {
    const localFlags = resolveEntitlements({
      isSubscribed: subscription?.isPremium ?? false,
      trialPhase: status?.phase ?? null,
    });
    const flags = serverFlags ?? localFlags;

    const countdownLabel =
      flags.isTrialActive && status
        ? formatTrialCountdown(status.daysRemaining)
        : null;

    return {
      status,
      subscription,
      loading,
      error,
      isSubscribed: flags.isPremiumUser,
      isTrialActive: flags.isTrialActive,
      isTrialExpired: flags.isTrialExpired,
      canExportHd: flags.canExportHd,
      premiumUnlocked: flags.canExportHd,
      shouldApplyWatermark: false,
      shouldShowAds: flags.shouldShowAds,
      showLogout,
      showUnlockPremium,
      countdownLabel,
      serverVerified,
      refresh,
    };
  }, [
    status,
    subscription,
    loading,
    error,
    refresh,
    serverFlags,
    serverVerified,
    showLogout,
    showUnlockPremium,
  ]);

  return <TrialContext.Provider value={value}>{children}</TrialContext.Provider>;
};

export function useTrial(): TrialContextValue {
  const ctx = useContext(TrialContext);
  if (!ctx) {
    throw new Error('useTrial must be used within TrialProvider');
  }
  return ctx;
}
