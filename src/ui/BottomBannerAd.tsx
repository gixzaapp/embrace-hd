import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { adsManager } from '../services/adsManager';
import { useTrial } from './TrialProvider';
import './BottomBannerAd.css';

/**
 * Shows a bottom AdMob BANNER for trial / trial-expired users.
 * Subscribers get no ads.
 */
export const BottomBannerAd: React.FC = () => {
  const { shouldShowAds, loading } = useTrial();

  useEffect(() => {
    if (loading) return;

    let cancelled = false;

    const sync = async () => {
      if (cancelled) return;
      if (shouldShowAds) {
        await adsManager.showBottomBanner().catch((err) => {
          console.warn('[Ads] Failed to show banner', err);
        });
      } else {
        await adsManager.hideBottomBanner().catch(() => undefined);
      }
    };

    void sync();

    return () => {
      cancelled = true;
      void adsManager.hideBottomBanner().catch(() => undefined);
    };
  }, [shouldShowAds, loading]);

  // Web / preview placeholder so layout matches native bottom banner
  if (!shouldShowAds || loading) return null;

  if (!Capacitor.isNativePlatform()) {
    return (
      <div className="bottom-banner-ad bottom-banner-ad--web" role="complementary" aria-label="Advertisement">
        <span className="bottom-banner-ad-label">Ad</span>
        <span className="bottom-banner-ad-copy">Google Ads · banner (trial)</span>
      </div>
    );
  }

  // Native AdMob draws its own view; reserve space so content isn't covered
  return <div className="bottom-banner-ad bottom-banner-ad--spacer" aria-hidden />;
};
