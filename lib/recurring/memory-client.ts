import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A Supabase client over arrays of rows, for the recurring tests: the query
 * chain supports the filters and writes lib/recurring's store and corrections
 * use, and nothing RLS or the constraints would do. An update answers with
 * the rows it changed, as `.update().select()` does.
 */

export type Row = Record<string, unknown>;

export function memoryClient(tables: Record<string, Row[]>) {
  let nextId = 1;
  const client = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: [string, unknown][] = [];
      let op: 'select' | 'insert' | 'upsert' | 'update' = 'select';
      let payload: Row | null = null;
      let upsertKeys: string[] = [];
      const matching = () => rows.filter((r) => filters.every(([k, v]) => r[k] === v));
      const run = () => {
        if (op === 'insert') {
          const row = { id: `${table}-${nextId++}`, created_at: '2026-09-29T00:00:00Z', ...payload };
          rows.push(row);
          return { data: [row], error: null };
        }
        if (op === 'upsert') {
          const clash = rows.find((r) => upsertKeys.every((k) => r[k] === payload![k]));
          if (clash) return { data: [], error: null };
          const row = { id: `${table}-${nextId++}`, status: 'active', ...payload };
          rows.push(row);
          return { data: [row], error: null };
        }
        if (op === 'update') {
          const hit = matching();
          for (const r of hit) Object.assign(r, payload);
          return { data: hit, error: null };
        }
        return { data: matching(), error: null };
      };
      const chain = {
        select: () => chain,
        eq: (k: string, v: unknown) => (filters.push([k, v]), chain),
        insert: (row: Row) => ((op = 'insert'), (payload = row), chain),
        upsert: (row: Row, o: { onConflict: string }) => (
          (op = 'upsert'), (payload = row), (upsertKeys = o.onConflict.split(',')), chain
        ),
        update: (row: Row) => ((op = 'update'), (payload = row), chain),
        maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
        single: async () => ({ data: matching()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve(run()),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return client;
}
