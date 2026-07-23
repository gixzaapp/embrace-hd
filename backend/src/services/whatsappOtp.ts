import { env } from '../config/env.js';

export type OtpDeliveryResult = {
  channel: 'whatsapp' | 'mock';
  /** Present only when mock + AUTH_ALLOW_OTP_HINT */
  otpHint?: string;
};

function cloudApiConfigured(): boolean {
  return Boolean(env.whatsappToken && env.whatsappPhoneNumberId);
}

/** Reply / OTP body shown to the user on WhatsApp */
export function formatOtpLoginMessage(code: string): string {
  return `Use this otp ${code} to login to the app using your WhatsApp number`;
}

/**
 * Send a free-form text message via WhatsApp Cloud API.
 * Returns false if Cloud API is not configured or the send failed.
 */
export async function sendWhatsAppText(options: {
  phoneE164: string;
  body: string;
}): Promise<boolean> {
  if (!cloudApiConfigured()) {
    console.info(
      `[WhatsApp] mock text → ${options.phoneE164}: ${options.body}`
    );
    return false;
  }

  const url = `https://graph.facebook.com/v21.0/${env.whatsappPhoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: options.phoneE164.replace(/^\+/, ''),
    type: 'text',
    text: {
      preview_url: false,
      body: options.body,
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
    console.error('[WhatsApp] Cloud API send failed', res.status, text);
    return false;
  }

  return true;
}

/**
 * Send OTP via an approved WhatsApp authentication template (business-initiated).
 * Returns false if not configured or the send failed.
 */
export async function sendWhatsAppOtpTemplate(options: {
  phoneE164: string;
  code: string;
}): Promise<boolean> {
  if (!cloudApiConfigured() || !env.whatsappOtpTemplate) {
    return false;
  }

  const components: unknown[] = [
    {
      type: 'body',
      parameters: [{ type: 'text', text: options.code }],
    },
  ];

  if (env.whatsappOtpTemplateHasButton) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: options.code }],
    });
  }

  const url = `https://graph.facebook.com/v21.0/${env.whatsappPhoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: options.phoneE164.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: env.whatsappOtpTemplate,
      language: { code: env.whatsappOtpTemplateLang },
      components,
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
    console.error('[WhatsApp] template send failed', res.status, text);
    return false;
  }

  return true;
}

/**
 * Send OTP via WhatsApp Cloud API when configured; otherwise mock (log + optional hint).
 * Prefers an approved authentication template (works for business-initiated sends),
 * falling back to free-form text (only delivered within the 24h customer window).
 */
export async function deliverWhatsAppOtp(options: {
  phoneE164: string;
  code: string;
}): Promise<OtpDeliveryResult> {
  if (!cloudApiConfigured()) {
    console.info(
      `[Auth OTP] mock → ${options.phoneE164} code=${options.code}`
    );
    return {
      channel: 'mock',
      otpHint: env.authAllowOtpHint ? options.code : undefined,
    };
  }

  // Business-initiated OTP: template first (if configured), else free-form text.
  let sent = await sendWhatsAppOtpTemplate({
    phoneE164: options.phoneE164,
    code: options.code,
  });

  if (!sent) {
    sent = await sendWhatsAppText({
      phoneE164: options.phoneE164,
      body: formatOtpLoginMessage(options.code),
    });
  }

  if (!sent) {
    console.info(
      `[Auth OTP] fallback mock → ${options.phoneE164} code=${options.code}`
    );
    return {
      channel: 'mock',
      otpHint: env.authAllowOtpHint ? options.code : undefined,
    };
  }

  return { channel: 'whatsapp' };
}

export function isWhatsAppCloudConfigured(): boolean {
  return cloudApiConfigured();
}

export function isEnrollMeMessage(text: string): boolean {
  return text.trim().toLowerCase().replace(/\s+/g, ' ') === 'enroll me';
}

export function isLoginMeMessage(text: string): boolean {
  return text.trim().toLowerCase().replace(/\s+/g, ' ') === 'login me';
}
