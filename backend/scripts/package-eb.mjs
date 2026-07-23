// Builds a deployable ZIP for AWS Elastic Beanstalk console upload.
// Contents: dist/, Procfile, .ebextensions/, .platform/, package.json,
// package-lock.json. Excludes node_modules/, src/, .env, data/.
//
// Usage: npm run eb:zip  (runs the build first)

import { createWriteStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'build');
const outFile = path.join(outDir, 'embrace-hd-backend-eb.zip');

if (!existsSync(path.join(root, 'dist', 'index.js'))) {
  console.error('dist/index.js not found — run `npm run build` first.');
  process.exit(1);
}

await mkdir(outDir, { recursive: true });

const output = createWriteStream(outFile);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  const mb = (archive.pointer() / (1024 * 1024)).toFixed(2);
  console.log(`\nCreated ${path.relative(root, outFile)} (${mb} MB)`);
  console.log('Upload this ZIP in the Elastic Beanstalk console.');
});

archive.on('warning', (err) => {
  if (err.code === 'ENOENT') console.warn(err.message);
  else throw err;
});
archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);

// Compiled app + runtime manifests (EB runs `npm ci` from package-lock)
archive.directory(path.join(root, 'dist'), 'dist');
archive.file(path.join(root, 'package.json'), { name: 'package.json' });
archive.file(path.join(root, 'package-lock.json'), { name: 'package-lock.json' });
archive.file(path.join(root, 'Procfile'), { name: 'Procfile' });

// EB platform config (must be at the ZIP root)
archive.directory(path.join(root, '.ebextensions'), '.ebextensions');
archive.directory(path.join(root, '.platform'), '.platform');

await archive.finalize();
