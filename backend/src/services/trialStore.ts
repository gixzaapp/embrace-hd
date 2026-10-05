import type { TrialClaimResult } from '../types.js';
import { trialsRepo, userTrialsRepo } from '../storage/repositories.js';
import { getUserById } from './userStore.js';
import { getAppConfig } from './configStore.js';

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function diffCalendarDays(from: Date, to: Date): number {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function earlierIso(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
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

async function earliestDeviceTrialStart(
  deviceIds: Iterable<string>
): Promise<string | null> {
  let earliest: string | null = null;
  for (const id of deviceIds) {
    const trimmed = id.trim();
    if (!trimmed) continue;
    const record = await trialsRepo.get(trimmed);
    if (!record?.startDateIso) continue;
    earliest = earlierIso(earliest, record.startDateIso);
  }
  return earliest;
}

async function persistUserTrial(
  userId: string,
  startDateIso: string,
  deviceId?: string
): Promise<void> {
  const claimedAt = new Date().toISOString();
  await userTrialsRepo.put({ userId, startDateIso, claimedAt });
  if (deviceId?.trim()) {
    await trialsRepo.put({
      deviceId: deviceId.trim(),
      startDateIso,
      claimedAt,
    });
  }
}

async function claimTrialForUser(
  userId: string,
  deviceId: string,
  durationDays: number
): Promise<TrialClaimResult> {
  const user = await getUserById(userId);
  const deviceIds = new Set<string>();
  if (deviceId.trim()) deviceIds.add(deviceId.trim());
  for (const id of user?.deviceIds ?? []) {
    if (id.trim()) deviceIds.add(id.trim());
  }

  const fromDevices = await earliestDeviceTrialStart(deviceIds);
  // Account age is a fallback when old device trials were lost on reinstall
  const fromAccount = user?.createdAt ?? null;
  const recoveredStart = earlierIso(fromDevices, fromAccount);

  const existingUserTrial = await userTrialsRepo.get(userId);
  const bestStart = earlierIso(existingUserTrial?.startDateIso, recoveredStart);

  if (bestStart) {
    // Always persist the earliest known start (repairs a wrongly-reset user_trials row)
    await persistUserTrial(userId, bestStart, deviceId);
    return buildClaimResult(bestStart, durationDays);
  }

  // Genuinely new account — start trial now
  const startDateIso = new Date().toISOString();
  await persistUserTrial(userId, startDateIso, deviceId);
  return buildClaimResult(startDateIso, durationDays);
}

async function claimTrialForDevice(
  deviceId: string,
  durationDays: number
): Promise<TrialClaimResult> {
  const id = deviceId.trim();
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

/**
 * Idempotent trial claim.
 * Logged-in users are keyed by account (WhatsApp user id), not device — reinstall safe.
 * Anonymous clients may fall back to deviceId (prefer read-only via getTrialForDevice).
 */
export async function claimTrial(
  deviceId: string,
  userId?: string
): Promise<TrialClaimResult> {
  const id = deviceId.trim();
  if (!id) {
    throw new Error('deviceId is required');
  }

  const config = await getAppConfig();
  const durationDays = config.trialDurationDays;

  if (userId?.trim()) {
    return claimTrialForUser(userId.trim(), id, durationDays);
  }

  return claimTrialForDevice(id, durationDays);
}

/** Read device trial without creating a new claim (safe before login / reinstall). */
export async function getTrialForDevice(deviceId: string): Promise<TrialClaimResult> {
  const id = deviceId.trim();
  const config = await getAppConfig();
  const existing = await trialsRepo.get(id);
  return buildClaimResult(existing?.startDateIso ?? null, config.trialDurationDays);
}
