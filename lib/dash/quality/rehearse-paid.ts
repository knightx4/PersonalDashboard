import type { AskContext } from '@/lib/ask/db';
import type { DashQueuer } from '@/lib/dash/loop';
import { queuePaidPress } from '@/lib/dash/paid';

/**
 * The paid presses of a Dash quality case, checked and never kept.
 *
 * In Ask a paid tool is checked by its `prepare`, priced, and kept as a
 * proposed row that runs only when the person approves it. The quality run
 * used to offer no queue at all, so every paid call was refused and a case
 * could not tell whether Dash pressed the right button the right way: the
 * bulk-draft case (4171ad81, turn b93e4745) was retired for that reason.
 *
 * Here the press goes through the same check as in Ask (queuePaidPress, whose
 * `prepare` calls only read), and the model is told it was queued, so the
 * answer goes on as it would in the app. Nothing is priced, nothing is kept,
 * and so there is nothing to approve and nothing can spend.
 */
export function rehearsePaid(ctx: AskContext): DashQueuer {
  return async (tool, input, seen) => {
    const checked = await queuePaidPress(tool, input, { ...ctx, seen }, async () => null);
    if (!checked.ok) return { ok: false, error: checked.error };
    return { ok: true, rows: [], totals: { queued: { kind: 'paid_action', tool: tool.name } }, note: checked.note };
  };
}
