import { describe, expect, it } from 'vitest';
import { initialValues, type Operation, operations } from './operations.ts';

const byId = (id: string) => operations.find((op) => op.id === id) as Operation;

describe('operations', () => {
  it('each call exactly one database function through the API', () => {
    expect(operations.map((op) => [op.id, op.dbFunction])).toEqual([
      ['customer-orders', 'get_customer_orders'],
      ['product-availability', 'get_product_availability'],
      ['reserve-stock', 'reserve_stock'],
      ['create-order', 'create_order'],
      ['best-selling', 'get_best_selling_products'],
    ]);
    for (const op of operations) {
      expect(op.toRequest(initialValues(op)).path).toMatch(/^\/api\//);
    }
  });

  it('builds the customer orders request', () => {
    expect(byId('customer-orders').toRequest({ customerId: '12' })).toEqual({
      method: 'GET',
      path: '/api/customers/12/orders',
    });
  });

  it('URL-encodes values in paths and query strings', () => {
    expect(byId('product-availability').toRequest({ productId: '5/x', warehouseId: '1&debug=1' }).path).toBe(
      '/api/products/5%2Fx/availability?warehouseId=1%26debug%3D1',
    );
  });

  it('sends numbers as JSON numbers, and invalid input unchanged for the API to reject', () => {
    expect(byId('reserve-stock').toRequest({ productId: '5', warehouseId: '1', quantity: 'two' })).toEqual({
      method: 'POST',
      path: '/api/inventory/reserve',
      body: { productId: 5, warehouseId: 1, quantity: 'two' },
    });
  });

  it('builds the create order body with camelCase lines', () => {
    const request = byId('create-order').toRequest({
      customerId: '1',
      warehouseId: '1',
      items: [
        { productId: '5', quantity: '2' },
        { productId: '7', quantity: '1' },
      ],
    });

    expect(request.body).toEqual({
      customerId: 1,
      warehouseId: 1,
      items: [
        { productId: 5, quantity: 2 },
        { productId: 7, quantity: 1 },
      ],
    });
  });

  it('shows list responses as tables', () => {
    const view = byId('best-selling').toView({
      products: [{ productId: 11, sku: 'OUTD-3003', name: 'Bottle', unitsSold: 3, revenue: '89.70' }],
    });

    expect(view).toMatchObject({ kind: 'table', columns: ['productId', 'sku', 'name', 'unitsSold', 'revenue'] });
  });
});
