import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

/**
 * A tiny key→value JSON file store. Mirrors the original file-based stores so
 * local development keeps working without any AWS setup.
 */
export function createFileCollection<T>(fileName: string) {
  const filePath = (): string => path.join(env.dataDir, fileName);

  async function readAll(): Promise<Record<string, T>> {
    try {
      const raw = await fs.readFile(filePath(), 'utf8');
      return JSON.parse(raw) as Record<string, T>;
    } catch {
      return {};
    }
  }

  async function writeAll(data: Record<string, T>): Promise<void> {
    await fs.mkdir(env.dataDir, { recursive: true });
    await fs.writeFile(filePath(), JSON.stringify(data, null, 2), 'utf8');
  }

  return {
    async get(key: string): Promise<T | null> {
      const all = await readAll();
      return all[key] ?? null;
    },
    async values(): Promise<T[]> {
      return Object.values(await readAll());
    },
    async put(key: string, value: T): Promise<void> {
      const all = await readAll();
      all[key] = value;
      await writeAll(all);
    },
    async delete(key: string): Promise<void> {
      const all = await readAll();
      if (!(key in all)) return;
      delete all[key];
      await writeAll(all);
    },
  };
}
