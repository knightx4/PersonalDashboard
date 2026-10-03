import type { AskSchema, SchemaClient } from '@/lib/ask/db';

/**
 * An in-memory stand-in for the person's Supabase clients, one per schema,
 * all sharing one set of tables keyed `schema.table`.
 *
 * Enough of the query builder for code that reads a row, writes one and
 * reads it back: select, insert, upsert (on its conflict columns, `id` by
 * default, merging or with ignoreDuplicates leaving the row alone and
 * returning nothing for it), update and delete, the filters eq, neq, gt,
 * gte, lt, is, ilike (without wildcards), in, not (is null) and or (of eq,
 * neq and is null), order, limit, single and maybeSingle. Every query returns whole
 * rows whatever columns it selected. An insert without an id gets one, and a
 * created_at, so a writer that asks for its new row's id gets one back; an
 * insert with one is kept exactly as given.
 *
 * The shared thread store (lib/thread/store.ts) is there too: `schema(name)`
 * hands back that schema's client, core.thread_turns is the same list as
 * core.conversation_turns (a thread's turns carry `ref` and `author`), `like`
 * matches a trailing `%`, and `rpc('add_thread_turn', ...)` adds a turn.
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
      schema: (name: string) => client(name),
      rpc(name: string, args: Row) {
        if (schema !== 'core' || name !== 'add_thread_turn') {
          return Promise.resolve({ data: null, error: { message: `no function ${schema}.${name}` } });
        }
        const row = {
          id: fakeId(),
          user_id: args.p_user_id,
          ref: args.p_ref,
          author: args.p_author,
          role: args.p_author === 'me' ? 'user' : 'assistant',
          body: args.p_body,
          created_at: now,
        };
        (tables['core.conversation_turns'] ??= []).push(row);
        return Promise.resolve({ data: row.id, error: null });
      },
      from(table: string) {
        const key = schema === 'core' && table === 'thread_turns' ? 'core.conversation_turns' : `${schema}.${table}`;
        const rows = (tables[key] ??= []);
        const filters: ((row: Row) => boolean)[] = [];
        let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
        let conflict = { columns: ['id'], ignore: false };
        let payload: Row[] = [];
        let patch: Row = {};
        let limit = Infinity;
        let single: 'one' | 'maybe' | null = null;
        let order: { column: string; ascending: boolean } | null = null;

        function run() {
          let out: Row[];
          if (op === 'upsert') {
            out = [];
            for (const value of payload) {
              const found = rows.find((r) => conflict.columns.every((c) => c in value && r[c] === value[c]));
              if (found) {
                if (conflict.ignore) continue;
                Object.assign(found, value);
                out.push(found);
              } else {
                const row = { id: fakeId(), created_at: now, ...value };
                rows.push(row);
                out.push(row);
              }
            }
          } else if (op === 'insert') {
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
          upsert: (value: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => (
            (op = 'upsert'),
            (payload = Array.isArray(value) ? value : [value]),
            (conflict = {
              columns: (opts.onConflict ?? 'id').split(',').map((c) => c.trim()),
              ignore: opts.ignoreDuplicates ?? false,
            }),
            query
          ),
          update: (value: Row) => ((op = 'update'), (patch = value), query),
          delete: () => ((op = 'delete'), query),
          eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), query),
          neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), query),
          gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), query),
          gte: (c: string, v: string) => (filters.push((r) => r[c] != null && String(r[c]) >= v), query),
          lt: (c: string, v: string) => (filters.push((r) => r[c] != null && String(r[c]) < v), query),
          is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), query),
          ilike: (c: string, v: string) => (
            filters.push((r) => typeof r[c] === 'string' && (r[c] as string).toLowerCase() === v.toLowerCase()), query
          ),
          in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), query),
          like: (c: string, v: string) => (
            filters.push((r) => typeof r[c] === 'string' && (r[c] as string).startsWith(v.replace(/%$/, ''))), query
          ),
          not: (c: string) => (filters.push((r) => (r[c] ?? null) !== null), query),
          or: (spec: string) => {
            const parts = spec.split(',').map((part) => part.split('.'));
            filters.push((r) =>
              parts.some(([c, operator, v]) =>
                operator === 'is' ? (r[c] ?? null) === null : operator === 'neq' ? r[c] !== v : r[c] === v,
              ),
            );
            return query;
          },
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
