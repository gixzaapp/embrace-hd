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
    if (
      !earliest ||
      new Date(record.startDateIso).getTime() < new Date(earliest).getTime()
    ) {
      earliest = record.startDateIso;
    }
  }
  return earliest;
}

async function claimTrialForUser(
  userId: string,
  deviceId: string,
  durationDays: number
): Promise<TrialClaimResult> {
  const existingUserTrial = await userTrialsRepo.get(userId);
  if (existingUserTrial?.startDateIso) {
    return buildClaimResult(existingUserTrial.startDateIso, durationDays);
  }

  const user = await getUserById(userId);
  const deviceIds = new Set<string>([deviceId.trim()]);
  for (const id of user?.deviceIds ?? []) {
    if (id.trim()) deviceIds.add(id.trim());
  }

  const migratedStart = await earliestDeviceTrialStart(deviceIds);
  if (migratedStart) {
    const claimedAt = new Date().toISOString();
    await userTrialsRepo.put({
      userId,
      startDateIso: migratedStart,
      claimedAt,
    });
    return buildClaimResult(migratedStart, durationDays);
  }

  const startDateIso = new Date().toISOString();
  const claimedAt = startDateIso;
  await userTrialsRepo.put({ userId, startDateIso, claimedAt });
  await trialsRepo.put({
    deviceId: deviceId.trim(),
    startDateIso,
    claimedAt,
  });
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
 * Anonymous / offline clients fall back to deviceId.
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

export async function getTrialForDevice(deviceId: string): Promise<TrialClaimResult> {
  const id = deviceId.trim();
  const config = await getAppConfig();
  const existing = await trialsRepo.get(id);
  return buildClaimResult(existing?.startDateIso ?? null, config.trialDurationDays);
}
