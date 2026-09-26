import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db.ts';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const app = buildApp({ db: pool, logger: { level: config.logLevel } });

// Loopback by default; the Docker image sets API_HOST=0.0.0.0 so the port can
// be published (Compose still binds it to 127.0.0.1 on the host).
await app.listen({ host: config.host, port: config.port });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
