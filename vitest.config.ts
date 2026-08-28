import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `server-only` throws on import outside a server component, which is
      // exactly its job in the app and a wall in a unit test. Stubbing it lets
      // a server module's pure functions be tested without loosening the
      // boundary the real import enforces at build time.
      'server-only': new URL('./tests/stubs/server-only.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'lib/**/*.test.ts'],
    // The database tests share one schema, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
