import { registerPlugin } from '@capacitor/core';

export type WhatsAppStatusAvailability = {
  available: boolean;
};

export type WhatsAppStatusShareResult = {
  shared: boolean;
  packageName?: string;
};

export interface WhatsAppStatusPlugin {
  isAvailable(): Promise<WhatsAppStatusAvailability>;
  /** Official SHARE_TO_STATUS intent → Status composer */
  shareToStatus(options: { path: string }): Promise<WhatsAppStatusShareResult>;
  /** Send into a chat so user can pick HD, then Forward → My Status */
  shareToChat(options: { path: string }): Promise<WhatsAppStatusShareResult>;
}

export const WhatsAppStatus = registerPlugin<WhatsAppStatusPlugin>('WhatsAppStatus', {
  web: () => ({
    async isAvailable() {
      return { available: false };
    },
    async shareToStatus() {
      throw new Error('WhatsApp Status share is only available on Android');
    },
    async shareToChat() {
      throw new Error('WhatsApp chat share is only available on Android');
    },
  }),
});
