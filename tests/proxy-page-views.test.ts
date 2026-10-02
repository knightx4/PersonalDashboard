/**
 * proxy.ts records each page opened (plan #1481).
 *
 * Done when opening a page and navigating to another records two rows with
 * route patterns, a prefetch records none, and the page response does not
 * wait on the write.
 */
import { NextRequest, type NextFetchEvent } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const inserts: Record<string, unknown>[] = [];
let releaseWrite: () => void = () => {};

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    schema: (schema: string) => ({
      from: (table: string) => ({
        insert: (row: Record<string, unknown>) => {
          inserts.push({ schema, table, ...row });
          // The write does not finish until the test lets it.
          return new Promise((resolve) => {
            releaseWrite = () => resolve({ error: null });
          });
        },
      }),
    }),
  }),
}));

vi.mock('@/lib/auth/session-user', () => ({
  sessionUser: async () => ({ id: 'user-1' }),
}));

const { default: proxy } = await import('@/proxy');

function event() {
  const waited: Promise<unknown>[] = [];
  return { waited, event: { waitUntil: (p: Promise<unknown>) => waited.push(p) } as unknown as NextFetchEvent };
}

function get(path: string, headers: Record<string, string>) {
  return new NextRequest(new URL(path, 'https://dash.test'), { headers });
}

beforeEach(() => {
  inserts.length = 0;
});

describe('the page-view record in proxy.ts', () => {
  it('records opening a page and navigating to another, without the response waiting', async () => {
    const first = event();
    const loaded = await proxy(get('/learn/s/6f1c1f5e', { 'sec-fetch-dest': 'document', accept: 'text/html' }), first.event);
    const second = event();
    const moved = await proxy(get('/goals/abc', { rsc: '1' }), second.event);

    // Both responses came back while their writes were still open.
    expect(loaded.status).toBe(200);
    expect(moved.status).toBe(200);
    expect(first.waited).toHaveLength(1);
    expect(second.waited).toHaveLength(1);

    expect(inserts).toEqual([
      { schema: 'core', table: 'page_views', user_id: 'user-1', route: '/learn/s/[id]', workspace: 'learn', via: 'load' },
      { schema: 'core', table: 'page_views', user_id: 'user-1', route: '/goals/[goalId]', workspace: 'goals', via: 'navigation' },
    ]);
    releaseWrite();
  });

  it('records nothing for a prefetch or an /api call', async () => {
    const prefetch = event();
    await proxy(get('/learn', { rsc: '1', 'next-router-prefetch': '1' }), prefetch.event);
    const api = event();
    await proxy(get('/api/ask', { accept: 'text/html' }), api.event);
    expect(prefetch.waited).toHaveLength(0);
    expect(api.waited).toHaveLength(0);
    expect(inserts).toEqual([]);
  });
});
