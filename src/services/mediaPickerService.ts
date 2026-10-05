import { Capacitor } from '@capacitor/core';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { inferInputKind, isAcceptedMimeType, type MediaSource } from '../core';
import { ensureLocalMediaFile } from './localMediaPath';

/**
 * Opens the gallery picker for a video or image.
 * Copies content:// URIs into app cache so native compressors can open them.
 */
export async function pickStatusMedia(): Promise<MediaSource> {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    try {
      await FilePicker.requestPermissions({ permissions: ['readExternalStorage'] });
    } catch {
      // System photo picker may not need this
    }
  }

  const result = await FilePicker.pickMedia({
    limit: 1,
  });

  const file = result.files[0];
  if (!file) {
    throw new Error('No media selected');
  }

  const path = file.path;
  if (!path) {
    throw new Error('Could not access the selected file path');
  }

  const mimeType = file.mimeType || undefined;
  if (
    mimeType &&
    !isAcceptedMimeType(mimeType) &&
    !mimeType.startsWith('video/') &&
    !mimeType.startsWith('image/')
  ) {
    throw new Error('Please select a video or image');
  }

  const kind =
    inferInputKind(mimeType) ?? (mimeType?.startsWith('image/') ? 'image' : 'video');

  const rawUri =
    path.startsWith('file:') || path.startsWith('content:') ? path : `file://${path}`;

  // MediaCodec needs a real file — resolve Android photo-picker content:// URIs
  const localUri = await ensureLocalMediaFile(rawUri, mimeType);

  return {
    uri: localUri,
    mimeType,
    name: file.name,
    kind: kind ?? 'video',
  };
}

export type PickedAudioFile = {
  uri: string;
  name: string;
  mimeType?: string;
  durationSec: number;
};

/**
 * Pick an audio file from the device for Edit → Sound.
 */
export async function pickAudioFile(): Promise<PickedAudioFile> {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    try {
      await FilePicker.requestPermissions({ permissions: ['readExternalStorage'] });
    } catch {
      // may not be required
    }
  }

  const result = await FilePicker.pickFiles({
    types: [
      'audio/*',
      'audio/mpeg',
      'audio/mp4',
      'audio/wav',
      'audio/x-wav',
      'audio/aac',
      'audio/ogg',
      'audio/flac',
    ],
  });

  const file = result.files[0];
  if (!file) {
    throw new Error('No audio selected');
  }

  const path = file.path;
  if (!path && !file.blob) {
    throw new Error('Could not access the selected audio file');
  }

  const mimeType = file.mimeType || undefined;
  if (mimeType && !mimeType.startsWith('audio/') && mimeType !== 'application/ogg') {
    throw new Error('Please select an audio file');
  }

  let localUri: string;
  if (path) {
    const rawUri =
      path.startsWith('file:') || path.startsWith('content:')
        ? path
        : `file://${path}`;
    localUri = await ensureLocalMediaFile(rawUri, mimeType);
  } else if (file.blob) {
    localUri = URL.createObjectURL(file.blob);
  } else {
    throw new Error('Could not access the selected audio file');
  }

  const { probeAudioDurationSec } = await import('./videoDuration');
  const durationSec = await probeAudioDurationSec(localUri);

  return {
    uri: localUri,
    name: file.name || 'Selected music',
    mimeType,
    durationSec: Math.max(0.5, durationSec || 0.5),
  };
}
