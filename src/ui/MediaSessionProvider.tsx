import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { MediaSource } from '../core';
import {
  clearWorkingMedia,
  setWorkingMedia,
} from '../services/pendingCropMedia';
import {
  clearSessionEditRecipe,
  type EditRecipe,
  setSessionEditRecipe,
} from '../services/editRecipe';

type MediaSessionContextValue = {
  selectedMedia: MediaSource | null;
  videoDurationSec: number;
  /** True when a non-image video is selected (Edit tab enabled). */
  hasEditableVideo: boolean;
  setSelectedMedia: (media: MediaSource | null, durationSec?: number) => void;
  setVideoDurationSec: (sec: number) => void;
  clearSelectedMedia: () => void;
  setEditRecipe: (recipe: EditRecipe | null) => void;
};

const MediaSessionContext = createContext<MediaSessionContextValue | null>(null);

export const MediaSessionProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [selectedMedia, setSelectedMediaState] = useState<MediaSource | null>(
    null
  );
  const [videoDurationSec, setVideoDurationSec] = useState(0);
  const selectedUriRef = useRef<string | null>(null);

  const setSelectedMedia = useCallback(
    (media: MediaSource | null, durationSec = 0) => {
      const nextUri = media?.uri ?? null;
      const uriChanged = selectedUriRef.current !== nextUri;
      selectedUriRef.current = nextUri;

      setSelectedMediaState(media);
      setVideoDurationSec(durationSec);
      setWorkingMedia(media);

      if (!media) {
        clearSessionEditRecipe();
      } else if (
        uriChanged &&
        media.kind !== 'image' &&
        media.uri
      ) {
        // Only reset edits when the selected video actually changes.
        setSessionEditRecipe({ soundMode: 'keep' });
      }
    },
    []
  );

  const clearSelectedMedia = useCallback(() => {
    setSelectedMediaState(null);
    setVideoDurationSec(0);
    clearWorkingMedia();
    clearSessionEditRecipe();
  }, []);

  const setEditRecipe = useCallback((recipe: EditRecipe | null) => {
    setSessionEditRecipe(recipe);
  }, []);

  const value = useMemo<MediaSessionContextValue>(
    () => ({
      selectedMedia,
      videoDurationSec,
      hasEditableVideo: Boolean(
        selectedMedia?.uri && selectedMedia.kind !== 'image'
      ),
      setSelectedMedia,
      setVideoDurationSec,
      clearSelectedMedia,
      setEditRecipe,
    }),
    [
      selectedMedia,
      videoDurationSec,
      setSelectedMedia,
      clearSelectedMedia,
      setEditRecipe,
    ]
  );

  return (
    <MediaSessionContext.Provider value={value}>
      {children}
    </MediaSessionContext.Provider>
  );
};

export function useMediaSession(): MediaSessionContextValue {
  const ctx = useContext(MediaSessionContext);
  if (!ctx) {
    throw new Error('useMediaSession must be used within MediaSessionProvider');
  }
  return ctx;
}
