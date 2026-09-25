import { beforeEach, describe, expect, it } from 'vitest';
import { expectDbError, useRollbackClient } from '../helpers/db.ts';
import { addOrderItem, createCustomer, createOrder, createProduct, type Id } from '../helpers/fixtures.ts';

const db = useRollbackClient();

const BEST_SELLING = 'SELECT * FROM get_best_selling_products($1, $2, $3)';

let customerId: Id;

beforeEach(async () => {
  // Dates are interpreted in the session time zone; make it explicit.
  await db().query("SET LOCAL TIME ZONE 'UTC'");
  customerId = await createCustomer(db());
});

/** An order with one line per [productId, quantity, unitPrice]. */
async function sale(
  createdAt: string,
  lines: [Id, number, string][],
  status = 'delivered',
): Promise<void> {
  const { orderId } = await createOrder(db(), { customerId, createdAt, status });
  for (const [productId, quantity, unitPrice] of lines) {
    await addOrderItem(db(), orderId, { productId, quantity, unitPrice });
  }
}

async function bestSelling(start: string, end: string, limit = 10) {
  const { rows } = await db().query(BEST_SELLING, [start, end, limit]);
  return rows;
}

const summary = (rows: { product_id: Id; units_sold: string; revenue: string }[]) =>
  rows.map((r) => [r.product_id, Number(r.units_sold), r.revenue]);

describe('get_best_selling_products', () => {
  it('sums units and revenue per product across orders', async () => {
    const kettle = await createProduct(db(), { sku: 'KETTLE-1' });
    const mug = await createProduct(db(), { sku: 'MUG-1' });
    await sale('2026-03-02T10:00:00Z', [[kettle, 1, '40.00'], [mug, 2, '8.00']]);
    await sale('2026-03-05T10:00:00Z', [[kettle, 2, '40.00']]);

    const rows = await bestSelling('2026-03-01', '2026-03-31');

    expect(rows).toEqual([
      { product_id: kettle, sku: 'KETTLE-1', name: 'Product KETTLE-1', units_sold: '3', revenue: '120.00' },
      { product_id: mug, sku: 'MUG-1', name: 'Product MUG-1', units_sold: '2', revenue: '16.00' },
    ]);
  });

  it('uses the prices at the time of purchase', async () => {
    const lamp = await createProduct(db(), { price: '30.00' });
    await sale('2026-03-02T10:00:00Z', [[lamp, 1, '25.00']]);
    await db().query("UPDATE products SET price = '99.00' WHERE product_id = $1", [lamp]);

    expect(summary(await bestSelling('2026-03-01', '2026-03-31'))).toEqual([[lamp, 1, '25.00']]);
  });

  it('counts paid, shipped and delivered orders only', async () => {
    const product = await createProduct(db());
    const statuses = { pending: 1, paid: 10, shipped: 100, delivered: 1000, cancelled: 10000 };
    for (const [status, quantity] of Object.entries(statuses)) {
      await sale('2026-03-02T10:00:00Z', [[product, quantity, '1.00']], status);
    }

    expect(summary(await bestSelling('2026-03-01', '2026-03-31'))).toEqual([[product, 1110, '1110.00']]);
  });

  describe('date range', () => {
    let product: Id;

    beforeEach(async () => {
      product = await createProduct(db());
      // One unit per boundary case, each a different power of ten so the
      // total shows exactly which orders were counted.
      await sale('2026-02-28T23:59:59Z', [[product, 1, '1.00']]); //     day before start
      await sale('2026-03-01T00:00:00Z', [[product, 10, '1.00']]); //    start of first day
      await sale('2026-03-31T23:59:59Z', [[product, 100, '1.00']]); //   end of last day
      await sale('2026-04-01T00:00:00Z', [[product, 1000, '1.00']]); //  day after end
    });

    it('includes the whole first and last day and nothing outside', async () => {
      expect(summary(await bestSelling('2026-03-01', '2026-03-31'))).toEqual([[product, 110, '110.00']]);
    });

    it('treats a single day as a valid range', async () => {
      expect(summary(await bestSelling('2026-03-31', '2026-03-31'))).toEqual([[product, 100, '100.00']]);
    });

    it('returns an empty result when nothing was sold in the range', async () => {
      expect(await bestSelling('2025-01-01', '2025-12-31')).toEqual([]);
    });
  });

  describe('ordering and limit', () => {
    it('orders by units sold, then revenue, then product id', async () => {
      const [a, b, c, d] = [
        await createProduct(db()),
        await createProduct(db()),
        await createProduct(db()),
        await createProduct(db()),
      ];
      await sale('2026-03-02T10:00:00Z', [
        [a, 2, '1.00'], // 2 units,  2.00
        [b, 5, '1.00'], // 5 units,  5.00
        [c, 2, '9.00'], // 2 units, 18.00: same units as a, more revenue
        [d, 2, '1.00'], // 2 units,  2.00: tie with a, higher id
      ]);

      expect((await bestSelling('2026-03-01', '2026-03-31')).map((r) => r.product_id)).toEqual([b, c, a, d]);
    });

    it('returns at most `limit` products', async () => {
      const products = [];
      for (let i = 0; i < 4; i++) products.push(await createProduct(db()));
      await sale(
        '2026-03-02T10:00:00Z',
        products.map((p, i) => [p, i + 1, '1.00'] as [Id, number, string]),
      );

      expect((await bestSelling('2026-03-01', '2026-03-31', 2)).map((r) => r.product_id)).toEqual([
        products[3],
        products[2],
      ]);
    });
  });

  describe('invalid arguments', () => {
    it('rejects a start date after the end date', async () => {
      await expectDbError(db(), BEST_SELLING, ['2026-04-01', '2026-03-01', 5], {
        code: '22023',
        message: 'start date 2026-04-01 is after end date 2026-03-01',
      });
    });

    it.each([0, -1])('rejects limit %d', async (limit) => {
      await expectDbError(db(), BEST_SELLING, ['2026-03-01', '2026-03-31', limit], {
        code: '22023',
        message: `limit must be at least 1, got ${limit}`,
      });
    });

    it.each([
      ['start date', [null, '2026-03-31', 5]],
      ['end date', ['2026-03-01', null, 5]],
      ['limit', ['2026-03-01', '2026-03-31', null]],
    ])('rejects a NULL %s', async (_, params) => {
      await expectDbError(db(), BEST_SELLING, params, {
        code: '22023',
        message: 'start date, end date and limit must not be NULL',
      });
    });
  });
});
