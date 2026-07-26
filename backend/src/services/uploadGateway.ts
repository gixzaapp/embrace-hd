import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { env } from '../config/env.js';
import { getUploadsDir } from './exportVideo.js';

const SAFE_GATEWAY_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/i;

/** True when the Cloudflare upload gateway integration is configured. */
export function isUploadGatewayConfigured(): boolean {
  return Boolean(env.workerHetznerSecret && env.uploadGatewayPublicUrl);
}

/**
 * Reject SSRF: downloadUrl must be https on the configured gateway host,
 * path /videos/<uuid>.mp4
 */
export function assertAllowedGatewayDownloadUrl(downloadUrl: string): void {
  if (!env.uploadGatewayPublicUrl) {
    throw new Error('UPLOAD_GATEWAY_PUBLIC_URL is not configured');
  }

  let allowed: URL;
  let actual: URL;
  try {
    allowed = new URL(env.uploadGatewayPublicUrl);
    actual = new URL(downloadUrl);
  } catch {
    throw new Error('Invalid downloadUrl');
  }

  if (actual.protocol !== 'https:' && actual.protocol !== 'http:') {
    throw new Error('downloadUrl must be http(s)');
  }
  if (actual.hostname !== allowed.hostname) {
    throw new Error('downloadUrl host is not the upload gateway');
  }
  if (actual.port !== allowed.port) {
    throw new Error('downloadUrl port does not match upload gateway');
  }

  const match = /^\/videos\/([^/]+)$/.exec(actual.pathname);
  if (!match || !SAFE_GATEWAY_FILE.test(match[1])) {
    throw new Error('downloadUrl path must be /videos/<uuid>.mp4');
  }
}

/**
 * Pull a video from the Cloudflare gateway into local uploads dir.
 * Returns the absolute path written.
 */
export async function pullGatewayVideo(options: {
  downloadUrl: string;
  fileName: string;
}): Promise<string> {
  assertAllowedGatewayDownloadUrl(options.downloadUrl);

  if (!SAFE_GATEWAY_FILE.test(options.fileName)) {
    throw new Error('Invalid fileName');
  }
  if (!env.workerHetznerSecret) {
    throw new Error('WORKER_HETZNER_SECRET is not configured');
  }

  const res = await fetch(options.downloadUrl, {
    method: 'GET',
    headers: {
      'X-Internal-Secret': env.workerHetznerSecret,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Gateway download failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ''}`
    );
  }
  if (!res.body) {
    throw new Error('Gateway download returned an empty body');
  }

  const uploads = await getUploadsDir();
  const destPath = path.join(uploads, `${Date.now()}_${options.fileName}`);

  const nodeStream = Readable.fromWeb(
    res.body as import('node:stream/web').ReadableStream
  );
  await pipeline(nodeStream, createWriteStream(destPath));

  const stat = await fs.stat(destPath);
  if (stat.size <= 0) {
    await fs.unlink(destPath).catch(() => undefined);
    throw new Error('Gateway download wrote an empty file');
  }

  console.info(
    `[Export] pulled ${options.fileName} from gateway (${stat.size} bytes)`
  );
  return destPath;
}
