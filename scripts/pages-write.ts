/**
 * Write the list of the app's pages for the page-view record to match against:
 *
 *   npm run pages:write
 *
 * proxy.ts turns each path it records into its route pattern by matching it
 * against lib/usage/pages.ts, and cannot read app/ itself. After a page is
 * added, moved or removed this writes the list again; lib/usage/pages.test.ts
 * fails until it has been run.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanPageRoutes } from '@/lib/usage/scan';

const PAGES_FILE = join(process.cwd(), 'lib/usage/pages.ts');

const routes = scanPageRoutes(join(process.cwd(), 'app'));
const body = [
  '// Written by `npm run pages:write` from the pages under app/. Do not edit by hand.',
  '',
  '/** Every page in the app, as its route pattern. */',
  'export const PAGE_ROUTES: readonly string[] = [',
  ...routes.map((route) => `  '${route}',`),
  '];',
  '',
].join('\n');

writeFileSync(PAGES_FILE, body);
console.log(`wrote ${PAGES_FILE} (${routes.length} pages)`);
