import crypto from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/errorHandler.js';
import { countUsers, listRecentUserNames } from '../services/userStore.js';

type SlackRequest = Request & { rawBody?: Buffer };

export const slackRouter = Router();

function requireSlackSecret(req: Request, _res: Response, next: NextFunction): void {
  if (!env.slackApiSecret) {
    next(new HttpError(503, 'SLACK_API_SECRET is not configured'));
    return;
  }
  const secret = req.headers['x-slack-secret'];
  if (typeof secret !== 'string' || secret !== env.slackApiSecret) {
    next(new HttpError(401, 'Invalid or missing X-Slack-Secret'));
    return;
  }
  next();
}

/** Slack slash-command / Events HMAC verification (raw body required). */
function verifySlackSignature(
  req: SlackRequest,
  _res: Response,
  next: NextFunction
): void {
  if (!env.slackSigningSecret) {
    next(new HttpError(503, 'SLACK_SIGNING_SECRET is not configured'));
    return;
  }

  const timestamp = req.headers['x-slack-request-timestamp'];
  const signature = req.headers['x-slack-signature'];
  const rawBody = req.rawBody;
  if (
    typeof timestamp !== 'string' ||
    typeof signature !== 'string' ||
    !rawBody
  ) {
    next(new HttpError(401, 'Missing Slack signature headers'));
    return;
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 60 * 5) {
    next(new HttpError(401, 'Stale Slack request'));
    return;
  }

  const base = `v0:${timestamp}:${rawBody.toString('utf8')}`;
  const expected =
    'v0=' +
    crypto.createHmac('sha256', env.slackSigningSecret).update(base).digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    next(new HttpError(401, 'Invalid Slack signature'));
    return;
  }
  next();
}

function slackText(text: string) {
  return {
    response_type: 'ephemeral' as const,
    text,
  };
}

async function recentNamesText(limit = 10): Promise<string> {
  const users = await listRecentUserNames(limit);
  if (!users.length) return 'No users yet';
  const lines = users.map((u, i) => `${i + 1}. ${u.name}`);
  return `Last ${users.length} Embrace HD users:\n${lines.join('\n')}`;
}

/**
 * POST /v1/slack/commands
 * Slack slash command Request URL (form-urlencoded + signing secret).
 *
 * Configure two commands (same URL):
 *   /eh-users   → user count
 *   /eh-recent  → last 10 names
 *
 * Or one command /eh with text: count | recent
 */
slackRouter.post('/commands', verifySlackSignature, async (req, res, next) => {
  try {
    const command = String(req.body?.command ?? '').toLowerCase();
    const text = String(req.body?.text ?? '')
      .trim()
      .toLowerCase();

    let action: 'count' | 'recent' | 'help' = 'help';
    if (command.includes('recent') || text.startsWith('recent') || text === 'names') {
      action = 'recent';
    } else if (
      command.includes('count') ||
      command.includes('users') ||
      text === 'count' ||
      text === 'users' ||
      text === ''
    ) {
      // bare /eh-users or /eh with no args → count
      if (command.includes('recent')) action = 'recent';
      else action = text.startsWith('recent') ? 'recent' : 'count';
    }

    if (action === 'help') {
      res.json(
        slackText(
          'Embrace HD: use `/eh-users` for count, `/eh-recent` for last 10 names, or `/eh count` / `/eh recent`.'
        )
      );
      return;
    }

    if (action === 'count') {
      const count = await countUsers();
      res.json(slackText(`Embrace HD users: *${count}*`));
      return;
    }

    res.json(slackText(await recentNamesText(10)));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/slack/users/count
 * Header: X-Slack-Secret (for curl / Workflow HTTP steps)
 */
slackRouter.get('/users/count', requireSlackSecret, async (_req, res, next) => {
  try {
    const count = await countUsers();
    res.json({
      count,
      text: `Embrace HD users: ${count}`,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/slack/users/recent?limit=10
 * Header: X-Slack-Secret
 */
slackRouter.get('/users/recent', requireSlackSecret, async (req, res, next) => {
  try {
    const raw = Number(req.query.limit ?? 10);
    const limit = Number.isFinite(raw)
      ? Math.min(50, Math.max(1, Math.floor(raw)))
      : 10;
    const users = await listRecentUserNames(limit);
    const names = users.map((u) => u.name);
    const lines = names.map((n, i) => `${i + 1}. ${n}`);
    res.json({
      limit,
      count: names.length,
      names,
      users,
      text:
        names.length === 0
          ? 'No users yet'
          : `Last ${names.length} Embrace HD users:\n${lines.join('\n')}`,
    });
  } catch (err) {
    next(err);
  }
});
