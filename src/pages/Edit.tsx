import { useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonContent,
  IonPage,
  IonToast,
  useIonViewWillLeave,
} from '@ionic/react';
import {
  AppHeader,
  ConvertButton,
  EditWorkspace,
  useMediaSession,
  useTrial,
  type EditWorkspaceHandle,
} from '../ui';
import { pickStatusMedia } from '../services';
import { probeVideoDurationSec } from '../services/videoDuration';
import './Edit.css';

const Edit: React.FC = () => {
  const history = useHistory();
  const { shouldShowAds } = useTrial();
  const {
    selectedMedia,
    hasEditableVideo,
    setSelectedMedia,
    setEditRecipe,
  } = useMediaSession();
  const editWorkspaceRef = useRef<EditWorkspaceHandle | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  });

  useIonViewWillLeave(() => {
    editWorkspaceRef.current?.pausePreview();
    const recipe = editWorkspaceRef.current?.getRecipe();
    if (recipe) setEditRecipe(recipe);
  });

  const onChangeSource = async () => {
    setBusy(true);
    try {
      const media = await pickStatusMedia();
      let durationSec = 0;
      if (media.kind !== 'image' && media.uri) {
        try {
          durationSec = await probeVideoDurationSec(media.uri);
        } catch {
          // ignore
        }
      }
      setSelectedMedia(media, durationSec);
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

  const onSave = () => {
    editWorkspaceRef.current?.pausePreview();
    const recipe = editWorkspaceRef.current?.getRecipe();
    if (recipe === null) {
      setToast({
        open: true,
        message: 'Pick a music file in Sound, or turn Mute off',
      });
      return;
    }
    if (recipe) setEditRecipe(recipe);
    history.replace('/home');
    requestAnimationFrame(() => {
      const homeTab = document.querySelector(
        'ion-tab-button[tab="home"]'
      ) as HTMLElement | null;
      if (homeTab && homeTab.getAttribute('aria-selected') !== 'true') {
        homeTab.click();
      }
    });
  };

  return (
    <IonPage>
      <IonContent
        fullscreen
        className={`edit-content${shouldShowAds ? ' edit-content--with-ads' : ''}`}
      >
        <AppHeader />
        <div className="edit-body">
          <h2 className="edit-heading">Edit</h2>

          {hasEditableVideo && selectedMedia ? (
            <>
              <EditWorkspace
                ref={editWorkspaceRef}
                source={selectedMedia}
                disabled={busy}
                onChangeSource={() => void onChangeSource()}
                onToast={(message) => setToast({ open: true, message })}
                onRecipeChange={setEditRecipe}
              />
              <div className="edit-save-wrap">
                <ConvertButton
                  label="Save"
                  sublabel="Return to Home to Convert to HD"
                  disabled={busy}
                  onClick={onSave}
                />
              </div>
            </>
          ) : (
            <div className="edit-empty" role="status">
              <span className="material-symbols-outlined edit-empty-icon" aria-hidden>
                movie_edit
              </span>
              <p className="edit-empty-title">No video selected</p>
              <p className="edit-empty-copy">
                Select a video on Home first, then open Edit to crop, trim, or change
                sound.
              </p>
            </div>
          )}
        </div>

        <IonToast
          className="eh-toast"
          isOpen={toast.open}
          message={toast.message}
          duration={3200}
          position="bottom"
          positionAnchor={shouldShowAds ? 'app-ad-footer' : 'app-tab-bar'}
          onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
        />
      </IonContent>
    </IonPage>
  );
};

export default Edit;
