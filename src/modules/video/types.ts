import type { HdPresetChoice, MediaSource, VideoProject } from '../../core';

export type VideoComposition = {
  project: VideoProject;
  timeline: TimelineClip[];
};

export type TimelineClip = {
  id: string;
  source: MediaSource;
  startSec: number;
  endSec: number;
  order: number;
};

export type EncodeOptions = {
  preset: HdPresetChoice;
  fps: 24 | 30;
  bitrateMbps: number;
  crf: number;
  preferRemux: boolean;
  maxEncodePasses: number;
  audioBitrateKbps: number;
  /** Optional cancel for backend / long encodes */
  signal?: AbortSignal;
  /** Session token — required when backend delivers via WhatsApp */
  authToken?: string;
};
