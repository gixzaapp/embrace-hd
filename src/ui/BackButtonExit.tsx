import { useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

function currentPath(): string {
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === '' ? '/' : path;
}

function isExitPath(path: string): boolean {
  return path === '/' || path === '/home' || path === '/auth';
}

function goHome(history: ReturnType<typeof useHistory>): void {
  // Prefer React Router replace — never history.back() (that walks Settings → Gallery).
  history.replace('/home');
  // Force IonTabs selection if the URL updated but the tab UI lagged.
  requestAnimationFrame(() => {
    const homeTab = document.querySelector(
      'ion-tab-button[tab="home"]'
    ) as HTMLElement | null;
    if (homeTab && homeTab.getAttribute('aria-selected') !== 'true') {
      homeTab.click();
    }
  });
}

/**
 * Android back — Capacitor-owned (Ionic hardwareBackButton is disabled in App.tsx):
 * - /settings | /gallery → /home
 * - /home | /auth → exit
 */
export const BackButtonExit: React.FC = () => {
  const history = useHistory();

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;

    const sub = CapApp.addListener('backButton', () => {
      const path = currentPath();

      if (isExitPath(path)) {
        void CapApp.exitApp();
        return;
      }

      goHome(history);
    });

    return () => {
      void sub.then((handle) => handle.remove());
    };
  }, [history]);

  return null;
};
