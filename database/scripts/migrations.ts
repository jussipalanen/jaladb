import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from 'pg';
import { inTransaction } from './db.ts';

/** Root of the database sources: migrations/, functions/, views/, triggers/. */
export const DATABASE_DIR = fileURLToPath(new URL('../', import.meta.url));

/**
 * Directories of repeatable object definitions, applied in this order after
 * the versioned migrations. Views may use functions and triggers call
 * functions, so functions come first.
 */
export const REPEATABLE_DIRS = ['functions', 'views', 'triggers'] as const;

// Arbitrary application-wide key for pg_advisory_lock, so two migration runs
// against the same database cannot interleave.
const MIGRATION_LOCK_KEY = 4_815_162_342;

const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const REPEATABLE_FILE_PATTERN = /^[a-z0-9_]+\.sql$/;

interface SqlFile {
  /** Path relative to the database directory for repeatables, file name for migrations. */
  file: string;
  sql: string;
  checksum: string;
}

export interface Migration extends SqlFile {
  version: string;
  name: string;
}

export type RepeatableScript = SqlFile;

export interface MigrationStatus {
  applied: string[];
  pending: string[];
}

const checksum = (sql: string) => createHash('sha256').update(sql).digest('hex');

async function listSqlFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function loadMigrations(root = DATABASE_DIR): Promise<Migration[]> {
  const dir = path.join(root, 'migrations');
  const files = await listSqlFiles(dir);

  return Promise.all(
    files.map(async (file) => {
      const match = MIGRATION_FILE_PATTERN.exec(file);
      if (!match) {
        throw new Error(`Invalid migration file name "${file}". Expected NNNN_description.sql`);
      }
      const sql = await readFile(path.join(dir, file), 'utf8');
      return { version: match[1]!, name: match[2]!, file, sql, checksum: checksum(sql) };
    }),
  );
}

export async function loadRepeatables(root = DATABASE_DIR): Promise<RepeatableScript[]> {
  const scripts: RepeatableScript[] = [];
  for (const dir of REPEATABLE_DIRS) {
    for (const name of await listSqlFiles(path.join(root, dir))) {
      if (!REPEATABLE_FILE_PATTERN.test(name)) {
        throw new Error(`Invalid file name "${dir}/${name}". Expected lower_snake_case.sql`);
      }
      const sql = await readFile(path.join(root, dir, name), 'utf8');
      scripts.push({ file: `${dir}/${name}`, sql, checksum: checksum(sql) });
    }
  }
  return scripts;
}

async function ensureTrackingTables(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      name        TEXT        NOT NULL,
      checksum    TEXT        NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS schema_repeatables (
      file        TEXT PRIMARY KEY,
      checksum    TEXT        NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function appliedChecksums(client: Client, table: 'schema_migrations' | 'schema_repeatables') {
  const key = table === 'schema_migrations' ? 'version' : 'file';
  const { rows } = await client.query<{ key: string; checksum: string }>(
    `SELECT ${key} AS key, checksum FROM ${table}`,
  );
  return new Map(rows.map((row) => [row.key, row.checksum]));
}

/** Fails if an applied migration has been edited or removed since it ran. */
function verifyApplied(applied: Map<string, string>, migrations: Migration[]): void {
  for (const [version, applyChecksum] of applied) {
    const migration = migrations.find((m) => m.version === version);
    if (!migration) {
      throw new Error(`Applied migration ${version} is missing from the migrations directory`);
    }
    if (migration.checksum !== applyChecksum) {
      throw new Error(
        `Checksum mismatch for applied migration ${migration.file}. ` +
          'Applied migrations must not be edited; add a new migration instead.',
      );
    }
  }
}

async function applyEach<T extends SqlFile>(
  client: Client,
  scripts: T[],
  record: (script: T) => Promise<unknown>,
): Promise<void> {
  for (const script of scripts) {
    try {
      await inTransaction(client, async () => {
        await client.query(script.sql);
        await record(script);
      });
    } catch (error) {
      throw new Error(`${script.file} failed: ${(error as Error).message}`, { cause: error });
    }
  }
}

/**
 * Brings the database up to date:
 *
 * 1. Versioned migrations (`migrations/NNNN_*.sql`) are applied once, in
 *    version order. Editing an applied migration is an error.
 * 2. Repeatable files (`functions/`, `views/`, `triggers/`) are applied when
 *    they are new or their content has changed. They must be idempotent
 *    (`CREATE OR REPLACE ...`).
 *
 * Every file runs in its own transaction together with its tracking row, so a
 * failing file leaves no partial changes behind.
 *
 * Returns the files that were applied.
 */
export async function migrate(client: Client, root = DATABASE_DIR): Promise<string[]> {
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  try {
    await ensureTrackingTables(client);

    const migrations = await loadMigrations(root);
    const appliedMigrations = await appliedChecksums(client, 'schema_migrations');
    verifyApplied(appliedMigrations, migrations);
    const pendingMigrations = migrations.filter((m) => !appliedMigrations.has(m.version));

    await applyEach(client, pendingMigrations, (m) =>
      client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
        m.version,
        m.name,
        m.checksum,
      ]),
    );

    const repeatables = await loadRepeatables(root);
    const appliedRepeatables = await appliedChecksums(client, 'schema_repeatables');
    const pendingRepeatables = repeatables.filter(
      (r) => appliedRepeatables.get(r.file) !== r.checksum,
    );

    await applyEach(client, pendingRepeatables, (r) =>
      client.query(
        `INSERT INTO schema_repeatables (file, checksum) VALUES ($1, $2)
         ON CONFLICT (file) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()`,
        [r.file, r.checksum],
      ),
    );

    return [...pendingMigrations, ...pendingRepeatables].map((s) => s.file);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  }
}

export async function migrationStatus(client: Client, root = DATABASE_DIR): Promise<MigrationStatus> {
  await ensureTrackingTables(client);

  const migrations = await loadMigrations(root);
  const appliedMigrations = await appliedChecksums(client, 'schema_migrations');
  verifyApplied(appliedMigrations, migrations);

  const repeatables = await loadRepeatables(root);
  const appliedRepeatables = await appliedChecksums(client, 'schema_repeatables');
  const isCurrent = (r: RepeatableScript) => appliedRepeatables.get(r.file) === r.checksum;

  return {
    applied: [
      ...migrations.filter((m) => appliedMigrations.has(m.version)).map((m) => m.file),
      ...repeatables.filter(isCurrent).map((r) => r.file),
    ],
    pending: [
      ...migrations.filter((m) => !appliedMigrations.has(m.version)).map((m) => m.file),
      ...repeatables.filter((r) => !isCurrent(r)).map((r) => r.file),
    ],
  };
}
