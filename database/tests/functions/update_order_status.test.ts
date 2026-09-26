import { beforeEach, describe, expect, it } from 'vitest';
import { expectDbError, useRollbackClient } from '../helpers/db.ts';
import {
  createCustomer,
  createProduct,
  createWarehouse,
  type Id,
  stockProduct,
} from '../helpers/fixtures.ts';

const db = useRollbackClient();

const UPDATE_STATUS = 'SELECT update_order_status($1, $2) AS previous_status';
const STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'] as const;
type Status = (typeof STATUSES)[number];

const ALLOWED: [Status, Status][] = [
  ['pending', 'paid'],
  ['pending', 'cancelled'],
  ['paid', 'shipped'],
  ['paid', 'cancelled'],
  ['shipped', 'delivered'],
];

/** Shortest path of allowed transitions from pending to each status. */
const PATH: Record<Status, Status[]> = {
  pending: [],
  paid: ['paid'],
  shipped: ['paid', 'shipped'],
  delivered: ['paid', 'shipped', 'delivered'],
  cancelled: ['cancelled'],
};

let customerId: Id;
let warehouseId: Id;
let products: Id[];

beforeEach(async () => {
  customerId = await createCustomer(db());
  warehouseId = await createWarehouse(db());
  products = [];
  for (let i = 0; i < 2; i++) {
    const productId = await createProduct(db());
    await stockProduct(db(), productId, warehouseId, { onHand: 10 });
    products.push(productId);
  }
});

/** A new order for 2 × product A and 3 × product B, via create_order(). */
async function placeOrder(): Promise<Id> {
  const { rows } = await db().query('SELECT create_order($1, $2, $3) AS order_id', [
    customerId,
    warehouseId,
    JSON.stringify([
      { product_id: products[0], quantity: 2 },
      { product_id: products[1], quantity: 3 },
    ]),
  ]);
  return rows[0].order_id;
}

async function setStatus(orderId: Id, status: string): Promise<string> {
  const { rows } = await db().query(UPDATE_STATUS, [orderId, status]);
  return rows[0].previous_status;
}

async function orderIn(status: Status): Promise<Id> {
  const orderId = await placeOrder();
  for (const step of PATH[status]) await setStatus(orderId, step);
  return orderId;
}

/** [on hand, reserved] for product A and product B. */
async function stock(): Promise<[number, number][]> {
  const { rows } = await db().query(
    `SELECT quantity_on_hand, quantity_reserved FROM inventory
     WHERE warehouse_id = $1 ORDER BY product_id`,
    [warehouseId],
  );
  return rows.map((r) => [r.quantity_on_hand, r.quantity_reserved]);
}

async function statusOf(orderId: Id): Promise<string> {
  const { rows } = await db().query('SELECT status FROM orders WHERE order_id = $1', [orderId]);
  return rows[0].status;
}

async function historyOf(orderId: Id): Promise<[string | null, string][]> {
  const { rows } = await db().query(
    'SELECT old_status, new_status FROM order_status_history WHERE order_id = $1 ORDER BY history_id',
    [orderId],
  );
  return rows.map((r) => [r.old_status, r.new_status]);
}

describe('update_order_status', () => {
  describe('stock effects', () => {
    it('leaves stock unchanged when an order is paid', async () => {
      const orderId = await placeOrder();

      expect(await setStatus(orderId, 'paid')).toBe('pending');
      expect(await statusOf(orderId)).toBe('paid');
      expect(await stock()).toEqual([[10, 2], [10, 3]]);
    });

    it.each(['pending', 'paid'] as const)('releases the reservation when a %s order is cancelled', async (from) => {
      const orderId = await orderIn(from);

      expect(await setStatus(orderId, 'cancelled')).toBe(from);
      expect(await stock()).toEqual([[10, 0], [10, 0]]);
    });

    it('removes shipped goods from stock on hand and from the reservation', async () => {
      const orderId = await orderIn('paid');

      expect(await setStatus(orderId, 'shipped')).toBe('paid');
      expect(await stock()).toEqual([[8, 0], [7, 0]]);
    });

    it('leaves stock unchanged when a shipped order is delivered', async () => {
      const orderId = await orderIn('shipped');

      expect(await setStatus(orderId, 'delivered')).toBe('shipped');
      expect(await stock()).toEqual([[8, 0], [7, 0]]);
    });

    it('touches only the lines of the order being changed', async () => {
      const cancelled = await placeOrder();
      await placeOrder();

      await setStatus(cancelled, 'cancelled');

      expect(await stock()).toEqual([[10, 2], [10, 3]]);
    });
  });

  it('runs the whole lifecycle and records it in the status history', async () => {
    const orderId = await placeOrder();

    expect(await setStatus(orderId, 'paid')).toBe('pending');
    expect(await setStatus(orderId, 'shipped')).toBe('paid');
    expect(await setStatus(orderId, 'delivered')).toBe('shipped');

    expect(await stock()).toEqual([[8, 0], [7, 0]]);
    expect(await historyOf(orderId)).toEqual([
      [null, 'pending'],
      ['pending', 'paid'],
      ['paid', 'shipped'],
      ['shipped', 'delivered'],
    ]);
  });

  it('treats setting the current status as a no-op', async () => {
    const orderId = await orderIn('paid');

    expect(await setStatus(orderId, 'paid')).toBe('paid');

    expect(await stock()).toEqual([[10, 2], [10, 3]]);
    expect(await historyOf(orderId)).toHaveLength(2);
  });

  describe('disallowed transitions', () => {
    const disallowed = STATUSES.flatMap((from) =>
      STATUSES.filter((to) => to !== from && !ALLOWED.some(([f, t]) => f === from && t === to)).map(
        (to) => [from, to] as const,
      ),
    );

    it('covers all 15 transitions that are not allowed', () => {
      expect(disallowed).toHaveLength(15);
    });

    it.each(disallowed)('rejects %s -> %s with JD003 and changes nothing', async (from, to) => {
      const orderId = await orderIn(from);
      const stockBefore = await stock();

      await expectDbError(db(), UPDATE_STATUS, [orderId, to], {
        code: 'JD003',
        message: `order ${orderId} cannot change from ${from} to ${to}`,
      });

      expect(await statusOf(orderId)).toBe(from);
      expect(await stock()).toEqual(stockBefore);
    });
  });

  describe('invalid arguments', () => {
    it('raises no_data_found for an unknown order', async () => {
      await expectDbError(db(), UPDATE_STATUS, [-1, 'paid'], {
        code: 'P0002',
        message: 'order -1 does not exist',
      });
    });

    it('raises invalid_parameter_value for an unknown status', async () => {
      const orderId = await placeOrder();

      await expectDbError(db(), UPDATE_STATUS, [orderId, 'lost'], {
        code: '22023',
        message: 'unknown order status "lost"',
      });
    });

    it.each([
      ['order id', [null, 'paid']],
      ['status', [1, null]],
    ])('raises invalid_parameter_value for a NULL %s', async (_, params) => {
      await expectDbError(db(), UPDATE_STATUS, params, {
        code: '22023',
        message: 'order id and status must not be NULL',
      });
    });
  });

  it('refuses to ship when an order line has no inventory row, and changes nothing', async () => {
    const orderId = await orderIn('paid');
    await db().query('DELETE FROM inventory WHERE product_id = $1 AND warehouse_id = $2', [
      products[1],
      warehouseId,
    ]);

    await expectDbError(db(), UPDATE_STATUS, [orderId, 'shipped'], {
      code: '22000',
      message: `order ${orderId}: 1 of 2 lines have no inventory row in warehouse ${warehouseId}`,
    });

    expect(await statusOf(orderId)).toBe('paid');
    expect(await stock()).toEqual([[10, 2]]);
  });
});
