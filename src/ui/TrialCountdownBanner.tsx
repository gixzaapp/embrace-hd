import { useTrial } from './TrialProvider';
import './TrialCountdownBanner.css';

/**
 * Active trial → countdown.
 * Expired → free plan with ads (convert still available).
 * Premium → unlocked.
 */
export const TrialCountdownBanner: React.FC = () => {
  const {
    status,
    loading,
    countdownLabel,
    isSubscribed,
    isTrialExpired,
    subscription,
  } = useTrial();

  if (loading || !status) return null;

  if (isSubscribed) {
    const planLabel = subscription?.activePlan
      ? subscription.activePlan.charAt(0).toUpperCase() + subscription.activePlan.slice(1)
      : 'Premium';
    return (
      <div className="trial-banner trial-banner--active" role="status">
        <p className="trial-banner-eyebrow">Subscribed</p>
        <p className="trial-banner-title">{planLabel} unlocked</p>
      </div>
    );
  }

  if (status.phase === 'active' && countdownLabel) {
    return (
      <div className="trial-banner trial-banner--active" role="status">
        <p className="trial-banner-eyebrow">Free trial</p>
        <p className="trial-banner-title">{countdownLabel}</p>
        <p className="trial-banner-body">Ads shown during trial</p>
      </div>
    );
  }

  if (isTrialExpired || status.phase === 'expired') {
    return (
      <div className="trial-banner trial-banner--free" role="status">
        <p className="trial-banner-eyebrow">Free with ads</p>
        <p className="trial-banner-title">You can still convert</p>
        <p className="trial-banner-body">
          Your trial ended, but Embrace HD stays free with ads. Longer videos split into 30-second
          Status parts (e.g. 60s → 2 parts). Subscribe for 60-second Status and ad-free.
        </p>
      </div>
    );
  }

  return null;
};
