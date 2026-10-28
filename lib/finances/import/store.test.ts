import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addBalanceReading, importStatement, previewStatement } from './store';
import { parseWalletExport, type WalletStatement } from './wallet';

/**
 * A stand-in for the supabase-js calls the import store makes, over tables
 * in memory. Upserts honour their conflict columns as the database's unique
 * constraints do, and `ignoreDuplicates` returns only the rows it inserted.
 */
type Row = Record<string, unknown>;

function fakeClient() {
  const tables: Record<string, Row[]> = { accounts: [], transactions: [], balance_readings: [] };
  let next = 0;

  function query(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let order: { column: string; ascending: boolean } | null = null;
    let limit = Infinity;
    let write: (() => Row[]) | null = null;

    const rows = () => {
      if (write) return write();
      let out = tables[table].filter((r) => filters.every((f) => f(r)));
      if (order) {
        const { column, ascending } = order;
        out = [...out].sort(
          (a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1),
        );
      }
      return out.slice(0, limit);
    };

    const builder = {
      select: () => builder,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), builder),
      lt: (c: string, v: string) => (filters.push((r) => String(r[c]) < v), builder),
      order: (column: string, opts?: { ascending?: boolean }) => (
        (order = { column, ascending: opts?.ascending ?? true }),
        builder
      ),
      limit: (n: number) => ((limit = n), builder),
      insert: (row: Row) => {
        write = () => {
          const saved = { id: `id-${(next += 1)}`, ...row };
          tables[table].push(saved);
          return [saved];
        };
        return builder;
      },
      upsert: (input: Row | Row[], opts: { onConflict: string; ignoreDuplicates?: boolean }) => {
        const keys = opts.onConflict.split(',');
        write = () => {
          const inserted: Row[] = [];
          for (const row of Array.isArray(input) ? input : [input]) {
            const held = tables[table].find((r) => keys.every((k) => r[k] === row[k]));
            if (held) {
              if (!opts.ignoreDuplicates) Object.assign(held, row);
              continue;
            }
            const saved = { id: `id-${(next += 1)}`, ...row };
            tables[table].push(saved);
            inserted.push(saved);
          }
          return inserted;
        };
        return builder;
      },
      update: (patch: Row) => {
        write = () => {
          const hit = tables[table].filter((r) => filters.every((f) => f(r)));
          for (const r of hit) Object.assign(r, patch);
          return hit;
        };
        return builder;
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0], error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve),
    };
    return builder;
  }

  const client = { schema: () => ({ from: query }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, tables };
}

const USER = 'user-1';

function statement(name: string): WalletStatement {
  const result = parseWalletExport(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
  if (!result.ok) throw new Error(result.error);
  return result.statement;
}

describe('importing an Apple Card statement', () => {
  it('creates the Apple Card account on the first import, with no link and no Plaid id', async () => {
    const { client, tables } = fakeClient();
    const result = await importStatement(client, USER, statement('apple-card-2026-09.ofx'), 61_877);
    expect(result).toMatchObject({ added: 7, skipped: 0 });
    expect(tables.accounts).toEqual([
      expect.objectContaining({
        user_id: USER,
        name: 'Apple Card',
        institution_name: 'Apple',
        kind: 'credit_card',
        source: 'import',
        statement_balance_cents: 61_877,
      }),
    ]);
    expect(tables.accounts[0]).not.toHaveProperty('link_id');
    expect(tables.accounts[0]).not.toHaveProperty('plaid_account_id');
    expect(tables.balance_readings).toEqual([
      expect.objectContaining({ read_on: '2026-09-30', balance_cents: 61_877 }),
    ]);
  });

  it('adds nothing the second time, and keeps one closing balance', async () => {
    const { client, tables } = fakeClient();
    await importStatement(client, USER, statement('apple-card-2026-09.csv'), 61_877);
    const preview = await previewStatement(client, USER, statement('apple-card-2026-09.csv'));
    expect(preview).toMatchObject({ count: 7, newCount: 0 });
    const again = await importStatement(client, USER, statement('apple-card-2026-09.csv'), 61_877);
    expect(again).toMatchObject({ added: 0, skipped: 7 });
    expect(tables.transactions).toHaveLength(7);
    expect(tables.balance_readings).toHaveLength(1);
    expect(tables.accounts).toHaveLength(1);
  });

  it('treats the OFX of a month already imported from CSV as the same lines', async () => {
    const { client, tables } = fakeClient();
    await importStatement(client, USER, statement('apple-card-2026-09.csv'), null);
    const again = await importStatement(client, USER, statement('apple-card-2026-09.ofx'), 61_877);
    expect(again.added).toBe(0);
    expect(tables.transactions).toHaveLength(7);
  });

  it('works out a CSV’s closing balance from the statement before it', async () => {
    const { client, tables } = fakeClient();
    await importStatement(client, USER, statement('apple-card-2026-09.ofx'), 61_877);
    // August's close, before September's first line.
    tables.balance_readings.push({
      account_id: tables.accounts[0].id,
      user_id: USER,
      read_on: '2026-08-31',
      balance_cents: 100_000,
    });
    tables.transactions.length = 0;
    const preview = await previewStatement(client, USER, statement('apple-card-2026-09.csv'));
    // 100,000 owed, plus 34.12 + 19.99 + 27.86 + 6.75 + 6.75 charged, less 520 paid and 12.40 refunded.
    expect(preview).toMatchObject({
      closingFrom: 'worked out',
      closingBalanceCents: 56_307,
      newCount: 7,
    });
  });
});

describe('a balance added by hand', () => {
  it('is taken by a manual account and refused by a linked one', async () => {
    const { client, tables } = fakeClient();
    tables.accounts.push(
      { id: 'manual', user_id: USER, source: 'manual' },
      { id: 'linked', user_id: USER, source: 'plaid' },
    );
    expect(await addBalanceReading(client, USER, 'manual', 150_000, '2026-10-28')).toBe(true);
    expect(await addBalanceReading(client, USER, 'linked', 150_000, '2026-10-28')).toBe(false);
    expect(await addBalanceReading(client, 'someone-else', 'manual', 1, '2026-10-28')).toBe(false);
    expect(tables.balance_readings).toEqual([
      expect.objectContaining({ account_id: 'manual', balance_cents: 150_000 }),
    ]);
  });
});
