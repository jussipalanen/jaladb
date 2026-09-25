import { Client, DatabaseError } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, expect, inject } from 'vitest';

/** SQLSTATE codes asserted by the tests. */
export const SqlState = {
  // ON DELETE RESTRICT reports restrict_violation (PostgreSQL 18+); other
  // foreign key failures report foreign_key_violation.
  RESTRICT_VIOLATION: '23001',
  NOT_NULL_VIOLATION: '23502',
  FOREIGN_KEY_VIOLATION: '23503',
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  GENERATED_ALWAYS: '428C9',
} as const;

export async function connectToTestDatabase(): Promise<Client> {
  const client = new Client({ connectionString: inject('testDatabaseUrl') });
  await client.connect();
  return client;
}

/**
 * Gives the test file one connection and wraps every test in a transaction
 * that is rolled back afterwards, so tests never see each other's data.
 */
export function useRollbackClient(): () => Client {
  let client: Client | undefined;

  beforeAll(async () => {
    client = await connectToTestDatabase();
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await client!.query('BEGIN');
  });
  afterEach(async () => {
    await client!.query('ROLLBACK');
  });

  return () => client!;
}

/**
 * Asserts that PostgreSQL rejects a statement with the given SQLSTATE (and
 * constraint name or message, when given; message accepts asymmetric matchers
 * such as expect.stringContaining). A savepoint keeps the surrounding test
 * transaction usable after the expected error.
 */
export async function expectDbError(
  client: Client,
  sql: string,
  params: unknown[],
  expected: { code: string; constraint?: string; message?: unknown },
): Promise<void> {
  await client.query('SAVEPOINT expect_db_error');
  let error: unknown;
  try {
    await client.query(sql, params);
  } catch (caught) {
    error = caught;
  }
  await client.query('ROLLBACK TO SAVEPOINT expect_db_error');

  if (error === undefined) {
    throw new Error(`Expected statement to fail with SQLSTATE ${expected.code}, but it succeeded`);
  }
  expect(error).toBeInstanceOf(DatabaseError);
  expect(error).toMatchObject(expected);
}
