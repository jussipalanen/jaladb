import type { FastifyInstance } from 'fastify';
import type { Queryable } from '../db.ts';

export function registerHealthRoutes(app: FastifyInstance, db: Queryable): void {
  app.get('/api/health', async (request, reply) => {
    try {
      await db.query('SELECT 1');
      return { status: 'ok', database: 'ok' };
    } catch (error) {
      request.log.error(error);
      return reply.status(503).send({ status: 'unavailable', database: 'unreachable' });
    }
  });
}
