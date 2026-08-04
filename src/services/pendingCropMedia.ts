import type { MediaSource } from '../core';

const WORKING_KEY = 'embrace_hd_working_media';

export type StoredMedia = {
  uri: string;
  name?: string;
  mimeType?: string;
  kind?: 'video' | 'image';
};

export type WorkingMedia = MediaSource;

function toWorkingMedia(parsed: StoredMedia, fallbackName: string): WorkingMedia | null {
  if (!parsed?.uri) return null;
  return {
    uri: parsed.uri,
    name: parsed.name ?? fallbackName,
    mimeType: parsed.mimeType ?? 'video/mp4',
    kind: parsed.kind === 'image' ? 'image' : 'video',
  };
}

function write(key: string, media: StoredMedia | null): void {
  try {
    if (!media) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(media));
  } catch {
    // ignore quota / private mode
  }
}

function read(key: string): StoredMedia | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as StoredMedia;
  } catch {
    return null;
  }
}

/** Persist Home selection for Library → Home restore and process death. */
export function setWorkingMedia(media: MediaSource | null): void {
  if (!media?.uri) {
    write(WORKING_KEY, null);
    return;
  }
  write(WORKING_KEY, {
    uri: media.uri,
    name: media.name,
    mimeType: media.mimeType,
    kind: media.kind === 'image' ? 'image' : 'video',
  });
}

/** Read current Home selection (does not clear). */
export function getWorkingMedia(): WorkingMedia | null {
  const parsed = read(WORKING_KEY);
  if (!parsed?.uri) return null;
  return toWorkingMedia(parsed, 'Selected video');
}

export function clearWorkingMedia(): void {
  write(WORKING_KEY, null);
  try {
    localStorage.removeItem('embrace_hd_pending_crop_media');
  } catch {
    // ignore
  }
}
