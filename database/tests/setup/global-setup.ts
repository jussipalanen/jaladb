import type { TestProject } from 'vitest/node';
import { connect, getDatabaseUrl, loadEnv } from '../../scripts/db.ts';
import { migrate } from '../../scripts/migrations.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

/**
 * Creates a fresh "<database>_test" database next to the development database,
 * applies all migrations to it, and drops it after the test run. Every run
 * therefore also verifies that the migrations apply cleanly to an empty database.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  loadEnv();
  const adminUrl = getDatabaseUrl();

  const testUrl = new URL(adminUrl);
  const testDatabase = `${decodeURIComponent(testUrl.pathname.slice(1))}_test`;
  testUrl.pathname = `/${encodeURIComponent(testDatabase)}`;

  const admin = await connect(adminUrl);
  const quotedName = admin.escapeIdentifier(testDatabase);
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${quotedName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${quotedName}`);
  } finally {
    await admin.end();
  }

  const client = await connect(testUrl.toString());
  try {
    await migrate(client);
  } finally {
    await client.end();
  }

  project.provide('testDatabaseUrl', testUrl.toString());

  return async () => {
    const teardown = await connect(adminUrl);
    try {
      await teardown.query(`DROP DATABASE IF EXISTS ${quotedName} WITH (FORCE)`);
    } finally {
      await teardown.end();
    }
  };
}
