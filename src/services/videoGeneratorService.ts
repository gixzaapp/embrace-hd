import {
  appConfig,
  createId,
  type HdPresetChoice,
  type MediaSource,
  type StatusExportOptions,
  type StatusLengthSec,
  type VideoProject,
} from '../core';
import { whatsAppStatusExporter } from '../modules/status';
import { videoEngine } from '../modules/video';
import { saveExportToGallery, type GalleryItem } from './galleryLibrary';
import type { ConvertProgressUpdate } from './backendExport';
import type { EncodeQualityChoice } from './encodeQuality';
import {
  shareMedia,
  shareToWhatsAppChatForHdStatus,
  shareToWhatsAppStatus,
  shareFileForPcOrNetwork,
} from './shareService';

export type GenerateStatusOptions = {
  statusLengthSec?: StatusLengthSec;
  /** Required — picked video or image */
  source: MediaSource;
  /** From entitlement rules — expired trial blocks export */
  canExportHd?: boolean;
  /** Session token for authenticated backend WhatsApp delivery */
  authToken?: string;
  /** FFmpeg x264 -preset (speed / quality) */
  x264Preset?: EncodeQualityChoice;
  onProgress?: (update: ConvertProgressUpdate) => void;
  signal?: AbortSignal;
};

/**
 * Orchestrates create → render → save → WhatsApp-ready share flow.
 */
export class VideoGeneratorService {
  async createNewProject(title = 'Untitled HD Video', preset?: HdPresetChoice): Promise<VideoProject> {
    return videoEngine.createProject(title, preset ?? appConfig.defaults.preset);
  }

  async renderWhatsAppStatus(
    project: VideoProject,
    overrides?: Partial<StatusExportOptions>,
    onProgress?: (update: ConvertProgressUpdate) => void,
    signal?: AbortSignal,
    authToken?: string,
    x264Preset?: EncodeQualityChoice
  ) {
    const options: StatusExportOptions = {
      ...appConfig.defaults.statusExport,
      ...overrides,
    };
    return whatsAppStatusExporter.exportForStatus(
      project,
      options,
      onProgress,
      signal,
      authToken,
      x264Preset
    );
  }

  /** Official SHARE_TO_STATUS intent (falls back to share sheet). */
  async shareToWhatsAppStatus(fileUri: string): Promise<boolean> {
    if (!fileUri || fileUri.startsWith('file://embrace-hd/')) {
      throw new Error('Export produced no real media file');
    }
    return shareToWhatsAppStatus(fileUri);
  }

  /** HD chat → Forward → Status quality path. */
  async shareViaHdChatThenStatus(fileUri: string): Promise<boolean> {
    if (!fileUri || fileUri.startsWith('file://embrace-hd/')) {
      throw new Error('Export produced no real media file');
    }
    return shareToWhatsAppChatForHdStatus(fileUri);
  }

  /**
   * System share sheet — save to Files / network folder / Drive for PC upload
   * (WhatsApp Desktop / Web often keeps more quality than phone Status upload).
   */
  async shareForPcOrNetwork(fileUri: string): Promise<boolean> {
    if (!fileUri || fileUri.startsWith('file://embrace-hd/')) {
      throw new Error('Export produced no real media file');
    }
    return shareFileForPcOrNetwork(fileUri);
  }

  /** @deprecated Prefer shareToWhatsAppStatus / shareViaHdChatThenStatus */
  async shareToWhatsApp(fileUri: string, title: string): Promise<boolean> {
    if (!fileUri || fileUri.startsWith('file://embrace-hd/')) {
      throw new Error('Export produced no real media file');
    }

    try {
      return await shareToWhatsAppStatus(fileUri);
    } catch {
      return shareMedia({
        title,
        files: [fileUri],
        text: 'Created with Embrace HD',
        dialogTitle: 'Share to WhatsApp',
      });
    }
  }

  /**
   * Export selected media to WhatsApp-ready HD.
   * With backend enabled: converts on server and delivers via WhatsApp (no local file).
   * Offline / local mode: encodes on device and saves to gallery.
   */
  async generate(options: GenerateStatusOptions): Promise<{
    projectId: string;
    statusLengthSec: StatusLengthSec;
    title: string;
    deliveredVia: 'whatsapp' | 'file';
    outputUri?: string;
    galleryItem?: GalleryItem;
  }> {
    const statusLengthSec = options.statusLengthSec ?? appConfig.defaults.statusLengthSec;
    const canExportHd = options.canExportHd ?? true;

    if (!canExportHd) {
      throw new Error('HD export is locked — trial expired. Subscribe to continue.');
    }

    if (!options.source?.uri) {
      throw new Error('Select a video or image first');
    }

    const project = await this.createNewProject(
      options.source.name ?? `Status ${createId('clip')}`
    );
    project.durationSec = Math.min(
      options.source.kind === 'image' ? 5 : statusLengthSec,
      statusLengthSec
    );
    project.statusLengthSec = statusLengthSec;
    project.sources = [options.source];

    const job = await this.renderWhatsAppStatus(
      project,
      {
        statusLengthSec,
      },
      options.onProgress,
      options.signal,
      options.authToken,
      options.x264Preset
    );

    if (options.signal?.aborted) {
      throw new DOMException('Export cancelled', 'AbortError');
    }

    if (job.status === 'failed') {
      throw new Error(job.error ?? 'HD export failed');
    }

    if (job.deliveredVia === 'whatsapp') {
      return {
        projectId: project.id,
        statusLengthSec,
        title: project.title,
        deliveredVia: 'whatsapp',
      };
    }

    if (!job.outputUri || job.outputUri.startsWith('file://embrace-hd/')) {
      throw new Error('Could not create output video — try another file');
    }

    const galleryItem = await saveExportToGallery({
      sourceUri: job.outputUri,
      title: project.title,
      statusLengthSec,
    });

    return {
      projectId: project.id,
      outputUri: galleryItem.uri,
      statusLengthSec,
      title: project.title,
      galleryItem,
      deliveredVia: 'file',
    };
  }

  /**
   * Export selected media to WhatsApp-ready HD Status, then open share sheet.
   */
  async generateAndShare(options: GenerateStatusOptions): Promise<{
    projectId: string;
    outputUri?: string;
    shared: boolean;
    statusLengthSec: StatusLengthSec;
  }> {
    const exported = await this.generate(options);

    if (exported.deliveredVia === 'whatsapp' || !exported.outputUri) {
      return {
        projectId: exported.projectId,
        shared: true,
        statusLengthSec: exported.statusLengthSec,
      };
    }

    let shared = false;
    try {
      shared = await this.shareToWhatsApp(exported.outputUri, exported.title);
    } catch (err) {
      console.warn('[Share]', err);
      shared = false;
    }

    return {
      projectId: exported.projectId,
      outputUri: exported.outputUri,
      shared,
      statusLengthSec: exported.statusLengthSec,
    };
  }
}

export const videoGeneratorService = new VideoGeneratorService();
