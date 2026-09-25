import type { FastifyInstance } from 'fastify';
import type { Queryable } from '../db.ts';
import { id, idParams } from './schemas.ts';

export function registerProductRoutes(app: FastifyInstance, db: Queryable): void {
  app.get<{ Params: { id: number }; Querystring: { warehouseId: number } }>(
    '/api/products/:id/availability',
    {
      schema: {
        params: idParams,
        querystring: {
          type: 'object',
          required: ['warehouseId'],
          properties: { warehouseId: id },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const productId = request.params.id;
      const { warehouseId } = request.query;
      const { rows } = await db.query(
        `SELECT quantity_on_hand, quantity_reserved, quantity_available
         FROM get_product_availability($1, $2)`,
        [productId, warehouseId],
      );
      const [row] = rows;
      return {
        productId,
        warehouseId,
        quantityOnHand: row.quantity_on_hand,
        quantityReserved: row.quantity_reserved,
        quantityAvailable: row.quantity_available,
      };
    },
  );
}
