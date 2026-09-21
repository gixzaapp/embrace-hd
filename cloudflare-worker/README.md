# Embrace HD — Cloudflare upload gateway

Edge upload for users far from Hetzner (e.g. India → Germany).

**Deploy via the Cloudflare dashboard (copy-paste). Do not use Wrangler unless you already know it.**

---

## Deploy Worker (Cloudflare portal) — do this

1. Open Cloudflare dashboard → **Workers & Pages**
2. Open the upload worker (serves `https://upload.embraceapp.co.uk`)
3. Click **Edit code** / **Quick Edit**
4. Select all code in the editor → Delete
5. On your PC open: `cloudflare-worker/upload-gateway.js`
6. Select all → Copy
7. Paste into the Cloudflare editor
8. Click **Deploy** / **Save and Deploy**
9. Open **Settings → Variables**
10. Confirm `WORKER_PUBLIC_URL` = `https://upload.embraceapp.co.uk`
11. Confirm `HETZNER_BASE_URL` = `https://api.embraceapp.co.uk`
12. Confirm secret `WORKER_HETZNER_SECRET` exists (same value as Hetzner)
13. Open **Settings → Bindings**
14. Confirm R2 binding name `VIDEOS` → your videos bucket
15. In a browser open: `https://upload.embraceapp.co.uk/upload/init`
16. Confirm response is **401** (not **404**)

---

## Hetzner API `.env` (must match Worker)

```env
WORKER_HETZNER_SECRET=<same secret as Cloudflare Worker>
UPLOAD_GATEWAY_PUBLIC_URL=https://upload.embraceapp.co.uk
```

Restart the API after changing env.

---

## App `.env` (build machine)

```env
VITE_API_BASE_URL=https://api.embraceapp.co.uk
VITE_UPLOAD_GATEWAY_URL=https://upload.embraceapp.co.uk
```

Then build the Android AAB as usual (`npm run android:aab`).

After `npm run build`, confirm the gateway URL is in the bundle:

```powershell
Select-String -Path dist\assets\*.js -Pattern "upload.embraceapp.co.uk" -SimpleMatch
```

---

## Upload flow

### Small files (≤ ~80 MB)

1. App `PUT /upload` → Worker streams body into R2  
2. Worker `POST {HETZNER}/v1/export/remote`  
3. App polls `{HETZNER}/v1/export/jobs/:jobId`  
4. Hetzner `GET {WORKER}/videos/:fileName` with `X-Internal-Secret`

### Large files (chunked / R2 multipart)

1. `POST /upload/init` → `{ fileName, uploadId }`  
2. `PUT /upload/part?fileName=&uploadId=&partNumber=` (~16 MB chunks)  
3. `POST /upload/complete` → assemble in R2 → notify Hetzner  
4. Same poll / pull as above  

`POST /upload/abort` cancels an in-progress multipart upload.

### Edit recipes

- Mute / crop / trim → gateway (`editRecipe`)  
- Custom music file → direct API upload (gateway cannot carry audio)

---

## Source file

Edit locally: `cloudflare-worker/upload-gateway.js`  
Then paste into the portal (steps above). That is the deployment path.
