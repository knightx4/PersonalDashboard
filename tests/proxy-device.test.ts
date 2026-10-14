/**
 * proxy.ts records the device each page was opened on (plan #1919.6,
 * docs/ONE-INTERFACE-SPEC.md R17).
 *
 * Done when a page view from an iPhone, an iPad or an Android phone is
 * written with device 'phone', and one from a desktop browser, or from a
 * request with no user agent, with device 'laptop'.
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

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function deviceFor(userAgent: string | null): Promise<unknown> {
  const headers: Record<string, string> = { 'sec-fetch-dest': 'document', accept: 'text/html' };
  if (userAgent !== null) headers['user-agent'] = userAgent;
  const waited: Promise<unknown>[] = [];
  const event = { waitUntil: (p: Promise<unknown>) => waited.push(p) } as unknown as NextFetchEvent;
  await proxy(new NextRequest(new URL('/learn', 'https://dash.test'), { headers }), event);
  await Promise.all(waited);
  expect(inserts).toHaveLength(1);
  return inserts[0].device;
}

beforeEach(() => {
  inserts.length = 0;
});

describe('the device on a page view', () => {
  it.each([
    ['an iPhone', IPHONE, 'phone'],
    ['an iPad', IPAD, 'phone'],
    ['an Android phone', ANDROID, 'phone'],
    ['a Mac', MAC, 'laptop'],
    ['a Windows PC', WINDOWS, 'laptop'],
    ['a request with no user agent', null, 'laptop'],
  ])('records %s as %s', async (_name, userAgent, device) => {
    expect(await deviceFor(userAgent)).toBe(device);
  });
});
