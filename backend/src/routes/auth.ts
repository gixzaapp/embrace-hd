import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/errorHandler.js';
import {
  requireAuth,
  type AuthedRequest,
} from '../middleware/requireAuth.js';
import { generateOtpCode, saveOtp, verifyOtp } from '../services/otpStore.js';
import { assertCanRequestOtp } from '../services/otpRateLimit.js';
import { createSession, revokeSession } from '../services/sessionStore.js';
import {
  ensureUser,
  findUserByPhone,
  normalizePhoneE164,
  publicUser,
  upsertUserForAuth,
} from '../services/userStore.js';
import {
  deliverWhatsAppOtp,
  isWhatsAppCloudConfigured,
} from '../services/whatsappOtp.js';

export const authRouter = Router();

const requestSchema = z.object({
  phone: z.string().min(8).max(20),
  mode: z.enum(['login', 'register']),
  name: z.string().min(1).max(80).optional(),
  deviceId: z.string().min(1).max(120).optional(),
});

const verifySchema = z.object({
  phone: z.string().min(8).max(20),
  code: z.string().min(4).max(8),
  deviceId: z.string().min(1).max(120).optional(),
});

authRouter.post('/request-otp', async (req, res, next) => {
  try {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid body', parsed.error.flatten());
    }

    const { mode, name, deviceId } = parsed.data;
    const phoneE164 = normalizePhoneE164(parsed.data.phone);
    if (!phoneE164) {
      throw new HttpError(400, 'Invalid phone number');
    }

    if (mode === 'register' && !name?.trim()) {
      throw new HttpError(400, 'Name is required to register');
    }

    if (mode === 'login') {
      const existing = await findUserByPhone(phoneE164);
      if (!existing) {
        throw new HttpError(
          404,
          'No account for this number — register first'
        );
      }
    }

    if (mode === 'register') {
      await upsertUserForAuth({
        phoneE164,
        name: name?.trim(),
        deviceId,
        mode: 'register',
      });
    }

    await assertCanRequestOtp(phoneE164);

    const code = generateOtpCode();
    await saveOtp({
      phoneE164,
      code,
      mode,
      name: name?.trim(),
      deviceId,
    });

    const delivery = await deliverWhatsAppOtp({ phoneE164, code });

    res.json({
      ok: true,
      phoneE164,
      mode,
      channel: delivery.channel,
      expiresInSec: env.authOtpTtlSec,
      whatsappConfigured: isWhatsAppCloudConfigured(),
      ...(delivery.otpHint ? { otpHint: delivery.otpHint } : {}),
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/verify-otp', async (req, res, next) => {
  try {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid body', parsed.error.flatten());
    }

    const phoneE164 = normalizePhoneE164(parsed.data.phone);
    if (!phoneE164) {
      throw new HttpError(400, 'Invalid phone number');
    }

    const result = await verifyOtp(phoneE164, parsed.data.code);
    if (!result.ok) {
      const messages: Record<string, string> = {
        missing: 'No OTP pending — request a new code',
        expired: 'OTP expired — request a new code',
        invalid: 'Incorrect code',
        locked: 'Too many attempts — request a new code',
      };
      throw new HttpError(400, messages[result.reason] ?? 'OTP failed');
    }

    const { record } = result;
    const user = await ensureUser(phoneE164, {
      name: record.name,
      deviceId: parsed.data.deviceId ?? record.deviceId,
    });

    const session = await createSession(user.id);

    res.json({
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: publicUser(user),
    });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!req.authUser) {
      throw new HttpError(401, 'Unauthorized');
    }
    res.json({ user: publicUser(req.authUser) });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (req.authToken) {
      await revokeSession(req.authToken);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
