import type { Client } from 'pg';
import { connect, getDatabaseUrl, loadEnv } from './db.ts';
import { migrate, migrationStatus } from './migrations.ts';
import { LARGE_SEEDS_DIR, SEEDS_DIR, seed } from './seed.ts';

const commands: Record<string, (client: Client) => Promise<void>> = {
  async migrate(client) {
    const applied = await migrate(client);
    if (applied.length === 0) {
      console.log('Database is up to date.');
    }
    for (const file of applied) console.log(`Applied ${file}`);
  },

  async status(client) {
    const { applied, pending } = await migrationStatus(client);
    for (const file of applied) console.log(`[applied] ${file}`);
    for (const file of pending) console.log(`[pending] ${file}`);
  },

  async seed(client) {
    for (const file of await seed(client)) console.log(`Loaded ${file}`);
  },

  async 'seed-large'(client) {
    const started = performance.now();
    for (const file of await seed(client, [SEEDS_DIR, LARGE_SEEDS_DIR])) console.log(`Loaded ${file}`);
    console.log(`Done in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  },
};

async function main(): Promise<void> {
  const name = process.argv[2] ?? '';
  const command = commands[name];
  if (!command) {
    console.error(`Usage: tsx database/scripts/cli.ts <${Object.keys(commands).join('|')}>`);
    process.exit(1);
  }

  loadEnv();
  const client = await connect(getDatabaseUrl());
  try {
    await command(client);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
