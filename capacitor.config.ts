import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'uk.co.embraceapp.app',
  appName: 'Embrace HD',
  webDir: 'dist',
  // Dev: allow HTTP calls to local Node backend (mixed-content otherwise blocks)
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#0a0c12',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
  },
};

export default config;
