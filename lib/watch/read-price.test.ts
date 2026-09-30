import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Every public name resolves to a public address; the guard is what is tested.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

const { readLowestPrice } = await import('@/lib/watch/read-price');

const page = readFileSync(
  join(process.cwd(), 'fixtures/watch/crowdvolt-jamie-xx-2026-09-30.html'),
  'utf8',
);
const URL_ = 'https://www.crowdvolt.com/event/jamie-xx-nowadays-new-york-thursday-oct-1';

function html(body: string, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('readLowestPrice', () => {
  it('reads the saved CrowdVolt page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => html(page)));
    const reading = await readLowestPrice(URL_, { below: 200 });
    expect(reading).toMatchObject({ ok: true, value: 186, detail: { count: 8 } });
  });

  it('turns a failed load into an error reading', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => html('blocked', 403)));
    expect(await readLowestPrice(URL_)).toEqual({
      ok: false,
      error: 'The page answered 403 instead of loading.',
    });
  });

  it('refuses a redirect onto a private host', async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: 'http://localhost/admin' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const reading = await readLowestPrice(URL_);
    expect(reading.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never throws on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await readLowestPrice(URL_)).toEqual({
      ok: false,
      error: 'The page could not be reached.',
    });
  });
});
