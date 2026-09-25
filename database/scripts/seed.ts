import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from 'pg';
import { inTransaction } from './db.ts';

export const SEEDS_DIR = fileURLToPath(new URL('../seeds/', import.meta.url));

export interface SeedFile {
  file: string;
  sql: string;
}

export async function loadSeedFiles(dir = SEEDS_DIR): Promise<SeedFile[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  return Promise.all(
    files.map(async (file) => ({ file, sql: await readFile(path.join(dir, file), 'utf8') })),
  );
}

/**
 * Replaces all data with the seed dataset. All seed files run in a single
 * transaction: either the whole dataset is loaded or nothing changes.
 */
export async function seed(client: Client, dir = SEEDS_DIR): Promise<string[]> {
  const seeds = await loadSeedFiles(dir);
  await inTransaction(client, async () => {
    for (const { sql } of seeds) {
      await client.query(sql);
    }
  });
  return seeds.map((s) => s.file);
}
