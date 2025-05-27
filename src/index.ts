import 'dotenv/config';
import { getPool } from './infra/db.js';
import { runMigrations } from './infra/migrate.js';
import { buildApp } from './http/server.js';
import { startProjector, stopProjector } from './projector/loop.js';

async function main() {
  console.log('event-sourced-bank: boot');
  await runMigrations();
  startProjector();

  const port = Number(process.env.PORT ?? 3000);
  const app = buildApp();
  const server = app.listen(port, () => console.log(`listening on :${port}`));

  const shutdown = async (signal: string) => {
    console.log(`received ${signal}, exiting`);
    server.close();
    await stopProjector();
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
