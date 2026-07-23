import { Capacitor } from '@capacitor/core';
import {
  AdMob,
  BannerAdPosition,
  BannerAdSize,
} from '@capacitor-community/admob';
import {
  BANNER_AD_HEIGHT_PX,
  getAdMobBannerUnitId,
  getAdMobInterstitialUnitId,
} from '../core/ads';

/** Approximate IonTabBar height (px) so AdMob sits above tabs */
const TAB_BAR_OFFSET_PX = 64;

type BannerMode = 'none' | 'bottom';

function isAdMobTesting(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_ADMOB_TEST_MODE === 'true';
}

/**
 * Google Ads (AdMob) — bottom banner for trial users,
 * full-screen interstitial while upload/convert runs (progress stays visible underneath).
 */
export class AdsManager {
  private initialized = false;
  private mode: BannerMode = 'none';
  private interstitialReady = false;
  private interstitialPreparing: Promise<boolean> | null = null;

  get bannerHeightPx(): number {
    return BANNER_AD_HEIGHT_PX;
  }

  get tabBarOffsetPx(): number {
    return TAB_BAR_OFFSET_PX;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (!Capacitor.isNativePlatform()) {
      this.initialized = true;
      return;
    }

    await AdMob.initialize();
    this.initialized = true;
  }

  private async removeNativeBanner(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await AdMob.hideBanner();
      await AdMob.removeBanner();
    } catch {
      // Banner may already be gone
    }
  }

  async showBottomBanner(): Promise<void> {
    await this.initialize();

    if (!Capacitor.isNativePlatform()) {
      this.mode = 'bottom';
      return;
    }

    if (this.mode === 'bottom') return;

    await this.removeNativeBanner();

    const platform = Capacitor.getPlatform();
    await AdMob.showBanner({
      adId: getAdMobBannerUnitId(platform),
      adSize: BannerAdSize.BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: TAB_BAR_OFFSET_PX,
      isTesting: isAdMobTesting(),
    });
    this.mode = 'bottom';
  }

  async hideBottomBanner(): Promise<void> {
    if (this.mode !== 'bottom') return;
    await this.removeNativeBanner();
    this.mode = 'none';
  }

  /** Prefetch interstitial so convert can show it quickly. */
  async prepareConvertInterstitial(): Promise<boolean> {
    await this.initialize();

    if (!Capacitor.isNativePlatform()) {
      this.interstitialReady = true;
      return true;
    }

    if (this.interstitialReady) return true;
    if (this.interstitialPreparing) return this.interstitialPreparing;

    this.interstitialPreparing = (async () => {
      try {
        const platform = Capacitor.getPlatform();
        await AdMob.prepareInterstitial({
          adId: getAdMobInterstitialUnitId(platform),
          isTesting: isAdMobTesting(),
        });
        this.interstitialReady = true;
        return true;
      } catch (err) {
        console.warn('[Ads] interstitial prepare failed', err);
        this.interstitialReady = false;
        return false;
      } finally {
        this.interstitialPreparing = null;
      }
    })();

    return this.interstitialPreparing;
  }

  /**
   * Full-screen interstitial during convert. Does not stop upload/progress —
   * call this without awaiting the convert job. Returns when the ad is dismissed
   * (or if it fails to show).
   */
  async showConvertInterstitial(): Promise<boolean> {
    await this.initialize();

    if (!Capacitor.isNativePlatform()) {
      // Web: no native interstitial; progress modal still shows ads + progress
      return false;
    }

    try {
      const ready = await this.prepareConvertInterstitial();
      if (!ready) return false;

      await AdMob.showInterstitial();
      this.interstitialReady = false;
      // Warm the next one in the background
      void this.prepareConvertInterstitial();
      return true;
    } catch (err) {
      console.warn('[Ads] interstitial show failed', err);
      this.interstitialReady = false;
      void this.prepareConvertInterstitial();
      return false;
    }
  }

  isBannerVisible(): boolean {
    return this.mode === 'bottom';
  }
}

export const adsManager = new AdsManager();
