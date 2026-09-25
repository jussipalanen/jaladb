import type { TestProject } from 'vitest/node';
import { connect } from '../../../database/scripts/db.ts';
import { migrate } from '../../../database/scripts/migrations.ts';
import { loadConfig } from '../../src/config.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

/**
 * Creates a fresh "<database>_api_test" database next to the development
 * database and applies all migrations with the same tooling the database
 * tests use. It is separate from the database tests' "<database>_test", so
 * both suites can run at the same time.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // Same configuration as the API itself (root .env or environment).
  const adminUrl = loadConfig().databaseUrl;

  const testUrl = new URL(adminUrl);
  const testDatabase = `${decodeURIComponent(testUrl.pathname.slice(1))}_api_test`;
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
