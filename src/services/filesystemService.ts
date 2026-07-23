import { Directory, Filesystem } from '@capacitor/filesystem';

export const OUTPUT_DIR = 'EmbraceHD';

/**
 * App-scoped storage — no READ/WRITE_EXTERNAL_STORAGE needed on modern Android.
 * Public Documents (`Directory.Documents`) causes EACCES on Android 10+.
 */
export const GALLERY_DIRECTORY = Directory.Data;

export async function ensureOutputDir(): Promise<string> {
  try {
    await Filesystem.mkdir({
      path: OUTPUT_DIR,
      directory: GALLERY_DIRECTORY,
      recursive: true,
    });
  } catch {
    // Directory may already exist
  }
  return OUTPUT_DIR;
}

export async function writeOutputFile(
  filename: string,
  base64Data: string
): Promise<string> {
  await ensureOutputDir();
  const path = `${OUTPUT_DIR}/${filename}`;

  const result = await Filesystem.writeFile({
    path,
    data: base64Data,
    directory: GALLERY_DIRECTORY,
  });

  return result.uri;
}

export async function getOutputUri(filename: string): Promise<string> {
  const result = await Filesystem.getUri({
    path: `${OUTPUT_DIR}/${filename}`,
    directory: GALLERY_DIRECTORY,
  });
  return result.uri;
}
