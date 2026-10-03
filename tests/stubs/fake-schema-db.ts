import type { AskSchema, SchemaClient } from '@/lib/ask/db';

/**
 * An in-memory stand-in for the person's Supabase clients, one per schema,
 * all sharing one set of tables keyed `schema.table`.
 *
 * Enough of the query builder for code that reads a row, writes one and
 * reads it back: select, insert, update and delete, the filters eq, neq, gt,
 * is and in, order, limit, single and maybeSingle. Every query returns whole
 * rows whatever columns it selected. An insert without an id gets one, and a
 * created_at, so a writer that asks for its new row's id gets one back; an
 * insert with one is kept exactly as given.
 */

type Row = Record<string, unknown>;
export type FakeTables = Record<string, Row[]>;

let made = 0;

/** A fresh uuid-shaped id, distinct within the run. */
export function fakeId(): string {
  made += 1;
  return `00000000-0000-4000-9000-${String(made).padStart(12, '0')}`;
}

export function fakeSchemaDb(tables: FakeTables, now = '2026-10-03T08:00:00Z') {
  return function client(schema: string): SchemaClient {
    return {
      from(table: string) {
        const rows = (tables[`${schema}.${table}`] ??= []);
        const filters: ((row: Row) => boolean)[] = [];
        let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
        let payload: Row[] = [];
        let patch: Row = {};
        let limit = Infinity;
        let single: 'one' | 'maybe' | null = null;
        let order: { column: string; ascending: boolean } | null = null;

        function run() {
          let out: Row[];
          if (op === 'insert') {
            out = [];
            for (const value of payload) {
              // A row given its own id is one being put back as it was.
              const row = 'id' in value ? { ...value } : { id: fakeId(), created_at: now, ...value };
              if (rows.some((r) => r.id === row.id)) {
                return { data: null, error: { message: 'duplicate key' } };
              }
              rows.push(row);
              out.push(row);
            }
          } else {
            out = rows.filter((row) => filters.every((f) => f(row)));
            if (order) {
              const { column, ascending } = order;
              out = [...out].sort((a, b) => {
                const x = String(a[column] ?? '');
                const y = String(b[column] ?? '');
                return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
              });
            }
            if (op === 'update') for (const row of out) Object.assign(row, patch);
            if (op === 'delete') for (const row of out) rows.splice(rows.indexOf(row), 1);
          }
          out = out.slice(0, limit).map((row) => ({ ...row }));
          if (single === 'one') {
            return out.length === 1
              ? { data: out[0], error: null }
              : { data: null, error: { message: 'expected one row' } };
          }
          if (single === 'maybe') return { data: out[0] ?? null, error: null };
          return { data: out, error: null };
        }

        const query = {
          select: () => query,
          insert: (value: Row | Row[]) => (
            (op = 'insert'), (payload = Array.isArray(value) ? value : [value]), query
          ),
          update: (value: Row) => ((op = 'update'), (patch = value), query),
          delete: () => ((op = 'delete'), query),
          eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), query),
          neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), query),
          gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), query),
          is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), query),
          in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), query),
          order: (column: string, opts: { ascending?: boolean } = {}) => (
            (order = { column, ascending: opts.ascending ?? true }), query
          ),
          limit: (n: number) => ((limit = n), query),
          single: () => ((single = 'one'), query),
          maybeSingle: () => ((single = 'maybe'), query),
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
            try {
              return Promise.resolve(resolve(run()));
            } catch (error) {
              return reject ? Promise.resolve(reject(error)) : Promise.reject(error);
            }
          },
        };
        return query;
      },
    } as unknown as SchemaClient;
  };
}

/** The deps recordDashAction and undoDashAction take, over the same tables. */
export function fakeDashDeps(tables: FakeTables, userId: string, now = '2026-10-03T12:00:00Z') {
  const client = fakeSchemaDb(tables);
  return {
    userId,
    core: client('core'),
    db: async (schema: AskSchema) => client(schema),
    now: () => now,
  };
}
