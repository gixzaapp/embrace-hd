import { Capacitor } from '@capacitor/core';
import { VideoEditor } from '@whiteguru/capacitor-plugin-video-editor';
import { createId } from '../core';
import { ensureLocalMediaFile } from './localMediaPath';
import { saveExportToGallery, type GalleryItem } from './galleryLibrary';
import {
  getFfmpeg,
  persistVideoBytes,
  readFfmpegFileBytes,
  resolveVideoBytes,
} from '../modules/video/ffmpegLoader';
import type { CropProgress } from './videoCropService';

export type TrimVideoOptions = {
  sourceUri: string;
  /** Inclusive start (seconds). */
  startSec: number;
  /** Exclusive end (seconds). */
  endSec: number;
  title?: string;
  onProgress?: (progress: CropProgress) => void;
  signal?: AbortSignal;
};

export type TrimVideoResult = {
  outputUri: string;
  galleryItem: GalleryItem;
  startSec: number;
  endSec: number;
};

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Trim cancelled', 'AbortError');
  }
}

function normalizeRange(startSec: number, endSec: number): {
  startSec: number;
  endSec: number;
} {
  const start = Math.max(0, startSec);
  const end = Math.max(start + 0.5, endSec);
  return {
    startSec: Math.round(start * 10) / 10,
    endSec: Math.round(end * 10) / 10,
  };
}

export function formatTrimTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/**
 * Cut a time range from the video.
 * Native: VideoEditor remux/trim (fast). Web: FFmpeg.wasm.
 */
export async function trimVideo(
  options: TrimVideoOptions
): Promise<TrimVideoResult> {
  const { startSec, endSec } = normalizeRange(options.startSec, options.endSec);
  if (endSec - startSec < 0.5) {
    throw new Error('Trim range must be at least 0.5 seconds');
  }

  options.onProgress?.({ status: 'started', percent: 0 });
  assertNotAborted(options.signal);

  const localUri = await ensureLocalMediaFile(options.sourceUri);
  assertNotAborted(options.signal);

  let outputUri: string;

  if (Capacitor.isNativePlatform()) {
    options.onProgress?.({ status: 'trimming', percent: 20 });
    const progressListener = await VideoEditor.addListener(
      'transcodeProgress',
      (info) => {
        options.onProgress?.({
          status: 'progress',
          percent: Math.round(Math.min(1, Math.max(0, info.progress)) * 100),
        });
      }
    );
    try {
      const edited = await VideoEditor.edit({
        path: localUri,
        trim: {
          startsAt: Math.round(startSec * 1000),
          endsAt: Math.round(endSec * 1000),
        },
        transcode: {
          width: 0,
          height: 0,
          keepAspectRatio: true,
          fps: 30,
        },
      });
      if (!edited?.file?.path) {
        throw new Error('Trim failed — try another range');
      }
      outputUri = edited.file.path;
    } finally {
      await progressListener.remove();
    }
  } else {
    const ffmpeg = await getFfmpeg();
    assertNotAborted(options.signal);
    const inputName = `trim_in_${createId('v')}.mp4`;
    const outputName = `trim_out_${createId('v')}.mp4`;
    const progressHandler = ({ progress }: { progress: number }) => {
      options.onProgress?.({
        status: 'progress',
        percent: Math.round(Math.min(1, Math.max(0, progress)) * 100),
      });
    };
    ffmpeg.on('progress', progressHandler);
    try {
      options.onProgress?.({ status: 'loading', percent: 5 });
      const videoBytes = await resolveVideoBytes(localUri);
      await ffmpeg.writeFile(inputName, videoBytes);
      options.onProgress?.({ status: 'trimming', percent: 15 });

      // Prefer stream copy for speed; fall back to re-encode if needed.
      let code = await ffmpeg.exec([
        '-ss',
        String(startSec),
        '-to',
        String(endSec),
        '-i',
        inputName,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        outputName,
      ]);

      if (code !== 0) {
        code = await ffmpeg.exec([
          '-ss',
          String(startSec),
          '-to',
          String(endSec),
          '-i',
          inputName,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '18',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-movflags',
          '+faststart',
          outputName,
        ]);
      }

      if (code !== 0) {
        throw new Error('Trim failed — try another range');
      }

      const data = await ffmpeg.readFile(outputName);
      outputUri = await persistVideoBytes(
        readFfmpegFileBytes(data),
        'embraceHD_trim'
      );
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

  assertNotAborted(options.signal);
  options.onProgress?.({ status: 'saving', percent: 92 });

  const lengthSec = Math.max(1, Math.round(endSec - startSec));
  const galleryItem = await saveExportToGallery({
    sourceUri: outputUri,
    title: options.title?.trim() || 'Trimmed video',
    statusLengthSec: lengthSec <= 30 ? 30 : 60,
  });

  options.onProgress?.({ status: 'done', percent: 100 });

  return {
    outputUri: galleryItem.uri,
    galleryItem,
    startSec,
    endSec,
  };
}
