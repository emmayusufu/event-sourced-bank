import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '../../src/infra/migrate.js';

let container: StartedPostgreSqlContainer | undefined;

export async function setup() {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('bank_test')
    .withUsername('bank')
    .withPassword('bank')
    .start();
  process.env.DATABASE_URL = container.getConnectionUri();
  await runMigrations();
}

export async function teardown() {
  await container?.stop();
}
