/**
 * Handing plan work to a session, with the checks that go with it.
 *
 * One step below, a whole feature at the bottom. Both end the same way -- an
 * instruction, the brief, and a `plan_runs` row saying it was fired -- and the
 * rules about what may be sent are here rather than in any caller.
 *
 * The button on the plan page was the only way to do this, so the rules about
 * what may be sent lived inside that button: a proposal is not work yet, a
 * question is the person's to answer, and a feature already being worked takes
 * one session and not two. There is now a second way in — telling Dash to
 * build something in a comment — and rules enforced in one of two callers are
 * rules that hold half the time, so they live here and both callers use them.
 *
 * Every read and write goes through the client it is handed, so the row's own
 * policies check the ownership.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { planRoutine } from '@/lib/feedback/routine';
import { claimIsLive, runReplacedNote, sendOverClaim, underwayRefusal } from './liveness';
import { planBrief } from './brief';
import { endRunsOnStep, loadLastRuns, reshapeUnderway, startRoutineRun } from './runs';
import { isClosed, loadPlan } from './load';
import {
  buildPlanTree,
  findNode,
  flatten,
  isWaitingOnThePerson,
  planLiveness,
  topFeatureOf,
  type PlanSection,
} from './tree';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

export type HandOverResult =
  | {
      ok: true;
      number: number;
      title: string;
      /** Rows beneath it that went with it, at any depth. */
      beneath: number;
      /** What the routine said when it started. */
      detail: string;
      /** Whether the row itself changed, so the page needs redrawing. */
      changed: boolean;
    }
  | {
      ok: false;
      error: string;
      /**
       * The same press, sent again with `confirmQuiet`, would go through.
       *
       * Only on the one refusal that is really a question -- a step whose run
       * has gone quiet, which #574 settled is asked about rather than refused.
       * The caller needs to tell that from the refusals that stay refusals
       * however many times they are pressed, so that it offers a confirmation
       * on the first and not on the others.
       */
      confirm?: true;
    };

/**
 * Send a step to be built, now.
 *
 * It refuses a proposal — approving is the person's move — a question and a
 * blocked step, both of which are waiting on them rather than on a session,
 * and anything under a feature that already has a session running, because a
 * batch holds the whole feature and a second run would land in the middle of
 * it. Taking the first one back (to not started) is how that last one is
 * overridden when a session has died.
 */
export async function handStepToClaude(input: {
  supabase: Db;
  userId: string;
  /** The step's id, not its number. */
  id: string;
  /**
   * Send it even though its run has gone quiet, and write that run off.
   *
   * The answer to the question the refusal asked, so it only means anything on
   * a step whose claim reads `quiet`. It does not loosen any other refusal: a
   * run still pushing is still refused, and so is a question, a proposal and a
   * feature with another session in it.
   */
  confirmQuiet?: boolean;
}): Promise<HandOverResult> {
  const { supabase, userId } = input;

  const sections = buildPlanTree(await loadPlan(supabase, userId));
  const node = findNode(sections, input.id);
  if (!node) return { ok: false, error: 'That step no longer exists.' };

  if (node.status === 'proposed') {
    return { ok: false, error: `#${node.number} is only a proposal. Approve it first.` };
  }

  if (isWaitingOnThePerson(node)) {
    return {
      ok: false,
      error:
        node.status === 'blocked'
          ? `#${node.number} is blocked on something outside the repo. Clear what it is waiting on first -- its note says what.`
          : `#${node.number} is a question. Answer it and the plan moves; a session sent at it would be answering it for you.`,
    };
  }

  // One session per feature at a time.
  //
  // Two sessions were sent at #342 within moments of each other on 13
  // September, and both would have been editing the same files. Nothing but
  // timing kept them apart, because nothing here knew the other was running.
  //
  // Only a live claim refuses. A claim whose run has ended is a session that
  // stopped without closing its step, and a guard that took the status at its
  // word left the feature refusing work forever -- a lock outliving the run it
  // was protecting is worse than the collision it was added for.
  //
  // Which claims are live is `claimLiveness`, the same function the page's
  // health column and the brief read, so the button cannot refuse a step the
  // page is drawing as stopped. A quiet run still counts as live: the
  // twenty-minute mark reads wrong on a session that is reading files, and
  // #574 settled that a quiet step is re-sent by asking first.
  const feature = topFeatureOf(sections, node);
  const now = Date.now();
  const runs = await loadLastRuns(supabase, userId);

  // A re-shape is rewriting this feature. Sending a step out of it now hands a
  // session a plan that is about to change underneath it -- the steps it would
  // build may be dropped, reworded or superseded before it finishes reading
  // the brief. The page greys the button for this; a press can still arrive
  // from a tab that was open before the run started, so it is asked again here.
  if (await reshapeUnderway(supabase, userId, feature.id, now)) {
    return {
      ok: false,
      error: `#${feature.number} is being re-read against the answers under it. Wait for that to finish -- what it proposes may change this step.`,
    };
  }

  const liveness = planLiveness(flatten([feature]), runs, now);
  const underway = flatten([feature]).filter((step) => claimIsLive(liveness[step.id] ?? null));
  const other = underway.find((step) => step.id !== node.id);

  // The claim on this step itself, which #574 made answerable rather than a
  // flat refusal. A run still pushing is refused as it always was, a run that
  // has stopped goes through as it always has, and a quiet one is asked about:
  // the twenty-minute mark reads wrong on a session that is reading files, so
  // the press is taken with the evidence in front of you rather than on the
  // mark alone. The rule is in `sendOverClaim` so this and the button on the
  // page cannot disagree about which press gets asked about.
  const own = sendOverClaim({
    number: node.number,
    liveness: liveness[node.id] ?? null,
    run: runs[node.id],
    now,
    confirmed: input.confirmQuiet === true,
  });
  if (!own.send) {
    return { ok: false, error: own.ask, ...(own.confirmable ? { confirm: true as const } : {}) };
  }

  // A different step under this feature is held, and #587 settled that a quiet
  // run holds it exactly as a working one does: the press is refused rather
  // than asked about, because the twenty-minute mark reads wrong on a session
  // that is reading files and spending that reading here puts two sessions in
  // the same files on different work. The step the quiet run was sent at is
  // the one exception and it is `own` above, which asks. The refusal names how
  // long the sibling has been silent, so the decision to put it back is made
  // on the evidence rather than by opening the row.
  if (other) {
    return {
      ok: false,
      error: underwayRefusal({
        press: 'step',
        number: other.number,
        title: other.title,
        liveness: liveness[other.id] ?? null,
        run: runs[other.id],
        now,
      }),
    };
  }

  // The run this press is replacing stops here.
  //
  // Only when a quiet claim was confirmed through: every other send either had
  // no run to replace or had one already written off. Before the new run is
  // started rather than after, so that there is never an instant with two rows
  // reading `started` against one step -- `loadLastRuns` takes the newest of
  // them and the page would be reading a run nobody is on.
  const replacing = input.confirmQuiet === true ? runs[node.id] : undefined;
  if (replacing && replacing.status === 'started') {
    await endRunsOnStep({
      supabase,
      userId,
      stepId: node.id,
      note: runReplacedNote(replacing, now),
    });
  }

  // Handed over and underway, in the one write. A step sent to Claude is being
  // built from the moment the routine wakes, and a plan still reading "not
  // started" while a session works it is the plan lying about itself -- the one
  // thing it is not allowed to do. `started_at` comes from the trigger, so the
  // page can also say how long it has been going.
  const patch: Record<string, string> = {};
  if (node.assignee !== 'claude') patch.assignee = 'claude';
  // Only a step nobody has started moves. A blocked one keeps its status and
  // its reason, and one already underway keeps the clock it started on.
  if (node.status === 'not_started') patch.status = 'in_progress';
  const changed = Object.keys(patch).length > 0;
  if (changed) {
    const { error } = await supabase
      .from('plan_items')
      .update(patch)
      .eq('id', node.id)
      .eq('user_id', userId);
    if (error) return { ok: false, error: error.message };
  }

  // A leaf step is sent straight to the build procedure rather than to the
  // skill's front door. The front door's job is to route between the jobs and
  // to orchestrate a batch, and neither applies to one step -- reading it is a
  // couple of hundred lines the session then carries for the whole run. A step
  // with anything beneath it is a batch, so it goes to the front door.
  const alone = flatten([node]).length === 1;
  const text = alone
    ? `Build plan step #${node.number}, "${node.title}", following ` +
      '.claude/skills/plan/reference/building.md. The brief is below; it is the plan as the ' +
      'app holds it right now, and the plan is the source of truth -- claim the step, build ' +
      'it, verify, commit with the step number in the subject, and close it with a note. ' +
      'Push when it is closed.\n\n' +
      planBrief(sections, node, { thread: true, liveness })
    : `Build plan step #${node.number}, "${node.title}", and the steps beneath it, following ` +
      '.claude/skills/plan/SKILL.md -- the Building section, which has more than one step to ' +
      'build and so is orchestrated: send each step to its own subagent and keep your own ' +
      'context for the batch. The brief is below; it is the plan as the app holds it right ' +
      'now, and the plan is the source of truth.\n\n' +
      planBrief(sections, node, { thread: true, liveness });

  const result = await startRoutineRun({
    supabase,
    userId,
    job: 'step',
    routine: planRoutine(),
    planItemId: node.id,
    text,
  });
  if (!result.ok) return { ok: false, error: result.error };

  return {
    ok: true,
    number: node.number,
    title: node.title,
    // The brief carries the step's whole subtree under "## Steps", so sending
    // a higher-level row hands over rather more than the row that was clicked.
    beneath: flatten([node]).length - 1,
    detail: result.detail,
    changed,
  };
}

/** What sending a whole feature came back with. */
export type FeatureHandOver =
  | {
      ok: true;
      number: number;
      title: string;
      /** Open steps beneath it that went with it, at any depth. */
      steps: number;
      /** What the routine said when it started. */
      detail: string;
      /** Whether any row changed, so the page needs redrawing. */
      changed: boolean;
    }
  | {
      ok: false;
      error: string;
      /**
       * The feature itself cannot be sent, as opposed to the send breaking.
       *
       * The five guards above -- gone, proposal, re-shape underway, a live
       * claim beneath it, nothing open -- are all facts about this one
       * feature, and every one of them is still true in four minutes' time.
       * A caller working a queue should take the feature out and ask for
       * another. That is what the overnight tick does with it.
       *
       * Left off when the send itself failed: a write that errored or a
       * routine that would not start says nothing about which feature was
       * chosen, and the next feature would hit the same wall. Those stop the
       * caller rather than costing it a candidate.
       */
      refused?: true;
    };

/**
 * Hand a whole feature over and start the routine on it now.
 *
 * The press on the plan page and the overnight tick both do this, and they
 * have to do it identically: the same refusals, the same cascade, and above
 * all the same instruction, because a second copy of that paragraph is a
 * second thing to keep in step and the first one to drift is the one nobody
 * is watching at three in the morning. So the whole thing is here and both
 * callers ask for it; the page turns the answer into a sentence for the
 * toast, and the tick turns it into a log line and a number off the budget.
 *
 * It refuses a proposal, because a proposal is not work yet, and it refuses a
 * feature with nothing open beneath it, because there would be nothing to do.
 * Proposed steps beneath an approved feature are left alone rather than swept
 * in: a step nobody has said yes to is not part of the batch.
 *
 * `sections` is the tree when the caller has already built it. The tick has --
 * it chose the feature out of it -- and re-reading the whole plan to send what
 * it just chose would be a second read of rows that cannot have moved.
 */
export async function handFeatureToClaude(input: {
  supabase: Db;
  userId: string;
  /** The feature's id, not its number. */
  id: string;
  /** The plan, when the caller already has it. Read here otherwise. */
  sections?: readonly PlanSection[];
  now?: number;
}): Promise<FeatureHandOver> {
  const { supabase, userId } = input;
  const sections = input.sections ?? buildPlanTree(await loadPlan(supabase, userId));
  const node = findNode(sections, input.id);
  if (!node) return { ok: false, error: 'That step no longer exists.', refused: true };

  if (node.status === 'proposed') {
    return {
      ok: false,
      error: `#${node.number} is only a proposal. Approve it first.`,
      refused: true,
    };
  }

  const now = input.now ?? Date.now();

  // The same refusal as the single send, and more clearly right here: the
  // batch hands over every open step under a feature a re-shape is in the
  // middle of rewriting.
  if (await reshapeUnderway(supabase, userId, node.id, now)) {
    return {
      ok: false,
      error: `#${node.number} is being re-read against the answers under it. Wait for that to finish -- what it proposes may change these steps.`,
      refused: true,
    };
  }

  // The same one-at-a-time rule as the single send, read the same way: off the
  // run behind each claim rather than off the clock. A batch started on top of
  // a running session is the worse version of the same collision, since it
  // hands the whole feature to a second run.
  const runs = await loadLastRuns(supabase, userId);
  const liveness = planLiveness(flatten([node]), runs, now);
  const running = flatten([node]).find((step) => claimIsLive(liveness[step.id] ?? null));
  if (running) {
    return {
      ok: false,
      error: underwayRefusal({
        press: 'feature',
        number: running.number,
        title: running.title,
        liveness: liveness[running.id] ?? null,
        run: runs[running.id],
        now,
      }),
      refused: true,
    };
  }

  // Itself included: a feature is closed when its steps are, and the session
  // needs it to be its own to close.
  //
  // Minus whatever is waiting on the person. A batch that swept up the
  // feature's unanswered questions and its blocked steps handed a session rows
  // it could do nothing with, and left them sitting in the Claude's view saying
  // why they could not be worked.
  const open = flatten([node]).filter(
    (step) => !isClosed(step.status) && step.status !== 'proposed' && !isWaitingOnThePerson(step),
  );
  if (open.length === 0) {
    return {
      ok: false,
      error: 'Nothing open under that step that is not waiting on you.',
      refused: true,
    };
  }

  const toHandOver = open.filter((step) => step.assignee !== 'claude').map((step) => step.id);
  let changed = false;
  if (toHandOver.length > 0) {
    const { error } = await supabase
      .from('plan_items')
      .update({ assignee: 'claude' })
      .in('id', toHandOver)
      .eq('user_id', userId);
    if (error) return { ok: false, error: error.message };
    changed = true;
  }

  // Handed over, and that is all. Nothing here is marked underway.
  //
  // This used to set every open step in the feature to `in_progress` on the
  // press, so that the plan showed the batch as work in hand. What it actually
  // showed was six lies and one truth: the session works the steps one at a
  // time, and everything it had not reached yet -- everything it never reached,
  // when a batch ran short or the run died -- sat there reading "in progress"
  // with nothing on it. That is the bug behind note 60a0ad01, and there is no
  // clock that fixes it, because the rows were never true in the first place.
  //
  // `in_progress` now means one thing: a session has claimed this step and is
  // on it. The session sets it when it claims, one at a time, and clears it
  // when it closes the step -- which is what the plan skill already tells it to
  // do. "Handed to Claude" is a separate fact and has its own state:
  // `assignee`, set above, which is exactly what this press changes and what
  // the queue is built from.
  const text =
    `Work plan feature #${node.number}, "${node.title}", to completion, following ` +
    '.claude/skills/plan/SKILL.md. This is a batch, so it is orchestrated: send each step ' +
    'to its own subagent, in the order the plan gives, and do not read the steps\' source ' +
    'files or make the edits yourself. Keep the carry-forward between them. Stop at the ' +
    'first step that needs a decision from me: block it with the exact question rather ' +
    'than guessing, and do not skip past it to a later step that depends on it. Run the ' +
    'gate once at the end, push once, and report every step you closed, by number and ' +
    'title.\n\nThe brief is below; it is the plan as the app holds it right now, and ' +
    'the plan is the source of truth.\n\n' +
    planBrief(sections, node, { thread: true, liveness });

  const result = await startRoutineRun({
    supabase,
    userId,
    job: 'feature',
    routine: planRoutine(),
    planItemId: node.id,
    text,
  });
  if (!result.ok) return { ok: false, error: result.error };

  return {
    ok: true,
    number: node.number,
    title: node.title,
    steps: open.length - 1,
    detail: result.detail,
    changed,
  };
}
