/**
 * Embrace HD — Cloudflare Worker upload gateway
 *
 * Flow:
 * 1. App PUT/POST /upload  → stream to R2 (edge-local)
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
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, X-Embrace-Preset, X-Embrace-Status-Length, X-Embrace-Delivery, X-Embrace-X264-Preset',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/upload' && (request.method === 'PUT' || request.method === 'POST')) {
      return withCors(await handleUpload(request, env));
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

async function handleUpload(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !/^Bearer\s+\S+/i.test(authHeader)) {
    return new Response('Missing Authorization header', { status: 401 });
  }

  if (!request.body) {
    return new Response('Missing request body', { status: 400 });
  }

  const url = new URL(request.url);
  const preset = request.headers.get('X-Embrace-Preset') || 'auto';
  const statusLengthRaw = request.headers.get('X-Embrace-Status-Length') || '30';
  const delivery = request.headers.get('X-Embrace-Delivery') || 'status';
  const x264Preset = (
    url.searchParams.get('x264Preset') ||
    request.headers.get('X-Embrace-X264-Preset') ||
    'veryfast'
  ).toLowerCase();
  const editRecipeRaw = url.searchParams.get('editRecipe');
  let editRecipe = null;
  if (editRecipeRaw) {
    try {
      editRecipe = JSON.parse(editRecipeRaw);
      // Gateway cannot carry a music file — drop file mode; Hetzner soft-falls back too.
      if (editRecipe && editRecipe.soundMode === 'file') {
        editRecipe = { ...editRecipe, soundMode: 'mute' };
      }
    } catch {
      // Older / bad clients: ignore recipe, still convert the video.
      console.warn('ignoring invalid editRecipe query');
      editRecipe = null;
    }
  }
  const statusLengthSec = Number(statusLengthRaw);
  if (statusLengthSec !== 30 && statusLengthSec !== 60) {
    return new Response('X-Embrace-Status-Length must be 30 or 60', { status: 400 });
  }
  if (!['auto', '720p', '1080p'].includes(preset)) {
    return new Response('X-Embrace-Preset must be auto, 720p, or 1080p', {
      status: 400,
    });
  }
  if (!['status', 'chat-hd'].includes(delivery)) {
    return new Response('X-Embrace-Delivery must be status or chat-hd', {
      status: 400,
    });
  }
  if (!['veryfast', 'fast', 'slow'].includes(x264Preset)) {
    return new Response(
      'X-Embrace-X264-Preset must be veryfast, fast, or slow',
      { status: 400 }
    );
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

  // Await notify so the app gets a real Hetzner jobId to poll
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
    // Best-effort cleanup so R2 does not keep orphaned blobs
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
    const body = {
      fileName,
      downloadUrl,
      preset,
      statusLengthSec,
      delivery,
      x264Preset,
    };
    if (editRecipe) {
      body.editRecipe = editRecipe;
    }
    const res = await fetch(`${base}/v1/export/remote`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        'X-Internal-Secret': env.WORKER_HETZNER_SECRET,
      },
      body: JSON.stringify(body),
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

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/i.test(fileName)) {
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
