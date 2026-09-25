import { describe, expect, it } from 'vitest';
import { settle, useCommittedFixtures } from '../helpers/concurrency.ts';
import type { Id } from '../helpers/fixtures.ts';

// Real parallel connections against committed fixtures (see helpers/concurrency.ts).

const CREATE_ORDER = 'SELECT create_order($1, $2, $3) AS order_id';
const RESERVE = 'SELECT reserve_stock($1, $2, $3) AS remaining';

const fixtures = useCommittedFixtures();

const items = (...lines: { productId: Id; quantity: number }[]) =>
  JSON.stringify(lines.map((l) => ({ product_id: l.productId, quantity: l.quantity })));

describe('create_order under concurrency', () => {
  it('locks lines in product_id order, whatever order they are given in', async () => {
    const [low, high] = await fixtures.stockedProducts(2, { onHand: 10 });
    const customerId = await fixtures.customer();
    const holder = await fixtures.openClient();
    const orderer = await fixtures.openClient();
    const bystander = await fixtures.openClient();

    // `holder` locks the lower product and keeps its transaction open.
    await holder.query('BEGIN');
    await holder.query(RESERVE, [low!.productId, low!.warehouseId, 1]);

    // The order lists the higher product first. Sorted locking means it must
    // wait for the lower product before touching the higher one.
    const order = settle(
      orderer.query(CREATE_ORDER, [
        customerId,
        low!.warehouseId,
        items({ productId: high!.productId, quantity: 1 }, { productId: low!.productId, quantity: 1 }),
      ]),
    );
    await fixtures.waitUntilBlocked(orderer, holder);

    // So the higher product is still unlocked: a third connection can reserve
    // it immediately. Had the order locked it first, this would time out.
    await bystander.query("SET lock_timeout = '1s'");
    await expect(bystander.query(RESERVE, [high!.productId, high!.warehouseId, 1])).resolves.toMatchObject({
      rows: [{ remaining: 9 }],
    });

    await holder.query('COMMIT');
    expect(await order).toMatchObject({ ok: true });

    expect(await fixtures.reservedQuantity(low!)).toBe(2);
    expect(await fixtures.reservedQuantity(high!)).toBe(2);
  });

  it('completes concurrent orders with the same products in opposite order without deadlocks', async () => {
    const [first, second, third] = await fixtures.stockedProducts(3, { onHand: 100 });
    const customerId = await fixtures.customer();
    const clients = await Promise.all(Array.from({ length: 20 }, () => fixtures.openClient()));

    // Half of the orders list the products forwards, half backwards.
    const forwards = items(
      { productId: first!.productId, quantity: 1 },
      { productId: second!.productId, quantity: 1 },
      { productId: third!.productId, quantity: 1 },
    );
    const backwards = items(
      { productId: third!.productId, quantity: 1 },
      { productId: second!.productId, quantity: 1 },
      { productId: first!.productId, quantity: 1 },
    );

    const outcomes = await Promise.all(
      clients.map((client, i) =>
        settle(client.query(CREATE_ORDER, [customerId, first!.warehouseId, i % 2 ? backwards : forwards])),
      ),
    );

    // A deadlock would surface as SQLSTATE 40P01 on one of the orders.
    expect(outcomes.filter((o) => !o.ok)).toEqual([]);
    for (const stock of [first!, second!, third!]) {
      expect(await fixtures.reservedQuantity(stock)).toBe(20);
    }
    const { rows } = await fixtures
      .admin()
      .query('SELECT count(*)::int AS n FROM orders WHERE customer_id = $1', [customerId]);
    expect(rows[0].n).toBe(20);
  });

  it('never oversells: competing orders for the last units either complete fully or not at all', async () => {
    const [scarce, plenty] = await fixtures.stockedProducts(2, { onHand: 3 });
    const customerId = await fixtures.customer();
    const clients = await Promise.all(Array.from({ length: 8 }, () => fixtures.openClient()));

    // Every order wants one unit of each product; only three can succeed.
    const outcomes = await Promise.all(
      clients.map((client) =>
        settle(
          client.query(CREATE_ORDER, [
            customerId,
            scarce!.warehouseId,
            items({ productId: plenty!.productId, quantity: 1 }, { productId: scarce!.productId, quantity: 1 }),
          ]),
        ),
      ),
    );

    expect(outcomes.filter((o) => o.ok)).toHaveLength(3);
    for (const outcome of outcomes.filter((o) => !o.ok)) {
      expect(!outcome.ok && outcome.error).toMatchObject({ code: 'JD001' });
    }
    // Failed orders left no partial reservations behind.
    expect(await fixtures.reservedQuantity(scarce!)).toBe(3);
    expect(await fixtures.reservedQuantity(plenty!)).toBe(3);
    const { rows } = await fixtures
      .admin()
      .query(
        `SELECT count(*)::int AS orders,
                (SELECT count(*)::int FROM order_items oi JOIN orders o USING (order_id)
                 WHERE o.customer_id = $1) AS lines
         FROM orders WHERE customer_id = $1`,
        [customerId],
      );
    expect(rows[0]).toEqual({ orders: 3, lines: 6 });
  });
});
