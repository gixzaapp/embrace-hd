import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Capacitor } from '@capacitor/core';
import {
  IonAccordion,
  IonAccordionGroup,
  IonIcon,
  IonItem,
  IonLabel,
  IonRange,
} from '@ionic/react';
import { pauseOutline, playOutline } from 'ionicons/icons';
import type { MediaSource } from '../core';
import {
  formatTrimTime,
  hasCropInsets,
  mediaDisplaySrc,
  pickAudioFile,
  probeVideoDurationSec,
  type CropInsets,
  type EditRecipe,
  type SoundMode,
} from '../services';
import '../pages/Gallery.css';

function previewSrc(uri: string): string {
  if (!uri) return '';
  if (uri.startsWith('blob:') || uri.startsWith('http')) return uri;
  return Capacitor.isNativePlatform() ? Capacitor.convertFileSrc(uri) : uri;
}

const DEFAULT_INSETS: CropInsets = {
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
};

const EDGE_FIELDS: { key: keyof CropInsets; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
];

export type EditWorkspaceHandle = {
  /** Build the current EditRecipe for Convert (null if music file required but missing). */
  getRecipe: () => EditRecipe | null;
  pausePreview: () => void;
};

type Props = {
  source: MediaSource;
  disabled?: boolean;
  onChangeSource?: () => void;
  onToast?: (message: string) => void;
};

export const EditWorkspace = forwardRef<EditWorkspaceHandle, Props>(
  function EditWorkspace({ source, disabled, onChangeSource, onToast }, ref) {
    const previewVideoRef = useRef<HTMLVideoElement | null>(null);
    const musicPreviewRef = useRef<HTMLAudioElement | null>(null);

    const [insets, setInsets] = useState<CropInsets>(DEFAULT_INSETS);
    const [durationSec, setDurationSec] = useState(0);
    const [trimRange, setTrimRange] = useState<{ lower: number; upper: number }>({
      lower: 0,
      upper: 30,
    });
    const trimRangeRef = useRef(trimRange);
    trimRangeRef.current = trimRange;
    const [openAccordion, setOpenAccordion] = useState<string | undefined>('crop');
    const [soundMode, setSoundMode] = useState<SoundMode>('keep');
    const [customMusic, setCustomMusic] = useState<{
      uri: string;
      name: string;
      durationSec: number;
    } | null>(null);
    const [musicOffsetSec, setMusicOffsetSec] = useState(0);
    const [previewPlaying, setPreviewPlaying] = useState(true);
    const fileMusicWindowRef = useRef({ start: 0, window: 0.5 });
    const soundModeRef = useRef(soundMode);
    soundModeRef.current = soundMode;
    const customMusicRef = useRef(customMusic);
    customMusicRef.current = customMusic;
    const musicOffsetRef = useRef(musicOffsetSec);
    musicOffsetRef.current = musicOffsetSec;

    const muteOriginalInPreview =
      soundMode === 'mute' || soundMode === 'file';

    const videoSrc = useMemo(
      () => (source.uri ? previewSrc(source.uri) : ''),
      [source.uri]
    );

    const trimDurationSec = Math.max(
      0.5,
      Number(trimRange.upper) - Number(trimRange.lower)
    );

    fileMusicWindowRef.current = {
      start: Math.max(0, musicOffsetSec),
      window: Math.max(0.5, trimDurationSec),
    };

    const maxMusicOffset = useMemo(() => {
      if (!customMusic) return 0;
      const audioDur = Math.max(0.5, customMusic.durationSec);
      if (audioDur <= trimDurationSec + 0.05) {
        return Math.max(0, audioDur - 0.05);
      }
      return Math.max(0, audioDur - trimDurationSec);
    }, [customMusic, trimDurationSec]);

    const seekPreviewToTrimStart = useCallback(() => {
      const el = previewVideoRef.current;
      if (!el) return;
      const start = Math.max(0, Number(trimRangeRef.current.lower) || 0);
      try {
        el.currentTime = start;
      } catch {
        /* seek may fail before metadata */
      }
    }, []);

    const prevTrimRef = useRef(trimRange);
    const prevVideoSrcRef = useRef(videoSrc);

    const stopMusicPreview = useCallback(() => {
      const audio = musicPreviewRef.current;
      if (!audio) return;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      musicPreviewRef.current = null;
    }, []);

    const ensureBedMusic = useCallback((): HTMLAudioElement | null => {
      const music = customMusicRef.current;
      if (!music?.uri) return null;
      const src = mediaDisplaySrc(music.uri);
      if (!src) return null;
      let audio = musicPreviewRef.current;
      const same =
        audio &&
        (audio.getAttribute('data-music-uri') === music.uri || audio.src === src);
      if (!audio || !same) {
        if (audio) {
          audio.pause();
          musicPreviewRef.current = null;
        }
        audio = new Audio(src);
        audio.setAttribute('data-music-uri', music.uri);
        audio.loop = true;
        musicPreviewRef.current = audio;
      }
      return audio;
    }, []);

    const syncBedMusicToVideo = useCallback(
      (forceSeek = false) => {
        if (soundModeRef.current !== 'file') return;
        const video = previewVideoRef.current;
        const audio = musicPreviewRef.current ?? ensureBedMusic();
        if (!video || !audio) return;
        const trimStart = Math.max(0, Number(trimRangeRef.current.lower) || 0);
        const trimEnd = Math.max(
          trimStart + 0.15,
          Number(trimRangeRef.current.upper) || trimStart + 0.15
        );
        const windowSec = Math.max(0.5, trimEnd - trimStart);
        const offset = Math.max(0, musicOffsetRef.current);
        fileMusicWindowRef.current = { start: offset, window: windowSec };
        const progress = Math.max(0, video.currentTime - trimStart);
        const target = offset + Math.min(progress, windowSec - 0.05);
        if (forceSeek || Math.abs(audio.currentTime - target) > 0.3) {
          try {
            audio.currentTime = target;
          } catch {
            /* ignore */
          }
        }
      },
      [ensureBedMusic]
    );

    const startBedMusicWithVideo = useCallback(async () => {
      if (soundModeRef.current !== 'file') return;
      const audio = ensureBedMusic();
      if (!audio) return;
      syncBedMusicToVideo(true);
      try {
        await audio.play();
      } catch (err) {
        console.warn('[Edit] bed music play failed', err);
      }
    }, [ensureBedMusic, syncBedMusicToVideo]);

    const onPreviewTimeUpdate = () => {
      const el = previewVideoRef.current;
      if (!el || el.seeking) return;
      const { lower, upper } = trimRangeRef.current;
      const start = Math.max(0, Number(lower) || 0);
      const end = Math.max(start + 0.15, Number(upper) || start + 0.15);
      let looped = false;
      if (el.currentTime < start - 0.02) {
        el.currentTime = start;
        looped = true;
      } else if (el.currentTime >= end - 0.04) {
        el.currentTime = start;
        looped = true;
      }
      syncBedMusicToVideo(looped);
    };

    useEffect(() => {
      const el = previewVideoRef.current;
      if (!el) return;
      el.muted = muteOriginalInPreview;
      if (soundMode === 'keep' || soundMode === 'mute') {
        stopMusicPreview();
      } else if (soundMode === 'file' && customMusic?.uri && !el.paused) {
        void startBedMusicWithVideo();
      }
    }, [
      soundMode,
      videoSrc,
      muteOriginalInPreview,
      customMusic?.uri,
      stopMusicPreview,
      startBedMusicWithVideo,
    ]);

    useEffect(() => {
      setPreviewPlaying(true);
    }, [videoSrc]);

    // Reset controls when the source video changes
    useEffect(() => {
      stopMusicPreview();
      setInsets(DEFAULT_INSETS);
      setCustomMusic(null);
      setMusicOffsetSec(0);
      setSoundMode('keep');
      setOpenAccordion('crop');
      setDurationSec(0);
      setTrimRange({ lower: 0, upper: 30 });
      if (!source.uri) return;
      void probeVideoDurationSec(source.uri).then((sec) => {
        const d = Math.max(1, sec || 30);
        setDurationSec(d);
        setTrimRange({ lower: 0, upper: Math.min(d, Math.max(1, d)) });
      });
    }, [source.uri, stopMusicPreview]);

    useEffect(() => {
      const el = previewVideoRef.current;
      if (!el) return;
      const srcChanged = prevVideoSrcRef.current !== videoSrc;
      prevVideoSrcRef.current = videoSrc;
      const prev = prevTrimRef.current;
      const { lower, upper } = trimRange;
      prevTrimRef.current = trimRange;
      const start = Math.max(0, Number(lower) || 0);
      const end = Math.max(start + 0.15, Number(upper) || start + 0.15);
      try {
        if (srcChanged) {
          el.currentTime = start;
        } else if (Math.abs(lower - prev.lower) >= 0.001) {
          el.currentTime = start;
        } else if (Math.abs(upper - prev.upper) >= 0.001) {
          el.currentTime = Math.max(start, end - 0.35);
        }
        if (soundModeRef.current === 'file') {
          syncBedMusicToVideo(true);
        }
      } catch {
        /* ignore */
      }
    }, [trimRange, videoSrc, syncBedMusicToVideo]);

    useEffect(() => {
      if (openAccordion === 'trim') {
        seekPreviewToTrimStart();
      }
    }, [openAccordion, seekPreviewToTrimStart]);

    useEffect(() => {
      setMusicOffsetSec((prev) => {
        const next = Math.min(Math.max(0, prev), maxMusicOffset);
        return Math.abs(next - prev) < 0.001 ? prev : next;
      });
    }, [maxMusicOffset]);

    useEffect(() => {
      if (soundMode !== 'file') return;
      syncBedMusicToVideo(true);
    }, [musicOffsetSec, soundMode, syncBedMusicToVideo]);

    useEffect(() => {
      return () => {
        stopMusicPreview();
      };
    }, [stopMusicPreview]);

    const togglePreviewPlayback = () => {
      const el = previewVideoRef.current;
      if (!el || disabled) return;
      const mode = soundModeRef.current;

      if (el.paused) {
        el.muted = mode === 'mute' || mode === 'file';
        const { lower, upper } = trimRangeRef.current;
        const start = Math.max(0, Number(lower) || 0);
        const end = Math.max(start + 0.15, Number(upper) || start + 0.15);
        if (el.currentTime < start || el.currentTime >= end - 0.05) {
          el.currentTime = start;
        }
        void el
          .play()
          .then(async () => {
            setPreviewPlaying(true);
            if (mode === 'file') {
              await startBedMusicWithVideo();
            } else {
              stopMusicPreview();
            }
          })
          .catch(() => {
            setPreviewPlaying(false);
          });
      } else {
        el.pause();
        musicPreviewRef.current?.pause();
        setPreviewPlaying(false);
      }
    };

    const previewStyle = {
      ['--crop-top' as string]: `${insets.top}%`,
      ['--crop-bottom' as string]: `${insets.bottom}%`,
      ['--crop-left' as string]: `${insets.left}%`,
      ['--crop-right' as string]: `${insets.right}%`,
    };

    const playFileMusicPreview = useCallback(
      (uri: string, offsetSec: number) => {
        const video = previewVideoRef.current;
        if (video && !video.paused) {
          video.pause();
          setPreviewPlaying(false);
        }
        stopMusicPreview();
        const src = mediaDisplaySrc(uri);
        if (!src) return;
        const start = Math.max(0, offsetSec);
        fileMusicWindowRef.current = {
          start,
          window: Math.max(
            0.5,
            trimRangeRef.current.upper - trimRangeRef.current.lower
          ),
        };
        const audio = new Audio(src);
        audio.setAttribute('data-music-uri', uri);
        musicPreviewRef.current = audio;

        const constrain = () => {
          if (audio.seeking) return;
          const { start: s, window: w } = fileMusicWindowRef.current;
          if (audio.currentTime < s - 0.02) {
            audio.currentTime = s;
            return;
          }
          if (audio.currentTime >= s + w - 0.04) {
            audio.currentTime = s;
          }
        };

        audio.addEventListener('timeupdate', constrain);
        audio.addEventListener('ended', () => {
          const { start: s } = fileMusicWindowRef.current;
          audio.currentTime = s;
          void audio.play().catch(() => undefined);
        });
        const begin = () => {
          audio.currentTime = start;
          void audio.play().catch((err) => {
            console.warn('[Edit] file music preview failed', err);
          });
        };
        audio.addEventListener('loadedmetadata', begin);
        if (audio.readyState >= 1) begin();
      },
      [stopMusicPreview]
    );

    const onPickMusicFile = async () => {
      if (disabled) return;
      try {
        const picked = await pickAudioFile();
        setCustomMusic({
          uri: picked.uri,
          name: picked.name,
          durationSec: picked.durationSec,
        });
        setMusicOffsetSec(0);
        setSoundMode('file');
        const video = previewVideoRef.current;
        if (video) {
          video.muted = true;
          seekPreviewToTrimStart();
          void video
            .play()
            .then(async () => {
              setPreviewPlaying(true);
              customMusicRef.current = {
                uri: picked.uri,
                name: picked.name,
                durationSec: picked.durationSec,
              };
              musicOffsetRef.current = 0;
              soundModeRef.current = 'file';
              await startBedMusicWithVideo();
            })
            .catch(() => undefined);
        } else {
          playFileMusicPreview(picked.uri, 0);
        }
      } catch (err) {
        if (err instanceof Error && /cancel|dismiss|abort/i.test(err.message)) {
          return;
        }
        onToast?.(
          err instanceof Error ? err.message : 'Could not open audio file'
        );
      }
    };

    const buildEditRecipe = (): EditRecipe | null => {
      if (!source.uri) return null;
      if (soundMode === 'file' && !customMusic?.uri) return null;

      const startSec = Math.max(0, Number(trimRange.lower) || 0);
      const endSec = Math.max(
        startSec + 0.5,
        Number(trimRange.upper) || durationSec || startSec + 0.5
      );
      const fullStart = startSec <= 0.05;
      const fullEnd = durationSec <= 0 || endSec >= durationSec - 0.05;
      const crop = hasCropInsets(insets)
        ? {
            top: insets.top,
            bottom: insets.bottom,
            left: insets.left,
            right: insets.right,
          }
        : undefined;

      return {
        crop,
        trim: fullStart && fullEnd ? undefined : { startSec, endSec },
        soundMode,
        musicOffsetSec: soundMode === 'file' ? musicOffsetSec : undefined,
        musicUri: soundMode === 'file' ? customMusic?.uri : undefined,
        musicName: soundMode === 'file' ? customMusic?.name : undefined,
      };
    };

    useImperativeHandle(
      ref,
      () => ({
        getRecipe: buildEditRecipe,
        pausePreview: () => {
          stopMusicPreview();
          const el = previewVideoRef.current;
          if (el && !el.paused) el.pause();
          setPreviewPlaying(false);
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild via live state on each call
      [
        source.uri,
        soundMode,
        customMusic,
        trimRange,
        durationSec,
        insets,
        musicOffsetSec,
        stopMusicPreview,
      ]
    );

    return (
      <div className="crop-workspace glass-card">
        <div className="crop-workspace-head">
          <p className="crop-source-name">{source.name ?? 'Selected video'}</p>
          {onChangeSource ? (
            <button
              type="button"
              className="crop-clear"
              onClick={onChangeSource}
              disabled={disabled}
            >
              Change
            </button>
          ) : null}
        </div>

        <div className="crop-preview-stage">
          <div className="crop-preview-frame">
            <video
              key={videoSrc}
              ref={previewVideoRef}
              className="crop-preview-video"
              src={videoSrc}
              playsInline
              autoPlay
              muted={muteOriginalInPreview}
              controls={false}
              onPlay={() => setPreviewPlaying(true)}
              onPause={() => setPreviewPlaying(false)}
              onLoadedMetadata={seekPreviewToTrimStart}
              onTimeUpdate={onPreviewTimeUpdate}
            />
            {openAccordion === 'crop' ? (
              <>
                <div
                  className="crop-preview-mask"
                  style={previewStyle}
                  aria-hidden
                />
                <div
                  className="crop-preview-keep"
                  style={previewStyle}
                  aria-hidden
                />
              </>
            ) : null}
            <button
              type="button"
              className="crop-preview-toggle"
              aria-label={previewPlaying ? 'Pause preview' : 'Play preview'}
              disabled={disabled}
              onClick={togglePreviewPlayback}
            >
              <IonIcon icon={previewPlaying ? pauseOutline : playOutline} />
            </button>
          </div>
        </div>

        <IonAccordionGroup
          value={openAccordion}
          onIonChange={(e) => {
            const v = e.detail.value;
            const next =
              typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined;
            if (!next) return;
            setOpenAccordion(next);
          }}
          className="crop-accordions"
        >
          <IonAccordion value="crop" className="crop-accordion">
            <IonItem slot="header" className="crop-accordion-header" lines="none">
              <IonLabel>
                <h3>Crop edges</h3>
                <p>Crop the frame from any edge</p>
              </IonLabel>
            </IonItem>
            <div className="crop-accordion-body" slot="content">
              {EDGE_FIELDS.map(({ key, label }) => (
                <div key={key} className="crop-edge-row">
                  <span className="crop-edge-label">
                    {label}
                    <strong>{insets[key]}%</strong>
                  </span>
                  <IonRange
                    min={0}
                    max={40}
                    step={1}
                    value={insets[key]}
                    disabled={disabled}
                    onIonInput={(e) => {
                      const v = Number(e.detail.value);
                      if (Number.isNaN(v)) return;
                      setInsets((prev) => ({ ...prev, [key]: v }));
                    }}
                    className="crop-range"
                  />
                </div>
              ))}
            </div>
          </IonAccordion>

          <IonAccordion value="trim" className="crop-accordion">
            <IonItem slot="header" className="crop-accordion-header" lines="none">
              <IonLabel>
                <h3>Cut / Trim</h3>
                <p>Keep only part of the timeline</p>
              </IonLabel>
            </IonItem>
            <div className="crop-accordion-body" slot="content">
              <div className="crop-edge-label crop-trim-label">
                <span>
                  Start <strong>{formatTrimTime(trimRange.lower)}</strong>
                </span>
                <span>
                  End <strong>{formatTrimTime(trimRange.upper)}</strong>
                </span>
              </div>
              <p className="crop-trim-meta">
                Keep {formatTrimTime(Math.max(0, trimRange.upper - trimRange.lower))}
                {durationSec > 0 ? ` of ${formatTrimTime(durationSec)}` : ''}
              </p>
              <IonRange
                dualKnobs
                min={0}
                max={Math.max(1, durationSec || 30)}
                step={0.1}
                value={trimRange}
                disabled={disabled || durationSec <= 0}
                onIonInput={(e) => {
                  const v = e.detail.value;
                  if (
                    v &&
                    typeof v === 'object' &&
                    'lower' in v &&
                    'upper' in v
                  ) {
                    const lower = Number(v.lower);
                    const upper = Number(v.upper);
                    if (Number.isNaN(lower) || Number.isNaN(upper)) return;
                    setTrimRange({
                      lower: Math.min(lower, upper - 0.5),
                      upper: Math.max(upper, lower + 0.5),
                    });
                  }
                }}
                className="crop-range"
              />
            </div>
          </IonAccordion>

          <IonAccordion value="sound" className="crop-accordion">
            <IonItem slot="header" className="crop-accordion-header" lines="none">
              <IonLabel>
                <h3>Sound</h3>
                <p>Keep original sound, mute, or add music from a file</p>
              </IonLabel>
            </IonItem>
            <div className="crop-accordion-body" slot="content">
              <button
                type="button"
                className={`sound-mute-btn${
                  soundMode === 'mute' || soundMode === 'file'
                    ? ' sound-mute-btn--on'
                    : ' sound-mute-btn--off'
                }`}
                disabled={disabled}
                aria-pressed={soundMode === 'mute' || soundMode === 'file'}
                onClick={() => {
                  const el = previewVideoRef.current;
                  const muteOn = soundMode === 'mute' || soundMode === 'file';
                  if (muteOn) {
                    stopMusicPreview();
                    setCustomMusic(null);
                    setMusicOffsetSec(0);
                    setSoundMode('keep');
                    if (el) el.muted = false;
                  } else {
                    setSoundMode('mute');
                    if (el) {
                      el.muted = true;
                      if (el.paused) {
                        void el
                          .play()
                          .then(() => setPreviewPlaying(true))
                          .catch(() => undefined);
                      }
                    }
                  }
                }}
              >
                <span className="sound-mute-btn-label">Mute video</span>
                <span className="sound-mute-btn-state">
                  {soundMode === 'mute' || soundMode === 'file' ? 'On' : 'Off'}
                </span>
              </button>
              <p className="crop-trim-meta">
                {soundMode === 'file'
                  ? 'Original audio is muted — your file music plays in the preview.'
                  : soundMode === 'mute'
                    ? 'Mute is on — Convert will remove original audio.'
                    : 'Mute is off — preview plays the imported video’s original audio.'}
              </p>

              <p className="sound-music-heading">From your files</p>
              <button
                type="button"
                className={`sound-file-btn${
                  soundMode === 'file' ? ' sound-file-btn--active' : ''
                }`}
                disabled={disabled}
                onClick={() => void onPickMusicFile()}
              >
                {customMusic?.name
                  ? `Change music · ${customMusic.name}`
                  : 'Select music from device'}
              </button>
              {soundMode === 'file' && customMusic ? (
                <div className="sound-file-seek">
                  <div className="crop-edge-label crop-trim-label">
                    <span>
                      Audio start{' '}
                      <strong>{formatTrimTime(musicOffsetSec)}</strong>
                    </span>
                    <span>
                      Use <strong>{formatTrimTime(trimDurationSec)}</strong>
                    </span>
                  </div>
                  <p className="crop-trim-meta">
                    Matches your Cut/Trim length
                    {customMusic.durationSec > 0
                      ? ` · track ${formatTrimTime(customMusic.durationSec)}`
                      : ''}
                    . Drag to choose which part of the song to use.
                  </p>
                  <IonRange
                    min={0}
                    max={Math.max(0.1, maxMusicOffset)}
                    step={0.1}
                    value={musicOffsetSec}
                    disabled={disabled || maxMusicOffset <= 0}
                    onIonInput={(e) => {
                      const v = Number(e.detail.value);
                      if (Number.isNaN(v)) return;
                      setMusicOffsetSec(
                        Math.min(Math.max(0, v), maxMusicOffset)
                      );
                    }}
                    className="crop-range"
                  />
                  <button
                    type="button"
                    className="sound-preview-audio"
                    disabled={disabled}
                    onClick={() =>
                      playFileMusicPreview(customMusic.uri, musicOffsetSec)
                    }
                  >
                    Preview audio segment
                  </button>
                </div>
              ) : null}
            </div>
          </IonAccordion>
        </IonAccordionGroup>
      </div>
    );
  }
);
