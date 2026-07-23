import { useTrial } from './TrialProvider';
import './TrialCountdownBanner.css';

/**
 * Active trial → countdown.
 * Expired → HD locked + ads.
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
      <div className="trial-banner trial-banner--locked" role="status">
        <p className="trial-banner-title">Trial ended</p>
        <p className="trial-banner-body">
          HD export locked. Ads remain until you subscribe.
        </p>
      </div>
    );
  }

  return null;
};
