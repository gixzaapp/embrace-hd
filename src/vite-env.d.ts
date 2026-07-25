/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REVENUECAT_API_KEY?: string;
  readonly VITE_REVENUECAT_APPLE_API_KEY?: string;
  readonly VITE_REVENUECAT_GOOGLE_API_KEY?: string;
  readonly VITE_ADMOB_BANNER_ID_ANDROID?: string;
  readonly VITE_ADMOB_BANNER_ID_IOS?: string;
  readonly VITE_ADMOB_MREC_ID_ANDROID?: string;
  readonly VITE_ADMOB_MREC_ID_IOS?: string;
  readonly VITE_ADMOB_INTERSTITIAL_ID_ANDROID?: string;
  readonly VITE_ADMOB_INTERSTITIAL_ID_IOS?: string;
  readonly VITE_ADMOB_TEST_MODE?: string;
  /** Embrace HD Node backend, e.g. http://10.0.2.2:8787 for Android emulator */
  readonly VITE_API_BASE_URL?: string;
  /** Must be "true" to use the Node backend (off by default for local testing) */
  readonly VITE_BACKEND_ENABLED?: string;
  /** WhatsApp enroll / “Join the app” number (E.164). May differ from business Cloud API number. */
  readonly VITE_WHATSAPP_ENROLL_NUMBER?: string;
  /**
   * WhatsApp Business Cloud API display number (E.164) for opening the 24h chat window.
   * Must match backend WHATSAPP_BUSINESS_E164 — not the enroll number if they differ.
   */
  readonly VITE_WHATSAPP_BUSINESS_NUMBER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
