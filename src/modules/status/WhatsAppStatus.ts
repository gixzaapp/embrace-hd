import {
  WHATSAPP_STATUS,
  clampDuration,
  getCoreRequirementSummaries,
  suggestEncodeSettings,
  type RenderJob,
  type StatusExportOptions,
  type StatusLengthSec,
  type VideoProject,
} from '../../core';
import { videoEngine } from '../video';

/**
 * Prepares projects for WhatsApp Status per core output requirements
 * (vertical HD, 30s or 60s, ≤~16MB, H.264/MP4).
 */
export class WhatsAppStatusExporter {
  async prepareProject(
    project: VideoProject,
    options: StatusExportOptions
  ): Promise<VideoProject> {
    const lengthCap = options.statusLengthSec;
    const durationSec = options.fitToStatusDuration
      ? clampDuration(project.durationSec || lengthCap, lengthCap)
      : project.durationSec;

    return {
      ...project,
      preset: options.preset,
      statusLengthSec: lengthCap,
      durationSec,
      updatedAt: new Date().toISOString(),
    };
  }

  async exportForStatus(
    project: VideoProject,
    options: StatusExportOptions,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal
  ): Promise<RenderJob> {
    const prepared = await this.prepareProject(project, options);
    const composition = await videoEngine.buildComposition(prepared);
    const encode = suggestEncodeSettings(
      prepared.durationSec,
      options.preset,
      options.statusLengthSec
    );

    return videoEngine.render(
      composition,
      { ...encode, signal },
      onProgress
    );
  }

  getStatusHints(statusLengthSec?: StatusLengthSec): string[] {
    return getCoreRequirementSummaries(
      statusLengthSec ?? WHATSAPP_STATUS.defaultLengthSec
    );
  }
}

export const whatsAppStatusExporter = new WhatsAppStatusExporter();
