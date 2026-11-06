import { describe, expect, it } from 'vitest';
import { decideAdviceRun } from './council';
import {
  CANDIDATES_PER_WATCH,
  dueBriefLines,
  dueSummary,
  dueWatchesOf,
  namedLately,
  readWatchRows,
  watchClock,
  watchReaderFor,
  type SchemaReader,
  type CandidateRow,
  type RulePerson,
  type SentRef,
} from './reach-out-due';
import { REACH_OUT_TABLES } from './reach-out-make';
import type { ReachOutRule, ReachOutWatch } from './reach-out-rule';

const DAY = 24 * 60 * 60 * 1000;
// A Monday morning round.
const MONDAY = Date.parse('2026-11-02T09:00:00Z');
const at = (ms: number) => new Date(ms).toISOString();

const roundup: ReachOutWatch = {
  key: 'replies',
  about: 'Rejections and replies from companies',
  tables: ['job_search.applications'],
  mode: 'roundup',
  every_days: 7,
  repeat_after_days: null,
  form: 'bubbles',
};

const pick: ReachOutWatch = {
  key: 'contact',
  about: 'One person to contact',
  tables: ['job_search.contacts'],
  mode: 'pick',
  every_days: 7,
  repeat_after_days: 90,
};

const row = (table: string, ref: string, when: number): CandidateRow => ({ table, ref, title: `Row ${ref}`, at: at(when) });
const sent = (watchKey: string, refTable: string, refId: string, when: number): SentRef => ({
  watchKey,
  refTable,
  refId,
  sentAt: at(when),
});

function person(rule: ReachOutRule, unread = false): RulePerson {
  return { advisorId: 'hm', key: 'hiring_manager', name: 'The hiring manager', rule, unread };
}

describe("a watch's cadence", () => {
  it('is due at once when it has never sent', () => {
    expect(watchClock(roundup, [], MONDAY).due).toBe(true);
  });

  it('is not due again until its days have passed', () => {
    const lastMonday = [sent('replies', 'job_search.applications', 'a', MONDAY - 7 * DAY)];
    expect(watchClock(roundup, lastMonday, MONDAY - 3 * DAY).due).toBe(false);
    expect(watchClock(roundup, lastMonday, MONDAY - DAY).due).toBe(false);
    expect(watchClock(roundup, lastMonday, MONDAY).due).toBe(true);
  });

  it("counts a round that fires an hour early on its day as the day's", () => {
    const lastMonday = [sent('replies', 'job_search.applications', 'a', MONDAY - 7 * DAY)];
    expect(watchClock(roundup, lastMonday, MONDAY - 60 * 60 * 1000).due).toBe(true);
  });

  it('runs each watch on its own clock', () => {
    const daily: ReachOutWatch = { ...roundup, key: 'roles', mode: 'each', every_days: 1 };
    const log = [sent('replies', 'job_search.applications', 'a', MONDAY - DAY)];
    expect(watchClock(daily, log, MONDAY).due).toBe(true);
    expect(watchClock(roundup, log, MONDAY).due).toBe(false);
  });

  it('reads rows since its last text, or since its cadence on a first run, and any row for a pick', () => {
    const log = [sent('replies', 'job_search.applications', 'a', MONDAY - 8 * DAY)];
    expect(watchClock(roundup, log, MONDAY).since).toBe(at(MONDAY - 8 * DAY));
    expect(watchClock(roundup, [], MONDAY).since).toBe(at(MONDAY - 7 * DAY));
    expect(watchClock(pick, [], MONDAY).since).toBeNull();
  });
});

describe('the no-repeat window', () => {
  const contact = { table: 'job_search.contacts', ref: 'c1' };

  it('holds a row named inside the window, by any of their watches', () => {
    const log = [sent('other_watch', 'job_search.contacts', 'c1', MONDAY - 30 * DAY)];
    expect(namedLately(contact, pick, log, MONDAY)).toBe(true);
  });

  it('lets a row be named again once the window has passed', () => {
    const log = [sent('contact', 'job_search.contacts', 'c1', MONDAY - 91 * DAY)];
    expect(namedLately(contact, pick, log, MONDAY)).toBe(false);
  });

  it('never repeats a row when the window is never', () => {
    const log = [sent('replies', 'job_search.contacts', 'c1', MONDAY - 3000 * DAY)];
    expect(namedLately(contact, { repeat_after_days: null }, log, MONDAY)).toBe(true);
  });

  it('tells rows of different tables apart', () => {
    const log = [sent('contact', 'job_search.roles', 'c1', MONDAY - DAY)];
    expect(namedLately(contact, pick, log, MONDAY)).toBe(false);
  });
});

describe("a person's due watches", () => {
  const rule: ReachOutRule = { version: 1, watches: [roundup, pick] };

  it('names only rows that are new and not named before', () => {
    const log = [
      sent('replies', 'job_search.applications', 'old', MONDAY - 7 * DAY),
      sent('contact', 'job_search.contacts', 'c1', MONDAY - 7 * DAY),
    ];
    const rows: Record<string, CandidateRow[]> = {
      replies: [
        row('job_search.applications', 'new', MONDAY - DAY),
        row('job_search.applications', 'old', MONDAY - 8 * DAY),
      ],
      contact: [row('job_search.contacts', 'c1', MONDAY - 100 * DAY), row('job_search.contacts', 'c2', MONDAY - 200 * DAY)],
    };
    const due = dueWatchesOf({ person: person(rule), sent: log, rowsFor: (w) => rows[w.key], now: MONDAY });
    expect(due.map((w) => [w.key, w.candidates.map((c) => c.ref)])).toEqual([
      ['replies', ['new']],
      ['contact', ['c2']],
    ]);
  });

  it('is not due when nothing is left to say', () => {
    const log = [sent('contact', 'job_search.contacts', 'c1', MONDAY - 7 * DAY)];
    const due = dueWatchesOf({
      person: person({ version: 1, watches: [pick] }),
      sent: log,
      rowsFor: () => [row('job_search.contacts', 'c1', MONDAY - 100 * DAY)],
      now: MONDAY,
    });
    expect(due).toEqual([]);
  });

  it('is due with nothing new when they asked for a summary either way (plan #3030.3)', () => {
    const daily: ReachOutWatch = { ...roundup, key: 'news', kind: 'news_issues', tables: ['news.issues'], every_days: 1, always: true };
    const due = dueWatchesOf({ person: person({ version: 1, watches: [daily] }), sent: [], rowsFor: () => [], now: MONDAY });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ key: 'news', always: true });
    expect(due[0].candidates).toEqual([
      { table: 'news.issues', ref: 'nothing_new:2026-11-02', title: expect.stringMatching(/^Nothing new/), at: null },
    ]);
    expect(dueBriefLines([{ advisorId: 'n', key: 'newt', name: 'Newt', watches: due }]).join('\n')).toContain(
      'send even when nothing is new',
    );
    // Recorded like any row, it moves the clock on to the next day.
    const next = dueWatchesOf({
      person: person({ version: 1, watches: [daily] }),
      sent: [sent('news', 'news.issues', 'nothing_new:2026-11-02', MONDAY)],
      rowsFor: () => [],
      now: MONDAY + 2 * 60 * 60 * 1000,
    });
    expect(next).toEqual([]);
  });

  it('lists at most a handful of rows per watch', () => {
    const many = Array.from({ length: 20 }, (_, i) => row('job_search.applications', `r${i}`, MONDAY - 60_000 * (i + 1)));
    const [watch] = dueWatchesOf({
      person: person({ version: 1, watches: [roundup] }),
      sent: [],
      rowsFor: () => many,
      now: MONDAY,
    });
    expect(watch.candidates).toHaveLength(CANDIDATES_PER_WATCH);
  });

  it('speaks on Mondays only over a week of daily rounds', () => {
    const log: SentRef[] = [];
    const spoke: string[] = [];
    const rows = (now: number) => [row('job_search.applications', `app-${now}`, now - 60 * 60 * 1000)];
    for (let d = 0; d < 15; d++) {
      const now = MONDAY + d * DAY + (d % 3) * 60 * 60 * 1000 - 30 * 60 * 1000;
      const due = dueWatchesOf({ person: person({ version: 1, watches: [roundup] }), sent: log, rowsFor: () => rows(now), now });
      if (due.length === 0) continue;
      spoke.push(new Date(now).toISOString().slice(0, 10));
      for (const c of due[0].candidates) log.push(sent('replies', c.table, c.ref, now));
    }
    expect(spoke).toEqual(['2026-11-02', '2026-11-09', '2026-11-16']);
  });
});

describe('a cap holding a due person back', () => {
  const rule: ReachOutRule = { version: 1, watches: [roundup] };
  const rows = () => [row('job_search.applications', 'a1', MONDAY - DAY)];

  it('leaves them out of the round while they have an unread text', () => {
    const watches = dueWatchesOf({ person: person(rule), sent: [], rowsFor: rows, now: MONDAY });
    expect(dueSummary([{ ...person(rule, true), watches }])).toEqual({ due: [], heldBack: 1 });
  });

  it('keeps them due the next day, since nothing was written for them', () => {
    const tuesday = MONDAY + DAY;
    const watches = dueWatchesOf({ person: person(rule), sent: [], rowsFor: rows, now: tuesday });
    const { due } = dueSummary([{ ...person(rule), watches }]);
    expect(due.map((p) => p.watches[0].candidates[0].ref)).toEqual(['a1']);
  });

  it('starts no round on a due person alone while the day is capped', () => {
    expect(decideAdviceRun({ now: MONDAY, latest: null, unread: 0, writtenToday: 3, free: 0, due: 1 }).start).toBe(false);
    expect(decideAdviceRun({ now: MONDAY, latest: null, unread: 6, writtenToday: 0, free: 0, due: 1 }).start).toBe(false);
    expect(decideAdviceRun({ now: MONDAY, latest: null, unread: 0, writtenToday: 0, free: 0, due: 1, quiet: true }).start).toBe(false);
  });
});

describe('the round with rules', () => {
  const base = { now: MONDAY, latest: null, unread: 0, writtenToday: 0 };

  it('starts for a due person when nobody else is free', () => {
    expect(decideAdviceRun({ ...base, free: 0, due: 1 })).toEqual({ start: true });
  });

  it('does not start when everyone has a rule and nobody is due', () => {
    expect(decideAdviceRun({ ...base, free: 0, due: 0 }).start).toBe(false);
  });

  it('runs as before for people with no rule', () => {
    expect(decideAdviceRun({ ...base, free: 16 })).toEqual({ start: true });
    expect(decideAdviceRun({ ...base, free: 16, due: 0 })).toEqual({ start: true });
    expect(decideAdviceRun({ ...base, free: 0 }).start).toBe(false);
  });

  it('lists each due person in the brief with the rows they may name', () => {
    const lines = dueBriefLines([
      {
        advisorId: 'hm',
        key: 'hiring_manager',
        name: 'The hiring manager',
        watches: [
          {
            key: 'replies',
            about: 'Rejections and replies',
            mode: 'roundup',
            form: 'bubbles',
            everyDays: 7,
            repeatAfterDays: null,
            candidates: [row('job_search.applications', 'a1', MONDAY - DAY)],
          },
        ],
      },
    ]);
    expect(lines).toEqual([
      'Due by their own rule (plan #2931.5); see A3:',
      '- The hiring manager (hiring_manager, advisor hm)',
      '  - watch replies [roundup, bubbles, every 7 days, never repeat]: Rejections and replies',
      '    - job_search.applications a1 | Row a1',
    ]);
    expect(dueBriefLines([])).toEqual([]);
  });
});

/** A PostgREST stand-in that records each call and returns the rows given. */
function fakeDb(rows: Record<string, unknown>[]) {
  const calls: { schema: string; from: string; ops: [string, ...unknown[]][] } = { schema: '', from: '', ops: [] };
  const query: Record<string, unknown> = {};
  for (const op of ['select', 'eq', 'neq', 'is', 'gt', 'order']) {
    query[op] = (...args: unknown[]) => {
      calls.ops.push([op, ...args]);
      return query;
    };
  }
  query.limit = async (...args: unknown[]) => {
    calls.ops.push(['limit', ...args]);
    return { data: rows, error: null };
  };
  const db = ((schema: string) => {
    calls.schema = schema;
    return {
      from: (name: string) => {
        calls.from = name;
        return query;
      },
    };
  }) as unknown as SchemaReader;
  return { db, calls };
}

describe('reading the tables a rule watches', () => {
  it('has a reader for every table a rule may watch', () => {
    const missing = REACH_OUT_TABLES.map((t) => t.table).filter((t) => watchReaderFor(t) === null);
    expect(missing).toEqual([]);
  });

  it.each([
    ['job_search.suggestions', 'job_search', 'suggestions', 'headline', 'created_at', ['neq', 'status', 'dismissed']],
    ['you.insights', 'you', 'insights', 'claim', 'created_at', ['eq', 'status', 'shown']],
    ['goals.items', 'goals', 'items', 'title', 'updated_at', ['is', 'archived_at', null]],
    ['public.plan_items', 'public', 'plan_items', 'title', 'updated_at', ['neq', 'status', 'dropped']],
    ['public.ideas', 'public', 'ideas', 'body', 'created_at', ['is', 'dismissed_at', null]],
  ] as const)('reads %s for the owner alone, live rows only', async (table, schema, from, title, newest, filter) => {
    const { db, calls } = fakeDb([{ id: 'r1', [title]: 'A row worth a text', [newest]: '2026-11-01T08:00:00Z' }]);
    const rows = await readWatchRows(db, 'owner-id', table, '2026-10-26T09:00:00Z');
    expect(calls.schema).toBe(schema);
    expect(calls.from).toBe(from);
    expect(calls.ops).toContainEqual(['eq', 'user_id', 'owner-id']);
    expect(calls.ops).toContainEqual([...filter]);
    expect(calls.ops).toContainEqual(['gt', newest, '2026-10-26T09:00:00Z']);
    expect(calls.ops).toContainEqual(['order', newest, { ascending: false }]);
    expect(rows).toEqual([{ table, ref: 'r1', title: 'A row worth a text', at: '2026-11-01T08:00:00Z' }]);
  });

  it('reads a catalogued table through the catalogue, scoped to its owner', async () => {
    const { db, calls } = fakeDb([]);
    await readWatchRows(db, 'owner-id', 'job_search.applications', null);
    expect(calls.schema).toBe('job_search');
    expect(calls.ops.some(([op, col, v]) => op === 'eq' && v === 'owner-id' && typeof col === 'string')).toBe(true);
    expect(calls.ops.some(([op]) => op === 'gt')).toBe(false);
  });

  it('reads nothing from a table it has no reader for', async () => {
    const { db, calls } = fakeDb([{ id: 'x' }]);
    expect(await readWatchRows(db, 'owner-id', 'public.no_such_table', null)).toEqual([]);
    expect(calls.from).toBe('');
  });
});
