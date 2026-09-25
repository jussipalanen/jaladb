import { describe, expect, it } from 'vitest';
import { expectDbError, SqlState, useRollbackClient } from './helpers/db.ts';
import {
  createCategory,
  createCustomer,
  createInventory,
  createOrder,
  createProduct,
  createWarehouse,
} from './helpers/fixtures.ts';

const db = useRollbackClient();

describe('categories', () => {
  it('rejects duplicate names regardless of case', async () => {
    await createCategory(db(), 'Garden');

    await expectDbError(db(), 'INSERT INTO categories (name) VALUES ($1)', ['GARDEN'], {
      code: SqlState.UNIQUE_VIOLATION,
      constraint: 'categories_name_key',
    });
  });

  it('rejects blank names', async () => {
    await expectDbError(db(), 'INSERT INTO categories (name) VALUES ($1)', ['   '], {
      code: SqlState.CHECK_VIOLATION,
      constraint: 'categories_name_not_blank',
    });
  });

  it('cannot be deleted while products reference it', async () => {
    const productId = await createProduct(db());

    await expectDbError(
      db(),
      'DELETE FROM categories WHERE category_id = (SELECT category_id FROM products WHERE product_id = $1)',
      [productId],
      { code: SqlState.RESTRICT_VIOLATION, constraint: 'products_category_id_fkey' },
    );
  });
});

describe('customers', () => {
  const insertCustomer =
    "INSERT INTO customers (email, first_name, last_name) VALUES ($1, 'Test', 'Customer')";

  it('rejects duplicate email addresses regardless of case', async () => {
    await createCustomer(db(), 'aino@example.com');

    await expectDbError(db(), insertCustomer, ['Aino@Example.com'], {
      code: SqlState.UNIQUE_VIOLATION,
      constraint: 'customers_email_key',
    });
  });

  it.each(['not-an-email', 'missing@tld', 'two@@example.com', 'space in@example.com'])(
    'rejects malformed email %j',
    async (email) => {
      await expectDbError(db(), insertCustomer, [email], {
        code: SqlState.CHECK_VIOLATION,
        constraint: 'customers_email_format',
      });
    },
  );

  it('requires a name', async () => {
    await expectDbError(
      db(),
      "INSERT INTO customers (email, first_name, last_name) VALUES ('x@example.com', NULL, 'Customer')",
      [],
      { code: SqlState.NOT_NULL_VIOLATION },
    );
  });

  it('cannot be deleted while orders reference it', async () => {
    const { customerId } = await createOrder(db());

    await expectDbError(db(), 'DELETE FROM customers WHERE customer_id = $1', [customerId], {
      code: SqlState.RESTRICT_VIOLATION,
      constraint: 'orders_customer_id_fkey',
    });
  });
});

describe('products', () => {
  it('rejects duplicate SKUs', async () => {
    await createProduct(db(), { sku: 'DUP-1' });

    await expectDbError(
      db(),
      `INSERT INTO products (category_id, sku, name, price)
       VALUES ((SELECT min(category_id) FROM categories), 'DUP-1', 'Duplicate', 1)`,
      [],
      { code: SqlState.UNIQUE_VIOLATION, constraint: 'products_sku_key' },
    );
  });

  it.each(['lower-case', 'SPACE 1', '-LEADING', 'TRAILING-', ''])('rejects SKU %j', async (sku) => {
    await expectDbError(db(), 'INSERT INTO products (category_id, sku, name, price) VALUES ($1, $2, $3, 1)', [
      await createCategory(db()),
      sku,
      'Product',
    ], { code: SqlState.CHECK_VIOLATION, constraint: 'products_sku_format' });
  });

  it('rejects negative prices', async () => {
    await expectDbError(
      db(),
      "INSERT INTO products (category_id, sku, name, price) VALUES ($1, 'NEG-1', 'Negative', -0.01)",
      [await createCategory(db())],
      { code: SqlState.CHECK_VIOLATION, constraint: 'products_price_non_negative' },
    );
  });

  it('rejects unknown categories', async () => {
    await expectDbError(
      db(),
      "INSERT INTO products (category_id, sku, name, price) VALUES (-1, 'ORPHAN-1', 'Orphan', 1)",
      [],
      { code: SqlState.FOREIGN_KEY_VIOLATION, constraint: 'products_category_id_fkey' },
    );
  });

  it('does not accept explicit ids for identity columns', async () => {
    await expectDbError(
      db(),
      "INSERT INTO categories (category_id, name) VALUES (123456, 'Explicit id')",
      [],
      { code: SqlState.GENERATED_ALWAYS },
    );
  });
});

describe('warehouses', () => {
  it('rejects duplicate codes', async () => {
    await createWarehouse(db(), 'ESP1');

    await expectDbError(
      db(),
      "INSERT INTO warehouses (code, name, city, country_code) VALUES ('ESP1', 'Other', 'Espoo', 'FI')",
      [],
      { code: SqlState.UNIQUE_VIOLATION, constraint: 'warehouses_code_key' },
    );
  });

  it.each(['fi', 'FIN', 'F1'])('rejects country code %j', async (countryCode) => {
    await expectDbError(
      db(),
      "INSERT INTO warehouses (code, name, city, country_code) VALUES ('BAD1', 'Bad', 'Nowhere', $1)",
      [countryCode],
      { code: SqlState.CHECK_VIOLATION, constraint: 'warehouses_country_code_format' },
    );
  });
});

describe('inventory', () => {
  it('derives available quantity from stock on hand and reservations', async () => {
    const { productId, warehouseId } = await createInventory(db(), { onHand: 10, reserved: 3 });

    const { rows } = await db().query(
      `SELECT quantity_available FROM inventory WHERE product_id = $1 AND warehouse_id = $2`,
      [productId, warehouseId],
    );
    expect(rows[0]).toEqual({ quantity_available: 7 });
  });

  it('rejects negative stock on hand', async () => {
    await expectDbError(
      db(),
      'INSERT INTO inventory (product_id, warehouse_id, quantity_on_hand) VALUES ($1, $2, -1)',
      [await createProduct(db()), await createWarehouse(db())],
      { code: SqlState.CHECK_VIOLATION, constraint: 'inventory_on_hand_non_negative' },
    );
  });

  it('rejects negative reservations', async () => {
    const { productId, warehouseId } = await createInventory(db(), { onHand: 5 });

    await expectDbError(
      db(),
      'UPDATE inventory SET quantity_reserved = -1 WHERE product_id = $1 AND warehouse_id = $2',
      [productId, warehouseId],
      { code: SqlState.CHECK_VIOLATION, constraint: 'inventory_reserved_non_negative' },
    );
  });

  it('rejects reserving more than is on hand', async () => {
    const { productId, warehouseId } = await createInventory(db(), { onHand: 3, reserved: 2 });

    await expectDbError(
      db(),
      `UPDATE inventory SET quantity_reserved = quantity_reserved + 2
       WHERE product_id = $1 AND warehouse_id = $2`,
      [productId, warehouseId],
      { code: SqlState.CHECK_VIOLATION, constraint: 'inventory_reserved_within_on_hand' },
    );
  });

  it('rejects reducing stock on hand below the reserved quantity', async () => {
    const { productId, warehouseId } = await createInventory(db(), { onHand: 5, reserved: 4 });

    await expectDbError(
      db(),
      'UPDATE inventory SET quantity_on_hand = 3 WHERE product_id = $1 AND warehouse_id = $2',
      [productId, warehouseId],
      { code: SqlState.CHECK_VIOLATION, constraint: 'inventory_reserved_within_on_hand' },
    );
  });

  it('allows only one row per product and warehouse', async () => {
    const { productId, warehouseId } = await createInventory(db(), { onHand: 1 });

    await expectDbError(
      db(),
      'INSERT INTO inventory (product_id, warehouse_id, quantity_on_hand) VALUES ($1, $2, 1)',
      [productId, warehouseId],
      { code: SqlState.UNIQUE_VIOLATION, constraint: 'inventory_pkey' },
    );
  });

  it('does not allow writing the available quantity directly', async () => {
    const { productId, warehouseId } = await createInventory(db(), { onHand: 1 });

    await expectDbError(
      db(),
      'UPDATE inventory SET quantity_available = 100 WHERE product_id = $1 AND warehouse_id = $2',
      [productId, warehouseId],
      { code: SqlState.GENERATED_ALWAYS },
    );
  });

  it('prevents deleting a product that has stock records', async () => {
    const { productId } = await createInventory(db(), { onHand: 1 });

    await expectDbError(db(), 'DELETE FROM products WHERE product_id = $1', [productId], {
      code: SqlState.RESTRICT_VIOLATION,
      constraint: 'inventory_product_id_fkey',
    });
  });
});

describe('orders', () => {
  it('defaults to pending status with a zero total', async () => {
    const { orderId } = await createOrder(db());

    const { rows } = await db().query('SELECT status, total_amount FROM orders WHERE order_id = $1', [
      orderId,
    ]);
    expect(rows[0]).toEqual({ status: 'pending', total_amount: '0.00' });
  });

  it('rejects unknown statuses', async () => {
    const { orderId } = await createOrder(db());

    await expectDbError(db(), "UPDATE orders SET status = 'lost' WHERE order_id = $1", [orderId], {
      code: SqlState.CHECK_VIOLATION,
      constraint: 'orders_status_valid',
    });
  });

  it('rejects negative totals', async () => {
    const { orderId } = await createOrder(db());

    await expectDbError(db(), 'UPDATE orders SET total_amount = -1 WHERE order_id = $1', [orderId], {
      code: SqlState.CHECK_VIOLATION,
      constraint: 'orders_total_amount_non_negative',
    });
  });

  it('rejects unknown customers', async () => {
    await expectDbError(
      db(),
      'INSERT INTO orders (customer_id, warehouse_id) VALUES (-1, $1)',
      [await createWarehouse(db())],
      { code: SqlState.FOREIGN_KEY_VIOLATION, constraint: 'orders_customer_id_fkey' },
    );
  });
});

describe('order_items', () => {
  const insertItem =
    'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)';

  it('calculates the line total', async () => {
    const { orderId } = await createOrder(db());
    const productId = await createProduct(db());

    const { rows } = await db().query(`${insertItem} RETURNING line_total`, [orderId, productId, 3, '19.95']);
    expect(rows[0]).toEqual({ line_total: '59.85' });
  });

  it.each([0, -1])('rejects quantity %d', async (quantity) => {
    const { orderId } = await createOrder(db());

    await expectDbError(db(), insertItem, [orderId, await createProduct(db()), quantity, '1.00'], {
      code: SqlState.CHECK_VIOLATION,
      constraint: 'order_items_quantity_positive',
    });
  });

  it('rejects negative unit prices', async () => {
    const { orderId } = await createOrder(db());

    await expectDbError(db(), insertItem, [orderId, await createProduct(db()), 1, '-5.00'], {
      code: SqlState.CHECK_VIOLATION,
      constraint: 'order_items_unit_price_non_negative',
    });
  });

  it('allows each product only once per order', async () => {
    const { orderId } = await createOrder(db());
    const productId = await createProduct(db());
    await db().query(insertItem, [orderId, productId, 1, '1.00']);

    await expectDbError(db(), insertItem, [orderId, productId, 2, '1.00'], {
      code: SqlState.UNIQUE_VIOLATION,
      constraint: 'order_items_order_product_key',
    });
  });

  it('is deleted together with its order', async () => {
    const { orderId } = await createOrder(db());
    await db().query(insertItem, [orderId, await createProduct(db()), 1, '1.00']);

    await db().query('DELETE FROM orders WHERE order_id = $1', [orderId]);

    const { rows } = await db().query('SELECT count(*)::int AS n FROM order_items WHERE order_id = $1', [
      orderId,
    ]);
    expect(rows[0]).toEqual({ n: 0 });
  });

  it('prevents deleting a product that appears in order history', async () => {
    const { orderId } = await createOrder(db());
    const productId = await createProduct(db());
    await db().query(insertItem, [orderId, productId, 1, '1.00']);

    await expectDbError(db(), 'DELETE FROM products WHERE product_id = $1', [productId], {
      code: SqlState.RESTRICT_VIOLATION,
      constraint: 'order_items_product_id_fkey',
    });
  });
});
