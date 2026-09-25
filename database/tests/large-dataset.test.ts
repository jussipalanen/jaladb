import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LARGE_SEEDS_DIR, loadSeedFiles, SEEDS_DIR } from '../scripts/seed.ts';
import { connectToTestDatabase } from './helpers/db.ts';

// Loads the normal seed plus the generator at 2 % of its default size
// (~2,000 orders) once, inside a transaction that is rolled back at the end.
const SCALE = '0.02';

let client: Client;

beforeAll(async () => {
  client = await connectToTestDatabase();
  await client.query('BEGIN');
  await client.query(`SET LOCAL jaladb.seed_scale = '${SCALE}'`);
  for (const dir of [SEEDS_DIR, LARGE_SEEDS_DIR]) {
    for (const { sql } of await loadSeedFiles(dir)) {
      await client.query(sql);
    }
  }
});

afterAll(async () => {
  await client.query('ROLLBACK');
  await client.end();
});

describe('large dataset generator', () => {
  it('adds generated rows on top of the normal seed', async () => {
    const { rows } = await client.query(`
      SELECT
        (SELECT count(*) FROM products  WHERE sku LIKE 'GEN-%')::int                    AS products,
        (SELECT count(*) FROM customers WHERE email LIKE 'customer%@example.com')::int AS customers,
        (SELECT count(*) FROM orders)::int                                              AS orders,
        (SELECT count(*) FROM customers WHERE email = 'aino.esimerkki@example.com')::int AS seed_customer
    `);

    expect(rows[0]).toEqual({ products: 200, customers: 200, orders: 2000 + 18, seed_customer: 1 });
  });

  it('gives every generated order 1-4 lines', async () => {
    const { rows } = await client.query(`
      SELECT min(line_count)::int AS min, max(line_count)::int AS max
      FROM (
        SELECT count(oi.order_item_id) AS line_count
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.order_id
        GROUP BY o.order_id
      ) AS per_order
    `);

    expect(rows[0].min).toBeGreaterThanOrEqual(1);
    expect(rows[0].max).toBeLessThanOrEqual(4);
  });

  it('stores order totals that match the order lines', async () => {
    const { rows } = await client.query(`
      SELECT o.order_id
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.order_id
      GROUP BY o.order_id, o.total_amount
      HAVING o.total_amount <> sum(oi.line_total)
    `);

    expect(rows).toEqual([]);
  });

  it('reserves exactly the units of open orders', async () => {
    const { rows } = await client.query(`
      WITH open_demand AS (
        SELECT o.warehouse_id, oi.product_id, sum(oi.quantity)::int AS quantity
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.order_id
        WHERE o.status IN ('pending', 'paid')
        GROUP BY o.warehouse_id, oi.product_id
      )
      SELECT i.product_id, i.warehouse_id
      FROM inventory i
      FULL JOIN open_demand d USING (product_id, warehouse_id)
      WHERE i.quantity_reserved IS DISTINCT FROM coalesce(d.quantity, 0)
    `);

    expect(rows).toEqual([]);
  });
});

describe('orders_customer_id_idx', () => {
  interface PlanNode {
    'Node Type': string;
    'Relation Name'?: string;
    'Index Name'?: string;
    Plans?: PlanNode[];
  }

  const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];

  it('is used by the planner to find one customer’s orders', async () => {
    // A generated customer with a typical number of orders.
    const { rows: customers } = await client.query(`
      SELECT customer_id FROM orders
      GROUP BY customer_id
      ORDER BY count(*), customer_id
      OFFSET (SELECT count(DISTINCT customer_id) / 2 FROM orders)
      LIMIT 1
    `);

    // The filter and sort of get_customer_orders(). Planner statistics are
    // fresh because the generator ends with ANALYZE.
    const { rows } = await client.query(
      `EXPLAIN (FORMAT JSON)
       SELECT o.order_id FROM orders o
       WHERE o.customer_id = $1
       ORDER BY o.created_at DESC, o.order_id DESC`,
      [customers[0].customer_id],
    );
    const nodes = flatten(rows[0]['QUERY PLAN'][0].Plan);

    expect(nodes.map((n) => n['Index Name'])).toContain('orders_customer_id_idx');
    expect(nodes).not.toContainEqual(
      expect.objectContaining({ 'Node Type': 'Seq Scan', 'Relation Name': 'orders' }),
    );
  });
});
