import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { SpendRow } from '@/lib/core/spend/summary';

/**
 * Reading the ledger back.
 *
 * Through the session client, so RLS decides whose rows these are -- nothing
 * here filters by user id, because the policy already did and a filter would
 * only make it look like the security lived in this file.
 *
 * One read, capped, and everything else is arithmetic in memory. A personal
 * ledger is thousands of rows a year at the very most, so a rollup query per
 * question would be three round trips to save nothing.
 */

/** Enough to cover a long month of heavy use without paging. */
const MAX_ROWS = 2000;

const COLUMNS =
  'id, module, operation, model, input_tokens, cached_input_tokens, ' +
  'cache_write_tokens, output_tokens, cost_micros, created_at';

type Row = {
  id: string;
  module: string;
  operation: string;
  model: string;
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  cost_micros: number | null;
  created_at: string;
};

export async function loadSpend(supabase: CoreSupabaseClient): Promise<SpendRow[]> {
  const { data, error } = await supabase
    .from('model_spend')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS);

  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Reading the spend ledger failed: ${error.message}`);

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    module: row.module,
    operation: row.operation,
    model: row.model,
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    outputTokens: row.output_tokens,
    costMicros: row.cost_micros,
    createdAt: row.created_at,
  }));
}
