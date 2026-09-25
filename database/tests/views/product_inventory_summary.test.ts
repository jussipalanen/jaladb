import { describe, expect, it } from 'vitest';
import { useRollbackClient } from '../helpers/db.ts';
import {
  createCategory,
  createProduct,
  createWarehouse,
  type Id,
  stockProduct,
} from '../helpers/fixtures.ts';

const db = useRollbackClient();

async function summary(productId: Id) {
  const { rows } = await db().query('SELECT * FROM product_inventory_summary WHERE product_id = $1', [
    productId,
  ]);
  return rows;
}

// count() and sum() over integers return BIGINT, which pg delivers as strings.
const stock = (warehouses: number, onHand: number, reserved: number) => ({
  warehouse_count: String(warehouses),
  quantity_on_hand: String(onHand),
  quantity_reserved: String(reserved),
  quantity_available: String(onHand - reserved),
});

describe('product_inventory_summary', () => {
  it('sums stock over all warehouses', async () => {
    const productId = await createProduct(db());
    for (const [onHand, reserved] of [[10, 2], [5, 5], [0, 0]]) {
      await stockProduct(db(), productId, await createWarehouse(db()), { onHand: onHand!, reserved });
    }

    expect(await summary(productId)).toMatchObject([stock(3, 15, 7)]);
  });

  it('includes the product data and the category name', async () => {
    const categoryId = await createCategory(db(), 'Garden Tools');
    const { rows } = await db().query(
      `INSERT INTO products (category_id, sku, name, price) VALUES ($1, 'RAKE-1', 'Leaf Rake', '19.90')
       RETURNING product_id`,
      [categoryId],
    );

    expect(await summary(rows[0].product_id)).toEqual([
      {
        product_id: rows[0].product_id,
        sku: 'RAKE-1',
        name: 'Leaf Rake',
        category: 'Garden Tools',
        price: '19.90',
        is_active: true,
        ...stock(0, 0, 0),
      },
    ]);
  });

  it('shows zeros for a product that is not stocked anywhere', async () => {
    const productId = await createProduct(db());

    expect(await summary(productId)).toMatchObject([stock(0, 0, 0)]);
  });

  it('includes inactive products', async () => {
    const productId = await createProduct(db());
    await db().query('UPDATE products SET is_active = false WHERE product_id = $1', [productId]);

    expect(await summary(productId)).toMatchObject([{ is_active: false }]);
  });

  it('has exactly one row per product', async () => {
    const productId = await createProduct(db());
    await stockProduct(db(), productId, await createWarehouse(db()), { onHand: 1 });
    await stockProduct(db(), productId, await createWarehouse(db()), { onHand: 1 });
    await createProduct(db());

    const { rows } = await db().query(`
      SELECT (SELECT count(*) FROM products)::int AS products,
             (SELECT count(*) FROM product_inventory_summary)::int AS summary_rows,
             (SELECT count(DISTINCT product_id) FROM product_inventory_summary)::int AS distinct_products
    `);
    expect(rows[0].summary_rows).toBe(rows[0].products);
    expect(rows[0].distinct_products).toBe(rows[0].products);
  });

  it('reflects a reservation immediately', async () => {
    const productId = await createProduct(db());
    const warehouseId = await createWarehouse(db());
    await stockProduct(db(), productId, warehouseId, { onHand: 8 });

    await db().query('SELECT reserve_stock($1, $2, 3)', [productId, warehouseId]);

    expect(await summary(productId)).toMatchObject([stock(1, 8, 3)]);
  });
});
