import { describe, expect, it } from 'vitest';
import { settle, type Stock, useCommittedFixtures } from '../helpers/concurrency.ts';
import type { Id } from '../helpers/fixtures.ts';

// Real parallel connections against committed fixtures (see helpers/concurrency.ts).

const UPDATE_STATUS = 'SELECT update_order_status($1, $2) AS previous_status';
const CREATE_ORDER = 'SELECT create_order($1, $2, $3) AS order_id';

const fixtures = useCommittedFixtures();

const items = (...lines: [Stock, number][]) =>
  JSON.stringify(lines.map(([stock, quantity]) => ({ product_id: stock.productId, quantity })));

async function inventory(stock: Stock): Promise<[number, number]> {
  const { rows } = await fixtures
    .admin()
    .query('SELECT quantity_on_hand, quantity_reserved FROM inventory WHERE product_id = $1 AND warehouse_id = $2', [
      stock.productId,
      stock.warehouseId,
    ]);
  return [rows[0].quantity_on_hand, rows[0].quantity_reserved];
}

/** A committed order for `quantity` units of each product, moved to `status`. */
async function committedOrder(customerId: Id, products: Stock[], quantity: number, status?: 'paid'): Promise<Id> {
  const admin = fixtures.admin();
  const { rows } = await admin.query(CREATE_ORDER, [
    customerId,
    products[0]!.warehouseId,
    items(...products.map((p) => [p, quantity] as [Stock, number])),
  ]);
  if (status) await admin.query(UPDATE_STATUS, [rows[0].order_id, status]);
  return rows[0].order_id;
}

describe('update_order_status under concurrency', () => {
  it('lets only one of a concurrent ship and cancel win', async () => {
    const [product] = await fixtures.stockedProducts(1, { onHand: 10 });
    const customerId = await fixtures.customer();
    const orderId = await committedOrder(customerId, [product!], 4, 'paid');
    const shipper = await fixtures.openClient();
    const canceller = await fixtures.openClient();

    await shipper.query('BEGIN');
    await shipper.query(UPDATE_STATUS, [orderId, 'shipped']);

    // The cancel waits for the order row lock, then sees the order shipped.
    const cancel = settle(canceller.query(UPDATE_STATUS, [orderId, 'cancelled']));
    await fixtures.waitUntilBlocked(canceller, shipper);
    await shipper.query('COMMIT');

    const outcome = await cancel;
    expect(!outcome.ok && outcome.error).toMatchObject({
      code: 'JD003',
      message: `order ${orderId} cannot change from shipped to cancelled`,
    });
    // Shipped once: 4 units left the warehouse, nothing was released twice.
    expect(await inventory(product!)).toEqual([6, 0]);
  });

  it('releases the stock only once when an order is cancelled twice at the same time', async () => {
    const [product] = await fixtures.stockedProducts(1, { onHand: 10 });
    const customerId = await fixtures.customer();
    const orderId = await committedOrder(customerId, [product!], 4);
    const first = await fixtures.openClient();
    const second = await fixtures.openClient();

    await first.query('BEGIN');
    await first.query(UPDATE_STATUS, [orderId, 'cancelled']);

    const secondCancel = settle(second.query(UPDATE_STATUS, [orderId, 'cancelled']));
    await fixtures.waitUntilBlocked(second, first);
    await first.query('COMMIT');

    // The second call sees the order already cancelled: a no-op.
    expect(await secondCancel).toMatchObject({ ok: true, result: { rows: [{ previous_status: 'cancelled' }] } });
    expect(await inventory(product!)).toEqual([10, 0]);
    const { rows } = await fixtures
      .admin()
      .query("SELECT count(*)::int AS n FROM order_status_history WHERE order_id = $1 AND new_status = 'cancelled'", [
        orderId,
      ]);
    expect(rows[0].n).toBe(1);
  });

  it('runs status changes and new orders on the same products without deadlocks', async () => {
    const [first, second] = await fixtures.stockedProducts(2, { onHand: 100 });
    const customerId = await fixtures.customer();
    const paidOrders: Id[] = [];
    for (let i = 0; i < 6; i++) paidOrders.push(await committedOrder(customerId, [first!, second!], 1, 'paid'));
    const clients = await Promise.all(Array.from({ length: 12 }, () => fixtures.openClient()));

    // Six shipments lock the products lowest id first; six new orders list
    // them the other way round. Both lock in product_id order, so nothing
    // can deadlock.
    const outcomes = await Promise.all(
      clients.map((client, i) =>
        settle(
          i < 6
            ? client.query(UPDATE_STATUS, [paidOrders[i], 'shipped'])
            : client.query(CREATE_ORDER, [customerId, first!.warehouseId, items([second!, 1], [first!, 1])]),
        ),
      ),
    );

    expect(outcomes.filter((o) => !o.ok)).toEqual([]);
    // 6 shipped: on hand 94. 6 new orders: 6 reserved.
    expect(await inventory(first!)).toEqual([94, 6]);
    expect(await inventory(second!)).toEqual([94, 6]);
  });
});
