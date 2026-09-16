/**
 * Handing one plan step to a session, with the checks that go with it.
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
import { fireFeatureRoutine, planRoutine } from '@/lib/feedback/routine';
import { hasLiveClaim } from './elapsed';
import { planBrief } from './brief';
import { loadPlan } from './load';
import { buildPlanTree, findNode, flatten, isWaitingOnThePerson, topFeatureOf } from './tree';

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
  | { ok: false; error: string };

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
  // Only a live claim refuses. A claim nothing has touched for two hours is a
  // session that stopped without closing its step, and a guard that took the
  // status at its word left the feature refusing work forever -- a lock
  // outliving the run it was protecting is worse than the collision it was
  // added for. The page has read the clock beside the status since it started
  // calling these stalled; this reads the same clock.
  const feature = topFeatureOf(sections, node);
  const now = Date.now();
  const underway = flatten([feature]).filter((step) => hasLiveClaim(step, now));
  const other = underway.find((step) => step.id !== node.id);
  if (underway.some((step) => step.id === node.id)) {
    return {
      ok: false,
      error: `#${node.number} is already underway. Put it back to not started first if the session that had it is gone.`,
    };
  }
  if (other) {
    return {
      ok: false,
      error: `#${other.number} ${other.title} is underway under the same feature. Wait for it, or put it back to not started if its session is gone.`,
    };
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
      planBrief(sections, node, { thread: true })
    : `Build plan step #${node.number}, "${node.title}", and the steps beneath it, following ` +
      '.claude/skills/plan/SKILL.md -- the Building section, which has more than one step to ' +
      'build and so is orchestrated: send each step to its own subagent and keep your own ' +
      'context for the batch. The brief is below; it is the plan as the app holds it right ' +
      'now, and the plan is the source of truth.\n\n' +
      planBrief(sections, node, { thread: true });

  const routine = planRoutine();
  const result = await fireFeatureRoutine({
    apiKey: routine.token,
    routineId: routine.id,
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
