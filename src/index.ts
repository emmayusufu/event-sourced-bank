import 'dotenv/config';
import { getPool } from './infra/db.js';
import { runMigrations } from './infra/migrate.js';

async function main() {
  console.log('event-sourced-bank: boot');
  await runMigrations();

  const shutdown = async (signal: string) => {
    console.log(`received ${signal}, exiting`);
    await getPool().end();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
