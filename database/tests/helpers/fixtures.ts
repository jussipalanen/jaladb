import type { Client } from 'pg';

// BIGINT ids are returned by pg as strings to avoid precision loss.
export type Id = string;

let sequence = 0;
const next = () => ++sequence;

async function insertReturningId(client: Client, sql: string, params: unknown[]): Promise<Id> {
  const { rows } = await client.query<{ id: Id }>(sql, params);
  return rows[0]!.id;
}

export function createCategory(client: Client, name = `Category ${next()}`): Promise<Id> {
  return insertReturningId(
    client,
    'INSERT INTO categories (name) VALUES ($1) RETURNING category_id AS id',
    [name],
  );
}

export async function createProduct(
  client: Client,
  { sku = `TEST-${next()}`, price = '10.00' }: { sku?: string; price?: string } = {},
): Promise<Id> {
  const categoryId = await createCategory(client);
  return insertReturningId(
    client,
    `INSERT INTO products (category_id, sku, name, price)
     VALUES ($1, $2, $3, $4) RETURNING product_id AS id`,
    [categoryId, sku, `Product ${sku}`, price],
  );
}

export function createCustomer(client: Client, email = `customer${next()}@example.com`): Promise<Id> {
  return insertReturningId(
    client,
    `INSERT INTO customers (email, first_name, last_name)
     VALUES ($1, 'Test', 'Customer') RETURNING customer_id AS id`,
    [email],
  );
}

export function createWarehouse(client: Client, code = `WH${next()}`): Promise<Id> {
  return insertReturningId(
    client,
    `INSERT INTO warehouses (code, name, city, country_code)
     VALUES ($1, $2, 'Helsinki', 'FI') RETURNING warehouse_id AS id`,
    [code, `Warehouse ${code}`],
  );
}

export interface StockLevels {
  onHand: number;
  reserved?: number;
}

/** Adds an inventory row for an existing product and warehouse. */
export async function stockProduct(
  client: Client,
  productId: Id,
  warehouseId: Id,
  { onHand, reserved = 0 }: StockLevels,
): Promise<void> {
  await client.query(
    `INSERT INTO inventory (product_id, warehouse_id, quantity_on_hand, quantity_reserved)
     VALUES ($1, $2, $3, $4)`,
    [productId, warehouseId, onHand, reserved],
  );
}

/** Creates a new product and warehouse with the given stock between them. */
export async function createInventory(
  client: Client,
  levels: StockLevels,
): Promise<{ productId: Id; warehouseId: Id }> {
  const productId = await createProduct(client);
  const warehouseId = await createWarehouse(client);
  await stockProduct(client, productId, warehouseId, levels);
  return { productId, warehouseId };
}

export interface OrderOptions {
  customerId?: Id;
  status?: string;
  totalAmount?: string;
  createdAt?: string;
}

export async function createOrder(
  client: Client,
  { customerId, status = 'pending', totalAmount = '0.00', createdAt }: OrderOptions = {},
): Promise<{ orderId: Id; customerId: Id }> {
  const owner = customerId ?? (await createCustomer(client));
  const warehouseId = await createWarehouse(client);
  const orderId = await insertReturningId(
    client,
    `INSERT INTO orders (customer_id, warehouse_id, status, total_amount, created_at)
     VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()))
     RETURNING order_id AS id`,
    [owner, warehouseId, status, totalAmount, createdAt ?? null],
  );
  return { orderId, customerId: owner };
}

/** Adds a line for a new product to an order. */
export async function addOrderItem(
  client: Client,
  orderId: Id,
  { quantity, unitPrice = '1.00' }: { quantity: number; unitPrice?: string },
): Promise<void> {
  const productId = await createProduct(client, { price: unitPrice });
  await client.query(
    'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
    [orderId, productId, quantity, unitPrice],
  );
}
