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

const CREATE_ORDER = 'SELECT create_order($1, $2, $3) AS order_id';

interface Line {
  product_id: Id;
  quantity: number;
}

let customerId: Id;
let warehouseId: Id;
/** Three stocked products in ascending product_id order. */
let products: { id: Id; price: string }[];

beforeEach(async () => {
  customerId = await createCustomer(db());
  warehouseId = await createWarehouse(db());
  products = [];
  for (const price of ['10.00', '24.50', '99.90']) {
    const id = await createProduct(db(), { price });
    await stockProduct(db(), id, warehouseId, { onHand: 10 });
    products.push({ id, price });
  }
});

async function createOrder(lines: Line[]): Promise<Id> {
  const { rows } = await db().query(CREATE_ORDER, [customerId, warehouseId, JSON.stringify(lines)]);
  return rows[0].order_id;
}

async function reserved(): Promise<number[]> {
  const { rows } = await db().query(
    `SELECT quantity_reserved FROM inventory
     WHERE warehouse_id = $1 ORDER BY product_id`,
    [warehouseId],
  );
  return rows.map((r) => r.quantity_reserved);
}

async function customerOrderCount(): Promise<number> {
  const { rows } = await db().query('SELECT count(*)::int AS n FROM orders WHERE customer_id = $1', [
    customerId,
  ]);
  return rows[0].n;
}

describe('create_order', () => {
  describe('on success', () => {
    it('creates a pending order for the customer and warehouse and returns its id', async () => {
      const orderId = await createOrder([
        { product_id: products[0]!.id, quantity: 2 },
        { product_id: products[1]!.id, quantity: 1 },
      ]);

      const { rows } = await db().query(
        'SELECT customer_id, warehouse_id, status, total_amount FROM orders WHERE order_id = $1',
        [orderId],
      );
      expect(rows).toEqual([
        { customer_id: customerId, warehouse_id: warehouseId, status: 'pending', total_amount: '44.50' },
      ]);
    });

    it('stores each line with the price at the time of purchase', async () => {
      const orderId = await createOrder([
        { product_id: products[2]!.id, quantity: 3 },
        { product_id: products[0]!.id, quantity: 1 },
      ]);
      // A later price change must not affect the order.
      await db().query('UPDATE products SET price = price * 2 WHERE product_id = $1', [products[2]!.id]);

      const { rows } = await db().query(
        `SELECT product_id, quantity, unit_price, line_total FROM order_items
         WHERE order_id = $1 ORDER BY product_id`,
        [orderId],
      );
      expect(rows).toEqual([
        { product_id: products[0]!.id, quantity: 1, unit_price: '10.00', line_total: '10.00' },
        { product_id: products[2]!.id, quantity: 3, unit_price: '99.90', line_total: '299.70' },
      ]);
    });

    it('stores a total equal to the sum of the line totals', async () => {
      const orderId = await createOrder([
        { product_id: products[0]!.id, quantity: 3 },
        { product_id: products[1]!.id, quantity: 2 },
        { product_id: products[2]!.id, quantity: 1 },
      ]);

      const { rows } = await db().query(
        `SELECT o.total_amount, (SELECT sum(line_total) FROM order_items WHERE order_id = o.order_id) AS lines
         FROM orders o WHERE o.order_id = $1`,
        [orderId],
      );
      expect(rows[0]).toEqual({ total_amount: '178.90', lines: '178.90' });
    });

    it('reserves the stock of every line', async () => {
      await createOrder([
        { product_id: products[2]!.id, quantity: 4 },
        { product_id: products[0]!.id, quantity: 1 },
      ]);

      expect(await reserved()).toEqual([1, 0, 4]);
    });

    it('is listed by get_customer_orders', async () => {
      const orderId = await createOrder([{ product_id: products[1]!.id, quantity: 2 }]);

      const { rows } = await db().query('SELECT * FROM get_customer_orders($1)', [customerId]);
      expect(rows).toMatchObject([
        { order_id: orderId, status: 'pending', total_amount: '49.00', item_count: 2 },
      ]);
    });
  });

  describe('atomicity', () => {
    it('leaves no order, lines or reservations when the last line lacks stock', async () => {
      // Lines are reserved in product_id order, so the first two reservations
      // succeed before the third one fails.
      await expectDbError(
        db(),
        CREATE_ORDER,
        [
          customerId,
          warehouseId,
          JSON.stringify([
            { product_id: products[0]!.id, quantity: 2 },
            { product_id: products[1]!.id, quantity: 3 },
            { product_id: products[2]!.id, quantity: 11 },
          ]),
        ],
        { code: 'JD001', message: expect.stringContaining('requested 11, available 10') },
      );

      expect(await customerOrderCount()).toBe(0);
      expect(await reserved()).toEqual([0, 0, 0]);
      const { rows } = await db().query(
        'SELECT count(*)::int AS n FROM order_items WHERE product_id = ANY ($1::bigint[])',
        [products.map((p) => p.id)],
      );
      expect(rows[0].n).toBe(0);
    });

    it('leaves nothing behind when a product is inactive', async () => {
      await db().query('UPDATE products SET is_active = false WHERE product_id = $1', [products[2]!.id]);

      await expectDbError(
        db(),
        CREATE_ORDER,
        [
          customerId,
          warehouseId,
          JSON.stringify([
            { product_id: products[0]!.id, quantity: 1 },
            { product_id: products[2]!.id, quantity: 1 },
          ]),
        ],
        { code: 'JD002' },
      );

      expect(await customerOrderCount()).toBe(0);
      expect(await reserved()).toEqual([0, 0, 0]);
    });
  });

  describe('unknown references', () => {
    it('raises no_data_found for an unknown customer before reserving anything', async () => {
      await expectDbError(
        db(),
        CREATE_ORDER,
        [-1, warehouseId, JSON.stringify([{ product_id: products[0]!.id, quantity: 1 }])],
        { code: 'P0002', message: 'customer -1 does not exist' },
      );

      expect(await reserved()).toEqual([0, 0, 0]);
    });

    it('raises no_data_found for an unknown product', async () => {
      await expectDbError(
        db(),
        CREATE_ORDER,
        [customerId, warehouseId, JSON.stringify([{ product_id: -1, quantity: 1 }])],
        { code: 'P0002', message: 'product -1 does not exist' },
      );
    });

    it('raises no_data_found for an unknown warehouse', async () => {
      await expectDbError(
        db(),
        CREATE_ORDER,
        [customerId, -1, JSON.stringify([{ product_id: products[0]!.id, quantity: 1 }])],
        { code: 'P0002', message: 'warehouse -1 does not exist' },
      );
    });
  });

  describe('invalid items', () => {
    it.each([
      ['a JSON object', '{"product_id": 1, "quantity": 1}', 'items must be a non-empty JSON array'],
      ['an empty array', '[]', 'items must be a non-empty JSON array'],
      ['a JSON string', '"5 headphones"', 'items must be a non-empty JSON array'],
      ['an array of numbers', '[1, 2]', 'items must be objects with integer "product_id" and "quantity"'],
      ['a decimal quantity', '[{"product_id": 1, "quantity": 2.5}]', 'items must be objects with integer'],
      ['a text product id', '[{"product_id": "abc", "quantity": 1}]', 'items must be objects with integer'],
      ['a huge quantity', '[{"product_id": 1, "quantity": 99999999999}]', 'items must be objects with integer'],
      ['a missing quantity', '[{"product_id": 1}]', 'item 1 must have "product_id" and "quantity"'],
      ['a missing product id', '[{"product_id": 1, "quantity": 1}, {"quantity": 1}]', 'item 2 must have'],
      ['a zero quantity', '[{"product_id": 1, "quantity": 0}]', 'item 1: quantity must be positive, got 0'],
      ['a negative quantity', '[{"product_id": 1, "quantity": -2}]', 'item 1: quantity must be positive, got -2'],
    ])('rejects %s', async (_, items, message) => {
      await expectDbError(db(), CREATE_ORDER, [customerId, warehouseId, items], {
        code: '22023',
        message: expect.stringContaining(message),
      });
    });

    it('rejects a product listed twice', async () => {
      const productId = products[0]!.id;

      await expectDbError(
        db(),
        CREATE_ORDER,
        [
          customerId,
          warehouseId,
          JSON.stringify([
            { product_id: productId, quantity: 1 },
            { product_id: productId, quantity: 2 },
          ]),
        ],
        { code: '22023', message: `product ${productId} appears more than once in items` },
      );
    });

    it.each([
      ['customer id', [null, 1, '[]']],
      ['warehouse id', [1, null, '[]']],
      ['items', [1, 1, null]],
    ])('rejects a NULL %s', async (_, params) => {
      await expectDbError(db(), CREATE_ORDER, params, {
        code: '22023',
        message: 'customer id, warehouse id and items must not be NULL',
      });
    });
  });
});
