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

  it('records one status history row per order (statement-level trigger)', async () => {
    const { rows } = await client.query(`
      SELECT (SELECT count(*) FROM orders)::int AS orders,
             (SELECT count(*) FROM order_status_history)::int AS history,
             (SELECT count(*) FROM order_status_history h JOIN orders o USING (order_id)
              WHERE h.old_status IS NULL AND h.new_status = o.status AND h.changed_at = o.created_at)::int AS matching
    `);

    expect(rows[0]).toEqual({ orders: 2018, history: 2018, matching: 2018 });
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

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];

/** All nodes of the plan PostgreSQL chooses for a query. */
async function planNodes(sql: string, params: unknown[]): Promise<PlanNode[]> {
  const { rows } = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`, params);
  return flatten(rows[0]['QUERY PLAN'][0].Plan);
}

describe('orders_customer_id_idx', () => {
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
    const nodes = await planNodes(
      `SELECT o.order_id FROM orders o
       WHERE o.customer_id = $1
       ORDER BY o.created_at DESC, o.order_id DESC`,
      [customers[0].customer_id],
    );

    expect(nodes.map((n) => n['Index Name'])).toContain('orders_customer_id_idx');
    expect(nodes).not.toContainEqual(
      expect.objectContaining({ 'Node Type': 'Seq Scan', 'Relation Name': 'orders' }),
    );
  });
});

describe('order_status_history_order_id_idx', () => {
  it('is used to read the history of one order', async () => {
    const { rows } = await client.query('SELECT max(order_id) AS order_id FROM orders');

    const nodes = await planNodes(
      `SELECT h.old_status, h.new_status, h.changed_at
       FROM order_status_history h
       WHERE h.order_id = $1
       ORDER BY h.changed_at, h.history_id`,
      [rows[0].order_id],
    );

    expect(nodes.map((n) => n['Index Name'])).toContain('order_status_history_order_id_idx');
    expect(nodes).not.toContainEqual(expect.objectContaining({ 'Node Type': 'Seq Scan' }));
  });
});

describe('orders_created_at_brin_idx', () => {
  it('is a BRIN index with 32-page block ranges and autosummarize', async () => {
    const { rows } = await client.query(`
      SELECT am.amname, c.reloptions
      FROM pg_class c JOIN pg_am am ON am.oid = c.relam
      WHERE c.relname = 'orders_created_at_brin_idx'
    `);

    expect(rows).toEqual([{ amname: 'brin', reloptions: ['pages_per_range=32', 'autosummarize=on'] }]);
  });

  it('can serve the date filter of get_best_selling_products()', async () => {
    // The scaled-down test table fits in one block range, where a sequential
    // scan is naturally cheaper, so sequential scans are disabled to check
    // that the filter's form (no function around created_at) can use the
    // index. The real benefit is measured in docs/query-optimization.md.
    await client.query('SET LOCAL enable_seqscan = off');
    try {
      const nodes = await planNodes(
        `SELECT o.order_id FROM orders o
         WHERE o.status IN ('paid', 'shipped', 'delivered')
           AND o.created_at >= $1::date AND o.created_at < $2::date + 1`,
        ['2026-06-15', '2026-06-15'],
      );

      expect(nodes.map((n) => n['Index Name'])).toContain('orders_created_at_brin_idx');
    } finally {
      await client.query('RESET enable_seqscan');
    }
  });
});

describe('inventory_pkey', () => {
  it('serves the get_product_availability() lookup without an extra index', async () => {
    const { rows } = await client.query(
      "SELECT product_id, warehouse_id FROM inventory WHERE product_id = (SELECT min(product_id) FROM products WHERE sku LIKE 'GEN-%') LIMIT 1",
    );

    // The lookup of get_product_availability().
    const nodes = await planNodes(
      `SELECT i.quantity_on_hand, i.quantity_reserved, i.quantity_available
       FROM inventory i
       WHERE i.product_id = $1 AND i.warehouse_id = $2`,
      [rows[0].product_id, rows[0].warehouse_id],
    );

    expect(nodes).toContainEqual(
      expect.objectContaining({ 'Node Type': 'Index Scan', 'Index Name': 'inventory_pkey' }),
    );
  });
});
