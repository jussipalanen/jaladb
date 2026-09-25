import { describe, expect, it } from 'vitest';
import { useApi } from './helpers.ts';

const api = useApi();

const createOrder = (payload: object) => api.app().inject({ method: 'POST', url: '/api/orders', payload });

async function orderCount(customerId: number): Promise<number> {
  const { rows } = await api.query('SELECT count(*)::int AS n FROM orders WHERE customer_id = $1', [customerId]);
  return rows[0]!.n;
}

async function reserved(productId: number): Promise<number> {
  const { rows } = await api.query(
    'SELECT quantity_reserved FROM inventory WHERE product_id = $1 AND warehouse_id = 1',
    [productId],
  );
  return rows[0]!.quantity_reserved;
}

describe('POST /api/orders', () => {
  it('creates the order and returns 201 with its id', async () => {
    const response = await createOrder({
      customerId: 1,
      warehouseId: 1,
      items: [
        { productId: 7, quantity: 1 },
        { productId: 5, quantity: 2 },
      ],
    });

    expect(response.statusCode).toBe(201);
    const { orderId } = response.json();
    expect(orderId).toBe(19);

    // The order is visible through the customer orders endpoint.
    const orders = await api.app().inject('/api/customers/1/orders');
    expect(orders.json().orders[0]).toMatchObject({
      orderId: 19,
      status: 'pending',
      totalAmount: '477.00',
      itemCount: 3,
    });
    expect(await reserved(5)).toBe(3);
    expect(await reserved(7)).toBe(1);
  });

  it('returns 409 and leaves no order and no reservations when a line lacks stock', async () => {
    const response = await createOrder({
      customerId: 1,
      warehouseId: 1,
      items: [
        { productId: 5, quantity: 1 },
        { productId: 7, quantity: 999 },
      ],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatchObject({ code: 'INSUFFICIENT_STOCK', sqlstate: 'JD001' });
    expect(await orderCount(1)).toBe(3);
    expect(await reserved(5)).toBe(1);
    expect(await reserved(7)).toBe(0);
  });

  it('returns 400 INVALID_ARGUMENT for a product listed twice (checked by the database)', async () => {
    const response = await createOrder({
      customerId: 1,
      warehouseId: 1,
      items: [
        { productId: 5, quantity: 1 },
        { productId: 5, quantity: 2 },
      ],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'INVALID_ARGUMENT', message: 'product 5 appears more than once in items', sqlstate: '22023' },
    });
  });

  it('returns 404 for an unknown customer', async () => {
    const response = await createOrder({ customerId: 999, warehouseId: 1, items: [{ productId: 5, quantity: 1 }] });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.message).toBe('customer 999 does not exist');
  });

  it.each([
    ['no items', { customerId: 1, warehouseId: 1, items: [] }],
    ['a missing warehouse', { customerId: 1, items: [{ productId: 5, quantity: 1 }] }],
    ['an item without quantity', { customerId: 1, warehouseId: 1, items: [{ productId: 5 }] }],
    ['a negative quantity', { customerId: 1, warehouseId: 1, items: [{ productId: 5, quantity: -1 }] }],
    ['snake_case fields', { customerId: 1, warehouseId: 1, items: [{ product_id: 5, quantity: 1 }] }],
    ['items as an object', { customerId: 1, warehouseId: 1, items: { productId: 5, quantity: 1 } }],
  ])('rejects %s with 400 before calling the database', async (_, payload) => {
    const response = await createOrder(payload);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(await orderCount(1)).toBe(3);
  });
});
