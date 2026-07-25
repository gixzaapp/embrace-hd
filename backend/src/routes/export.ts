import fs from 'node:fs';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { HttpError } from '../middleware/errorHandler.js';
import { requireAuth, type AuthedRequest } from '../middleware/requireAuth.js';
import {
  enqueueExportJob,
  getExportJob,
  publicExportJob,
} from '../services/exportJobs.js';
import {
  getUploadsDir,
  type ExportDelivery,
  type ExportPreset,
} from '../services/exportVideo.js';

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
  preset: z.enum(['720p', '1080p']).default('720p'),
  statusLengthSec: z.coerce.number().refine((n) => n === 30 || n === 60),
  delivery: z.enum(['status', 'chat-hd']).default('status'),
});

/**
 * POST /v1/export
 * Auth required. multipart: video + preset + statusLengthSec + delivery
 * Encodes then sends the MP4 to the user's WhatsApp (no file download).
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

      const { preset, statusLengthSec, delivery } = parsed.data;
      try {
        const job = await enqueueExportJob({
          inputPath: file.path,
          preset: preset as ExportPreset,
          statusLengthSec: statusLengthSec as 30 | 60,
          delivery: delivery as ExportDelivery,
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
