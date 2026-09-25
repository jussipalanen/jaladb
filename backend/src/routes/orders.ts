import type { FastifyInstance } from 'fastify';
import type { Queryable } from '../db.ts';
import { id, quantity } from './schemas.ts';

interface CreateOrderBody {
  customerId: number;
  warehouseId: number;
  items: { productId: number; quantity: number }[];
}

export function registerOrderRoutes(app: FastifyInstance, db: Queryable): void {
  app.post<{ Body: CreateOrderBody }>(
    '/api/orders',
    {
      schema: {
        body: {
          type: 'object',
          required: ['customerId', 'warehouseId', 'items'],
          properties: {
            customerId: id,
            warehouseId: id,
            items: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              items: {
                type: 'object',
                required: ['productId', 'quantity'],
                properties: { productId: id, quantity },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { customerId, warehouseId, items } = request.body;
      // create_order() takes the lines as JSONB in its own snake_case format;
      // everything else (duplicates, stock, prices, totals) is checked there.
      const lines = items.map((item) => ({ product_id: item.productId, quantity: item.quantity }));
      const { rows } = await db.query('SELECT create_order($1, $2, $3) AS order_id', [
        customerId,
        warehouseId,
        JSON.stringify(lines),
      ]);
      return reply.status(201).send({ orderId: rows[0].order_id });
    },
  );
}
