import { Router } from 'express';
import { env } from '../config/env.js';
import { generateOtpCode, saveOtp } from '../services/otpStore.js';
import {
  findUserByPhone,
  normalizePhoneE164,
  upsertUserForAuth,
} from '../services/userStore.js';
import {
  formatOtpLoginMessage,
  isEnrollMeMessage,
  isLoginMeMessage,
  redactPhone,
  sendWhatsAppText,
} from '../services/whatsappOtp.js';

export const whatsappWebhookRouter = Router();

type WaTextMessage = {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
};

type WaChangeValue = {
  messages?: WaTextMessage[];
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
};

/**
 * Meta webhook verification (subscribe).
 * GET /v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 */
whatsappWebhookRouter.get('/webhook', (req, res) => {
  const mode = String(req.query['hub.mode'] ?? '');
  const token = String(req.query['hub.verify_token'] ?? '');
  const challenge = String(req.query['hub.challenge'] ?? '');

  if (mode === 'subscribe' && env.whatsappVerifyToken && token === env.whatsappVerifyToken) {
    console.info('[WhatsApp webhook] verified');
    res.status(200).type('text/plain').send(challenge);
    return;
  }

  console.warn('[WhatsApp webhook] verification failed');
  res.sendStatus(403);
});

/**
 * Incoming WhatsApp messages.
 * - "Enroll me" → create user + OTP reply
 * - "Login Me" → existing user only + OTP reply (verify via POST /v1/auth/verify-otp)
 */
whatsappWebhookRouter.post('/webhook', (req, res) => {
  // Acknowledge immediately so Meta does not retry
  res.sendStatus(200);

  void handleWebhookPayload(req.body).catch((err) => {
    console.error('[WhatsApp webhook] handler error', err);
  });
});

async function handleWebhookPayload(body: unknown): Promise<void> {
  if (!body || typeof body !== 'object') return;
  const payload = body as {
    object?: string;
    entry?: Array<{
      changes?: Array<{ field?: string; value?: WaChangeValue }>;
    }>;
  };

  if (payload.object !== 'whatsapp_business_account') return;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field && change.field !== 'messages') continue;
      const value = change.value;
      if (!value?.messages?.length) continue;

      for (const message of value.messages) {
        await handleInboundMessage(message, value);
      }
    }
  }
}

async function handleInboundMessage(
  message: WaTextMessage,
  value: WaChangeValue
): Promise<void> {
  if (message.type !== 'text' || !message.text?.body || !message.from) {
    return;
  }

  const text = message.text.body;
  const enroll = isEnrollMeMessage(text);
  const login = isLoginMeMessage(text);
  if (!enroll && !login) {
    return;
  }

  const phoneE164 = normalizePhoneE164(message.from);
  if (!phoneE164) {
    console.warn('[WhatsApp webhook] invalid from', message.from);
    return;
  }

  const profileName = value.contacts?.find((c) => c.wa_id === message.from)
    ?.profile?.name;

  if (enroll) {
    const { user, created } = await upsertUserForAuth({
      phoneE164,
      name: profileName,
      mode: 'register',
    });

    console.info(
      `[WhatsApp webhook] Enroll me from ${redactPhone(phoneE164)} → user ${user.id} (${created ? 'created' : 'existing'})`
    );

    await issueAndReplyOtp({
      phoneE164,
      mode: 'register',
      name: profileName ?? user.name,
    });
    return;
  }

  // Login Me — account must already exist
  const existing = await findUserByPhone(phoneE164);
  if (!existing) {
    console.info(`[WhatsApp webhook] Login Me from ${redactPhone(phoneE164)} — no account`);
    await sendWhatsAppText({
      phoneE164,
      body: 'No account found for this number. Open the app and tap Join the app first (send Enroll me).',
    });
    return;
  }

  console.info(
    `[WhatsApp webhook] Login Me from ${redactPhone(phoneE164)} → user ${existing.id}`
  );

  await issueAndReplyOtp({
    phoneE164,
    mode: 'login',
    name: existing.name,
  });
}

async function issueAndReplyOtp(options: {
  phoneE164: string;
  mode: 'login' | 'register';
  name?: string;
}): Promise<void> {
  const code = generateOtpCode();
  await saveOtp({
    phoneE164: options.phoneE164,
    code,
    mode: options.mode,
    name: options.name,
  });

  const reply = formatOtpLoginMessage(code);
  const sent = await sendWhatsAppText({
    phoneE164: options.phoneE164,
    body: reply,
  });

  if (!sent) {
    console.info(
      `[WhatsApp webhook] OTP for ${redactPhone(options.phoneE164)} (not delivered via API): ${code}`
    );
  }
}
