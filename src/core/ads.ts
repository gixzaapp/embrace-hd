/** Google AdMob — banner / MREC / interstitial for trial users */

/** Google sample App IDs (replace with production via env / native strings) */
export const ADMOB_TEST_APP_IDS = {
  android: 'ca-app-pub-3940256099942544~3347511713',
  ios: 'ca-app-pub-3940256099942544~1458002511',
} as const;

/** Google sample banner unit IDs — small bottom rectangle */
export const ADMOB_TEST_BANNER_IDS = {
  android: 'ca-app-pub-3940256099942544/6300978111',
  ios: 'ca-app-pub-3940256099942544/2934735716',
} as const;

/** Google sample MREC (medium rectangle 300×250) — same sample banner ID works for size override */
export const ADMOB_TEST_MREC_IDS = {
  android: 'ca-app-pub-3940256099942544/6300978111',
  ios: 'ca-app-pub-3940256099942544/2934735716',
} as const;

/** Google sample interstitial unit IDs */
export const ADMOB_TEST_INTERSTITIAL_IDS = {
  android: 'ca-app-pub-3940256099942544/1033173712',
  ios: 'ca-app-pub-3940256099942544/4411468910',
} as const;

export function getAdMobBannerUnitId(platform: string): string {
  if (platform === 'ios') {
    return import.meta.env.VITE_ADMOB_BANNER_ID_IOS ?? ADMOB_TEST_BANNER_IDS.ios;
  }
  return import.meta.env.VITE_ADMOB_BANNER_ID_ANDROID ?? ADMOB_TEST_BANNER_IDS.android;
}

export function getAdMobMrecUnitId(platform: string): string {
  if (platform === 'ios') {
    return (
      import.meta.env.VITE_ADMOB_MREC_ID_IOS ??
      import.meta.env.VITE_ADMOB_BANNER_ID_IOS ??
      ADMOB_TEST_MREC_IDS.ios
    );
  }
  return (
    import.meta.env.VITE_ADMOB_MREC_ID_ANDROID ??
    import.meta.env.VITE_ADMOB_BANNER_ID_ANDROID ??
    ADMOB_TEST_MREC_IDS.android
  );
}

export function getAdMobInterstitialUnitId(platform: string): string {
  if (platform === 'ios') {
    return (
      import.meta.env.VITE_ADMOB_INTERSTITIAL_ID_IOS ??
      ADMOB_TEST_INTERSTITIAL_IDS.ios
    );
  }
  return (
    import.meta.env.VITE_ADMOB_INTERSTITIAL_ID_ANDROID ??
    ADMOB_TEST_INTERSTITIAL_IDS.android
  );
}

/** Approximate banner height for content padding (BANNER = 50dp) */
export const BANNER_AD_HEIGHT_PX = 56;
