import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import type { ModuleId } from '@/lib/modules';

/**
 * What a queued paid press keeps in core.dash_actions `input` (plan #2228.1),
 * kind `paid_action`. No server imports, so the approval card (#2228.2) can
 * read it in the browser.
 *
 * While the item is proposed, its `undo` column says where the press is:
 * absent before anyone approves it, `{ running_at }` while it runs, and
 * `{ failed }` with the reason when the run refused or broke, which leaves it
 * proposed so it can be approved again or dismissed. Once it has run the item
 * is done, and `undo.none` says why it has no Undo (PAID_NO_UNDO).
 */
export type PaidActionInput = {
  /** The Dash tool that queued it (lib/dash/paid-tools.ts). */
  tool: string;
  /** The button's key in PAID_ACTIONS (lib/core/spend/paid-actions.ts), which its estimate is priced from. */
  action: string;
  /** The checked arguments the tool's run takes. */
  args: Record<string, unknown>;
  /** What the card's line says the press will do, naming Dash: "Write the review of 2026." */
  line: string;
  /** How many units a per-unit press works on; absent for a press priced per run. */
  count?: number;
  /** The estimate the button's hint shows, scaled by `count`; null when it could not be read. */
  estimate: CostEstimate | null;
  /** The workspace it runs in, which has to be on when it is approved; null for none. */
  workspace: ModuleId | null;
  /** The pages to revalidate once it has run. */
  paths: string[];
};

/** Why a paid press that has run has no Undo. */
export const PAID_NO_UNDO = 'Dash ran this and the money is spent, so it cannot be undone.';

/** Where a proposed paid press is, read from its `undo` column. */
export type PaidState = { state: 'waiting' } | { state: 'running'; since: string } | { state: 'failed'; error: string };

export function paidState(undo: Record<string, unknown> | null): PaidState {
  if (typeof undo?.running_at === 'string') return { state: 'running', since: undo.running_at };
  if (typeof undo?.failed === 'string') return { state: 'failed', error: undo.failed };
  return { state: 'waiting' };
}

/** How long a press may say it is running before another approval may take it over. */
export const PAID_RUN_STALE_MS = 15 * 60 * 1000;
