import { describe, expect, it } from 'vitest';
import { useApi } from './helpers.ts';

const api = useApi();

describe('GET /api/customers/:id/orders', () => {
  it('returns the customer’s orders, newest first, in camelCase', async () => {
    const response = await api.app().inject('/api/customers/1/orders');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      customerId: 1,
      orders: [
        { orderId: 14, status: 'cancelled', totalAmount: '79.00', itemCount: 1, createdAt: '2026-08-02T19:17:00.000Z' },
        { orderId: 6, status: 'delivered', totalAmount: '174.80', itemCount: 2, createdAt: '2026-03-11T06:20:00.000Z' },
        { orderId: 1, status: 'delivered', totalAmount: '278.80', itemCount: 3, createdAt: '2026-01-08T08:15:00.000Z' },
      ],
    });
  });

  it('returns an empty list for a customer without orders', async () => {
    const response = await api.app().inject('/api/customers/12/orders');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ customerId: 12, orders: [] });
  });

  it('returns 404 NOT_FOUND for an unknown customer', async () => {
    const response = await api.app().inject('/api/customers/999/orders');

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'customer 999 does not exist', sqlstate: 'P0002' },
    });
  });

  it.each(['abc', '0', '-1', '1.5'])('rejects the customer id %j with 400', async (id) => {
    const response = await api.app().inject(`/api/customers/${id}/orders`);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});
