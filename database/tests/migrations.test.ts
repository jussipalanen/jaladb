import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadMigrations, migrate, migrationStatus, MIGRATIONS_DIR } from '../scripts/migrations.ts';
import { connectToTestDatabase } from './helpers/db.ts';

// The global setup has already migrated the test database. These tests use a
// plain connection because migrate() manages its own transactions.
describe('migrations', () => {
  let client: Client;
  let scratchDir: string;

  beforeAll(async () => {
    client = await connectToTestDatabase();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    scratchDir = await mkdtemp(path.join(tmpdir(), 'jaladb-migrations-'));
    await cp(MIGRATIONS_DIR, scratchDir, { recursive: true });
  });
  afterEach(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  it('records every migration file with its checksum', async () => {
    const files = await loadMigrations();
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    );

    expect(rows).toEqual(files.map(({ version, checksum }) => ({ version, checksum })));
  });

  it('creates the core tables', async () => {
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );

    expect(rows.map((r) => r.table_name)).toEqual([
      'categories',
      'customers',
      'inventory',
      'order_items',
      'orders',
      'products',
      'schema_migrations',
      'warehouses',
    ]);
  });

  it('is a no-op when everything is already applied', async () => {
    await expect(migrate(client)).resolves.toEqual([]);
    await expect(migrationStatus(client)).resolves.toMatchObject({ pending: [] });
  });

  it('refuses to run when an applied migration has been edited', async () => {
    const [first] = await loadMigrations();
    await writeFile(path.join(scratchDir, first!.file), `${first!.sql}\n-- edited\n`);

    await expect(migrate(client, scratchDir)).rejects.toThrow(/Checksum mismatch/);
  });

  it('rolls back a failing migration completely', async () => {
    await writeFile(
      path.join(scratchDir, '9999_broken_migration.sql'),
      `CREATE TABLE broken_migration_probe (id INTEGER);
       SELECT 1 / 0;`,
    );

    await expect(migrate(client, scratchDir)).rejects.toThrow(
      /9999_broken_migration\.sql failed: division by zero/,
    );

    const { rows } = await client.query(
      `SELECT to_regclass('broken_migration_probe') AS probe,
              EXISTS (SELECT 1 FROM schema_migrations WHERE version = '9999') AS recorded`,
    );
    expect(rows[0]).toEqual({ probe: null, recorded: false });
  });
});
