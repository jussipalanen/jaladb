import type { Client } from 'pg';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { connectToTestDatabase } from './db.ts';
import {
  createCustomer,
  createInventory,
  createProduct,
  type Id,
  type StockLevels,
  stockProduct,
} from './fixtures.ts';

export interface Stock {
  productId: Id;
  warehouseId: Id;
}

/**
 * Setup for tests with several real connections. Other connections can only
 * see committed rows, so fixtures are committed through an admin connection
 * and deleted again after each test, together with any orders placed for the
 * test customers.
 */
export function useCommittedFixtures() {
  let admin: Client | undefined;
  const openClients: Client[] = [];
  // Server process id per connection, recorded while the connection is idle:
  // a connection that is waiting for a lock cannot answer another query.
  const backendPids = new Map<Client, number>();
  const createdStock: Stock[] = [];
  const createdCustomers: Id[] = [];

  beforeAll(async () => {
    admin = await connectToTestDatabase();
  });

  afterEach(async () => {
    await Promise.all(openClients.splice(0).map((client) => client.end()));
    backendPids.clear();

    const db = admin!;
    for (const customerId of createdCustomers.splice(0)) {
      // order_items are removed by ON DELETE CASCADE.
      await db.query('DELETE FROM orders WHERE customer_id = $1', [customerId]);
      await db.query('DELETE FROM customers WHERE customer_id = $1', [customerId]);
    }
    // Delete in dependency order; several products may share a warehouse.
    const stock = createdStock.splice(0);
    const productIds = stock.map((s) => s.productId);
    const warehouseIds = [...new Set(stock.map((s) => s.warehouseId))];
    if (stock.length > 0) {
      await db.query('DELETE FROM inventory WHERE product_id = ANY ($1::bigint[])', [productIds]);
      const { rows } = await db.query(
        'DELETE FROM products WHERE product_id = ANY ($1::bigint[]) RETURNING category_id',
        [productIds],
      );
      await db.query('DELETE FROM categories WHERE category_id = ANY ($1::bigint[])', [
        rows.map((r) => r.category_id),
      ]);
      await db.query('DELETE FROM warehouses WHERE warehouse_id = ANY ($1::bigint[])', [warehouseIds]);
    }
  });

  afterAll(async () => {
    await admin?.end();
  });

  return {
    /** Connection for committed setup and for checking results. */
    admin: () => admin!,

    /** A new connection, closed automatically after the test. */
    async openClient(): Promise<Client> {
      const client = await connectToTestDatabase();
      const { rows } = await client.query('SELECT pg_backend_pid() AS pid');
      backendPids.set(client, rows[0].pid);
      openClients.push(client);
      return client;
    },

    /** Committed stock of a new product in a new warehouse. */
    async stock(levels: StockLevels): Promise<Stock> {
      const stock = await createInventory(admin!, levels);
      createdStock.push(stock);
      return stock;
    },

    /**
     * Several committed products stocked in one shared warehouse, in ascending
     * product_id order.
     */
    async stockedProducts(count: number, levels: StockLevels): Promise<Stock[]> {
      const first = await createInventory(admin!, levels);
      createdStock.push(first);
      const stock = [first];
      for (let i = 1; i < count; i++) {
        const productId = await createProduct(admin!);
        await stockProduct(admin!, productId, first.warehouseId, levels);
        const next = { productId, warehouseId: first.warehouseId };
        createdStock.push(next);
        stock.push(next);
      }
      return stock;
    },

    /** Committed customer; their orders are deleted after the test. */
    async customer(): Promise<Id> {
      const customerId = await createCustomer(admin!);
      createdCustomers.push(customerId);
      return customerId;
    },

    async reservedQuantity({ productId, warehouseId }: Stock): Promise<number> {
      const { rows } = await admin!.query(
        'SELECT quantity_reserved FROM inventory WHERE product_id = $1 AND warehouse_id = $2',
        [productId, warehouseId],
      );
      return rows[0].quantity_reserved;
    },

    /** Waits until `waiting` is blocked by a lock that `holder` owns. */
    async waitUntilBlocked(waiting: Client, holder: Client): Promise<void> {
      const waitingPid = backendPids.get(waiting);
      const holderPid = backendPids.get(holder);
      for (let attempt = 0; attempt < 250; attempt++) {
        const { rows } = await admin!.query(
          'SELECT $2::int = ANY (pg_blocking_pids($1)) AS blocked',
          [waitingPid, holderPid],
        );
        if (rows[0].blocked) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Connection ${waitingPid} never waited for a lock held by ${holderPid}`);
    },
  };
}

export type Settled = { ok: true; result: unknown } | { ok: false; error: unknown };

/** Captures a query's outcome without throwing, so the caller can act while it runs. */
export function settle(promise: Promise<unknown>): Promise<Settled> {
  return promise.then(
    (result) => ({ ok: true as const, result }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}
