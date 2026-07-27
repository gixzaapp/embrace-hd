# Embrace HD — Cloudflare upload gateway

Edge upload for users far from Hetzner (e.g. India → Germany).

## Flow

1. App `PUT /upload` → Worker streams body into R2
2. Worker `POST {HETZNER}/v1/export/remote` with `fileName`, `downloadUrl`, export options
3. App polls `{HETZNER}/v1/export/jobs/:jobId`
4. Hetzner `GET {WORKER}/videos/:fileName` with `X-Internal-Secret`, encodes, sends WhatsApp

## Deploy

1. Create an R2 bucket (e.g. `embrace-hd-videos`)
2. Copy `wrangler.toml.example` → `wrangler.toml` and set vars
3. `npx wrangler secret put WORKER_HETZNER_SECRET` (same value on Hetzner)
4. `npx wrangler deploy`
5. Attach a custom domain if desired (`WORKER_PUBLIC_URL`)

## Hetzner env

```env
WORKER_HETZNER_SECRET=<same as wrangler secret>
UPLOAD_GATEWAY_PUBLIC_URL=https://upload.embraceapp.co.uk
```

## App env

```env
VITE_API_BASE_URL=https://api.embraceapp.co.uk
VITE_UPLOAD_GATEWAY_URL=https://upload.embraceapp.co.uk
```

## App request headers on `/upload`

| Header | Example |
|--------|---------|
| `Authorization` | `Bearer <session>` |
| `Content-Type` | `video/mp4` |
| `X-Embrace-Preset` | `auto` |
| `X-Embrace-Status-Length` | `30` |
| `X-Embrace-Delivery` | `status` |
