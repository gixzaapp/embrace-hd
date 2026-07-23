import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { getApiBaseUrl, isBackendEnabled, ApiError } from './apiClient';
import { ensureLocalMediaFile } from './localMediaPath';
import { createId, type HdPresetKey, type StatusLengthSec } from '../core';

export type BackendExportRequest = {
  sourceUri: string;
  mimeType?: string;
  preset: HdPresetKey;
  statusLengthSec: StatusLengthSec;
  /** chat-hd = high-bitrate master for HD→Forward; status = Status-matched */
  delivery?: 'status' | 'chat-hd';
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
};

export type BackendExportResult = {
  localUri: string;
  preset: HdPresetKey;
  statusLengthSec: StatusLengthSec;
  sizeBytes: number;
  engine: 'backend-ffmpeg';
};

type ExportJobResponse = {
  jobId: string;
  filename: string;
  downloadPath: string;
  preset: HdPresetKey;
  statusLengthSec: StatusLengthSec;
  sizeBytes: number;
};

/** Keep Capacitor bridge messages small — full-file base64 OOMs the WebView. */
const BRIDGE_CHUNK_BYTES = 256 * 1024;

async function uriToBlob(uri: string): Promise<Blob> {
  const local = await ensureLocalMediaFile(uri);
  const src = Capacitor.isNativePlatform()
    ? Capacitor.convertFileSrc(local)
    : local;

  const res = await fetch(src);
  if (!res.ok) {
    throw new Error('Could not read video for upload');
  }
  return res.blob();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** Write a large blob via small appendFile chunks (native only). */
async function writeBlobChunked(
  blob: Blob,
  path: string,
  directory: Directory
): Promise<string> {
  await Filesystem.writeFile({
    path,
    data: '',
    directory,
    recursive: true,
  });

  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  for (let offset = 0; offset < bytes.length; offset += BRIDGE_CHUNK_BYTES) {
    const slice = bytes.subarray(
      offset,
      Math.min(offset + BRIDGE_CHUNK_BYTES, bytes.length)
    );
    await Filesystem.appendFile({
      path,
      data: bytesToBase64(slice),
      directory,
    });
  }

  const got = await Filesystem.getUri({ path, directory });
  return got.uri;
}

/**
 * Persist exported MP4 without pushing a giant base64 string through Capacitor.
 * Prefer native Filesystem.downloadFile; fall back to chunked append.
 */
async function persistExportedMp4(
  downloadUrl: string,
  sizeHint?: number
): Promise<string> {
  const filename = `embraceHD_srv_${createId('exp')}.mp4`;
  const path = `EmbraceHD/${filename}`;

  await Filesystem.mkdir({
    path: 'EmbraceHD',
    directory: Directory.Cache,
    recursive: true,
  }).catch(() => undefined);

  if (!Capacitor.isNativePlatform()) {
    const res = await fetch(downloadUrl);
    if (!res.ok) {
      throw new Error(`Download failed (${res.status})`);
    }
    const blob = await res.blob();
    if (!blob.size) {
      throw new Error('Backend returned an empty video');
    }
    return URL.createObjectURL(blob);
  }

  try {
    const downloaded = await Filesystem.downloadFile({
      url: downloadUrl,
      path,
      directory: Directory.Cache,
      recursive: true,
    });
    if (downloaded.path) {
      const got = await Filesystem.getUri({
        path,
        directory: Directory.Cache,
      });
      return got.uri;
    }
  } catch (err) {
    console.warn('[export] downloadFile failed, using chunked write', err);
  }

  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  const blob = await res.blob();
  if (!blob.size && !sizeHint) {
    throw new Error('Backend returned an empty video');
  }
  return writeBlobChunked(blob, path, Directory.Cache);
}

/**
 * Upload video to Node backend for high-quality WhatsApp HD FFmpeg export.
 */
export async function exportViaBackend(
  request: BackendExportRequest
): Promise<BackendExportResult> {
  if (!isBackendEnabled()) {
    throw new ApiError('Backend export is disabled', 0);
  }

  const base = getApiBaseUrl();
  if (!base) {
    throw new ApiError('VITE_API_BASE_URL is not set', 0);
  }

  const signal = request.signal;
  if (signal?.aborted) {
    throw new DOMException('Export cancelled', 'AbortError');
  }

  request.onProgress?.(0.05);
  const blob = await uriToBlob(request.sourceUri);
  if (signal?.aborted) {
    throw new DOMException('Export cancelled', 'AbortError');
  }

  request.onProgress?.(0.2);
  const form = new FormData();
  form.append('video', blob, 'input.mp4');
  form.append('preset', request.preset);
  form.append('statusLengthSec', String(request.statusLengthSec));
  form.append('delivery', request.delivery ?? 'chat-hd');

  // Soft progress while server encodes (fetch has no mid-body progress).
  let tick = 0.22;
  const pulse = window.setInterval(() => {
    tick = Math.min(0.72, tick + 0.03);
    request.onProgress?.(tick);
  }, 700);

  let res: Response;
  try {
    res = await fetch(`${base}/v1/export`, {
      method: 'POST',
      body: form,
      signal,
    });
  } finally {
    window.clearInterval(pulse);
  }

  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore
    }
    throw new ApiError(message, res.status);
  }

  request.onProgress?.(0.35);
  const accepted = (await res.json()) as {
    jobId?: string;
    status?: string;
    statusPath?: string;
    // Legacy sync response (older backends)
    filename?: string;
    downloadPath?: string;
    preset?: HdPresetKey;
    statusLengthSec?: StatusLengthSec;
    sizeBytes?: number;
  };

  let job: ExportJobResponse;

  // New async API: 202 + poll until done (avoids ALB/CloudFront 60s 504).
  if (accepted.jobId && (res.status === 202 || accepted.statusPath || !accepted.downloadPath)) {
    job = await pollExportJob(base, accepted.jobId, request);
  } else if (accepted.downloadPath && accepted.filename) {
    job = accepted as ExportJobResponse;
  } else {
    throw new Error('Backend did not return a download path or job id');
  }

  if (signal?.aborted) {
    throw new DOMException('Export cancelled', 'AbortError');
  }

  request.onProgress?.(0.78);
  const downloadUrl = `${base}${job.downloadPath.startsWith('/') ? '' : '/'}${job.downloadPath}`;
  const localUri = await persistExportedMp4(downloadUrl, job.sizeBytes);
  request.onProgress?.(1);

  return {
    localUri,
    preset: job.preset || request.preset,
    statusLengthSec: job.statusLengthSec || request.statusLengthSec,
    sizeBytes: job.sizeBytes || 0,
    engine: 'backend-ffmpeg',
  };
}

type ExportJobPollResponse = {
  jobId: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  error?: string;
  filename?: string;
  downloadPath?: string;
  preset?: HdPresetKey;
  statusLengthSec?: StatusLengthSec;
  sizeBytes?: number;
};

async function pollExportJob(
  base: string,
  jobId: string,
  request: BackendExportRequest
): Promise<ExportJobResponse> {
  const signal = request.signal;
  const started = Date.now();
  const maxMs = 10 * 60 * 1000; // 10 min encode budget
  let tick = 0.38;

  while (Date.now() - started < maxMs) {
    if (signal?.aborted) {
      throw new DOMException('Export cancelled', 'AbortError');
    }

    const res = await fetch(`${base}/v1/export/jobs/${encodeURIComponent(jobId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });

    if (!res.ok) {
      throw new ApiError(`Export status failed (${res.status})`, res.status);
    }

    const job = (await res.json()) as ExportJobPollResponse;
    tick = Math.min(0.72, tick + 0.02);
    request.onProgress?.(tick);

    if (job.status === 'done') {
      if (!job.downloadPath || !job.filename) {
        throw new Error('Export finished without a download path');
      }
      return {
        jobId: job.jobId,
        filename: job.filename,
        downloadPath: job.downloadPath,
        preset: job.preset || request.preset,
        statusLengthSec: job.statusLengthSec || request.statusLengthSec,
        sizeBytes: job.sizeBytes || 0,
      };
    }

    if (job.status === 'failed') {
      throw new ApiError(job.error || 'Export failed', 500);
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  throw new ApiError('Export timed out on the server — try a shorter clip', 504);
}
