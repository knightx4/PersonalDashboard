import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pageUsage, readPathOpens30, type PageOpens } from './opens';
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

describe('readPathOpens30', () => {
  /** A client whose page_opens answers with `row`, recording what it was asked for. */
  function client(row: { opens_30: number } | null) {
    const asked: Record<string, string> = {};
    const query = {
      select: () => query,
      eq: (column: string, value: string) => {
        asked[column] = value;
        return query;
      },
      maybeSingle: async () => ({ data: row, error: null }),
    };
    const fake = { schema: () => ({ from: () => query }) } as unknown as SupabaseClient;
    return { fake, asked };
  }

  it('counts the opens of the route pattern the path opens', async () => {
    const { fake, asked } = client({ opens_30: 14 });
    expect(await readPathOpens30(fake, 'u1', '/learn/s/6f1c1f5e-0000-4000-8000-0000000000d0?tab=x')).toBe(14);
    expect(asked).toEqual({ user_id: 'u1', route: '/learn/s/[id]' });
  });

  it('is 0 for a page never opened and null for a path that is no page', async () => {
    expect(await readPathOpens30(client(null).fake, 'u1', '/learn')).toBe(0);
    expect(await readPathOpens30(client(null).fake, 'u1', '/api/nothing')).toBeNull();
  });
});
