/**
 * An in-memory stand-in for the learn schema's Supabase client, for tests
 * that run a store function's reads and writes without a database.
 *
 * It keeps each table as an array of rows and understands the calls the
 * level stores make: `select` (every column comes back), `eq`, `in`, `is`,
 * `order`, `update`, `insert`, `upsert` with `onConflict` and
 * `ignoreDuplicates`, and `maybeSingle`, `single` or a plain await. Row-level
 * security is not modelled, so a test that needs it says so itself.
 */
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

export type FakeRow = Record<string, unknown>;
export type FakeTables = Record<string, FakeRow[]>;

type Op =
  | { kind: 'select' }
  | { kind: 'update'; patch: FakeRow }
  | { kind: 'insert'; rows: FakeRow[] }
  | { kind: 'upsert'; rows: FakeRow[]; keys: string[]; ignore: boolean };

export function fakeLearnClient(tables: FakeTables): LearnSupabaseClient {
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    const filters: ((row: FakeRow) => boolean)[] = [];
    let op: Op = { kind: 'select' };
    const matching = () => rows().filter((row) => filters.every((f) => f(row)));

    const run = (): FakeRow[] => {
      if (op.kind === 'update') {
        const hit = matching();
        for (const row of hit) Object.assign(row, op.patch);
        return hit;
      }
      if (op.kind === 'insert') {
        rows().push(...op.rows);
        return op.rows;
      }
      if (op.kind === 'upsert') {
        const { keys, ignore } = op;
        const written: FakeRow[] = [];
        for (const row of op.rows) {
          const had = rows().find((r) => keys.every((k) => r[k] === row[k]));
          if (!had) {
            rows().push(row);
            written.push(row);
          } else if (!ignore) {
            Object.assign(had, row);
            written.push(had);
          }
        }
        return written;
      }
      return matching();
    };

    const builder = {
      select: () => builder,
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return builder;
      },
      in(column: string, values: readonly unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      is(column: string, value: unknown) {
        filters.push((row) => (row[column] ?? null) === value);
        return builder;
      },
      order: () => builder,
      update(patch: FakeRow) {
        op = { kind: 'update', patch };
        return builder;
      },
      insert(input: FakeRow | FakeRow[]) {
        op = { kind: 'insert', rows: Array.isArray(input) ? input : [input] };
        return builder;
      },
      upsert(input: FakeRow | FakeRow[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
        op = {
          kind: 'upsert',
          rows: Array.isArray(input) ? input : [input],
          keys: (options.onConflict ?? 'id').split(','),
          ignore: options.ignoreDuplicates ?? false,
        };
        return builder;
      },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => {
        const [row] = run();
        return row ? { data: row, error: null } : { data: null, error: { message: 'no row came back' } };
      },
      then<T>(resolve: (value: { data: FakeRow[]; error: null }) => T, reject?: (reason: unknown) => T) {
        return Promise.resolve({ data: run(), error: null }).then(resolve, reject);
      },
    };
    return builder;
  };
  return { from, schema: () => ({ from }) } as unknown as LearnSupabaseClient;
}
