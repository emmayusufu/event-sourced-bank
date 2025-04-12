import 'dotenv/config';

async function main() {
  console.log('event-sourced-bank: boot');

  const shutdown = async (signal: string) => {
    console.log(`received ${signal}, exiting`);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
