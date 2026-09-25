import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';
import { seed } from '../../database/scripts/seed.ts';
import { buildApp } from '../src/app.ts';
import { createPool } from '../src/db.ts';

/**
 * The real app on a real connection pool against the API test database. The
 * sample seed data is reloaded before every test, so each test starts from the
 * same known state (e.g. customer 1 has orders 14, 6 and 1; product 5 has 39
 * units available in warehouse 1).
 */
export function useApi() {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let seedClient: pg.Client;

  beforeAll(async () => {
    pool = createPool(inject('testDatabaseUrl'));
    app = buildApp({ db: pool });
    await app.ready();
    seedClient = new pg.Client({ connectionString: inject('testDatabaseUrl') });
    await seedClient.connect();
  });

  beforeEach(async () => {
    await seed(seedClient);
  });

  afterAll(async () => {
    await app?.close();
    await seedClient?.end();
    await pool?.end();
  });

  return {
    app: () => app,
    /** Direct database access for checking side effects. */
    query: <T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
      pool.query<T>(sql, params),
  };
}
