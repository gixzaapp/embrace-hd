import os from 'node:os';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';

/**
 * In-memory request counter. Logs throughput per interval so we can size the
 * jump from a single instance to a load-balanced (highly available) setup.
 *
 * The `instance` id lets you tell instances apart once the environment is
 * scaled horizontally — each box logs its own counts under the ALB.
 */

const instanceId = `${os.hostname()}#${process.pid}`;
const startedAt = Date.now();

const counters = {
  total: 0,
  inFlight: 0,
  ok: 0, // 2xx / 3xx
  clientError: 0, // 4xx
  serverError: 0, // 5xx
};

// Reset each interval to compute per-window throughput.
let windowStart = Date.now();
let windowCount = 0;
let windowPeakInFlight = 0;

export function requestCounter(req: Request, res: Response, next: NextFunction): void {
  // Skip load-balancer health probes so counts reflect real app traffic.
  if (req.path === '/health') {
    next();
    return;
  }

  counters.total += 1;
  counters.inFlight += 1;
  windowCount += 1;
  if (counters.inFlight > windowPeakInFlight) windowPeakInFlight = counters.inFlight;

  res.on('finish', () => {
    counters.inFlight -= 1;
    if (res.statusCode >= 500) counters.serverError += 1;
    else if (res.statusCode >= 400) counters.clientError += 1;
    else counters.ok += 1;
  });

  next();
}

export function getRequestMetrics() {
  const uptimeSec = (Date.now() - startedAt) / 1000;
  return {
    instance: instanceId,
    uptimeSec: Math.round(uptimeSec),
    total: counters.total,
    inFlight: counters.inFlight,
    ok: counters.ok,
    clientError: counters.clientError,
    serverError: counters.serverError,
    avgReqPerSec: uptimeSec > 0 ? Number((counters.total / uptimeSec).toFixed(3)) : 0,
  };
}

function logSummary(): void {
  const now = Date.now();
  const windowSec = (now - windowStart) / 1000;
  const rate = windowSec > 0 ? windowCount / windowSec : 0;
  const mem = process.memoryUsage();

  console.log(
    '[requests]',
    JSON.stringify({
      instance: instanceId,
      window: {
        seconds: Math.round(windowSec),
        count: windowCount,
        reqPerSec: Number(rate.toFixed(3)),
        peakInFlight: windowPeakInFlight,
      },
      totals: {
        total: counters.total,
        ok: counters.ok,
        clientError: counters.clientError,
        serverError: counters.serverError,
      },
      rssMB: Math.round(mem.rss / 1024 / 1024),
    })
  );

  windowStart = now;
  windowCount = 0;
  windowPeakInFlight = counters.inFlight;
}

let timer: NodeJS.Timeout | undefined;

/** Start periodic request-count logging. Safe to call once at startup. */
export function startRequestLogging(): void {
  const intervalMs = env.requestLogIntervalSec * 1000;
  if (intervalMs <= 0 || timer) return;
  timer = setInterval(logSummary, intervalMs);
  // Don't keep the event loop alive just for logging.
  timer.unref?.();
}

export function stopRequestLogging(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
