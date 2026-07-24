import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src', 'storage', 'schema.sql');
const destDir = path.join(root, 'dist', 'storage');
const dest = path.join(destDir, 'schema.sql');

await mkdir(destDir, { recursive: true });
await copyFile(src, dest);
console.log('Copied schema.sql → dist/storage/');
