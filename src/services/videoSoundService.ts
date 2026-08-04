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

export type SoundMode = 'keep' | 'mute' | 'file';

export type ApplySoundOptions = {
  sourceUri: string;
  mode: SoundMode;
  /** Required when mode === 'file' — local audio URI */
  musicFileUri?: string;
  /**
   * Start offset within the music source (seconds).
   * The clip taken from here is matched to the video length.
   */
  musicOffsetSec?: number;
  title?: string;
  onProgress?: (progress: CropProgress) => void;
  signal?: AbortSignal;
};

export type ApplySoundResult = {
  outputUri: string;
  galleryItem: GalleryItem;
  mode: SoundMode;
};

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Sound edit cancelled', 'AbortError');
  }
}

function musicInputExt(uri: string, mime?: string): string {
  const lower = `${uri} ${mime ?? ''}`.toLowerCase();
  if (lower.includes('.wav') || lower.includes('audio/wav') || lower.includes('audio/x-wav')) {
    return 'wav';
  }
  if (lower.includes('.m4a') || lower.includes('audio/mp4') || lower.includes('audio/aac')) {
    return 'm4a';
  }
  if (lower.includes('.ogg') || lower.includes('audio/ogg')) return 'ogg';
  if (lower.includes('.aac')) return 'aac';
  return 'mp3';
}

async function mixMusicOntoVideo(
  ffmpeg: Awaited<ReturnType<typeof getFfmpeg>>,
  inputName: string,
  musicName: string,
  outputName: string,
  musicOffsetSec: number
): Promise<number> {
  const offset = Math.max(0, musicOffsetSec || 0);
  let code = await ffmpeg.exec([
    '-i',
    inputName,
    '-stream_loop',
    '-1',
    '-ss',
    offset.toFixed(3),
    '-i',
    musicName,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-shortest',
    '-movflags',
    '+faststart',
    outputName,
  ]);
  if (code !== 0) {
    try {
      await ffmpeg.deleteFile(outputName);
    } catch {
      /* ignore */
    }
    code = await ffmpeg.exec([
      '-i',
      inputName,
      '-stream_loop',
      '-1',
      '-ss',
      offset.toFixed(3),
      '-i',
      musicName,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-shortest',
      '-movflags',
      '+faststart',
      outputName,
    ]);
  }
  return code;
}

/**
 * Mute original audio, or replace it with a music file.
 * Music length is matched to the (already trimmed) video via -shortest.
 */
export async function applyVideoSound(
  options: ApplySoundOptions
): Promise<ApplySoundResult> {
  options.onProgress?.({ status: 'started', percent: 0 });
  assertNotAborted(options.signal);

  const localUri = await ensureLocalMediaFile(options.sourceUri);
  assertNotAborted(options.signal);

  if (options.mode === 'keep') {
    throw new Error('No sound change requested');
  }
  if (options.mode === 'file' && !options.musicFileUri) {
    throw new Error('Pick a music file first');
  }

  const ffmpeg = await getFfmpeg();
  assertNotAborted(options.signal);

  const inputName = `snd_in_${createId('v')}.mp4`;
  const musicExt =
    options.mode === 'file' ? musicInputExt(options.musicFileUri!) : 'wav';
  const musicName = `snd_m_${createId('v')}.${musicExt}`;
  const outputName = `snd_out_${createId('v')}.mp4`;
  const musicOffset = Math.max(0, options.musicOffsetSec ?? 0);

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

    let code: number;
    if (options.mode === 'mute') {
      options.onProgress?.({ status: 'muting', percent: 20 });
      code = await ffmpeg.exec([
        '-i',
        inputName,
        '-map',
        '0:v:0',
        '-c:v',
        'copy',
        '-an',
        '-movflags',
        '+faststart',
        outputName,
      ]);
      if (code !== 0) {
        try {
          await ffmpeg.deleteFile(outputName);
        } catch {
          /* ignore */
        }
        code = await ffmpeg.exec([
          '-i',
          inputName,
          '-map',
          '0:v:0',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '18',
          '-an',
          '-movflags',
          '+faststart',
          outputName,
        ]);
      }
      if (code !== 0) {
        try {
          await ffmpeg.deleteFile(outputName);
        } catch {
          /* ignore */
        }
        code = await ffmpeg.exec([
          '-i',
          inputName,
          '-map',
          '0:v:0?',
          '-map',
          '0:a:0?',
          '-c:v',
          'copy',
          '-af',
          'volume=0',
          '-c:a',
          'aac',
          '-b:a',
          '64k',
          '-movflags',
          '+faststart',
          outputName,
        ]);
      }
      if (code !== 0) {
        try {
          await ffmpeg.deleteFile(outputName);
        } catch {
          /* ignore */
        }
        code = await ffmpeg.exec([
          '-i',
          inputName,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '18',
          '-af',
          'volume=0',
          '-c:a',
          'aac',
          '-b:a',
          '64k',
          '-movflags',
          '+faststart',
          outputName,
        ]);
      }
    } else {
      options.onProgress?.({ status: 'mixing', percent: 15 });
      const musicBytes = await resolveVideoBytes(
        await ensureLocalMediaFile(options.musicFileUri!)
      );
      await ffmpeg.writeFile(musicName, musicBytes);
      code = await mixMusicOntoVideo(
        ffmpeg,
        inputName,
        musicName,
        outputName,
        musicOffset
      );
    }

    assertNotAborted(options.signal);
    if (code !== 0) {
      throw new Error(
        options.mode === 'mute'
          ? 'Could not mute this video'
          : 'Could not add music to this video'
      );
    }

    const data = await ffmpeg.readFile(outputName);
    const outputUri = await persistVideoBytes(
      readFfmpegFileBytes(data),
      options.mode === 'mute' ? 'embraceHD_mute' : 'embraceHD_music'
    );
    options.onProgress?.({ status: 'saving', percent: 92 });

    const title =
      options.title?.trim() ||
      (options.mode === 'mute' ? 'Muted video' : 'Music from file');

    const galleryItem = await saveExportToGallery({
      sourceUri: outputUri,
      title,
      statusLengthSec: 30,
    });

    options.onProgress?.({ status: 'done', percent: 100 });
    return {
      outputUri: galleryItem.uri,
      galleryItem,
      mode: options.mode,
    };
  } finally {
    ffmpeg.off('progress', progressHandler);
    for (const name of [inputName, musicName, outputName]) {
      try {
        await ffmpeg.deleteFile(name);
      } catch {
        // ignore
      }
    }
  }
}
