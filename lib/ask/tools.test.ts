import { describe, expect, it } from 'vitest';
import type { ModuleId } from '@/lib/modules';
import type { SearchHit, SearchSource } from '@/lib/search/sources';
import { citationsOf, type AskContext, type AskDb, type AskSchema, type SchemaClient } from './db';
import { OPENABLE } from './lookups';
import { ASK_TOOLS, ASK_TOOL_NAMES, executeAskTool } from './tools';

/**
 * Dash's read tools (plan #1088) against a stubbed client: an in-memory
 * stand-in for supabase-js that applies the filters a query asks for. Two
 * people's rows sit side by side in every table, so a tool that forgot to
 * filter to the asker would hand back the other person's.
 */

const ME = '00000000-0000-4000-8000-00000000000a';
const THEM = '00000000-0000-4000-8000-00000000000b';
const TODAY = '2026-09-27';

type Row = Record<string, unknown>;
type Tables = Partial<Record<string, Row[]>>;

type Filter = (row: Row) => boolean;

/** The part of the supabase-js query builder the lookups use. */
class FakeQuery implements PromiseLike<{ data: Row[]; error: null; count: number | null }> {
  private filters: Filter[] = [];
  private sorts: { column: string; ascending: boolean }[] = [];
  private cap: number | null = null;
  private window: [number, number] | null = null;
  private counted = false;
  private head = false;
  /** PostgREST embeds, `alias:table!key(column)`: the rows of `table` whose `key` is this row's id. */
  private embeds: { alias: string; table: string; key: string; filters: Filter[] }[] = [];
  /** PostgREST's `table!inner(column)` on a child: the parent row its `<table less s>_id` names, which must pass the filters. */
  private parents: { table: string; key: string; filters: Filter[] }[] = [];

  constructor(
    private readonly rows: Row[],
    private readonly tables: Tables = {},
    private readonly schema = 'public',
  ) {}

  select(columns?: string, options?: { count?: string; head?: boolean }) {
    this.counted = options?.count === 'exact';
    this.head = options?.head === true;
    for (const [, alias, table, key] of (columns ?? '').matchAll(/(linked_\d+):(\w+)!(\w+)\(\w+\)/g)) {
      this.embeds.push({ alias, table, key, filters: [] });
    }
    for (const [, table] of (columns ?? '').matchAll(/(\w+)!inner\(\w+\)/g)) {
      this.parents.push({ table, key: `${table.replace(/s$/, '')}_id`, filters: [] });
    }
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] != null && row[column] !== value);
    return this;
  }
  gt(column: string, value: string | number) {
    this.filters.push((row) => row[column] != null && (typeof value === 'number' ? Number(row[column]) > value : String(row[column]) > value));
    return this;
  }
  not(column: string, operator: string, value: unknown) {
    if (operator !== 'is' || value !== null) throw new Error(`fake not: ${operator}`);
    this.filters.push((row) => row[column] != null);
    return this;
  }
  ilike(column: string, pattern: string) {
    const needle = pattern.replace(/^%|%$/g, '').replace(/\\(.)/g, '$1').toLowerCase();
    this.filters.push((row) => typeof row[column] === 'string' && (row[column] as string).toLowerCase().includes(needle));
    return this;
  }
  contains(column: string, values: unknown[]) {
    this.filters.push((row) => Array.isArray(row[column]) && values.every((v) => (row[column] as unknown[]).includes(v)));
    return this;
  }
  /** PostgREST's or-filter, for the is.null, eq and neq parts query_rows writes. */
  or(filters: string) {
    const parts = filters.match(/(?:[^,"]|"(?:[^"\\]|\\.)*")+/g) ?? [];
    const tests = parts.map((part) => {
      const [, column, op, raw] = /^(\w+)\.(is|eq|neq)\.(.*)$/.exec(part) ?? [];
      const value = raw?.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : raw;
      if (op === 'is') return (row: Row) => row[column] == null;
      if (op === 'eq' && value === '{}') return (row: Row) => Array.isArray(row[column]) && (row[column] as unknown[]).length === 0;
      if (op === 'eq') return (row: Row) => row[column] != null && String(row[column]) === value;
      return (row: Row) => row[column] != null && String(row[column]) !== value;
    });
    this.filters.push((row) => tests.some((t) => t(row)));
    return this;
  }
  eq(column: string, value: unknown) {
    const [alias, inner] = column.split('.');
    const embed = inner ? this.embeds.find((e) => e.alias === alias) : undefined;
    const parent = inner ? this.parents.find((p) => p.table === alias) : undefined;
    if (inner && !embed && !parent) throw new Error(`fake eq: no embed ${alias}`);
    if (parent) parent.filters.push((row) => row[inner] === value);
    else if (embed) embed.filters.push((row) => row[inner] === value);
    else this.filters.push((row) => row[column] === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  is(column: string, value: null) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  gte(column: string, value: string) {
    this.filters.push((row) => row[column] != null && String(row[column]) >= value);
    return this;
  }
  lte(column: string, value: string) {
    this.filters.push((row) => row[column] != null && String(row[column]) <= value);
    return this;
  }
  lt(column: string, value: string | number) {
    this.filters.push((row) => row[column] != null && (typeof value === 'number' ? Number(row[column]) < value : String(row[column]) < value));
    return this;
  }
  /** Every word of the query somewhere in the title or body, as a crude full-text match. */
  textSearch(_column: string, query: string) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    this.filters.push((row) => {
      const text = `${row.title ?? ''} ${row.body ?? ''}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.sorts.push({ column, ascending: options.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this.cap = n;
    return this;
  }
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  then<A = { data: Row[]; error: null; count: number | null }, B = never>(
    onFulfilled?: ((value: { data: Row[]; error: null; count: number | null }) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    // An embed with no rows left after its filters reads as null, which is
    // what PostgREST's is.null and not.is.null on an embed test.
    const embedded = this.rows.map((row) => {
      const out = { ...row };
      for (const e of this.embeds) {
        const linked = (this.tables[`${this.schema}.${e.table}`] ?? []).filter(
          (child) => child[e.key] === row.id && e.filters.every((f) => f(child)),
        );
        out[e.alias] = linked.length ? linked.map((child) => ({ [e.key]: child[e.key] })) : null;
      }
      return out;
    });
    let out = embedded.filter(
      (row) =>
        this.filters.every((f) => f(row)) &&
        this.parents.every((p) =>
          (this.tables[`${this.schema}.${p.table}`] ?? []).some((parent) => parent.id === row[p.key] && p.filters.every((f) => f(parent))),
        ),
    );
    for (const { column, ascending } of [...this.sorts].reverse()) {
      out = [...out].sort((a, b) => {
        const x = String(a[column] ?? '');
        const y = String(b[column] ?? '');
        return ascending ? x.localeCompare(y) : y.localeCompare(x);
      });
    }
    // A count is of every row the filters keep, before the window cuts them.
    const count = this.counted ? out.length : null;
    if (this.window) out = out.slice(this.window[0], this.window[1] + 1);
    if (this.cap !== null) out = out.slice(0, this.cap);
    if (this.head) out = [];
    return Promise.resolve({ data: out, error: null, count }).then(onFulfilled, onRejected);
  }
}

/** More of job_search.applications' real columns, for query_rows. */
const APPLICATION_COLUMNS = [
  { table: 'job_search.applications', column: 'user_id', type: 'uuid', nullable: false },
  { table: 'job_search.applications', column: 'status', type: 'job_search.application_status', nullable: false },
  { table: 'job_search.applications', column: 'excitement', type: 'integer', nullable: true },
  { table: 'job_search.applications', column: 'next_action', type: 'text', nullable: true },
  { table: 'job_search.applications', column: 'cover_letter', type: 'text', nullable: true },
  { table: 'job_search.applications', column: 'created_at', type: 'timestamp with time zone', nullable: false },
];

/** Every rpc a lookup made, by name, with its arguments. */
type RpcCall = { fn: string; args: Record<string, unknown> };

/**
 * core.search_memory over `core.memory_chunks`, where each passage carries the
 * similarity it would have to the question (the embedder is fake, so there is
 * no vector to compare). Applies the owner, source, author, limit and floor
 * arguments the way the SQL does.
 */
function fakeRpc(tables: Tables, calls: RpcCall[], owner = false) {
  return (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn === 'is_owner' && owner) return Promise.resolve({ data: true, error: null });
    if (fn === 'ask_table_columns') {
      // What the database function returns for the names it is given; it also
      // reports a table outside the list here, to show the lookup drops it.
      return Promise.resolve({
        data: {
          columns: [
            { table: 'job_search.applications', column: 'id', type: 'uuid', nullable: false },
            { table: 'job_search.applications', column: 'role_id', type: 'uuid', nullable: false },
            ...APPLICATION_COLUMNS,
            { table: 'job_search.cover_letters', column: 'id', type: 'uuid', nullable: false },
            { table: 'job_search.roles', column: 'id', type: 'uuid', nullable: false },
          ],
          links: [
            { table: 'job_search.applications', column: 'role_id', ref_table: 'job_search.roles', ref_column: 'id' },
            { table: 'job_search.cover_letters', column: 'application_id', ref_table: 'job_search.applications', ref_column: 'id' },
            { table: 'job_search.applications', column: 'cover_letter_id', ref_table: 'job_search.cover_letters', ref_column: 'id' },
            { table: 'job_search.application_answers', column: 'application_id', ref_table: 'job_search.applications', ref_column: 'id' },
            // Not a real key: a link held in another schema, which a query cannot embed.
            { table: 'learn.watch_list', column: 'role_id', ref_table: 'job_search.roles', ref_column: 'id' },
            { table: 'job_search.applications', column: 'owner', ref_table: 'auth.users', ref_column: 'id' },
          ],
        },
        error: null,
      });
    }
    if (fn !== 'search_memory') return Promise.resolve({ data: null, error: { message: `no ${fn}` } });
    const sources = args.p_sources as string[] | null;
    const authors = args.p_authors as string[] | null;
    const data = (tables['core.memory_chunks'] ?? [])
      .filter((row) => row.user_id === args.p_user_id)
      .filter((row) => !sources || sources.includes(row.source_table as string))
      .filter((row) => !authors || authors.includes(row.author as string))
      .sort((a, b) => (b.similarity as number) - (a.similarity as number))
      .slice(0, args.match_limit as number)
      .filter((row) => (row.similarity as number) >= (args.min_similarity as number));
    return Promise.resolve({ data, error: null });
  };
}

/** The rows a relation holds; obsidian.readable_notes is the live notes that hold no credentials, as the view is. */
function relationRows(tables: Tables, schema: AskSchema, table: string): Row[] {
  if (schema === 'obsidian' && table === 'readable_notes') {
    return (tables['obsidian.notes'] ?? []).filter((row) => row.voice !== 'secret' && !row.deleted_at);
  }
  return tables[`${schema}.${table}`] ?? [];
}

function fakeDb(tables: Tables, calls: RpcCall[] = [], owner = false): AskDb {
  return async (schema: AskSchema) =>
    ({
      from: (table: string) => new FakeQuery(relationRows(tables, schema, table), tables, schema),
      rpc: fakeRpc(tables, calls, owner),
    }) as unknown as SchemaClient;
}

const ALL_MODULES: ModuleId[] = ['shopping', 'jobs', 'vault', 'todo', 'learn', 'news', 'goals', 'you', 'dev'];

function context(tables: Tables, extra: Partial<AskContext> = {}): AskContext {
  return {
    userId: ME,
    today: TODAY,
    enabledModules: ALL_MODULES,
    db: fakeDb(tables),
    searchSources: [],
    now: Date.parse(`${TODAY}T12:00:00Z`),
    ...extra,
  };
}

/** Every row a result lists opens a page in the app and belongs to the asker. */
function expectLinkedRows(result: Awaited<ReturnType<typeof executeAskTool>>) {
  expect(result.ok).toBe(true);
  if (!result.ok) return [];
  for (const row of result.rows) {
    expect(row.href).toMatch(/^\//);
    expect(row.title).toBeTruthy();
    expect(row.ref).toBeTruthy();
  }
  return result.rows;
}

describe('the tool definitions', () => {
  it('define every tool the dispatcher runs, once each, as objects with no other keys', () => {
    expect(ASK_TOOLS.map((t) => t.name)).toEqual([...ASK_TOOL_NAMES]);
    for (const tool of ASK_TOOLS) {
      expect(tool.description!.length).toBeGreaterThan(80);
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema.additionalProperties).toBe(false);
    }
  });

  it('refuse a tool that does not exist, and a workspace that is off', async () => {
    const ctx = context({}, { enabledModules: ['shopping'] });
    expect(await executeAskTool('run_sql', {}, ctx)).toEqual({
      ok: false,
      error: 'There is no tool called run_sql.',
    });
    const off = await executeAskTool('todos', {}, ctx);
    expect(off).toEqual({ ok: false, error: expect.stringContaining('Todo workspace is switched off') });
    const openOff = await executeAskTool('open_row', { table: 'obsidian.notes', ref: 'a.md' }, ctx);
    expect(openOff.ok).toBe(false);
  });
});

describe('search', () => {
  const hit = (userId: string, title: string): SearchHit => ({
    module: 'jobs',
    kind: 'company',
    id: `${userId}-company`,
    ref: `job_search.companies:${userId}-company`,
    title,
    subtitle: 'Company',
    href: `/jobs/companies/${title.toLowerCase()}`,
  });
  // A source that answers for whoever it is asked about, as RLS would.
  const source: SearchSource = {
    id: 'jobs',
    module: 'jobs',
    label: 'Job search',
    kinds: ['company'],
    find: async (ctx) => [ctx.userId === ME ? hit(ME, 'Acme') : hit(THEM, 'Acme Other')],
    list: async () => [],
  };

  it('returns the registry’s hits for the asker, each with its table and link', async () => {
    const result = await executeAskTool('search', { query: 'acme' }, context({}, { searchSources: [source] }));
    const rows = expectLinkedRows(result);
    expect(rows).toEqual([
      {
        table: 'job_search.companies',
        ref: `${ME}-company`,
        title: 'Acme',
        href: '/jobs/companies/acme',
        detail: { kind: 'Company', about: 'Company' },
      },
    ]);
    expect(citationsOf(result)).toEqual([
      { table: 'job_search.companies', ref: `${ME}-company`, title: 'Acme', href: '/jobs/companies/acme' },
    ]);
  });

  it('refuses a one-letter query', async () => {
    expect((await executeAskTool('search', { query: 'a' }, context({}))).ok).toBe(false);
  });
});

describe('open_row', () => {
  const tables: Tables = {
    'obsidian.notes': [
      { id: '11111111-1111-4111-8111-111111111111', user_id: ME, path: 'Work/Leaving.md', title: 'Leaving', body: 'Thinking about leaving my job.' },
      { id: '22222222-2222-4222-8222-222222222222', user_id: THEM, path: 'Work/Leaving.md', title: 'Theirs', body: 'Not yours.' },
    ],
    'todo.tasks': [{ id: 't1', user_id: ME, title: 'Send the form', body: 'By Friday' }],
  };

  it('opens a row by the catalogue’s ref, with its text and a link to its page', async () => {
    const result = await executeAskTool('open_row', { table: 'obsidian.notes', ref: 'Work/Leaving.md' }, context(tables));
    const rows = expectLinkedRows(result);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      table: 'obsidian.notes',
      ref: 'Work/Leaving.md',
      title: 'Leaving',
      href: '/vault/n/Work/Leaving.md',
      detail: { body: 'Thinking about leaving my job.' },
    });
  });

  it('never opens a note that holds credentials, by path or by id', async () => {
    const secret: Tables = {
      'obsidian.notes': [
        { id: '33333333-3333-4333-8333-333333333333', user_id: ME, path: 'Keys.md', title: 'Keys', body: 'password: hunter2', voice: 'secret' },
      ],
    };
    for (const ref of ['Keys.md', '33333333-3333-4333-8333-333333333333']) {
      const result = await executeAskTool('open_row', { table: 'obsidian.notes', ref }, context(secret));
      expect(result.ok && result.rows).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('hunter2');
    }
    const listed = await executeAskTool('list_rows', { table: 'obsidian.notes' }, context(secret));
    expect(JSON.stringify(listed)).not.toContain('hunter2');
  });

  it('reads a long note in parts with its line breaks, and says how to read on', async () => {
    const line = 'Checked the master comparison tab against each source and the counts agree. ';
    const body = Array.from({ length: 300 }, (_, i) => `${i}. ${line}`).join('\n');
    const long: Tables = {
      'obsidian.notes': [{ id: '44444444-4444-4444-8444-444444444444', user_id: ME, path: 'respark take home.md', title: 'respark take home', body }],
    };
    const first = await executeAskTool('open_row', { table: 'obsidian.notes', ref: 'respark take home.md' }, context(long));
    if (!first.ok) throw new Error(first.error);
    const firstBody = String(first.rows[0].detail?.body);
    expect(firstBody.length).toBeGreaterThan(6000);
    expect(firstBody).toContain('\n1. ');
    expect(first.note).toMatch(/body is part 1 of 4\. Call open_row with the same table and ref and part 2 to read on\./);

    const last = await executeAskTool('open_row', { table: 'obsidian.notes', ref: 'respark take home.md', part: 4 }, context(long));
    if (!last.ok) throw new Error(last.error);
    expect(String(last.rows[0].detail?.body)).toContain('299. ');
    expect(last.note).toContain('This is the last part.');

    const past = await executeAskTool('open_row', { table: 'obsidian.notes', ref: 'respark take home.md', part: 9 }, context(long));
    expect(past).toMatchObject({ ok: false });
  });

  it('opens a row by the id search gave it, and points a task at itself on the list', async () => {
    const byId = await executeAskTool(
      'open_row',
      { table: 'obsidian.notes', ref: '11111111-1111-4111-8111-111111111111' },
      context(tables),
    );
    expect(expectLinkedRows(byId)[0].ref).toBe('Work/Leaving.md');
    const task = await executeAskTool('open_row', { table: 'todo.tasks', ref: 't1' }, context(tables));
    expect(expectLinkedRows(task)[0].href).toBe('/todo/all?status=all&focus=t1');
  });

  it('says whether a post went up, beside its text (note 5c73c50e)', async () => {
    const posts: Tables = {
      'public.social_posts': [
        { id: 'p1', user_id: ME, angle: 'Todo, introduced', body: ['Todo is one list.'], status: 'dropped', image_paths: ['/posts/todo.png'], posted_url: null, posted_at: null, dropped_at: '2026-10-14T10:00:00Z' },
      ],
    };
    const result = await executeAskTool('open_row', { table: 'public.social_posts', ref: 'p1' }, context(posts));
    expect(expectLinkedRows(result)[0].detail).toMatchObject({ status: 'dropped', image_paths: '["/posts/todo.png"]' });
  });

  it('finds nothing of somebody else’s, even by its id', async () => {
    const result = await executeAskTool(
      'open_row',
      { table: 'obsidian.notes', ref: '22222222-2222-4222-8222-222222222222' },
      context(tables),
    );
    expect(expectLinkedRows(result)).toEqual([]);
  });

  it('carries the newest comments under the row, so a reply from Dash can be found (notes 1527e0bf, ae78d95e)', async () => {
    const note = '11111111-1111-4111-8111-111111111111';
    const withThread: Tables = {
      ...tables,
      'core.thread_turns': [
        { user_id: ME, ref: `obsidian.notes:${note}`, author: 'me', body: '@dash Help me prepare.', created_at: '2026-10-13T17:27:35Z' },
        { user_id: ME, ref: `obsidian.notes:${note}`, author: 'claude', body: 'I added a to-do.', created_at: '2026-10-13T17:28:02Z' },
        { user_id: THEM, ref: `obsidian.notes:${note}`, author: 'me', body: 'Not yours.', created_at: '2026-10-13T17:29:00Z' },
      ],
    };
    const result = await executeAskTool('open_row', { table: 'obsidian.notes', ref: 'Work/Leaving.md' }, context(withThread));
    expect(expectLinkedRows(result)[0].detail?.comments).toBe(
      '[2026-10-13 17:27] You: @dash Help me prepare.\n[2026-10-13 17:28] Dash: I added a to-do.',
    );
    const bare = await executeAskTool('open_row', { table: 'obsidian.notes', ref: 'Work/Leaving.md' }, context(tables));
    expect(expectLinkedRows(bare)[0].detail).not.toHaveProperty('comments');
  });

  it('refuses a table it cannot open', async () => {
    const result = await executeAskTool('open_row', { table: 'public.profiles', ref: ME }, context(tables));
    expect(result).toEqual({ ok: false, error: 'public.profiles is not a table that can be opened.' });
  });

  it('can open only catalogue tables that have a page', () => {
    expect(OPENABLE.length).toBeGreaterThan(10);
    for (const source of OPENABLE) expect(source.href!('x')).toMatch(/^\//);
  });
});

describe('spend_by_merchant', () => {
  const order = (id: string, userId: string, merchant: string, date: string, cents: number, extra: Row = {}) => ({
    id,
    user_id: userId,
    merchant_id: merchant,
    external_order_number: `#${id}`,
    order_date: date,
    total_cents: cents,
    currency: 'USD',
    cancelled_at: null,
    status: 'delivered',
    deleted_at: null,
    ...extra,
  });
  const tables: Tables = {
    'public.orders': [
      order('o1', ME, 'm-ebay', '2026-07-03', 2500),
      order('o2', ME, 'm-ebay', '2026-08-15', 4000),
      order('o3', ME, 'm-amazon', '2026-08-20', 1000),
      order('o4', ME, 'm-ebay', '2026-08-21', 9900, { status: 'cancelled' }),
      order('o5', ME, 'm-ebay', '2026-06-01', 7000),
      order('o6', THEM, 'm-ebay', '2026-08-01', 123456),
    ],
    'public.returns': [
      { id: 'r1', user_id: ME, order_id: 'o5', refund_amount_cents: 700, refunded_at: '2026-07-10', status: 'refunded' },
      { id: 'r2', user_id: THEM, order_id: 'o6', refund_amount_cents: 999, refunded_at: '2026-08-02', status: 'refunded' },
    ],
    'public.merchants': [
      { id: 'm-ebay', name: 'eBay' },
      { id: 'm-amazon', name: 'Amazon' },
    ],
  };

  it('totals orders placed in the period by merchant and month, the asker’s only', async () => {
    const result = await executeAskTool(
      'spend_by_merchant',
      { from: '2026-07-01', to: '2026-09-30', merchant: 'ebay' },
      context(tables),
    );
    const rows = expectLinkedRows(result);
    if (!result.ok) return;
    expect(result.totals).toMatchObject({
      orders_counted: 2,
      by_merchant: [
        {
          merchant: 'eBay',
          currency: 'USD',
          cents: 6500,
          spent: '$65.00',
          orders: 2,
          by_month: [
            { month: '2026-07', spent: '$25.00' },
            { month: '2026-08', spent: '$40.00' },
          ],
        },
      ],
      // The refund on June's order landed in July, so it counts here.
      refunds_landed_in_period: { USD: '$7.00' },
    });
    expect(rows.map((r) => r.ref)).toEqual(['m-ebay', 'o2', 'o1', 'r1']);
    expect(rows.find((r) => r.ref === 'o1')!.href).toBe('/shopping/orders/o1');
    expect(rows.find((r) => r.ref === 'r1')!.href).toBe('/shopping/orders/o5');
    expect(rows.some((r) => r.ref === 'o6' || r.ref === 'r2')).toBe(false);
  });

  it('asks for a start date', async () => {
    expect(await executeAskTool('spend_by_merchant', {}, context(tables))).toEqual({
      ok: false,
      error: 'from is required.',
    });
  });
});

describe('application_answers', () => {
  const tables: Tables = {
    'job_search.roles': [
      { id: 'r1', user_id: ME },
      { id: 'r2', user_id: ME },
      { id: 'r4', user_id: THEM },
    ],
    'job_search.applications': [
      { id: 'a1-old', user_id: ME, role_id: 'r1', attempt: 1 },
      { id: 'a1', user_id: ME, role_id: 'r1', attempt: 2 },
      { id: 'a2', user_id: ME, role_id: 'r2', attempt: 1 },
      { id: 'a4', user_id: THEM, role_id: 'r4', attempt: 1 },
    ],
    'job_search.questions': [
      { id: 'q1', user_id: ME, text: 'Why do you want to work here?' },
      { id: 'q2', user_id: ME, text: 'Describe a hard deadline.' },
      { id: 'q3', user_id: ME, text: 'Salary expectations?' },
      { id: 'q4', user_id: THEM, text: 'Their question' },
    ],
    'job_search.application_answers': [
      { id: 'n1', user_id: ME, application_id: 'a1', question_id: 'q1', answer: 'Because the work matters. '.repeat(20), status: 'draft', word_limit: 150, created_at: '2026-09-01T10:00:00Z' },
      { id: 'n2', user_id: ME, application_id: 'a1', question_id: 'q2', answer: null, status: 'approved', word_limit: null, created_at: '2026-09-01T11:00:00Z' },
      { id: 'n0', user_id: ME, application_id: 'a1-old', question_id: 'q3', answer: 'Old attempt', status: 'submitted', word_limit: null, created_at: '2026-08-01T10:00:00Z' },
      { id: 'n3', user_id: ME, application_id: 'a2', question_id: 'q3', answer: 'Negotiable,\r\n\n\n\nwithin reason', status: 'draft', word_limit: null, created_at: '2026-09-02T10:00:00Z' },
      { id: 'n4', user_id: THEM, application_id: 'a4', question_id: 'q4', answer: 'Theirs', status: 'draft', word_limit: null, created_at: '2026-09-02T10:00:00Z' },
    ],
  };

  it("lists only the role's latest application's answers, each with its question and ref", async () => {
    const result = await executeAskTool('application_answers', { role_ref: 'r1' }, context(tables));
    const rows = expectLinkedRows(result);
    expect(rows.map((r) => r.ref)).toEqual(['n1', 'n2']);
    expect(rows.map((r) => r.title)).toEqual(['Why do you want to work here?', 'Describe a hard deadline.']);
    expect(rows[0]).toMatchObject({ table: 'job_search.application_answers', href: '/jobs/roles/r1' });
    expect(rows[0].detail).toMatchObject({ status: 'draft', word_limit: 150 });
    // The whole answer, so it can be reused on another application (22 October 2026).
    expect(rows[0].detail?.answer).toBe('Because the work matters. '.repeat(20).trim());
    expect(rows[1].detail).toMatchObject({ status: 'approved', answer: null });
    expect(result.ok && result.note).not.toContain('open_row');
  });

  it('reads one application by its ref, with the table prefix accepted', async () => {
    const result = await executeAskTool('application_answers', { application_ref: 'job_search.applications:a2' }, context(tables));
    expect(expectLinkedRows(result).map((r) => r.ref)).toEqual(['n3']);
    expect(expectLinkedRows(result)[0].detail?.answer).toBe('Negotiable,\n\nwithin reason');
  });

  it("refuses another person's role and application, and a call that names neither", async () => {
    expect((await executeAskTool('application_answers', { role_ref: 'r4' }, context(tables))).ok).toBe(false);
    expect((await executeAskTool('application_answers', { application_ref: 'a4' }, context(tables))).ok).toBe(false);
    expect((await executeAskTool('application_answers', {}, context(tables))).ok).toBe(false);
  });

  it('is off with the Job search workspace', async () => {
    const off = await executeAskTool('application_answers', { role_ref: 'r1' }, context(tables, { enabledModules: ['todo'] }));
    expect(off.ok).toBe(false);
  });
});

describe('job_applications', () => {
  const app = (id: string, userId: string, role: string, status: string, submitted: string, extra: Row = {}) => ({
    id,
    user_id: userId,
    role_id: role,
    status,
    status_manual_override: null,
    submitted_at: `${submitted}T10:00:00Z`,
    closed_at: null,
    outcome: null,
    rejection_stage: null,
    rejection_stage_override: null,
    next_action: null,
    next_action_due: null,
    created_at: `${submitted}T09:00:00Z`,
    ...extra,
  });
  const tables: Tables = {
    'job_search.applications': [
      app('a1', ME, 'r1', 'submitted', '2026-08-01'),
      app('a2', ME, 'r2', 'in_process', '2026-08-05'),
      app('a3', ME, 'r3', 'rejected', '2026-07-01', { rejection_stage: 'recruiter_screen' }),
      app('a4', THEM, 'r4', 'submitted', '2026-08-01'),
    ],
    'job_search.roles': [
      { id: 'r1', user_id: ME, title: 'Analyst', company_id: 'c1' },
      { id: 'r2', user_id: ME, title: 'Controller', company_id: 'c2' },
      { id: 'r3', user_id: ME, title: 'Planner', company_id: 'c1' },
      { id: 'r4', user_id: THEM, title: 'Theirs', company_id: 'c4' },
    ],
    'job_search.companies': [
      { id: 'c1', user_id: ME, name: 'Acme', slug: 'acme' },
      { id: 'c2', user_id: ME, name: 'Globex', slug: 'globex' },
      { id: 'c4', user_id: THEM, name: 'Initech', slug: 'initech' },
    ],
    'job_search.application_events': [
      { application_id: 'a2', user_id: ME, kind: 'recruiter_reply', occurred_at: '2026-09-20T10:00:00Z' },
      { application_id: 'a1', user_id: ME, kind: 'follow_up_sent', occurred_at: '2026-09-20T10:00:00Z' },
    ],
  };

  it('counts by status and rejection stage, and links each to its role', async () => {
    const result = await executeAskTool('job_applications', {}, context(tables));
    const rows = expectLinkedRows(result);
    if (!result.ok) return;
    expect(result.totals).toEqual({
      count: 3,
      sent: 3,
      sent_without_sent_day: 0,
      by_status: { submitted: 1, in_process: 1, rejected: 1 },
      rejected_at_stage: { recruiter_screen: 1 },
    });
    expect(rows.map((r) => r.ref).sort()).toEqual(['a1', 'a2', 'a3']);
    expect(rows.find((r) => r.ref === 'a1')).toMatchObject({
      title: 'Analyst at Acme',
      href: '/jobs/roles/r1',
    });
  });

  it('counts as sent an application added by hand with no sent day, and not a lead', async () => {
    const added: Tables = {
      ...tables,
      'job_search.applications': [
        app('a1', ME, 'r1', 'submitted', '2026-10-19'),
        app('a2', ME, 'r2', 'acknowledged', '2026-10-19', { submitted_at: null }),
        app('a3', ME, 'r3', 'lead', '2026-10-19', { submitted_at: null }),
      ],
    };
    const result = await executeAskTool('job_applications', { from: '2026-10-18', to: '2026-10-22' }, context(added));
    if (!result.ok) throw new Error('lookup failed');
    expect(result.totals).toMatchObject({ count: 3, sent: 2, sent_without_sent_day: 1 });
  });

  it('finds open applications with nothing back from the company in a month', async () => {
    const result = await executeAskTool('job_applications', { quiet_for_days: 30 }, context(tables));
    const rows = expectLinkedRows(result);
    // a2 heard back last week; a1's only event is their own follow-up; a3 is closed.
    expect(rows.map((r) => r.ref)).toEqual(['a1']);
    expect(rows[0].detail).toMatchObject({ company: 'Acme', last_heard_on: null, sent_on: '2026-08-01' });
  });

  it('finds sent applications that never had a reply, for a bulk move (plan #1657)', async () => {
    const withConfirmation: Tables = {
      ...tables,
      'job_search.application_events': [
        ...(tables['job_search.application_events'] ?? []),
        // An automatic confirmation is not a reply.
        { application_id: 'a1', user_id: ME, kind: 'confirmation', occurred_at: '2026-08-01T11:00:00Z' },
      ],
    };
    const result = await executeAskTool('job_applications', { no_reply: true, to: '2026-07-31' }, context(withConfirmation));
    expect(expectLinkedRows(result).map((r) => r.ref)).toEqual(['a3']);
    const all = await executeAskTool('job_applications', { no_reply: true }, context(withConfirmation));
    expect(expectLinkedRows(all).map((r) => r.ref).sort()).toEqual(['a1', 'a3']);
  });

  it('narrows to the days sent', async () => {
    const result = await executeAskTool(
      'job_applications',
      { from: '2026-08-01', to: '2026-08-31', status: ['submitted', 'in_process'] },
      context(tables),
    );
    expect(expectLinkedRows(result).map((r) => r.ref).sort()).toEqual(['a1', 'a2']);
  });

  it('finds what moved to a status in a period, with what it was before (note 4056ed9d)', async () => {
    const lead = (id: string, role: string, created: string) =>
      app(id, ME, role, 'lead', created, { submitted_at: null, created_at: `${created}T09:00:00Z` });
    const moved: Tables = {
      ...tables,
      'job_search.applications': [
        // Moved by hand from lead to acknowledged this week.
        { ...lead('m1', 'r1', '2026-10-01'), status: 'acknowledged', status_manual_override: 'acknowledged' },
        // Already sent last month: not a change this week.
        app('m2', ME, 'r2', 'acknowledged', '2026-09-10'),
        // Still a lead.
        lead('m3', 'r3', '2026-10-01'),
      ],
      'job_search.application_events': [
        { application_id: 'm1', user_id: ME, kind: 'status_override', source: 'manual', payload: { status: 'acknowledged' }, occurred_at: '2026-10-20T18:00:00Z' },
        { application_id: 'm2', user_id: ME, kind: 'submitted', source: 'email', payload: null, occurred_at: '2026-09-10T10:00:00Z' },
        { application_id: 'm2', user_id: ME, kind: 'confirmation', source: 'email', payload: null, occurred_at: '2026-09-10T11:00:00Z' },
      ],
    };
    const result = await executeAskTool(
      'job_applications',
      { changed_status: true, from: '2026-10-16', to: '2026-10-22', status: ['submitted', 'acknowledged'] },
      context(moved, { today: '2026-10-22' }),
    );
    const rows = expectLinkedRows(result);
    expect(rows.map((r) => r.ref)).toEqual(['m1']);
    expect(rows[0].detail).toMatchObject({ status_before: 'lead', status_after: 'acknowledged' });
  });
});

describe('todos', () => {
  const task = (id: string, userId: string, status: string, extra: Row) => ({
    id,
    user_id: userId,
    title: `Task ${id}`,
    status,
    due_on: null,
    completed_at: null,
    ...extra,
  });
  const tables: Tables = {
    'todo.tasks': [
      task('t1', ME, 'done', { completed_at: '2026-09-25T18:00:00Z' }),
      task('t2', ME, 'done', { completed_at: '2026-09-01T18:00:00Z' }),
      task('t3', ME, 'open', { due_on: '2026-09-20' }),
      task('t4', ME, 'open', { due_on: '2026-09-30' }),
      task('t5', THEM, 'done', { completed_at: '2026-09-26T18:00:00Z' }),
      task('t6', THEM, 'open', { due_on: '2026-09-01' }),
    ],
    // Tags (plan #2340.4): the asker's, and one on someone else's todo that never shows.
    'todo.task_tags': [
      { task_id: 't3', tag: 'now' },
      { task_id: 't3', tag: 'errands' },
      { task_id: 't4', tag: 'home' },
      { task_id: 't6', tag: 'secret' },
    ],
  };

  it('lists what was done this week and what is overdue today, the asker’s only', async () => {
    const result = await executeAskTool('todos', {}, context(tables));
    const rows = expectLinkedRows(result);
    if (!result.ok) return;
    expect(result.totals).toEqual({
      from: '2026-09-21',
      to: TODAY,
      done: 1,
      overdue_today: 1,
      tags_in_use: ['errands', 'home', 'now'],
    });
    expect(rows.map((r) => [r.ref, r.detail?.list, r.detail?.tags])).toEqual([
      ['t1', 'done', null],
      ['t3', 'overdue', 'errands, now'],
    ]);
    expect(rows[0].href).toBe('/todo/all?status=all&focus=t1');
  });
});

describe('goal_status', () => {
  const tables: Tables = {
    'goals.items': [
      // Dated, so its on_track verdict stands: a goal with no date keeps only a met or pace verdict (plan #1738).
      { id: 'g1', user_id: ME, level: 'goal', status: 'open', title: 'Land a finance role', due_on: '2026-12-31', archived_at: null, position: 1 },
      { id: 'g2', user_id: ME, level: 'goal', status: 'proposed', title: 'Run a half', due_on: null, archived_at: null, position: 2 },
      { id: 's1', user_id: ME, level: 'step', status: 'open', title: 'A step', due_on: null, archived_at: null, position: 3 },
      { id: 'g3', user_id: THEM, level: 'goal', status: 'open', title: 'Theirs', due_on: null, archived_at: null, position: 1 },
    ],
    'goals.reviews': [
      { id: 'v1', user_id: ME, item_id: 'g1', verdict: 'on_track', reason: 'Two applications out.', next_move: 'Chase Acme', next_on: null, step_id: null, waits_on_id: null, run_id: null, created_at: '2026-09-26T06:00:00Z' },
      { id: 'v0', user_id: ME, item_id: 'g1', verdict: 'stalled', reason: 'Old.', next_move: 'x', next_on: null, step_id: null, waits_on_id: null, run_id: null, created_at: '2026-09-20T06:00:00Z' },
      { id: 'v3', user_id: THEM, item_id: 'g3', verdict: 'stalled', reason: 'Theirs.', next_move: 'x', next_on: null, step_id: null, waits_on_id: null, run_id: null, created_at: '2026-09-26T06:00:00Z' },
    ],
  };

  it('gives each open goal its newest verdict and a link to it', async () => {
    const result = await executeAskTool('goal_status', {}, context(tables));
    const rows = expectLinkedRows(result);
    expect(rows).toEqual([
      {
        table: 'goals.items',
        ref: 'g1',
        title: 'Land a finance role',
        href: '/goals/g1',
        detail: {
          status: 'open',
          due_on: '2026-12-31',
          verdict: 'On track',
          reviewed_on: '2026-09-26',
          why: 'Two applications out.',
          next_move: 'Chase Acme',
          next_on: null,
        },
      },
    ]);
  });

  it('takes in proposed goals when asked', async () => {
    const result = await executeAskTool('goal_status', { include_proposed: true }, context(tables));
    expect(expectLinkedRows(result).map((r) => [r.ref, r.detail?.verdict])).toEqual([
      ['g1', 'On track'],
      ['g2', 'Not reviewed in four weeks'],
    ]);
  });
});

describe('vault_notes', () => {
  const note = (id: string, userId: string, path: string, body: string, changed: string, extra: Row = {}) => ({
    id,
    user_id: userId,
    path,
    title: path.split('/').pop()!.replace('.md', ''),
    body,
    git_updated_at: `${changed}T12:00:00Z`,
    deleted_at: null,
    ...extra,
  });
  const tables: Tables = {
    'obsidian.notes': [
      note('n1', ME, 'Work/Next.md', 'I keep coming back to leaving my job before spring.', '2026-09-10'),
      note('n2', ME, 'Home/Garden.md', 'Plant the bulbs.', '2026-09-12'),
      note('n3', ME, 'Work/Old.md', 'Leaving my job was a thought once.', '2026-01-10', { deleted_at: '2026-02-01T00:00:00Z' }),
      note('n4', THEM, 'Work/Theirs.md', 'Leaving my job too.', '2026-09-11'),
    ],
  };

  it('finds notes by the words inside them, with an excerpt and a link', async () => {
    const result = await executeAskTool('vault_notes', { query: 'leaving job' }, context(tables));
    const rows = expectLinkedRows(result);
    expect(rows.map((r) => r.ref)).toEqual(['Work/Next.md']);
    expect(rows[0].href).toBe('/vault/n/Work/Next.md');
    expect(rows[0].detail?.excerpt).toContain('leaving my job');
  });

  it('lists notes changed in a period, newest first', async () => {
    const result = await executeAskTool('vault_notes', { from: '2026-09-01', to: '2026-09-30' }, context(tables));
    expect(expectLinkedRows(result).map((r) => r.ref)).toEqual(['Home/Garden.md', 'Work/Next.md']);
  });

  it('asks for a period or a query', async () => {
    expect((await executeAskTool('vault_notes', {}, context(tables))).ok).toBe(false);
  });
});

describe('courses', () => {
  const course = (id: string, userId: string, fields: Row) => ({
    id,
    user_id: userId,
    transcript_id: 't1',
    school: 'State University',
    code: null,
    term: null,
    year: null,
    credits: null,
    grade: null,
    position: 0,
    ...fields,
  });
  const tables: Tables = {
    'you.courses': [
      course('c1', ME, { code: 'ECON 101', title: 'Principles of Economics', term: 'Fall 2019', year: 2019, credits: '3.00', grade: 'A-' }),
      course('c2', ME, { title: 'Writing Seminar', term: 'Fall', year: 2019, credits: 1, position: 1 }),
      course('c3', ME, { code: 'ECON 201', title: 'Intermediate Micro', term: 'Spring 2020', year: 2020, position: 2 }),
      course('c4', ME, { code: 'MATH 110', title: 'Calculus I', term: 'Fall 2018', year: 2018, school: 'City College', grade: 'B' }),
      course('c5', THEM, { title: 'Their Fall 2019 course', term: 'Fall 2019', year: 2019 }),
    ],
  };

  it('lists the courses of a term, each linked to its row on the Work & school tab', async () => {
    const result = await executeAskTool('courses', { term: 'fall 2019' }, context(tables));
    const rows = expectLinkedRows(result);
    expect(rows.map((r) => r.ref)).toEqual(['c1', 'c2']);
    expect(rows[0]).toMatchObject({
      table: 'you.courses',
      title: 'ECON 101 Principles of Economics',
      href: '/you/work#course-c1',
      detail: { school: 'State University', term: 'Fall 2019', credits: 3, grade: 'A-' },
    });
    // A term written without its year is read with it.
    expect(rows[1].detail?.term).toBe('Fall 2019');
  });

  it('narrows by year, school and words of the code or title', async () => {
    const ids = async (input: Record<string, unknown>) =>
      expectLinkedRows(await executeAskTool('courses', input, context(tables))).map((r) => r.ref);
    expect(await ids({ year: 2020 })).toEqual(['c3']);
    expect(await ids({ school: 'city' })).toEqual(['c4']);
    expect(await ids({ query: 'econ' })).toEqual(['c1', 'c3']);
    expect(await ids({})).toEqual(['c4', 'c1', 'c2', 'c3']);
  });

  it('says so when nothing matched or nothing is saved', async () => {
    const none = await executeAskTool('courses', { term: 'Winter 1999' }, context(tables));
    expect(none.ok && none.rows).toEqual([]);
    if (none.ok) expect(none.note).toMatch(/None of their 4 saved courses/);
    const empty = await executeAskTool('courses', {}, context({}));
    if (empty.ok) expect(empty.note).toMatch(/No courses are saved/);
    expect((await executeAskTool('courses', { year: 'soon' }, context(tables))).ok).toBe(false);
  });

  it('needs You switched on', async () => {
    const off = await executeAskTool('courses', {}, context(tables, { enabledModules: ['jobs'] }));
    expect(off.ok).toBe(false);
  });
});

describe('recall', () => {
  const passage = (
    userId: string,
    sourceTable: string,
    sourceRef: string,
    chunkIndex: number,
    body: string,
    similarity: number,
    author: 'me' | 'dash' = 'me',
  ): Row => ({ user_id: userId, source_table: sourceTable, source_ref: sourceRef, chunk_index: chunkIndex, author, body, similarity });

  const tables: Tables = {
    'core.memory_chunks': [
      // Says what they want from the next job without the words "next job".
      passage(ME, 'obsidian.notes', 'Career/YC Jobs Application.md', 0,
        'YC Jobs Application\n\nI want to own real outcomes at a company growing fast enough that the work changes every quarter.', 0.62),
      passage(ME, 'obsidian.notes', 'Career/YC Jobs Application.md', 1,
        'YC Jobs Application\n\nIndustry matters less to me than whether the company gives real responsibility early.', 0.58),
      passage(ME, 'obsidian.notes', 'Career/YC Jobs Application.md', 2,
        'YC Jobs Application\n\nA third passage that is not shown.', 0.41),
      passage(ME, 'core.files', 'f0000000-0000-4000-8000-000000000001', 0,
        'Career options\n\nFor October, aim at the routes most likely to produce an offer in time.', 0.55, 'dash'),
      passage(ME, 'goals.items', 'a0000000-0000-4000-8000-000000000002', 0,
        'Write the target down in one sentence', 0.5),
      passage(ME, 'job_search.notes', 'b0000000-0000-4000-8000-000000000001', 0,
        'Note on Strategic Finance at Ramp\n\nThe kind of team I would take a pay cut for.', 0.48),
      passage(ME, 'job_search.interviews', 'b0000000-0000-4000-8000-000000000002', 0,
        'Interview for Strategic Finance at Ramp, round 1\n\nNotes: They want someone who owns the model end to end.', 0.46),
      passage(ME, 'learn.card_notes', 'c0000000-0000-4000-8000-000000000001', 0,
        'Note on Career capital\n\nSkills that travel matter more than the title.', 0.44),
      passage(ME, 'public.order_items', 'd0000000-0000-4000-8000-000000000001', 0,
        'Interview blazer\n\nBought Interview blazer, from Uniqlo, on 2 September 2026', 0.31),
      passage(ME, 'obsidian.notes', 'Home/Garden.md', 0, 'Garden\n\nPlant the bulbs.', 0.12),
      passage(THEM, 'obsidian.notes', 'Career/Theirs.md', 0, 'Theirs\n\nWhat the other person wants.', 0.9),
    ],
    'goals.items': [
      { id: 'a0000000-0000-4000-8000-000000000001', user_id: ME, level: 'goal', parent_id: null },
      { id: 'a0000000-0000-4000-8000-000000000003', user_id: ME, level: 'step', parent_id: 'a0000000-0000-4000-8000-000000000001' },
      { id: 'a0000000-0000-4000-8000-000000000002', user_id: ME, level: 'step', parent_id: 'a0000000-0000-4000-8000-000000000003' },
    ],
    'job_search.notes': [
      { id: 'b0000000-0000-4000-8000-000000000001', user_id: ME, role_id: 'r1', company_id: 'co1', contact_id: null },
    ],
    'job_search.interviews': [
      { id: 'b0000000-0000-4000-8000-000000000002', user_id: ME, application_id: 'ap1' },
    ],
    'job_search.applications': [{ id: 'ap1', user_id: ME, role_id: 'r1' }],
    'learn.card_notes': [{ id: 'c0000000-0000-4000-8000-000000000001', user_id: ME, concept_id: 'k1' }],
    'public.order_items': [{ id: 'd0000000-0000-4000-8000-000000000001', order_id: 'o1' }],
  };

  // The owner's Dev passages (plan #1321): an idea and a comment that say the
  // ideas list should change without the question's words, a step, a spec section.
  const IDEA = 'e0000000-0000-4000-8000-000000000001';
  const STEP = 'e0000000-0000-4000-8000-000000000002';
  const QUESTION = 'e0000000-0000-4000-8000-000000000003';
  const devTables: Tables = {
    ...tables,
    'core.memory_chunks': [
      ...(tables['core.memory_chunks'] ?? []),
      passage(ME, 'public.ideas', IDEA, 0,
        'Idea: Suggestions should be grouped by workspace\n\nSuggestions should be grouped by workspace, not one long column.', 0.66),
      passage(ME, 'public.ideas', IDEA, 1,
        'Idea: Suggestions should be grouped by workspace\n\nComment, 3 September 2026: Grouping is in plan #12.', 0.52, 'dash'),
      passage(ME, 'public.plan_items', STEP, 0, '#12 Group the suggestions\n\nDone when: grouped.', 0.6),
      passage(ME, 'public.plan_items', QUESTION, 0, '#13 Which grouping?\n\nA or B.', 0.57),
      passage(ME, 'docs.specs', 'plan#ideas', 0, 'The plan: Ideas\n\nThe tab lists what sessions suggest.', 0.59),
    ],
    'public.plan_items': [
      { id: STEP, user_id: ME, number: 12, title: 'Group the suggestions', kind: 'build', status: 'done' },
      { id: QUESTION, user_id: ME, number: 13, title: 'Which grouping?', kind: 'decision', status: 'not_started' },
    ],
  };

  async function devRecall(extra: Partial<AskContext>, owner: boolean) {
    const all: RpcCall[] = [];
    const result = await executeAskTool('recall', { question: 'where did I say the ideas list should work differently' }, {
      ...context(devTables, { embedQuestion, ...extra }),
      db: fakeDb(devTables, all, owner),
    });
    return { result, search: all.find((call) => call.fn === 'search_memory')! };
  }

  it("finds the owner's Dev text by meaning, each row linked where find_dev_text links it", async () => {
    const { result, search } = await devRecall({}, true);
    expect(search.args.p_sources).toEqual(expect.arrayContaining(['public.ideas', 'public.plan_items', 'docs.specs']));
    const rows = expectLinkedRows(result);
    const byRef = new Map(rows.map((r) => [r.ref, r]));
    expect(rows[0].ref).toBe(IDEA);
    expect(byRef.get(IDEA)?.href).toBe(`/dev/ideas#idea-${IDEA}`);
    expect(byRef.get(IDEA)?.detail?.passage_2_by).toBe('Dash');
    expect(byRef.get(STEP)?.href).toBe('/dev/plan/12');
    expect(byRef.get(QUESTION)?.href).toBe(`/dev/inbox#waiting-${QUESTION}`);
    expect(byRef.get('plan#ideas')?.href).toBe('/dev/specs/plan#ideas');
  });

  it('never asks for Dev passages for someone who is not the owner, or with Dev off', async () => {
    const notOwner = await devRecall({}, false);
    const devOff = await devRecall({ enabledModules: ['shopping', 'jobs', 'vault', 'todo', 'learn', 'news', 'goals'] }, true);
    for (const { result, search } of [notOwner, devOff]) {
      const asked = search.args.p_sources as string[];
      for (const table of ['public.ideas', 'public.feedback_items', 'public.plan_items', 'public.raised_items', 'docs.specs']) {
        expect(asked).not.toContain(table);
      }
      expect(asked).toContain('obsidian.notes');
      expect(expectLinkedRows(result).some((r) => r.table.startsWith('public.') && r.table !== 'public.order_items')).toBe(false);
    }
  });

  const asked: string[] = [];
  const embedQuestion: AskContext['embedQuestion'] = async (question) => {
    asked.push(question);
    return { ok: true, vector: new Array(1024).fill(0.01), model: 'voyage-4-lite' };
  };

  async function recall(input: Record<string, unknown>, extra: Partial<AskContext> = {}, owner = false) {
    const all: RpcCall[] = [];
    const result = await executeAskTool('recall', input, {
      ...context(tables, { embedQuestion, ...extra }),
      db: fakeDb(tables, all, owner),
    });
    // The owner check (Dev is on in these contexts) is not the search.
    const calls = all.filter((call) => call.fn !== 'is_owner');
    return { result, calls, all };
  }

  it('answers from passages across workspaces, one row each, closest first, each linked to its page', async () => {
    const { result, calls } = await recall({ question: 'what did I say I want from my next job?' });
    const rows = expectLinkedRows(result);

    expect(asked.at(-1)).toBe('what did I say I want from my next job?');
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe('search_memory');
    expect(calls[0].args.p_user_id).toBe(ME);

    expect(rows.map((r) => [r.table, r.href])).toEqual([
      ['obsidian.notes', '/vault/n/Career/YC%20Jobs%20Application.md'],
      ['core.files', '/goals/files/f0000000-0000-4000-8000-000000000001'],
      ['goals.items', '/goals/a0000000-0000-4000-8000-000000000001/s/a0000000-0000-4000-8000-000000000002'],
      ['job_search.notes', '/jobs/roles/r1'],
      ['job_search.interviews', '/jobs/roles/r1'],
      ['learn.card_notes', '/learn/c/k1'],
      ['public.order_items', '/shopping/orders/o1'],
    ]);

    const note = rows[0];
    expect(note.title).toBe('YC Jobs Application');
    expect(note.detail?.passage).toContain('own real outcomes');
    expect(note.detail?.passage_2).toContain('real responsibility early');
    expect(note.detail).not.toHaveProperty('passage_3');
    expect(note.detail?.closeness).toBe(0.62);
  });

  it("labels Dash's writing as Dash's and leaves it out when asked for the person's own", async () => {
    const both = await recall({ question: 'what did I say I want from my next job?' });
    const file = expectLinkedRows(both.result).find((r) => r.table === 'core.files')!;
    expect(file.detail?.passage_by).toBe('Dash');
    expect(expectLinkedRows(both.result)[0].detail?.passage_by).toBe('the person');
    expect(both.calls[0].args.p_authors).toBeNull();

    const mine = await recall({ question: 'what did I say I want from my next job?', only_mine: true });
    expect(mine.calls[0].args.p_authors).toEqual(['me']);
    expect(expectLinkedRows(mine.result).some((r) => r.table === 'core.files')).toBe(false);
  });

  it('never searches a switched-off workspace', async () => {
    const { result, calls } = await recall(
      { question: 'what did I say I want from my next job?' },
      { enabledModules: ['shopping', 'jobs', 'todo', 'learn', 'news', 'goals', 'dev'] },
    );
    const sources = calls[0].args.p_sources as string[];
    expect(sources).not.toContain('obsidian.notes');
    expect(sources).toContain('core.files');
    expect(expectLinkedRows(result).some((r) => r.table === 'obsidian.notes')).toBe(false);
  });

  it("never returns another person's passages, or one below the floor", async () => {
    const { result } = await recall({ question: 'what did I say I want from my next job?' });
    const refs = expectLinkedRows(result).map((r) => r.ref);
    expect(refs).not.toContain('Career/Theirs.md');
    expect(refs).not.toContain('Home/Garden.md');
  });

  it('links a transcript to its line on the Work & school tab', async () => {
    const TRANSCRIPT = 'f1000000-0000-4000-8000-000000000001';
    const courseTables: Tables = {
      'core.memory_chunks': [
        passage(ME, 'you.transcripts', TRANSCRIPT, 0,
          'Transcript from State University\n\nECON 101 Principles of Economics, Fall 2019, 3 credits, grade A-', 0.6),
      ],
    };
    const result = await executeAskTool('recall', { question: 'did I ever study economics?' }, {
      ...context(courseTables, { embedQuestion }),
    });
    const rows = expectLinkedRows(result);
    expect(rows.map((r) => [r.table, r.href])).toEqual([
      ['you.transcripts', `/you/work#transcript-${TRANSCRIPT}`],
    ]);
    expect(rows[0].detail?.passage).toContain('Principles of Economics');
  });

  it('says so when no question vector can be made', async () => {
    const { result } = await recall(
      { question: 'what have I written about land value tax?' },
      { embedQuestion: async () => ({ ok: false, reason: 'no-key', detail: 'EMBEDDING_API_KEY is not set' }) },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not set up/);
  });

  it('asks for a question', async () => {
    expect((await recall({})).result.ok).toBe(false);
    expect((await recall({ question: 'x' })).result.ok).toBe(false);
    expect((await recall({ question: 'land value tax', only_mine: 'yes' })).result.ok).toBe(false);
  });
});

describe('table_info', () => {
  it('lists every readable table with what it holds, and none outside the list', async () => {
    const result = await executeAskTool('table_info', {}, context({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tables = (result.totals as { tables: { table: string; holds: string }[] }).tables;
    expect(tables.length).toBeGreaterThan(20);
    expect(tables.map((t) => t.table)).toContain('learn.watch_list');
    expect(tables.map((t) => t.table)).not.toContain('auth.users');
    for (const t of tables) expect(t.holds.length).toBeGreaterThan(0);
  });

  it('gives one table its columns with types and the readable tables it links to and from', async () => {
    const result = await executeAskTool('table_info', { table: 'job_search.applications' }, context({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const info = result.totals as { columns: unknown[]; linksTo: unknown[]; linkedFrom: unknown[] };
    expect(info.columns.slice(0, 3)).toEqual([
      { column: 'id', type: 'uuid', nullable: false },
      { column: 'role_id', type: 'uuid', nullable: false },
      { column: 'user_id', type: 'uuid', nullable: false },
    ]);
    expect(info.linksTo).toEqual([
      { column: 'role_id', table: 'job_search.roles', toColumn: 'id' },
      { column: 'cover_letter_id', table: 'job_search.cover_letters', toColumn: 'id' },
    ]);
    expect(info.linkedFrom).toEqual([
      { table: 'job_search.cover_letters', column: 'application_id', toColumn: 'id' },
      { table: 'job_search.application_answers', column: 'application_id', toColumn: 'id' },
    ]);
  });

  it('refuses a table outside the list, and one in a workspace that is off', async () => {
    const outside = await executeAskTool('table_info', { table: 'auth.users' }, context({}));
    expect(outside).toEqual({ ok: false, error: expect.stringContaining('not a table Dash can read') });
    const off = await executeAskTool('table_info', { table: 'learn.watch_list' }, context({}, { enabledModules: ['shopping'] }));
    expect(off).toEqual({ ok: false, error: expect.stringContaining('switched off') });
    const list = await executeAskTool('table_info', {}, context({}, { enabledModules: ['shopping'] }));
    if (list.ok) {
      const names = (list.totals as { tables: { table: string }[] }).tables.map((t) => t.table);
      expect(names).not.toContain('learn.watch_list');
    }
  });
});

describe('list_rows', () => {
  const video = (userId: string, id: string, title: string, added: string, extra: Row = {}): Row => ({
    id: `${id}-row`,
    user_id: userId,
    video_id: id,
    item: { title },
    why: `Why ${title}`,
    summary: null,
    key_points: null,
    verdict: 'watch',
    watched_at: null,
    left_playlist_at: null,
    added_at: added,
    ...extra,
  });
  const tables: Tables = {
    'learn.watch_list': [
      video(ME, 'abc', 'How cities grow', '2026-10-01'),
      video(ME, 'def', 'Land value tax explained', '2026-10-05', { watched_at: '2026-10-06' }),
      video(THEM, 'ghi', 'Not theirs', '2026-10-07'),
    ],
  };

  it('reads a table no other lookup covers, newest first, named by its embedded title and linked to its page', async () => {
    const rows = expectLinkedRows(await executeAskTool('list_rows', { table: 'learn.watch_list' }, context(tables)));
    expect(rows.map((r) => [r.ref, r.title, r.href])).toEqual([
      ['def', 'Land value tax explained', '/learn/videos/def'],
      ['abc', 'How cities grow', '/learn/videos/abc'],
    ]);
    expect(rows[0].detail).toMatchObject({ why: 'Why Land value tax explained', watched_at: '2026-10-06' });
  });

  it('keeps only rows holding every word given', async () => {
    const result = await executeAskTool('list_rows', { table: 'learn.watch_list', contains: 'land tax' }, context(tables));
    expect(expectLinkedRows(result).map((r) => r.ref)).toEqual(['def']);
  });

  it('says how many matched and how many it shows, exactly, beyond the 300 it reads without words', async () => {
    const many: Row[] = Array.from({ length: 350 }, (_, i) =>
      video(ME, `v${String(i).padStart(3, '0')}`, i % 7 === 0 ? `Tax talk ${i}` : `Other ${i}`, `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`),
    );
    const big: Tables = { 'learn.watch_list': [...many, video(THEM, 'zzz', 'Not theirs', '2026-12-01')] };

    const plain = await executeAskTool('list_rows', { table: 'learn.watch_list', limit: 40 }, context(big));
    expect(plain.ok && plain.rows).toHaveLength(40);
    expect(plain.ok && plain.note).toContain('350 matched, showing 40');
    expect(plain.ok && plain.totals).toEqual({ matched: 350, shown: 40 });

    // 50 of the 350 hold "tax", some of them older than the newest 300 rows.
    const tax = await executeAskTool('list_rows', { table: 'learn.watch_list', contains: 'tax', limit: 40 }, context(big));
    expect(tax.ok && tax.rows).toHaveLength(40);
    expect(tax.ok && tax.note).toContain('50 matched, showing 40');

    const few = await executeAskTool('list_rows', { table: 'learn.watch_list', contains: 'tax talk 343' }, context(big));
    expect(few.ok && few.note).toContain('1 matched, showing all');
  });

  it('ends a small table with "showing all"', async () => {
    const result = await executeAskTool('list_rows', { table: 'learn.watch_list' }, context(tables));
    expect(result.ok && result.note).toContain('2 matched, showing all');
  });

  it('refuses a table outside the catalogue, and one whose workspace is off', async () => {
    const outside = await executeAskTool('list_rows', { table: 'auth.users' }, context(tables));
    expect(outside).toEqual({ ok: false, error: expect.stringContaining('not a table list_rows can read') });
    const off = await executeAskTool('list_rows', { table: 'learn.watch_list' }, context(tables, { enabledModules: ['shopping'] }));
    expect(off).toEqual({ ok: false, error: expect.stringContaining('Learn workspace is switched off') });
  });
});

describe('list_rows on your details (plan #2124.5)', () => {
  const tables: Tables = {
    'you.details': [
      {
        user_id: ME,
        title: 'Personal details',
        phone: '555 0100',
        linkedin_url: 'linkedin.com/in/me',
        citizenship: 'Canadian',
        race: 'Asian',
        gender: 'Woman',
        sexuality: 'Bisexual',
        updated_at: '2026-10-10',
      },
      { user_id: THEM, title: 'Personal details', phone: '555 0199', linkedin_url: null, citizenship: null, race: null, gender: null, sexuality: null, updated_at: '2026-10-11' },
    ],
  };

  it('returns the asker’s one row with all six values, named and linked, and never the other person’s', async () => {
    const rows = expectLinkedRows(await executeAskTool('list_rows', { table: 'you.details' }, context(tables)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ref: ME, title: 'Personal details', href: '/you/details' });
    expect(rows[0].detail).toMatchObject({
      phone: '555 0100',
      linkedin_url: 'linkedin.com/in/me',
      citizenship: 'Canadian',
      race: 'Asian',
      gender: 'Woman',
      sexuality: 'Bisexual',
    });
  });
});

describe('the parent of each row (plan #2109.2)', () => {
  const ROLE = '00000000-0000-4000-8000-0000000000c1';
  const APP = '00000000-0000-4000-8000-0000000000a1';
  const THEIR_APP = '00000000-0000-4000-8000-0000000000a2';
  const PAYMENT = '00000000-0000-4000-8000-0000000000b1';
  const tables: Tables = {
    'job_search.roles': [{ id: ROLE, user_id: ME, title: 'Designer at Acme', company_id: null }],
    'job_search.applications': [
      { id: APP, user_id: ME, role_id: ROLE, next_action: 'Send the follow-up' },
      { id: THEIR_APP, user_id: THEM, role_id: null, next_action: 'Not theirs' },
    ],
    'job_search.cover_letters': [
      { id: '00000000-0000-4000-8000-0000000000d1', user_id: ME, application_id: APP, body: 'Dear Acme', created_at: '2026-10-01' },
      { id: '00000000-0000-4000-8000-0000000000d2', user_id: ME, application_id: null, body: 'Loose draft', created_at: '2026-09-01' },
      { id: '00000000-0000-4000-8000-0000000000d3', user_id: THEM, application_id: THEIR_APP, body: 'Theirs', created_at: '2026-10-02' },
    ],
    'public.recurring_payments': [{ id: PAYMENT, user_id: ME, payee: 'Netflix' }],
    'public.recurring_charges': [
      { id: '00000000-0000-4000-8000-0000000000e1', user_id: ME, payment_id: PAYMENT, event: 'Charged 15.49', created_at: '2026-10-03' },
    ],
  };

  it('names a cover letter by its application, which is known by its role', async () => {
    const rows = expectLinkedRows(await executeAskTool('list_rows', { table: 'job_search.cover_letters' }, context(tables)));
    expect(rows.map((r) => [r.title, r.parent])).toEqual([
      ['Dear Acme', { table: 'job_search.applications', ref: APP, title: 'Designer at Acme', href: `/jobs/roles/${ROLE}` }],
      ['Loose draft', undefined],
    ]);
  });

  it('names a parent with no page by its title column', async () => {
    const rows = expectLinkedRows(await executeAskTool('list_rows', { table: 'public.recurring_charges' }, context(tables)));
    expect(rows[0].parent).toEqual({ table: 'public.recurring_payments', ref: PAYMENT, title: 'Netflix', href: null });
  });
});

describe('query_rows (plan #2109.4)', () => {
  const ROLE = '00000000-0000-4000-8000-0000000000c1';
  const app = (n: number, userId: string, status: string, extra: Row = {}): Row => ({
    id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
    user_id: userId,
    role_id: ROLE,
    status,
    excitement: n,
    next_action: `Next ${n}`,
    cover_letter: null,
    created_at: `2026-10-${String(n).padStart(2, '0')}`,
    ...extra,
  });
  const tables: Tables = {
    'job_search.roles': [{ id: ROLE, user_id: ME, title: 'Designer at Acme' }],
    'job_search.applications': [
      app(1, ME, 'applied', { cover_letter: 'Dear Acme' }),
      app(2, ME, 'applied', { cover_letter: '' }),
      app(3, ME, 'interviewing'),
      app(4, ME, 'to_apply', { cover_letter: 'Dear Beta' }),
      app(5, ME, 'to_apply'),
      app(6, THEM, 'applied'),
      app(7, THEM, 'to_apply'),
    ],
  };
  const run = (input: Record<string, unknown>) =>
    executeAskTool('query_rows', { table: 'job_search.applications', ...input }, context(tables));

  it("counts the person's applications by status in one call, and none of another person's", async () => {
    const result = await run({ group_by: 'status' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([]);
    expect(result.totals).toEqual({
      matched: 5,
      shown: 0,
      group_by: 'status',
      groups: [
        { value: 'applied', count: 2 },
        { value: 'to_apply', count: 2 },
        { value: 'interviewing', count: 1 },
      ],
    });
    expect(result.note).toContain('5 matched');
  });

  it('lists the applications where a chosen field is empty, counting empty text as empty', async () => {
    const result = await run({ where: [{ column: 'cover_letter', op: 'empty' }], order: { column: 'excitement', ascending: true } });
    const rows = expectLinkedRows(result);
    expect(rows.map((r) => r.title)).toEqual(['Next 2', 'Next 3', 'Next 5']);
    expect(result.ok && result.totals).toEqual({ matched: 3, shown: 3 });
    expect(result.ok && result.note).toContain('3 matched, showing all');
  });

  it('applies every condition together, and counts without listing', async () => {
    const both = await run({
      where: [
        { column: 'status', op: 'equals', value: 'to_apply' },
        { column: 'cover_letter', op: 'not_empty' },
      ],
    });
    expect(expectLinkedRows(both).map((r) => r.title)).toEqual(['Next 4']);

    const counted = await run({ where: [{ column: 'status', op: 'one_of', value: ['applied', 'interviewing'] }], count_only: true });
    expect(counted.ok && counted.rows).toEqual([]);
    expect(counted.ok && counted.totals).toEqual({ matched: 3, shown: 0 });

    const others = await run({
      where: [
        { column: 'status', op: 'not_equals', value: 'applied' },
        { column: 'excitement', op: 'greater', value: 3 },
      ],
    });
    expect(expectLinkedRows(others).map((r) => r.title)).toEqual(['Next 5', 'Next 4']);

    const words = await run({ where: [{ column: 'cover_letter', op: 'contains', value: 'beta' }], columns: ['cover_letter'] });
    expect(expectLinkedRows(words).map((r) => r.detail)).toEqual([{ cover_letter: 'Dear Beta' }]);
  });

  it('says how many matched and how many it lists when the limit cuts them', async () => {
    const result = await run({ limit: 2 });
    expect(result.ok && result.rows).toHaveLength(2);
    expect(result.ok && result.note).toContain('5 matched, showing 2');
  });

  it('hands back every matched row as a set, listed or not (plan #2472.1)', async () => {
    const ids = (ns: number[]) => ns.map((n) => app(n, ME, '').id as string);
    const cut = await run({ limit: 2 });
    expect(cut.ok && cut.matchedSet?.table).toBe('job_search.applications');
    expect(cut.ok && [...(cut.matchedSet?.refs ?? [])].sort()).toEqual(ids([1, 2, 3, 4, 5]));
    expect(cut.ok && cut.matchedSet?.matched).toBe(5);

    const counted = await run({ where: [{ column: 'status', op: 'equals', value: 'to_apply' }], count_only: true });
    expect(counted.ok && [...(counted.matchedSet?.refs ?? [])].sort()).toEqual(ids([4, 5]));

    const none = await run({ where: [{ column: 'status', op: 'equals', value: 'rejected' }] });
    expect(none.ok && none.matchedSet).toEqual({ table: 'job_search.applications', refs: [], matched: 0 });

    const grouped = await run({ group_by: 'status' });
    expect(grouped.ok && grouped.matchedSet).toBeUndefined();
  });

  it('hands back no refs when more rows matched than a set holds (plan #2472.1)', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      ...app(1, ME, 'lead'),
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    }));
    const result = await executeAskTool(
      'query_rows',
      { table: 'job_search.applications', count_only: true },
      context({ ...tables, 'job_search.applications': many }),
    );
    expect(result.ok && result.matchedSet).toEqual({ table: 'job_search.applications', refs: [], matched: 120 });
  });

  it('refuses a column the table does not have, wherever it is named', async () => {
    for (const input of [
      { where: [{ column: 'company_name', op: 'equals', value: 'Acme' }] },
      { group_by: 'company_name' },
      { columns: ['title'] },
      { order: { column: 'salary' } },
    ]) {
      expect(await run(input)).toEqual({ ok: false, error: expect.stringContaining('has no column') });
    }
    expect(await run({ where: [{ column: 'status', op: 'contains', value: 'app' }] })).toEqual({
      ok: false,
      error: expect.stringContaining('contains works on text'),
    });
    expect(await run({ where: [{ column: 'status', op: 'equals' }] })).toEqual({ ok: false, error: expect.stringContaining('needs a value') });
    expect(await run({ where: [{ column: 'status', op: 'like', value: 'x' }] })).toEqual({ ok: false, error: expect.stringContaining('needs op') });
  });

  it('refuses a table outside the catalogue, and one whose workspace is off', async () => {
    expect(await executeAskTool('query_rows', { table: 'auth.users' }, context(tables))).toEqual({
      ok: false,
      error: expect.stringContaining('not a table Dash can read'),
    });
    expect(
      await executeAskTool('query_rows', { table: 'job_search.applications' }, context(tables, { enabledModules: ['shopping'] })),
    ).toEqual({ ok: false, error: expect.stringContaining('Job search workspace is switched off') });
  });
});

describe('query_rows with linked rows (plan #2109.5)', () => {
  const ROLE = '00000000-0000-4000-8000-0000000000c1';
  const LETTER = '00000000-0000-4000-8000-0000000000d1';
  const id = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;
  const app = (n: number, userId: string, status: string, extra: Row = {}): Row => ({
    id: id(n),
    user_id: userId,
    role_id: ROLE,
    status,
    excitement: n,
    next_action: `Next ${n}`,
    cover_letter: null,
    cover_letter_id: null,
    created_at: `2026-10-${String(n).padStart(2, '0')}`,
    ...extra,
  });
  const answer = (n: number, userId: string): Row => ({ id: `answer-${n}-${userId}`, user_id: userId, application_id: id(n), answer: 'Because' });
  const tables: Tables = {
    'job_search.roles': [{ id: ROLE, user_id: ME, title: 'Designer at Acme' }],
    'job_search.applications': [
      app(1, ME, 'lead'), // nothing yet: the one the question is after
      app(2, ME, 'lead', { cover_letter: 'Dear Acme' }), // has a cover letter
      app(3, ME, 'drafting'), // has an answer to an application question
      app(4, ME, 'drafting', { cover_letter: '' }), // empty letter, and only another person's answer
      app(5, ME, 'submitted'), // sent: not to apply
      app(6, ME, 'lead', { cover_letter_id: LETTER }), // a cover letters row it points at
    ],
    'job_search.application_answers': [answer(3, ME), answer(4, THEM), answer(5, ME)],
    'job_search.cover_letters': [{ id: LETTER, user_id: ME, application_id: id(6), body: 'Dear Beta' }],
  };
  const run = (input: Record<string, unknown>) =>
    executeAskTool('query_rows', { table: 'job_search.applications', ...input }, context(tables));

  it('answers "which of my to-apply jobs have no application questions or cover letter" in one call', async () => {
    const result = await run({
      where: [
        { column: 'status', op: 'one_of', value: ['lead', 'drafting'] },
        { column: 'cover_letter', op: 'empty' },
      ],
      linked: [
        { table: 'job_search.application_answers', present: false },
        { table: 'job_search.cover_letters', via: 'application_id', present: false },
      ],
      order: { column: 'excitement', ascending: true },
    });
    const rows = expectLinkedRows(result);
    expect(rows.map((r) => r.ref)).toEqual([id(1), id(4)]);
    expect(rows.map((r) => r.parent?.title)).toEqual(['Designer at Acme', 'Designer at Acme']);
    expect(result.ok && result.totals).toEqual({ matched: 2, shown: 2 });
    expect(result.ok && result.note).toContain('no job_search.application_answers row is linked');
  });

  it('keeps the rows that have a linked row, whichever table holds the key, and counts them', async () => {
    const answered = await run({ linked: [{ table: 'job_search.application_answers', present: true }], count_only: true });
    expect(answered.ok && answered.totals).toEqual({ matched: 2, shown: 0 });

    const pointing = await run({ linked: [{ table: 'job_search.cover_letters', via: 'cover_letter_id', present: true }] });
    expect(expectLinkedRows(pointing).map((r) => r.ref)).toEqual([id(6)]);

    const grouped = await run({ linked: [{ table: 'job_search.application_answers', present: false }], group_by: 'status' });
    expect(grouped.ok && grouped.totals).toMatchObject({ matched: 4, groups: [{ value: 'lead', count: 3 }, { value: 'drafting', count: 1 }] });
  });

  it('refuses a link the table does not have, and asks which way when there are two', async () => {
    expect(await run({ linked: [{ table: 'job_search.contacts', present: false }] })).toEqual({
      ok: false,
      error: expect.stringContaining(
        'not linked to job_search.contacts. Its links: job_search.roles via role_id, job_search.cover_letters via cover_letter_id, job_search.cover_letters via application_id, job_search.application_answers via application_id.',
      ),
    });
    expect(await run({ linked: [{ table: 'job_search.cover_letters', present: false }] })).toEqual({
      ok: false,
      error: expect.stringContaining('more than one way; give via, one of: cover_letter_id, application_id'),
    });
    expect(await run({ linked: [{ table: 'job_search.application_answers' }] })).toEqual({
      ok: false,
      error: expect.stringContaining('needs present'),
    });
    expect(
      await executeAskTool(
        'query_rows',
        { table: 'job_search.roles', linked: [{ table: 'learn.watch_list', present: true }] },
        context(tables),
      ),
    ).toEqual({ ok: false, error: expect.stringContaining('learn.watch_list is in another schema') });
  });
});
