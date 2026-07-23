import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { HttpError } from '../middleware/errorHandler.js';
import { enqueueExportJob, getExportJob } from '../services/exportJobs.js';
import {
  getExportPath,
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
 * multipart: video (file) + preset + statusLengthSec + delivery
 * Returns 202 immediately; poll GET /v1/export/jobs/:jobId until done.
 * (Keeps the HTTP request under ALB/CloudFront idle timeouts.)
 */
exportRouter.post('/', (req, res, next) => {
  upload.single('video')(req, res, (err) => {
    if (err) {
      next(new HttpError(400, err.message || 'Upload failed'));
      return;
    }
    void (async () => {
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
      const job = await enqueueExportJob({
        inputPath: file.path,
        preset: preset as ExportPreset,
        statusLengthSec: statusLengthSec as 30 | 60,
        delivery: delivery as ExportDelivery,
      });

      res.status(202).json({
        jobId: job.jobId,
        status: job.status,
        statusPath: `/v1/export/jobs/${job.jobId}`,
        preset: job.preset,
        statusLengthSec: job.statusLengthSec,
        delivery: job.delivery,
      });
    })().catch(next);
  });
});

/**
 * GET /v1/export/jobs/:jobId — poll encode progress
 */
exportRouter.get('/jobs/:jobId', async (req, res, next) => {
  try {
    const job = await getExportJob(req.params.jobId);
    if (!job) {
      throw new HttpError(404, 'Export job not found');
    }
    res.json(job);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/export/:filename — re-download a previously exported file
 */
exportRouter.get('/:filename', (req, res, next) => {
  try {
    const filename = path.basename(req.params.filename);
    if (!filename.endsWith('.mp4')) {
      throw new HttpError(400, 'Invalid export filename');
    }
    const full = getExportPath(filename);
    if (!fs.existsSync(full)) {
      throw new HttpError(404, 'Export not found');
    }
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fs.createReadStream(full).pipe(res);
  } catch (err) {
    next(err);
  }
});
