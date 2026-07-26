import { Router } from 'express';
import { env } from '../config/env.js';
import { requireAuth, type AuthedRequest } from '../middleware/requireAuth.js';
import { conversationWindowStatus, CHAT_WINDOW_OPEN_REPLY } from '../services/conversationWindow.js';
import { generateOtpCode, saveOtp } from '../services/otpStore.js';
import { assertCanRequestOtp, recordOtpRequest } from '../services/otpRateLimit.js';
import { HttpError } from '../middleware/errorHandler.js';
import {
  findUserByPhone,
  normalizePhoneE164,
  touchLastInboundWhatsApp,
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
 * Any inbound message from a known user refreshes the 24h conversation window.
 * - "Enroll me" → create user + OTP reply
 * - "Login Me" → existing user only + OTP reply
 */
whatsappWebhookRouter.post('/webhook', (req, res) => {
  // Acknowledge immediately so Meta does not retry
  res.sendStatus(200);

  const body = req.body as { object?: string; entry?: unknown[] } | undefined;
  console.info(
    `[WhatsApp webhook] POST object=${body?.object ?? 'none'} entries=${body?.entry?.length ?? 0}`
  );

  void handleWebhookPayload(req.body).catch((err) => {
    console.error('[WhatsApp webhook] handler error', err);
  });
});

/**
 * GET /v1/whatsapp/conversation-window
 * Auth required — whether the logged-in user's Cloud API 24h window is open.
 */
whatsappWebhookRouter.get(
  '/conversation-window',
  requireAuth,
  (req: AuthedRequest, res) => {
    const user = req.authUser!;
    res.json({
      ok: true,
      ...conversationWindowStatus(user),
    });
  }
);

async function handleWebhookPayload(body: unknown): Promise<void> {
  if (!body || typeof body !== 'object') {
    console.warn('[WhatsApp webhook] empty body');
    return;
  }
  const payload = body as {
    object?: string;
    entry?: Array<{
      changes?: Array<{ field?: string; value?: WaChangeValue }>;
    }>;
  };

  if (payload.object !== 'whatsapp_business_account') {
    console.warn(`[WhatsApp webhook] ignored object=${payload.object}`);
    return;
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const messages = value?.messages ?? [];
      if (!messages.length) {
        // Status receipts also use field=messages but with `statuses` instead
        continue;
      }

      console.info(
        `[WhatsApp webhook] ${messages.length} inbound message(s) field=${change.field ?? 'n/a'}`
      );

      for (const message of messages) {
        await handleInboundMessage(message, value!);
      }
    }
  }
}

async function handleInboundMessage(
  message: WaTextMessage,
  value: WaChangeValue
): Promise<void> {
  if (!message.from) {
    console.warn('[WhatsApp webhook] message missing from');
    return;
  }

  const phoneE164 = normalizePhoneE164(message.from);
  if (!phoneE164) {
    console.warn('[WhatsApp webhook] invalid from', message.from);
    return;
  }

  // Any inbound message type refreshes the 24h window for known users.
  const touched = await touchLastInboundWhatsApp(phoneE164);
  if (touched) {
    console.info(
      `[WhatsApp webhook] window refreshed ${redactPhone(phoneE164)} user=${touched.id}`
    );
  } else {
    console.warn(
      `[WhatsApp webhook] inbound ${redactPhone(phoneE164)} — no matching user (login phone must match)`
    );
  }

  const textBody =
    message.type === 'text' && message.text?.body
      ? message.text.body
      : '';
  const enroll = textBody ? isEnrollMeMessage(textBody) : false;
  const login = textBody ? isLoginMeMessage(textBody) : false;

  // Convert-flow: any non-OTP message that opened the window gets a clear next-step reply.
  if (!enroll && !login) {
    if (touched) {
      await sendWhatsAppText({
        phoneE164,
        body: CHAT_WINDOW_OPEN_REPLY,
      });
    } else {
      await sendWhatsAppText({
        phoneE164,
        body: 'Please sign in to Embrace HD with this WhatsApp number first, then try Convert again.',
      });
    }
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
    // New users were missing on the first touch — stamp window now.
    await touchLastInboundWhatsApp(phoneE164);

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
  try {
    await assertCanRequestOtp(options.phoneE164);
  } catch (err) {
    const message =
      err instanceof HttpError
        ? err.message
        : 'Too many OTP requests. Please try again later.';
    await sendWhatsAppText({
      phoneE164: options.phoneE164,
      body: message,
    });
    return;
  }

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
  await recordOtpRequest(options.phoneE164);

  if (!sent) {
    console.info(
      `[WhatsApp webhook] OTP for ${redactPhone(options.phoneE164)} (not delivered via API): ${code}`
    );
  }
}
