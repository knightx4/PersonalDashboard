import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCalendar } from '@/lib/todo/feeds/fetch';

/**
 * The refusals, without a network.
 *
 * Every case here is a real answer somebody's calendar host gives: a sign-in
 * page where a calendar was expected, an address that was reset, a scheme
 * copied out of a phone. The address itself is a credential, so the one thing
 * these must never do is reach anything the person did not name -- which is
 * what the literal-address cases below are for.
 */

const CALENDAR = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR';

function answer(body: string, init: { status?: number; type?: string } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'content-type': init.type ?? 'text/calendar' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCalendar', () => {
  it('reads a calendar file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(CALENDAR)));

    const result = await fetchCalendar('https://93.184.216.34/basic.ics');
    expect(result).toEqual({ ok: true, text: CALENDAR });
  });

  it('takes the webcal address a calendar app hands you', async () => {
    let asked = '';
    const fetcher = vi.fn(async (url: URL) => {
      asked = String(url);
      return answer(CALENDAR);
    });
    vi.stubGlobal('fetch', fetcher);

    await fetchCalendar('webcal://93.184.216.34/basic.ics');

    expect(asked).toBe('https://93.184.216.34/basic.ics');
  });

  it('refuses anything but https', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    const result = await fetchCalendar('http://93.184.216.34/basic.ics');

    expect(result).toEqual({ ok: false, detail: 'refusing http, https only' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses an address pointing inside the network it runs in', async () => {
    // 169.254.169.254 is the cloud metadata service. Nothing is fetched at
    // all: the check runs before the connection, not on the answer.
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    const result = await fetchCalendar('https://169.254.169.254/latest/meta-data/');

    expect(result.ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses localhost, whatever is listening there', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect((await fetchCalendar('https://127.0.0.1:54321/x.ics')).ok).toBe(false);
  });

  it('checks the address again after a redirect', async () => {
    // A public URL that redirects somewhere private is the standard way past a
    // check that only looks at what was typed.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(null, { status: 302, headers: { location: 'https://10.0.0.5/x.ics' } }),
      ),
    );

    const result = await fetchCalendar('https://93.184.216.34/basic.ics');
    expect(result).toEqual({ ok: false, detail: 'refusing a private address: 10.0.0.5' });
  });

  it('says an address was refused rather than calling it broken', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer('no', { status: 403 })));

    const result = await fetchCalendar('https://93.184.216.34/basic.ics');
    expect(result).toEqual({
      ok: false,
      detail: 'that address was refused -- it may have been reset',
    });
  });

  it('does not read a sign-in page as a calendar with nothing in it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer('<html>Sign in</html>', { type: 'text/html' })));

    const result = await fetchCalendar('https://93.184.216.34/basic.ics');
    expect(result).toEqual({
      ok: false,
      detail: 'that address answered with text/html, not a calendar',
    });
  });

  it('refuses a body that is not a calendar file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer('nothing to see', { type: 'text/plain' })));

    const result = await fetchCalendar('https://93.184.216.34/basic.ics');
    expect(result).toEqual({ ok: false, detail: 'that address is not a calendar file' });
  });

  it('takes a calendar served as plain text, which some hosts do', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(CALENDAR, { type: 'text/plain' })));

    expect((await fetchCalendar('https://93.184.216.34/basic.ics')).ok).toBe(true);
  });

  it('says so when the address is not a web address at all', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect(await fetchCalendar('my calendar')).toEqual({ ok: false, detail: 'not a web address' });
  });
});
