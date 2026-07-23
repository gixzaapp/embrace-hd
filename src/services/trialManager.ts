import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import {
  TRIAL_DURATION_DAYS,
  TRIAL_STORAGE_KEY,
  type TrialStatus,
} from '../core/trial';

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseIsoDate(iso: string): Date | null {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function diffCalendarDays(from: Date, to: Date): number {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

async function readTrialStartIso(): Promise<string | null> {
  try {
    const { value } = await SecureStoragePlugin.get({ key: TRIAL_STORAGE_KEY });
    if (!value || !parseIsoDate(value)) return null;
    return value;
  } catch {
    // Key missing or secure storage unavailable
    return null;
  }
}

async function writeTrialStartIso(iso: string): Promise<void> {
  await SecureStoragePlugin.set({
    key: TRIAL_STORAGE_KEY,
    value: iso,
  });
}

function buildStatus(startDateIso: string | null, daysLeft: number): TrialStatus {
  if (!startDateIso) {
    return {
      phase: 'not_started',
      startDateIso: null,
      daysRemaining: TRIAL_DURATION_DAYS,
      isExpired: false,
      premiumUnlocked: false,
      durationDays: TRIAL_DURATION_DAYS,
    };
  }

  const expired = daysLeft <= 0;
  return {
    phase: expired ? 'expired' : 'active',
    startDateIso,
    daysRemaining: Math.max(0, daysLeft),
    isExpired: expired,
    premiumUnlocked: !expired,
    durationDays: TRIAL_DURATION_DAYS,
  };
}

/**
 * Local trial tracking — start date stored as ISO string in Capacitor Secure Storage.
 */
export class TrialManager {
  readonly durationDays = TRIAL_DURATION_DAYS;
  readonly storageKey = TRIAL_STORAGE_KEY;

  async getTrialStatus(): Promise<TrialStatus> {
    const startDateIso = await readTrialStartIso();
    if (!startDateIso) {
      return buildStatus(null, this.durationDays);
    }
    const remaining = await this.daysRemaining();
    return buildStatus(startDateIso, remaining);
  }

  /**
   * Persists trial start as an ISO date string if not already started.
   * Returns the (existing or new) start date ISO.
   */
  async startTrial(): Promise<string> {
    const existing = await readTrialStartIso();
    if (existing) return existing;

    const startDateIso = new Date().toISOString();
    await writeTrialStartIso(startDateIso);
    return startDateIso;
  }

  /**
   * App-launch bootstrap:
   * - No start date → set today and begin trial
   * - Otherwise return current active / expired status
   */
  async initializeOnLaunch(): Promise<TrialStatus> {
    const existing = await readTrialStartIso();
    if (!existing) {
      await this.startTrial();
    }
    return this.getTrialStatus();
  }

  /** Whole calendar days left (0 when expired). */
  async daysRemaining(): Promise<number> {
    const startDateIso = await readTrialStartIso();
    if (!startDateIso) return this.durationDays;

    const start = parseIsoDate(startDateIso);
    if (!start) return 0;

    const elapsed = diffCalendarDays(start, new Date());
    return Math.max(0, this.durationDays - elapsed);
  }

  async isTrialExpired(): Promise<boolean> {
    const startDateIso = await readTrialStartIso();
    if (!startDateIso) return false;
    return (await this.daysRemaining()) <= 0;
  }
}

export const trialManager = new TrialManager();

export const getTrialStatus = () => trialManager.getTrialStatus();
export const startTrial = () => trialManager.startTrial();
export const daysRemaining = () => trialManager.daysRemaining();
export const isTrialExpired = () => trialManager.isTrialExpired();
export const initializeTrialOnLaunch = () => trialManager.initializeOnLaunch();
