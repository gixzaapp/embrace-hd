import { env } from '../config/env.js';
import {
  CONVERSATION_WINDOW_MS,
  isConversationWindowOpen,
  normalizePhoneE164,
  type AuthUser,
} from './userStore.js';

const DEFAULT_PREFILL =
  'Hi — please open my Embrace HD chat so I can convert videos.';

export type ConversationWindowStatus = {
  open: boolean;
  lastInboundWhatsAppAt: string | null;
  expiresAt: string | null;
  windowHours: number;
  businessPhoneE164: string | null;
  prefillMessage: string;
};

export function getBusinessPhoneE164(): string | null {
  const raw = env.whatsappBusinessE164.trim();
  if (!raw) return null;
  return normalizePhoneE164(raw);
}

export function conversationWindowStatus(user: AuthUser): ConversationWindowStatus {
  const last = user.lastInboundWhatsAppAt ?? null;
  const open = isConversationWindowOpen(last);
  const expiresAt =
    open && last
      ? new Date(new Date(last).getTime() + CONVERSATION_WINDOW_MS).toISOString()
      : null;

  return {
    open,
    lastInboundWhatsAppAt: last,
    expiresAt,
    windowHours: 24,
    businessPhoneE164: getBusinessPhoneE164(),
    prefillMessage: DEFAULT_PREFILL,
  };
}
