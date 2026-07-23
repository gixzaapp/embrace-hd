/** Local trial configuration */

export const TRIAL_STORAGE_KEY = 'embrace_hd_trial_start_iso' as const;

/** Free trial length in calendar days */
export const TRIAL_DURATION_DAYS = 7;

export type TrialPhase = 'not_started' | 'active' | 'expired';

export type TrialStatus = {
  phase: TrialPhase;
  /** ISO 8601 start date when trial has begun */
  startDateIso: string | null;
  daysRemaining: number;
  isExpired: boolean;
  /** Premium unlocked via active (non-expired) trial */
  premiumUnlocked: boolean;
  durationDays: number;
};

/** Banner copy: "5 days left", "1 day left" */
export function formatTrialCountdown(daysRemaining: number): string {
  const days = Math.max(0, Math.floor(daysRemaining));
  if (days === 1) return '1 day left';
  return `${days} days left`;
}
