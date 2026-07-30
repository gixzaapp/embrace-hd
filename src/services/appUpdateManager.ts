import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import {
  AppUpdate,
  AppUpdateAvailability,
  FlexibleUpdateInstallStatus,
  type AppUpdateInfo,
} from '@capawesome/capacitor-app-update';

export type AppUpdatePromptKind = 'available' | 'ready';

export type AppUpdatePrompt = {
  kind: AppUpdatePromptKind;
  message: string;
  primaryLabel: string;
  /** Store / flexible version code for dismiss tracking */
  versionKey: string;
};

type PromptListener = (prompt: AppUpdatePrompt | null) => void;

const DISMISS_PREFIX = 'eh_update_dismissed:';

function dismissKey(versionKey: string): string {
  return `${DISMISS_PREFIX}${versionKey}`;
}

function wasDismissed(versionKey: string): boolean {
  try {
    return localStorage.getItem(dismissKey(versionKey)) === '1';
  } catch {
    return false;
  }
}

function markDismissed(versionKey: string): void {
  try {
    localStorage.setItem(dismissKey(versionKey), '1');
  } catch {
    // ignore
  }
}

function versionKeyFromInfo(info: AppUpdateInfo): string {
  return (
    info.availableVersionCode ||
    info.availableVersionName ||
    info.currentVersionCode ||
    'update'
  );
}

/**
 * Optional Play Store flexible updates + store fallback.
 * Non-blocking: snackbar only; user can dismiss and keep using the app.
 */
class AppUpdateManager {
  private listener: PromptListener | null = null;
  private stateHandle: PluginListenerHandle | null = null;
  private current: AppUpdatePrompt | null = null;
  private checked = false;

  subscribe(listener: PromptListener): () => void {
    this.listener = listener;
    listener(this.current);
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  private emit(prompt: AppUpdatePrompt | null): void {
    this.current = prompt;
    this.listener?.(prompt);
  }

  dismiss(): void {
    if (this.current) {
      markDismissed(this.current.versionKey);
    }
    this.emit(null);
  }

  async checkOnLaunch(): Promise<void> {
    if (this.checked) return;
    this.checked = true;

    if (!Capacitor.isNativePlatform()) return;

    try {
      await this.ensureFlexibleListener();
      const info = await AppUpdate.getAppUpdateInfo();

      if (
        info.installStatus === FlexibleUpdateInstallStatus.DOWNLOADED
      ) {
        this.showReady(versionKeyFromInfo(info));
        return;
      }

      if (info.updateAvailability !== AppUpdateAvailability.UPDATE_AVAILABLE) {
        return;
      }

      const key = versionKeyFromInfo(info);
      if (wasDismissed(key)) return;

      this.emit({
        kind: 'available',
        message: 'A new version is available',
        primaryLabel: 'Update',
        versionKey: key,
      });
    } catch (err) {
      console.warn('[AppUpdate] check failed', err);
    }
  }

  async acceptPrimaryAction(): Promise<void> {
    const prompt = this.current;
    if (!prompt) return;

    if (prompt.kind === 'ready') {
      try {
        await AppUpdate.completeFlexibleUpdate();
      } catch (err) {
        console.warn('[AppUpdate] complete failed', err);
        await AppUpdate.openAppStore({
          androidPackageName: 'uk.co.embraceapp.app',
        }).catch(() => undefined);
      }
      return;
    }

    // available → start flexible download or open store; keep using the app
    markDismissed(prompt.versionKey);
    this.emit(null);

    try {
      const info = await AppUpdate.getAppUpdateInfo();
      if (
        Capacitor.getPlatform() === 'android' &&
        info.flexibleUpdateAllowed
      ) {
        await AppUpdate.startFlexibleUpdate();
        return;
      }
      await AppUpdate.openAppStore({
        androidPackageName: 'uk.co.embraceapp.app',
      });
    } catch (err) {
      console.warn('[AppUpdate] start failed', err);
      try {
        await AppUpdate.openAppStore({
          androidPackageName: 'uk.co.embraceapp.app',
        });
      } catch {
        // ignore
      }
    }
  }

  private showReady(versionKey: string): void {
    this.emit({
      kind: 'ready',
      message: 'Update downloaded — restart to install',
      primaryLabel: 'Restart',
      versionKey,
    });
  }

  private async ensureFlexibleListener(): Promise<void> {
    if (this.stateHandle || Capacitor.getPlatform() !== 'android') return;

    this.stateHandle = await AppUpdate.addListener(
      'onFlexibleUpdateStateChange',
      (state) => {
        if (state.installStatus === FlexibleUpdateInstallStatus.DOWNLOADED) {
          this.showReady(this.current?.versionKey || 'downloaded');
        }
      }
    );
  }
}

export const appUpdateManager = new AppUpdateManager();
