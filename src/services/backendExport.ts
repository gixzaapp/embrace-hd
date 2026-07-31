import { Capacitor } from '@capacitor/core';
import { getApiBaseUrl, isBackendEnabled, ApiError } from './apiClient';
import { ensureLocalMediaFile } from './localMediaPath';
import type { HdPresetChoice, HdPresetKey, StatusLengthSec } from '../core';
import type { EncodeQualityChoice } from './encodeQuality';

/** Progress is 0–1 within the current phase (each phase starts at 0). */
export type ConvertPhase = 'upload' | 'convert' | 'send';

export type ConvertProgressUpdate = {
  phase: ConvertPhase;
  progress: number;
};

export type BackendExportRequest = {
  sourceUri: string;
  mimeType?: string;
  preset: HdPresetChoice;
  statusLengthSec: StatusLengthSec;
  /** chat-hd = high-bitrate master for HD→Forward; status = Status-matched */
  delivery?: 'status' | 'chat-hd';
  /** FFmpeg x264 -preset (speed / quality) */
  x264Preset?: EncodeQualityChoice;
  /** Required — export is authenticated and delivered to this user's WhatsApp */
  authToken: string;
  signal?: AbortSignal;
  onProgress?: (update: ConvertProgressUpdate) => void;
};

export type BackendExportResult = {
  /** Always whatsapp for current backend delivery */
  deliveredVia: 'whatsapp';
  preset: HdPresetKey;
  statusLengthSec: StatusLengthSec;
  sizeBytes: number;
  engine: 'backend-ffmpeg';
};

function getUploadGatewayUrl(): string | null {
  const raw = import.meta.env.VITE_UPLOAD_GATEWAY_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, '');
}

function report(
  request: BackendExportRequest,
  phase: ConvertPhase,
  progress: number
): void {
  request.onProgress?.({
    phase,
    progress: Math.min(1, Math.max(0, progress)),
  });
}

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
 * Upload video for FFmpeg convert + WhatsApp delivery.
 * When VITE_UPLOAD_GATEWAY_URL is set, streams to Cloudflare (edge) then polls Hetzner.
 * Otherwise uploads multipart directly to the API (fine for LAN / nearby regions).
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

  report(request, 'upload', 0);
  const blob = await uriToBlob(request.sourceUri);
  if (signal?.aborted) {
    throw new DOMException('Export cancelled', 'AbortError');
  }
  report(request, 'upload', 0.2);

  const gateway = getUploadGatewayUrl();
  const accepted = gateway
    ? await uploadViaGateway(gateway, blob, request)
    : await uploadDirect(base, blob, request);

  if (!accepted.jobId) {
    throw new Error('Backend did not return a job id');
  }

  report(request, 'upload', 1);
  report(request, 'convert', 0);
  const job = await pollExportJob(base, accepted.jobId, request);
  report(request, 'convert', 1);

  report(request, 'send', 0);
  // Delivery already finished on the server when job is done — brief send phase for UX.
  report(request, 'send', 1);

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

async function uploadViaGateway(
  gatewayBase: string,
  blob: Blob,
  request: BackendExportRequest
): Promise<{ jobId?: string }> {
  report(request, 'upload', 0.25);

  let tick = 0.3;
  const pulse = window.setInterval(() => {
    tick = Math.min(0.95, tick + 0.05);
    report(request, 'upload', tick);
  }, 700);

  let res: Response;
  try {
    res = await fetch(`${gatewayBase}/upload`, {
      method: 'PUT',
      body: blob,
      signal: request.signal,
      headers: {
        Authorization: `Bearer ${request.authToken}`,
        'Content-Type': request.mimeType || 'video/mp4',
        'X-Embrace-Preset': request.preset,
        'X-Embrace-Status-Length': String(request.statusLengthSec),
        'X-Embrace-Delivery': request.delivery ?? 'status',
        'X-Embrace-X264-Preset': request.x264Preset ?? 'veryfast',
      },
    });
  } finally {
    window.clearInterval(pulse);
  }

  if (!res.ok) {
    let message = `Upload failed (${res.status})`;
    try {
      const text = await res.text();
      if (text) {
        try {
          const data = JSON.parse(text) as { error?: string };
          message = data.error || text.slice(0, 200);
        } catch {
          message = text.slice(0, 200);
        }
      }
    } catch {
      // ignore
    }
    throw new ApiError(message, res.status);
  }

  return (await res.json()) as { jobId?: string; fileName?: string };
}

async function uploadDirect(
  apiBase: string,
  blob: Blob,
  request: BackendExportRequest
): Promise<{ jobId?: string }> {
  report(request, 'upload', 0.25);
  const form = new FormData();
  form.append('video', blob, 'input.mp4');
  form.append('preset', request.preset);
  form.append('statusLengthSec', String(request.statusLengthSec));
  form.append('delivery', request.delivery ?? 'status');
  form.append('x264Preset', request.x264Preset ?? 'veryfast');

  let tick = 0.3;
  const pulse = window.setInterval(() => {
    tick = Math.min(0.95, tick + 0.05);
    report(request, 'upload', tick);
  }, 700);

  let res: Response;
  try {
    res = await fetch(`${apiBase}/v1/export`, {
      method: 'POST',
      body: form,
      signal: request.signal,
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

  return (await res.json()) as { jobId?: string };
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
  let tick = 0.05;

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
    tick = Math.min(0.95, tick + 0.04);
    report(request, 'convert', tick);

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
