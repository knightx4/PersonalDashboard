import 'server-only';

import { createCoreClient } from '@/lib/core/auth/server';
import { recordSpend } from '@/lib/core/spend/record';
import type { SpendReport } from '@/lib/core/spend/pricing';

/**
 * The learn module's way into the ledger.
 *
 * The spend table lives in `core` and the module's own client is bound to
 * `learn`, so a recording needs a second client. That is one line, and putting
 * it here rather than in each server action keeps the operation names in one
 * list where they can be seen to be consistent -- `plan-topic` and
 * `planTopic()` and `Planning a topic` would all be defensible in isolation
 * and useless together on a screen that groups by them.
 *
 * Never throws. The ledger is a measurement of work that already succeeded,
 * and a measurement that fails must not take the work with it.
 */

/**
 * Every operation in this module that spends.
 *
 * A list rather than a bare union so the spend screen can group by it and so
 * a sixth call site has one obvious place to declare itself. The strings are
 * what land in the column, so they are stable: renaming one splits a month of
 * history into two rows that look like different things.
 */
export const LEARN_OPERATIONS = [
  'parse-references',
  'resolve-reference',
  'suggest-sources',
  'plan-topic',
  'locate-passage',
  'generate-chain',
  'write-probe',
  'name-misconception',
] as const;

export type LearnOperation = (typeof LEARN_OPERATIONS)[number];

export async function recordLearnSpend(
  userId: string,
  operation: LearnOperation,
  reports: SpendReport[],
): Promise<void> {
  if (reports.length === 0) return;

  try {
    const supabase = await createCoreClient();
    for (const report of reports) {
      await recordSpend(supabase, userId, {
        module: 'learn',
        operation,
        model: report.model,
        usage: report.usage,
      });
    }
  } catch (error) {
    console.error(
      `[learn spend] ${operation}`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * A sink and the reports it collected.
 *
 * The library functions report synchronously as each call returns; the action
 * writes them afterwards, once, rather than awaiting a database round trip in
 * the middle of a search the person is waiting on.
 */
export function collectSpend(): { sink: (report: SpendReport) => void; reports: SpendReport[] } {
  const reports: SpendReport[] = [];
  return { sink: (report) => reports.push(report), reports };
}
