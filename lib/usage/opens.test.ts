import { describe, expect, it } from 'vitest';
import { pageUsage, type PageOpens } from './opens';
import { PAGE_ROUTES } from './pages';

function opened(route: string, opens30: number, lastOpened: string): PageOpens {
  return { route, workspace: null, opens7: 0, opens30, lastOpened };
}

describe('pageUsage', () => {
  it('lists every page, the ones not opened in 30 days first and the most opened next', () => {
    const usage = pageUsage([
      opened('/learn', 3, '2026-10-01T00:00:00Z'),
      opened('/goals', 9, '2026-10-01T00:00:00Z'),
      opened('/news', 0, '2026-08-01T00:00:00Z'),
      opened('/gone/page', 4, '2026-10-01T00:00:00Z'),
    ]);
    expect(usage).toHaveLength(PAGE_ROUTES.length);
    expect(usage.some((row) => row.route === '/gone/page')).toBe(false);

    const idle = usage.filter((row) => row.opens30 === 0);
    expect(usage.slice(0, idle.length)).toEqual(idle);
    // Never opened before opened long ago.
    expect(idle.at(-1)?.route).toBe('/news');
    expect(usage.slice(idle.length).map((row) => row.route)).toEqual(['/goals', '/learn']);
    expect(usage.find((row) => row.route === '/learn/s/[id]')?.workspace).toBe('learn');
  });
});
