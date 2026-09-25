import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from 'pg';
import { inTransaction } from './db.ts';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

// Arbitrary application-wide key for pg_advisory_lock, so two migration runs
// against the same database cannot interleave.
const MIGRATION_LOCK_KEY = 4_815_162_342;

const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface Migration {
  version: string;
  name: string;
  file: string;
  sql: string;
  checksum: string;
}

export interface MigrationStatus {
  applied: string[];
  pending: string[];
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();

  return Promise.all(
    files.map(async (file) => {
      const match = MIGRATION_FILE_PATTERN.exec(file);
      if (!match) {
        throw new Error(`Invalid migration file name "${file}". Expected NNNN_description.sql`);
      }
      const sql = await readFile(path.join(dir, file), 'utf8');
      return {
        version: match[1]!,
        name: match[2]!,
        file,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    }),
  );
}

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      name        TEXT        NOT NULL,
      checksum    TEXT        NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedChecksums(client: Client): Promise<Map<string, string>> {
  const { rows } = await client.query<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations ORDER BY version',
  );
  return new Map(rows.map((row) => [row.version, row.checksum]));
}

/** Fails if an applied migration has been edited or removed since it ran. */
function verifyApplied(applied: Map<string, string>, migrations: Migration[]): void {
  for (const [version, checksum] of applied) {
    const migration = migrations.find((m) => m.version === version);
    if (!migration) {
      throw new Error(`Applied migration ${version} is missing from the migrations directory`);
    }
    if (migration.checksum !== checksum) {
      throw new Error(
        `Checksum mismatch for applied migration ${migration.file}. ` +
          'Applied migrations must not be edited; add a new migration instead.',
      );
    }
  }
}

/**
 * Applies all pending migrations in version order. Each migration runs in its
 * own transaction together with its schema_migrations row, so a failing
 * migration leaves no partial changes behind.
 *
 * Returns the file names of the migrations that were applied.
 */
export async function migrate(client: Client, dir = MIGRATIONS_DIR): Promise<string[]> {
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  try {
    await ensureMigrationsTable(client);
    const migrations = await loadMigrations(dir);
    const applied = await appliedChecksums(client);
    verifyApplied(applied, migrations);

    const pending = migrations.filter((m) => !applied.has(m.version));
    for (const migration of pending) {
      try {
        await inTransaction(client, async () => {
          await client.query(migration.sql);
          await client.query(
            'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
            [migration.version, migration.name, migration.checksum],
          );
        });
      } catch (error) {
        throw new Error(`Migration ${migration.file} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }
    }
    return pending.map((m) => m.file);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  }
}

export async function migrationStatus(client: Client, dir = MIGRATIONS_DIR): Promise<MigrationStatus> {
  await ensureMigrationsTable(client);
  const migrations = await loadMigrations(dir);
  const applied = await appliedChecksums(client);
  verifyApplied(applied, migrations);
  return {
    applied: migrations.filter((m) => applied.has(m.version)).map((m) => m.file),
    pending: migrations.filter((m) => !applied.has(m.version)).map((m) => m.file),
  };
}
