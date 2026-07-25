import { useEffect, useRef, useState } from 'react';
import { IonContent, IonPage, IonToast } from '@ionic/react';
import { type MediaSource, type StatusLengthSec } from '../core';
import {
  adsManager,
  fetchConversationWindow,
  getClientBusinessWhatsAppE164,
  isBackendEnabled,
  openBusinessWhatsAppChat,
  pickStatusMedia,
  videoGeneratorService,
} from '../services';
import { getPreferredStatusLength, setPreferredStatusLength } from '../services/statusLengthPreference';
import { probeVideoDurationSec } from '../services/videoDuration';
import {
  AppHeader,
  ConvertButton,
  ConvertProgressModal,
  StatusLengthPicker,
  TrialProgressBar,
  UploadDropZone,
  useAuth,
  useTrial,
  VideoTimelineThumbnails,
  WhatsAppDeliveredModal,
} from '../ui';
import './Home.css';

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && /abort|cancel/i.test(err.message))
  );
}

const Home: React.FC = () => {
  const {
    canExportHd,
    shouldShowAds,
    isTrialExpired,
    loading: trialLoading,
  } = useTrial();
  const { token, isAuthenticated } = useAuth();

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
  const interstitialPromiseRef = useRef<Promise<unknown>>(Promise.resolve());
  const [deliveredOpen, setDeliveredOpen] = useState(false);
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
    abortRef.current?.abort();
    setConvertStatus('Cancelling…');
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

    // Require an open WhatsApp 24h conversation window before upload (backend delivery).
    if (isBackendEnabled()) {
      if (!isAuthenticated || !token) {
        setToast({
          open: true,
          message: 'Sign in with WhatsApp before converting to HD.',
        });
        return;
      }
      try {
        const windowStatus = await fetchConversationWindow(token);
        if (!windowStatus.open) {
          const business =
            windowStatus.businessPhoneE164 || getClientBusinessWhatsAppE164();
          if (!business) {
            setToast({
              open: true,
              message:
                'WhatsApp business number is not configured. Contact support.',
            });
            return;
          }
          await openBusinessWhatsAppChat({
            businessPhoneE164: business,
            text: windowStatus.prefillMessage,
          });
          setToast({
            open: true,
            message:
              'Send the message in WhatsApp, then return here and tap Convert to HD again.',
          });
          return;
        }
      } catch (err) {
        setToast({
          open: true,
          message:
            err instanceof Error
              ? err.message
              : 'Could not verify WhatsApp chat window',
        });
        return;
      }
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setConvertProgress(0);
    setConvertStatus('Uploading & converting…');
    setConvertOpen(true);

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
        authToken: token ?? undefined,
        signal: controller.signal,
        onProgress: (p) => {
          setConvertProgress(p);
          if (p < 0.25) setConvertStatus('Uploading video…');
          else if (p < 0.75) setConvertStatus('Converting to HD…');
          else setConvertStatus('Sending to WhatsApp…');
        },
      });
      setConvertProgress(1);
      setConvertOpen(false);

      try {
        await interstitialPromiseRef.current;
      } catch {
        // ignore ad failures
      }

      if (exported.deliveredVia === 'whatsapp') {
        setDeliveredOpen(true);
        setToast({
          open: true,
          message: 'Sent — check your WhatsApp',
        });
      } else {
        setToast({
          open: true,
          message: `Saved to Gallery · ${exported.statusLengthSec}s ready`,
        });
      }
    } catch (err) {
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
        />

        <WhatsAppDeliveredModal
          open={deliveredOpen}
          onDismiss={() => setDeliveredOpen(false)}
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
