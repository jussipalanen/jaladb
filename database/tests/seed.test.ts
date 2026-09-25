import { beforeEach, describe, expect, it } from 'vitest';
import { loadSeedFiles } from '../scripts/seed.ts';
import { useRollbackClient } from './helpers/db.ts';

// The seed SQL runs inside the per-test transaction and is rolled back, so the
// test database stays empty for the other test files.
const db = useRollbackClient();

async function loadSeed(): Promise<void> {
  for (const { sql } of await loadSeedFiles()) {
    await db().query(sql);
  }
}

async function tableCounts(): Promise<Record<string, number>> {
  const { rows } = await db().query(`
    SELECT
      (SELECT count(*) FROM categories)::int  AS categories,
      (SELECT count(*) FROM products)::int    AS products,
      (SELECT count(*) FROM warehouses)::int  AS warehouses,
      (SELECT count(*) FROM customers)::int   AS customers,
      (SELECT count(*) FROM inventory)::int   AS inventory,
      (SELECT count(*) FROM orders)::int      AS orders,
      (SELECT count(*) FROM order_items)::int AS order_items
  `);
  return rows[0];
}

const expectedCounts = {
  categories: 6,
  products: 24,
  warehouses: 3,
  customers: 12,
  inventory: 42,
  orders: 18,
  order_items: 32,
};

describe('seed data', () => {
  beforeEach(loadSeed);

  it('loads the expected number of rows', async () => {
    expect(await tableCounts()).toEqual(expectedCounts);
  });

  it('can be reloaded without duplicating data', async () => {
    await loadSeed();

    expect(await tableCounts()).toEqual(expectedCounts);
    const { rows } = await db().query('SELECT min(order_id)::int AS first_order FROM orders');
    expect(rows[0]).toEqual({ first_order: 1 });
  });

  it('stores order totals that match the order lines', async () => {
    const { rows } = await db().query(`
      SELECT o.order_id
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.order_id
      GROUP BY o.order_id, o.total_amount
      HAVING o.total_amount <> sum(oi.line_total)
    `);
    expect(rows).toEqual([]);
  });

  it('gives every order at least one line', async () => {
    const { rows } = await db().query(`
      SELECT order_id FROM orders o
      WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.order_id)
    `);
    expect(rows).toEqual([]);
  });

  it('reserves exactly the units of open orders', async () => {
    const { rows } = await db().query(`
      WITH open_demand AS (
        SELECT o.warehouse_id, oi.product_id, sum(oi.quantity)::int AS quantity
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.order_id
        WHERE o.status IN ('pending', 'paid')
        GROUP BY o.warehouse_id, oi.product_id
      )
      SELECT i.product_id, i.warehouse_id, i.quantity_reserved, d.quantity AS open_quantity
      FROM inventory i
      FULL JOIN open_demand d USING (product_id, warehouse_id)
      WHERE i.quantity_reserved IS DISTINCT FROM coalesce(d.quantity, 0)
    `);
    expect(rows).toEqual([]);
  });

  it('includes open orders, closed orders and a customer without orders', async () => {
    const { rows } = await db().query(`
      SELECT
        (SELECT array_agg(DISTINCT status ORDER BY status) FROM orders) AS statuses,
        (SELECT count(*)::int FROM customers c
         WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)) AS customers_without_orders
    `);
    expect(rows[0]).toEqual({
      statuses: ['cancelled', 'delivered', 'paid', 'pending', 'shipped'],
      customers_without_orders: 1,
    });
  });
});
