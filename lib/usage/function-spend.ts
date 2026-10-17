import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { SPEND_OPERATIONS } from '@/lib/core/spend/operations';
import { LEARN_OPERATIONS } from '@/lib/learn/spend';

/**
 * Model spend per function over the last 30 days (plan #1692). A function is
 * a workspace and the operation it was doing, the two columns the ledger
 * records for every call. Read through core.function_spend_since.
 */
export type FunctionSpend = {
  /** The ledger's `module`: a workspace id, or `core` for the app as a whole. */
  workspace: string;
  /** The ledger's `operation`, as recorded. */
  operation: string;
  /** The operation in plain words, or the raw name when no list declares it. */
  label: string;
  /** Micro-dollars. */
  spend7: number;
  spend30: number;
  calls30: number;
  /** Calls whose model had no published rate, so the sums are short by them. */
  unpriced30: number;
};

type FunctionSpendRow = {
  module: string;
  operation: string;
  spend_7: number | string;
  spend_30: number | string;
  calls_30: number;
  unpriced_30: number;
};

const KNOWN_OPERATIONS: ReadonlySet<string> = new Set([
  ...LEARN_OPERATIONS,
  ...Object.values(SPEND_OPERATIONS).flat(),
]);

/** 'plan-topic' as "Plan topic"; a name no list declares comes back as it is. */
export function operationLabel(operation: string): string {
  if (!KNOWN_OPERATIONS.has(operation)) return operation;
  const words = operation.replaceAll('-', ' ').replace(/\bdash\b/g, 'Dash');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One row per function, biggest 30-day spender first, ties by calls then name. */
export function functionSpendRows(rows: readonly FunctionSpendRow[]): FunctionSpend[] {
  return rows
    .map((row) => ({
      workspace: row.module,
      operation: row.operation,
      label: operationLabel(row.operation),
      spend7: Number(row.spend_7),
      spend30: Number(row.spend_30),
      calls30: row.calls_30,
      unpriced30: row.unpriced_30,
    }))
    .sort(
      (a, b) =>
        b.spend30 - a.spend30 ||
        b.calls30 - a.calls30 ||
        a.workspace.localeCompare(b.workspace) ||
        a.operation.localeCompare(b.operation),
    );
}

/**
 * Spend per function over the Usage tab's whole days (plan #2036.2): the 7-
 * and 30-day sums start at midnight in the person's timezone, so they agree
 * with the spend-per-day chart. Pass the request's own client and the
 * ledger's RLS keeps it to the signed-in person.
 */
export async function readFunctionSpend(
  client: SupabaseClient | CoreSupabaseClient,
  window: { since7: string; since: string },
): Promise<FunctionSpend[]> {
  const { data, error } = await (client as SupabaseClient)
    .schema('core')
    .rpc('function_spend_since', { p_since7: window.since7, p_since30: window.since });
  if (error) throw new Error(`Could not read the spend per function: ${error.message}`);
  return functionSpendRows((data ?? []) as FunctionSpendRow[]);
}
