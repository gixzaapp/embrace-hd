import { useEffect, useState } from 'react';
import { IonButton, IonContent, IonPage, IonToast } from '@ionic/react';
import { App as CapApp } from '@capacitor/app';
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
import packageJson from '../../package.json';
import './Settings.css';

const DELETE_ACCOUNT_URL = 'https://embraceapp.co.uk/delete-account.html';
const FALLBACK_VERSION = packageJson.version || '1.0.0';

const Settings: React.FC = () => {
  const {
    shouldShowAds,
    isSubscribed,
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
  const [appVersion, setAppVersion] = useState(FALLBACK_VERSION);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void CapApp.getInfo()
      .then((info) => {
        if (info.version) setAppVersion(info.version);
      })
      .catch(() => undefined);
  }, []);

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
              <IonButton
                expand="block"
                fill="outline"
                color="medium"
                className="settings-logout-btn"
                disabled={loggingOut}
                onClick={() => void handleLogout()}
              >
                {loggingOut ? 'Signing out…' : 'Sign out'}
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

          {showUnlockPremium ? (
            <section className="settings-section">
              <h3 className="settings-section-title font-label-sm">
                {isSubscribed ? 'Subscription' : 'Unlock Premium'}
              </h3>
              <SubscriptionPlans forceShow />
            </section>
          ) : null}

          <section className="settings-section">
            <h3 className="settings-section-title font-label-sm">About EmbraceHD</h3>
            <div className="settings-about">
              <p className="settings-about-copy">
                Create WhatsApp Status–ready HD video — crop, trim, and sound on
                device, then convert and share.
              </p>
              <p className="settings-about-version">
                Version <strong>{appVersion}</strong>
              </p>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title font-label-sm">Danger zone</h3>
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
