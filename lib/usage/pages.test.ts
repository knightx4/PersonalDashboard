import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_ROUTES } from './pages';
import { scanPageRoutes } from './scan';

describe('the list of pages the page-view record matches against', () => {
  it('is every page under app/', () => {
    // When this fails, a page was added, moved or removed: run `npm run pages:write`.
    expect([...PAGE_ROUTES]).toEqual(scanPageRoutes(join(process.cwd(), 'app')));
  });
});
