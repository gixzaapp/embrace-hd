import { useState } from 'react';
import { IonButton, IonContent, IonPage, IonToast } from '@ionic/react';
import { Capacitor } from '@capacitor/core';
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

const DELETE_ACCOUNT_URL = 'https://embraceapp.co.uk/delete-account.html';

const Settings: React.FC = () => {
  const {
    shouldShowAds,
    isSubscribed,
    showLogout,
    showUnlockPremium,
  } = useTrial();
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

  const openDeleteAccountPage = () => {
    if (Capacitor.isNativePlatform()) {
      window.location.href = DELETE_ACCOUNT_URL;
      return;
    }
    window.open(DELETE_ACCOUNT_URL, '_blank', 'noopener,noreferrer');
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
              {showLogout ? (
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
              ) : null}
              <IonButton
                expand="block"
                fill="clear"
                color="danger"
                className="settings-delete-btn"
                onClick={openDeleteAccountPage}
              >
                Delete account
              </IonButton>
              <p className="settings-hint settings-hint--tight">
                Opens our website so you can request permanent account and data deletion.
              </p>
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

          {showUnlockPremium ? (
            <section className="settings-section">
              <h3 className="settings-section-title font-label-sm">
                {isSubscribed ? 'Subscription' : 'Unlock Premium'}
              </h3>
              <SubscriptionPlans forceShow />
            </section>
          ) : null}
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
