import { describe, expect, it } from 'vitest';
import { expectDbError, useRollbackClient } from '../helpers/db.ts';
import { createInventory, createProduct, createWarehouse, type Id } from '../helpers/fixtures.ts';

const db = useRollbackClient();

const RESERVE = 'SELECT reserve_stock($1, $2, $3) AS remaining';

async function reserve(productId: Id, warehouseId: Id, quantity: number): Promise<number> {
  const { rows } = await db().query(RESERVE, [productId, warehouseId, quantity]);
  return rows[0].remaining;
}

async function stock(productId: Id, warehouseId: Id) {
  const { rows } = await db().query(
    'SELECT quantity_on_hand, quantity_reserved FROM inventory WHERE product_id = $1 AND warehouse_id = $2',
    [productId, warehouseId],
  );
  return rows[0];
}

describe('reserve_stock', () => {
  it('reserves stock and returns the remaining available quantity', async () => {
    const { productId, warehouseId } = await createInventory(db(), { onHand: 10, reserved: 3 });

    expect(await reserve(productId, warehouseId, 2)).toBe(5);
    expect(await stock(productId, warehouseId)).toEqual({ quantity_on_hand: 10, quantity_reserved: 5 });
  });

  it('accumulates consecutive reservations', async () => {
    const { productId, warehouseId } = await createInventory(db(), { onHand: 10 });

    expect(await reserve(productId, warehouseId, 2)).toBe(8);
    expect(await reserve(productId, warehouseId, 3)).toBe(5);
    expect(await stock(productId, warehouseId)).toMatchObject({ quantity_reserved: 5 });
  });

  it('can reserve exactly all available stock', async () => {
    const { productId, warehouseId } = await createInventory(db(), { onHand: 6, reserved: 2 });

    expect(await reserve(productId, warehouseId, 4)).toBe(0);
    expect(await stock(productId, warehouseId)).toEqual({ quantity_on_hand: 6, quantity_reserved: 6 });
  });

  describe('insufficient stock', () => {
    it('raises JD001 with the requested and available quantities', async () => {
      const { productId, warehouseId } = await createInventory(db(), { onHand: 5, reserved: 2 });

      await expectDbError(db(), RESERVE, [productId, warehouseId, 4], {
        code: 'JD001',
        message: `insufficient stock for product ${productId} in warehouse ${warehouseId}: requested 4, available 3`,
      });
    });

    it('leaves the inventory unchanged', async () => {
      const { productId, warehouseId } = await createInventory(db(), { onHand: 5, reserved: 2 });

      await expectDbError(db(), RESERVE, [productId, warehouseId, 4], { code: 'JD001' });

      expect(await stock(productId, warehouseId)).toEqual({ quantity_on_hand: 5, quantity_reserved: 2 });
    });

    it('raises JD001 when the product is not stocked in the warehouse', async () => {
      const productId = await createProduct(db());
      const warehouseId = await createWarehouse(db());

      await expectDbError(db(), RESERVE, [productId, warehouseId, 1], {
        code: 'JD001',
        message: expect.stringContaining('requested 1, available 0'),
      });
    });
  });

  describe('inactive product or warehouse', () => {
    it('raises JD002 for an inactive product', async () => {
      const { productId, warehouseId } = await createInventory(db(), { onHand: 5 });
      await db().query('UPDATE products SET is_active = false WHERE product_id = $1', [productId]);

      await expectDbError(db(), RESERVE, [productId, warehouseId, 1], {
        code: 'JD002',
        message: `product ${productId} is not active`,
      });
    });

    it('raises JD002 for an inactive warehouse', async () => {
      const { productId, warehouseId } = await createInventory(db(), { onHand: 5 });
      await db().query('UPDATE warehouses SET is_active = false WHERE warehouse_id = $1', [warehouseId]);

      await expectDbError(db(), RESERVE, [productId, warehouseId, 1], {
        code: 'JD002',
        message: `warehouse ${warehouseId} is not active`,
      });
    });
  });

  describe('invalid arguments', () => {
    it('raises no_data_found for an unknown product', async () => {
      await expectDbError(db(), RESERVE, [-1, await createWarehouse(db()), 1], {
        code: 'P0002',
        message: 'product -1 does not exist',
      });
    });

    it('raises no_data_found for an unknown warehouse', async () => {
      await expectDbError(db(), RESERVE, [await createProduct(db()), -1, 1], {
        code: 'P0002',
        message: 'warehouse -1 does not exist',
      });
    });

    it.each([0, -3])('raises invalid_parameter_value for quantity %d', async (quantity) => {
      const { productId, warehouseId } = await createInventory(db(), { onHand: 5 });

      await expectDbError(db(), RESERVE, [productId, warehouseId, quantity], {
        code: '22023',
        message: `quantity must be positive, got ${quantity}`,
      });
    });

    it.each([
      ['product id', [null, 1, 1]],
      ['warehouse id', [1, null, 1]],
      ['quantity', [1, 1, null]],
    ])('raises invalid_parameter_value for a NULL %s', async (_, params) => {
      await expectDbError(db(), RESERVE, params, {
        code: '22023',
        message: 'product id, warehouse id and quantity must not be NULL',
      });
    });
  });
});
