import { describe, expect, it } from 'vitest';
import type { SchemaClient } from '@/lib/ask/db';
import {
  CONNECTOR_RATE,
  checkConnectorRate,
  connectorCallRow,
  lastConnectorRevocation,
  rateVerdict,
  recordConnectorCall,
  recordConnectorRevocation,
} from './calls';

/**
 * The connector's call log and rate cap (plan #1254), against an in-memory
 * stand-in for the part of supabase-js they use. Two people's calls sit side
 * by side, so a count that forgot to filter to the person would show.
 */

const ME = '00000000-0000-4000-8000-00000000000a';
const THEM = '00000000-0000-4000-8000-00000000000b';
const CLIENT = 'client-claude';
const NOW = Date.parse('2026-09-30T12:00:00.000Z');

type Row = Record<string, unknown>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private sort: { column: string; ascending: boolean } | null = null;
  private window: [number, number] | null = null;
  private head = false;
  private counting = false;

  constructor(private readonly rows: Row[]) {}

  select(_columns: string, options?: { count?: 'exact'; head?: boolean }) {
    this.counting = options?.count === 'exact';
    this.head = options?.head ?? false;
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
  gte(column: string, value: string) {
    this.filters.push((row) => String(row[column]) >= value);
    return this;
  }
  order(column: string, { ascending }: { ascending: boolean }) {
    this.sort = { column, ascending };
    return this;
  }
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  limit(n: number) {
    this.window = [0, n - 1];
    return this;
  }
  then<A, B>(
    resolve?: ((value: { data: Row[] | null; count: number | null; error: null }) => A) | null,
    reject?: ((reason: unknown) => B) | null,
  ) {
    let rows = this.rows.filter((row) => this.filters.every((f) => f(row)));
    const count = rows.length;
    if (this.sort) {
      const { column, ascending } = this.sort;
      rows = [...rows].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1));
    }
    if (this.window) {
      // PostgREST refuses an offset past the last row; fail the test the same way.
      if (this.window[0] >= count && count > 0) throw new Error('range past the last row');
      rows = rows.slice(this.window[0], this.window[1] + 1);
    }
    return Promise.resolve({
      data: this.head ? null : rows,
      count: this.counting ? count : null,
      error: null,
    }).then(resolve, reject);
  }
}

function fakeCore(tables: Record<string, Row[]> = {}) {
  const client = {
    tables,
    from(table: string) {
      tables[table] ??= [];
      const rows = tables[table];
      return {
        select: (columns: string, options?: { count?: 'exact'; head?: boolean }) =>
          new FakeQuery(rows).select(columns, options),
        insert: async (row: Row) => {
          rows.push({ created_at: new Date(NOW).toISOString(), revoked_at: new Date(NOW).toISOString(), ...row });
          return { error: null };
        },
      };
    },
  };
  return client;
}

function asClient(fake: ReturnType<typeof fakeCore>): SchemaClient {
  return fake as unknown as SchemaClient;
}

/** `n` calls by `user`, one second apart, the newest `newestAgoMs` before NOW. */
function calls(user: string, n: number, newestAgoMs: number, outcome = 'ok'): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    user_id: user,
    client_id: CLIENT,
    outcome,
    created_at: new Date(NOW - newestAgoMs - i * 1000).toISOString(),
  }));
}

describe('recording a call', () => {
  it('keeps the table and ref of each row returned, and nothing the model read about it', () => {
    const row = connectorCallRow({
      userId: ME,
      clientId: CLIENT,
      clientName: 'Claude',
      tool: 'todos',
      input: { status: 'overdue' },
      result: {
        ok: true,
        rows: [
          { table: 'todo.tasks', ref: 't1', title: 'Renew passport', href: '/todo?task=t1', detail: { due: '2026-09-01' } },
        ],
        totals: { overdue: 1 },
      },
    });
    expect(row).toEqual({
      user_id: ME,
      client_id: CLIENT,
      client_name: 'Claude',
      tool: 'todos',
      input: { status: 'overdue' },
      reads: [{ table: 'todo.tasks', ref: 't1', title: 'Renew passport', href: '/todo?task=t1' }],
      outcome: 'ok',
      error: null,
    });
  });

  it('records a refused lookup and a capped call with the reason and no reads', () => {
    const failed = connectorCallRow({
      userId: ME,
      clientId: CLIENT,
      tool: 'vault_notes',
      input: 'not an object',
      result: { ok: false, error: 'The Vault workspace is switched off, so it cannot be read.' },
    });
    expect(failed).toMatchObject({ outcome: 'error', reads: [], input: {}, client_name: null });
    expect(failed.error).toMatch(/switched off/);

    const capped = connectorCallRow({ userId: ME, clientId: CLIENT, tool: 'search', input: {}, limited: 'Too many calls.' });
    expect(capped).toMatchObject({ outcome: 'limited', error: 'Too many calls.', reads: [] });
  });

  it('writes the row to core.connector_calls', async () => {
    const fake = fakeCore();
    await recordConnectorCall(asClient(fake), {
      userId: ME,
      clientId: CLIENT,
      tool: 'search',
      input: { query: 'ebay' },
      result: { ok: true, rows: [] },
    });
    expect(fake.tables.connector_calls).toHaveLength(1);
    expect(fake.tables.connector_calls[0]).toMatchObject({ user_id: ME, tool: 'search', outcome: 'ok' });
  });
});

describe('the minute limit', () => {
  it('lets the 30th call in a minute through and refuses the 31st', async () => {
    const fake = fakeCore({ connector_calls: calls(ME, CONNECTOR_RATE.perMinute - 1, 5_000) });
    expect(await checkConnectorRate(asClient(fake), ME, NOW)).toEqual({ ok: true });

    fake.tables.connector_calls.push(...calls(ME, 1, 1_000));
    const verdict = await checkConnectorRate(asClient(fake), ME, NOW);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.limit).toBe('minute');
    // The oldest of the thirty was made 5s + 28s ago, so a slot opens 27s from now.
    expect(verdict.retryAfterSeconds).toBe(27);
    expect(verdict.retryAt).toBe(new Date(NOW + 27_000).toISOString());
    expect(verdict.message).toBe(
      'Too many calls: the dashboard answers at most 30 calls a minute from connected apps. Try again in 27 seconds.',
    );
  });

  it('counts only this person, and not calls the cap already refused', async () => {
    const fake = fakeCore({
      connector_calls: [
        ...calls(THEM, 40, 1_000),
        ...calls(ME, 29, 1_000),
        ...calls(ME, 20, 1_000, 'limited'),
      ],
    });
    expect(await checkConnectorRate(asClient(fake), ME, NOW)).toEqual({ ok: true });
  });

  it('counts refused and failed lookups, which did run', async () => {
    const fake = fakeCore({ connector_calls: calls(ME, 30, 1_000, 'error') });
    expect((await checkConnectorRate(asClient(fake), ME, NOW)).ok).toBe(false);
  });

  it('lets calls through again once the minute has passed', async () => {
    const fake = fakeCore({ connector_calls: calls(ME, 30, 61_000) });
    expect(await checkConnectorRate(asClient(fake), ME, NOW)).toEqual({ ok: true });
  });
});

describe('the day limit', () => {
  it('refuses the 1,001st call in a day and says when the day window reopens', async () => {
    // A thousand calls, one a second, the newest ten minutes ago: the minute is quiet.
    const fake = fakeCore({ connector_calls: calls(ME, CONNECTOR_RATE.perDay, 10 * 60_000) });
    const verdict = await checkConnectorRate(asClient(fake), ME, NOW);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.limit).toBe('day');
    // The oldest was made 10 min + 999 s ago; it leaves the day window 24 h after that.
    const opens = NOW - 10 * 60_000 - 999_000 + 24 * 3_600_000;
    expect(verdict.retryAt).toBe(new Date(opens).toISOString());
    expect(verdict.message).toBe(
      'Too many calls: the dashboard answers at most 1,000 calls a day from connected apps. Try again in 24 hours.',
    );
  });

  it('lets the 1,000th call through', async () => {
    const fake = fakeCore({ connector_calls: calls(ME, CONNECTOR_RATE.perDay - 1, 10 * 60_000) });
    expect(await checkConnectorRate(asClient(fake), ME, NOW)).toEqual({ ok: true });
  });

  it('waits for the later of the two when both are full', () => {
    const verdict = rateVerdict(
      {
        minute: { count: 30, filledAt: new Date(NOW - 50_000).toISOString() },
        day: { count: 1000, filledAt: new Date(NOW - 23 * 3_600_000).toISOString() },
      },
      NOW,
    );
    expect(verdict).toMatchObject({ ok: false, limit: 'day', retryAfterSeconds: 3600 });
    if (!verdict.ok) expect(verdict.message).toMatch(/Try again in 1 hour\.$/);
  });
});

describe('revocations', () => {
  it('records one and reads back the newest for that client only', async () => {
    const fake = fakeCore({
      connector_revocations: [
        { user_id: ME, client_id: CLIENT, revoked_at: '2026-09-01T00:00:00.000Z' },
        { user_id: ME, client_id: 'other', revoked_at: '2026-09-29T00:00:00.000Z' },
        { user_id: THEM, client_id: CLIENT, revoked_at: '2026-09-29T00:00:00.000Z' },
      ],
    });
    expect(await lastConnectorRevocation(asClient(fake), ME, CLIENT)).toBe('2026-09-01T00:00:00.000Z');
    await recordConnectorRevocation(asClient(fake), ME, CLIENT);
    expect(await lastConnectorRevocation(asClient(fake), ME, CLIENT)).toBe(new Date(NOW).toISOString());
    expect(await lastConnectorRevocation(asClient(fake), THEM, 'nobody')).toBeNull();
  });
});
