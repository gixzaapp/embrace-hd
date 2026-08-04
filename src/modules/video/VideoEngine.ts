import {
  INPUT_REQUIREMENTS,
  appConfig,
  createId,
  resolveLocalPreset,
  suggestEncodeSettings,
  validateExportConstraints,
  type HdPresetChoice,
  type RenderJob,
  type VideoProject,
} from '../../core';
import { isBackendEnabled } from '../../services/apiClient';
import {
  exportViaBackend,
  type ConvertProgressUpdate,
} from '../../services/backendExport';
import { compressionEngine } from './CompressionEngine';
import type { EncodeOptions, VideoComposition } from './types';

/**
 * HD video composition / encode facade.
 * Prefer backend FFmpeg when enabled; otherwise on-device compression.
 */
export class VideoEngine {
  async createProject(
    title: string,
    preset: HdPresetChoice = appConfig.defaults.preset
  ): Promise<VideoProject> {
    const now = new Date().toISOString();
    return {
      id: createId('project'),
      title,
      preset,
      durationSec: 0,
      sources: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  async buildComposition(project: VideoProject): Promise<VideoComposition> {
    const fallbackDuration =
      project.durationSec || INPUT_REQUIREMENTS.imageDefaultDurationSec;

    return {
      project,
      timeline: project.sources.map((source, order) => ({
        id: createId('clip'),
        source,
        startSec: 0,
        endSec: fallbackDuration,
        order,
      })),
    };
  }

  async render(
    composition: VideoComposition,
    options?: Partial<EncodeOptions>,
    onProgress?: (update: ConvertProgressUpdate) => void
  ): Promise<RenderJob> {
    const jobId = createId('job');
    const preset = options?.preset ?? composition.project.preset;
    const durationSec =
      composition.project.durationSec || INPUT_REQUIREMENTS.imageDefaultDurationSec;
    const maxDurationSec =
      composition.project.statusLengthSec ?? appConfig.defaults.statusLengthSec;
    const suggested = suggestEncodeSettings(durationSec, preset, maxDurationSec);
    const encode: EncodeOptions = {
      ...suggested,
      ...options,
      preset,
    };

    const constraintErrors = validateExportConstraints({
      durationSec,
      preset: encode.preset,
      maxDurationSec,
    });
    if (constraintErrors.length > 0) {
      return {
        id: jobId,
        projectId: composition.project.id,
        status: 'failed',
        progress: 0,
        error: constraintErrors.join('; '),
      };
    }

    const source = composition.timeline[0]?.source ?? composition.project.sources[0];
    if (!source?.uri) {
      return {
        id: jobId,
        projectId: composition.project.id,
        status: 'failed',
        progress: 0,
        error: 'No media selected — pick a video or image first',
      };
    }

    if (source.kind === 'image') {
      return {
        id: jobId,
        projectId: composition.project.id,
        status: 'failed',
        progress: 0,
        error: 'Image-to-video is coming soon — please select a video for now',
      };
    }

    try {
      onProgress?.({ phase: 'upload', progress: 0 });

      if (isBackendEnabled()) {
        const authToken = options?.authToken;
        if (!authToken) {
          return {
            id: jobId,
            projectId: composition.project.id,
            status: 'failed',
            progress: 0,
            error: 'Sign in required for HD convert',
          };
        }
        const result = await exportViaBackend({
          sourceUri: source.uri,
          mimeType: source.mimeType,
          preset: encode.preset,
          statusLengthSec: maxDurationSec,
          delivery: 'status',
          x264Preset: encode.x264Preset,
          editRecipe: encode.editRecipe,
          authToken,
          onProgress,
          signal: options?.signal,
        });
        return {
          id: jobId,
          projectId: composition.project.id,
          status: 'ready',
          progress: 1,
          deliveredVia: 'whatsapp',
          outputUri: undefined,
          editsDropped: result.editsDropped,
        };
      }

      onProgress?.({ phase: 'convert', progress: 0 });
      const compressed = await compressionEngine.compress({
        sourcePath: source.uri,
        preset: resolveLocalPreset(encode.preset),
        maxDurationSec,
        onProgress: (info) => {
          if (typeof info.percent === 'number') {
            onProgress?.({
              phase: 'convert',
              progress: Math.min(1, Math.max(0, info.percent / 100)),
            });
          }
        },
      });

      onProgress?.({ phase: 'convert', progress: 1 });
      onProgress?.({ phase: 'send', progress: 1 });
      return {
        id: jobId,
        projectId: composition.project.id,
        status: 'ready',
        progress: 1,
        outputUri: compressed.destPath,
      };
    } catch (err) {
      return {
        id: jobId,
        projectId: composition.project.id,
        status: 'failed',
        progress: 0,
        error: err instanceof Error ? err.message : 'Compression failed',
      };
    }
  }
}

export const videoEngine = new VideoEngine();
