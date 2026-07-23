import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { createId } from '../core';

function extensionForMime(mimeType?: string): string {
  if (!mimeType) return 'mp4';
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('quicktime') || mimeType.includes('mov')) return 'mov';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.startsWith('image/')) return 'jpg';
  return 'mp4';
}

function isContentUri(uri: string): boolean {
  return uri.startsWith('content://');
}

function isHttpUri(uri: string): boolean {
  return uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('blob:');
}

const BRIDGE_CHUNK_BYTES = 256 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

async function writeBytesToCache(bytes: Uint8Array, filename: string): Promise<string> {
  await Filesystem.mkdir({
    path: 'EmbraceHD',
    directory: Directory.Cache,
    recursive: true,
  }).catch(() => undefined);

  const path = `EmbraceHD/${filename}`;

  // Never send a whole video as one base64 JSON payload — OOMs Capacitor.
  await Filesystem.writeFile({
    path,
    data: '',
    directory: Directory.Cache,
    recursive: true,
  });

  for (let offset = 0; offset < bytes.length; offset += BRIDGE_CHUNK_BYTES) {
    const slice = bytes.subarray(
      offset,
      Math.min(offset + BRIDGE_CHUNK_BYTES, bytes.length)
    );
    await Filesystem.appendFile({
      path,
      data: bytesToBase64(slice),
      directory: Directory.Cache,
    });
  }

  const got = await Filesystem.getUri({ path, directory: Directory.Cache });
  return got.uri;
}

/**
 * Native compressors need a real file path — Android photo picker returns content://.
 * Copy content/http URIs into app cache and return a file:// URI.
 */
export async function ensureLocalMediaFile(
  uri: string,
  mimeType?: string
): Promise<string> {
  if (!uri) {
    throw new Error('No media URI provided');
  }

  // Already a local filesystem path
  if (!isContentUri(uri) && !isHttpUri(uri)) {
    return uri.startsWith('file:') ? uri : `file://${uri}`;
  }

  const filename = `input_${createId('media')}.${extensionForMime(mimeType)}`;
  const relativePath = `EmbraceHD/${filename}`;

  await Filesystem.mkdir({
    path: 'EmbraceHD',
    directory: Directory.Cache,
    recursive: true,
  }).catch(() => undefined);

  // Create placeholder so FileProvider can open an output stream
  await Filesystem.writeFile({
    path: relativePath,
    data: '',
    directory: Directory.Cache,
  }).catch(() => undefined);

  const dest = await Filesystem.getUri({
    path: relativePath,
    directory: Directory.Cache,
  });

  // Preferred: native copy via ContentResolver (supports content://)
  if (isContentUri(uri) && Capacitor.isNativePlatform()) {
    try {
      await FilePicker.copyFile({
        from: uri,
        to: dest.uri,
        overwrite: true,
      });
      return dest.uri;
    } catch (err) {
      console.warn('[media] FilePicker.copyFile failed, trying fetch fallback', err);
    }
  }

  // Fallback: read via Capacitor bridge / blob URL
  const fetchUrl = Capacitor.isNativePlatform()
    ? Capacitor.convertFileSrc(uri)
    : uri;
  const response = await fetch(fetchUrl);
  if (!response.ok) {
    throw new Error('Could not read the selected media file');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error('Selected media file is empty');
  }

  return writeBytesToCache(bytes, filename);
}
