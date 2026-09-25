import type { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { connectToTestDatabase } from '../helpers/db.ts';
import { createInventory, type Id } from '../helpers/fixtures.ts';

// These tests need data that other connections can see, so unlike the other
// test files they commit their fixtures and delete them again afterwards.

const RESERVE = 'SELECT reserve_stock($1, $2, $3) AS remaining';

let admin: Client;
const openClients: Client[] = [];
// Server process id per connection, recorded while the connection is idle: a
// connection that is waiting for a lock cannot answer another query.
const backendPids = new Map<Client, number>();
const createdStock: { productId: Id; warehouseId: Id }[] = [];

beforeAll(async () => {
  admin = await connectToTestDatabase();
});

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.end()));
  backendPids.clear();
  for (const { productId, warehouseId } of createdStock.splice(0)) {
    await admin.query('DELETE FROM inventory WHERE product_id = $1', [productId]);
    const { rows } = await admin.query(
      'DELETE FROM products WHERE product_id = $1 RETURNING category_id',
      [productId],
    );
    await admin.query('DELETE FROM categories WHERE category_id = $1', [rows[0].category_id]);
    await admin.query('DELETE FROM warehouses WHERE warehouse_id = $1', [warehouseId]);
  }
});

afterAll(async () => {
  await admin.end();
});

async function openClient(): Promise<Client> {
  const client = await connectToTestDatabase();
  const { rows } = await client.query('SELECT pg_backend_pid() AS pid');
  backendPids.set(client, rows[0].pid);
  openClients.push(client);
  return client;
}

/** Committed stock that every connection can see. */
async function committedStock(onHand: number) {
  const stock = await createInventory(admin, { onHand });
  createdStock.push(stock);
  return stock;
}

async function reservedQuantity({ productId, warehouseId }: { productId: Id; warehouseId: Id }) {
  const { rows } = await admin.query(
    'SELECT quantity_reserved FROM inventory WHERE product_id = $1 AND warehouse_id = $2',
    [productId, warehouseId],
  );
  return rows[0].quantity_reserved as number;
}

/** Waits until `waiting` is blocked by a lock that `holder` owns. */
async function waitUntilBlocked(waiting: Client, holder: Client): Promise<void> {
  const waitingPid = backendPids.get(waiting);
  const holderPid = backendPids.get(holder);

  for (let attempt = 0; attempt < 250; attempt++) {
    const { rows } = await admin.query('SELECT $2::int = ANY (pg_blocking_pids($1)) AS blocked', [
      waitingPid,
      holderPid,
    ]);
    if (rows[0].blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Connection ${waitingPid} never waited for a lock held by ${holderPid}`);
}

/** Starts a query and captures its outcome, so the caller can act while it runs. */
function settle(promise: Promise<unknown>) {
  return promise.then(
    (result) => ({ ok: true as const, result }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

describe('reserve_stock under concurrency', () => {
  it('makes a competing reservation wait, then fail if the first one committed', async () => {
    const stock = await committedStock(5);
    const first = await openClient();
    const second = await openClient();

    await first.query('BEGIN');
    await first.query(RESERVE, [stock.productId, stock.warehouseId, 4]);

    // The second transaction wants 3 of the 5 units. It must wait for the
    // first transaction's row lock instead of reading the old stock level.
    await second.query('BEGIN');
    const secondAttempt = settle(second.query(RESERVE, [stock.productId, stock.warehouseId, 3]));
    await waitUntilBlocked(second, first);

    await first.query('COMMIT');

    const outcome = await secondAttempt;
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toMatchObject({
      code: 'JD001',
      message: expect.stringContaining('requested 3, available 1'),
    });
    await second.query('ROLLBACK');

    expect(await reservedQuantity(stock)).toBe(4);
  });

  it('lets the waiting reservation succeed if the first one rolled back', async () => {
    const stock = await committedStock(5);
    const first = await openClient();
    const second = await openClient();

    await first.query('BEGIN');
    await first.query(RESERVE, [stock.productId, stock.warehouseId, 4]);

    await second.query('BEGIN');
    const secondAttempt = settle(second.query(RESERVE, [stock.productId, stock.warehouseId, 3]));
    await waitUntilBlocked(second, first);

    await first.query('ROLLBACK');

    const outcome = await secondAttempt;
    expect(outcome).toMatchObject({ ok: true, result: { rows: [{ remaining: 2 }] } });
    await second.query('COMMIT');

    expect(await reservedQuantity(stock)).toBe(3);
  });

  it('never over-reserves when many connections compete for the last units', async () => {
    const stock = await committedStock(5);
    const clients = await Promise.all(Array.from({ length: 12 }, openClient));

    // Twelve customers try to reserve one unit each at the same time.
    const outcomes = await Promise.all(
      clients.map((client) => settle(client.query(RESERVE, [stock.productId, stock.warehouseId, 1]))),
    );

    const succeeded = outcomes.filter((o) => o.ok);
    const failed = outcomes.filter((o) => !o.ok);
    expect(succeeded).toHaveLength(5);
    expect(failed).toHaveLength(7);
    for (const outcome of failed) {
      expect(!outcome.ok && outcome.error).toMatchObject({ code: 'JD001' });
    }
    expect(await reservedQuantity(stock)).toBe(5);
  });
});

describe('reserve_stock in a larger transaction', () => {
  it('is rolled back when a later step of the same transaction fails', async () => {
    const plenty = await committedStock(10);
    const scarce = await committedStock(1);
    const client = await openClient();

    await client.query('BEGIN');
    await client.query(RESERVE, [plenty.productId, plenty.warehouseId, 3]);
    await expect(client.query(RESERVE, [scarce.productId, scarce.warehouseId, 2])).rejects.toMatchObject({
      code: 'JD001',
    });
    await client.query('ROLLBACK');

    expect(await reservedQuantity(plenty)).toBe(0);
    expect(await reservedQuantity(scarce)).toBe(0);
  });
});
