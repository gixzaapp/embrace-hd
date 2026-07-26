import { Capacitor } from '@capacitor/core';
import { getApiBaseUrl, isBackendEnabled, ApiError } from './apiClient';
import { ensureLocalMediaFile } from './localMediaPath';
import type { HdPresetChoice, HdPresetKey, StatusLengthSec } from '../core';

export type BackendExportRequest = {
  sourceUri: string;
  mimeType?: string;
  preset: HdPresetChoice;
  statusLengthSec: StatusLengthSec;
  /** chat-hd = high-bitrate master for HD→Forward; status = Status-matched */
  delivery?: 'status' | 'chat-hd';
  /** Required — export is authenticated and delivered to this user's WhatsApp */
  authToken: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
};

export type BackendExportResult = {
  /** Always whatsapp for current backend delivery */
  deliveredVia: 'whatsapp';
  preset: HdPresetKey;
  statusLengthSec: StatusLengthSec;
  sizeBytes: number;
  engine: 'backend-ffmpeg';
};

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

/**
 * Upload video to Node backend for FFmpeg convert + WhatsApp delivery.
 * Does not download the result — the MP4 is sent to the user's WhatsApp.
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

  if (!request.authToken?.trim()) {
    throw new ApiError('Sign in required for HD convert', 401);
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
  form.append('delivery', request.delivery ?? 'status');

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
      headers: {
        Authorization: `Bearer ${request.authToken}`,
      },
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
  };

  if (!accepted.jobId) {
    throw new Error('Backend did not return a job id');
  }

  const job = await pollExportJob(base, accepted.jobId, request);
  request.onProgress?.(1);

  return {
    deliveredVia: 'whatsapp',
    preset: (job.preset === '720p' || job.preset === '1080p'
      ? job.preset
      : request.preset === '720p' || request.preset === '1080p'
        ? request.preset
        : '720p') as HdPresetKey,
    statusLengthSec: job.statusLengthSec || request.statusLengthSec,
    sizeBytes: job.sizeBytes || 0,
    engine: 'backend-ffmpeg',
  };
}

type ExportJobPollResponse = {
  jobId: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  error?: string;
  deliveredVia?: 'whatsapp' | 'download';
  preset?: HdPresetChoice;
  statusLengthSec?: StatusLengthSec;
  sizeBytes?: number;
};

async function pollExportJob(
  base: string,
  jobId: string,
  request: BackendExportRequest
): Promise<ExportJobPollResponse> {
  const signal = request.signal;
  const started = Date.now();
  const maxMs = 10 * 60 * 1000;
  let tick = 0.38;

  while (Date.now() - started < maxMs) {
    if (signal?.aborted) {
      throw new DOMException('Export cancelled', 'AbortError');
    }

    const res = await fetch(`${base}/v1/export/jobs/${encodeURIComponent(jobId)}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${request.authToken}`,
      },
      signal,
    });

    if (!res.ok) {
      throw new ApiError(`Export status failed (${res.status})`, res.status);
    }

    const job = (await res.json()) as ExportJobPollResponse;
    tick = Math.min(0.85, tick + 0.02);
    request.onProgress?.(tick);

    if (job.status === 'done') {
      return job;
    }

    if (job.status === 'failed') {
      throw new ApiError(job.error || 'Export failed', 500);
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  throw new ApiError('Export timed out on the server — try a shorter clip', 504);
}
