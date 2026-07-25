import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { redactPhone } from './whatsappOtp.js';

function cloudApiConfigured(): boolean {
  return Boolean(env.whatsappToken && env.whatsappPhoneNumberId);
}

/**
 * Upload a local video to WhatsApp Cloud API media storage.
 * Returns the media id used to send the message.
 */
export async function uploadWhatsAppVideo(filePath: string): Promise<string> {
  if (!cloudApiConfigured()) {
    throw new Error('WhatsApp Cloud API is not configured');
  }

  const buf = await fs.readFile(filePath);
  const blob = new Blob([new Uint8Array(buf)], { type: 'video/mp4' });
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'video/mp4');
  form.append('file', blob, path.basename(filePath) || 'export.mp4');

  const url = `https://graph.facebook.com/v21.0/${env.whatsappPhoneNumberId}/media`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.whatsappToken}`,
    },
    body: form,
  });

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    console.error('[WhatsApp] media upload failed', res.status, text);
    throw new Error(`WhatsApp media upload failed (${res.status})`);
  }

  let data: { id?: string };
  try {
    data = JSON.parse(text) as { id?: string };
  } catch {
    throw new Error('WhatsApp media upload returned invalid JSON');
  }
  if (!data.id) {
    throw new Error('WhatsApp media upload did not return an id');
  }
  return data.id;
}

/**
 * Send an already-uploaded video to a user (requires open 24h conversation window).
 */
export async function sendWhatsAppVideo(options: {
  phoneE164: string;
  mediaId: string;
  caption?: string;
}): Promise<boolean> {
  if (!cloudApiConfigured()) {
    console.info(
      `[WhatsApp] mock video → ${redactPhone(options.phoneE164)} media=${options.mediaId}`
    );
    return false;
  }

  const url = `https://graph.facebook.com/v21.0/${env.whatsappPhoneNumberId}/messages`;
  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to: options.phoneE164.replace(/^\+/, ''),
    type: 'video',
    video: {
      id: options.mediaId,
      ...(options.caption ? { caption: options.caption } : {}),
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.whatsappToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[WhatsApp] video send failed', res.status, text);
    return false;
  }

  console.info(
    `[WhatsApp] video sent → ${redactPhone(options.phoneE164)} media=${options.mediaId}`
  );
  return true;
}

/**
 * Upload + send a local MP4 to the user's WhatsApp.
 */
export async function deliverExportVideoToWhatsApp(options: {
  phoneE164: string;
  filePath: string;
  caption?: string;
}): Promise<void> {
  const mediaId = await uploadWhatsAppVideo(options.filePath);
  const sent = await sendWhatsAppVideo({
    phoneE164: options.phoneE164,
    mediaId,
    caption:
      options.caption ??
      'Your Embrace HD video is ready. Open WhatsApp to view or post it to Status.',
  });
  if (!sent) {
    throw new Error('Could not send the converted video on WhatsApp');
  }
}
