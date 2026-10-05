import type { MediaSource } from '../core';

const LEGACY_WORKING_KEY = 'embrace_hd_working_media';

export type WorkingMedia = MediaSource;

/** In-session only — never restored after app restart. */
let sessionWorkingMedia: WorkingMedia | null = null;

function clearLegacyWorkingMediaStorage(): void {
  try {
    localStorage.removeItem(LEGACY_WORKING_KEY);
    localStorage.removeItem('embrace_hd_pending_crop_media');
  } catch {
    // ignore quota / private mode
  }
}

/** Remember Home selection for Library → Home handoff within the same session. */
export function setWorkingMedia(media: MediaSource | null): void {
  if (!media?.uri) {
    sessionWorkingMedia = null;
    return;
  }
  sessionWorkingMedia = {
    uri: media.uri,
    name: media.name,
    mimeType: media.mimeType,
    kind: media.kind === 'image' ? 'image' : 'video',
  };
}

/** Read current in-session Home selection (does not clear). */
export function getWorkingMedia(): WorkingMedia | null {
  return sessionWorkingMedia;
}

/** Drop working selection and scrub any legacy persisted keys. */
export function clearWorkingMedia(): void {
  sessionWorkingMedia = null;
  clearLegacyWorkingMediaStorage();
}

/** Call on cold app start so Home never restores a previous video. */
export function resetWorkingMediaForAppLaunch(): void {
  clearWorkingMedia();
}
