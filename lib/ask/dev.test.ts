import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModuleId } from '@/lib/modules';
import type { AskContext, SchemaClient } from './db';
import { MAX_DEV_COMMENTS, SECTION_CHARS, excerpt, queryWords } from './dev';
import { executeAskTool } from './tools';

/**
 * read_spec (plan #1322) against a fixture spec: the file is read through
 * `ctx.readSpec`, and the owner check through a stubbed `is_owner` rpc.
 */

const FIXTURE = path.join(__dirname, 'fixtures', 'spec.md');
const ALL_MODULES: ModuleId[] = ['shopping', 'jobs', 'vault', 'todo', 'learn', 'news', 'goals', 'dev'];

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/** The part of the supabase-js query builder read_dev_row uses, over rows in memory. */
class FakeQuery implements PromiseLike<{ data: Row[]; error: null }> {
  private filters: ((row: Row) => boolean)[] = [];
  private sort: { column: string; ascending: boolean } | null = null;
  private cap: number | null = null;

  constructor(
    private readonly rows: Row[],
    private readonly patterns: string[] = [],
  ) {}

  select() {
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  /** Postgres ilike: `%` and `_` are wild unless escaped with a backslash. */
  ilike(column: string, pattern: string) {
    this.patterns.push(pattern);
    const source = pattern.replace(/\\(.)|([%_])|([^\\%_]+)/g, (_, escaped: string, wild: string, plain: string) =>
      escaped !== undefined
        ? escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        : wild === '%'
          ? '[\\s\\S]*'
          : wild === '_'
            ? '[\\s\\S]'
            : plain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
    const regex = new RegExp(`^${source}$`, 'i');
    this.filters.push((row) => typeof row[column] === 'string' && regex.test(row[column] as string));
    return this;
  }
  /** A trailing `%` only, which is all the thread reads use. */
  like(column: string, pattern: string) {
    const prefix = pattern.replace(/%$/, '');
    this.filters.push((row) => typeof row[column] === 'string' && (row[column] as string).startsWith(prefix));
    return this;
  }
  is(column: string, value: null) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.sort = { column, ascending: options.ascending ?? true };
    return this;
  }
  limit(n: number) {
    this.cap = n;
    return this;
  }
  then<A = { data: Row[]; error: null }, B = never>(
    onFulfilled?: ((value: { data: Row[]; error: null }) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    let out = this.rows.filter((row) => this.filters.every((f) => f(row)));
    const sort = this.sort;
    if (sort) {
      out = [...out].sort((a, b) => {
        const order = String(a[sort.column] ?? '').localeCompare(String(b[sort.column] ?? ''), undefined, { numeric: true });
        return sort.ascending ? order : -order;
      });
    }
    if (this.cap !== null) out = out.slice(0, this.cap);
    return Promise.resolve({ data: out, error: null }).then(onFulfilled, onRejected);
  }
}

/**
 * The fixtures write comments the way dev_comments held them, a column per
 * kind of row; the shared store (plan #1470) reads them by ref instead.
 */
const COMMENT_REFS: Record<string, string> = {
  idea_id: 'public.ideas',
  feedback_item_id: 'public.feedback_items',
  plan_item_id: 'public.plan_items',
  raised_item_id: 'public.raised_items',
  spec_section_id: 'public.spec_sections',
};
function threadTurns(tables: Tables): Row[] {
  return (tables.dev_comments ?? []).flatMap((row) => {
    const column = Object.keys(COMMENT_REFS).find((c) => typeof row[c] === 'string');
    return column ? [{ ...row, ref: `${COMMENT_REFS[column]}:${row[column]}` }] : [];
  });
}

function context({ owner = true, modules = ALL_MODULES, tables = {} as Tables } = {}): AskContext & {
  rpcs: string[];
  patterns: string[];
} {
  const rpcs: string[] = [];
  const patterns: string[] = [];
  return {
    rpcs,
    patterns,
    userId: '00000000-0000-4000-8000-00000000000a',
    today: '2026-09-30',
    enabledModules: modules,
    db: async () =>
      ({
        from: (table: string) =>
          new FakeQuery(table === 'thread_turns' ? threadTurns(tables) : (tables[table] ?? []), patterns),
        rpc: async (fn: string) => {
          rpcs.push(fn);
          return fn === 'is_owner' ? { data: owner, error: null } : { data: null, error: { message: 'no' } };
        },
      }) as unknown as SchemaClient,
    searchSources: [],
    readSpec: () => readFile(FIXTURE, 'utf8'),
  };
}

describe('read_spec', () => {
  it('returns the section a query is about, with its text and a link to it on the spec page', async () => {
    const result = await executeAskTool('read_spec', { spec: 'writing', query: 'what the writing guide says about em dashes' }, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    const [row] = result.rows;
    expect(row).toMatchObject({
      table: 'docs.specs',
      ref: 'writing#punctuation',
      title: 'Professional writing guide: Punctuation',
      href: '/dev/specs/writing#punctuation',
    });
    expect(row.detail?.text).toContain('Use em dashes sparingly');
  });

  it('lists the headings when the query matches nothing, or there is no query', async () => {
    for (const input of [{ spec: 'writing', query: 'zeppelins' }, { spec: 'writing' }]) {
      const result = await executeAskTool('read_spec', input, context());
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.rows.map((row) => row.detail?.section)).toEqual(['opening', 'punctuation', 'structure', 'long-section']);
      expect(result.rows.every((row) => row.detail?.text === undefined)).toBe(true);
    }
  });

  it('reads one section by its anchor, or by the ref an earlier read returned', async () => {
    const bySection = await executeAskTool('read_spec', { spec: 'writing', section: 'structure' }, context());
    const byRef = await executeAskTool('read_spec', { spec: 'writing#structure' }, context());
    for (const result of [bySection, byRef]) {
      expect(result.ok && result.rows.map((row) => row.ref)).toEqual(['writing#structure']);
    }
  });

  it('cuts a long section from the paragraph that matches', async () => {
    const result = await executeAskTool('read_spec', { spec: 'writing', query: 'expiry rule' }, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = String(result.rows[0].detail?.text);
    expect(text.startsWith('… The expiry rule')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(SECTION_CHARS + 6);
    expect(result.note).toContain('cut');
  });

  it('gives another account nothing, and nothing with the Dev workspace off', async () => {
    const other = await executeAskTool('read_spec', { spec: 'writing', query: 'em dashes' }, context({ owner: false }));
    expect(other).toEqual({ ok: false, error: expect.stringContaining('not the owner') });

    const off = context({ modules: ['shopping'] });
    expect(await executeAskTool('read_spec', { spec: 'writing' }, off)).toEqual({
      ok: false,
      error: expect.stringContaining('Dev workspace is switched off'),
    });
    expect(off.rpcs).toEqual([]);
  });

  it('refuses a spec that is not on the specs page', async () => {
    const result = await executeAskTool('read_spec', { spec: 'SETUP.md' }, context());
    expect(result).toEqual({ ok: false, error: expect.stringContaining('There is no spec called SETUP.md') });
  });
});

describe('queryWords', () => {
  it('keeps two-letter words such as "em" and drops the question around the topic', () => {
    expect(queryWords('What does it say about em dashes?')).toEqual(['em', 'dashes']);
  });
});

/**
 * read_dev_row (plan #1329): each kind of Dev row with its comments, the
 * other person's rows beside the asker's, and a dismissed one of each.
 */
describe('read_dev_row', () => {
  const ME = '00000000-0000-4000-8000-00000000000a';
  const THEM = '00000000-0000-4000-8000-00000000000b';
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const IDEA = id(1);
  const DISMISSED_IDEA = id(2);
  const NOTE = id(3);
  const STEP = id(4);
  const FEATURE = id(5);
  const QUESTION = id(6);
  const RAISE = id(7);
  const DISMISSED_RAISE = id(8);
  const THEIR_IDEA = id(9);
  const DISMISSED_STEP = id(10);
  const OPEN_QUESTION = id(11);

  const at = '2026-09-01T10:00:00Z';
  const tables: Tables = {
    ideas: [
      { id: IDEA, user_id: ME, body: 'Order ideas by how often they come up\nMore beneath.', module: 'dev', source: 'claude', triage: { kind: { value: 'feature', confidence: 1 }, priority: { value: 3, confidence: 0.4 } }, created_at: at, plan_item_id: null, dismissed_at: null },
      { id: DISMISSED_IDEA, user_id: ME, body: 'Put aside', module: null, source: 'me', triage: null, created_at: at, plan_item_id: null, dismissed_at: at },
      { id: THEIR_IDEA, user_id: THEM, body: 'Not yours', module: null, source: 'me', triage: null, created_at: at, plan_item_id: null, dismissed_at: null },
    ],
    feedback_items: [
      { id: NOTE, user_id: ME, body: 'The plan page jumps on save', kind: 'bug', status: 'done', page_path: '/dev/plan', resolution_note: 'Kept the scroll position.', triage: null, created_at: at },
    ],
    plan_items: [
      { id: FEATURE, user_id: ME, number: 1319, title: 'Let Dash read your Dev pages in full', kind: 'build', status: 'not_started', parent_id: null, position: 1, dismissed_at: null },
      { id: STEP, user_id: ME, number: 1248, title: 'Read a row', kind: 'build', status: 'in_progress', detail: 'Read one row.', acceptance: 'It reads.', comment: 'Added by a session.', resolution: null, fog: 'Unclear', fog_dismissed_at: at, block_ask: null, parent_id: FEATURE, position: 2, dismissed_at: null },
      { id: QUESTION, user_id: ME, number: 1250, title: 'Which shape?', kind: 'decision', status: 'done', resolution: 'B, JSON.', parent_id: STEP, position: 1, dismissed_at: null },
      { id: OPEN_QUESTION, user_id: ME, number: 1251, title: 'Which name?', kind: 'decision', status: 'not_started', resolution: null, detail: 'A — one.\nB — two.', parent_id: STEP, position: 2, dismissed_at: null },
      { id: DISMISSED_STEP, user_id: ME, number: 1252, title: 'Put aside', kind: 'build', status: 'not_started', parent_id: FEATURE, position: 3, dismissed_at: at },
    ],
    raised_items: [
      { id: RAISE, user_id: ME, title: 'Migration 0019 is unapplied', detail: 'The Learn page reads a column.', ask: 'Apply it?', status: 'answered', source: 'plan #12', outcome: null, module: 'learn', created_at: at, goal_id: null },
      { id: DISMISSED_RAISE, user_id: ME, title: 'Old', detail: null, ask: 'No?', status: 'dismissed', source: null, outcome: null, module: null, created_at: at, goal_id: null },
    ],
    dev_comments: [
      { user_id: ME, idea_id: IDEA, author: 'claude', body: 'Suggest counting duplicates.', created_at: '2026-09-02T09:00:00Z' },
      { user_id: ME, idea_id: IDEA, author: 'me', body: 'Yes, and newest first.', created_at: '2026-09-01T09:00:00Z' },
      { user_id: THEM, idea_id: IDEA, author: 'me', body: 'Someone else', created_at: '2026-09-03T09:00:00Z' },
      { user_id: ME, feedback_item_id: NOTE, author: 'claude', body: 'Fixed in abc123.', created_at: at },
      { user_id: ME, plan_item_id: STEP, author: 'me', body: 'Keep it small.', created_at: at },
      { user_id: ME, raised_item_id: RAISE, author: 'me', body: 'Go ahead.', created_at: at },
    ],
  };

  const read = (input: Record<string, unknown>, options: Parameters<typeof context>[0] = {}) =>
    executeAskTool('read_dev_row', input, context({ tables, ...options }));

  it('reads an idea with its thread oldest first, naming what Dash wrote', async () => {
    const result = await read({ kind: 'idea', ref: IDEA });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    const [row] = result.rows;
    expect(row).toMatchObject({
      table: 'public.ideas',
      ref: IDEA,
      title: 'Order ideas by how often they come up',
      href: `/dev/ideas#idea-${IDEA}`,
    });
    expect(row.detail).toMatchObject({ filed_by: 'Dash', triage_by_dash: 'kind feature, priority 3', comment_count: 2 });
    expect(row.detail?.body).toContain('More beneath.');
    expect(row.detail?.comments).toBe(
      '[2026-09-01, me] Yes, and newest first.\n\n[2026-09-02, Dash] Suggest counting duplicates.',
    );
  });

  it('reads a note with how it was resolved', async () => {
    const result = await read({ kind: 'note', ref: NOTE });
    expect(result.ok && result.rows[0]).toMatchObject({
      table: 'public.feedback_items',
      href: `/dev/bugs#note-${NOTE}`,
      detail: { filed_by: 'me', status: 'done', resolution_by_dash: 'Kept the scroll position.', comments: '[2026-09-01, Dash] Fixed in abc123.' },
    });
  });

  it('reads a step by its number, with the questions beneath it and their answers', async () => {
    for (const ref of ['#1248', '1248', STEP]) {
      const result = await read({ kind: 'step', ref });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const [row] = result.rows;
      expect(row).toMatchObject({
        table: 'public.plan_items',
        ref: STEP,
        title: '#1248 Read a row',
        href: '/dev/plan?view=all&q=%231248',
      });
      expect(row.detail).toMatchObject({
        under: '#1319 Let Dash read your Dev pages in full',
        detail: 'Read one row.',
        done_when: 'It reads.',
        history: 'Added by a session.',
        fog: null,
        comments: '[2026-09-01, me] Keep it small.',
      });
      expect(row.detail?.decisions).toBe('#1250 Which shape? Answered: B, JSON.\n#1251 Which name? Not answered yet.');
    }
  });

  it('links an open question to its card on the Dash tab, and reads it as a step', async () => {
    const result = await read({ kind: 'plan', ref: '#1251' });
    expect(result.ok && result.rows[0].href).toBe(`/dev/inbox#waiting-${OPEN_QUESTION}`);
  });

  it('reads a raise, which Dash raised', async () => {
    const result = await read({ kind: 'public.raised_items', ref: RAISE });
    expect(result.ok && result.rows[0]).toMatchObject({
      title: 'Migration 0019 is unapplied',
      href: `/dev/inbox#raise-${RAISE}`,
      detail: { raised_by: 'Dash', ask: 'Apply it?', comments: '[2026-09-01, me] Go ahead.' },
    });
  });

  it('returns nothing for a dismissed idea, step or raise, or another person\'s row', async () => {
    for (const input of [
      { kind: 'idea', ref: DISMISSED_IDEA },
      { kind: 'step', ref: '#1252' },
      { kind: 'raise', ref: DISMISSED_RAISE },
      { kind: 'idea', ref: THEIR_IDEA },
    ]) {
      const result = await read(input);
      expect(result).toEqual({ ok: true, rows: [], note: expect.stringContaining('dismissed') });
    }
  });

  it('keeps the newest comments of a long thread', async () => {
    const many: Tables = {
      ...tables,
      dev_comments: Array.from({ length: MAX_DEV_COMMENTS + 5 }, (_, i) => ({
        user_id: ME,
        idea_id: IDEA,
        author: 'me',
        body: `comment ${i}`,
        created_at: `2026-09-01T10:${String(i).padStart(2, '0')}:00Z`,
      })),
    };
    const result = await executeAskTool('read_dev_row', { kind: 'idea', ref: IDEA }, context({ tables: many }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const comments = String(result.rows[0].detail?.comments);
    expect(comments.startsWith('[2026-09-01, me] comment 5')).toBe(true);
    expect(result.note).toContain('oldest 5 are left out');
  });

  it('gives another account nothing, and nothing with the Dev workspace off', async () => {
    expect(await read({ kind: 'idea', ref: IDEA }, { owner: false })).toEqual({
      ok: false,
      error: expect.stringContaining('not the owner'),
    });
    expect(await read({ kind: 'idea', ref: IDEA }, { modules: ['shopping'] })).toEqual({
      ok: false,
      error: expect.stringContaining('Dev workspace is switched off'),
    });
  });

  it('refuses a kind it does not know, and a ref that names no row', async () => {
    expect(await read({ kind: 'goal', ref: IDEA })).toEqual({ ok: false, error: expect.stringContaining('kind must be') });
    expect(await read({ kind: 'idea', ref: '1248' })).toEqual({ ok: false, error: expect.stringContaining('not an id') });
  });
});

/**
 * find_dev_text (plan #1323): the words inside Dev rows, comments and specs,
 * with dismissed rows, the comments under them and another person's rows
 * beside the ones that should be found.
 */
describe('find_dev_text', () => {
  const ME = '00000000-0000-4000-8000-00000000000a';
  const THEM = '00000000-0000-4000-8000-00000000000b';
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const RANK_IDEA = id(21);
  const DISMISSED_RANK_IDEA = id(22);
  const THEIR_RANK_IDEA = id(23);
  const STEP = id(24);
  const DISMISSED_STEP = id(25);
  const NOTE = id(26);
  const RAISE = id(27);
  const DISMISSED_RAISE = id(28);

  const long = `${'Some opening words about the list. '.repeat(20)}Sort the suggestions by a ranking of how often they come up.${' More after.'.repeat(30)}`;
  const tables: Tables = {
    ideas: [
      { id: RANK_IDEA, user_id: ME, body: `Better ideas order\n${long}`, source: 'me', updated_at: '2026-09-05T10:00:00Z', dismissed_at: null },
      { id: DISMISSED_RANK_IDEA, user_id: ME, body: 'Ranking by votes', source: 'claude', updated_at: '2026-09-06T10:00:00Z', dismissed_at: '2026-09-07T10:00:00Z' },
      { id: THEIR_RANK_IDEA, user_id: THEM, body: 'Their ranking idea', source: 'me', updated_at: '2026-09-06T10:00:00Z', dismissed_at: null },
    ],
    feedback_items: [
      { id: NOTE, user_id: ME, body: 'Ideas list is out of order', resolution_note: 'Fixed the ranking query.', updated_at: '2026-09-04T10:00:00Z' },
    ],
    plan_items: [
      { id: STEP, user_id: ME, number: 1400, title: 'Show counts', kind: 'build', status: 'not_started', detail: 'Count them.', acceptance: null, comment: null, resolution: null, updated_at: '2026-09-01T10:00:00Z', dismissed_at: null },
      { id: DISMISSED_STEP, user_id: ME, number: 1401, title: 'Old', kind: 'build', status: 'not_started', detail: 'Ranking again.', acceptance: null, comment: null, resolution: null, updated_at: '2026-09-08T10:00:00Z', dismissed_at: '2026-09-09T10:00:00Z' },
    ],
    raised_items: [
      { id: RAISE, user_id: ME, title: 'Ideas order', detail: 'Nothing.', ask: 'Keep the ranking as it is?', status: 'open', goal_id: null, created_at: '2026-09-03T10:00:00Z' },
      { id: DISMISSED_RAISE, user_id: ME, title: 'Old', detail: 'Ranking.', ask: 'No?', status: 'dismissed', goal_id: null, created_at: '2026-09-09T10:00:00Z' },
    ],
    dev_comments: [
      { id: id(31), user_id: ME, plan_item_id: STEP, author: 'me', body: 'Drop this step, #1323 covers it.', created_at: '2026-09-10T10:00:00Z' },
      { id: id(32), user_id: ME, plan_item_id: DISMISSED_STEP, author: 'me', body: 'Drop this step too.', created_at: '2026-09-11T10:00:00Z' },
      { id: id(33), user_id: ME, idea_id: RANK_IDEA, author: 'claude', body: 'The ranking could weigh recent ones.', created_at: '2026-09-02T10:00:00Z' },
      { id: id(34), user_id: THEM, plan_item_id: STEP, author: 'me', body: 'Drop this step, says someone else.', created_at: '2026-09-12T10:00:00Z' },
    ],
  };

  const find = (input: Record<string, unknown>, options: Parameters<typeof context>[0] = {}) =>
    executeAskTool('find_dev_text', input, context({ tables, ...options }));

  it('finds the ideas that mention a word inside their text, linked, with the excerpt around it', async () => {
    const result = await find({ query: 'ranking', kinds: ['idea'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    const [row] = result.rows;
    expect(row).toMatchObject({
      table: 'public.ideas',
      ref: RANK_IDEA,
      title: 'Better ideas order',
      href: `/dev/ideas#idea-${RANK_IDEA}`,
      detail: { kind: 'idea', field: 'idea', written_by: 'me' },
    });
    const text = String(row.detail?.excerpt);
    expect(text).toContain('by a ranking of how often');
    expect(text.startsWith('… ')).toBe(true);
    expect(text.endsWith(' …')).toBe(true);
  });

  it('finds the comment that said to drop a step, cited as the step it sits on', async () => {
    const result = await find({ query: 'drop step', kinds: ['comment'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      {
        table: 'public.plan_items',
        ref: STEP,
        title: '#1400 Show counts',
        href: '/dev/plan?view=all&q=%231400',
        detail: {
          kind: 'comment',
          field: 'comment',
          written_by: 'me',
          on: '2026-09-10',
          excerpt: 'Drop this step, #1323 covers it.',
        },
      },
    ]);
  });

  it('looks in every kind, newest first, naming what Dash wrote, and leaves dismissed rows out', async () => {
    const result = await find({ query: 'ranking', kinds: ['idea', 'note', 'step', 'raise', 'comment'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => [row.table, row.ref, row.detail?.kind, row.detail?.written_by])).toEqual([
      ['public.ideas', RANK_IDEA, 'idea', 'me'],
      ['public.feedback_items', NOTE, 'note', 'Dash'],
      ['public.raised_items', RAISE, 'raise', 'Dash'],
      ['public.ideas', RANK_IDEA, 'comment', 'Dash'],
    ]);
    expect(result.rows[2].href).toBe(`/dev/inbox#raise-${RAISE}`);
    expect(result.rows[1].detail?.field).toBe('resolution');
  });

  it('finds the spec sections that hold every word, linked to the section', async () => {
    const result = await find({ query: 'em dashes', kinds: ['spec'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.length).toBeGreaterThan(0);
    const [row] = result.rows;
    expect(row.table).toBe('docs.specs');
    expect(row.ref).toMatch(/#punctuation$/);
    expect(row.href).toMatch(/^\/dev\/specs\/[\w-]+#punctuation$/);
    expect(String(row.detail?.excerpt)).toContain('em dashes');
  });

  it('never lets a wildcard from the query into the pattern', async () => {
    const ctx = context({ tables });
    const result = await executeAskTool('find_dev_text', { query: '%rank_%', kinds: ['idea', 'comment'] }, ctx);
    expect(ctx.patterns.length).toBeGreaterThan(0);
    expect(new Set(ctx.patterns)).toEqual(new Set(['%rank%']));
    expect(result.ok && result.rows.map((row) => row.ref)).toEqual([RANK_IDEA, RANK_IDEA]);
  });

  it('says when nothing has the words, and refuses a query with no words in it', async () => {
    expect(await find({ query: 'zeppelins' })).toEqual({ ok: true, rows: [], note: expect.stringContaining('Nothing') });
    expect(await find({ query: '% _' })).toEqual({ ok: false, error: expect.stringContaining('word') });
    expect(await find({ query: 'ranking', kinds: ['goal'] })).toEqual({ ok: false, error: expect.stringContaining('kinds') });
  });

  it('gives another account nothing, and nothing with the Dev workspace off', async () => {
    expect(await find({ query: 'ranking' }, { owner: false })).toEqual({ ok: false, error: expect.stringContaining('not the owner') });
    expect(await find({ query: 'ranking' }, { modules: ['shopping'] })).toEqual({
      ok: false,
      error: expect.stringContaining('Dev workspace is switched off'),
    });
  });
});

describe('excerpt', () => {
  it('keeps a short text whole on one line', () => {
    expect(excerpt('One\n\ntwo ranking', ['ranking'])).toBe('One two ranking');
  });
});
