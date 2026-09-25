import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db.ts';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const app = buildApp({ db: pool, logger: { level: config.logLevel } });

// Local development only: listen on the loopback interface.
await app.listen({ host: '127.0.0.1', port: config.port });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
