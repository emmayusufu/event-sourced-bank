import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 90_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
