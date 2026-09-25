import { describe, expect, it } from 'vitest';
import { useApi } from './helpers.ts';

const api = useApi();

describe('GET /api/products/:id/availability', () => {
  it('returns the stock of the product in the warehouse', async () => {
    const response = await api.app().inject('/api/products/5/availability?warehouseId=1');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      productId: 5,
      warehouseId: 1,
      quantityOnHand: 40,
      quantityReserved: 1,
      quantityAvailable: 39,
    });
  });

  it('returns zeros when the product is not stocked in the warehouse', async () => {
    const response = await api.app().inject('/api/products/5/availability?warehouseId=3');

    expect(response.json()).toMatchObject({ quantityOnHand: 0, quantityReserved: 0, quantityAvailable: 0 });
  });

  it('requires a warehouseId', async () => {
    const response = await api.app().inject('/api/products/5/availability');

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: "querystring must have required property 'warehouseId'" },
    });
  });

  it('rejects unknown query parameters', async () => {
    const response = await api.app().inject('/api/products/5/availability?warehouseId=1&debug=true');

    expect(response.statusCode).toBe(400);
  });

  it.each([
    ['product', '/api/products/999/availability?warehouseId=1', 'product 999 does not exist'],
    ['warehouse', '/api/products/5/availability?warehouseId=999', 'warehouse 999 does not exist'],
  ])('returns 404 for an unknown %s', async (_, url, message) => {
    const response = await api.app().inject(url);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: 'NOT_FOUND', message, sqlstate: 'P0002' } });
  });
});
