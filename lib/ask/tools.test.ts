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
class FakeQuery implements PromiseLike<{ data: Row[]; error: null }> {
  private filters: Filter[] = [];
  private sorts: { column: string; ascending: boolean }[] = [];
  private cap: number | null = null;

  constructor(private readonly rows: Row[]) {}

  select() {
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
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
  lt(column: string, value: string) {
    this.filters.push((row) => row[column] != null && String(row[column]) < value);
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
  then<A = { data: Row[]; error: null }, B = never>(
    onFulfilled?: ((value: { data: Row[]; error: null }) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    let out = this.rows.filter((row) => this.filters.every((f) => f(row)));
    for (const { column, ascending } of [...this.sorts].reverse()) {
      out = [...out].sort((a, b) => {
        const x = String(a[column] ?? '');
        const y = String(b[column] ?? '');
        return ascending ? x.localeCompare(y) : y.localeCompare(x);
      });
    }
    if (this.cap !== null) out = out.slice(0, this.cap);
    return Promise.resolve({ data: out, error: null }).then(onFulfilled, onRejected);
  }
}

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

function fakeDb(tables: Tables, calls: RpcCall[] = [], owner = false): AskDb {
  return async (schema: AskSchema) =>
    ({
      from: (table: string) => new FakeQuery(tables[`${schema}.${table}`] ?? []),
      rpc: fakeRpc(tables, calls, owner),
    }) as unknown as SchemaClient;
}

const ALL_MODULES: ModuleId[] = ['shopping', 'jobs', 'vault', 'todo', 'learn', 'news', 'goals', 'dev'];

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

  it('finds nothing of somebody else’s, even by its id', async () => {
    const result = await executeAskTool(
      'open_row',
      { table: 'obsidian.notes', ref: '22222222-2222-4222-8222-222222222222' },
      context(tables),
    );
    expect(expectLinkedRows(result)).toEqual([]);
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
      by_status: { submitted: 1, in_process: 1, rejected: 1 },
      rejected_at_stage: { recruiter_screen: 1 },
    });
    expect(rows.map((r) => r.ref).sort()).toEqual(['a1', 'a2', 'a3']);
    expect(rows.find((r) => r.ref === 'a1')).toMatchObject({
      title: 'Analyst at Acme',
      href: '/jobs/roles/r1',
    });
  });

  it('finds open applications with nothing back from the company in a month', async () => {
    const result = await executeAskTool('job_applications', { quiet_for_days: 30 }, context(tables));
    const rows = expectLinkedRows(result);
    // a2 heard back last week; a1's only event is their own follow-up; a3 is closed.
    expect(rows.map((r) => r.ref)).toEqual(['a1']);
    expect(rows[0].detail).toMatchObject({ company: 'Acme', last_heard_on: null, sent_on: '2026-08-01' });
  });

  it('narrows to the days sent', async () => {
    const result = await executeAskTool(
      'job_applications',
      { from: '2026-08-01', to: '2026-08-31', status: ['submitted', 'in_process'] },
      context(tables),
    );
    expect(expectLinkedRows(result).map((r) => r.ref).sort()).toEqual(['a1', 'a2']);
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
  };

  it('lists what was done this week and what is overdue today, the asker’s only', async () => {
    const result = await executeAskTool('todos', {}, context(tables));
    const rows = expectLinkedRows(result);
    if (!result.ok) return;
    expect(result.totals).toEqual({ from: '2026-09-21', to: TODAY, done: 1, overdue_today: 1 });
    expect(rows.map((r) => [r.ref, r.detail?.list])).toEqual([
      ['t1', 'done'],
      ['t3', 'overdue'],
    ]);
    expect(rows[0].href).toBe('/todo/all?status=all&focus=t1');
  });
});

describe('goal_status', () => {
  const tables: Tables = {
    'goals.items': [
      { id: 'g1', user_id: ME, level: 'goal', status: 'open', title: 'Land a finance role', due_on: null, archived_at: null, position: 1 },
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
          due_on: null,
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
    'obsidian.courses': [
      course('c1', ME, { code: 'ECON 101', title: 'Principles of Economics', term: 'Fall 2019', year: 2019, credits: '3.00', grade: 'A-' }),
      course('c2', ME, { title: 'Writing Seminar', term: 'Fall', year: 2019, credits: 1, position: 1 }),
      course('c3', ME, { code: 'ECON 201', title: 'Intermediate Micro', term: 'Spring 2020', year: 2020, position: 2 }),
      course('c4', ME, { code: 'MATH 110', title: 'Calculus I', term: 'Fall 2018', year: 2018, school: 'City College', grade: 'B' }),
      course('c5', THEM, { title: 'Their Fall 2019 course', term: 'Fall 2019', year: 2019 }),
    ],
  };

  it('lists the courses of a term, each linked to its row on the Education tab', async () => {
    const result = await executeAskTool('courses', { term: 'fall 2019' }, context(tables));
    const rows = expectLinkedRows(result);
    expect(rows.map((r) => r.ref)).toEqual(['c1', 'c2']);
    expect(rows[0]).toMatchObject({
      table: 'obsidian.courses',
      title: 'ECON 101 Principles of Economics',
      href: '/vault/education#course-c1',
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

  it('needs the vault switched on', async () => {
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
    expect(byRef.get(STEP)?.href).toBe('/dev/plan?view=all&q=%2312');
    expect(byRef.get(QUESTION)?.href).toBe(`/dev/raised#waiting-${QUESTION}`);
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

  it('links a transcript to its line on the Education tab', async () => {
    const TRANSCRIPT = 'f1000000-0000-4000-8000-000000000001';
    const courseTables: Tables = {
      'core.memory_chunks': [
        passage(ME, 'obsidian.transcripts', TRANSCRIPT, 0,
          'Transcript from State University\n\nECON 101 Principles of Economics, Fall 2019, 3 credits, grade A-', 0.6),
      ],
    };
    const result = await executeAskTool('recall', { question: 'did I ever study economics?' }, {
      ...context(courseTables, { embedQuestion }),
    });
    const rows = expectLinkedRows(result);
    expect(rows.map((r) => [r.table, r.href])).toEqual([
      ['obsidian.transcripts', `/vault/education#transcript-${TRANSCRIPT}`],
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
