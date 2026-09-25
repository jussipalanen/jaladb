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

export async function createInventory(
  client: Client,
  { onHand, reserved = 0 }: { onHand: number; reserved?: number },
): Promise<{ productId: Id; warehouseId: Id }> {
  const productId = await createProduct(client);
  const warehouseId = await createWarehouse(client);
  await client.query(
    `INSERT INTO inventory (product_id, warehouse_id, quantity_on_hand, quantity_reserved)
     VALUES ($1, $2, $3, $4)`,
    [productId, warehouseId, onHand, reserved],
  );
  return { productId, warehouseId };
}

export async function createOrder(client: Client): Promise<{ orderId: Id; customerId: Id }> {
  const customerId = await createCustomer(client);
  const warehouseId = await createWarehouse(client);
  const orderId = await insertReturningId(
    client,
    'INSERT INTO orders (customer_id, warehouse_id) VALUES ($1, $2) RETURNING order_id AS id',
    [customerId, warehouseId],
  );
  return { orderId, customerId };
}
