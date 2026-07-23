import { Capacitor } from '@capacitor/core';

/** Playable URI for <video> / canvas capture (WebView-safe). */
export function mediaDisplaySrc(uri: string): string {
  if (!uri) return '';
  if (uri.startsWith('blob:') || uri.startsWith('http://') || uri.startsWith('https://')) {
    return uri;
  }
  if (Capacitor.isNativePlatform()) {
    return Capacitor.convertFileSrc(uri);
  }
  return uri;
}

export async function probeVideoDurationSec(uri: string): Promise<number> {
  const src = mediaDisplaySrc(uri);
  if (!src) return 0;

  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');

    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
    };

    const finish = (sec: number) => {
      cleanup();
      resolve(Number.isFinite(sec) && sec > 0 ? sec : 0);
    };

    video.onloadedmetadata = () => finish(video.duration);
    video.onerror = () => finish(0);
    video.src = src;
  });
}

export type TimelineSegment = {
  index: number;
  /** Seek time for thumbnail frame */
  startSec: number;
  /** Segment length shown on the badge */
  lengthSec: number;
};

/**
 * Split a video into Status-length chunks.
 * 40s + 30s → [30s, 10s]; 40s + 60s → [40s]
 */
export function buildTimelineSegments(
  durationSec: number,
  chunkSec: number
): TimelineSegment[] {
  if (durationSec <= 0 || chunkSec <= 0) return [];

  const segments: TimelineSegment[] = [];
  let start = 0;
  let index = 0;

  while (start < durationSec - 0.05) {
    const lengthSec = Math.min(chunkSec, durationSec - start);
    segments.push({
      index,
      startSec: start,
      lengthSec: Math.round(lengthSec * 10) / 10,
    });
    start += chunkSec;
    index += 1;
  }

  return segments;
}

export function formatSegmentLabel(lengthSec: number): string {
  const rounded = Math.round(lengthSec);
  if (Math.abs(lengthSec - rounded) < 0.05) return `${rounded}s`;
  return `${lengthSec.toFixed(1)}s`;
}

const frameCache = new Map<string, string>();

/**
 * Seek a video and capture a JPEG data-URL frame (cached by uri+time).
 */
export async function captureVideoThumbnail(
  uri: string,
  timeSec = 0.35
): Promise<string | null> {
  const src = mediaDisplaySrc(uri);
  if (!src) return null;

  const cacheKey = `${src}@${timeSec.toFixed(2)}`;
  const cached = frameCache.get(cacheKey);
  if (cached) return cached;

  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.crossOrigin = 'anonymous';

    let settled = false;
    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      video.removeAttribute('src');
      video.load();
      if (value) frameCache.set(cacheKey, value);
      resolve(value);
    };

    const timer = window.setTimeout(() => done(null), 8000);

    video.onerror = () => {
      window.clearTimeout(timer);
      done(null);
    };

    video.onloadeddata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const target = Math.max(
        0,
        Math.min(timeSec, Math.max(0, duration - 0.05))
      );
      try {
        video.currentTime = target;
      } catch {
        window.clearTimeout(timer);
        done(null);
      }
    };

    video.onseeked = () => {
      window.clearTimeout(timer);
      try {
        const w = video.videoWidth || 720;
        const h = video.videoHeight || 1280;
        const maxW = 240;
        const scale = maxW / w;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          done(null);
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL('image/jpeg', 0.78));
      } catch {
        done(null);
      }
    };

    video.src = src;
  });
}
