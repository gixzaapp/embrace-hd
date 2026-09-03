import { useEffect, useRef, useState } from 'react';
import {
  IonContent,
  IonPage,
  IonToast,
  useIonViewWillEnter,
} from '@ionic/react';
import { type MediaSource, type StatusLengthSec } from '../core';
import {
  adsManager,
  clearEmbraceHdMediaCache,
  clearGalleryLibrary,
  fetchConversationWindow,
  getClientBusinessWhatsAppE164,
  getSessionEditRecipe,
  getWorkingMedia,
  hasMeaningfulEditRecipe,
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
  useMediaSession,
  useTrial,
  VideoTimelineThumbnails,
  WhatsAppActivateModal,
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
  const {
    selectedMedia,
    videoDurationSec,
    setSelectedMedia,
    clearSelectedMedia,
  } = useMediaSession();

  const [statusLengthSec, setStatusLengthSec] = useState<StatusLengthSec>(
    getPreferredStatusLength
  );
  const [busy, setBusy] = useState(false);
  const [pickingMedia, setPickingMedia] = useState(false);
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
  const convertDismissedEarlyRef = useRef(false);
  const interstitialPromiseRef = useRef<Promise<unknown>>(Promise.resolve());
  const contentRef = useRef<HTMLIonContentElement>(null);
  const convertAnchorRef = useRef<HTMLDivElement>(null);
  const [deliveredOpen, setDeliveredOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [activateBusy, setActivateBusy] = useState(false);
  const [activateTarget, setActivateTarget] = useState<{
    businessPhoneE164: string;
    prefillMessage: string;
  } | null>(null);
  const [toast, setToast] = useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  });

  useEffect(() => {
    if (!shouldShowAds) return;
    void adsManager.prepareConvertInterstitial().catch(() => undefined);
  }, [shouldShowAds]);

  const scrollConvertIntoView = () => {
    window.setTimeout(() => {
      void (async () => {
        const content = contentRef.current;
        const anchor = convertAnchorRef.current;
        if (!content || !anchor) return;

        try {
          const scrollEl = await content.getScrollElement();
          const adFooter = document.getElementById('app-ad-footer');
          const tabBar = document.getElementById('app-tab-bar');

          let visibleBottom = window.innerHeight;
          if (adFooter) {
            const top = adFooter.getBoundingClientRect().top;
            if (top > 0) visibleBottom = Math.min(visibleBottom, top);
          } else if (tabBar) {
            const top = tabBar.getBoundingClientRect().top;
            if (top > 0) visibleBottom = Math.min(visibleBottom, top);
          }

          const overflow =
            anchor.getBoundingClientRect().bottom + 16 - visibleBottom;
          if (overflow <= 0) return;

          scrollEl.scrollBy({ top: overflow, behavior: 'smooth' });
        } catch {
          anchor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      })();
    }, 220);
  };

  useEffect(() => {
    if (!selectedMedia?.uri) return;
    scrollConvertIntoView();
  }, [selectedMedia?.uri, videoDurationSec]);

  const applyMedia = (media: MediaSource, toastMessage?: string) => {
    void (async () => {
      let durationSec = 0;
      if (media.kind !== 'image' && media.uri) {
        try {
          durationSec = await probeVideoDurationSec(media.uri);
        } catch {
          // ignore probe failures
        }
      }
      setSelectedMedia(media, durationSec);
      if (toastMessage) {
        setToast({ open: true, message: toastMessage });
      } else {
        setToast({
          open: true,
          message: durationSec
            ? `Selected · ${Math.round(durationSec)}s · open Edit to crop, trim, or sound`
            : `Selected: ${media.name ?? media.kind ?? 'media'}`,
        });
      }
    })();
  };

  const selectedUriRef = useRef<string | null>(null);
  selectedUriRef.current = selectedMedia?.uri ?? null;

  // Library → Home handoff within the same app session
  useIonViewWillEnter(() => {
    const working = getWorkingMedia();
    if (working?.uri && working.kind !== 'image' && selectedUriRef.current !== working.uri) {
      applyMedia(
        working,
        `Ready · tap Convert${working.name ? ` · ${working.name}` : ''}`
      );
      return;
    }
    // Returning from Edit (or re-entering) with a video — reveal Convert above ads.
    if (selectedUriRef.current) {
      scrollConvertIntoView();
    }
  });

  useEffect(() => {
    if (canUse60sStatus) return;
    if (statusLengthSec === 30) return;
    setStatusLengthSec(30);
    setPreferredStatusLength(30);
  }, [canUse60sStatus, statusLengthSec]);

  const controlsDisabled = busy || pickingMedia || trialLoading;

  const onPickMedia = async () => {
    setPickingMedia(true);
    try {
      const media = await pickStatusMedia();
      applyMedia(media);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not pick media';
      if (!/cancel|dismiss|No media selected/i.test(message)) {
        setToast({ open: true, message });
      }
    } finally {
      setPickingMedia(false);
    }
  };

  const onCancelConvert = () => {
    abortRef.current?.abort();
  };

  const onCloseConvertProgress = () => {
    convertDismissedEarlyRef.current = true;
    setConvertOpen(false);
    resetHomeWorkspace();
    setBusy(false);
  };

  const onCancelQuality = () => {
    setQualityOpen(false);
  };

  const onDismissActivate = () => {
    if (activateBusy) return;
    setActivateOpen(false);
    setActivateTarget(null);
  };

  const onActivateWhatsApp = async () => {
    if (!activateTarget) return;
    setActivateBusy(true);
    try {
      await openBusinessWhatsAppChat({
        businessPhoneE164: activateTarget.businessPhoneE164,
        text: activateTarget.prefillMessage,
      });
      setActivateOpen(false);
      setActivateTarget(null);
      setToast({
        open: true,
        message:
          'Send the message in WhatsApp, wait a moment, then tap Convert again.',
      });
    } catch (err) {
      setToast({
        open: true,
        message:
          err instanceof Error ? err.message : 'Could not open WhatsApp',
      });
    } finally {
      setActivateBusy(false);
    }
  };

  const resetConvertPhases = () => {
    setConvertPhases({ upload: 0, convert: 0, send: 0 });
    setConvertActivePhase('upload');
  };

  const resetHomeWorkspace = () => {
    clearSelectedMedia();
    void clearEmbraceHdMediaCache();
  };

  const onCreateStatus = async () => {
    if (!selectedMedia?.uri) {
      setToast({
        open: true,
        message: 'Select a video first, then tap Convert to HD',
      });
      return;
    }

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
          setActivateTarget({
            businessPhoneE164: business,
            prefillMessage: windowStatus.prefillMessage,
          });
          setActivateOpen(true);
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

    const recipePreview =
      selectedMedia.kind !== 'image' ? getSessionEditRecipe() : undefined;
    if (selectedMedia.kind !== 'image' && recipePreview === null) {
      setToast({
        open: true,
        message: 'Pick a music file in Sound on the Edit tab, or turn Mute off',
      });
      return;
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

    const recipeRaw =
      selectedMedia.kind !== 'image' ? getSessionEditRecipe() : undefined;
    if (selectedMedia.kind !== 'image' && recipeRaw === null) {
      setToast({
        open: true,
        message: 'Pick a music file in Sound on the Edit tab, or turn Mute off',
      });
      return;
    }
    const editRecipe = recipeRaw ?? undefined;

    if (hasMeaningfulEditRecipe(editRecipe) && !isBackendEnabled()) {
      setToast({
        open: true,
        message:
          'Edit settings need online Convert — connect the API or remove edits',
      });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    convertDismissedEarlyRef.current = false;
    setBusy(true);
    resetConvertPhases();
    setConvertOpen(true);
    let convertStarted = true;

    interstitialPromiseRef.current = shouldShowAds
      ? (async () => {
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
        editRecipe,
        signal: controller.signal,
        onProgress: (update) => {
          setConvertActivePhase(update.phase);
          setConvertPhases((prev) => {
            const next = { ...prev };
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
      if (!convertDismissedEarlyRef.current) {
        setConvertOpen(false);
      }

      void clearGalleryLibrary(exported.galleryItem?.id).catch((err) => {
        console.warn('[Home] clear Library gallery failed', err);
      });

      try {
        await interstitialPromiseRef.current;
      } catch {
        // ignore ad failures
      }

      if (!convertDismissedEarlyRef.current) {
        if (exported.deliveredVia === 'whatsapp') {
          setDeliveredOpen(true);
          setToast({
            open: true,
            message: exported.editsDropped
              ? 'Sent — check WhatsApp (server update needed for crop/trim/sound)'
              : 'Sent — check your WhatsApp',
          });
        } else {
          setToast({
            open: true,
            message: exported.editsDropped
              ? `HD ready · ${exported.statusLengthSec}s (edits skipped — update server)`
              : `HD ready · ${exported.statusLengthSec}s`,
          });
        }
      }
    } catch (err) {
      if (!convertDismissedEarlyRef.current) {
        setConvertOpen(false);
      }
      if (isAbortError(err)) {
        if (!convertDismissedEarlyRef.current) {
          setToast({ open: true, message: 'Convert cancelled' });
        }
      } else if (!convertDismissedEarlyRef.current) {
        setToast({
          open: true,
          message: err instanceof Error ? err.message : 'Could not prepare video',
        });
      }
    } finally {
      if (convertStarted && !convertDismissedEarlyRef.current) {
        resetHomeWorkspace();
      }
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
              Free with ads — longer videos split into 30-second Status parts (e.g. 60s → 2 parts).
              Premium unlocks 60-second Status and removes ads.
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
                  '60-second Status is Premium only. Free plan splits longer videos into 30-second parts — subscribe in Settings.',
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
          onClose={onCloseConvertProgress}
        />

        <WhatsAppDeliveredModal
          open={deliveredOpen}
          onDismiss={() => setDeliveredOpen(false)}
        />

        <WhatsAppActivateModal
          open={activateOpen}
          busy={activateBusy}
          onActivate={() => void onActivateWhatsApp()}
          onDismiss={onDismissActivate}
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
