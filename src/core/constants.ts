/** Shared app identity and resolution presets */

export const HD_PRESETS = {
  '720p': { width: 720, height: 1280, label: 'HD 720p' },
  '1080p': { width: 1080, height: 1920, label: 'Full HD 1080p' },
} as const;

export type HdPresetKey = keyof typeof HD_PRESETS;

export const APP = {
  name: 'Embrace HD',
  tagline: 'HD Video Generator — WhatsApp Ready',
  id: 'com.embracehd.app',
} as const;
