import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './errorHandler.js';
import { getSession } from '../services/sessionStore.js';
import { getUserById, type AuthUser } from '../services/userStore.js';

export type AuthedRequest = Request & {
  authUser?: AuthUser;
  authToken?: string;
};

export async function requireAuth(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) {
      throw new HttpError(401, 'Missing or invalid Authorization header');
    }
    const token = match[1].trim();
    const session = await getSession(token);
    if (!session) {
      throw new HttpError(401, 'Session expired or invalid');
    }
    const user = await getUserById(session.userId);
    if (!user) {
      throw new HttpError(401, 'User not found');
    }
    req.authUser = user;
    req.authToken = token;
    next();
  } catch (err) {
    next(err);
  }
}
