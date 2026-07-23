import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import type { SharePayload } from '../core';
import { WhatsAppStatus } from '../plugins/whatsappStatus';

function toNativePath(uri: string): string {
  if (uri.startsWith('file://')) return uri;
  if (uri.startsWith('/')) return `file://${uri}`;
  return uri;
}

export async function isWhatsAppStatusShareAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return false;
  }
  try {
    const result = await WhatsAppStatus.isAvailable();
    return Boolean(result.available);
  } catch {
    return false;
  }
}

/**
 * Official WhatsApp Share-to-Status API (opens Status composer with the video).
 */
export async function shareToWhatsAppStatus(fileUri: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    return shareMediaFallback(fileUri);
  }
  try {
    const result = await WhatsAppStatus.shareToStatus({
      path: toNativePath(fileUri),
    });
    return Boolean(result.shared);
  } catch (err) {
    console.warn('[Share] Status intent failed; falling back to share sheet', err);
    return shareMediaFallback(fileUri);
  }
}

/**
 * Share into a WhatsApp chat so the user can enable HD, then Forward → My Status.
 * This is the quality path competitor Status apps document in their tutorials.
 */
export async function shareToWhatsAppChatForHdStatus(
  fileUri: string
): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    return shareMediaFallback(fileUri);
  }
  try {
    const result = await WhatsAppStatus.shareToChat({
      path: toNativePath(fileUri),
    });
    return Boolean(result.shared);
  } catch (err) {
    console.warn('[Share] Chat share failed; falling back to share sheet', err);
    return shareMediaFallback(fileUri);
  }
}

/**
 * Open the system share sheet so the user can save to Files, Drive,
 * or a network/SMB folder — then send via WhatsApp Web / Desktop (no phone
 * Status re-encode; Web preserves converted quality).
 */
export async function shareFileForPcOrNetwork(
  fileUri: string
): Promise<boolean> {
  return shareMedia({
    title: 'Embrace HD — WhatsApp Web',
    files: [fileUri],
    text: 'Save this file, open on PC, send via web.whatsapp.com for full quality.',
    dialogTitle: 'Save for WhatsApp Web (PC)',
  });
}

async function shareMediaFallback(fileUri: string): Promise<boolean> {
  return shareMedia({
    title: 'Embrace HD',
    files: [fileUri],
    text: 'Created with Embrace HD',
    dialogTitle: 'Share to WhatsApp',
  });
}

/**
 * Generic native share sheet — fallback when Status intent is unavailable.
 */
export async function shareMedia(payload: SharePayload): Promise<boolean> {
  const can = await Share.canShare();
  if (!can.value) {
    return false;
  }

  await Share.share({
    title: payload.title,
    text: payload.text,
    url: payload.url,
    files: payload.files,
    dialogTitle: payload.dialogTitle ?? 'Share to WhatsApp',
  });

  return true;
}
