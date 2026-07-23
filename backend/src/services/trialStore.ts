import type { TrialClaimResult } from '../types.js';
import { trialsRepo } from '../storage/repositories.js';
import { getAppConfig } from './configStore.js';

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function diffCalendarDays(from: Date, to: Date): number {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function buildClaimResult(
  startDateIso: string | null,
  durationDays: number
): TrialClaimResult {
  if (!startDateIso) {
    return {
      phase: 'not_started',
      startDateIso: null,
      daysRemaining: durationDays,
      isExpired: false,
      premiumUnlocked: false,
      durationDays,
    };
  }

  const start = new Date(startDateIso);
  const elapsed = Number.isNaN(start.getTime())
    ? durationDays
    : diffCalendarDays(start, new Date());
  const daysRemaining = Math.max(0, durationDays - elapsed);
  const isExpired = daysRemaining <= 0;

  return {
    phase: isExpired ? 'expired' : 'active',
    startDateIso,
    daysRemaining,
    isExpired,
    premiumUnlocked: !isExpired,
    durationDays,
  };
}

/**
 * Idempotent trial claim keyed by deviceId.
 * Reinstall with the same deviceId returns the original start date.
 */
export async function claimTrial(deviceId: string): Promise<TrialClaimResult> {
  const id = deviceId.trim();
  if (!id) {
    throw new Error('deviceId is required');
  }

  const config = await getAppConfig();
  const durationDays = config.trialDurationDays;
  const existing = await trialsRepo.get(id);

  if (existing?.startDateIso) {
    return buildClaimResult(existing.startDateIso, durationDays);
  }

  const startDateIso = new Date().toISOString();
  await trialsRepo.put({
    deviceId: id,
    startDateIso,
    claimedAt: startDateIso,
  });
  return buildClaimResult(startDateIso, durationDays);
}

export async function getTrialForDevice(deviceId: string): Promise<TrialClaimResult> {
  const id = deviceId.trim();
  const config = await getAppConfig();
  const existing = await trialsRepo.get(id);
  return buildClaimResult(existing?.startDateIso ?? null, config.trialDurationDays);
}
