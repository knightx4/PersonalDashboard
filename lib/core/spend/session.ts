import 'server-only';

import { createCoreClient } from '@/lib/core/auth/server';
import type { SpendOperation } from '@/lib/core/spend/operations';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports } from '@/lib/core/spend/record';

/**
 * Record spend from a server action, on the person's own session.
 *
 * The same move as `recordLearnSpend`, for the modules outside Learn: the
 * ledger lives in `core` and the module's own client is bound to its own
 * schema, so this opens a core client and writes the reports under one named
 * operation. Never throws; the ledger measures work that already happened.
 */
export async function recordSessionSpend(
  userId: string,
  target: SpendOperation,
  reports: SpendReport[],
): Promise<void> {
  if (reports.length === 0) return;
  try {
    const supabase = await createCoreClient();
    await recordSpendReports(supabase, userId, target, reports);
  } catch (error) {
    console.error(
      `[spend] ${target.module}/${target.operation}`,
      error instanceof Error ? error.message : error,
    );
  }
}
