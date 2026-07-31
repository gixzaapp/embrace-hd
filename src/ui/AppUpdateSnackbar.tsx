import { useEffect, useState } from 'react';
import { IonToast } from '@ionic/react';
import {
  appUpdateManager,
  type AppUpdatePrompt,
} from '../services/appUpdateManager';
import { useTrial } from './TrialProvider';

/**
 * Non-blocking snackbar when Play Store (or App Store) has a newer build.
 * User can dismiss and keep using the app.
 */
export const AppUpdateSnackbar: React.FC = () => {
  const { shouldShowAds } = useTrial();
  const [prompt, setPrompt] = useState<AppUpdatePrompt | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = appUpdateManager.subscribe(setPrompt);
    void appUpdateManager.checkOnLaunch();
    return unsub;
  }, []);

  const open = Boolean(prompt);

  return (
    <IonToast
      className="eh-toast eh-toast--update"
      isOpen={open}
      message={prompt?.message ?? ''}
      duration={0}
      position="bottom"
      positionAnchor={shouldShowAds ? 'app-ad-footer' : 'app-tab-bar'}
      buttons={[
        {
          text: 'Later',
          role: 'cancel',
          handler: () => {
            appUpdateManager.dismiss();
          },
        },
        {
          text: busy ? '…' : prompt?.primaryLabel ?? 'Update',
          handler: () => {
            if (busy) return false;
            setBusy(true);
            void appUpdateManager
              .acceptPrimaryAction()
              .finally(() => setBusy(false));
            return false;
          },
        },
      ]}
      onDidDismiss={() => {
        // Only clear UI if manager already dismissed; avoid fighting Update action
        if (!prompt) return;
      }}
    />
  );
};
