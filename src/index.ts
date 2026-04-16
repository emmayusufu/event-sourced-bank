import 'dotenv/config';
import { getPool } from './infra/db.js';
import { runMigrations } from './infra/migrate.js';
import { buildApp } from './http/server.js';
import { startProjector, stopProjector } from './projector/loop.js';
import { startPuller } from './replication/puller.js';

async function main() {
  const role = process.env.ROLE === 'follower' ? 'follower' : 'primary';
  console.log(`event-sourced-bank: boot (role=${role})`);
  await runMigrations();
  startProjector();

  let stopFollowerPuller: (() => Promise<void>) | null = null;
  if (role === 'follower') {
    const primaryUrl = process.env.PRIMARY_URL;
    if (!primaryUrl) {
      throw new Error('ROLE=follower requires PRIMARY_URL');
    }
    const pollMs = Number(process.env.REPLICATION_POLL_MS ?? 500);
    const handle = startPuller({ primaryUrl, pollMs });
    stopFollowerPuller = handle.stop;
    console.log(`puller: polling ${primaryUrl} every ${pollMs}ms`);
  }

  const port = Number(process.env.PORT ?? 3000);
  const app = buildApp();
  const server = app.listen(port, () => console.log(`listening on :${port}`));

  const shutdown = async (signal: string) => {
    console.log(`received ${signal}, exiting`);
    server.close();
    if (stopFollowerPuller) await stopFollowerPuller();
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
