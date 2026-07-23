import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
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

const jobs = new Map<string, ExportJob>();
const MAX_JOBS = 200;

function jobsDir(): string {
  return path.join(env.dataDir, 'jobs');
}

async function persist(job: ExportJob): Promise<void> {
  jobs.set(job.jobId, job);
  await fs.mkdir(jobsDir(), { recursive: true });
  await fs.writeFile(
    path.join(jobsDir(), `${job.jobId}.json`),
    JSON.stringify(job),
    'utf8'
  );
  // Bound memory on long-running instances
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
 * Avoids ALB/CloudFront 60s idle timeouts that surface as CORS + 504.
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
