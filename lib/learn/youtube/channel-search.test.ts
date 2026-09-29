import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { YouTubeChannel, YouTubeFailure } from '@/lib/learn/providers/youtube';

/**
 * Finding recommended channels for a subject (plan #1195): reading the
 * model's report, finding each channel on YouTube within the quota cap, and
 * storing only the ones not already followed or found. Fixtures throughout;
 * no key and no network.
 */

vi.mock('@/lib/learn/graph/load', () => ({
  loadGraph: vi.fn(async () => ({ concepts: [], edges: [], mentions: [] })),
}));

const followed: { name: string; youtube_channel_id: string; youtube_handle: string | null }[] = [];
vi.mock('./library', () => ({
  loadChannels: vi.fn(async () => followed),
}));

const {
  buildChannelPrompt,
  findChannelsForSubject,
  MAX_CHANNELS,
  pickHit,
  readRecommendations,
  resolveRecommendations,
} = await import('./channel-search');
const { parseSearchChannelsResponse, searchChannelsRequestUrl } = await import('@/lib/learn/providers/youtube');

const USER = '00000000-0000-4000-8000-000000000001';
const SUBJECT = '00000000-0000-4000-8000-0000000000aa';

function id(n: number): string {
  return `UC${String(n).padStart(22, '0')}`;
}

function channel(n: number, handle: string | null, title = `Channel ${n}`): { ok: true } & YouTubeChannel {
  return {
    ok: true,
    channelId: id(n),
    title,
    handle,
    uploadsPlaylistId: `UU${id(n).slice(2)}`,
    canonicalUrl: `https://www.youtube.com/channel/${id(n)}`,
  };
}

const notFound: YouTubeFailure = { ok: false, reason: 'not-found', detail: 'no channel by that name' };
const quota: YouTubeFailure = { ok: false, reason: 'quota', detail: 'the API answered 403' };

/** A lookup over a fixed directory of handles and search answers, counting calls. */
function directory(
  byHandle: Record<string, { ok: true } & YouTubeChannel>,
  bySearch: Record<string, { channelId: string; title: string }[]> = {},
  failWith: YouTubeFailure | null = null,
) {
  const calls = { byRef: 0, search: 0 };
  const byId = new Map(Object.values(byHandle).map((c) => [c.channelId, c]));
  return {
    calls,
    lookup: {
      async byRef(ref: { handle: string } | { channelId: string }) {
        calls.byRef += 1;
        if (failWith) return failWith;
        if ('handle' in ref) return byHandle[ref.handle.toLowerCase()] ?? notFound;
        return byId.get(ref.channelId) ?? notFound;
      },
      async search(name: string) {
        calls.search += 1;
        if (failWith) return failWith;
        return { ok: true as const, channels: bySearch[name] ?? [] };
      },
    },
  };
}

describe('readRecommendations', () => {
  it('reads handles in the forms a recommendation gives them', () => {
    const recs = readRecommendations({
      channels: [
        { name: '3Blue1Brown', handle: '@3blue1brown', why: 'Recommended on r/math for intuition.' },
        { name: 'MIT OpenCourseWare', handle: 'https://www.youtube.com/@mitocw', why: 'Full lectures.' },
        { name: 'Khan Academy', handle: 'khanacademy', why: 'Starts from the ground.' },
        { name: 'Some Teacher', handle: 'not a handle at all', why: 'Named in a thread.' },
        { name: 'No Handle', handle: null, why: '' },
      ],
    });
    expect(recs?.map((r) => r.ref)).toEqual([
      { handle: '@3blue1brown' },
      { handle: '@mitocw' },
      { handle: '@khanacademy' },
      null,
      null,
    ]);
    expect(recs?.[4].why).toBe('Recommended for this subject.');
  });

  it('drops repeats and keeps at most five', () => {
    const recs = readRecommendations({
      channels: [
        { name: 'A', handle: '@a', why: 'x' },
        { name: 'a', handle: null, why: 'same name' },
        { name: 'Other', handle: '@A', why: 'same handle' },
        ...[1, 2, 3, 4, 5, 6].map((n) => ({ name: `C${n}`, handle: null, why: 'y' })),
      ],
    });
    expect(recs).toHaveLength(MAX_CHANNELS);
    expect(recs?.map((r) => r.name)).toEqual(['A', 'C1', 'C2', 'C3', 'C4']);
  });

  it('is null for a report in the wrong shape', () => {
    expect(readRecommendations({ channels: 'none' })).toBeNull();
    expect(readRecommendations({})).toEqual([]);
  });
});

describe('buildChannelPrompt', () => {
  it('says when nothing is known of their level, and names channels to leave out', () => {
    const prompt = buildChannelPrompt({
      subject: 'Linear algebra',
      note: 'for machine learning',
      rooting: { settled: [], frontier: [], settledOmitted: 0 },
      known: ['MIT OpenCourseWare (@mitocw)'],
    });
    expect(prompt).toContain('Subject: Linear algebra');
    expect(prompt).toContain('for machine learning');
    expect(prompt).toContain('no record yet');
    expect(prompt).toContain('- MIT OpenCourseWare (@mitocw)');
  });

  it('lists what is settled and what is next when the graph holds it', () => {
    const prompt = buildChannelPrompt({
      subject: 'Linear algebra',
      note: null,
      rooting: { settled: ['A matrix is a linear map.'], frontier: ['Eigenvectors are fixed directions.'], settledOmitted: 0 },
      known: [],
    });
    expect(prompt).toContain('- A matrix is a linear map.');
    expect(prompt).toContain('- Eigenvectors are fixed directions.');
  });
});

describe('search.list for channels', () => {
  it('asks for channels only', () => {
    const url = new URL(searchChannelsRequestUrl('Professor Leonard', 'KEY'));
    expect(url.pathname).toBe('/youtube/v3/search');
    expect(url.searchParams.get('type')).toBe('channel');
    expect(url.searchParams.get('q')).toBe('Professor Leonard');
  });

  it('reads the channel ids out of an answer', () => {
    const body = JSON.stringify({
      items: [
        { id: { kind: 'youtube#channel', channelId: id(1) }, snippet: { channelTitle: 'Professor Leonard' } },
        { id: { kind: 'youtube#channel' }, snippet: { channelTitle: 'No id' } },
        { id: { kind: 'youtube#channel', channelId: 'bad' }, snippet: { channelTitle: 'Bad id' } },
      ],
    });
    expect(parseSearchChannelsResponse(body)).toEqual({ ok: true, channels: [{ channelId: id(1), title: 'Professor Leonard' }] });
    expect(parseSearchChannelsResponse('{"error":{"message":"quota"}}')).toMatchObject({ ok: false, reason: 'error' });
  });

  it('prefers the hit whose name matches', () => {
    const hits = [
      { channelId: id(1), title: 'Leonard Fans' },
      { channelId: id(2), title: 'Professor Leonard' },
    ];
    expect(pickHit('professor leonard', hits)?.channelId).toBe(id(2));
    expect(pickHit('Someone else', hits)?.channelId).toBe(id(1));
    expect(pickHit('x', [])).toBeNull();
  });
});

describe('resolveRecommendations', () => {
  it('finds a handle for one unit and falls back to search for one without', async () => {
    const { lookup, calls } = directory(
      { '@a': channel(1, '@a'), '@leonard': channel(2, '@leonard', 'Professor Leonard') },
      { 'Professor Leonard': [{ channelId: id(2), title: 'Professor Leonard' }] },
    );
    const result = await resolveRecommendations(
      [
        { name: 'A', ref: { handle: '@a' }, why: 'one' },
        { name: 'Professor Leonard', ref: null, why: 'two' },
      ],
      { lookup },
    );
    expect(result.resolved.map((c) => [c.channelId, c.handle, c.why])).toEqual([
      [id(1), '@a', 'one'],
      [id(2), '@leonard', 'two'],
    ]);
    expect(calls).toEqual({ byRef: 2, search: 1 });
    expect(result.quotaUnits).toBe(102);
    expect(result.failure).toBeNull();
  });

  it('searches by name when the handle given does not exist', async () => {
    const { lookup } = directory({ '@real': channel(3, '@real', 'Real') }, { Real: [{ channelId: id(3), title: 'Real' }] });
    const result = await resolveRecommendations([{ name: 'Real', ref: { handle: '@guessed' }, why: 'w' }], { lookup });
    expect(result.resolved.map((c) => c.channelId)).toEqual([id(3)]);
  });

  it('stops searching once the cap is spent, keeping the total near 400 units', async () => {
    const hits: Record<string, { channelId: string; title: string }[]> = {};
    const handles: Record<string, { ok: true } & YouTubeChannel> = {};
    for (let n = 1; n <= 5; n += 1) {
      hits[`C${n}`] = [{ channelId: id(n), title: `C${n}` }];
      handles[`@c${n}`] = channel(n, `@c${n}`, `C${n}`);
    }
    const { lookup, calls } = directory(handles, hits);
    const recs = [1, 2, 3, 4, 5].map((n) => ({ name: `C${n}`, ref: null, why: 'w' }));
    const result = await resolveRecommendations(recs, { lookup, maxSearches: 4 });
    expect(calls.search).toBe(4);
    expect(result.resolved).toHaveLength(4);
    expect(result.unresolved).toEqual(['C5']);
    expect(result.quotaUnits).toBe(404);
  });

  it('asks before spending quota whether a channel is already known', async () => {
    const { lookup, calls } = directory({ '@a': channel(1, '@a'), '@b': channel(2, '@b') });
    const result = await resolveRecommendations(
      [
        { name: 'A', ref: { handle: '@A' }, why: 'w' },
        { name: 'B', ref: { handle: '@b' }, why: 'w' },
      ],
      { lookup, skip: ({ handle, channelId }) => handle?.toLowerCase() === '@a' || channelId === id(2) },
    );
    expect(result.resolved).toEqual([]);
    expect(calls.byRef).toBe(1);
  });

  it('stops at a quota refusal and keeps what it found before it', async () => {
    let n = 0;
    const lookup = {
      async byRef() {
        n += 1;
        return n === 1 ? channel(1, '@a') : quota;
      },
      async search() {
        return quota;
      },
    };
    const result = await resolveRecommendations(
      [
        { name: 'A', ref: { handle: '@a' }, why: 'w' },
        { name: 'B', ref: { handle: '@b' }, why: 'w' },
        { name: 'C', ref: { handle: '@c' }, why: 'w' },
      ],
      { lookup },
    );
    expect(result.resolved.map((c) => c.channelId)).toEqual([id(1)]);
    expect(result.failure?.reason).toBe('quota');
    expect(n).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The whole search, over a fake client.
// ---------------------------------------------------------------------------

type Stored = { id: string; user_id: string; subject_id: string; youtube_channel_id: string; title: string; handle: string | null; found_why: string | null };

function fakeLearn(stored: Stored[], subject: { name: string; note: string | null } | null) {
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        async maybeSingle() {
          if (table !== 'subjects') throw new Error(`unexpected maybeSingle on ${table}`);
          return { data: subject && filters.user_id === USER ? { id: SUBJECT, ...subject } : null, error: null };
        },
        then(resolve: (value: { data: unknown; error: null }) => void) {
          const rows = stored.filter((row) => row.user_id === filters.user_id && row.subject_id === filters.subject_id);
          resolve({ data: rows, error: null });
        },
        upsert(rows: Omit<Stored, 'id'>[]) {
          const inserted: Stored[] = [];
          for (const row of rows) {
            if (stored.some((s) => s.subject_id === row.subject_id && s.youtube_channel_id === row.youtube_channel_id)) continue;
            const withId = { id: `row-${stored.length + 1}`, ...row };
            stored.push(withId);
            inserted.push(withId);
          }
          return { select: async () => ({ data: inserted, error: null }) };
        },
      };
      return builder;
    },
  };
  return client as unknown as LearnSupabaseClient;
}

function fakeModel(report: unknown) {
  const create = vi.fn(async () => ({
    usage: { input_tokens: 1000, output_tokens: 200 },
    content: [
      { type: 'server_tool_use', name: 'web_search' },
      { type: 'tool_use', name: 'report_channels', input: report },
    ],
  }));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

describe('findChannelsForSubject', () => {
  beforeEach(() => {
    followed.length = 0;
  });

  const five = {
    channels: [1, 2, 3, 4, 5].map((n) => ({ name: `C${n}`, handle: `@c${n}`, why: `Reason ${n}.` })),
  };
  const handles = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`@c${n}`, channel(n, `@c${n}`, `C${n}`)]));

  it('writes up to five channel rows, each with a channel id and a reason, and reports the spend', async () => {
    const stored: Stored[] = [];
    const { client } = fakeModel(five);
    const { lookup } = directory(handles);
    const spend: unknown[] = [];

    const result = await findChannelsForSubject({
      learn: fakeLearn(stored, { name: 'Linear algebra', note: null }),
      userId: USER,
      subjectId: SUBJECT,
      client,
      lookup,
      onSpend: (report) => spend.push(report),
    });

    expect(result.ok).toBe(true);
    expect(stored).toHaveLength(5);
    for (const row of stored) {
      expect(row.youtube_channel_id).toMatch(/^UC[A-Za-z0-9_-]{22}$/);
      expect(row.found_why).toMatch(/^Reason \d\.$/);
      expect(row).toMatchObject({ user_id: USER, subject_id: SUBJECT });
    }
    expect(spend).toHaveLength(1);
  });

  it('skips channels already followed and channels already found for the subject, passed ones included', async () => {
    followed.push({ name: 'C1', youtube_channel_id: id(1), youtube_handle: '@c1' });
    const stored: Stored[] = [
      { id: 'old', user_id: USER, subject_id: SUBJECT, youtube_channel_id: id(2), title: 'C2', handle: null, found_why: 'x' },
    ];
    const { client, create } = fakeModel(five);
    const { lookup } = directory(handles);

    const result = await findChannelsForSubject({
      learn: fakeLearn(stored, { name: 'Linear algebra', note: null }),
      userId: USER,
      subjectId: SUBJECT,
      client,
      lookup,
    });

    expect(result.ok && result.added.map((c) => c.youtubeChannelId)).toEqual([id(3), id(4), id(5)]);
    expect(stored).toHaveLength(4);
    // The model is told what to leave out, so it can spend its five on new ones.
    const prompt = (create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content;
    expect(prompt).toContain('C1 (@c1)');
    expect(prompt).toContain('C2');
  });

  it('names a quota refusal and keeps the channels written before it', async () => {
    const stored: Stored[] = [];
    const { client } = fakeModel(five);
    let n = 0;
    const lookup = {
      async byRef(ref: { handle: string } | { channelId: string }) {
        n += 1;
        return n <= 2 && 'handle' in ref ? (handles[ref.handle] ?? notFound) : quota;
      },
      async search() {
        return quota;
      },
    };

    const result = await findChannelsForSubject({
      learn: fakeLearn(stored, { name: 'Linear algebra', note: null }),
      userId: USER,
      subjectId: SUBJECT,
      client,
      lookup,
    });

    expect(result).toMatchObject({ ok: false, reason: 'quota' });
    expect(result.added).toHaveLength(2);
    expect(stored).toHaveLength(2);
  });

  it('names a missing YouTube key before paying for the web search', async () => {
    const saved = process.env.YOUTUBE_API_KEY;
    delete process.env.YOUTUBE_API_KEY;
    try {
      const { client, create } = fakeModel(five);
      const result = await findChannelsForSubject({
        learn: fakeLearn([], { name: 'Linear algebra', note: null }),
        userId: USER,
        subjectId: SUBJECT,
        client,
      });
      expect(result).toMatchObject({ ok: false, reason: 'no-youtube-key' });
      expect(create).not.toHaveBeenCalled();
    } finally {
      if (saved !== undefined) process.env.YOUTUBE_API_KEY = saved;
    }
  });

  it('names a missing Anthropic key', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { lookup } = directory(handles);
      const result = await findChannelsForSubject({
        learn: fakeLearn([], { name: 'Linear algebra', note: null }),
        userId: USER,
        subjectId: SUBJECT,
        lookup,
      });
      expect(result).toMatchObject({ ok: false, reason: 'no-anthropic-key' });
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it('names a failed search and a search that found nothing new', async () => {
    const { lookup } = directory(handles);
    const failing = {
      messages: {
        create: vi.fn(async () => {
          throw new Error('overloaded');
        }),
      },
    } as unknown as Anthropic;
    const failed = await findChannelsForSubject({
      learn: fakeLearn([], { name: 'Linear algebra', note: null }),
      userId: USER,
      subjectId: SUBJECT,
      client: failing,
      lookup,
    });
    expect(failed).toMatchObject({ ok: false, reason: 'search-failed', detail: 'overloaded' });

    const { client } = fakeModel({ channels: [] });
    const empty = await findChannelsForSubject({
      learn: fakeLearn([], { name: 'Linear algebra', note: null }),
      userId: USER,
      subjectId: SUBJECT,
      client,
      lookup,
    });
    expect(empty).toMatchObject({ ok: false, reason: 'nothing-new' });
  });
});
