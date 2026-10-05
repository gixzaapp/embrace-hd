import { createId } from '../core';
import { ensureLocalMediaFile } from './localMediaPath';
import { saveExportToGallery, type GalleryItem } from './galleryLibrary';
import {
  getFfmpeg,
  persistVideoBytes,
  readFfmpegFileBytes,
  resolveVideoBytes,
} from '../modules/video/ffmpegLoader';

export type CropProgress = {
  status: string;
  percent?: number;
};

/** Percent of frame to cut from each edge (independent). */
export type CropInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export type CropEdgeOptions = {
  sourceUri: string;
  insets: CropInsets;
  title?: string;
  onProgress?: (progress: CropProgress) => void;
  signal?: AbortSignal;
};

export type CropEdgeResult = {
  outputUri: string;
  galleryItem: GalleryItem;
  insets: CropInsets;
};

const MAX_EDGE = 40;

export function clampCropInsets(raw: Partial<CropInsets>): CropInsets {
  const clamp = (n: number | undefined) =>
    Math.min(MAX_EDGE, Math.max(0, Math.round(n ?? 0)));
  let top = clamp(raw.top);
  let bottom = clamp(raw.bottom);
  let left = clamp(raw.left);
  let right = clamp(raw.right);

  // Keep at least 20% of the frame in each dimension.
  if (top + bottom > 80) {
    const scale = 80 / (top + bottom);
    top = Math.floor(top * scale);
    bottom = Math.floor(bottom * scale);
  }
  if (left + right > 80) {
    const scale = 80 / (left + right);
    left = Math.floor(left * scale);
    right = Math.floor(right * scale);
  }

  return { top, bottom, left, right };
}

export function hasCropInsets(insets: CropInsets): boolean {
  return (
    insets.top > 0 ||
    insets.bottom > 0 ||
    insets.left > 0 ||
    insets.right > 0
  );
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Crop cancelled', 'AbortError');
  }
}

/**
 * Crop watermarks with per-edge insets, then save to Crop list.
 * FFmpeg: crop=w:h:x:y with fractional iw/ih.
 */
export async function cropEdgeVideo(
  options: CropEdgeOptions
): Promise<CropEdgeResult> {
  const insets = clampCropInsets(options.insets);
  if (!hasCropInsets(insets)) {
    throw new Error('Set at least one edge to crop (Top, Bottom, Left, or Right)');
  }

  const t = insets.top / 100;
  const b = insets.bottom / 100;
  const l = insets.left / 100;
  const r = insets.right / 100;
  // Even sizes help some encoders; keep crop inside the frame.
  const filter =
    `crop=` +
    `floor(iw*(1-${l + r})/2)*2:` +
    `floor(ih*(1-${t + b})/2)*2:` +
    `floor(iw*${l}/2)*2:` +
    `floor(ih*${t}/2)*2`;

  options.onProgress?.({ status: 'started', percent: 0 });
  assertNotAborted(options.signal);

  const localUri = await ensureLocalMediaFile(options.sourceUri);
  assertNotAborted(options.signal);

  const ffmpeg = await getFfmpeg();
  assertNotAborted(options.signal);

  const inputName = `crop_in_${createId('v')}.mp4`;
  const outputName = `crop_out_${createId('v')}.mp4`;

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
    assertNotAborted(options.signal);
    await ffmpeg.writeFile(inputName, videoBytes);
    options.onProgress?.({ status: 'encoding', percent: 15 });

    const code = await ffmpeg.exec([
      '-i',
      inputName,
      '-vf',
      filter,
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

    assertNotAborted(options.signal);

    if (code !== 0) {
      throw new Error('Crop failed — try another video or a smaller inset');
    }

    const data = await ffmpeg.readFile(outputName);
    const bytes = readFfmpegFileBytes(data);
    const outputUri = await persistVideoBytes(bytes, 'embraceHD_crop');
    options.onProgress?.({ status: 'saving', percent: 92 });

    const galleryItem = await saveExportToGallery({
      sourceUri: outputUri,
      title: options.title?.trim() || 'Cropped video',
      statusLengthSec: 30,
    });

    options.onProgress?.({ status: 'done', percent: 100 });

    return {
      outputUri: galleryItem.uri,
      galleryItem,
      insets,
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
