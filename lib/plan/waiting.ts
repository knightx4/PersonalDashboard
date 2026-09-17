/**
 * What the plan is waiting on you for, for the Dash tab.
 *
 * Dash already has a "Waiting on you" section and it reads one table: raises.
 * A step that cannot move until you supply something reaches it through no
 * path at all -- #499 sat blocked on a GitHub token for a day while that
 * section said "Nothing waiting on you", because the request had gone into the
 * step's own `comment` column, where the CLI appends it.
 *
 * Derived rather than filed. A session does not have to remember to raise
 * anything: `needsThePerson` already decides this for the plan page, and the
 * three kinds it names -- an unanswered decision, a proposal nobody approved,
 * a blocked step -- are exactly what belongs on Dash. Reading the same
 * function is what stops the two pages disagreeing by next month, and it
 * covers every row already sitting blocked rather than only ones filed from
 * here on.
 */
import {
  flattenSections,
  healthOf,
  needsThePerson,
  type PlanNode,
  type PlanSection,
} from './tree';

/** One row of the section, flattened out of the tree it came from. */
export type WaitingRow = {
  id: string;
  number: number;
  title: string;
  module: PlanNode['module'];
  /** `unanswered`, `proposed` or `blocked` -- what kind of waiting it is. */
  health: 'unanswered' | 'proposed' | 'blocked';
  /**
   * The one thing it needs, where the row says. A blocked step's most recent
   * block note; a decision's own detail, which is the question. Null on a
   * proposal, where the title is the whole of it.
   */
  ask: string | null;
};

/**
 * The most recent block note, out of the running record.
 *
 * `comment` is appended to, never rewritten: `block` adds a dated paragraph
 * each time, so a step blocked four times carries four of them and the request
 * that still stands is the last. #552 gives a block its own field and this
 * stops guessing; until then, the last paragraph opening with a date is the
 * closest thing to the current ask, and it beats showing all four.
 */
export function latestBlockNote(comment: string | null): string | null {
  if (!comment) return null;
  const blocks = comment
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => /^Blocked\b/i.test(part));
  const last = blocks.at(-1);
  if (!last) return null;
  // Past "Blocked 2026-09-16: ", which is the stamp rather than the request.
  return last.replace(/^Blocked\s+\d{4}-\d{2}-\d{2}:\s*/i, '').trim() || null;
}

/**
 * Most pressing first: blocked, then unanswered, then proposed.
 *
 * Blocked leads because it is the only one where work has already stopped. A
 * question can sit for a day without costing anything; a proposal costs
 * nothing at all until you want it.
 */
const ORDER: Record<WaitingRow['health'], number> = {
  blocked: 0,
  unanswered: 1,
  proposed: 2,
};

export function waitingOnYou(sections: readonly PlanSection[]): WaitingRow[] {
  const rows: WaitingRow[] = [];

  for (const node of flattenSections(sections)) {
    if (!needsThePerson(node)) continue;
    const health = healthOf(node);
    if (health !== 'blocked' && health !== 'unanswered' && health !== 'proposed') continue;

    rows.push({
      id: node.id,
      number: node.number,
      title: node.title,
      module: node.module,
      health,
      ask:
        health === 'blocked'
          ? latestBlockNote(node.comment)
          : health === 'unanswered'
            ? (node.detail?.trim() || null)
            : null,
    });
  }

  return rows.sort((a, b) => ORDER[a.health] - ORDER[b.health] || a.number - b.number);
}
