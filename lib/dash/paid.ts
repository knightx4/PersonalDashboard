import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import { scaleEstimate } from '@/lib/core/spend/estimate-types';
import { moduleById } from '@/lib/modules';
import type { NewDashChange } from '@/lib/talk/changes';
import { formatMicroDollars } from '@/lib/money';
import type { PaidActionInput } from './paid-input';
import type { DashPaidCheckContext, DashPaidTool } from './registry';

/**
 * Queueing a paid press for an approval (plan #2228.1, feature #2228).
 *
 * A paid tool (lib/dash/paid-tools.ts) runs nothing when Dash calls it. The
 * input is checked by the tool's `prepare`, the way the button's action
 * would check it; the press is priced from the button's key in PAID_ACTIONS,
 * the same estimate its $ hint shows; and the result is kept as a proposed
 * `paid_action` row in core.dash_actions, where Ask keeps its proposals.
 * Confirming it (confirmChange in lib/ask/changes.ts) runs the tool's `run`,
 * which calls the function the button calls and records the spend there.
 *
 * No `server-only` and no clients made here: the surface hands in the
 * person's context and the estimate, and the tests hand in stubs.
 */

/** Prices one press of a button by its key; estimatePaidActions bound to the person. */
export type PaidEstimator = (action: DashPaidTool['action']) => Promise<CostEstimate | null>;

/** What queueing gives the surface: the item to keep and what to tell the model once kept. */
export type PaidQueued =
  | { ok: true; change: Extract<NewDashChange, { kind: 'paid_action' }>; note: string }
  | { ok: false; error: string };

const QUEUED_NOTE =
  'Nothing has run yet: it shows on a card under your answer with its estimated cost, and runs only when they approve it. Say in your answer what you queued and roughly what it costs.';

/**
 * Check a paid press and build the item to keep. Never throws: a workspace
 * that is off, an input the tool refuses or a failed check comes back as
 * `{ ok: false, error }` for the model to say in words. An estimate that
 * cannot be read leaves the item without one rather than refusing it.
 */
export async function queuePaidPress(
  tool: DashPaidTool,
  input: unknown,
  ctx: DashPaidCheckContext,
  estimate: PaidEstimator,
): Promise<PaidQueued> {
  if (tool.workspace && !ctx.enabledModules.includes(tool.workspace)) {
    const label = moduleById(tool.workspace)?.label ?? tool.workspace;
    return { ok: false, error: `The ${label} workspace is switched off, so nothing can be run there.` };
  }
  let prepared;
  try {
    prepared = await tool.prepare(ctx, input);
  } catch (error) {
    console.error(`paid tool ${tool.name}: the check failed`, error);
    return { ok: false, error: 'That could not be checked against the database.' };
  }
  if (!prepared.ok) return prepared;

  let priced: CostEstimate | null = null;
  try {
    const found = await estimate(tool.action);
    priced = found ? scaleEstimate(found, prepared.count) : null;
  } catch (error) {
    console.error(`paid tool ${tool.name}: the estimate was not read`, error);
  }

  const kept: PaidActionInput = {
    tool: tool.name,
    action: tool.action,
    args: prepared.args,
    line: prepared.line,
    ...(prepared.count != null ? { count: prepared.count } : {}),
    estimate: priced,
    workspace: tool.workspace,
    paths: prepared.paths,
  };
  const cost = priced ? ` It should cost about ${formatMicroDollars(priced.medianMicros)}.` : '';
  return {
    ok: true,
    change: { kind: 'paid_action', input: kept },
    note: `Queued: ${prepared.line}${cost} ${QUEUED_NOTE}`,
  };
}
