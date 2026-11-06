import { describe, expect, it } from 'vitest';
import type { AskContext, AskRow } from '@/lib/ask/db';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import {
  activeWatchOf,
  diffWatchRows,
  mergeDue,
  pausedMessage,
  rowFingerprint,
  runDueWatches,
  commitWatchRuns,
  watchRunDue,
  WATCH_PAUSED_RULE,
  type ActiveWatch,
} from './advisor-watch-run';
import { dueBriefLines, type DuePerson } from './reach-out-due';

const NOW = Date.parse('2026-11-06T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const row = (ref: string, title: string, body = 'x'): AskRow => ({ table: 'public.notes', ref, title, href: '/', detail: { body } });

function watch(over: Partial<ActiveWatch> = {}): ActiveWatch {
  return {
    id: 'w1',
    advisorId: 'a1',
    key: 'custom_sister_abc123',
    about: 'Vault notes that mention your sister',
    query: { table: 'public.notes', where: [{ column: 'body', op: 'contains', value: 'Anna' }], limit: 50 },
    everyDays: 1,
    mode: 'each',
    failures: 0,
    lastRunAt: ago(DAY),
    seen: {},
    ...over,
  };
}

describe('activeWatchOf', () => {
  it('reads a row and drops one without a query table', () => {
    const w = activeWatchOf({
      id: 'w1',
      advisor_id: 'a1',
      key: 'custom_x',
      about: 'X',
      query: { table: 'public.notes', limit: 50 },
      every_days: 7,
      mode: 'roundup',
      failures: 2,
      last_run_at: null,
      seen: { n1: 'abc', n2: 3 },
    });
    expect(w).toMatchObject({ everyDays: 7, mode: 'roundup', failures: 2, lastRunAt: null, seen: { n1: 'abc' } });
    expect(activeWatchOf({ id: 'w', advisor_id: 'a', key: 'k', query: {}, every_days: 1 })).toBeNull();
  });
});

describe('watchRunDue', () => {
  it('is due when never run or when the cadence has passed, with the slack', () => {
    expect(watchRunDue({ everyDays: 1, lastRunAt: null }, NOW)).toBe(true);
    expect(watchRunDue({ everyDays: 1, lastRunAt: ago(DAY - 60 * 60 * 1000) }, NOW)).toBe(true);
    expect(watchRunDue({ everyDays: 7, lastRunAt: ago(2 * DAY) }, NOW)).toBe(false);
  });
});

describe('diffWatchRows', () => {
  it('lists nothing on the first run and keeps every row as seen', () => {
    const out = diffWatchRows(watch({ lastRunAt: null }), [row('n1', 'One'), row('n2', 'Two')]);
    expect(out.candidates).toEqual([]);
    expect(Object.keys(out.seen)).toEqual(['n1', 'n2']);
  });

  it('lists only new and changed rows, marking the changed', () => {
    const seen = { n1: rowFingerprint(row('n1', 'One')), n2: rowFingerprint(row('n2', 'Two')) };
    const out = diffWatchRows(watch({ seen }), [row('n1', 'One'), row('n2', 'Two', 'edited'), row('n3', 'Three')]);
    expect(out.candidates.map((c) => [c.ref, c.changed ?? false])).toEqual([
      ['n2', true],
      ['n3', false],
    ]);
    expect(out.seen.n2).toBe(rowFingerprint(row('n2', 'Two', 'edited')));
  });

  it('lists nothing when nothing is new', () => {
    const seen = { n1: rowFingerprint(row('n1', 'One')) };
    expect(diffWatchRows(watch({ seen }), [row('n1', 'One')]).candidates).toEqual([]);
  });

  it('keeps rows past the cap unseen so they come up next time', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`n${i}`, `Row ${i}`));
    const out = diffWatchRows(watch({ seen: { old: 'zz' } }), rows);
    expect(out.candidates).toHaveLength(6);
    expect(Object.keys(out.seen)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5']);
  });
});

describe('the brief', () => {
  it('lists a custom watch with its changed rows beside a rule watch', () => {
    const rule: DuePerson = {
      advisorId: 'a1',
      key: 'cfo',
      name: 'The CFO',
      watches: [{ key: 'spend', about: 'Big spends', mode: 'roundup', form: null, everyDays: 7, repeatAfterDays: null, candidates: [{ table: 'money.transactions', ref: 't1', title: 'Rent', at: null }] }],
    };
    const custom: DuePerson = {
      advisorId: 'a1',
      key: 'cfo',
      name: 'The CFO',
      watches: [{ key: 'custom_sister_abc', about: 'Notes on Anna', mode: 'each', form: null, everyDays: 1, repeatAfterDays: null, custom: true, candidates: [{ table: 'public.notes', ref: 'n2', title: 'Anna visit', at: null, changed: true }] }],
    };
    const merged = mergeDue([rule], [custom]);
    expect(merged).toHaveLength(1);
    const lines = dueBriefLines(merged);
    expect(lines).toContain('  - watch custom_sister_abc [each, every 1 days, new or changed since its last run]: Notes on Anna');
    expect(lines).toContain('    - public.notes n2 | Anna visit (changed)');
  });
});

describe('pausedMessage', () => {
  it('says what stopped and why', () => {
    const text = pausedMessage('Vault notes that mention your sister.', 'public.notes refused the query: column body does not exist.');
    expect(text).toContain('Vault notes that mention your sister.');
    expect(text).toContain('3 times in a row');
    expect(text).toContain('column body does not exist.');
  });
});

// ---------------------------------------------------------------------------
// A fake you client: enough of PostgREST's builder for these reads and writes.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function fakeYou(tables: Record<string, Row[]>) {
  const writes: { table: string; op: 'update' | 'insert'; values: Row; filters: [string, unknown][] }[] = [];
  const client = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let op: 'select' | 'update' | 'insert' = 'select';
      let values: Row = {};
      const result = () => {
        const rows = (tables[table] ??= []);
        if (op === 'insert') {
          const made = { id: `${table}-${rows.length + 1}`, ...values };
          rows.push(made);
          writes.push({ table, op, values, filters });
          return [made];
        }
        const match = rows.filter((r) => filters.every(([c, v]) => (Array.isArray(v) ? v.includes(r[c]) : r[c] === v)));
        if (op === 'update') {
          for (const r of match) Object.assign(r, values);
          writes.push({ table, op, values, filters: [...filters] });
        }
        return match;
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (v: Row) => ((op = 'update'), (values = v), builder),
        insert: (v: Row) => ((op = 'insert'), (values = v), builder),
        eq: (c: string, v: unknown) => (filters.push([c, v]), builder),
        in: (c: string, v: unknown[]) => (filters.push([c, v]), builder),
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
        single: async () => ({ data: result()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: result(), error: null }),
      };
      return builder;
    },
  };
  return { you: client as unknown as YouSupabaseClient, writes, tables };
}

const ASK = { userId: 'u1', today: '2026-11-06', enabledModules: [], db: async () => ({}), searchSources: [] } as unknown as AskContext;

function watchRow(over: Row = {}): Row {
  return {
    id: 'w1',
    user_id: 'u1',
    advisor_id: 'a1',
    key: 'custom_sister_abc123',
    about: 'Vault notes that mention your sister',
    query: { table: 'public.notes', limit: 50 },
    every_days: 1,
    mode: 'each',
    status: 'active',
    failures: 0,
    last_run_at: ago(DAY),
    seen: { n1: rowFingerprint(row('n1', 'One')) },
    ...over,
  };
}

const ADVISOR = { id: 'a1', user_id: 'u1', key: 'jerwyn', name: 'Jerwyn the Elder', active: true };

describe('runDueWatches', () => {
  it('hands a new match to the round and keeps its run only once the round starts', async () => {
    const { you, tables } = fakeYou({ advisor_watches: [watchRow()], board_advisors: [ADVISOR] });
    const out = await runDueWatches({ you, ask: ASK, userId: 'u1', unreadBy: new Set(), now: NOW, run: async () => ({ rows: [row('n1', 'One'), row('n2', 'Anna came by')] }) });
    expect(out.due).toHaveLength(1);
    expect(out.due[0]).toMatchObject({ name: 'Jerwyn the Elder', key: 'jerwyn' });
    expect(out.due[0].watches[0].candidates.map((c) => c.ref)).toEqual(['n2']);
    expect(tables.advisor_watches[0].last_run_at).toBe(ago(DAY));
    await commitWatchRuns(you, 'u1', out.pending);
    expect(Object.keys(tables.advisor_watches[0].seen as Row)).toEqual(['n1', 'n2']);
    expect(tables.advisor_watches[0].last_run_at).toBe(new Date(NOW).toISOString());
  });

  it('sends nothing when nothing is new, and keeps the run at once', async () => {
    const { you, tables } = fakeYou({ advisor_watches: [watchRow()], board_advisors: [ADVISOR] });
    const out = await runDueWatches({ you, ask: ASK, userId: 'u1', unreadBy: new Set(), now: NOW, run: async () => ({ rows: [row('n1', 'One')] }) });
    expect(out.due).toEqual([]);
    expect(out.pending).toEqual([]);
    expect(tables.advisor_watches[0].last_run_at).toBe(new Date(NOW).toISOString());
  });

  it('holds back a mentor with an unread text, keeping the rows new', async () => {
    const { you, tables } = fakeYou({ advisor_watches: [watchRow()], board_advisors: [ADVISOR] });
    const out = await runDueWatches({ you, ask: ASK, userId: 'u1', unreadBy: new Set(['a1']), now: NOW, run: async () => ({ rows: [row('n2', 'New')] }) });
    expect(out).toMatchObject({ due: [], pending: [], heldBack: 1 });
    expect(tables.advisor_watches[0].last_run_at).toBe(ago(DAY));
  });

  it('skips a watch not yet due', async () => {
    const { you } = fakeYou({ advisor_watches: [watchRow({ every_days: 7 })], board_advisors: [ADVISOR] });
    let ran = false;
    await runDueWatches({ you, ask: ASK, userId: 'u1', unreadBy: new Set(), now: NOW, run: async () => ((ran = true), { rows: [] }) });
    expect(ran).toBe(false);
  });

  it('counts a failure, and pauses the watch with a message on the third', async () => {
    const failing = async () => {
      throw new Error('public.notes refused the query: column body does not exist.');
    };
    const once = fakeYou({ advisor_watches: [watchRow()], board_advisors: [ADVISOR] });
    await runDueWatches({ you: once.you, ask: ASK, userId: 'u1', unreadBy: new Set(), now: NOW, run: failing });
    expect(once.tables.advisor_watches[0]).toMatchObject({ failures: 1, status: 'active', last_error: expect.stringContaining('does not exist') });
    expect(once.tables.advisor_messages ?? []).toEqual([]);

    const third = fakeYou({ advisor_watches: [watchRow({ failures: 2 })], board_advisors: [ADVISOR], advisor_chats: [{ id: 'c1', user_id: 'u1', advisor_id: 'a1' }] });
    const out = await runDueWatches({ you: third.you, ask: ASK, userId: 'u1', unreadBy: new Set(), now: NOW, run: failing });
    expect(out.paused).toBe(1);
    expect(third.tables.advisor_watches[0]).toMatchObject({ failures: 3, status: 'paused' });
    expect(third.tables.advisor_messages).toHaveLength(1);
    expect(third.tables.advisor_messages[0]).toMatchObject({ chat_id: 'c1', role: 'advisor', kind: 'text_first', text_rule: WATCH_PAUSED_RULE });
    expect(String(third.tables.advisor_messages[0].text)).toContain('stopped checking');
  });
});
