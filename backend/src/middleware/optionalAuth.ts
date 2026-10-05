import type { NextFunction, Response } from 'express';
import { getSession } from '../services/sessionStore.js';
import { getUserById } from '../services/userStore.js';
import type { AuthedRequest } from './requireAuth.js';

/** Sets req.authUser when a valid Bearer token is present; otherwise continues. */
export async function optionalAuth(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) {
      next();
      return;
    }
    const token = match[1].trim();
    const session = await getSession(token);
    if (!session) {
      next();
      return;
    }
    const user = await getUserById(session.userId);
    if (user) {
      req.authUser = user;
      req.authToken = token;
    }
    next();
  } catch (err) {
    next(err);
  }
}
