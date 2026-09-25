import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Queryable } from './db.ts';
import { errorHandler, notFoundHandler } from './errors.ts';
import { registerCustomerRoutes } from './routes/customers.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerInventoryRoutes } from './routes/inventory.ts';
import { registerOrderRoutes } from './routes/orders.ts';
import { registerProductRoutes } from './routes/products.ts';
import { registerReportRoutes } from './routes/reports.ts';

export interface AppOptions {
  /** Pool (or client) used for every query. */
  db: Queryable;
  logger?: FastifyServerOptions['logger'];
}

export function buildApp({ db, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({
    logger,
    ajv: {
      customOptions: {
        // Reject unknown properties (additionalProperties: false) with a 400
        // instead of silently dropping them.
        removeAdditional: false,
      },
    },
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  registerHealthRoutes(app, db);
  registerCustomerRoutes(app, db);
  registerProductRoutes(app, db);
  registerInventoryRoutes(app, db);
  registerOrderRoutes(app, db);
  registerReportRoutes(app, db);

  return app;
}
