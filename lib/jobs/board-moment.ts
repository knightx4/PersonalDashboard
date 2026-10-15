/**
 * The three moments on the pipeline board (plan #1560, docs/UI-QUALITY-SPEC.md
 * Part 8): a role moving forward a stage travels to its new column, an offer
 * has the one larger moment in Jobs, and a rejection fades where it is with
 * the count of applications still open beside it. This file says which of
 * them a move is and what the line under a rejection reads;
 * components/jobs/pipeline/board.tsx plays them.
 */

import { closedToast } from '@/lib/core/lifecycle';
import { isTerminal, statusRank, type ApplicationStatus } from '@/lib/jobs/pipeline';

export type BoardMoment = 'forward' | 'offer' | 'rejection';

/**
 * The moment a move from `from` to `to` plays, or null for one that plays
 * none: a move back a stage, a move within a stage, and any move into or out
 * of a closed status other than a rejection.
 */
export function boardMoment(from: ApplicationStatus, to: ApplicationStatus): BoardMoment | null {
  if (from === to) return null;
  if (to === 'rejected') return isTerminal(from) ? null : 'rejection';
  if (isTerminal(from) || isTerminal(to)) return null;
  if (statusRank(to) <= statusRank(from)) return null;
  return to === 'offer' ? 'offer' : 'forward';
}

/**
 * The statuses of an application that has been sent and has not closed. A
 * lead or a draft has not been sent, so it is not an open application.
 */
export const OPEN_STATUSES: readonly ApplicationStatus[] = [
  'submitted',
  'acknowledged',
  'in_process',
  'final_round',
  'offer',
];

/** How many of `rows` are open applications. */
export function openApplications(rows: readonly { status: ApplicationStatus }[]): number {
  return rows.filter((row) => OPEN_STATUSES.includes(row.status)).length;
}

/**
 * The line a rejection leaves: the closing word with the role it closed, as
 * every closing toast says it (plan #1957.8), then how many applications are
 * still open, said short so it fits beside Undo on a phone. Plain, so the
 * news is neither hidden nor made much of. A rejection is Declined
 * (lib/core/lifecycle.ts).
 */
export function stillOpenLine(company: string, open: number): string {
  const count = open === 0 ? 'none open' : `${open} open`;
  return `${closedToast('declined', company.trim() || 'the role')} · ${count}`;
}
