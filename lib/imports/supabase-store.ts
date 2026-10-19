import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImportKey, ImportStore } from './types';

// The ImportStore over Supabase (plan #2432.2), for the settings page (the
// signed-in client, under row level security) and for scripts/import-linkedin.ts
// (the service-role client, which bypasses it). Every read and write names
// `userId`, so with the service-role client too nothing outside that account
// is read or changed. Rows and their keys are written by core.import_apply in
// one transaction per batch.

const PAGE = 1000;

function split(table: string): [string, string] {
  const [schema, name] = table.split('.');
  if (!schema || !name) throw new Error(`Table ${table} is not schema.table.`);
  return [schema, name];
}

export function supabaseImportStore(client: SupabaseClient, userId: string): ImportStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const at = (schema: string) => (client as SupabaseClient<any, any>).schema(schema);
  const core = at('core');

  return {
    async loadKeys(source) {
      const out: ImportKey[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await core
          .from('import_keys')
          .select('kind, external_key, target_table, row_id, values_hash')
          .eq('user_id', userId)
          .eq('source', source)
          .order('id')
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`Could not read the import keys: ${error.message}`);
        const rows = (data ?? []) as { kind: string; external_key: string; target_table: string; row_id: string; values_hash: string }[];
        for (const r of rows) out.push({ kind: r.kind, key: r.external_key, table: r.target_table, rowId: r.row_id, hash: r.values_hash });
        if (rows.length < PAGE) return out;
      }
    },

    async readRows(table, ids, columns) {
      if (ids.length === 0) return [];
      const [schema, name] = split(table);
      const { data, error } = await at(schema)
        .from(name)
        .select(['id', ...columns].join(', '))
        .eq('user_id', userId)
        .in('id', ids);
      if (error) throw new Error(`Could not read ${table}: ${error.message}`);
      return (data ?? []) as unknown as Record<string, unknown>[];
    },

    async rowsWhere(table, columns, column, values) {
      if (values.length === 0) return [];
      const [schema, name] = split(table);
      const { data, error } = await at(schema)
        .from(name)
        .select(['id', ...columns].join(', '))
        .eq('user_id', userId)
        .in(column, values);
      if (error) throw new Error(`Could not read ${table}: ${error.message}`);
      return (data ?? []) as unknown as Record<string, unknown>[];
    },

    async createRun(source, meta) {
      const { data, error } = await core
        .from('import_runs')
        .insert({ user_id: userId, source, archive_date: meta.archiveDate ?? null, storage_path: meta.storagePath ?? null })
        .select('id')
        .single();
      if (error || !data) throw new Error(`Could not start the import: ${error?.message ?? 'no row'}`);
      return (data as { id: string }).id;
    },

    async applyBatch(runId, writes) {
      const { data, error } = await core.rpc('import_apply', { p_run: runId, p_writes: writes });
      if (error) throw new Error(`Could not write the import: ${error.message}`);
      return Number(data ?? 0);
    },

    async finishRun(runId, result) {
      const { error } = await core
        .from('import_runs')
        .update({ status: result.status, counts: result.counts, error: result.error ?? null, finished_at: new Date().toISOString() })
        .eq('id', runId)
        .eq('user_id', userId);
      if (error) throw new Error(`Could not record the import's result: ${error.message}`);
    },
  };
}
