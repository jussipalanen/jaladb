import { fileURLToPath } from 'node:url';

export interface Config {
  databaseUrl: string;
  /** 127.0.0.1 for local runs; 0.0.0.0 inside a container. */
  host: string;
  port: number;
  logLevel: string;
}

/**
 * Reads configuration from the environment. The repository root's .env is
 * loaded when present, so the API uses the same settings as the database
 * tooling; real environment variables take precedence.
 */
export function loadConfig(): Config {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env in the repository root.');
  }
  return {
    databaseUrl,
    host: process.env.API_HOST ?? '127.0.0.1',
    port: Number(process.env.API_PORT ?? 3000),
    logLevel: process.env.LOG_LEVEL ?? 'info',
  };
}
