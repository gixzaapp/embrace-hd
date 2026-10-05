import { Capacitor } from '@capacitor/core';
import { Encoding, Filesystem } from '@capacitor/filesystem';
import { createId } from '../core';
import { ensureOutputDir, GALLERY_DIRECTORY, OUTPUT_DIR } from './filesystemService';

export type GalleryItem = {
  id: string;
  name: string;
  /** Relative path under app Data (native) or blob URL (web) */
  path: string;
  uri: string;
  createdAt: string;
  statusLengthSec: number;
  title: string;
  sizeBytes?: number;
  watermarkApplied?: boolean;
};

export type SaveToGalleryOptions = {
  sourceUri: string;
  title: string;
  statusLengthSec: number;
};

const INDEX_PATH = `${OUTPUT_DIR}/gallery-index.json`;
const WEB_INDEX_KEY = 'embrace_hd_gallery_index';

async function readIndexNative(): Promise<GalleryItem[]> {
  try {
    const result = await Filesystem.readFile({
      path: INDEX_PATH,
      directory: GALLERY_DIRECTORY,
      encoding: Encoding.UTF8,
    });
    const raw = typeof result.data === 'string' ? result.data : '';
    const parsed = JSON.parse(raw) as GalleryItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeIndexNative(items: GalleryItem[]): Promise<void> {
  await ensureOutputDir();
  await Filesystem.writeFile({
    path: INDEX_PATH,
    directory: GALLERY_DIRECTORY,
    data: JSON.stringify(items, null, 2),
    encoding: Encoding.UTF8,
  });
}

function readIndexWeb(): GalleryItem[] {
  try {
    const raw = localStorage.getItem(WEB_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GalleryItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndexWeb(items: GalleryItem[]): void {
  localStorage.setItem(WEB_INDEX_KEY, JSON.stringify(items));
}

async function readIndex(): Promise<GalleryItem[]> {
  if (Capacitor.isNativePlatform()) return readIndexNative();
  return readIndexWeb();
}

async function writeIndex(items: GalleryItem[]): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await writeIndexNative(items);
    return;
  }
  writeIndexWeb(items);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'status';
}

/**
 * Copy a converted video into app Data/EmbraceHD and register it in the gallery index.
 */
export async function saveExportToGallery(
  options: SaveToGalleryOptions
): Promise<GalleryItem> {
  await ensureOutputDir();

  const id = createId('export');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${sanitizeFilename(options.title)}_${options.statusLengthSec}s_${stamp}.mp4`;
  const relativePath = `${OUTPUT_DIR}/${filename}`;
  const createdAt = new Date().toISOString();

  let uri = options.sourceUri;
  let sizeBytes: number | undefined;

  if (Capacitor.isNativePlatform()) {
    try {
      await Filesystem.copy({
        from: options.sourceUri,
        to: relativePath,
        toDirectory: GALLERY_DIRECTORY,
      });
    } catch (copyErr) {
      console.warn('[Gallery] copy failed, trying path without scheme', copyErr);
      const bare = options.sourceUri.replace(/^file:\/\//, '');
      await Filesystem.copy({
        from: bare,
        to: relativePath,
        toDirectory: GALLERY_DIRECTORY,
      });
    }

    const got = await Filesystem.getUri({
      path: relativePath,
      directory: GALLERY_DIRECTORY,
    });
    uri = got.uri;

    try {
      const stat = await Filesystem.stat({
        path: relativePath,
        directory: GALLERY_DIRECTORY,
      });
      sizeBytes = stat.size;
    } catch {
      // ignore
    }
  } else {
    uri = options.sourceUri;
  }

  const item: GalleryItem = {
    id,
    name: filename,
    path: Capacitor.isNativePlatform() ? relativePath : uri,
    uri,
    createdAt,
    statusLengthSec: options.statusLengthSec,
    title: options.title,
    sizeBytes,
  };

  const items = await readIndex();
  items.unshift(item);
  await writeIndex(items);
  return item;
}

export async function listGalleryItems(): Promise<GalleryItem[]> {
  const items = await readIndex();
  if (!Capacitor.isNativePlatform()) return items;

  const existing: GalleryItem[] = [];
  for (const item of items) {
    try {
      await Filesystem.stat({
        path: item.path,
        directory: GALLERY_DIRECTORY,
      });
      existing.push(item);
    } catch {
      // File removed from disk — drop from index
    }
  }

  if (existing.length !== items.length) {
    await writeIndex(existing);
  }
  return existing;
}

export async function deleteGalleryItem(id: string): Promise<void> {
  const items = await readIndex();
  const target = items.find((i) => i.id === id);
  const next = items.filter((i) => i.id !== id);

  if (target && Capacitor.isNativePlatform()) {
    try {
      await Filesystem.deleteFile({
        path: target.path,
        directory: GALLERY_DIRECTORY,
      });
    } catch {
      // already gone
    }
  }

  await writeIndex(next);
}

/**
 * Remove Edit/Saved videos from the gallery index (and files on device).
 * Optionally keep one item (e.g. the just-converted HD export in local mode).
 */
export async function clearGalleryLibrary(keepId?: string): Promise<void> {
  const items = await readIndex();
  const kept: GalleryItem[] = [];

  for (const item of items) {
    if (keepId && item.id === keepId) {
      kept.push(item);
      continue;
    }
    if (Capacitor.isNativePlatform()) {
      try {
        await Filesystem.deleteFile({
          path: item.path,
          directory: GALLERY_DIRECTORY,
        });
      } catch {
        // already gone
      }
    }
  }

  await writeIndex(kept);
}

export function galleryDisplaySrc(uri: string): string {
  if (!uri) return '';
  if (uri.startsWith('blob:') || uri.startsWith('http')) return uri;
  return Capacitor.convertFileSrc(uri);
}
