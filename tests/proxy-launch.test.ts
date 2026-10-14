/**
 * Opening the app from its icon is one redirect (plan #1920, R11).
 *
 * Done when a signed-in visit to / with pt_onboarded goes straight to /home
 * and records no page view for the hop, a visit without it goes to
 * /onboarding as before, and the launch route sets the cookie and goes Home.
 */
import { NextRequest, type NextFetchEvent } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const inserts: Record<string, unknown>[] = [];

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    schema: () => ({
      from: () => ({
        insert: async (row: Record<string, unknown>) => {
          inserts.push(row);
          return { error: null };
        },
      }),
    }),
  }),
}));

vi.mock('@/lib/auth/session-user', () => ({
  sessionUser: async () => ({ id: 'user-1' }),
}));

const { default: proxy } = await import('@/proxy');
const { GET: launch } = await import('@/app/api/onboarding/launch/route');

function open(path: string, cookie?: string) {
  return new NextRequest(new URL(path, 'https://dash.test'), {
    headers: { 'sec-fetch-dest': 'document', accept: 'text/html', ...(cookie ? { cookie } : {}) },
  });
}

function event() {
  const waited: Promise<unknown>[] = [];
  return { waited, event: { waitUntil: (p: Promise<unknown>) => waited.push(p) } as unknown as NextFetchEvent };
}

beforeEach(() => {
  inserts.length = 0;
});

describe('opening / while signed in', () => {
  it('goes to Home in one redirect with the cookie, recording nothing for the hop', async () => {
    const e = event();
    const res = await proxy(open('/', 'pt_onboarded=1'), e.event);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/home');
    expect(e.waited).toHaveLength(0);

    // The request the redirect leads to is the one page view of the launch.
    const home = event();
    await proxy(open('/home', 'pt_onboarded=1'), home.event);
    await Promise.all(home.waited);
    expect(inserts).toHaveLength(1);
  });

  it('goes to /onboarding without the cookie, as before', async () => {
    const e = event();
    const res = await proxy(open('/'), e.event);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/onboarding');
    expect(e.waited).toHaveLength(0);
  });

  it('sets the cookie on the way through the launch route', () => {
    const res = launch(new NextRequest(new URL('/api/onboarding/launch', 'https://dash.test')));
    expect(new URL(res.headers.get('location')!).pathname).toBe('/home');
    expect(res.cookies.get('pt_onboarded')?.value).toBe('1');
  });
});
