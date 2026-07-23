import {
  INPUT_REQUIREMENTS,
  OUTPUT_REQUIREMENTS,
  QUALITY_REQUIREMENTS,
  STATUS_LENGTH_OPTIONS,
  type InputMediaKind,
  type StatusLengthSec,
} from './requirements';
import type { HdPresetKey } from './constants';

export type ExportConstraints = {
  durationSec: number;
  preset: HdPresetKey;
  /** Cap used for this export (defaults to absolute max) */
  maxDurationSec?: StatusLengthSec;
  estimatedSizeBytes?: number;
};

export function isAcceptedMimeType(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  return (INPUT_REQUIREMENTS.acceptedMimeTypes as readonly string[]).includes(mimeType);
}

export function inferInputKind(mimeType: string | undefined): InputMediaKind | null {
  if (!mimeType) return null;
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('image/')) return 'image';
  return null;
}

export function isStatusLengthSec(value: number): value is StatusLengthSec {
  return (STATUS_LENGTH_OPTIONS as readonly number[]).includes(value);
}

/** Max average video bitrate (Mbps) to stay under the WhatsApp size budget */
export function maxBitrateMbpsForDuration(
  durationSec: number,
  maxBytes = OUTPUT_REQUIREMENTS.maxFileSizeBytes,
  maxDurationSec: StatusLengthSec = OUTPUT_REQUIREMENTS.maxDurationSec
): number {
  const safeDuration = Math.max(1, Math.min(durationSec, maxDurationSec));
  // Reserve ~10% for container + AAC audio
  const videoBytes = maxBytes * 0.9;
  const bitsPerSec = (videoBytes * 8) / safeDuration;
  return Math.round((bitsPerSec / 1_000_000) * 100) / 100;
}

export function meetsDurationCap(
  durationSec: number,
  maxDurationSec: StatusLengthSec = OUTPUT_REQUIREMENTS.maxDurationSec
): boolean {
  return durationSec > 0 && durationSec <= maxDurationSec;
}

export function meetsSizeCap(sizeBytes: number): boolean {
  return sizeBytes > 0 && sizeBytes <= OUTPUT_REQUIREMENTS.maxFileSizeBytes;
}

export function validateExportConstraints(constraints: ExportConstraints): string[] {
  const errors: string[] = [];
  const maxDurationSec = constraints.maxDurationSec ?? OUTPUT_REQUIREMENTS.maxDurationSec;

  if (!OUTPUT_REQUIREMENTS.allowedPresets.includes(constraints.preset)) {
    errors.push(`Preset must be one of: ${OUTPUT_REQUIREMENTS.allowedPresets.join(', ')}`);
  }
  if (!meetsDurationCap(constraints.durationSec, maxDurationSec)) {
    errors.push(`Duration must be between 0 and ${maxDurationSec}s`);
  }
  if (
    constraints.estimatedSizeBytes != null &&
    !meetsSizeCap(constraints.estimatedSizeBytes)
  ) {
    errors.push(`File size must be ≤ ~${OUTPUT_REQUIREMENTS.maxFileSizeMb}MB`);
  }

  return errors;
}

/** Suggest encode settings that honor size + quality floor */
export function suggestEncodeSettings(
  durationSec: number,
  preset: HdPresetKey,
  maxDurationSec: StatusLengthSec = OUTPUT_REQUIREMENTS.maxDurationSec
) {
  const capMbps = maxBitrateMbpsForDuration(durationSec, undefined, maxDurationSec);
  const qualityFloorMbps = preset === '1080p' ? 10 : 6;
  const qualityCeilingMbps = preset === '1080p' ? 14 : 8;
  const bitrateMbps = Math.max(
    qualityFloorMbps,
    Math.min(Math.max(capMbps, qualityFloorMbps), qualityCeilingMbps)
  );

  return {
    preset,
    fps: OUTPUT_REQUIREMENTS.defaultFps,
    bitrateMbps,
    crf: QUALITY_REQUIREMENTS.minCrfQuality,
    preferRemux: QUALITY_REQUIREMENTS.preferLosslessRemux,
    maxEncodePasses: QUALITY_REQUIREMENTS.maxEncodePasses,
    audioBitrateKbps: QUALITY_REQUIREMENTS.audioBitrateKbps,
  };
}
