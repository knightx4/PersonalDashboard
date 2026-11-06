import type Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AskInputError, type AskContext } from '@/lib/ask/db';
import type { TableShape } from '@/lib/ask/table-info';

const shapes = vi.fn();
const query = vi.fn();
vi.mock('@/lib/ask/table-info', async (original) => ({
  ...(await original<typeof import('@/lib/ask/table-info')>()),
  listableShapes: (...args: unknown[]) => shapes(...args),
}));
vi.mock('@/lib/ask/query', async (original) => ({
  ...(await original<typeof import('@/lib/ask/query')>()),
  queryRowsLookup: (...args: unknown[]) => query(...args),
}));

const { cadenceWords, draftAdvisorWatch, readWatchReply, watchKey, watchReplySchema, watchRow, watchSummary, watchTableLines, WATCH_LIMITS } =
  await import('./advisor-watch');

/**
 * The watch Dash writes when no fixed watch covers a brief (plan #3030.1.1),
 * from the example in #3030.1: "tell me when a vault note mentions my sister".
 */

const ME = '00000000-0000-4000-8000-0000000000aa';
const SISTER = {
  possible: true,
  why_not: '',
  key: 'Sister mentions',
  about: 'Vault notes that mention Anna',
  sends_when: 'A note in your vault mentions Anna.',
  sample: 'Your note "Sunday call" mentions Anna. Want to read it again?',
  every_days: 1,
  mode: 'each',
  query: { table: 'obsidian.notes', where: [{ column: 'body', op: 'contains', value: 'Anna' }], order: { column: 'updated_at', ascending: false } },
};

const NOTES: TableShape = {
  columns: [
    { column: 'path', type: 'text', nullable: false },
    { column: 'title', type: 'text', nullable: true },
    { column: 'body', type: 'text', nullable: true },
    { column: 'user_id', type: 'uuid', nullable: false },
    { column: 'embedding', type: 'vector', nullable: true },
    { column: 'updated_at', type: 'timestamp with time zone', nullable: false },
  ],
  links: [],
};

const ask = { userId: ME, today: '2026-11-06', enabledModules: ['vault'], db: vi.fn() } as unknown as AskContext;

function reply(json: unknown) {
  const client = {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(json) }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    },
  };
  return client as typeof client & Pick<Anthropic, 'messages'>;
}

beforeEach(() => {
  shapes.mockReset();
  query.mockReset();
  shapes.mockResolvedValue(new Map([['obsidian.notes', NOTES]]));
  query.mockResolvedValue({ ok: true, rows: [], totals: { matched: 3, shown: 3 } });
});

describe('the tables the model is given', () => {
  it('lists each readable table in a workspace that is on, without the owner or vector columns', () => {
    const { tables, lines } = watchTableLines(new Map([['obsidian.notes', NOTES]]), ['vault']);
    expect(tables).toEqual(['obsidian.notes']);
    expect(lines[0]).toContain('obsidian.notes:');
    expect(lines[0]).toContain('body text');
    expect(lines[0]).toContain('updated_at timestamptz');
    expect(lines[0]).not.toContain('user_id');
    expect(lines[0]).not.toContain('embedding');
  });

  it('leaves out a workspace that is switched off', () => {
    expect(watchTableLines(new Map([['obsidian.notes', NOTES]]), []).tables).toEqual([]);
  });

  it('offers only those tables in the reply schema', () => {
    const schema = watchReplySchema(['obsidian.notes']);
    expect(schema.properties.query.properties.table.enum).toEqual(['obsidian.notes']);
  });
});

describe('readWatchReply', () => {
  it('turns the sister example into a capped query over one table', () => {
    const read = readWatchReply(SISTER, ['obsidian.notes'], 'ab12cd');
    if (!read.ok) throw new Error(read.error);
    expect(read.draft).toMatchObject({
      key: 'custom_sister_mentions_ab12cd',
      everyDays: 1,
      mode: 'each',
      tables: ['obsidian.notes'],
      query: {
        table: 'obsidian.notes',
        where: [{ column: 'body', op: 'contains', value: 'Anna' }],
        order: { column: 'updated_at', ascending: false },
        limit: WATCH_LIMITS.rows,
      },
    });
  });

  it('says what is missing when the model finds no table for it', () => {
    const read = readWatchReply({ ...SISTER, possible: false, why_not: 'Nothing holds the weather.' }, ['obsidian.notes'], 'x');
    expect(read).toEqual({ ok: false, error: 'Dash cannot watch that: Nothing holds the weather.' });
  });

  it('refuses a table it was not offered, a bad cadence and too many conditions', () => {
    expect(readWatchReply({ ...SISTER, query: { ...SISTER.query, table: 'core.secrets' } }, ['obsidian.notes'], 'x').ok).toBe(false);
    expect(readWatchReply({ ...SISTER, every_days: 0 }, ['obsidian.notes'], 'x').ok).toBe(false);
    const many = Array.from({ length: WATCH_LIMITS.conditions + 1 }, () => SISTER.query.where[0]);
    expect(readWatchReply({ ...SISTER, query: { ...SISTER.query, where: many } }, ['obsidian.notes'], 'x').ok).toBe(false);
  });

  it('drops the value of empty and not_empty, as query_rows takes them', () => {
    const read = readWatchReply(
      { ...SISTER, query: { ...SISTER.query, where: [{ column: 'title', op: 'not_empty', value: 'x' }] } },
      ['obsidian.notes'],
      'x',
    );
    if (!read.ok) throw new Error(read.error);
    expect(read.draft.query.where).toEqual([{ column: 'title', op: 'not_empty' }]);
  });
});

describe('watchKey', () => {
  it('always fits advisor_reach_outs.watch_key', () => {
    for (const raw of ['', '!!!', 'A very long name that goes on and on and on for ever', 'sister']) {
      expect(watchKey(raw, 'Zz9-xx')).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
    }
  });
});

describe('draftAdvisorWatch', () => {
  it('makes one call, runs the query once for the owner and keeps how many rows it matched', async () => {
    const client = reply(SISTER);
    const spent = vi.fn();
    const drafted = await draftAdvisorWatch({ name: 'Newt', brief: 'tell me when a vault note mentions my sister Anna' }, { ask, client, onSpend: spent, suffix: 'ab12cd' });
    if (!drafted.ok) throw new Error(drafted.error);
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(spent).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(ask, expect.objectContaining({ table: 'obsidian.notes', limit: WATCH_LIMITS.rows }));
    expect(drafted.matched).toBe(3);
  });

  it('refuses a query query_rows will not run, with its reason', async () => {
    query.mockRejectedValue(new AskInputError('obsidian.notes has no column text.'));
    const drafted = await draftAdvisorWatch({ name: 'Newt', brief: 'x' }, { ask, client: reply(SISTER) });
    expect(drafted).toMatchObject({ ok: false });
    expect((drafted as { error: string }).error).toContain('has no column text');
  });

  it('makes no call when no table can be read', async () => {
    shapes.mockResolvedValue(new Map());
    const client = reply(SISTER);
    expect(await draftAdvisorWatch({ name: 'Newt', brief: 'x' }, { ask, client })).toMatchObject({ ok: false });
    expect(client.messages.create).not.toHaveBeenCalled();
  });
});

describe('what is said and kept', () => {
  it('says what it checks, how often, that it waits for approval, and the sample', () => {
    const read = readWatchReply(SISTER, ['obsidian.notes'], 'ab12cd');
    if (!read.ok) throw new Error(read.error);
    const said = watchSummary('Newt', read.draft, 3);
    expect(said).toContain('Vault notes that mention Anna, checked every day in obsidian.notes');
    expect(said).toContain('3 rows match now');
    expect(said).toContain('runs nothing until you approve it');
    expect(said).toContain(SISTER.sample);
    expect(cadenceWords(7)).toBe('every week');
    expect(cadenceWords(3)).toBe('every 3 days');
  });

  it('keeps the watch as proposed, for the owner and the person on People', () => {
    const read = readWatchReply(SISTER, ['obsidian.notes'], 'ab12cd');
    if (!read.ok) throw new Error(read.error);
    expect(watchRow(ME, 'advisor', ' my sister ', { draft: read.draft, matched: 3 })).toMatchObject({
      user_id: ME,
      advisor_id: 'advisor',
      status: 'proposed',
      brief: 'my sister',
      sends_when: SISTER.sends_when,
      matched: 3,
    });
  });
});
