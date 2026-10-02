import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { craftIdeaBody, craftModule, craftTakeaway, type CraftSource } from './craft';

const USER = 'u1';
const TAKEAWAY = 't1';

type Row = Record<string, unknown>;

/**
 * Just enough of a Supabase client for the craft: select, insert, update and
 * delete over in-memory tables, filtered by eq, is and in. An update returns
 * the rows it changed, so the conditional mark reads as the database's would.
 */
function memoryClient(tables: Record<string, Row[]>) {
  let nextId = 1;
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row = {};
    const filters: Array<(row: Row) => boolean> = [];
    const run = () => {
      if (op === 'insert') {
        const row = { id: `idea-${nextId++}`, plan_item_id: null, ...payload };
        rows.push(row);
        return { data: [row], error: null };
      }
      const hit = rows.filter((row) => filters.every((keep) => keep(row)));
      if (op === 'update') for (const row of hit) Object.assign(row, payload);
      if (op === 'delete') for (const row of hit) rows.splice(rows.indexOf(row), 1);
      return { data: hit, error: null };
    };
    const builder = {
      select: () => builder,
      insert: (values: Row) => ((op = 'insert'), (payload = values), builder),
      update: (values: Row) => ((op = 'update'), (payload = values), builder),
      delete: () => ((op = 'delete'), builder),
      eq: (key: string, value: unknown) => (filters.push((row) => row[key] === value), builder),
      is: (key: string, value: unknown) => (filters.push((row) => (row[key] ?? null) === value), builder),
      in: (key: string, values: unknown[]) => (filters.push((row) => values.includes(row[key])), builder),
      order: () => builder,
      single: async () => ({ data: run().data[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => resolve(run()),
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

function world(overrides: { status?: string; module?: string | null; ideas?: Row[] } = {}) {
  return {
    inspiration_takeaways: [
      {
        id: TAKEAWAY,
        user_id: USER,
        title: 'Show the diff before a session commits',
        body: 'Let the person read what a session changed before it lands on main, with a one-line summary per file.',
        module: overrides.module === undefined ? null : overrides.module,
        status: overrides.status ?? 'open',
        idea_id: null,
      },
    ],
    inspiration_takeaway_videos: [
      { user_id: USER, takeaway_id: TAKEAWAY, video_id: 'v2', quote: 'Review every diff.', start_seconds: 754 },
      { user_id: USER, takeaway_id: TAKEAWAY, video_id: 'v1', quote: null, start_seconds: null },
    ],
    inspiration_videos: [
      { id: 'v1', user_id: USER, video_id: 'aaaaaaaaaaa', title: 'Agents in practice', channel_title: 'Chan', playlist_position: 0 },
      { id: 'v2', user_id: USER, video_id: 'bbbbbbbbbbb', title: 'Shipping with AI', channel_title: null, playlist_position: 1 },
    ],
    ideas: overrides.ideas ?? [],
  } as Record<string, Row[]>;
}

describe('craftIdeaBody', () => {
  const sources: CraftSource[] = [
    { videoId: 'aaaaaaaaaaa', title: 'Agents in practice', channel: 'Chan', quote: 'Say it once.', startSeconds: 75 },
    { videoId: 'bbbbbbbbbbb', title: 'Shipping with AI', channel: null, quote: null, startSeconds: null },
  ];

  it('puts the title first, the body under it, then every video with its moment', () => {
    expect(craftIdeaBody({ title: 'A title', body: 'The body.' }, sources)).toBe(
      'A title\n\nThe body.\n\nFrom the Dash inspiration playlist:\n' +
        '- Agents in practice (Chan), at 1:15: https://www.youtube.com/watch?v=aaaaaaaaaaa&t=75s\n' +
        '  "Say it once."\n' +
        '- Shipping with AI: https://www.youtube.com/watch?v=bbbbbbbbbbb',
    );
  });

  it('stays inside the ideas table limit, dropping quotes before shortening the body', () => {
    const long = craftIdeaBody({ title: 'T', body: 'x'.repeat(3900) }, [
      { ...sources[0], quote: 'q'.repeat(500) },
    ]);
    expect(long.length).toBeLessThanOrEqual(4000);
    expect(long).toContain('watch?v=aaaaaaaaaaa');
    expect(long).not.toContain('qqq');
    const cut = craftIdeaBody({ title: 'T', body: 'y'.repeat(3999) }, sources);
    expect(cut.length).toBe(4000);
    expect(cut).toContain('watch?v=bbbbbbbbbbb');
  });
});

describe('craftModule', () => {
  it('files in the workspace the takeaway touches, and dev for the whole app', () => {
    expect(craftModule('shopping')).toBe('shopping');
    expect(craftModule(null)).toBe('dev');
    expect(craftModule('not-a-workspace')).toBe('dev');
  });
});

describe('craftTakeaway', () => {
  it('files one idea with the videos in playlist order and marks the takeaway crafted with it', async () => {
    const tables = world();
    const result = await craftTakeaway(memoryClient(tables), USER, TAKEAWAY);

    expect(result).toEqual({ ok: true, ideaId: 'idea-1', matched: null });
    expect(tables.ideas).toHaveLength(1);
    const idea = tables.ideas[0];
    expect(idea.module).toBe('dev');
    expect(idea.source).toBeUndefined();
    const body = String(idea.body);
    expect(body.startsWith('Show the diff before a session commits\n\n')).toBe(true);
    expect(body.indexOf('Agents in practice')).toBeLessThan(body.indexOf('Shipping with AI'));
    expect(body).toContain('watch?v=bbbbbbbbbbb&t=754s');

    const takeaway = tables.inspiration_takeaways[0];
    expect(takeaway.status).toBe('crafted');
    expect(takeaway.idea_id).toBe('idea-1');
    expect(takeaway.crafted_at).toEqual(expect.any(String));
  });

  it('files in the takeaway\'s own workspace', async () => {
    const tables = world({ module: 'learn' });
    await craftTakeaway(memoryClient(tables), USER, TAKEAWAY);
    expect(tables.ideas[0].module).toBe('learn');
  });

  it('cannot be crafted a second time, from this video or another', async () => {
    const tables = world();
    const client = memoryClient(tables);
    await craftTakeaway(client, USER, TAKEAWAY);
    const again = await craftTakeaway(client, USER, TAKEAWAY);

    expect(again).toEqual({ ok: false, error: 'This takeaway has already been crafted.' });
    expect(tables.ideas).toHaveLength(1);
  });

  it('files nothing when two presses race and the other one marks it first', async () => {
    const tables = world();
    const client = memoryClient(tables);
    // Both presses read the takeaway as open; the first to mark it wins.
    const [first, second] = await Promise.all([
      craftTakeaway(client, USER, TAKEAWAY),
      craftTakeaway(client, USER, TAKEAWAY),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(tables.ideas).toHaveLength(1);
    expect(tables.inspiration_takeaways[0].idea_id).toBe(tables.ideas[0].id);
  });

  it('uses the idea already filed when the takeaway repeats it, rather than filing a second', async () => {
    const existing = {
      id: 'idea-old',
      user_id: USER,
      plan_item_id: null,
      body: 'Show the diff before a session commits\n\nSomething said differently.',
    };
    const tables = world({ ideas: [existing] });
    const result = await craftTakeaway(memoryClient(tables), USER, TAKEAWAY);

    expect(result).toEqual({ ok: true, ideaId: 'idea-old', matched: { id: 'idea-old', body: existing.body } });
    expect(tables.ideas).toHaveLength(1);
    expect(tables.inspiration_takeaways[0].idea_id).toBe('idea-old');
  });

  it('refuses a takeaway that is not open', async () => {
    for (const status of ['dismissed', 'covered']) {
      const tables = world({ status });
      const result = await craftTakeaway(memoryClient(tables), USER, TAKEAWAY);
      expect(result.ok).toBe(false);
      expect(tables.ideas).toHaveLength(0);
    }
  });

  it('says so when the takeaway is gone', async () => {
    const result = await craftTakeaway(memoryClient(world()), USER, 'missing');
    expect(result).toEqual({ ok: false, error: 'That takeaway no longer exists.' });
  });
});
