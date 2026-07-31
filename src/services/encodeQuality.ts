/** FFmpeg libx264 -preset choices exposed in the convert UI. */
export type EncodeQualityChoice = 'veryfast' | 'fast' | 'slow';

export type EncodeQualityOption = {
  id: EncodeQualityChoice;
  title: string;
  subtitle: string;
  /** Rough encode-time factor vs realtime (per Status segment). */
  timeFactor: number;
};

export const ENCODE_QUALITY_OPTIONS: EncodeQualityOption[] = [
  {
    id: 'veryfast',
    title: 'Fast',
    subtitle: 'Basic Quality',
    timeFactor: 0.35,
  },
  {
    id: 'fast',
    title: 'Optimal',
    subtitle: 'Best Quality',
    timeFactor: 0.9,
  },
  {
    id: 'slow',
    title: 'Slow',
    subtitle: 'Super Quality',
    timeFactor: 2.5,
  },
];

export const DEFAULT_ENCODE_QUALITY: EncodeQualityChoice = 'fast';

/** Estimate conversion time from clip length + quality choice. */
export function estimateConversionTimeSec(options: {
  videoDurationSec: number;
  statusLengthSec: number;
  quality: EncodeQualityChoice;
}): number {
  const statusLen = options.statusLengthSec || 30;
  const duration = Math.max(1, options.videoDurationSec || statusLen);
  const segments = Math.max(1, Math.ceil(duration / statusLen));
  const perSeg = Math.min(duration, statusLen);
  const factor =
    ENCODE_QUALITY_OPTIONS.find((o) => o.id === options.quality)?.timeFactor ??
    0.9;
  return Math.max(8, Math.round(segments * perSeg * factor));
}

export function formatConversionTime(sec: number): string {
  if (sec < 60) return `About ${sec} sec`;
  const minutes = Math.max(1, Math.round(sec / 60));
  return minutes === 1 ? 'About 1 min' : `About ${minutes} min`;
}
