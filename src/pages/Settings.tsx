import { useState } from 'react';
import { IonButton, IonContent, IonPage, IonToast } from '@ionic/react';
import {
  AppHeader,
  StatusLengthPicker,
  SubscriptionPlans,
  TrialCountdownBanner,
  TrialProgressBar,
  useAuth,
  useTrial,
} from '../ui';
import {
  getPreferredStatusLength,
  setPreferredStatusLength,
} from '../services/statusLengthPreference';
import type { StatusLengthSec } from '../core';
import './Settings.css';

const Settings: React.FC = () => {
  const { shouldShowAds, isSubscribed } = useTrial();
  const { user, logout } = useAuth();
  const [statusLengthSec, setStatusLengthSec] = useState<StatusLengthSec>(
    getPreferredStatusLength
  );
  const [toast, setToast] = useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  });
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <IonPage>
      <IonContent
        fullscreen
        className={`settings-content${shouldShowAds ? ' settings-content--with-ads' : ''}`}
      >
        <AppHeader />
        <div className="settings-body">
          <h2 className="settings-heading">Settings</h2>

          <section className="settings-section">
            <h3 className="settings-section-title font-label-sm">Account</h3>
            <div className="settings-account">
              {user?.name ? (
                <p className="settings-account-name">{user.name}</p>
              ) : null}
              <p className="settings-account-phone">{user?.phoneE164 ?? '—'}</p>
              <IonButton
                expand="block"
                fill="outline"
                color="medium"
                className="settings-logout-btn"
                disabled={loggingOut}
                onClick={() => void handleLogout()}
              >
                {loggingOut ? 'Signing out…' : 'Log out'}
              </IonButton>
            </div>
          </section>

          <TrialProgressBar />
          <TrialCountdownBanner />

          <section className="settings-section">
            <h3 className="settings-section-title font-label-sm">Default status length</h3>
            <StatusLengthPicker
              value={statusLengthSec}
              onChange={(next) => {
                setStatusLengthSec(next);
                setPreferredStatusLength(next);
                setToast({
                  open: true,
                  message: `Default length set to ${next}s`,
                });
              }}
            />
            <p className="settings-hint">
              Used as the starting length on Home for new exports.
            </p>
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title font-label-sm">
              {isSubscribed ? 'Subscription' : 'Unlock Premium'}
            </h3>
            <SubscriptionPlans forceShow />
          </section>
        </div>

        <IonToast
          className="eh-toast"
          isOpen={toast.open}
          message={toast.message}
          duration={2500}
          position="bottom"
          positionAnchor={shouldShowAds ? 'app-ad-footer' : 'app-tab-bar'}
          onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
        />
      </IonContent>
    </IonPage>
  );
};

export default Settings;
