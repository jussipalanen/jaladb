import { describe, expect, it } from 'vitest';
import { useApi } from './helpers.ts';

const api = useApi();

const reserve = (payload: object) =>
  api.app().inject({ method: 'POST', url: '/api/inventory/reserve', payload });

async function available(productId: number, warehouseId: number): Promise<number> {
  const { rows } = await api.query(
    'SELECT quantity_available FROM get_product_availability($1, $2)',
    [productId, warehouseId],
  );
  return rows[0]!.quantity_available;
}

describe('POST /api/inventory/reserve', () => {
  it('reserves stock and returns the quantity still available', async () => {
    const response = await reserve({ productId: 5, warehouseId: 1, quantity: 2 });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ productId: 5, warehouseId: 1, reservedQuantity: 2, quantityAvailable: 37 });
    expect(await available(5, 1)).toBe(37);
  });

  it('returns 409 INSUFFICIENT_STOCK and reserves nothing when stock is short', async () => {
    const response = await reserve({ productId: 5, warehouseId: 1, quantity: 40 });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: 'INSUFFICIENT_STOCK',
        message: 'insufficient stock for product 5 in warehouse 1: requested 40, available 39',
        sqlstate: 'JD001',
      },
    });
    expect(await available(5, 1)).toBe(39);
  });

  it('returns 409 NOT_ACTIVE for a discontinued product', async () => {
    // SPRT-6004 (ski wax kit) is inactive in the seed data.
    const { rows } = await api.query("SELECT product_id FROM products WHERE sku = 'SPRT-6004'");

    const response = await reserve({ productId: rows[0]!.product_id, warehouseId: 1, quantity: 1 });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatchObject({ code: 'NOT_ACTIVE', sqlstate: 'JD002' });
  });

  it('returns 404 for an unknown product', async () => {
    const response = await reserve({ productId: 999, warehouseId: 1, quantity: 1 });

    expect(response.statusCode).toBe(404);
  });

  it.each([
    ['a missing quantity', { productId: 5, warehouseId: 1 }],
    ['a zero quantity', { productId: 5, warehouseId: 1, quantity: 0 }],
    ['a decimal quantity', { productId: 5, warehouseId: 1, quantity: 1.5 }],
    ['a quantity as text', { productId: 5, warehouseId: 1, quantity: 'two' }],
    ['an unknown field', { productId: 5, warehouseId: 1, quantity: 1, force: true }],
  ])('rejects %s with 400', async (_, payload) => {
    const response = await reserve(payload);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(await available(5, 1)).toBe(39);
  });
});
