import { describe, expect, it } from 'vitest';
import { expectDbError, useRollbackClient } from '../helpers/db.ts';
import { addOrderItem, createCustomer, createOrder, type Id } from '../helpers/fixtures.ts';

const db = useRollbackClient();

async function getCustomerOrders(customerId: Id) {
  const { rows } = await db().query('SELECT * FROM get_customer_orders($1)', [customerId]);
  return rows;
}

describe('get_customer_orders', () => {
  it('returns only the requested customer’s orders', async () => {
    const customerId = await createCustomer(db());
    const otherCustomerId = await createCustomer(db());
    const { orderId: first } = await createOrder(db(), { customerId });
    const { orderId: second } = await createOrder(db(), { customerId });
    await createOrder(db(), { customerId: otherCustomerId });

    const orders = await getCustomerOrders(customerId);

    expect(orders.map((o) => o.order_id).sort()).toEqual([first, second].sort());
  });

  it('returns the order fields', async () => {
    const customerId = await createCustomer(db());
    const { orderId } = await createOrder(db(), {
      customerId,
      status: 'paid',
      totalAmount: '44.85',
      createdAt: '2026-03-01T10:00:00Z',
    });
    await addOrderItem(db(), orderId, { quantity: 2, unitPrice: '14.95' });
    await addOrderItem(db(), orderId, { quantity: 1, unitPrice: '14.95' });

    const orders = await getCustomerOrders(customerId);

    expect(orders).toEqual([
      {
        order_id: orderId,
        status: 'paid',
        total_amount: '44.85',
        item_count: 3,
        created_at: new Date('2026-03-01T10:00:00Z'),
      },
    ]);
  });

  it('counts zero items for an order without lines', async () => {
    const { customerId } = await createOrder(db());

    const [order] = await getCustomerOrders(customerId);

    expect(order).toMatchObject({ item_count: 0 });
  });

  it('lists the newest orders first', async () => {
    const customerId = await createCustomer(db());
    const dates = ['2026-02-01T00:00:00Z', '2026-06-01T00:00:00Z', '2026-04-01T00:00:00Z'];
    for (const createdAt of dates) {
      await createOrder(db(), { customerId, createdAt });
    }

    const orders = await getCustomerOrders(customerId);

    expect(orders.map((o) => (o.created_at as Date).toISOString())).toEqual([
      '2026-06-01T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
    ]);
  });

  it('orders by id when orders share a timestamp', async () => {
    const customerId = await createCustomer(db());
    const createdAt = '2026-05-05T12:00:00Z';
    const { orderId: older } = await createOrder(db(), { customerId, createdAt });
    const { orderId: newer } = await createOrder(db(), { customerId, createdAt });

    const orders = await getCustomerOrders(customerId);

    expect(orders.map((o) => o.order_id)).toEqual([newer, older]);
  });

  it('returns an empty result for a customer without orders', async () => {
    const customerId = await createCustomer(db());

    expect(await getCustomerOrders(customerId)).toEqual([]);
  });

  it('raises no_data_found for an unknown customer', async () => {
    await expectDbError(db(), 'SELECT * FROM get_customer_orders($1)', [-1], {
      code: 'P0002',
      message: 'customer -1 does not exist',
    });
  });

  it('raises invalid_parameter_value for a NULL customer id', async () => {
    await expectDbError(db(), 'SELECT * FROM get_customer_orders($1)', [null], {
      code: '22023',
      message: 'customer id must not be NULL',
    });
  });

  it('is declared STABLE (read-only)', async () => {
    const { rows } = await db().query(
      "SELECT provolatile FROM pg_proc WHERE oid = 'get_customer_orders(bigint)'::regprocedure",
    );

    expect(rows[0]).toEqual({ provolatile: 's' });
  });
});
