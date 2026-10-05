import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoading: Promise<FFmpeg> | null = null;

/** Shared FFmpeg.wasm instance for web + native crop/compress fallbacks. */
export async function getFfmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = (async () => {
    const ffmpeg = new FFmpeg();
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await ffmpegLoading;
  } finally {
    ffmpegLoading = null;
  }
}

export async function resolveVideoBytes(sourcePath: string): Promise<Uint8Array> {
  const src = Capacitor.isNativePlatform()
    ? Capacitor.convertFileSrc(sourcePath)
    : sourcePath;

  try {
    return await fetchFile(src);
  } catch {
    const path = sourcePath.replace(/^file:\/\//, '');
    const result = await Filesystem.readFile({ path });
    const data = result.data;
    if (typeof data === 'string') {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    if (data instanceof Blob) {
      return new Uint8Array(await data.arrayBuffer());
    }
    return new Uint8Array(data as unknown as ArrayBuffer);
  }
}

export async function persistVideoBytes(
  bytes: Uint8Array,
  filenamePrefix = 'embraceHD'
): Promise<string> {
  const filename = `${filenamePrefix}_${Date.now()}.mp4`;

  if (!Capacitor.isNativePlatform()) {
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'video/mp4' });
    return URL.createObjectURL(blob);
  }

  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }

  await Filesystem.mkdir({
    path: 'EmbraceHD',
    directory: Directory.Cache,
    recursive: true,
  }).catch(() => undefined);

  const written = await Filesystem.writeFile({
    path: `EmbraceHD/${filename}`,
    data: btoa(binary),
    directory: Directory.Cache,
  });

  return written.uri;
}

export function readFfmpegFileBytes(data: string | Uint8Array): Uint8Array {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data);
  }
  return new Uint8Array(data);
}
