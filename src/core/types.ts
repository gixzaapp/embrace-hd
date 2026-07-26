import type { HdPresetChoice, HdPresetKey } from './constants';
import type { InputMediaKind, StatusLengthSec } from './requirements';

export type MediaSource = {
  uri: string;
  mimeType?: string;
  name?: string;
  kind?: InputMediaKind;
};

export type VideoProject = {
  id: string;
  title: string;
  preset: HdPresetChoice;
  durationSec: number;
  /** Selected WhatsApp Status length cap (30 or 60) */
  statusLengthSec?: StatusLengthSec;
  sources: MediaSource[];
  createdAt: string;
  updatedAt: string;
};

export type RenderJobStatus = 'idle' | 'queued' | 'rendering' | 'ready' | 'failed';

export type RenderJob = {
  id: string;
  projectId: string;
  status: RenderJobStatus;
  progress: number;
  outputUri?: string;
  /** Backend sent the file on WhatsApp instead of returning a local file */
  deliveredVia?: 'whatsapp' | 'file';
  error?: string;
  /** @deprecated Watermark burn-in removed; kept optional for old callers */
  watermarkApplied?: boolean;
};

export type StatusExportOptions = {
  /** Trim/pad to selected WhatsApp status length */
  fitToStatusDuration: boolean;
  /** Crop to 9:16 for status */
  verticalCrop: boolean;
  preset: HdPresetChoice;
  /** 30s or 60s status length */
  statusLengthSec: StatusLengthSec;
};

export type SharePayload = {
  title: string;
  text?: string;
  url?: string;
  files?: string[];
  dialogTitle?: string;
};

/** Concrete canvas when `auto` is not yet resolved (local encode fallback). */
export function resolveLocalPreset(preset: HdPresetChoice): HdPresetKey {
  return preset === 'auto' ? '720p' : preset;
}
