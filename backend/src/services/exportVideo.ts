import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobePath from '@ffprobe-installer/ffprobe';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/errorHandler.js';

export type ExportPreset = '720p' | '1080p';

/** How the file will be posted into WhatsApp */
export type ExportDelivery = 'status' | 'chat-hd';

export type ExportOptions = {
  inputPath: string;
  preset: ExportPreset;
  statusLengthSec: 30 | 60;
  /**
   * `status`  — ≤16MB @ ~2.2 Mbps (WhatsApp Status ceiling)
   * `chat-hd` — same encode params, larger size budget for HD chat → Forward
   */
  delivery?: ExportDelivery;
};

export type ExportResult = {
  jobId: string;
  outputPath: string;
  filename: string;
  sizeBytes: number;
  preset: ExportPreset;
  statusLengthSec: 30 | 60;
  delivery: ExportDelivery;
};

/**
 * WhatsApp Status encode (single pass — remux when already compliant):
 * - 720×1280 or 1080×1920 (9:16)
 * - H.264 High, CRF 18, ~2.2 Mbps maxrate, 30 fps
 * - AAC-LC 128k, +faststart
 */
type EncodeProfile = {
  width: number;
  height: number;
  maxBytes: number;
  audioBitrate: string;
  audioSampleRate: number;
  crf: number;
  maxrate: string;
  bufsize: string;
  x264Preset: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower';
  h264Level: string;
};

/** Prefer speed on small EB instances — quality still governed by CRF/maxrate. */
function resolveX264Preset(): EncodeProfile['x264Preset'] {
  const raw = (process.env.FFMPEG_X264_PRESET ?? 'veryfast').trim().toLowerCase();
  const allowed: EncodeProfile['x264Preset'][] = [
    'ultrafast',
    'superfast',
    'veryfast',
    'faster',
    'fast',
    'medium',
    'slow',
    'slower',
  ];
  return (allowed.find((p) => p === raw) ?? 'veryfast') as EncodeProfile['x264Preset'];
}

function waProfile(
  width: number,
  height: number,
  maxBytes: number
): EncodeProfile {
  return {
    width,
    height,
    maxBytes,
    audioBitrate: '128k',
    audioSampleRate: 44100,
    crf: 18,
    maxrate: '2200k',
    bufsize: '4400k',
    x264Preset: resolveX264Preset(),
    h264Level: width >= 1080 ? '4.0' : '3.1',
  };
}

/** Status delivery — WhatsApp Status size ceiling (~16MB). */
const STATUS_PRESETS: Record<ExportPreset, EncodeProfile> = {
  '720p': waProfile(720, 1280, 15 * 1024 * 1024),
  '1080p': waProfile(1080, 1920, 15 * 1024 * 1024),
};

/** Chat-HD — same bitrate/resolution; larger file budget for HD chat send. */
const CHAT_HD_PRESETS: Record<ExportPreset, EncodeProfile> = {
  '720p': waProfile(720, 1280, 48 * 1024 * 1024),
  '1080p': waProfile(1080, 1920, 64 * 1024 * 1024),
};

type ProbeInfo = {
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  videoCodec: string;
  audioCodec: string | null;
  rotation: number;
  sizeBytes: number;
};

async function ensureExportDirs(): Promise<{ uploads: string; exports: string }> {
  const uploads = path.join(env.dataDir, 'uploads');
  const exportsDir = path.join(env.dataDir, 'exports');
  await fsPromises.mkdir(uploads, { recursive: true });
  await fsPromises.mkdir(exportsDir, { recursive: true });
  return { uploads, exports: exportsDir };
}

function runProcess(
  bin: string,
  args: string[],
  label: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${label} exited ${code}: ${stderr.slice(-2500)}`));
    });
  });
}

async function runFfmpeg(args: string[]): Promise<void> {
  const bin = (ffmpegPath as unknown as string | null) ?? null;
  if (!bin || typeof bin !== 'string') {
    throw new HttpError(500, 'ffmpeg-static binary not found');
  }
  await runProcess(bin, args, 'ffmpeg');
}

async function probeInput(inputPath: string): Promise<ProbeInfo | null> {
  const bin = ffprobePath.path;
  if (!bin) return null;

  try {
    const { stdout } = await runProcess(
      bin,
      [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        inputPath,
      ],
      'ffprobe'
    );
    const data = JSON.parse(stdout) as {
      format?: { duration?: string; size?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        avg_frame_rate?: string;
        r_frame_rate?: string;
        tags?: { rotate?: string };
        side_data_list?: Array<{ rotation?: number }>;
      }>;
    };

    const video = data.streams?.find((s) => s.codec_type === 'video');
    const audio = data.streams?.find((s) => s.codec_type === 'audio');
    if (!video?.width || !video.height) return null;

    let rotation = 0;
    const tagRotate = Number(video.tags?.rotate ?? 0);
    if (Number.isFinite(tagRotate)) rotation = tagRotate;
    const side = video.side_data_list?.find((s) => s.rotation != null);
    if (side?.rotation != null) rotation = Number(side.rotation);

    const parseFps = (rate?: string): number => {
      if (!rate || rate === '0/0') return 0;
      const [a, b] = rate.split('/').map(Number);
      if (!b) return Number(rate) || 0;
      return a / b;
    };
    const fps =
      parseFps(video.avg_frame_rate) || parseFps(video.r_frame_rate) || 30;

    return {
      width: video.width,
      height: video.height,
      durationSec: Number(data.format?.duration ?? 0) || 0,
      fps,
      videoCodec: video.codec_name ?? '',
      audioCodec: audio?.codec_name ?? null,
      rotation,
      sizeBytes: Number(data.format?.size ?? 0) || 0,
    };
  } catch (err) {
    console.warn('[Export] ffprobe failed', err);
    return null;
  }
}

function displaySize(probe: ProbeInfo): { width: number; height: number } {
  const rotated =
    Math.abs(probe.rotation) === 90 || Math.abs(probe.rotation) === 270;
  return rotated
    ? { width: probe.height, height: probe.width }
    : { width: probe.width, height: probe.height };
}

/** Cover-crop / scale to exact preset canvas (720×1280 or 1080×1920). */
function buildVideoFilter(
  profile: EncodeProfile,
  sourceFps: number
): string {
  const filters = [
    `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=increase:flags=lanczos+accurate_rnd+full_chroma_int`,
    `crop=${profile.width}:${profile.height}`,
    'setsar=1',
  ];

  if (Math.abs(sourceFps - 30) > 0.5) {
    filters.push('fps=30');
  }

  return filters.join(',');
}

/** Cap VBV at WhatsApp’s ~2.2 Mbps Status ceiling (and file-size budget). */
function vbvForDuration(
  profile: EncodeProfile,
  statusLengthSec: number
): { maxrate: string; bufsize: string } {
  const audioBits = Number.parseInt(profile.audioBitrate, 10) * 1000;
  const usableBits = profile.maxBytes * 8 * 0.9;
  const maxVideoBps = Math.floor(
    usableBits / Math.max(1, statusLengthSec) - audioBits
  );
  const presetMax = Number.parseInt(profile.maxrate, 10) * 1000;
  const capped = Math.max(1_500_000, Math.min(presetMax, maxVideoBps));
  const kbps = Math.round(capped / 1000);
  return {
    maxrate: `${kbps}k`,
    bufsize: `${Math.round(kbps * 2)}k`,
  };
}

/**
 * Remux (codec copy) when input already matches WhatsApp Status specs —
 * avoids a quality-destroying re-encode.
 */
function canRemux(
  probe: ProbeInfo,
  profile: EncodeProfile,
  statusLengthSec: number
): boolean {
  if (probe.videoCodec !== 'h264') return false;
  if (probe.audioCodec && probe.audioCodec !== 'aac') return false;
  // Need fps rewrite → must re-encode
  if (probe.fps > 30.5) return false;

  const shown = displaySize(probe);
  const dimsMatch =
    Math.abs(shown.width - profile.width) <= 8 &&
    Math.abs(shown.height - profile.height) <= 8;
  if (!dimsMatch || shown.height < shown.width) return false;

  // Estimated size after trim must fit Status / delivery ceiling
  const useSec = Math.min(
    probe.durationSec || statusLengthSec,
    statusLengthSec
  );
  if (probe.sizeBytes > 0 && probe.durationSec > 0) {
    const estimated =
      (probe.sizeBytes / probe.durationSec) * Math.max(1, useSec);
    if (estimated > profile.maxBytes * 1.05) return false;
  }

  return true;
}

function buildEncodeArgs(options: {
  inputPath: string;
  outputPath: string;
  statusLengthSec: number;
  profile: EncodeProfile;
  vbv: { maxrate: string; bufsize: string };
  videoFilter: string;
}): string[] {
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    options.inputPath,
    '-t',
    String(options.statusLengthSec),
    '-vf',
    options.videoFilter,
    '-c:v',
    'libx264',
    '-preset',
    options.profile.x264Preset,
    '-profile:v',
    'high',
    '-level',
    options.profile.h264Level,
    '-pix_fmt',
    'yuv420p',
    '-crf',
    String(options.profile.crf),
    '-maxrate',
    options.vbv.maxrate,
    '-bufsize',
    options.vbv.bufsize,
    '-r',
    '30',
    '-g',
    '60',
    '-keyint_min',
    '30',
    '-c:a',
    'aac',
    '-profile:a',
    'aac_low',
    '-b:a',
    options.profile.audioBitrate,
    '-ac',
    '2',
    '-ar',
    String(options.profile.audioSampleRate),
    '-movflags',
    '+faststart',
    '-brand',
    'isom',
    options.outputPath,
  ];
}

/**
 * WhatsApp Status export — remux when possible, else single-pass encode.
 */
export async function exportWhatsAppHd(
  options: ExportOptions
): Promise<ExportResult> {
  const delivery: ExportDelivery = options.delivery ?? 'status';
  const table = delivery === 'status' ? STATUS_PRESETS : CHAT_HD_PRESETS;
  const profile = table[options.preset];
  if (!profile) {
    throw new HttpError(400, 'preset must be 720p or 1080p');
  }

  const { exports: exportsDir } = await ensureExportDirs();
  const jobId = randomUUID();
  const filename = `embraceHD_${delivery}_${options.preset}_${options.statusLengthSec}s_${jobId.slice(0, 8)}.mp4`;
  const outputPath = path.join(exportsDir, filename);

  if (ffprobePath.path) {
    process.env.FFPROBE_PATH = ffprobePath.path;
  }

  const probe = await probeInput(options.inputPath);
  const vbv = vbvForDuration(profile, options.statusLengthSec);

  if (probe && canRemux(probe, profile, options.statusLengthSec)) {
    try {
      await runFfmpeg([
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        options.inputPath,
        '-t',
        String(options.statusLengthSec),
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        '-brand',
        'isom',
        outputPath,
      ]);
      const stat = await fsPromises.stat(outputPath);
      if (stat.size <= profile.maxBytes) {
        const shown = displaySize(probe);
        console.log(
          `[Export] remux ${delivery} ${shown.width}x${shown.height} ${(stat.size / (1024 * 1024)).toFixed(1)}MB (lossless copy)`
        );
        return {
          jobId,
          outputPath,
          filename,
          sizeBytes: stat.size,
          preset: options.preset,
          statusLengthSec: options.statusLengthSec,
          delivery,
        };
      }
      console.warn('[Export] Remux over size ceiling; single-pass encode');
    } catch (err) {
      console.warn('[Export] Remux failed; single-pass encode', err);
    }
  }

  const shown = probe
    ? displaySize(probe)
    : { width: profile.width, height: profile.height };
  const sourceFps = probe?.fps || 30;

  console.log(
    `[Export] encode ${delivery} ${profile.width}x${profile.height} crf=${profile.crf} max=${vbv.maxrate} from ${shown.width}x${shown.height} ${sourceFps.toFixed(2)}fps`
  );

  await runFfmpeg(
    buildEncodeArgs({
      inputPath: options.inputPath,
      outputPath,
      statusLengthSec: options.statusLengthSec,
      profile,
      vbv,
      videoFilter: buildVideoFilter(profile, sourceFps),
    })
  );

  const stat = await fsPromises.stat(outputPath);
  console.log(
    `[Export] done ${delivery} ${profile.width}x${profile.height} ${(stat.size / (1024 * 1024)).toFixed(1)}MB`
  );

  return {
    jobId,
    outputPath,
    filename,
    sizeBytes: stat.size,
    preset: options.preset,
    statusLengthSec: options.statusLengthSec,
    delivery,
  };
}

export async function getUploadsDir(): Promise<string> {
  const { uploads } = await ensureExportDirs();
  return uploads;
}

export function getExportPath(filename: string): string {
  return path.join(env.dataDir, 'exports', filename);
}
