import { useEffect, useMemo, useState } from 'react';
import type { StatusLengthSec } from '../core';
import {
  buildTimelineSegments,
  formatSegmentLabel,
  mediaDisplaySrc,
  type TimelineSegment,
} from '../services/videoDuration';
import './VideoTimelineThumbnails.css';

type VideoTimelineThumbnailsProps = {
  uri: string | null;
  durationSec: number;
  chunkSec: StatusLengthSec;
};

async function captureFrameAt(
  src: string,
  timeSec: number
): Promise<string | null> {
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
      resolve(value);
    };

    const timer = window.setTimeout(() => done(null), 8000);

    video.onerror = () => {
      window.clearTimeout(timer);
      done(null);
    };

    video.onloadeddata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const target = Math.max(0, Math.min(timeSec, Math.max(0, duration - 0.05)));
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
        const maxW = 180;
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
        done(canvas.toDataURL('image/jpeg', 0.72));
      } catch {
        done(null);
      }
    };

    video.src = src;
  });
}

export const VideoTimelineThumbnails: React.FC<VideoTimelineThumbnailsProps> = ({
  uri,
  durationSec,
  chunkSec,
}) => {
  const segments = useMemo(
    () => buildTimelineSegments(durationSec, chunkSec),
    [durationSec, chunkSec]
  );

  const [thumbs, setThumbs] = useState<Record<number, string | null>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!uri || segments.length === 0) {
      setThumbs({});
      return;
    }

    let cancelled = false;
    const src = mediaDisplaySrc(uri);

    const run = async () => {
      setLoading(true);
      const next: Record<number, string | null> = {};

      // Capture sequentially — one video seek at a time is more reliable on WebView.
      for (const seg of segments) {
        if (cancelled) return;
        // Prefer a frame a bit into the clip so blacks/fades are avoided.
        const frameAt = seg.startSec + Math.min(0.35, seg.lengthSec * 0.15);
        next[seg.index] = await captureFrameAt(src, frameAt);
      }

      if (!cancelled) {
        setThumbs(next);
        setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [uri, segments]);

  if (!uri || durationSec <= 0 || segments.length === 0) {
    return null;
  }

  return (
    <section className="video-timeline" aria-label="Status timeline preview">
      <div className="video-timeline-header">
        <h3 className="video-timeline-title">Timeline</h3>
        <span className="font-label-sm video-timeline-meta">
          {Math.round(durationSec)}s · {segments.length} part
          {segments.length === 1 ? '' : 's'} · {chunkSec}s status
        </span>
      </div>

      <div className="video-timeline-scroll hide-scrollbar">
        {segments.map((seg: TimelineSegment) => (
          <article key={`${chunkSec}-${seg.index}-${seg.startSec}`} className="video-timeline-card">
            <div className="video-timeline-thumb glass-card">
              {thumbs[seg.index] ? (
                <img
                  className="video-timeline-img"
                  src={thumbs[seg.index]!}
                  alt={`Part ${seg.index + 1}`}
                />
              ) : (
                <div className="video-timeline-placeholder">
                  <span className="material-symbols-outlined" aria-hidden>
                    {loading ? 'progress_activity' : 'movie'}
                  </span>
                </div>
              )}
              <span className="video-timeline-badge font-label-sm">
                {formatSegmentLabel(seg.lengthSec)}
              </span>
            </div>
            <p className="video-timeline-label">
              Part {seg.index + 1}
              <span className="video-timeline-range">
                {Math.round(seg.startSec)}–
                {Math.round(seg.startSec + seg.lengthSec)}s
              </span>
            </p>
          </article>
        ))}
      </div>
    </section>
  );
};
