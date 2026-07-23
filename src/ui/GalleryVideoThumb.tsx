import { useEffect, useState } from 'react';
import { captureVideoThumbnail } from '../services/videoDuration';
import './GalleryVideoThumb.css';

type GalleryVideoThumbProps = {
  uri: string;
  alt?: string;
};

export const GalleryVideoThumb: React.FC<GalleryVideoThumbProps> = ({
  uri,
  alt = 'Video thumbnail',
}) => {
  const [thumb, setThumb] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setThumb(null);

    void captureVideoThumbnail(uri, 0.4).then((dataUrl) => {
      if (cancelled) return;
      setThumb(dataUrl);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [uri]);

  return (
    <div className="gallery-video-thumb">
      {thumb ? (
        <img className="gallery-video-thumb-img" src={thumb} alt={alt} />
      ) : (
        <div className="gallery-video-thumb-fallback" aria-hidden>
          <span className="material-symbols-outlined">
            {loading ? 'progress_activity' : 'movie'}
          </span>
        </div>
      )}
    </div>
  );
};
