import { Capacitor } from '@capacitor/core';
import { getApiBaseUrl, isBackendEnabled, ApiError } from './apiClient';
import { ensureLocalMediaFile } from './localMediaPath';
import type { HdPresetChoice, HdPresetKey, StatusLengthSec } from '../core';
import type { EncodeQualityChoice } from './encodeQuality';
import {
  hasMeaningfulEditRecipe,
  toEditRecipeWire,
  type EditRecipe,
} from './editRecipe';
import { fetchRemoteConfig } from './backendEntitlements';

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
  /** Crop/trim/sound (applied on server when supported) */
  editRecipe?: EditRecipe;
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
  /** True when edits were requested but the server/path could not apply them. */
  editsDropped?: boolean;
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

let editRecipeSupportCache:
  | { at: number; supported: boolean }
  | null = null;

/** Newer servers advertise featureFlags.editRecipe; older configs omit it. */
async function serverSupportsEditRecipe(): Promise<boolean> {
  const now = Date.now();
  if (editRecipeSupportCache && now - editRecipeSupportCache.at < 5 * 60_000) {
    return editRecipeSupportCache.supported;
  }
  try {
    const config = await fetchRemoteConfig();
    const supported = config.featureFlags?.editRecipe === true;
    editRecipeSupportCache = { at: now, supported };
    return supported;
  } catch {
    // Unknown — try with recipe; upload path has its own retry.
    return true;
  }
}

function looksLikeLegacyExportRejection(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 404 || err.status === 413) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    err.status === 400 ||
    err.status === 415 ||
    /unexpected field|unknown|editrecipe|music|multipart|limit_unexpected|not allowed|invalid export/i.test(
      msg
    )
  );
}

/**
 * Upload video for FFmpeg convert + WhatsApp delivery.
 * When VITE_UPLOAD_GATEWAY_URL is set, streams to Cloudflare (edge) then polls Hetzner.
 * Otherwise uploads multipart directly to the API (fine for LAN / nearby regions).
 *
 * Backward compatible:
 * - Omits editRecipe when the server does not advertise support (or recipe is no-op).
 * - Meaningful edits always use direct multipart (so an old gateway cannot drop them).
 * - If an older server rejects music/editRecipe fields, retries without edits.
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

  const wantsEdits = hasMeaningfulEditRecipe(request.editRecipe);
  let activeRecipe =
    wantsEdits && request.editRecipe ? request.editRecipe : undefined;
  let editsDropped = false;

  if (wantsEdits) {
    const supported = await serverSupportsEditRecipe();
    if (!supported) {
      activeRecipe = undefined;
      editsDropped = true;
      console.warn(
        '[Export] server lacks featureFlags.editRecipe — converting without edits'
      );
    }
  }

  const gateway = getUploadGatewayUrl();
  const needsMusicFile =
    activeRecipe?.soundMode === 'file' && !!activeRecipe.musicUri;
  // Meaningful edits → direct multipart so older gateways cannot strip the recipe.
  const preferGateway = Boolean(gateway) && !needsMusicFile && !activeRecipe;

  const runUpload = (recipe: EditRecipe | undefined) => {
    const req: BackendExportRequest = { ...request, editRecipe: recipe };
    return preferGateway && gateway
      ? uploadViaGateway(gateway, blob, req)
      : uploadDirect(base, blob, req);
  };

  let accepted: { jobId?: string };
  try {
    accepted = await runUpload(activeRecipe);
  } catch (err) {
    if (
      activeRecipe &&
      looksLikeLegacyExportRejection(err) &&
      !(err instanceof DOMException && err.name === 'AbortError')
    ) {
      console.warn(
        '[Export] server rejected editRecipe/music — retrying without edits',
        err
      );
      activeRecipe = undefined;
      editsDropped = true;
      // Force direct without recipe (matches legacy clients)
      accepted = await uploadDirect(base, blob, {
        ...request,
        editRecipe: undefined,
      });
    } else {
      throw err;
    }
  }

  if (!accepted.jobId) {
    throw new Error('Backend did not return a job id');
  }

  report(request, 'upload', 1);
  report(request, 'convert', 0);
  const job = await pollExportJob(base, accepted.jobId, request);
  report(request, 'convert', 1);

  report(request, 'send', 0);
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
    editsDropped: editsDropped || undefined,
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
    const x264 = request.x264Preset ?? 'veryfast';
    const recipeWire =
      request.editRecipe && hasMeaningfulEditRecipe(request.editRecipe)
        ? toEditRecipeWire(request.editRecipe)
        : undefined;
    // Quality + editRecipe via query — avoids CORS Allow-Headers churn.
    const params = new URLSearchParams({ x264Preset: x264 });
    if (recipeWire) {
      params.set('editRecipe', JSON.stringify(recipeWire));
    }
    const uploadUrl = `${gatewayBase}/upload?${params.toString()}`;
    res = await fetch(uploadUrl, {
      method: 'PUT',
      body: blob,
      signal: request.signal,
      headers: {
        Authorization: `Bearer ${request.authToken}`,
        'Content-Type': request.mimeType || 'video/mp4',
        'X-Embrace-Preset': request.preset,
        'X-Embrace-Status-Length': String(request.statusLengthSec),
        'X-Embrace-Delivery': request.delivery ?? 'status',
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    const detail = err instanceof Error ? err.message : 'Upload failed';
    throw new ApiError(
      /failed to fetch|networkerror|load failed/i.test(detail)
        ? 'Upload failed — check network, or redeploy the upload gateway'
        : detail,
      0
    );
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
  if (request.editRecipe && hasMeaningfulEditRecipe(request.editRecipe)) {
    form.append(
      'editRecipe',
      JSON.stringify(toEditRecipeWire(request.editRecipe))
    );
  }
  if (
    request.editRecipe?.soundMode === 'file' &&
    request.editRecipe.musicUri
  ) {
    const musicBlob = await uriToBlob(request.editRecipe.musicUri);
    const musicName =
      request.editRecipe.musicName?.replace(/[^\w.\-]+/g, '_') || 'music.mp3';
    form.append('music', musicBlob, musicName);
  }

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
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    const detail = err instanceof Error ? err.message : 'Export failed';
    throw new ApiError(
      /failed to fetch|networkerror|load failed/i.test(detail)
        ? 'Could not reach the server — check your connection'
        : detail,
      0
    );
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
    }).catch((err) => {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new ApiError('Lost connection while converting — check your network', 0);
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
