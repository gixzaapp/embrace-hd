import { Capacitor } from '@capacitor/core';
import { apiFetch, getApiBaseUrl, isBackendEnabled, ApiError } from './apiClient';

export type ConversationWindowResponse = {
  ok: boolean;
  open: boolean;
  lastInboundWhatsAppAt: string | null;
  expiresAt: string | null;
  windowHours: number;
  businessPhoneE164: string | null;
  prefillMessage: string;
};

export function getClientBusinessWhatsAppE164(): string | null {
  // Must match server WHATSAPP_BUSINESS_E164 (Cloud API / WABA number).
  // Do NOT use VITE_WHATSAPP_ENROLL_NUMBER — that can be a different line.
  const raw = import.meta.env.VITE_WHATSAPP_BUSINESS_NUMBER?.trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits ? `+${digits}` : null;
}

export function getClientEnrollWhatsAppE164(): string | null {
  const raw = import.meta.env.VITE_WHATSAPP_ENROLL_NUMBER?.trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits ? `+${digits}` : null;
}

/** Check whether the Cloud API 24h customer-care window is open for the logged-in user. */
export async function fetchConversationWindow(
  token: string
): Promise<ConversationWindowResponse> {
  if (!isBackendEnabled() || !getApiBaseUrl()) {
    throw new ApiError('Backend is required for conversation window checks', 0);
  }
  return apiFetch<ConversationWindowResponse>('/v1/whatsapp/conversation-window', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

/** Open WhatsApp chat to the business number with an optional prefilled message. */
export async function openBusinessWhatsAppChat(options: {
  businessPhoneE164: string;
  text?: string;
}): Promise<void> {
  const digits = options.businessPhoneE164.replace(/\D/g, '');
  if (!digits) {
    throw new Error('Business WhatsApp number is not configured');
  }
  const text = options.text?.trim() ?? '';
  const url = text
    ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
    : `https://wa.me/${digits}`;

  if (Capacitor.isNativePlatform()) {
    // Capacitor WebView: navigate so the OS opens WhatsApp
    window.location.href = url;
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
