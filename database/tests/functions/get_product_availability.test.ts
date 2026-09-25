import { describe, expect, it } from 'vitest';
import { expectDbError, useRollbackClient } from '../helpers/db.ts';
import {
  createInventory,
  createProduct,
  createWarehouse,
  type Id,
  stockProduct,
} from '../helpers/fixtures.ts';

const db = useRollbackClient();

async function getAvailability(productId: Id | null, warehouseId: Id | null) {
  const { rows } = await db().query('SELECT * FROM get_product_availability($1, $2)', [
    productId,
    warehouseId,
  ]);
  return rows;
}

describe('get_product_availability', () => {
  it('returns stock on hand, reserved and available', async () => {
    const { productId, warehouseId } = await createInventory(db(), { onHand: 10, reserved: 3 });

    expect(await getAvailability(productId, warehouseId)).toEqual([
      { quantity_on_hand: 10, quantity_reserved: 3, quantity_available: 7 },
    ]);
  });

  it('returns only the requested warehouse’s stock', async () => {
    const productId = await createProduct(db());
    const helsinki = await createWarehouse(db());
    const tampere = await createWarehouse(db());
    await stockProduct(db(), productId, helsinki, { onHand: 50, reserved: 5 });
    await stockProduct(db(), productId, tampere, { onHand: 8 });

    expect(await getAvailability(productId, tampere)).toEqual([
      { quantity_on_hand: 8, quantity_reserved: 0, quantity_available: 8 },
    ]);
  });

  it('returns zeros when the product is not stocked in the warehouse', async () => {
    const productId = await createProduct(db());
    const warehouseId = await createWarehouse(db());

    expect(await getAvailability(productId, warehouseId)).toEqual([
      { quantity_on_hand: 0, quantity_reserved: 0, quantity_available: 0 },
    ]);
  });

  it('reports nothing available when all stock is reserved', async () => {
    const { productId, warehouseId } = await createInventory(db(), { onHand: 4, reserved: 4 });

    expect(await getAvailability(productId, warehouseId)).toEqual([
      { quantity_on_hand: 4, quantity_reserved: 4, quantity_available: 0 },
    ]);
  });

  it('raises no_data_found for an unknown product', async () => {
    const warehouseId = await createWarehouse(db());

    await expectDbError(db(), 'SELECT * FROM get_product_availability($1, $2)', [-1, warehouseId], {
      code: 'P0002',
      message: 'product -1 does not exist',
    });
  });

  it('raises no_data_found for an unknown warehouse', async () => {
    const productId = await createProduct(db());

    await expectDbError(db(), 'SELECT * FROM get_product_availability($1, $2)', [productId, -1], {
      code: 'P0002',
      message: 'warehouse -1 does not exist',
    });
  });

  it.each([
    ['product', null, 1],
    ['warehouse', 1, null],
  ])('raises invalid_parameter_value for a NULL %s id', async (_, productId, warehouseId) => {
    await expectDbError(
      db(),
      'SELECT * FROM get_product_availability($1, $2)',
      [productId, warehouseId],
      { code: '22023', message: 'product id and warehouse id must not be NULL' },
    );
  });

  it('is declared STABLE (read-only)', async () => {
    const { rows } = await db().query(
      "SELECT provolatile FROM pg_proc WHERE oid = 'get_product_availability(bigint, bigint)'::regprocedure",
    );

    expect(rows[0]).toEqual({ provolatile: 's' });
  });
});
