# Embrace HD Backend

Node.js (Express + TypeScript) API for **WhatsApp OTP auth**, **subscription verification**, **remote app config**, **server-side trial claims**, and **WhatsApp HD video export (FFmpeg)**.

## Quick start

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

From the repo root:

```bash
npm run backend
```

Server listens on `http://localhost:8787` by default.

**Production (Hetzner):** see [Deploy to Hetzner](#deploy-to-hetzner-recommended) — Docker Compose + Caddy.

## Environment

| Variable | Description |
|----------|-------------|
| `PORT` | Listen port (default `8787`) |
| `REVENUECAT_SECRET_API_KEY` | RevenueCat **secret** key (optional for export) |
| `CORS_ORIGINS` | `*` or comma-separated origins |
| `DATA_DIR` | JSON + upload/export directory (default `./data`) |
| `WHATSAPP_TOKEN` | Meta WhatsApp Cloud API access token (optional) |
| `WHATSAPP_PHONE_NUMBER_ID` | Cloud API phone number ID (optional; pair with token) |
| `WHATSAPP_VERIFY_TOKEN` | String you set in Meta for webhook verification (`hub.verify_token`) |
| `WHATSAPP_OTP_TEMPLATE` | Approved authentication template name for business-initiated OTP (empty → free-form text) |
| `WHATSAPP_OTP_TEMPLATE_LANG` | Template language code (default `en_US`) |
| `WHATSAPP_OTP_TEMPLATE_HAS_BUTTON` | `false` if the template has no copy-code button (default `true`) |
| `WHATSAPP_BUSINESS_E164` | Public business number (E.164) for `wa.me` deep links when opening a chat |
| `AUTH_OTP_TTL_SEC` | OTP lifetime in seconds (default `300`) |
| `SESSION_TTL_DAYS` | Session token lifetime in days (default `30`) |
| `AUTH_ALLOW_OTP_HINT` | When `true` (default), mock OTP responses may include `otpHint` for local testing. Set `false` in production. |
| `AUTH_TEST_OTP` | Fixed OTP that always verifies (e.g. `123456`) — **testing only**, leave empty in production. |
| `REQUEST_LOG_INTERVAL_SEC` | Request-count log interval in seconds (default `60`, `0` disables) |
| `STORAGE_DRIVER` | `file` \| `dynamodb` \| `postgres` (use `postgres` on Hetzner) |
| `PHONE_DATA_KEY` | **Required.** 32-byte hex (64 chars) master key for AES-256-GCM encryption of WhatsApp numbers at rest + HMAC blind index. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep secret; rotating without re-encrypt breaks lookups. |
| `DB_HOST` | Postgres host (`localhost` on host; `host.docker.internal` from Compose) |
| `DB_PORT` | Postgres port (default `5432`) |
| `DB_NAME` | Database name |
| `DB_USER` | Database user |
| `DB_PASSWORD` | Database password |
| `AWS_REGION` | Region for DynamoDB (when using dynamodb) |
| `DDB_TABLE` | DynamoDB table name (default `embrace-hd`) |
| `DDB_ENDPOINT` | Optional custom endpoint (e.g. DynamoDB Local) |
| `API_DOMAIN` | Public hostname for Caddy HTTPS (Docker Compose / Hetzner) |
| `FFMPEG_X264_PRESET` | x264 speed preset (default `veryfast`) |

### WhatsApp OTP delivery

- **App flow (direct):** user enters their WhatsApp number → app calls `POST /v1/auth/request-otp` → backend generates a hashed OTP and sends it via the [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api). User enters the code → app calls `POST /v1/auth/verify-otp` → backend authorizes (session token) or rejects.
- Phone numbers are **encrypted at rest** (`PHONE_DATA_KEY` → AES-256-GCM) and looked up via an HMAC blind index. They are decrypted only in memory when sending WhatsApp messages.
- When **both** `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are set, OTPs are sent live. Otherwise the backend uses **mock** mode: the OTP is logged server-side and, if `AUTH_ALLOW_OTP_HINT` is enabled, returned as `otpHint` in the `request-otp` response (non-production testing).
- **Business-initiated sends need an approved authentication template.** Set `WHATSAPP_OTP_TEMPLATE` to your approved template name. Without a template, free-form text is attempted but is only delivered inside the 24h customer-care window (after the user has messaged you).
- The optional `POST /v1/whatsapp/webhook` (Enroll me / Login Me) is still available but no longer required for the direct app flow.

## Endpoints

### `GET /health`
`{ "ok": true }`

### Auth (`/v1/auth`)

Phone is the account id (E.164). Both **Login** and **Register** use the direct OTP flow: enter number → backend sends OTP on WhatsApp → verify.

| Method | Path | Body / notes |
|--------|------|----------------|
| `POST` | `/v1/auth/request-otp` | `{ "phone", "mode": "login"\|"register", "name?", "deviceId?" }` — register requires `name`; sends OTP via WhatsApp; may return `otpHint` in mock |
| `POST` | `/v1/auth/verify-otp` | `{ "phone", "code", "deviceId?" }` → `{ token, expiresAt, user }` |
| `GET` | `/v1/auth/me` | `Authorization: Bearer <token>` |
| `POST` | `/v1/auth/logout` | `Authorization: Bearer <token>` |

OTP: 6 digits, hashed at rest, ~5 min TTL, max 5 attempts.

### WhatsApp webhook (`/v1/whatsapp`) — optional

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/v1/whatsapp/webhook` | Meta subscribe challenge (`hub.verify_token` must match `WHATSAPP_VERIFY_TOKEN`) |
| `POST` | `/v1/whatsapp/webhook` | Inbound messages refresh the 24h window; `Enroll me` / `Login Me` → OTP |
| `GET` | `/v1/whatsapp/conversation-window` | Auth required — whether the user's 24h Cloud API window is open |

### `GET /v1/config`
Remote app configuration (edit `data/config.json`).

### `POST /v1/subscription/verify`
Body: `{ "appUserId": "<id>" }`

### `POST /v1/trial/claim`
Body: `{ "deviceId": "<stable-id>" }`

### `GET /v1/entitlements?deviceId=&appUserId=`
Merged trial + subscription + entitlement flags.

### `POST /v1/export` (WhatsApp HD)
`multipart/form-data`:
- `video` — input video file
- `preset` — `720p` | `1080p` (chat-hd uses the same reference profile for both)
- `statusLengthSec` — `30` | `60`
- `delivery` — `chat-hd` (default) | `status`

Returns **202** immediately: `{ jobId, status, statusPath, … }` while FFmpeg runs in the
background (avoids ALB/CloudFront **60s idle timeout → 504**).

Poll `GET /v1/export/jobs/:jobId` until `status` is `done` or `failed`.
When done, download via `downloadPath` → `GET /v1/export/:filename`.

Both deliveries use a **Clideo-style WhatsApp Status** encode
([Clideo WhatsApp compressor](https://clideo.com/compress-video-for-whatsapp)):

- **720×1280** or **1080×1920** (9:16) from `preset`
- H.264 High, **CRF 18**, **~2.2 Mbps** maxrate, **30 fps**
- AAC-LC **128k / 44.1 kHz**, `+faststart`
- **Remux (codec copy)** when input already matches WhatsApp specs — no re-encode
- x264 preset defaults to **`veryfast`** (`FFMPEG_X264_PRESET`) for small EB instances
- **`status`** (default): ≤15 MB
- **`chat-hd`**: same encode, larger size budget for HD chat → Forward → Status

### `GET /v1/export/jobs/:jobId`
Job status: `queued` | `processing` | `done` | `failed`.

### `GET /v1/export/:filename`
Re-download a previous export from `data/exports/`.

## Client wiring

```
VITE_BACKEND_ENABLED=true
VITE_API_BASE_URL=http://localhost:8787
```

Android emulator:

```
VITE_BACKEND_ENABLED=true
VITE_API_BASE_URL=http://10.0.2.2:8787
```

When enabled, Convert uses **backend FFmpeg** first. If the API is unreachable, the app falls back to on-device processing.

## Storage

The structured data (users, OTPs, sessions, trials, config, export jobs) goes through a
pluggable storage layer selected by `STORAGE_DRIVER`:

- **`postgres`** (recommended on Hetzner) — PostgreSQL; schema auto-migrates on boot
- **`file`** — local JSON files (quick local dev)
- **`dynamodb`** — Amazon DynamoDB (AWS only)

The app logs the active driver at startup: `[storage] driver=...`.

### Postgres driver

Tables: `users`, `otps`, `sessions`, `trials`, `app_config`, `export_jobs`
(see `src/storage/schema.sql`). Created automatically on startup.

```bash
STORAGE_DRIVER=postgres
DB_HOST=localhost          # or host.docker.internal from Docker Compose
DB_PORT=5432
DB_NAME=embrace_hd_prod
DB_USER=embrace_app
DB_PASSWORD=***
```

If Postgres is on the Hetzner host and the API runs in Compose, use
`DB_HOST=host.docker.internal` and allow the Docker bridge in `pg_hba.conf`
(e.g. `host all all 172.16.0.0/12 scram-sha-256`). Video files still use `DATA_DIR`.

### File driver — data files
- `data/config.json` — remote defaults
- `data/trials.json` — claimed trials
- `data/users.json` — auth users (phone E.164, optional name, linked deviceIds)
- `data/otps.json` — hashed OTP records
- `data/sessions.json` — opaque session tokens
- `data/uploads/` — temporary uploads (deleted after encode)
- `data/exports/` — completed MP4s

### DynamoDB driver (single-table design)

One table (default name `embrace-hd`), partition key `pk`, sort key `sk`:

| Entity | pk | sk | Notes |
|--------|----|----|-------|
| User | `USER#<id>` | `USER` | `gsi1pk = PHONE#<e164>` for phone lookup |
| OTP | `OTP#<e164>` | `OTP` | `ttl` set → auto-expires |
| Session | `SESSION#<token>` | `SESSION` | `ttl` set → auto-expires |
| Trial | `TRIAL#<deviceId>` | `TRIAL` | |
| Config | `CONFIG` | `CONFIG` | singleton |

- GSI `gsi1` (hash key `gsi1pk`) powers "find user by phone".
- TTL attribute `ttl` (epoch seconds) lets DynamoDB purge expired OTPs/sessions.

**Create the table** (uses your AWS credentials / role, no CLI needed):

```bash
cd backend
DDB_TABLE=embrace-hd AWS_REGION=eu-west-2 npm run ddb:create-table
```

Then set `STORAGE_DRIVER=dynamodb` (and `DDB_TABLE` if not default) in the
environment. On Elastic Beanstalk, also give the **EC2 instance role**
(`aws-elasticbeanstalk-ec2-role`) permission to use the table — attach a policy like:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query"
    ],
    "Resource": [
      "arn:aws:dynamodb:eu-west-2:*:table/embrace-hd",
      "arn:aws:dynamodb:eu-west-2:*:table/embrace-hd/index/*"
    ]
  }]
}
```

> Video files still live on disk (`data/uploads`, `data/exports`) — those are
> not in DynamoDB. For multi-instance durability move exports to object storage.

## Deploy to Hetzner (recommended)

Single **x86_64** Cloud VPS + **Docker Compose** + **Caddy** (auto HTTPS).

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage Node 20 build (linux/amd64 for ffmpeg-static) |
| `docker-compose.yml` | `api` + `caddy` services, persistent `/data` volume |
| `deploy/Caddyfile` | Reverse proxy, 300 MB body, long timeouts |

### 1. Create the server

1. [Hetzner Cloud](https://console.hetzner.cloud) → **New server**
2. Location: nearest to users (e.g. Falkenstein / Nuremberg / Helsinki)
3. Image: **Ubuntu 24.04**
4. Type: **CX22** or **CPX21** (or larger) — architecture must be **x86 (Intel/AMD)**, not ARM/CAX
5. Networking: public IPv4
6. Firewall: allow **TCP 22, 80, 443** (and UDP 443 if you want HTTP/3)

SSH in and install Docker:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out / in, then: docker --version
```

### 2. Copy the backend and configure

On your machine (or clone on the server):

```bash
# example: sync only the backend folder
scp -r backend root@YOUR_SERVER_IP:/opt/embrace-hd-backend
```

On the server:

```bash
cd /opt/embrace-hd-backend
cp .env.example .env
nano .env
```

Set at least:

| Key | Value |
|-----|-------|
| `API_DOMAIN` | `api.embraceapp.co.uk` (must match DNS) |
| `CORS_ORIGINS` | `*` or your app origins |
| `STORAGE_DRIVER` | `postgres` |
| `DB_HOST` | `host.docker.internal` (Postgres on same host; Compose default) |
| `DB_PORT` | `5432` |
| `DB_NAME` | `embrace_hd_prod` |
| `DB_USER` | `embrace_app` |
| `DB_PASSWORD` | your DB password |
| `AUTH_ALLOW_OTP_HINT` | `false` |
| `AUTH_TEST_OTP` | empty |
| `WHATSAPP_*` | your Cloud API credentials |
| `FFMPEG_X264_PRESET` | `veryfast` (default) |

### 3. Point DNS

Create an **A record**: `api.embraceapp.co.uk` → your Hetzner server IPv4.  
Wait until it resolves before starting Caddy (Let’s Encrypt needs a valid hostname).

### 4. Start

```bash
cd /opt/embrace-hd-backend
docker compose up -d --build
docker compose logs -f
```

Health: `https://api.embraceapp.co.uk/health`

From your laptop (with Docker):

```bash
cd backend
npm run docker:up    # build + start
npm run docker:logs
npm run docker:down
```

### 5. Updates

```bash
cd /opt/embrace-hd-backend
git pull   # or scp a new copy
docker compose up -d --build
```

Data (users, sessions, OTPs, exports) lives in the Docker volume `embrace_data` and survives rebuilds.

### 6. Cut over from Elastic Beanstalk

1. Confirm Hetzner `/health` and a test OTP + export work.
2. Switch DNS (or keep the same `API_DOMAIN` and only change the A record).
3. App clients already using `https://api.embraceapp.co.uk` need **no rebuild**.
4. Terminate the EB environment when traffic is stable.

**Notes**
- Prefer `STORAGE_DRIVER=postgres` on Hetzner. Ensure Postgres allows Docker host connections (`host.docker.internal`).
- Disk fills with exports over time — prune `data/exports` periodically or add a cron.
- For backups: dump Postgres (`pg_dump`) and/or snapshot the Hetzner volume.

## Deploy to AWS Elastic Beanstalk (optional / legacy)

The backend still ships EB packaging if you need it:

| File | Purpose |
|------|---------|
| `Procfile` | Start command → `node dist/index.js` |
| `.ebextensions/environment.config` | Sets `NODE_ENV=production` |
| `.platform/nginx/conf.d/proxy.conf` | `client_max_body_size 300M` + timeouts |
| `scripts/package-eb.mjs` | Builds the deployable ZIP for console upload |

### 1. Build the upload ZIP

```bash
cd backend
npm install
npm run eb:zip
```

This produces **`backend/build/embrace-hd-backend-eb.zip`** containing the compiled
`dist/`, `package.json`, `package-lock.json`, `Procfile`, `.ebextensions/`, and
`.platform/` (no `node_modules`, `src`, `.env`, or `data/`).

### 2. Create the environment (Console)

1. **Elastic Beanstalk → Create application**
2. Platform: **Node.js** (Amazon Linux 2023), architecture **x86_64**
3. Application code: **Upload your code** → choose the ZIP from step 1
4. Create the environment (instance type e.g. `t3.small`)

### 3. Set env vars (Console)

**Configuration → Updates, monitoring, and logging → Environment properties** (never commit secrets):

| Key | Value |
|-----|-------|
| `CORS_ORIGINS` | `*` or your app origins |
| `REVENUECAT_SECRET_API_KEY` | RevenueCat secret (optional) |
| `WHATSAPP_TOKEN` | Cloud API token |
| `WHATSAPP_PHONE_NUMBER_ID` | Cloud API phone number id |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verify token |
| `WHATSAPP_OTP_TEMPLATE` | Approved auth template name |
| `WHATSAPP_OTP_TEMPLATE_LANG` | e.g. `en_US` |
| `AUTH_ALLOW_OTP_HINT` | `false` in production |
| `AUTH_TEST_OTP` | empty in production |
| `PHONE_DATA_KEY` | 64-char hex; required for encrypted phone storage |
| `STORAGE_DRIVER` | `dynamodb` for a load-balanced environment (default `file`) |
| `DDB_TABLE` | table name if not `embrace-hd` |

`NODE_ENV=production` is already set by `.ebextensions`. Apply changes (the app restarts).

For a single instance you can keep the default `file` driver, but the JSON stores
reset on each deploy. For persistence and multi-instance scaling, set
`STORAGE_DRIVER=dynamodb` (see **Storage → DynamoDB driver** above).

### 4. Update later

Run `npm run eb:zip` again and, in the console, **Upload and deploy** the new ZIP.

Health check: `GET /health`. The app listens on `process.env.PORT` (EB sets `8080`).

**Notes / caveats**
- Use an **x86_64** instance type — `ffmpeg-static` and `@ffprobe-installer/ffprobe` ship x64 binaries (not ARM/Graviton).
- With the `file` driver, the JSON stores + exports are on instance disk (ephemeral). For scaling/durability set `STORAGE_DRIVER=dynamodb` (structured data) and move video exports to S3.
- Serve over HTTPS in production and set the client `VITE_API_BASE_URL` to the EB/ALB domain (add a certificate + custom domain via Route 53/ACM).

### If environment creation failed (`CREATE_FAILED`)

1. Open the environment → **Events** tab (or the CloudFormation stack events) and read the **Cause** — that's the real error.
2. **Terminate** the failed environment (a failed stack can't be reused).
3. Fix the cause, run `npm run eb:zip` again, and **create a fresh environment** with the new ZIP.

Common causes: an invalid `.ebextensions` option, a health check that never passes (app not starting), or a missing EC2 instance profile / service role. This bundle keeps `.ebextensions` minimal (`NODE_ENV` only) to avoid config-driven failures.
