import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../middleware/errorHandler.js';
import { claimTrial } from '../services/trialStore.js';

export const trialRouter = Router();

const bodySchema = z.object({
  deviceId: z.string().min(1),
});

trialRouter.post('/claim', async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid body', parsed.error.flatten());
    }
    const result = await claimTrial(parsed.data.deviceId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
