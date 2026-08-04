import { Redirect, Route } from 'react-router-dom';
import {
  IonIcon,
  IonLabel,
  IonRouterOutlet,
  IonSpinner,
  IonTabBar,
  IonTabButton,
  IonTabs,
} from '@ionic/react';
import { homeOutline, imagesOutline, settingsOutline } from 'ionicons/icons';
import Auth from '../pages/Auth';
import Home from '../pages/Home';
import Gallery from '../pages/Gallery';
import Settings from '../pages/Settings';
import { BottomBannerAd } from './BottomBannerAd';
import { useAuth } from './AuthProvider';
import { useTrial } from './TrialProvider';

/**
 * Tab shell gated by WhatsApp OTP auth.
 * Unauthenticated users only reach /auth.
 */
export const AppTabs: React.FC = () => {
  const { shouldShowAds } = useTrial();
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="app-shell app-shell--auth-loading">
        <IonSpinner name="crescent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <IonRouterOutlet>
        <Route exact path="/auth">
          <Auth />
        </Route>
        <Route>
          <Redirect to="/auth" />
        </Route>
      </IonRouterOutlet>
    );
  }

  return (
    <div className="app-shell">
      <IonTabs>
        <IonRouterOutlet>
          <Route exact path="/home">
            <Home />
          </Route>
          <Route exact path="/gallery">
            <Gallery />
          </Route>
          <Route exact path="/settings">
            <Settings />
          </Route>
          <Route exact path="/auth">
            <Redirect to="/home" />
          </Route>
          <Route exact path="/">
            <Redirect to="/home" />
          </Route>
        </IonRouterOutlet>

        <IonTabBar
          slot="bottom"
          id="app-tab-bar"
          className={`app-tab-bar${shouldShowAds ? ' app-tab-bar--with-ads' : ''}`}
        >
          <IonTabButton tab="home" href="/home" className="app-tab-button">
            <IonIcon icon={homeOutline} />
            <IonLabel>Home</IonLabel>
          </IonTabButton>
          <IonTabButton tab="gallery" href="/gallery" className="app-tab-button">
            <IonIcon icon={imagesOutline} />
            <IonLabel>Library</IonLabel>
          </IonTabButton>
          <IonTabButton tab="settings" href="/settings" className="app-tab-button">
            <IonIcon icon={settingsOutline} />
            <IonLabel>Settings</IonLabel>
          </IonTabButton>
        </IonTabBar>
      </IonTabs>

      {shouldShowAds ? (
        <div id="app-ad-footer" className="app-ad-footer" aria-hidden>
          <BottomBannerAd />
        </div>
      ) : null}
    </div>
  );
};
