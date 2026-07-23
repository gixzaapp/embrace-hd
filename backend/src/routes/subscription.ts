import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../middleware/errorHandler.js';
import { verifySubscription } from '../services/revenueCat.js';

export const subscriptionRouter = Router();

const bodySchema = z.object({
  appUserId: z.string().min(1),
});

subscriptionRouter.post('/verify', async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid body', parsed.error.flatten());
    }
    const result = await verifySubscription(parsed.data.appUserId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
