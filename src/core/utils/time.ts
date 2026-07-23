export function clampDuration(seconds: number, maxSec: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds, maxSec);
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}
