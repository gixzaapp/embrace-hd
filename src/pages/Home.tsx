import { useEffect, useRef, useState } from 'react';
import { IonContent, IonPage, IonToast } from '@ionic/react';
import { type MediaSource, type StatusLengthSec } from '../core';
import {
  adsManager,
  clearEmbraceHdMediaCache,
  fetchConversationWindow,
  getClientBusinessWhatsAppE164,
  isBackendEnabled,
  openBusinessWhatsAppChat,
  pickStatusMedia,
  videoGeneratorService,
  type ConvertPhase,
  type EncodeQualityChoice,
  DEFAULT_ENCODE_QUALITY,
} from '../services';
import { getPreferredStatusLength, setPreferredStatusLength } from '../services/statusLengthPreference';
import { probeVideoDurationSec } from '../services/videoDuration';
import {
  AppHeader,
  ConvertButton,
  ConvertProgressModal,
  QualityDecisionModal,
  StatusLengthPicker,
  TrialProgressBar,
  UploadDropZone,
  useAuth,
  useTrial,
  VideoTimelineThumbnails,
  WhatsAppDeliveredModal,
  type ConvertPhaseProgress,
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
    canUse60sStatus,
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
  const [qualityOpen, setQualityOpen] = useState(false);
  const [encodeQuality, setEncodeQuality] = useState<EncodeQualityChoice>(
    DEFAULT_ENCODE_QUALITY
  );
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertPhases, setConvertPhases] = useState<ConvertPhaseProgress>({
    upload: 0,
    convert: 0,
    send: 0,
  });
  const [convertActivePhase, setConvertActivePhase] =
    useState<ConvertPhase>('upload');
  const abortRef = useRef<AbortController | null>(null);
  const interstitialPromiseRef = useRef<Promise<unknown>>(Promise.resolve());
  const contentRef = useRef<HTMLIonContentElement>(null);
  const convertAnchorRef = useRef<HTMLDivElement>(null);
  const [deliveredOpen, setDeliveredOpen] = useState(false);
  const [toast, setToast] = useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  });

  useEffect(() => {
    if (!shouldShowAds) return;
    void adsManager.prepareConvertInterstitial().catch(() => undefined);
  }, [shouldShowAds]);

  const scrollConvertIntoView = () => {
    // Wait for timeline / layout to paint so the Convert button isn't still off-screen.
    window.setTimeout(() => {
      void (async () => {
        const content = contentRef.current;
        const anchor = convertAnchorRef.current;
        if (!content || !anchor) return;
        try {
          const scrollEl = await content.getScrollElement();
          const contentRect = scrollEl.getBoundingClientRect();
          const anchorRect = anchor.getBoundingClientRect();
          const nextTop =
            scrollEl.scrollTop +
            (anchorRect.bottom - contentRect.bottom) +
            24;
          await content.scrollToPoint(0, Math.max(0, nextTop), 450);
        } catch {
          anchor.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      })();
    }, 180);
  };

  // After pick (and again when duration/timeline settles), bring Convert into view.
  useEffect(() => {
    if (!selectedMedia?.uri) return;
    scrollConvertIntoView();
  }, [selectedMedia?.uri, videoDurationSec]);

  // Trial ended → force 30s Status (60s requires Premium / active trial).
  useEffect(() => {
    if (canUse60sStatus) return;
    if (statusLengthSec === 30) return;
    setStatusLengthSec(30);
    setPreferredStatusLength(30);
  }, [canUse60sStatus, statusLengthSec]);

  const controlsDisabled = busy || trialLoading;

  const onPickMedia = async () => {
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
  };

  const onCancelQuality = () => {
    setQualityOpen(false);
  };

  const resetConvertPhases = () => {
    setConvertPhases({ upload: 0, convert: 0, send: 0 });
    setConvertActivePhase('upload');
  };

  const onCreateStatus = async () => {
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
                'Set WHATSAPP_BUSINESS_E164 on the server (Cloud API number, not enroll).',
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
              'Message the business WhatsApp number, wait a moment, then tap Convert again.',
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

    setEncodeQuality(DEFAULT_ENCODE_QUALITY);
    setQualityOpen(true);
  };

  const onProceedConvert = async (quality: EncodeQualityChoice) => {
    if (!selectedMedia?.uri) {
      setQualityOpen(false);
      return;
    }

    const exportLengthSec: StatusLengthSec = canUse60sStatus
      ? statusLengthSec
      : 30;

    setEncodeQuality(quality);
    setQualityOpen(false);

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    resetConvertPhases();
    setConvertOpen(true);

    interstitialPromiseRef.current = shouldShowAds
      ? (async () => {
          // Let the convert progress UI paint briefly before the full-screen ad.
          await new Promise((r) => setTimeout(r, 2000));
          await adsManager.showConvertInterstitial();
        })().catch((err) => {
          console.warn('[Ads] convert interstitial failed', err);
        })
      : Promise.resolve();

    try {
      const exported = await videoGeneratorService.generate({
        source: selectedMedia,
        statusLengthSec: exportLengthSec,
        canExportHd,
        authToken: token ?? undefined,
        x264Preset: quality,
        signal: controller.signal,
        onProgress: (update) => {
          setConvertActivePhase(update.phase);
          setConvertPhases((prev) => {
            const next = { ...prev };
            // Keep earlier phases completed at 100%
            if (update.phase === 'convert' || update.phase === 'send') {
              next.upload = 1;
            }
            if (update.phase === 'send') {
              next.convert = 1;
            }
            next[update.phase] = update.progress;
            return next;
          });
        },
      });
      setConvertPhases({ upload: 1, convert: 1, send: 1 });
      setConvertActivePhase('send');
      setConvertOpen(false);

      // Drop selection + staged cache copies — job is done on WhatsApp.
      setSelectedMedia(null);
      setVideoDurationSec(0);
      void clearEmbraceHdMediaCache();

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

  const convertLabel = `Convert to HD · ${statusLengthSec}s`;

  return (
    <IonPage>
      <IonContent
        ref={contentRef}
        fullscreen
        className={`home-content${shouldShowAds ? ' home-content--with-ads' : ''}`}
      >
        <AppHeader />

        <div className="home-body">
          <TrialProgressBar />

          {isTrialExpired && !canUse60sStatus ? (
            <p className="home-lock-note" role="status">
              Trial ended — convert with 30s Status. Subscribe to unlock 60s.
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
            restrictedLengths={canUse60sStatus ? [] : [60]}
            onRestrictedSelect={() => {
              setToast({
                open: true,
                message:
                  '60-second Status is locked after your trial. Convert with 30s, or subscribe in Settings to unlock 60s.',
              });
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

          <div ref={convertAnchorRef} className="home-convert-anchor">
            <ConvertButton
              label={convertLabel}
              busy={busy}
              disabled={controlsDisabled || !selectedMedia}
              onClick={onCreateStatus}
            />
          </div>
        </div>

        <QualityDecisionModal
          open={qualityOpen}
          videoDurationSec={videoDurationSec}
          statusLengthSec={statusLengthSec}
          value={encodeQuality}
          onChange={setEncodeQuality}
          onProceed={onProceedConvert}
          onCancel={onCancelQuality}
        />

        <ConvertProgressModal
          open={convertOpen}
          phases={convertPhases}
          activePhase={convertActivePhase}
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
