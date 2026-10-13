import { describe, expect, it, vi } from 'vitest';
import { LEARN_CHANGE_KINDS } from '@/lib/ask/learn-changes';
import { LEARN_WRITES, runLearnWrite, type LearnWriteEnv } from './learn-writes';

vi.mock('@/lib/learn/youtube/video-card-run', () => ({ settleVideoCards: vi.fn(async () => ({ withdrawn: 0, revived: 0 })) }));
vi.mock('@/lib/learn/embed/idea-embedding', () => ({
  embedIdeaClaim: vi.fn(async () => ({ embedding: null, embedding_model: null })),
}));

/**
 * The Learn writes an agent makes (plan #1894.8): each one row, scoped to the
 * person by its own filter (the connector runs them with no row level
 * security), and reported with the values its Undo needs.
 */

type Row = Record<string, unknown>;
const ME = 'me';
const READING = '11111111-1111-4111-8111-111111111111';
const TRACK = '22222222-2222-4222-8222-222222222222';
const CONCEPT = '33333333-3333-4333-8333-333333333333';

/** A learn client over in-memory tables, enough of the query builder for these writes. */
function fakeLearn(tables: Record<string, Row[]>) {
  let ids = 0;
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    let op: 'select' | 'update' | 'insert' = 'select';
    let patch: Row = {};
    let order: string | null = null;
    const filters: [string, unknown][] = [];
    const matching = () => rows.filter((row) => filters.every(([column, value]) => row[column] === value));
    const run = (): Row[] => {
      if (op === 'insert') {
        const row = { id: `new-${++ids}`, ...patch };
        rows.push(row);
        return [row];
      }
      const found = matching();
      if (op === 'update') for (const row of found) Object.assign(row, patch);
      if (order) found.sort((a, b) => Number(b[order!]) - Number(a[order!]));
      return found.map((row) => ({ ...row }));
    };
    const builder = {
      select: () => builder,
      update: (values: Row) => ((op = 'update'), (patch = values), builder),
      insert: (values: Row) => ((op = 'insert'), (patch = values), builder),
      eq: (column: string, value: unknown) => (filters.push([column, value]), builder),
      order: (column: string) => ((order = column), builder),
      limit: () => builder,
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => {
        const [row] = run();
        return row ? { data: row, error: null } : { data: null, error: { message: 'no row' } };
      },
    };
    return builder;
  };
  return { from } as unknown as LearnWriteEnv['learn'];
}

const write = (name: string) => LEARN_WRITES.find((entry) => entry.name === name)!;

describe('the Learn writes', () => {
  it('are the kinds Ask keeps them under, in order', () => {
    expect(LEARN_WRITES.map((entry) => entry.name)).toEqual([...LEARN_CHANGE_KINDS]);
  });

  it('marks a reading read, takes it off the shelf and keeps the row as it was', async () => {
    const tables = {
      readings: [{ id: READING, user_id: ME, title: 'Attention Is All You Need', status: 'reading', read_now_at: '2026-10-01' }],
    };
    const made = await runLearnWrite(write('change_reading'), { userId: ME, learn: fakeLearn(tables) }, {
      reading_id: READING,
      status: 'read',
    });
    if ('ok' in made) throw new Error(made.error);
    expect(made.op).toBe('update');
    expect(made.subjectRef).toBe(`learn.readings:${READING}`);
    expect(made.before).toMatchObject({ status: 'reading', read_now_at: '2026-10-01' });
    expect(made.after).toMatchObject({ status: 'read', read_now_at: null });
    expect(made.summary).toBe('Dash changed the reading "Attention Is All You Need": marked read.');
    expect(made.input.href).toBe(`/learn/r/${READING}`);
  });

  it('refuses a reading that is not the person’s, and a call that changes nothing', async () => {
    const tables = { readings: [{ id: READING, user_id: 'someone else', title: 'Theirs' }] };
    const env = { userId: ME, learn: fakeLearn(tables) };
    expect(await runLearnWrite(write('change_reading'), env, { reading_id: READING, status: 'read' })).toEqual({
      ok: false,
      error: 'There is no reading of theirs with that id. Look it up first.',
    });
    tables.readings[0].user_id = ME;
    expect(await runLearnWrite(write('change_reading'), env, { reading_id: READING })).toEqual({
      ok: false,
      error: 'Say what to change: status, read_now, note, text, clear_text or link.',
    });
  });

  it('adds a reading at the end of a list, with the source for its link', async () => {
    const tables: Record<string, Row[]> = {
      tracks: [{ id: TRACK, user_id: ME, title: 'Transformers' }],
      readings: [{ id: READING, user_id: ME, track_id: TRACK, position: 30 }],
    };
    const made = await runLearnWrite(write('add_track_reading'), { userId: ME, learn: fakeLearn(tables) }, {
      track_id: TRACK,
      title: 'The Illustrated Transformer',
      link: 'https://jalammar.github.io/illustrated-transformer/',
    });
    if ('ok' in made) throw new Error(made.error);
    expect(made.op).toBe('insert');
    expect(made.after).toMatchObject({ track_id: TRACK, position: 40, user_id: ME, open_url: 'https://jalammar.github.io/illustrated-transformer/' });
    expect(tables.sources).toEqual([expect.objectContaining({ user_id: ME, canonical_url: 'https://jalammar.github.io/illustrated-transformer/' })]);
    expect(made.summary).toBe('Dash added "The Illustrated Transformer" to the reading list "Transformers".');
  });

  it('refuses a link that is not https', async () => {
    const tables = { tracks: [{ id: TRACK, user_id: ME, title: 'Transformers' }] };
    expect(
      await runLearnWrite(write('add_track_reading'), { userId: ME, learn: fakeLearn(tables) }, {
        track_id: TRACK,
        title: 'A page',
        link: 'http://example.com',
      }),
    ).toEqual({ ok: false, error: 'link must start with https://.' });
  });

  it('rewords an idea and keeps its first wording', async () => {
    const tables = { concepts: [{ id: CONCEPT, user_id: ME, name: 'Attention', claim: 'Old words.', claim_original: null }] };
    const made = await runLearnWrite(write('reword_concept'), { userId: ME, learn: fakeLearn(tables) }, {
      concept_id: CONCEPT,
      claim: 'New words.',
    });
    if ('ok' in made) throw new Error(made.error);
    expect(made.after).toMatchObject({ claim: 'New words.', claim_original: 'Old words.' });
  });

  it('notes on exactly one of an idea or a card', async () => {
    const tables = { concepts: [{ id: CONCEPT, user_id: ME, name: 'Attention' }] };
    const env = { userId: ME, learn: fakeLearn(tables) };
    expect(await runLearnWrite(write('add_concept_note'), env, { body: 'x', concept_id: CONCEPT, card_id: CONCEPT })).toEqual({
      ok: false,
      error: 'Give one of concept_id or card_id.',
    });
    const made = await runLearnWrite(write('add_concept_note'), env, { body: 'Ask about the heads.', concept_id: CONCEPT });
    if ('ok' in made) throw new Error(made.error);
    expect(made.after).toMatchObject({ user_id: ME, concept_id: CONCEPT, card_id: null, body: 'Ask about the heads.' });
    expect(made.summary).toBe('Dash added a note to the idea "Attention": Ask about the heads.');
  });

  it('moves a video as the person’s own verdict', async () => {
    const tables = { watch_list: [{ id: 'w1', user_id: ME, video_id: 'dQw4w9WgXcQ', verdict: 'skip', verdict_by: 'judge' }] };
    const made = await runLearnWrite(write('change_video'), { userId: ME, learn: fakeLearn(tables) }, {
      video_id: 'dQw4w9WgXcQ',
      pile: 'watch',
    });
    if ('ok' in made) throw new Error(made.error);
    expect(made.subjectRef).toBe('learn.watch_list:w1');
    expect(made.after).toMatchObject({ verdict: 'watch', verdict_by: 'you' });
    expect(made.summary).toBe('Dash changed the video "video dQw4w9WgXcQ": moved to Watch.');
  });
});
