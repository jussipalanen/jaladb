import { describe, expect, it } from 'vitest';
import { expectDbError, SqlState, useRollbackClient } from '../helpers/db.ts';
import {
  addOrderItem,
  createCustomer,
  createOrder,
  createProduct,
  createWarehouse,
  type Id,
  stockProduct,
} from '../helpers/fixtures.ts';

const db = useRollbackClient();

async function history(orderId: Id) {
  const { rows } = await db().query(
    `SELECT old_status, new_status FROM order_status_history
     WHERE order_id = $1 ORDER BY changed_at, history_id`,
    [orderId],
  );
  return rows;
}

async function setStatus(orderId: Id, status: string) {
  await db().query('UPDATE orders SET status = $2 WHERE order_id = $1', [orderId, status]);
}

describe('order status history', () => {
  describe('when an order is created', () => {
    it('records the initial status at the order’s creation time', async () => {
      const { orderId } = await createOrder(db(), { createdAt: '2026-03-01T10:00:00Z' });

      const { rows } = await db().query(
        'SELECT old_status, new_status, changed_at FROM order_status_history WHERE order_id = $1',
        [orderId],
      );
      expect(rows).toEqual([
        { old_status: null, new_status: 'pending', changed_at: new Date('2026-03-01T10:00:00Z') },
      ]);
    });

    it('records one row per order for a multi-row insert', async () => {
      const customerId = await createCustomer(db());
      const warehouseId = await createWarehouse(db());

      const { rows: orders } = await db().query(
        `INSERT INTO orders (customer_id, warehouse_id, status)
         SELECT $1, $2, status FROM unnest(ARRAY['pending', 'paid', 'delivered']) AS status
         RETURNING order_id, status`,
        [customerId, warehouseId],
      );

      for (const order of orders) {
        expect(await history(order.order_id)).toEqual([{ old_status: null, new_status: order.status }]);
      }
    });

    it('records orders placed with create_order()', async () => {
      const customerId = await createCustomer(db());
      const warehouseId = await createWarehouse(db());
      const productId = await createProduct(db());
      await stockProduct(db(), productId, warehouseId, { onHand: 5 });

      const { rows } = await db().query('SELECT create_order($1, $2, $3) AS order_id', [
        customerId,
        warehouseId,
        JSON.stringify([{ product_id: productId, quantity: 1 }]),
      ]);

      expect(await history(rows[0].order_id)).toEqual([{ old_status: null, new_status: 'pending' }]);
    });
  });

  describe('when the status changes', () => {
    it('records the old and the new status', async () => {
      const { orderId } = await createOrder(db());

      await setStatus(orderId, 'paid');

      expect(await history(orderId)).toEqual([
        { old_status: null, new_status: 'pending' },
        { old_status: 'pending', new_status: 'paid' },
      ]);
    });

    it('records a sequence of changes in order', async () => {
      const { orderId } = await createOrder(db());

      for (const status of ['paid', 'shipped', 'delivered']) {
        await setStatus(orderId, status);
      }

      expect(await history(orderId)).toEqual([
        { old_status: null, new_status: 'pending' },
        { old_status: 'pending', new_status: 'paid' },
        { old_status: 'paid', new_status: 'shipped' },
        { old_status: 'shipped', new_status: 'delivered' },
      ]);
    });

    it('records only the rows whose status changed in a multi-row update', async () => {
      const customerId = await createCustomer(db());
      const { orderId: pending } = await createOrder(db(), { customerId });
      const { orderId: alreadyCancelled } = await createOrder(db(), { customerId, status: 'cancelled' });

      await db().query("UPDATE orders SET status = 'cancelled' WHERE customer_id = $1", [customerId]);

      expect(await history(pending)).toHaveLength(2);
      expect(await history(alreadyCancelled)).toEqual([{ old_status: null, new_status: 'cancelled' }]);
    });

    it('is rolled back together with the status change', async () => {
      const { orderId } = await createOrder(db());

      await db().query('SAVEPOINT change');
      await setStatus(orderId, 'paid');
      await db().query('ROLLBACK TO SAVEPOINT change');

      expect(await history(orderId)).toEqual([{ old_status: null, new_status: 'pending' }]);
    });
  });

  describe('when nothing really changes', () => {
    it('records nothing when the status is set to its current value', async () => {
      const { orderId } = await createOrder(db(), { status: 'paid' });

      await setStatus(orderId, 'paid');

      expect(await history(orderId)).toEqual([{ old_status: null, new_status: 'paid' }]);
    });

    it('records nothing when only other columns change', async () => {
      const { orderId } = await createOrder(db());
      await addOrderItem(db(), orderId, { quantity: 2, unitPrice: '5.00' });

      await db().query("UPDATE orders SET total_amount = '10.00' WHERE order_id = $1", [orderId]);

      expect(await history(orderId)).toHaveLength(1);
    });
  });

  describe('order_status_history table', () => {
    it('is deleted together with its order', async () => {
      const { orderId } = await createOrder(db());
      await setStatus(orderId, 'cancelled');

      await db().query('DELETE FROM orders WHERE order_id = $1', [orderId]);

      expect(await history(orderId)).toEqual([]);
    });

    it('rejects rows that are not a change', async () => {
      const { orderId } = await createOrder(db());

      await expectDbError(
        db(),
        "INSERT INTO order_status_history (order_id, old_status, new_status) VALUES ($1, 'paid', 'paid')",
        [orderId],
        { code: SqlState.CHECK_VIOLATION, constraint: 'order_status_history_status_changed' },
      );
    });

    it('rejects rows for unknown orders', async () => {
      await expectDbError(
        db(),
        "INSERT INTO order_status_history (order_id, new_status) VALUES (-1, 'pending')",
        [],
        { code: SqlState.FOREIGN_KEY_VIOLATION, constraint: 'order_status_history_order_id_fkey' },
      );
    });
  });
});
