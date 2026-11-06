import { describe, expect, it } from 'vitest';
import { NOT_SOURCES, SOURCES } from '@/lib/sources/catalogue';
import { REACH_OUT_KINDS, kindParams, mentionsAny, reachOutKind, readKindRows, type KindDb } from './reach-out-kinds';

/** A PostgREST stand-in: records each call per table and returns that table's rows. */
function fakeDb(rowsByTable: Record<string, Record<string, unknown>[]>) {
  const calls: { schema: string; from: string; ops: [string, ...unknown[]][] }[] = [];
  const db = ((schema: string) => ({
    from: (name: string) => {
      const call = { schema, from: name, ops: [] as [string, ...unknown[]][] };
      calls.push(call);
      const result = { data: rowsByTable[`${schema}.${name}`] ?? [], error: null };
      const query: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
      };
      for (const op of ['select', 'eq', 'neq', 'is', 'not', 'gt', 'gte', 'lt', 'lte', 'in', 'or', 'ilike', 'order', 'limit', 'maybeSingle']) {
        query[op] = (...args: unknown[]) => {
          call.ops.push([op, ...args]);
          return query;
        };
      }
      return query;
    },
  })) as unknown as KindDb;
  return { db, calls };
}

const NOW = Date.parse('2026-11-06T09:00:00Z');
const base = (db: KindDb) => ({ db, userId: 'owner-id', since: '2026-11-05T09:00:00Z', now: NOW, timezone: async () => 'Europe/London' });

describe('the fixed watch kinds', () => {
  it('are unique and record their rows under a catalogued table, or core.ingested_messages', () => {
    const kinds = REACH_OUT_KINDS.map((k) => k.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    const catalogued = new Set([...SOURCES, ...NOT_SOURCES].map((s) => s.table));
    expect(REACH_OUT_KINDS.filter((k) => !catalogued.has(k.table)).map((k) => k.kind)).toEqual([]);
  });

  it('cover every workspace the feature names', () => {
    expect(new Set(REACH_OUT_KINDS.map((k) => k.area))).toEqual(
      new Set(['News', 'Finances', 'Todo and calendar', 'Shopping', 'Mail', 'Learn', 'Goals']),
    );
  });

  it('every reader names the owner in each query it makes', async () => {
    for (const kind of REACH_OUT_KINDS.filter((k) => !k.kind.startsWith('schedule_'))) {
      const { db, calls } = fakeDb({
        'public.recurring_charges': [{ id: 'c1', payment_id: 'p1', amount_cents: 2447, previous_amount_cents: 1277 }],
        'goals.reviews': [{ item_id: 'g1', next_move: 'Call them' }],
        'public.orders': [{ id: 'o1', merchant_id: 'm1', return_deadline: '2026-11-09' }],
        'finances.accounts': [{ id: 'a1', name: 'Current', kind: 'depository' }],
      });
      await kind.read({ ...base(db), params: { words: ['AI'], amount: 100, days: 7, from: 'Monzo' } });
      for (const call of calls) {
        // merchants is the shared list of shops, read by the order's merchant ids.
        if (call.from === 'merchants') continue;
        const owned = call.ops.some(([op, col, value]) => op === 'eq' && value === 'owner-id' && /user_id$/.test(String(col)));
        expect(owned, `${kind.kind} reads ${call.schema}.${call.from} without the owner`).toBe(true);
      }
    }
  });
});

describe('kindParams', () => {
  it('fills the default days and drops what a kind does not read', () => {
    const def = reachOutKind('return_window')!;
    expect(kindParams(def, { words: ['x'], amount: 3, days: null, from: null })).toEqual({ days: 7 });
  });

  it('refuses a kind missing what it cannot run without', () => {
    expect(kindParams(reachOutKind('charge_over')!, { amount: null })).toBeNull();
    expect(kindParams(reachOutKind('news_topics')!, { words: [] })).toBeNull();
    expect(kindParams(reachOutKind('mail')!, { words: null, from: null })).toBeNull();
    expect(kindParams(reachOutKind('mail')!, { from: 'Monzo' })).toEqual({ from: 'Monzo' });
    expect(kindParams(reachOutKind('charge_over')!, { amount: 100 })).toEqual({ amount: 100 });
  });
});

describe('mentionsAny', () => {
  it('matches a short word only on its own and a long one anywhere', () => {
    expect(mentionsAny('New AI chips from Nvidia', ['AI'])).toBe(true);
    expect(mentionsAny('He said the rain will stop', ['AI'])).toBe(false);
    expect(mentionsAny('Interest rates held at 4%', ['interest rate'])).toBe(true);
  });
});

describe('the readers', () => {
  it('news_issues lists new newsletter issues with their summary line', async () => {
    const { db, calls } = fakeDb({
      'news.issues': [{ id: 'i1', subject: 'Semafor Flagship', summary_line: 'Miller to chief of staff', received_at: '2026-11-06T06:00:00Z' }],
    });
    const rows = await readKindRows({ kind: 'news_issues' }, base(db));
    expect(rows).toEqual([{ table: 'news.issues', ref: 'i1', title: 'Semafor Flagship: Miller to chief of staff', at: '2026-11-06T06:00:00Z' }]);
    expect(calls[0].ops).toContainEqual(['gt', 'received_at', '2026-11-05T09:00:00Z']);
  });

  it('news_topics lists only the stories on their topic, each once', async () => {
    const { db } = fakeDb({
      'news.issues': [
        {
          id: 'i1',
          received_at: '2026-11-06T06:00:00Z',
          stories: [
            { headline: 'Nvidia faces a hostile Washington', summary: 'Export rules for AI chips' },
            { headline: 'Rain all weekend', summary: 'Bring a coat' },
          ],
        },
      ],
    });
    const rows = await readKindRows({ kind: 'news_topics', params: { words: ['AI'] } }, base(db));
    expect(rows).toEqual([{ table: 'news.issues', ref: 'i1:0', title: 'Nvidia faces a hostile Washington', at: '2026-11-06T06:00:00Z' }]);
  });

  it('charge_over reads money out over the amount, transfers left out', async () => {
    const { db, calls } = fakeDb({
      'finances.transactions': [{ id: 't1', merchant: 'Apple', amount_cents: -249900, posted_on: '2026-11-05', created_at: '2026-11-06T01:00:00Z' }],
    });
    const rows = await readKindRows({ kind: 'charge_over', params: { amount: 2000 } }, base(db));
    expect(calls[0].ops).toContainEqual(['lte', 'amount_cents', -200000]);
    expect(calls[0].ops).toContainEqual(['is', 'internal_kind', null]);
    expect(rows[0]).toMatchObject({ ref: 't1', title: 'Apple, 2,499 on 2026-11-05' });
  });

  it('balance_under names a cash account under the line, not a card', async () => {
    const { db } = fakeDb({
      'finances.accounts': [
        { id: 'a1', name: 'Savings', kind: 'depository' },
        { id: 'a2', name: 'Amex', kind: 'credit' },
      ],
      'finances.balance_readings': [
        { account_id: 'a1', read_on: '2026-11-06', balance_cents: 150000 },
        { account_id: 'a2', read_on: '2026-11-06', balance_cents: 10000 },
      ],
    });
    const rows = await readKindRows({ kind: 'balance_under', params: { amount: 2000 } }, base(db));
    expect(rows).toEqual([{ table: 'finances.accounts', ref: 'a1', title: 'Savings is at 1,500 (read 2026-11-06)', at: null }]);
  });

  it('recurring_price_rise names the payee and both prices', async () => {
    const { db } = fakeDb({
      'public.recurring_charges': [{ id: 'c1', payment_id: 'p1', amount_cents: 2447, previous_amount_cents: 1277, created_at: '2026-11-06T00:00:00Z' }],
      'public.recurring_payments': [{ id: 'p1', payee: 'New York Times' }],
    });
    const rows = await readKindRows({ kind: 'recurring_price_rise' }, base(db));
    expect(rows[0].title).toBe('New York Times went up from 12.77 to 24.47');
  });

  it('return_window reads deadlines from today to the days ahead', async () => {
    const { db, calls } = fakeDb({ 'public.orders': [{ id: 'o1', merchant_id: 'm1', return_deadline: '2026-11-09' }], 'public.merchants': [{ id: 'm1', name: 'Uniqlo' }] });
    const rows = await readKindRows({ kind: 'return_window', params: { days: 7 } }, base(db));
    expect(calls[0].ops).toContainEqual(['gte', 'return_deadline', '2026-11-06']);
    expect(calls[0].ops).toContainEqual(['lte', 'return_deadline', '2026-11-13']);
    expect(rows[0]).toMatchObject({ ref: 'o1', title: 'Uniqlo order, return by 2026-11-09', at: null });
  });

  it('goal_stalled names each open goal once, with its next move', async () => {
    const { db } = fakeDb({
      'goals.reviews': [
        { item_id: 'g1', next_move: 'Call them', created_at: '2026-11-06T05:00:00Z' },
        { item_id: 'g1', next_move: 'Older', created_at: '2026-11-05T10:00:00Z' },
        { item_id: 'g2', next_move: 'Closed one', created_at: '2026-11-06T05:00:00Z' },
      ],
      'goals.items': [
        { id: 'g1', title: 'Get health cover' },
        { id: 'g2', title: 'Done already', closed_at: '2026-11-01T00:00:00Z' },
      ],
    });
    const rows = await readKindRows({ kind: 'goal_stalled' }, base(db));
    expect(rows).toEqual([{ table: 'goals.items', ref: 'g1', title: 'Get health cover; next move: Call them', at: '2026-11-06T05:00:00Z' }]);
  });

  it('reads nothing for a kind this build does not know', async () => {
    const { db, calls } = fakeDb({});
    expect(await readKindRows({ kind: 'weather' }, base(db))).toEqual([]);
    expect(calls).toEqual([]);
  });
});
