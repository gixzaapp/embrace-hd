import { Router } from 'express';
import { getAppConfig } from '../services/configStore.js';

export const configRouter = Router();

configRouter.get('/', async (_req, res, next) => {
  try {
    const config = await getAppConfig();
    res.json(config);
  } catch (err) {
    next(err);
  }
});
