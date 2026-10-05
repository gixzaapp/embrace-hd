import fs from 'node:fs';
import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireAuth, type AuthedRequest } from '../middleware/requireAuth.js';
import {
  enqueueExportJob,
  enqueueRemoteExportJob,
  getExportJob,
  publicExportJob,
} from '../services/exportJobs.js';
import {
  getUploadsDir,
  type ExportDelivery,
  type ExportPresetChoice,
  type X264EncodePreset,
} from '../services/exportVideo.js';
import { isUploadGatewayConfigured } from '../services/uploadGateway.js';

export const exportRouter = Router();

/**
 * `.any()` keeps older clients working (single `video` field) and newer ones
 * (`video` + optional `music`). Unexpected extra files are ignored/cleaned up.
 */
const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try {
        const dir = await getUploadsDir();
        cb(null, dir);
      } catch (err) {
        cb(err as Error, '');
      }
    },
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-]+/g, '_').slice(0, 80);
      const fallback = file.fieldname === 'music' ? 'music.mp3' : 'input.mp4';
      cb(null, `${Date.now()}_${safe || fallback}`);
    },
  }),
  limits: {
    fileSize: 250 * 1024 * 1024,
    files: 4,
  },
});

const editRecipeSchema = z.object({
  crop: z
    .object({
      top: z.coerce.number().min(0).max(40),
      bottom: z.coerce.number().min(0).max(40),
      left: z.coerce.number().min(0).max(40),
      right: z.coerce.number().min(0).max(40),
    })
    .optional(),
  trim: z
    .object({
      startSec: z.coerce.number().min(0),
      endSec: z.coerce.number().positive(),
    })
    .optional(),
  soundMode: z.enum(['keep', 'mute', 'file']).default('keep'),
  musicOffsetSec: z.coerce.number().min(0).optional(),
});

type ParsedEditRecipe = z.infer<typeof editRecipeSchema>;

/**
 * Optional editRecipe — missing = legacy clients (Convert as before).
 * Invalid / unusable recipe is ignored so Convert still succeeds.
 */
function parseEditRecipeField(raw: unknown): ParsedEditRecipe | undefined {
  if (raw == null || raw === '') return undefined;
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      console.warn('[Export] ignoring invalid editRecipe JSON');
      return undefined;
    }
  }
  const parsed = editRecipeSchema.safeParse(value);
  if (!parsed.success) {
    console.warn('[Export] ignoring invalid editRecipe', parsed.error.flatten());
    return undefined;
  }
  if (
    parsed.data.trim &&
    parsed.data.trim.endSec <= parsed.data.trim.startSec
  ) {
    console.warn('[Export] ignoring editRecipe with invalid trim range');
    return undefined;
  }
  return parsed.data;
}

function pickUploadFiles(req: Request): {
  video?: Express.Multer.File;
  music?: Express.Multer.File;
  extras: Express.Multer.File[];
} {
  const list = (req.files as Express.Multer.File[] | undefined) ?? [];
  // Prefer named fields; fall back to first video/* for very old clients.
  let video =
    list.find((f) => f.fieldname === 'video') ??
    list.find(
      (f) =>
        f.mimetype.startsWith('video/') ||
        /\.(mp4|mov|m4v|webm)$/i.test(f.originalname)
    );
  const music =
    list.find((f) => f.fieldname === 'music') ??
    list.find(
      (f) =>
        f !== video &&
        (f.mimetype.startsWith('audio/') ||
          /\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(f.originalname))
    );
  // Legacy single-file middleware left req.file
  if (!video && req.file) {
    video = req.file;
  }
  const extras = list.filter((f) => f !== video && f !== music);
  return { video, music, extras };
}

const fieldsSchema = z.object({
  /** auto = pick from source resolution (falls back to 720p) */
  preset: z.enum(['auto', '720p', '1080p']).default('auto'),
  statusLengthSec: z.coerce.number().refine((n) => n === 30 || n === 60),
  delivery: z.enum(['status', 'chat-hd']).default('status'),
  // Older clients omit this — default veryfast. Empty string → default.
  x264Preset: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.enum(['veryfast', 'fast', 'slow']).default('veryfast')
  ),
  editRecipe: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
});

const remoteSchema = z.object({
  fileName: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/i,
      'fileName must be <uuid>.mp4'
    ),
  downloadUrl: z.string().url(),
  preset: z.enum(['auto', '720p', '1080p']).default('auto'),
  statusLengthSec: z.coerce.number().refine((n) => n === 30 || n === 60),
  delivery: z.enum(['status', 'chat-hd']).default('status'),
  x264Preset: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.enum(['veryfast', 'fast', 'slow']).default('veryfast')
  ),
  // Soft: invalid objects ignored later via parseEditRecipeField
  editRecipe: z.unknown().optional(),
});
function requireWorkerSecret(req: AuthedRequest): void {
  if (!isUploadGatewayConfigured()) {
    throw new HttpError(503, 'Upload gateway is not configured on this server');
  }
  const secret = req.headers['x-internal-secret'];
  if (typeof secret !== 'string' || secret !== env.workerHetznerSecret) {
    throw new HttpError(401, 'Invalid or missing X-Internal-Secret');
  }
}

/**
 * POST /v1/export
 * Auth required. multipart: video (+ optional music / editRecipe on newer apps).
 * Legacy clients that only send `video` + preset fields keep working unchanged.
 */
exportRouter.post('/', requireAuth, (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      next(new HttpError(400, err.message || 'Upload failed'));
      return;
    }
    void (async () => {
      const authed = req as AuthedRequest;
      const user = authed.authUser;
      if (!user) {
        throw new HttpError(401, 'Unauthorized');
      }

      const { video: file, music: musicFile, extras } = pickUploadFiles(req);
      for (const extra of extras) {
        fs.unlink(extra.path, () => undefined);
      }

      if (!file) {
        if (musicFile) fs.unlink(musicFile.path, () => undefined);
        throw new HttpError(400, 'video file is required (field name: video)');
      }

      const cleanupUploads = () => {
        fs.unlink(file.path, () => undefined);
        if (musicFile) fs.unlink(musicFile.path, () => undefined);
      };

      const parsed = fieldsSchema.safeParse(req.body);
      if (!parsed.success) {
        cleanupUploads();
        throw new HttpError(400, 'Invalid export options', parsed.error.flatten());
      }

      let editRecipe = parseEditRecipeField(parsed.data.editRecipe);
      // File music without a usable upload → treat as mute (never fail legacy path)
      if (editRecipe?.soundMode === 'file' && !musicFile) {
        console.warn(
          '[Export] soundMode=file without music — falling back to mute'
        );
        editRecipe = { ...editRecipe, soundMode: 'mute' };
      }

      const { preset, statusLengthSec, delivery, x264Preset } = parsed.data;
      try {
        const job = await enqueueExportJob({
          inputPath: file.path,
          preset: preset as ExportPresetChoice,
          statusLengthSec: statusLengthSec as 30 | 60,
          delivery: delivery as ExportDelivery,
          x264Preset: x264Preset as X264EncodePreset,
          editRecipe,
          musicPath:
            editRecipe?.soundMode === 'file' ? musicFile?.path : undefined,
          user,
        });

        // Drop unused music when we fell back away from file mode
        if (musicFile && editRecipe?.soundMode !== 'file') {
          fs.unlink(musicFile.path, () => undefined);
        }

        res.status(202).json({
          jobId: job.jobId,
          status: job.status,
          statusPath: `/v1/export/jobs/${job.jobId}`,
          preset: job.preset,
          statusLengthSec: job.statusLengthSec,
          delivery: job.delivery,
          deliveredVia: 'whatsapp',
          supportsEditRecipe: true,
        });
      } catch (enqueueErr) {
        cleanupUploads();
        const message =
          enqueueErr instanceof Error ? enqueueErr.message : 'Could not start export';
        throw new HttpError(400, message);
      }
    })().catch(next);
  });
});
/**
 * POST /v1/export/remote
 * Called by the Cloudflare upload gateway after R2 has the file.
 * Auth: user Bearer + X-Internal-Secret.
 */
exportRouter.post('/remote', requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest;
    requireWorkerSecret(authed);
    const user = authed.authUser;
    if (!user) {
      throw new HttpError(401, 'Unauthorized');
    }

    const parsed = remoteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid remote export body', parsed.error.flatten());
    }

    const {
      fileName,
      downloadUrl,
      preset,
      statusLengthSec,
      delivery,
      x264Preset,
      editRecipe: editRecipeRaw,
    } = parsed.data;

    // Soft-parse so an old gateway / bad payload never blocks remote Convert.
    let editRecipe = parseEditRecipeField(editRecipeRaw);
    if (editRecipe?.soundMode === 'file') {
      // Gateway path cannot carry music — fall back instead of failing the job.
      console.warn(
        '[Export] remote editRecipe soundMode=file — falling back to mute'
      );
      editRecipe = { ...editRecipe, soundMode: 'mute' };
    }

    try {
      const job = await enqueueRemoteExportJob({
        fileName,
        downloadUrl,
        preset: preset as ExportPresetChoice,
        statusLengthSec: statusLengthSec as 30 | 60,
        delivery: delivery as ExportDelivery,
        x264Preset: x264Preset as X264EncodePreset,
        editRecipe,
        user,
      });

      res.status(202).json({
        jobId: job.jobId,
        status: job.status,
        statusPath: `/v1/export/jobs/${job.jobId}`,
        preset: job.preset,
        statusLengthSec: job.statusLengthSec,
        delivery: job.delivery,
        deliveredVia: 'whatsapp',
        fileName,
        supportsEditRecipe: true,
      });
    } catch (enqueueErr) {
      const message =
        enqueueErr instanceof Error ? enqueueErr.message : 'Could not start export';
      throw new HttpError(400, message);
    }
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/export/jobs/:jobId — poll encode + WhatsApp delivery
 */
exportRouter.get('/jobs/:jobId', requireAuth, async (req, res, next) => {
  try {
    const job = await getExportJob(req.params.jobId);
    if (!job) {
      throw new HttpError(404, 'Export job not found');
    }
    const authed = req as AuthedRequest;
    if (job.userId && authed.authUser && job.userId !== authed.authUser.id) {
      throw new HttpError(404, 'Export job not found');
    }
    res.json(publicExportJob(job));
  } catch (err) {
    next(err);
  }
});

/**
 * File download disabled — converted videos are delivered on WhatsApp only.
 */
exportRouter.get('/:filename', (_req, res) => {
  res.status(410).json({
    error: 'Direct download removed — check WhatsApp for your converted video',
  });
});
