import type { FastifyInstance } from 'fastify';
import type { Queryable } from '../db.ts';
import { idParams } from './schemas.ts';

export function registerCustomerRoutes(app: FastifyInstance, db: Queryable): void {
  app.get<{ Params: { id: number } }>(
    '/api/customers/:id/orders',
    { schema: { params: idParams } },
    async (request) => {
      const customerId = request.params.id;
      const { rows } = await db.query(
        `SELECT order_id, status, total_amount, item_count, created_at
         FROM get_customer_orders($1)`,
        [customerId],
      );
      return {
        customerId,
        orders: rows.map((row) => ({
          orderId: row.order_id,
          status: row.status,
          totalAmount: row.total_amount,
          itemCount: row.item_count,
          createdAt: row.created_at,
        })),
      };
    },
  );
}
