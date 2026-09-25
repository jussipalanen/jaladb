import type { FastifyInstance } from 'fastify';
import type { Queryable } from '../db.ts';
import { id, quantity } from './schemas.ts';

interface ReserveBody {
  productId: number;
  warehouseId: number;
  quantity: number;
}

export function registerInventoryRoutes(app: FastifyInstance, db: Queryable): void {
  app.post<{ Body: ReserveBody }>(
    '/api/inventory/reserve',
    {
      schema: {
        body: {
          type: 'object',
          required: ['productId', 'warehouseId', 'quantity'],
          properties: { productId: id, warehouseId: id, quantity },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const body = request.body;
      const { rows } = await db.query('SELECT reserve_stock($1, $2, $3) AS remaining', [
        body.productId,
        body.warehouseId,
        body.quantity,
      ]);
      return {
        productId: body.productId,
        warehouseId: body.warehouseId,
        reservedQuantity: body.quantity,
        quantityAvailable: rows[0].remaining,
      };
    },
  );
}
