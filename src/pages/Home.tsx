import { useEffect, useRef, useState } from 'react';
import { IonContent, IonPage, IonToast } from '@ionic/react';
import { type MediaSource, type StatusLengthSec } from '../core';
import { adsManager, pickStatusMedia, videoGeneratorService } from '../services';
import { getPreferredStatusLength, setPreferredStatusLength } from '../services/statusLengthPreference';
import { probeVideoDurationSec } from '../services/videoDuration';
import {
  AppHeader,
  ConvertButton,
  ConvertProgressModal,
  StatusLengthPicker,
  StatusShareSheet,
  TrialProgressBar,
  UploadDropZone,
  useTrial,
  VideoTimelineThumbnails,
} from '../ui';
import './Home.css';

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && /abort|cancel/i.test(err.message))
  );
}

/** Let Ionic finish dismissing one modal before presenting the next. */
function waitForModalHandoff(ms = 180): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const Home: React.FC = () => {
  const {
    canExportHd,
    shouldShowAds,
    isTrialExpired,
    loading: trialLoading,
  } = useTrial();

  const [statusLengthSec, setStatusLengthSec] = useState<StatusLengthSec>(
    getPreferredStatusLength
  );
  const [selectedMedia, setSelectedMedia] = useState<MediaSource | null>(null);
  const [videoDurationSec, setVideoDurationSec] = useState(0);
  const [busy, setBusy] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertProgress, setConvertProgress] = useState(0);
  const [convertStatus, setConvertStatus] = useState('Uploading & converting…');
  const abortRef = useRef<AbortController | null>(null);
  /** When true, convert modal dismiss should open the share sheet. */
  const openShareAfterConvertRef = useRef(false);
  const interstitialPromiseRef = useRef<Promise<unknown>>(Promise.resolve());
  const [shareBusy, setShareBusy] = useState(false);
  const [shareUri, setShareUri] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [toast, setToast] = useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  });

  useEffect(() => {
    if (!shouldShowAds) return;
    void adsManager.prepareConvertInterstitial().catch(() => undefined);
  }, [shouldShowAds]);

  const controlsDisabled = busy || trialLoading || !canExportHd;

  const onPickMedia = async () => {
    if (!canExportHd) {
      setToast({
        open: true,
        message: 'Trial expired — HD export is locked. Subscribe in Settings.',
      });
      return;
    }

    setBusy(true);
    try {
      const media = await pickStatusMedia();
      setSelectedMedia(media);

      let durationSec = 0;
      if (media.kind !== 'image' && media.uri) {
        durationSec = await probeVideoDurationSec(media.uri);
      }
      setVideoDurationSec(durationSec);

      setToast({
        open: true,
        message: durationSec
          ? `Selected · ${Math.round(durationSec)}s video`
          : `Selected: ${media.name ?? media.kind ?? 'media'}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not pick media';
      if (!/cancel|dismiss|No media selected/i.test(message)) {
        setToast({ open: true, message });
      }
    } finally {
      setBusy(false);
    }
  };

  const onCancelConvert = () => {
    openShareAfterConvertRef.current = false;
    abortRef.current?.abort();
    setConvertStatus('Cancelling…');
  };

  const onConvertDidDismiss = () => {
    if (!openShareAfterConvertRef.current) return;
    openShareAfterConvertRef.current = false;
    void (async () => {
      // Wait out interstitial (if any) + Ionic modal teardown before share sheet.
      try {
        await interstitialPromiseRef.current;
      } catch {
        // Ad failure must not block share.
      }
      await waitForModalHandoff();
      setShareOpen(true);
    })();
  };

  const onCreateStatus = async () => {
    if (!canExportHd) {
      setToast({
        open: true,
        message: 'Trial expired — HD export is locked. Subscribe in Settings.',
      });
      return;
    }

    if (!selectedMedia?.uri) {
      setToast({
        open: true,
        message: 'Select a video first, then tap Convert to HD',
      });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    openShareAfterConvertRef.current = false;
    setBusy(true);
    setConvertProgress(0);
    setConvertStatus('Uploading & converting…');
    setConvertOpen(true);

    // Fire interstitial in parallel with convert; we await it before share.
    interstitialPromiseRef.current = shouldShowAds
      ? adsManager.showConvertInterstitial().catch((err) => {
          console.warn('[Ads] convert interstitial failed', err);
        })
      : Promise.resolve();

    try {
      const exported = await videoGeneratorService.generate({
        source: selectedMedia,
        statusLengthSec,
        canExportHd,
        signal: controller.signal,
        onProgress: (p) => {
          setConvertProgress(p);
          if (p < 0.25) setConvertStatus('Uploading video…');
          else if (p < 0.85) setConvertStatus('Converting to HD…');
          else setConvertStatus('Saving…');
        },
      });
      setConvertProgress(1);
      setShareUri(exported.outputUri);
      openShareAfterConvertRef.current = true;
      setConvertOpen(false);
      // Safety: if IonModal never fires onDidDismiss, still open the share sheet.
      window.setTimeout(() => {
        if (openShareAfterConvertRef.current) {
          onConvertDidDismiss();
        }
      }, 600);
      setToast({
        open: true,
        message: `Saved to Gallery · ${exported.statusLengthSec}s ready`,
      });
    } catch (err) {
      openShareAfterConvertRef.current = false;
      setConvertOpen(false);
      if (isAbortError(err)) {
        setToast({ open: true, message: 'Convert cancelled' });
      } else {
        setToast({
          open: true,
          message: err instanceof Error ? err.message : 'Could not prepare video',
        });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setConvertOpen(false);
    }
  };

  const closeShareSheet = () => {
    setShareOpen(false);
  };

  const onPostToStatus = async () => {
    if (!shareUri) return;
    setShareBusy(true);
    try {
      const shared = await videoGeneratorService.shareToWhatsAppStatus(shareUri);
      setShareOpen(false);
      setToast({
        open: true,
        message: shared
          ? 'Opened WhatsApp Status'
          : 'Could not open Status — try Gallery share',
      });
    } catch (err) {
      setToast({
        open: true,
        message: err instanceof Error ? err.message : 'Could not open WhatsApp Status',
      });
    } finally {
      setShareBusy(false);
    }
  };

  const onBestQuality = async () => {
    if (!shareUri) return;
    setShareBusy(true);
    try {
      const shared = await videoGeneratorService.shareViaHdChatThenStatus(shareUri);
      setShareOpen(false);
      setToast({
        open: true,
        message: shared
          ? 'Send with HD, then Forward → My Status'
          : 'Could not open WhatsApp — try again from Gallery',
      });
    } catch (err) {
      setToast({
        open: true,
        message: err instanceof Error ? err.message : 'Could not open WhatsApp',
      });
    } finally {
      setShareBusy(false);
    }
  };

  const onShareToFolder = async () => {
    if (!shareUri) return;
    setShareBusy(true);
    try {
      const shared = await videoGeneratorService.shareForPcOrNetwork(shareUri);
      setShareOpen(false);
      setToast({
        open: true,
        message: shared
          ? 'Saved path ready — open on PC → web.whatsapp.com'
          : 'Share unavailable on this device',
      });
    } catch (err) {
      setToast({
        open: true,
        message: err instanceof Error ? err.message : 'Could not open share sheet',
      });
    } finally {
      setShareBusy(false);
    }
  };

  const convertLabel = isTrialExpired
    ? 'HD export locked'
    : `Convert to HD · ${statusLengthSec}s`;

  return (
    <IonPage>
      <IonContent
        fullscreen
        className={`home-content${shouldShowAds ? ' home-content--with-ads' : ''}`}
      >
        <AppHeader />

        <div className="home-body">
          <TrialProgressBar />

          {isTrialExpired ? (
            <p className="home-lock-note" role="status">
              Trial ended — subscribe in Settings to unlock HD export.
            </p>
          ) : null}

          <UploadDropZone
            selectedName={selectedMedia?.name ?? null}
            disabled={controlsDisabled}
            onClick={onPickMedia}
          />

          <StatusLengthPicker
            value={statusLengthSec}
            onChange={(next) => {
              setStatusLengthSec(next);
              setPreferredStatusLength(next);
            }}
            disabled={controlsDisabled}
          />

          {selectedMedia?.uri && selectedMedia.kind !== 'image' ? (
            <VideoTimelineThumbnails
              uri={selectedMedia.uri}
              durationSec={videoDurationSec}
              chunkSec={statusLengthSec}
            />
          ) : null}

          <ConvertButton
            label={convertLabel}
            busy={busy}
            disabled={controlsDisabled || !selectedMedia}
            onClick={onCreateStatus}
          />
        </div>

        <ConvertProgressModal
          open={convertOpen}
          progress={convertProgress}
          statusLabel={convertStatus}
          onCancel={onCancelConvert}
          onDidDismiss={onConvertDidDismiss}
        />

        <StatusShareSheet
          open={shareOpen}
          fileUri={shareUri}
          busy={shareBusy}
          onDismiss={closeShareSheet}
          onPostToStatus={onPostToStatus}
          onBestQuality={onBestQuality}
          onShareToFolder={onShareToFolder}
        />

        <IonToast
          className="eh-toast"
          isOpen={toast.open}
          message={toast.message}
          duration={3600}
          position="bottom"
          positionAnchor={shouldShowAds ? 'app-ad-footer' : 'app-tab-bar'}
          onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
        />
      </IonContent>
    </IonPage>
  );
};

export default Home;
