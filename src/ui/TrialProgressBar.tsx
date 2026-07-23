import { useTrial } from './TrialProvider';
import './TrialProgressBar.css';

/**
 * Storage-style progress mapped to trial / subscription status.
 */
export const TrialProgressBar: React.FC = () => {
  const { loading, status, isSubscribed, countdownLabel, isTrialExpired } = useTrial();

  if (loading || !status) return null;

  let label = 'TRIAL';
  let valueLabel = '';
  let percent = 0;

  if (isSubscribed) {
    label = 'PREMIUM';
    valueLabel = 'ACTIVE';
    percent = 100;
  } else if (isTrialExpired || status.phase === 'expired') {
    label = 'TRIAL';
    valueLabel = 'ENDED';
    percent = 100;
  } else if (status.phase === 'active') {
    const used = Math.max(
      0,
      Math.min(100, ((status.durationDays - status.daysRemaining) / status.durationDays) * 100)
    );
    label = 'TRIAL';
    valueLabel = countdownLabel?.toUpperCase() ?? `${Math.round(status.daysRemaining)}D LEFT`;
    percent = used;
  } else {
    label = 'TRIAL';
    valueLabel = 'READY';
    percent = 0;
  }

  return (
    <div className="trial-progress" role="status">
      <div className="trial-progress-row">
        <span className="font-label-sm trial-progress-label">
          <span className="material-symbols-outlined trial-progress-icon" aria-hidden>
            storage
          </span>
          {label}
        </span>
        <span
          className={`font-label-sm trial-progress-value${
            isTrialExpired && !isSubscribed ? ' trial-progress-value--locked' : ''
          }`}
        >
          {valueLabel}
        </span>
      </div>
      <div className="trial-progress-track">
        <div
          className={`trial-progress-fill${
            isTrialExpired && !isSubscribed ? ' trial-progress-fill--locked' : ''
          }`}
          style={{ width: `${percent}%` }}
        >
          <div className="trial-progress-sheen" />
        </div>
      </div>
    </div>
  );
};
