import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// .tsx too, so a component can be rendered rather than described.
const include = ['tests/**/*.test.{ts,tsx}', 'lib/**/*.test.{ts,tsx}'];

// The database tests share one schema, so they must not run concurrently with
// each other. They are a few dozen of over a thousand files; holding the rest to one file at
// a time as well made the suite take eight minutes, most of it spent importing
// modules in series. A file is a database test when it imports one of the
// tests/helpers/db* helpers or reads TEST_DATABASE_URL itself, found here by
// reading the files so that a new database test needs no list kept by hand.
const DB_TEST = /helpers\/db(-[a-z]+)?['"]|TEST_DATABASE_URL/;
const root = import.meta.dirname;
const dbTests = include
  .flatMap((pattern) => globSync(pattern, { cwd: root, exclude: ['**/node_modules/**'] }))
  .filter((file) => DB_TEST.test(readFileSync(join(root, file), 'utf8')));

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
    // Clears EMBEDDING_API_KEY, so saving an idea in a test embeds nothing.
    setupFiles: ['./tests/stubs/no-embedding-key.ts'],
    testTimeout: 20_000,
    // Projects inherit resolve and the options above. `vitest run --project
    // db` or `--project unit` runs one side alone.
    projects: [
      {
        extends: true,
        test: {
          name: 'db',
          include: dbTests,
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'unit',
          include,
          exclude: [...dbTests, '**/node_modules/**'],
        },
      },
    ],
  },
});
