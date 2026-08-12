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

function slackText(text: string) {
  return {
    response_type: 'ephemeral' as const,
    text,
  };
}

/** Always 200 so Slack shows the message instead of "app did not respond". */
function reply(res: Response, text: string): void {
  res.status(200).json(slackText(text));
}

function verifySlackSignatureOrExplain(req: SlackRequest): string | null {
  if (!env.slackSigningSecret) {
    return 'Server misconfigured: SLACK_SIGNING_SECRET is missing on Hetzner.';
  }

  const timestamp = req.headers['x-slack-request-timestamp'];
  const signature = req.headers['x-slack-signature'];
  const rawBody = req.rawBody;
  if (
    typeof timestamp !== 'string' ||
    typeof signature !== 'string' ||
    !rawBody
  ) {
    console.warn('[Slack] missing signature headers or raw body');
    return 'Could not verify Slack request (missing signature). Redeploy API and check Request URL.';
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 60 * 5) {
    console.warn('[Slack] stale timestamp', timestamp);
    return 'Slack request expired (clock skew?). Check server time.';
  }

  const base = `v0:${timestamp}:${rawBody.toString('utf8')}`;
  const expected =
    'v0=' +
    crypto
      .createHmac('sha256', env.slackSigningSecret)
      .update(base, 'utf8')
      .digest('hex');

  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.warn('[Slack] signature mismatch');
      return 'Invalid Slack signature. Check SLACK_SIGNING_SECRET matches the app Signing Secret.';
    }
  } catch (err) {
    console.warn('[Slack] signature compare failed', err);
    return 'Invalid Slack signature.';
  }
  return null;
}

function resolveAction(command: string, text: string): 'count' | 'recent' | 'help' {
  const c = command.toLowerCase();
  const t = text.trim().toLowerCase();
  if (t === 'help' || t === '?') return 'help';
  if (c.includes('recent') || t === 'recent' || t.startsWith('recent ') || t === 'names') {
    return 'recent';
  }
  if (
    c.includes('count') ||
    c.includes('users') ||
    t === 'count' ||
    t === 'users' ||
    t === ''
  ) {
    return 'count';
  }
  return 'help';
}

async function recentNamesText(limit = 10): Promise<string> {
  const users = await listRecentUserNames(limit);
  if (!users.length) return 'No users yet';
  const lines = users.map((u, i) => `${i + 1}. ${u.name}`);
  return `Last ${users.length} Embrace HD users:\n${lines.join('\n')}`;
}

/**
 * POST /v1/slack/commands
 * Slack slash command Request URL.
 * Body must be parsed as raw bytes first (see app.ts) for signature check.
 */
slackRouter.post('/commands', async (req: SlackRequest, res) => {
  try {
    // Slack URL round-trip check when saving a slash command
    if (req.body?.ssl_check === '1' || req.body?.ssl_check === 1) {
      res.status(200).send('OK');
      return;
    }

    const sigError = verifySlackSignatureOrExplain(req);
    if (sigError) {
      reply(res, sigError);
      return;
    }

    const command = String(req.body?.command ?? '');
    const text = String(req.body?.text ?? '');
    const action = resolveAction(command, text);

    if (action === 'help') {
      reply(
        res,
        'Embrace HD: `/eh-users` = count, `/eh-recent` = last 10 names.'
      );
      return;
    }

    if (action === 'count') {
      const count = await countUsers();
      reply(res, `Embrace HD users: *${count}*`);
      return;
    }

    reply(res, await recentNamesText(10));
  } catch (err) {
    console.error('[Slack] command failed', err);
    const message = err instanceof Error ? err.message : 'Command failed';
    reply(res, `Error: ${message}`);
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
