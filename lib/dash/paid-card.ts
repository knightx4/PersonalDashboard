import { approxDollars, type CostEstimate } from '@/lib/core/spend/estimate-types';
import type { DevComment } from '@/lib/comments/load';
import type { DashChange } from '@/lib/talk/changes';
import { paidState } from './paid-input';

/**
 * What the approval card (components/talk/paid-card.tsx, plan #2228.2) works
 * out from the queued presses, kept apart from the drawing so it is tested
 * on its own. No server imports: the card is drawn in the browser.
 */

type Paid = Extract<DashChange, { kind: 'paid_action' }>;
type PaidChange = Paid;

/** Where one line on the card is. */
export type PaidLineState =
  | { state: 'waiting' }
  | { state: 'running' }
  | { state: 'done' }
  | { state: 'failed'; error: string }
  | { state: 'declined' };

/**
 * A line's state: the row's own, unless the card has a press of its own in
 * flight or heard a refusal the row does not carry (the connection dropped,
 * the workspace was switched off).
 */
export function paidLineState(change: Paid, local: { running?: boolean; error?: string } = {}): PaidLineState {
  if (change.status === 'done') return { state: 'done' };
  if (change.status === 'declined' || change.status === 'undone') return { state: 'declined' };
  if (local.running) return { state: 'running' };
  const kept = paidState(change.undo);
  if (kept.state === 'running') return { state: 'running' };
  if (local.error) return { state: 'failed', error: local.error };
  if (kept.state === 'failed') return { state: 'failed', error: kept.error };
  return { state: 'waiting' };
}

/** The card's total: the typical run of each line added up, and how many lines had no figure. */
export type PaidTotal = { medianMicros: number; unpriced: number; guess: boolean };

export function paidTotal(changes: readonly Paid[]): PaidTotal {
  const priced = changes.map((change) => change.input.estimate).filter((e): e is CostEstimate => e != null);
  return {
    medianMicros: priced.reduce((sum, e) => sum + e.medianMicros, 0),
    unpriced: changes.length - priced.length,
    guess: priced.some((e) => e.basis === 'guess'),
  };
}

/**
 * The card's figures: the total over every line, and once some have run,
 * what was spent on them and what is left on the ones still to run.
 */
export function paidTotals(changes: readonly Paid[]): { all: PaidTotal; spent: PaidTotal; left: PaidTotal; ran: number; open: number } {
  const ran = changes.filter((change) => change.status === 'done');
  const open = changes.filter((change) => change.status === 'proposed');
  return { all: paidTotal(changes), spent: paidTotal(ran), left: paidTotal(open), ran: ran.length, open: open.length };
}

/**
 * A line's cost or the total, in the hint's words: "about $0.04", "under a
 * cent", or "cost not known" for a press whose estimate could not be read.
 * A total with some lines unpriced says so rather than reading as complete.
 */
export function paidCostWords(cost: CostEstimate | PaidTotal | null): string {
  if (cost == null) return 'cost not known';
  const unpriced = 'unpriced' in cost ? cost.unpriced : 0;
  const pricedAny = !('unpriced' in cost) || cost.medianMicros > 0 || unpriced === 0;
  if (!pricedAny) return 'cost not known';
  const dollars = approxDollars(cost.medianMicros);
  const head = dollars === 'under a cent' ? dollars : `about ${dollars}`;
  if (unpriced === 0) return head;
  return `${head}, and ${unpriced === 1 ? 'one' : unpriced} not priced`;
}

/**
 * Which turn each comment's queued paid presses are drawn under (plan
 * #2228.2): the last of Dash's replies straight after it, which says what
 * was queued, or the comment itself while no reply has come.
 */
export function paidCardHosts(turns: readonly DevComment[]): Map<string, PaidChange[]> {
  const hosts = new Map<string, PaidChange[]>();
  turns.forEach((comment, index) => {
    // Every one is a paid press: the store reads no other kind onto a comment.
    const paid = comment.author === 'me' ? (comment.paid as PaidChange[] | undefined) : undefined;
    if (!paid?.length) return;
    let host = index;
    while (turns[host + 1]?.author === 'claude') host += 1;
    const id = turns[host].id;
    // The comment's own list where it is the only one, so the card keeps its state across renders.
    const before = hosts.get(id);
    hosts.set(id, before ? [...before, ...paid] : paid);
  });
  return hosts;
}

