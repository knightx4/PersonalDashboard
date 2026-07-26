import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'lib/**/*.test.ts'],
    // The database tests share one schema, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
