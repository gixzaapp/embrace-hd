import fs from 'node:fs';
import { Router } from 'express';
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
      cb(null, `${Date.now()}_${safe || 'input.mp4'}`);
    },
  }),
  limits: {
    fileSize: 250 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('video/') && !file.originalname.match(/\.(mp4|mov|m4v|webm)$/i)) {
      cb(new Error('Only video uploads are allowed'));
      return;
    }
    cb(null, true);
  },
});

const fieldsSchema = z.object({
  /** auto = pick from source resolution (falls back to 720p) */
  preset: z.enum(['auto', '720p', '1080p']).default('auto'),
  statusLengthSec: z.coerce.number().refine((n) => n === 30 || n === 60),
  delivery: z.enum(['status', 'chat-hd']).default('status'),
  x264Preset: z.enum(['veryfast', 'fast', 'slow']).default('veryfast'),
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
  x264Preset: z.enum(['veryfast', 'fast', 'slow']).default('veryfast'),
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
 * Auth required. multipart: video + preset + statusLengthSec + delivery
 * Prefer Cloudflare gateway uploads in production (POST /v1/export/remote).
 */
exportRouter.post('/', requireAuth, (req, res, next) => {
  upload.single('video')(req, res, (err) => {
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

      const file = req.file;
      if (!file) {
        throw new HttpError(400, 'video file is required (field name: video)');
      }

      const parsed = fieldsSchema.safeParse(req.body);
      if (!parsed.success) {
        fs.unlink(file.path, () => undefined);
        throw new HttpError(400, 'Invalid export options', parsed.error.flatten());
      }

      const { preset, statusLengthSec, delivery, x264Preset } = parsed.data;
      try {
        const job = await enqueueExportJob({
          inputPath: file.path,
          preset: preset as ExportPresetChoice,
          statusLengthSec: statusLengthSec as 30 | 60,
          delivery: delivery as ExportDelivery,
          x264Preset: x264Preset as X264EncodePreset,
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
        });
      } catch (enqueueErr) {
        fs.unlink(file.path, () => undefined);
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

    const { fileName, downloadUrl, preset, statusLengthSec, delivery, x264Preset } =
      parsed.data;

    try {
      const job = await enqueueRemoteExportJob({
        fileName,
        downloadUrl,
        preset: preset as ExportPresetChoice,
        statusLengthSec: statusLengthSec as 30 | 60,
        delivery: delivery as ExportDelivery,
        x264Preset: x264Preset as X264EncodePreset,
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
