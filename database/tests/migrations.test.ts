import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DATABASE_DIR,
  loadMigrations,
  loadRepeatables,
  migrate,
  migrationStatus,
  REPEATABLE_DIRS,
} from '../scripts/migrations.ts';
import { connectToTestDatabase } from './helpers/db.ts';

// The global setup has already migrated the test database. These tests use a
// plain connection because migrate() manages its own transactions. Tests that
// need modified SQL files work on a scratch copy of the database directory.
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
    for (const dir of ['migrations', ...REPEATABLE_DIRS]) {
      await cp(path.join(DATABASE_DIR, dir), path.join(scratchDir, dir), {
        recursive: true,
        force: true,
      }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  });
  afterEach(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  describe('versioned migrations', () => {
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
        'schema_repeatables',
        'warehouses',
      ]);
    });

    it('is a no-op when everything is already applied', async () => {
      await expect(migrate(client)).resolves.toEqual([]);
      await expect(migrationStatus(client)).resolves.toMatchObject({ pending: [] });
    });

    it('refuses to run when an applied migration has been edited', async () => {
      const [first] = await loadMigrations();
      await writeFile(path.join(scratchDir, 'migrations', first!.file), `${first!.sql}\n-- edited\n`);

      await expect(migrate(client, scratchDir)).rejects.toThrow(/Checksum mismatch/);
    });

    it('rolls back a failing migration completely', async () => {
      await writeFile(
        path.join(scratchDir, 'migrations', '9999_broken_migration.sql'),
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

  describe('repeatable files', () => {
    const functionComment = async () => {
      const { rows } = await client.query(
        "SELECT obj_description('get_customer_orders(bigint)'::regprocedure) AS comment",
      );
      return rows[0].comment as string;
    };

    it('records every repeatable file with its checksum', async () => {
      const scripts = await loadRepeatables();
      const { rows } = await client.query<{ file: string; checksum: string }>(
        'SELECT file, checksum FROM schema_repeatables ORDER BY file',
      );

      expect(scripts.length).toBeGreaterThan(0);
      expect(rows).toEqual(
        scripts
          .map(({ file, checksum }) => ({ file, checksum }))
          .sort((a, b) => a.file.localeCompare(b.file)),
      );
    });

    it('applies functions before views before triggers', async () => {
      for (const [dir, name] of [
        ['triggers', 'a_trigger.sql'],
        ['views', 'a_view.sql'],
        ['functions', 'z_function.sql'],
      ] as const) {
        await mkdir(path.join(scratchDir, dir), { recursive: true });
        await writeFile(path.join(scratchDir, dir, name), 'SELECT 1;');
      }

      const files = (await loadRepeatables(scratchDir)).map((r) => r.file);

      expect(files.indexOf('functions/z_function.sql')).toBeLessThan(files.indexOf('views/a_view.sql'));
      expect(files.indexOf('views/a_view.sql')).toBeLessThan(files.indexOf('triggers/a_trigger.sql'));
    });

    it('re-applies a file only when its content changes', async () => {
      const file = path.join(scratchDir, 'functions', 'get_customer_orders.sql');
      const original = await readFile(file, 'utf8');
      const originalComment = await functionComment();
      await writeFile(file, original.replace(originalComment, 'Changed by test'));

      try {
        await expect(migrate(client, scratchDir)).resolves.toEqual(['functions/get_customer_orders.sql']);
        expect(await functionComment()).toBe('Changed by test');
        await expect(migrate(client, scratchDir)).resolves.toEqual([]);
      } finally {
        // Restore the real definition for the other tests.
        await expect(migrate(client)).resolves.toEqual(['functions/get_customer_orders.sql']);
      }
      expect(await functionComment()).toBe(originalComment);
    });

    it('rolls back a failing file completely', async () => {
      await writeFile(
        path.join(scratchDir, 'functions', 'zz_broken.sql'),
        `CREATE OR REPLACE FUNCTION broken_repeatable_probe() RETURNS INTEGER
           LANGUAGE sql AS 'SELECT 1';
         SELECT 1 / 0;`,
      );

      await expect(migrate(client, scratchDir)).rejects.toThrow(
        /functions\/zz_broken\.sql failed: division by zero/,
      );

      const { rows } = await client.query(
        `SELECT to_regproc('broken_repeatable_probe') AS probe,
                EXISTS (SELECT 1 FROM schema_repeatables WHERE file = 'functions/zz_broken.sql') AS recorded`,
      );
      expect(rows[0]).toEqual({ probe: null, recorded: false });
    });

    it('reports new files as pending', async () => {
      await writeFile(path.join(scratchDir, 'functions', 'zz_new.sql'), 'SELECT 1;');

      const status = await migrationStatus(client, scratchDir);

      expect(status.pending).toEqual(['functions/zz_new.sql']);
      expect(status.applied).toContain('functions/get_customer_orders.sql');
    });
  });
});
