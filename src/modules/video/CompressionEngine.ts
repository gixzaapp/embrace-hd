import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { VideoEditor } from '@whiteguru/capacitor-plugin-video-editor';
import { HD_PRESETS, QUALITY_REQUIREMENTS, createId, type HdPresetKey } from '../../core';
import { ensureLocalMediaFile } from '../../services/localMediaPath';

export type CompressorQuality = 'low' | 'medium' | 'high' | 'custom';

export type CompressionProgress = {
  status: string;
  percent?: number;
};

export type CompressionRequest = {
  sourcePath: string;
  destPath?: string;
  preset: HdPresetKey;
  /** Cap output length (WhatsApp 30s / 60s) */
  maxDurationSec?: number;
  onProgress?: (progress: CompressionProgress) => void;
};

export type CompressionResult = {
  success: boolean;
  destPath: string;
  quality: CompressorQuality;
  width: number;
  height: number;
  engine: 'native-litr' | 'ffmpeg';
};

/** Map HD presets → exact WhatsApp Status canvases. */
export function optionsForPreset(preset: HdPresetKey): {
  quality: CompressorQuality;
  width: number;
  height: number;
  bitrate?: number;
} {
  const dims = HD_PRESETS[preset];
  return {
    quality: 'custom',
    width: dims.width,
    height: dims.height,
    // ~2.2 Mbps — WhatsApp Status ceiling
    bitrate: 2_200_000,
  };
}

async function resolveVideoBytes(sourcePath: string): Promise<Uint8Array> {
  const src = Capacitor.isNativePlatform()
    ? Capacitor.convertFileSrc(sourcePath)
    : sourcePath;

  try {
    return await fetchFile(src);
  } catch {
    const path = sourcePath.replace(/^file:\/\//, '');
    const result = await Filesystem.readFile({ path });
    const data = result.data;
    if (typeof data === 'string') {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    if (data instanceof Blob) {
      return new Uint8Array(await data.arrayBuffer());
    }
    return new Uint8Array(data as unknown as ArrayBuffer);
  }
}

async function persistOutput(bytes: Uint8Array): Promise<string> {
  const filename = `embraceHD_cmp_${Date.now()}.mp4`;

  if (!Capacitor.isNativePlatform()) {
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'video/mp4' });
    return URL.createObjectURL(blob);
  }

  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }

  await Filesystem.mkdir({
    path: 'EmbraceHD',
    directory: Directory.Cache,
    recursive: true,
  }).catch(() => undefined);

  const written = await Filesystem.writeFile({
    path: `EmbraceHD/${filename}`,
    data: btoa(binary),
    directory: Directory.Cache,
  });

  return written.uri;
}

/**
 * Video compression:
 * - Native: @whiteguru/capacitor-plugin-video-editor (LiTr / MediaCodec)
 * - Web: FFmpeg.wasm fallback
 */
export class CompressionEngine {
  private ffmpeg: FFmpeg | null = null;
  private ffmpegLoading: Promise<void> | null = null;

  private async initFfmpeg(): Promise<FFmpeg> {
    if (this.ffmpeg?.loaded) return this.ffmpeg;
    if (this.ffmpegLoading) {
      await this.ffmpegLoading;
      return this.ffmpeg!;
    }

    this.ffmpegLoading = (async () => {
      const ffmpeg = new FFmpeg();
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      this.ffmpeg = ffmpeg;
    })();

    try {
      await this.ffmpegLoading;
    } finally {
      this.ffmpegLoading = null;
    }

    return this.ffmpeg!;
  }

  async compress(request: CompressionRequest): Promise<CompressionResult> {
    const dims = HD_PRESETS[request.preset];
    request.onProgress?.({ status: 'started', percent: 0 });

    if (Capacitor.isNativePlatform()) {
      const localInput = await ensureLocalMediaFile(request.sourcePath);
      const maxDurationSec = request.maxDurationSec;
      const trim =
        typeof maxDurationSec === 'number' && maxDurationSec > 0
          ? {
              startsAt: 0,
              endsAt: Math.round(maxDurationSec * 1000),
            }
          : undefined;

      const progressListener = await VideoEditor.addListener(
        'transcodeProgress',
        (info) => {
          request.onProgress?.({
            status: 'progress',
            percent: Math.round(Math.min(1, Math.max(0, info.progress)) * 100),
          });
        }
      );

      try {
        // 1) Remux/trim only — no re-encode (preserves camera quality)
        let remuxed: Awaited<ReturnType<typeof VideoEditor.edit>> | null = null;
        try {
          remuxed = await VideoEditor.edit({
            path: localInput,
            ...(trim ? { trim } : {}),
            transcode: {
              width: 0,
              height: 0,
              keepAspectRatio: true,
              fps: 30,
            },
          });
        } catch (remuxErr) {
          console.warn('[Compression] Remux failed; falling back to HD encode', remuxErr);
        }

        // Prefer remux/trim whenever it works — never re-encode just for size
        // (re-encode is the main source of visible quality loss)
        if (remuxed?.file.path) {
          request.onProgress?.({ status: 'progress', percent: 100 });
          return {
            success: true,
            destPath: remuxed.file.path,
            quality: 'high',
            width: dims.width,
            height: dims.height,
            engine: 'native-litr',
          };
        }

        // Fallback only if stream-copy remux is unsupported for this file
        request.onProgress?.({ status: 'progress', percent: 40 });
        const encoded = await VideoEditor.edit({
          path: localInput,
          ...(trim ? { trim } : {}),
          transcode: {
            width: dims.width,
            height: dims.height,
            keepAspectRatio: true,
            fps: 30,
          },
        });

        request.onProgress?.({ status: 'progress', percent: 100 });
        return {
          success: true,
          destPath: encoded.file.path,
          quality: 'custom',
          width: dims.width,
          height: dims.height,
          engine: 'native-litr',
        };
      } finally {
        await progressListener.remove();
      }
    }

    return this.compressWithFfmpeg(request, dims);
  }

  private async compressWithFfmpeg(
    request: CompressionRequest,
    dims: { width: number; height: number }
  ): Promise<CompressionResult> {
    const ffmpeg = await this.initFfmpeg();
    const inputName = `in_${createId('cmp')}.mp4`;
    const outputName = `out_${createId('cmp')}.mp4`;

    const progressHandler = ({ progress }: { progress: number }) => {
      request.onProgress?.({
        status: 'progress',
        percent: Math.round(Math.min(1, Math.max(0, progress)) * 100),
      });
    };
    ffmpeg.on('progress', progressHandler);

    try {
      const videoBytes = await resolveVideoBytes(request.sourcePath);
      await ffmpeg.writeFile(inputName, videoBytes);

      const scale = `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease,pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2`;
      // Prefer remux when possible; otherwise high-quality encode
      const remuxCode = await ffmpeg.exec([
        '-i',
        inputName,
        '-t',
        String(request.maxDurationSec ?? 60),
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        outputName,
      ]);

      let code = remuxCode;
      if (code !== 0) {
        code = await ffmpeg.exec([
          '-i',
          inputName,
          '-t',
          String(request.maxDurationSec ?? 60),
          '-vf',
          scale,
          '-c:v',
          'libx264',
          '-preset',
          'slow',
          '-crf',
          String(QUALITY_REQUIREMENTS.minCrfQuality),
          '-c:a',
          'aac',
          '-b:a',
          `${QUALITY_REQUIREMENTS.audioBitrateKbps}k`,
          '-movflags',
          '+faststart',
          outputName,
        ]);
      }

      if (code !== 0) {
        throw new Error('FFmpeg compression failed');
      }

      const data = await ffmpeg.readFile(outputName);
      const bytes =
        typeof data === 'string'
          ? new TextEncoder().encode(data)
          : new Uint8Array(data as Uint8Array);

      const destPath = request.destPath ?? (await persistOutput(bytes));
      request.onProgress?.({ status: 'progress', percent: 100 });

      return {
        success: true,
        destPath,
        quality: 'custom',
        width: dims.width,
        height: dims.height,
        engine: 'ffmpeg',
      };
    } finally {
      ffmpeg.off('progress', progressHandler);
      for (const name of [inputName, outputName]) {
        try {
          await ffmpeg.deleteFile(name);
        } catch {
          // ignore
        }
      }
    }
  }
}

export const compressionEngine = new CompressionEngine();

/** @deprecated use optionsForPreset */
export function qualityForPreset(preset: HdPresetKey): CompressorQuality {
  return optionsForPreset(preset).quality;
}
