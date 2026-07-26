import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { query } from '../storage/postgres.js';
import {
  exportWhatsAppHdSegments,
  getExportPath,
  type ExportDelivery,
  type ExportPreset,
  type ExportPresetChoice,
} from './exportVideo.js';
import { deliverExportVideoToWhatsApp } from './whatsappMedia.js';
import {
  isConversationWindowOpen,
  type AuthUser,
} from './userStore.js';

export type ExportJobStatus = 'queued' | 'processing' | 'done' | 'failed';

export type ExportJob = {
  jobId: string;
  status: ExportJobStatus;
  error?: string;
  /** Internal filename only — not returned as a public download when delivered via WhatsApp. */
  filename?: string;
  /** @deprecated Prefer deliveredVia=whatsapp; kept for legacy clients */
  downloadPath?: string;
  deliveredVia?: 'whatsapp' | 'download';
  /** Requested choice; resolved to 720p/1080p once encode starts. */
  preset: ExportPresetChoice;
  statusLengthSec: 30 | 60;
  delivery: ExportDelivery;
  sizeBytes?: number;
  userId?: string;
  createdAt: string;
  updatedAt: string;
};

const usingPostgres = env.storageDriver === 'postgres';
const jobs = new Map<string, ExportJob>();
const MAX_JOBS = 200;

function jobsDir(): string {
  return path.join(env.dataDir, 'jobs');
}

function mapJobRow(row: {
  job_id: string;
  status: ExportJobStatus;
  error: string | null;
  filename: string | null;
  download_path: string | null;
  preset: string;
  status_length_sec: number;
  delivery: string;
  size_bytes: string | number | null;
  created_at: Date | string;
  updated_at: Date | string;
}): ExportJob {
  const downloadPath = row.download_path ?? undefined;
  return {
    jobId: row.job_id,
    status: row.status,
    error: row.error ?? undefined,
    filename: row.filename ?? undefined,
    downloadPath,
    deliveredVia: downloadPath ? 'download' : row.filename ? 'whatsapp' : undefined,
    preset: row.preset as ExportPresetChoice,
    statusLengthSec: row.status_length_sec as 30 | 60,
    delivery: row.delivery as ExportDelivery,
    sizeBytes:
      row.size_bytes == null ? undefined : Number(row.size_bytes),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function persist(job: ExportJob): Promise<void> {
  jobs.set(job.jobId, job);

  if (usingPostgres) {
    await query(
      `INSERT INTO export_jobs (
         job_id, status, error, filename, download_path,
         preset, status_length_sec, delivery, size_bytes, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (job_id) DO UPDATE SET
         status = EXCLUDED.status,
         error = EXCLUDED.error,
         filename = EXCLUDED.filename,
         download_path = EXCLUDED.download_path,
         preset = EXCLUDED.preset,
         status_length_sec = EXCLUDED.status_length_sec,
         delivery = EXCLUDED.delivery,
         size_bytes = EXCLUDED.size_bytes,
         updated_at = EXCLUDED.updated_at`,
      [
        job.jobId,
        job.status,
        job.error ?? null,
        job.filename ?? null,
        job.downloadPath ?? null,
        job.preset,
        job.statusLengthSec,
        job.delivery,
        job.sizeBytes ?? null,
        job.createdAt,
        job.updatedAt,
      ]
    );
    return;
  }

  await fs.mkdir(jobsDir(), { recursive: true });
  await fs.writeFile(
    path.join(jobsDir(), `${job.jobId}.json`),
    JSON.stringify(job),
    'utf8'
  );
  if (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    )[0];
    if (oldest) jobs.delete(oldest.jobId);
  }
}

/** Public poll payload — never exposes a download URL for WhatsApp delivery. */
export function publicExportJob(job: ExportJob): Omit<ExportJob, 'downloadPath'> & {
  downloadPath?: undefined;
} {
  const { downloadPath: _d, ...rest } = job;
  return {
    ...rest,
    deliveredVia: job.deliveredVia ?? (job.downloadPath ? 'download' : 'whatsapp'),
  };
}

export async function getExportJob(jobId: string): Promise<ExportJob | null> {
  const cached = jobs.get(jobId);
  if (cached) return cached;

  if (usingPostgres) {
    const { rows } = await query('SELECT * FROM export_jobs WHERE job_id = $1', [
      jobId,
    ]);
    if (!rows[0]) return null;
    const job = mapJobRow(rows[0] as Parameters<typeof mapJobRow>[0]);
    jobs.set(jobId, job);
    return job;
  }

  try {
    const raw = await fs.readFile(path.join(jobsDir(), `${jobId}.json`), 'utf8');
    const job = JSON.parse(raw) as ExportJob;
    jobs.set(jobId, job);
    return job;
  } catch {
    return null;
  }
}

/**
 * Accept an uploaded file, return immediately, encode + WhatsApp-deliver in background.
 */
export async function enqueueExportJob(options: {
  inputPath: string;
  preset: ExportPresetChoice;
  statusLengthSec: 30 | 60;
  delivery: ExportDelivery;
  user: AuthUser;
}): Promise<ExportJob> {
  if (!isConversationWindowOpen(options.user.lastInboundWhatsAppAt)) {
    throw new Error(
      'WhatsApp chat window is closed — message the business number, then try again'
    );
  }

  const now = new Date().toISOString();
  const job: ExportJob = {
    jobId: randomUUID(),
    status: 'queued',
    preset: options.preset,
    statusLengthSec: options.statusLengthSec,
    delivery: options.delivery,
    userId: options.user.id,
    createdAt: now,
    updatedAt: now,
  };
  await persist(job);

  void runExportJob(job.jobId, options.inputPath, options.user.phoneE164).catch(
    (err) => {
      console.error('[ExportJob] unhandled', job.jobId, err);
    }
  );

  return job;
}

async function runExportJob(
  jobId: string,
  inputPath: string,
  phoneE164: string
): Promise<void> {
  const job = await getExportJob(jobId);
  if (!job) return;

  job.status = 'processing';
  job.updatedAt = new Date().toISOString();
  await persist(job);

  const outputPaths: string[] = [];

  try {
    const parts = await exportWhatsAppHdSegments({
      inputPath,
      preset: job.preset,
      statusLengthSec: job.statusLengthSec,
      delivery: job.delivery,
    });

    if (!parts.length) {
      throw new Error('Export produced no video parts');
    }

    const resolvedPreset: ExportPreset = parts[0].preset;
    job.preset = resolvedPreset;

    let totalBytes = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      outputPaths.push(part.outputPath);
      totalBytes += part.sizeBytes;

      const lengthLabel = Math.round(part.lengthSec ?? job.statusLengthSec);
      const caption =
        parts.length > 1
          ? `Embrace HD · part ${i + 1}/${parts.length} · ${lengthLabel}s is ready. Open it here and post to your Status.`
          : `Your Embrace HD · ${lengthLabel}s video is ready. Open it here and post to your Status.`;

      await deliverExportVideoToWhatsApp({
        phoneE164,
        filePath: part.outputPath,
        caption,
      });

      // Brief pause so WhatsApp Cloud API does not throttle multi-part sends
      if (i < parts.length - 1) {
        await new Promise((r) => setTimeout(r, 1200));
      }
    }

    job.status = 'done';
    job.filename = parts.map((p) => p.filename).join(',');
    job.deliveredVia = 'whatsapp';
    job.downloadPath = undefined;
    job.sizeBytes = totalBytes;
    job.updatedAt = new Date().toISOString();
    await persist(job);
  } catch (err) {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : 'Export failed';
    job.updatedAt = new Date().toISOString();
    await persist(job);
  } finally {
    await fs.unlink(inputPath).catch(() => undefined);
    for (const p of outputPaths) {
      await fs.unlink(p).catch(() => undefined);
    }
    if (job.filename) {
      for (const name of job.filename.split(',')) {
        await fs.unlink(getExportPath(name.trim())).catch(() => undefined);
      }
    }
  }
}
