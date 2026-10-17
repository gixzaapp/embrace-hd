/** Shared app identity and resolution presets */

export const HD_PRESETS = {
  '720p': { width: 720, height: 1280, label: 'HD 720p' },
  '1080p': { width: 1080, height: 1920, label: 'Full HD 1080p' },
} as const;

export type HdPresetKey = keyof typeof HD_PRESETS;

/** Backend picks from source; falls back to 720p if probe fails. */
export type HdPresetChoice = HdPresetKey | 'auto';

export const APP = {
  name: 'HD Status EmbraceHD',
  tagline: 'HD Video Generator — WhatsApp Ready',
  id: 'uk.co.embraceapp.app',
} as const;

/**
 * In-app preview of the converted video.
 * The backend convertPreview flag must also be on. Android stays WhatsApp-only.
 */
export const CONVERT_PREVIEW_PLATFORMS = {
  ios: true,
  android: false,
  web: false,
} as const;

export function isConvertPreviewEnabled(platform: string): boolean {
  if (platform === 'ios') return CONVERT_PREVIEW_PLATFORMS.ios;
  if (platform === 'android') return CONVERT_PREVIEW_PLATFORMS.android;
  return CONVERT_PREVIEW_PLATFORMS.web;
}
