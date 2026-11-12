import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptToken } from '@/lib/crypto/tokens';
import type { TodoSupabaseClient } from '@/lib/todo/db/schema-name';
import { fakeSchemaDb, type FakeTables } from '@/tests/stubs/fake-schema-db';

const fetchCalendar = vi.fn();
vi.mock('@/lib/todo/feeds/fetch', () => ({ fetchCalendar: (...args: unknown[]) => fetchCalendar(...args) }));
vi.mock('@/lib/todo/auth/server', () => ({
  createTodoClient: async () => {
    throw new Error('the session client is not used when one is passed');
  },
}));

const { syncStaleFeeds, resetFeedAttempts, SCHEDULE_TIMEOUT_MS } = await import('./refresh');

const KEY = randomBytes(32).toString('base64');
const NOW = new Date('2026-11-06T23:00:00.000Z');
const ME = 'me';

function ics(...titles: string[]): string {
  const events = titles.map(
    (title, index) =>
      `BEGIN:VEVENT\r\nUID:e${index}@partiful\r\nSUMMARY:${title}\r\nDTSTART:20261107T020000Z\r\nDTEND:20261107T050000Z\r\nEND:VEVENT\r\n`,
  );
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join('')}END:VCALENDAR\r\n`;
}

function feed(id: string, name: string, lastReadAt: string | null) {
  return {
    id,
    user_id: ME,
    name,
    address: encryptToken(`https://partiful.example/${id}.ics`, KEY),
    shown: true,
    last_read_at: lastReadAt,
    last_error: null,
    refreshing_since: null,
  };
}

let tables: FakeTables;
let client: TodoSupabaseClient;

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  resetFeedAttempts();
  fetchCalendar.mockReset();
  tables = {
    'todo.calendar_feeds': [],
    'todo.feed_events': [],
  };
  client = fakeSchemaDb(tables)('todo') as unknown as TodoSupabaseClient;
});

afterEach(() => vi.useRealTimers());

describe('syncStaleFeeds (plan #3045)', () => {
  it('re-reads a feed last read over an hour ago, so a new invite is in the stored rows', async () => {
    tables['todo.calendar_feeds'].push(feed('f1', 'Partiful', '2026-11-06T20:00:00.000Z'));
    tables['todo.feed_events'].push({ id: 'old', user_id: ME, feed_id: 'f1', title: 'Diwali Bash' });
    fetchCalendar.mockResolvedValue({ ok: true, text: ics('Diwali Bash', '71 Wilson Liftoff') });

    const stale = await syncStaleFeeds(ME, { client, now: NOW, timezone: 'America/New_York' });

    expect(stale).toEqual([]);
    expect(fetchCalendar).toHaveBeenCalledWith('https://partiful.example/f1.ics', SCHEDULE_TIMEOUT_MS);
    expect(tables['todo.feed_events'].map((row) => row.title).sort()).toEqual(['71 Wilson Liftoff', 'Diwali Bash']);
    expect(tables['todo.calendar_feeds'][0]).toMatchObject({ last_error: null, refreshing_since: null });
    expect(tables['todo.calendar_feeds'][0].last_read_at).not.toBe('2026-11-06T20:00:00.000Z');
  });

  it('leaves a feed read under an hour ago alone', async () => {
    tables['todo.calendar_feeds'].push(feed('f1', 'Partiful', '2026-11-06T22:30:00.000Z'));

    expect(await syncStaleFeeds(ME, { client, now: NOW })).toEqual([]);
    expect(fetchCalendar).not.toHaveBeenCalled();
  });

  it('keeps the stored rows of a feed that fails and names it as possibly out of date', async () => {
    tables['todo.calendar_feeds'].push(feed('f1', 'Partiful', null), feed('f2', 'Work', '2026-11-06T10:00:00.000Z'));
    tables['todo.feed_events'].push({ id: 'old', user_id: ME, feed_id: 'f1', title: 'Diwali Bash' });
    fetchCalendar.mockImplementation(async (address: string) =>
      address.includes('f1') ? { ok: false, detail: 'timed out after 4s' } : { ok: true, text: ics('Standup') },
    );

    const stale = await syncStaleFeeds(ME, { client, now: NOW });

    expect(stale).toEqual(['Partiful']);
    expect(tables['todo.feed_events'].filter((row) => row.feed_id === 'f1').map((row) => row.title)).toEqual(['Diwali Bash']);
    expect(tables['todo.calendar_feeds'][0]).toMatchObject({ last_error: 'timed out after 4s', last_read_at: null });
  });

  it('does not wait on a read that hangs past its time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    tables['todo.calendar_feeds'].push(feed('f1', 'Partiful', null));
    fetchCalendar.mockReturnValue(new Promise(() => {}));

    const answer = syncStaleFeeds(ME, { client, now: NOW });
    await vi.advanceTimersByTimeAsync(SCHEDULE_TIMEOUT_MS + 5_000);

    expect(await answer).toEqual(['Partiful']);
  });

  it('reads a feed once when two lookups ask together, and reuses a failed read just after', async () => {
    tables['todo.calendar_feeds'].push(feed('f1', 'Partiful', null));
    fetchCalendar.mockResolvedValue({ ok: false, detail: 'host said 503' });

    const [first, second] = await Promise.all([
      syncStaleFeeds(ME, { client, now: NOW }),
      syncStaleFeeds(ME, { client, now: NOW }),
    ]);
    const third = await syncStaleFeeds(ME, { client, now: NOW });

    expect(fetchCalendar).toHaveBeenCalledTimes(1);
    expect([first, second, third]).toEqual([['Partiful'], ['Partiful'], ['Partiful']]);
  });

  it('skips a feed another reader has claimed and says it may be out of date', async () => {
    tables['todo.calendar_feeds'].push({ ...feed('f1', 'Partiful', null), refreshing_since: '2026-11-06T22:59:00.000Z' });

    expect(await syncStaleFeeds(ME, { client, now: NOW })).toEqual(['Partiful']);
    expect(fetchCalendar).not.toHaveBeenCalled();
  });

  it('never reads another account\'s feeds', async () => {
    tables['todo.calendar_feeds'].push({ ...feed('f9', 'Theirs', null), user_id: 'someone-else' });

    expect(await syncStaleFeeds(ME, { client, now: NOW })).toEqual([]);
    expect(fetchCalendar).not.toHaveBeenCalled();
  });
});
