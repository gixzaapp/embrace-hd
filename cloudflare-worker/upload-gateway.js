/**
 * Embrace HD — Cloudflare Worker upload gateway
 *
 * Flow:
 * 1a. App PUT/POST /upload  → stream to R2 (small files, Free/Pro ≤ ~100 MB body)
 * 1b. App multipart: POST /upload/init → PUT /upload/part → POST /upload/complete
 * 2. Worker POSTs /v1/export/remote on Hetzner with downloadUrl + options
 * 3. App polls Hetzner GET /v1/export/jobs/:jobId
 * 4. Hetzner GET /videos/:fileName (X-Internal-Secret) to pull the file
 *
 * Wrangler bindings / vars:
 *   VIDEOS                  R2 bucket
 *   WORKER_PUBLIC_URL       e.g. https://upload.embraceapp.co.uk
 *   HETZNER_BASE_URL        e.g. https://api.embraceapp.co.uk
 *   WORKER_HETZNER_SECRET   shared with Hetzner WORKER_HETZNER_SECRET
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, X-Embrace-Preset, X-Embrace-Status-Length, X-Embrace-Delivery, X-Embrace-X264-Preset',
  'Access-Control-Max-Age': '86400',
};

const SAFE_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/i;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/upload' && (request.method === 'PUT' || request.method === 'POST')) {
      return withCors(await handleUpload(request, env));
    }

    if (url.pathname === '/upload/init' && request.method === 'POST') {
      return withCors(await handleMultipartInit(request, env));
    }

    if (url.pathname === '/upload/part' && request.method === 'PUT') {
      return withCors(await handleMultipartPart(request, env, url));
    }

    if (url.pathname === '/upload/complete' && request.method === 'POST') {
      return withCors(await handleMultipartComplete(request, env));
    }

    if (url.pathname === '/upload/abort' && request.method === 'POST') {
      return withCors(await handleMultipartAbort(request, env));
    }

    const match = url.pathname.match(/^\/videos\/([^/]+)$/);
    if (match && request.method === 'GET') {
      return handleFetch(match[1], request, env);
    }

    return withCors(new Response('Not found', { status: 404 }));
  },
};

function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function requireBearer(request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !/^Bearer\s+\S+/i.test(authHeader)) {
    return { ok: false, response: new Response('Missing Authorization header', { status: 401 }) };
  }
  return { ok: true, authHeader };
}

function parseEditRecipe(raw) {
  if (!raw) return null;
  try {
    const editRecipe = JSON.parse(raw);
    // Gateway cannot carry a music file — drop file mode; Hetzner soft-falls back too.
    if (editRecipe && editRecipe.soundMode === 'file') {
      return { ...editRecipe, soundMode: 'mute' };
    }
    return editRecipe;
  } catch {
    console.warn('ignoring invalid editRecipe');
    return null;
  }
}

function validateExportOptions({ preset, statusLengthSec, delivery, x264Preset }) {
  if (statusLengthSec !== 30 && statusLengthSec !== 60) {
    return 'statusLengthSec must be 30 or 60';
  }
  if (!['auto', '720p', '1080p'].includes(preset)) {
    return 'preset must be auto, 720p, or 1080p';
  }
  if (!['status', 'chat-hd'].includes(delivery)) {
    return 'delivery must be status or chat-hd';
  }
  if (!['veryfast', 'fast', 'slow'].includes(x264Preset)) {
    return 'x264Preset must be veryfast, fast, or slow';
  }
  return null;
}

async function finishUploadAndNotify({
  fileName,
  authHeader,
  env,
  preset,
  statusLengthSec,
  delivery,
  x264Preset,
  editRecipe,
}) {
  const notified = await notifyHetzner({
    fileName,
    authHeader,
    env,
    preset,
    statusLengthSec,
    delivery,
    x264Preset,
    editRecipe,
  });

  if (!notified.ok) {
    try {
      await env.VIDEOS.delete(fileName);
    } catch {
      // ignore
    }
    return new Response(notified.error || 'Hetzner notify failed', {
      status: notified.status || 502,
    });
  }

  return Response.json({
    fileName,
    jobId: notified.jobId,
    status: notified.status || 'queued',
    statusPath: notified.statusPath,
  });
}

async function handleUpload(request, env) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;

  if (!request.body) {
    return new Response('Missing request body', { status: 400 });
  }

  const url = new URL(request.url);
  const preset = request.headers.get('X-Embrace-Preset') || 'auto';
  const statusLengthSec = Number(
    request.headers.get('X-Embrace-Status-Length') || '30'
  );
  const delivery = request.headers.get('X-Embrace-Delivery') || 'status';
  const x264Preset = (
    url.searchParams.get('x264Preset') ||
    request.headers.get('X-Embrace-X264-Preset') ||
    'veryfast'
  ).toLowerCase();
  const editRecipe = parseEditRecipe(url.searchParams.get('editRecipe'));

  const optionError = validateExportOptions({
    preset,
    statusLengthSec,
    delivery,
    x264Preset,
  });
  if (optionError) {
    return new Response(optionError, { status: 400 });
  }

  const fileName = crypto.randomUUID() + '.mp4';
  const contentType = request.headers.get('Content-Type') || 'video/mp4';

  try {
    await env.VIDEOS.put(fileName, request.body, {
      httpMetadata: { contentType },
      customMetadata: {
        preset,
        statusLengthSec: String(statusLengthSec),
        delivery,
        x264Preset,
      },
    });
  } catch (err) {
    console.error('R2 write failed for', fileName, err);
    return new Response('Upload failed', { status: 502 });
  }

  return finishUploadAndNotify({
    fileName,
    authHeader: auth.authHeader,
    env,
    preset,
    statusLengthSec,
    delivery,
    x264Preset,
    editRecipe,
  });
}

/** Start R2 multipart upload (for files that would exceed CF ~100 MB body limit). */
async function handleMultipartInit(request, env) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;

  const contentType =
    request.headers.get('Content-Type') || 'application/json';
  let mimeType = 'video/mp4';
  if (contentType.includes('application/json')) {
    try {
      const body = await request.json();
      if (body?.mimeType && typeof body.mimeType === 'string') {
        mimeType = body.mimeType;
      }
    } catch {
      // optional body
    }
  }

  const fileName = crypto.randomUUID() + '.mp4';
  try {
    const multipart = await env.VIDEOS.createMultipartUpload(fileName, {
      httpMetadata: { contentType: mimeType },
    });
    return Response.json({
      fileName,
      uploadId: multipart.uploadId,
    });
  } catch (err) {
    console.error('multipart init failed', err);
    return new Response('Could not start multipart upload', { status: 502 });
  }
}

async function handleMultipartPart(request, env, url) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;

  const fileName = url.searchParams.get('fileName') || '';
  const uploadId = url.searchParams.get('uploadId') || '';
  const partNumber = Number(url.searchParams.get('partNumber') || '0');

  if (!SAFE_FILE.test(fileName)) {
    return new Response('Invalid fileName', { status: 400 });
  }
  if (!uploadId) {
    return new Response('Missing uploadId', { status: 400 });
  }
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    return new Response('Invalid partNumber', { status: 400 });
  }
  if (!request.body) {
    return new Response('Missing request body', { status: 400 });
  }

  try {
    const multipart = env.VIDEOS.resumeMultipartUpload(fileName, uploadId);
    const uploaded = await multipart.uploadPart(partNumber, request.body);
    return Response.json({
      partNumber: uploaded.partNumber,
      etag: uploaded.etag,
    });
  } catch (err) {
    console.error('multipart part failed', fileName, partNumber, err);
    return new Response(
      err instanceof Error ? err.message : 'Part upload failed',
      { status: 400 }
    );
  }
}

async function handleMultipartComplete(request, env) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const fileName = String(body.fileName || '');
  const uploadId = String(body.uploadId || '');
  const parts = Array.isArray(body.parts) ? body.parts : null;
  const preset = body.preset || 'auto';
  const statusLengthSec = Number(body.statusLengthSec || 30);
  const delivery = body.delivery || 'status';
  const x264Preset = String(body.x264Preset || 'veryfast').toLowerCase();
  const editRecipe =
    body.editRecipe != null
      ? parseEditRecipe(JSON.stringify(body.editRecipe))
      : null;

  if (!SAFE_FILE.test(fileName)) {
    return new Response('Invalid fileName', { status: 400 });
  }
  if (!uploadId) {
    return new Response('Missing uploadId', { status: 400 });
  }
  if (!parts || parts.length === 0) {
    return new Response('Missing parts', { status: 400 });
  }

  const optionError = validateExportOptions({
    preset,
    statusLengthSec,
    delivery,
    x264Preset,
  });
  if (optionError) {
    return new Response(optionError, { status: 400 });
  }

  const normalizedParts = parts.map((p) => ({
    partNumber: Number(p.partNumber),
    etag: String(p.etag || ''),
  }));

  if (
    normalizedParts.some(
      (p) =>
        !Number.isInteger(p.partNumber) ||
        p.partNumber < 1 ||
        !p.etag
    )
  ) {
    return new Response('Invalid parts list', { status: 400 });
  }

  try {
    const multipart = env.VIDEOS.resumeMultipartUpload(fileName, uploadId);
    await multipart.complete(normalizedParts);
  } catch (err) {
    console.error('multipart complete failed', fileName, err);
    try {
      const multipart = env.VIDEOS.resumeMultipartUpload(fileName, uploadId);
      await multipart.abort();
    } catch {
      // ignore
    }
    return new Response(
      err instanceof Error ? err.message : 'Could not complete upload',
      { status: 400 }
    );
  }

  return finishUploadAndNotify({
    fileName,
    authHeader: auth.authHeader,
    env,
    preset,
    statusLengthSec,
    delivery,
    x264Preset,
    editRecipe,
  });
}

async function handleMultipartAbort(request, env) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const fileName = String(body.fileName || '');
  const uploadId = String(body.uploadId || '');
  if (!SAFE_FILE.test(fileName) || !uploadId) {
    return new Response('Invalid fileName or uploadId', { status: 400 });
  }

  try {
    const multipart = env.VIDEOS.resumeMultipartUpload(fileName, uploadId);
    await multipart.abort();
  } catch (err) {
    console.warn('multipart abort failed', fileName, err);
  }

  return new Response(null, { status: 204 });
}

async function notifyHetzner({
  fileName,
  authHeader,
  env,
  preset,
  statusLengthSec,
  delivery,
  x264Preset,
  editRecipe,
}) {
  const base = String(env.HETZNER_BASE_URL || '').replace(/\/$/, '');
  const publicBase = String(env.WORKER_PUBLIC_URL || '').replace(/\/$/, '');
  if (!base || !publicBase) {
    return { ok: false, status: 500, error: 'Worker misconfigured' };
  }

  const downloadUrl = `${publicBase}/videos/${fileName}`;

  try {
    const payload = {
      fileName,
      downloadUrl,
      preset,
      statusLengthSec,
      delivery,
      x264Preset,
    };
    if (editRecipe) {
      payload.editRecipe = editRecipe;
    }
    const res = await fetch(`${base}/v1/export/remote`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        'X-Internal-Secret': env.WORKER_HETZNER_SECRET,
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      // non-JSON error body
    }

    if (!res.ok) {
      console.error('Hetzner notify failed', fileName, res.status, text);
      return {
        ok: false,
        status: res.status,
        error: data.error || text || `Hetzner notify failed (${res.status})`,
      };
    }

    if (!data.jobId) {
      return { ok: false, status: 502, error: 'Hetzner did not return jobId' };
    }

    return {
      ok: true,
      jobId: data.jobId,
      status: data.status,
      statusPath: data.statusPath,
    };
  } catch (err) {
    console.error('Hetzner notify threw', fileName, err);
    return { ok: false, status: 502, error: 'Hetzner notify threw' };
  }
}

async function handleFetch(fileName, request, env) {
  const secret = request.headers.get('X-Internal-Secret');
  if (secret !== env.WORKER_HETZNER_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!SAFE_FILE.test(fileName)) {
    return new Response('Not found', { status: 404 });
  }

  const object = await env.VIDEOS.get(fileName);
  if (!object) {
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'private, no-store');

  return new Response(object.body, { headers });
}
