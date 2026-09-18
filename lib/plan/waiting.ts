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
 * four kinds it names -- an unanswered decision, a proposal nobody approved,
 * a blocked step, a setup job that was yours from the day it was written --
 * are exactly what belongs on Dash. Reading the same
 * function is what stops the two pages disagreeing by next month, and it
 * covers every row already sitting blocked rather than only ones filed from
 * here on.
 */
import {
  flatten,
  flattenSections,
  healthOf,
  needsThePerson,
  type PlanNode,
  type PlanSection,
} from './tree';
import type { RaisedQueue, RaisedRow } from '@/lib/raised/load';

/** One row of the section, flattened out of the tree it came from. */
export type WaitingRow = {
  id: string;
  number: number;
  title: string;
  module: PlanNode['module'];
  /**
   * `unanswered`, `proposed`, `blocked` or `setup` -- what kind of waiting it
   * is. The same names `healthOf` uses, because this reads it rather than
   * deciding again.
   */
  health: 'unanswered' | 'proposed' | 'blocked' | 'setup';
  /**
   * The one thing it needs, where the row says. A blocked step's ask; a
   * decision's own detail, which is the question; a setup step's own detail,
   * which is what you actually have to go and do -- #599 asked for the title
   * to be the one-line summary and the detail to be the instructions, and this
   * is the second half of that. Null on a proposal, where the title is the
   * whole of it.
   */
  ask: string | null;
  /**
   * The row's own detail, which on a question is the question and its lettered
   * options. Dash answers a question where it stands rather than sending you
   * to the plan page, and `planOptions` reads the options out of this.
   *
   * The same string as `ask` on a question and on a setup job; they are two
   * readings of the column rather than two columns, and the card shows one
   * while the answer box parses the other.
   */
  detail: string | null;
  /**
   * What you have already answered, on a question you answered and left open.
   * Null on everything else. The answer box shows it above the box and offers
   * to change it, the way the plan page does.
   */
  resolution: string | null;
  /**
   * How many proposed steps sit beneath this one, at any depth, not counting
   * the row itself. Approving a proposal approves everything proposed under
   * it, so this is what the button has to say it is about to approve.
   */
  proposedBeneath: number;
};

/**
 * The most recent block note, out of the running record.
 *
 * `comment` is appended to, never rewritten: `block` adds a dated paragraph
 * each time, so a step blocked four times carries four of them and the request
 * that still stands is the last. Since #552 a block writes its ask into
 * `block_ask` instead, which is one sentence and is rewritten rather than
 * appended. This is what is read for a row blocked before that column existed,
 * where the last dated paragraph is the closest thing to the current ask and
 * beats showing all four.
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
 * Most pressing first: blocked, then setup, then unanswered, then proposed.
 *
 * Blocked leads because it is the only one where work has already stopped
 * mid-build. A setup job comes next: nothing has stopped yet, but it is the
 * one entry here that is a job rather than a judgement, and it is done by
 * doing it. A question can sit for a day without costing anything; a proposal
 * costs nothing at all until you want it.
 */
const ORDER: Record<WaitingRow['health'], number> = {
  blocked: 0,
  setup: 1,
  unanswered: 2,
  proposed: 3,
};

export function waitingOnYou(sections: readonly PlanSection[]): WaitingRow[] {
  const rows: WaitingRow[] = [];

  for (const node of flattenSections(sections)) {
    // The row on its own terms, with nothing beneath it.
    //
    // `healthOf` reports a feature as blocked when every open step under it is,
    // and as the worst thing still open beneath it when it is closed. That is
    // right on the plan page, where the step it is speaking for is on the next
    // line. It is wrong here: this is a list of things to do, and #635 put a
    // feature on it with no ask, nothing to press and no way to see that the
    // one step it borrowed its "waiting" from was the very next row.
    //
    // So each row answers for itself. Nothing is lost by it -- a question, a
    // proposal, a block and a setup job are all rows in their own right, and
    // each one is still here under its own number, with the ask that says what
    // it wants.
    const row = { ...node, children: [] };
    if (!needsThePerson(row)) continue;
    const health = healthOf(row);
    if (
      health !== 'blocked' &&
      health !== 'unanswered' &&
      health !== 'proposed' &&
      health !== 'setup'
    ) {
      continue;
    }

    rows.push({
      id: node.id,
      number: node.number,
      title: node.title,
      module: node.module,
      health,
      detail: node.detail?.trim() || null,
      resolution: node.resolution?.trim() || null,
      // From the real node rather than from `row` above, which had its
      // children taken off it so that `healthOf` would answer for this row
      // alone.
      proposedBeneath: flatten([node]).filter(
        (step) => step.id !== node.id && step.status === 'proposed',
      ).length,
      ask:
        health === 'blocked'
          ? (node.blockAsk?.trim() || latestBlockNote(node.comment))
          : health === 'unanswered' || health === 'setup'
            ? (node.detail?.trim() || null)
            : null,
    });
  }

  return rows.sort((a, b) => ORDER[a.health] - ORDER[b.health] || a.number - b.number);
}

/**
 * The three groups the Dash section is drawn in.
 *
 * `actions` is what you have to go and do: a step stopped on something only
 * you can supply, and a setup job that was yours from the day it was written.
 * `questions` is what you have to answer in words. `approve` is what you only
 * have to say yes to.
 *
 * The split is by what finishes the row, not by where it came from, which is
 * why a raise and a plan row can sit in the same group. One list sorted by
 * urgency asked you to work out for each row which of those three it was.
 */
export type WaitingGroupKey = 'actions' | 'questions' | 'approve';

/**
 * One row of a group, as the page draws it: a plan row takes the plan card and
 * a raise takes the raise card, and each carries what finishes it.
 */
export type WaitingEntry =
  | { kind: 'plan'; id: string; row: WaitingRow }
  | { kind: 'raise'; id: string; raise: RaisedRow };

export type WaitingGroup = {
  key: WaitingGroupKey;
  /** The heading, and the only place it is written. */
  title: string;
  entries: WaitingEntry[];
};

const GROUP_TITLE: Record<WaitingGroupKey, string> = {
  actions: 'Your actions',
  questions: 'Questions for you',
  approve: 'To approve',
};

/** Which group a plan row finishes in. */
const PLAN_GROUP: Record<WaitingRow['health'], WaitingGroupKey> = {
  blocked: 'actions',
  setup: 'actions',
  unanswered: 'questions',
  proposed: 'approve',
};

/**
 * Which group a raise finishes in: #622 settled that one naming an action Dash
 * will run on a yes goes under To approve, and the rest are questions.
 *
 * A guess, and known to be one. The column was written to say what a yes does,
 * not to sort the row, so a raise that named an action and also wants a
 * paragraph back lands under To approve. It costs nothing to be wrong: the row
 * carries its own buttons whichever heading it is drawn under, and #630 keeps
 * Approve all off them.
 */
function groupOf(raise: RaisedRow): WaitingGroupKey {
  return raise.consequence ? 'approve' : 'questions';
}

/**
 * Everything waiting on you, in the three groups, most pressing group first.
 *
 * Both halves of the list in one pass: the plan rows `waitingOnYou` derives
 * and the raises sessions filed. Empty groups are returned as well as full
 * ones, so the page decides what an empty one looks like rather than having to
 * work out which of the three is missing.
 *
 * Plan rows lead each group. A step that has stopped is work already begun and
 * not moving, where a raise is a question that can wait, and the same ordering
 * held when the two were one list.
 */
export function waitingGroups(
  sections: readonly PlanSection[],
  queue: Pick<RaisedQueue, 'open'>,
): WaitingGroup[] {
  const entries: Record<WaitingGroupKey, WaitingEntry[]> = {
    actions: [],
    questions: [],
    approve: [],
  };

  for (const row of waitingOnYou(sections)) {
    entries[PLAN_GROUP[row.health]].push({ kind: 'plan', id: row.id, row });
  }
  // In the order the queue reads them, newest first, which is the order they
  // were in when every raise sat in one fold.
  for (const raise of queue.open) {
    entries[groupOf(raise)].push({ kind: 'raise', id: raise.id, raise });
  }

  return (['actions', 'questions', 'approve'] as const).map((key) => ({
    key,
    title: GROUP_TITLE[key],
    entries: entries[key],
  }));
}
