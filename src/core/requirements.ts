/**
 * Core product requirements for Embrace HD.
 * Single source of truth for input, output, quality, and performance targets.
 */

import { HD_PRESETS, type HdPresetKey } from './constants';

/** Accepted user input media */
export const INPUT_REQUIREMENTS = {
  /** User picks one of these via the device picker */
  acceptedKinds: ['video', 'image'] as const,
  acceptedMimeTypes: [
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
  ] as const,
  /** Images become a still (or Ken Burns) clip inside the HD export */
  imageDefaultDurationSec: 5,
} as const;

export type InputMediaKind = (typeof INPUT_REQUIREMENTS.acceptedKinds)[number];

/** Selectable WhatsApp Status lengths */
export const STATUS_LENGTH_OPTIONS = [30, 60] as const;
export type StatusLengthSec = (typeof STATUS_LENGTH_OPTIONS)[number];

/** WhatsApp-optimized HD export contract */
export const OUTPUT_REQUIREMENTS = {
  resolutions: HD_PRESETS,
  allowedPresets: ['720p', '1080p'] as HdPresetKey[],
  /** User-selectable status lengths */
  statusLengthOptions: STATUS_LENGTH_OPTIONS,
  defaultStatusLengthSec: 30 as StatusLengthSec,
  /** Absolute hard cap (longest selectable option) */
  maxDurationSec: 60 as StatusLengthSec,
  /**
   * Soft ceiling for chat-HD masters (WhatsApp chat media can be ~64–100MB).
   * Status direct posts still re-encode; use HD chat → Forward for best Status.
   */
  maxFileSizeBytes: 98 * 1024 * 1024,
  maxFileSizeMb: 98,
  container: 'mp4' as const,
  videoCodec: 'h264' as const,
  audioCodec: 'aac' as const,
  preferredAspect: '9:16' as const,
  fps: [24, 30] as const,
  defaultFps: 30 as const,
} as const;

/** Alias used by status / share modules */
export const WHATSAPP_STATUS = {
  lengthOptions: OUTPUT_REQUIREMENTS.statusLengthOptions,
  defaultLengthSec: OUTPUT_REQUIREMENTS.defaultStatusLengthSec,
  maxDurationSec: OUTPUT_REQUIREMENTS.maxDurationSec,
  maxFileSizeBytes: OUTPUT_REQUIREMENTS.maxFileSizeBytes,
  maxFileSizeMb: OUTPUT_REQUIREMENTS.maxFileSizeMb,
  aspectRatio: OUTPUT_REQUIREMENTS.preferredAspect,
  videoCodec: OUTPUT_REQUIREMENTS.videoCodec,
  audioCodec: OUTPUT_REQUIREMENTS.audioCodec,
  container: OUTPUT_REQUIREMENTS.container,
} as const;

/**
 * Quality policy: avoid perceptible loss while still hitting size/duration caps.
 * True lossless H.264 is impractical for WhatsApp; we treat “no quality loss” as:
 * - Prefer stream-copy / remux when input already meets the output contract
 * - Otherwise encode once at a quality floor (never multi-pass crush)
 * - Cap bitrate only as needed to stay ≤ maxFileSizeBytes
 */
export const QUALITY_REQUIREMENTS = {
  /** Never re-encode more than once in the export pipeline */
  maxEncodePasses: 1,
  /** Remux/copy when source already matches preset + duration + size */
  preferLosslessRemux: true,
  /** CRF floor when encoding (lower = better). Maximum quality target. */
  /** CRF not used for Status path — bitrate-targeted encode matches WA */
  minCrfQuality: 18,
  maxCrfQuality: 23,
  /** Do not downscale below the user-selected HD preset */
  neverDownscaleBelowPreset: true,
  /** Clear AAC for status viewing */
  audioBitrateKbps: 192,
} as const;

/** On-device speed targets — processing must feel snappy on mid-range phones */
export const PERFORMANCE_REQUIREMENTS = {
  processingLocale: 'on-device' as const,
  /** Prefer backend FFmpeg when VITE_BACKEND_ENABLED; else native LiTr / wasm */
  compressionEngine: 'backend-ffmpeg' as const,
  /** Prefer hardware encoder when a native path is available later */
  preferHardwareEncoder: true,
  /** Soft UX budget from tap “Generate” to share-ready file */
  targetMaxProcessingMs: 15_000,
  /** Warn in UI if a job exceeds this (still allow completion) */
  softTimeoutMs: 30_000,
  /** Parallel decode/encode only if it does not thrash memory */
  allowParallelPipelines: false,
} as const;

export const CORE_REQUIREMENTS = {
  input: INPUT_REQUIREMENTS,
  output: OUTPUT_REQUIREMENTS,
  quality: QUALITY_REQUIREMENTS,
  performance: PERFORMANCE_REQUIREMENTS,
} as const;

export type CoreRequirements = typeof CORE_REQUIREMENTS;

/** Human-readable checklist for UI / docs */
export function getCoreRequirementSummaries(
  statusLengthSec: StatusLengthSec = OUTPUT_REQUIREMENTS.defaultStatusLengthSec
): string[] {
  return [
    'Input: select a video or image',
    `Output: HD ${OUTPUT_REQUIREMENTS.allowedPresets.join(' / ')} · WhatsApp-ready`,
    `Status length: ${statusLengthSec}s (choose ${STATUS_LENGTH_OPTIONS.join(' or ')}s)`,
    `≤ ~${OUTPUT_REQUIREMENTS.maxFileSizeMb}MB`,
    'No quality loss: remux when possible, single high-quality encode otherwise',
    'Fast on-device processing',
  ];
}
