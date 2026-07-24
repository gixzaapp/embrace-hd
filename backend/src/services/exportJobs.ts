import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { query } from '../storage/postgres.js';
import {
  exportWhatsAppHd,
  type ExportDelivery,
  type ExportPreset,
} from './exportVideo.js';

export type ExportJobStatus = 'queued' | 'processing' | 'done' | 'failed';

export type ExportJob = {
  jobId: string;
  status: ExportJobStatus;
  error?: string;
  filename?: string;
  downloadPath?: string;
  preset: ExportPreset;
  statusLengthSec: 30 | 60;
  delivery: ExportDelivery;
  sizeBytes?: number;
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
  return {
    jobId: row.job_id,
    status: row.status,
    error: row.error ?? undefined,
    filename: row.filename ?? undefined,
    downloadPath: row.download_path ?? undefined,
    preset: row.preset as ExportPreset,
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
 * Accept an uploaded file, return immediately, encode in the background.
 */
export async function enqueueExportJob(options: {
  inputPath: string;
  preset: ExportPreset;
  statusLengthSec: 30 | 60;
  delivery: ExportDelivery;
}): Promise<ExportJob> {
  const now = new Date().toISOString();
  const job: ExportJob = {
    jobId: randomUUID(),
    status: 'queued',
    preset: options.preset,
    statusLengthSec: options.statusLengthSec,
    delivery: options.delivery,
    createdAt: now,
    updatedAt: now,
  };
  await persist(job);

  void runExportJob(job.jobId, options.inputPath).catch((err) => {
    console.error('[ExportJob] unhandled', job.jobId, err);
  });

  return job;
}

async function runExportJob(jobId: string, inputPath: string): Promise<void> {
  const job = await getExportJob(jobId);
  if (!job) return;

  job.status = 'processing';
  job.updatedAt = new Date().toISOString();
  await persist(job);

  try {
    const result = await exportWhatsAppHd({
      inputPath,
      preset: job.preset,
      statusLengthSec: job.statusLengthSec,
      delivery: job.delivery,
    });

    job.status = 'done';
    job.filename = result.filename;
    job.downloadPath = `/v1/export/${encodeURIComponent(result.filename)}`;
    job.sizeBytes = result.sizeBytes;
    job.updatedAt = new Date().toISOString();
    await persist(job);
  } catch (err) {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : 'Export failed';
    job.updatedAt = new Date().toISOString();
    await persist(job);
  } finally {
    await fs.unlink(inputPath).catch(() => undefined);
  }
}
