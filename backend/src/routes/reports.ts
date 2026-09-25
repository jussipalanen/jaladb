import type { FastifyInstance } from 'fastify';
import type { Queryable } from '../db.ts';

interface BestSellingQuery {
  start: string;
  end: string;
  limit: number;
}

export function registerReportRoutes(app: FastifyInstance, db: Queryable): void {
  app.get<{ Querystring: BestSellingQuery }>(
    '/api/reports/best-selling',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['start', 'end'],
          properties: {
            start: { type: 'string', format: 'date' },
            end: { type: 'string', format: 'date' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const { start, end, limit } = request.query;
      const { rows } = await db.query(
        `SELECT product_id, sku, name, units_sold, revenue
         FROM get_best_selling_products($1, $2, $3)`,
        [start, end, limit],
      );
      return {
        start,
        end,
        limit,
        products: rows.map((row) => ({
          productId: row.product_id,
          sku: row.sku,
          name: row.name,
          unitsSold: row.units_sold,
          revenue: row.revenue,
        })),
      };
    },
  );
}
