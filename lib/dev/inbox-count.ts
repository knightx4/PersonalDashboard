import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadSnoozeState } from '@/lib/core/inbox-snoozes-server';
import { planRowRef, raiseRef, withoutSnoozed } from '@/lib/dev/inbox-snoozes';
import { loadPlan, type PlanData } from '@/lib/plan/load';
import { countPlanRunQuestions } from '@/lib/plan/run-answer';
import { buildPlanTree } from '@/lib/plan/tree';
import { waitingOnYou } from '@/lib/plan/waiting';
import { loadOpenRaises } from '@/lib/raised/open-raises';
import { countProposedSpecChanges } from '@/lib/specs/changes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any>;

/**
 * How many things are waiting on the person in Dev: the number on the Inbox
 * tab's badge (app/dev/layout.tsx) and the number the finished-work
 * notification quotes (plan #2389). One function, so the two cannot differ.
 *
 * The badge is everything waiting on you, which is more than the raises. The
 * plan's half is derived the same way the Dash page derives the section it
 * lands in, `waitingOnYou` over the same tree, rather than counted again
 * here, because a badge that disagrees with the page it links to is worse
 * than no badge.
 *
 * `client` is the request's client from the layout, or a service-role client
 * in a job; every read is scoped by `userId`, so either returns the same
 * count. `options.plan` lets the layout hand in its per-request cached plan.
 */
export async function countDevInbox(
  client: Client,
  userId: string,
  options: { plan?: Promise<PlanData> } = {},
): Promise<number> {
  const [raised, plan, specChanges, runQuestions, snoozes] = await Promise.all([
    // The open raises, which the shell read for the bell until plan #1937.7.
    loadOpenRaises(userId, client),
    options.plan ?? loadPlan(client, userId),
    // Changes to specs waiting on a yes, which Home lists under To approve
    // (plan #1506).
    countProposedSpecChanges(client, userId),
    // Runs held on a question they asked partway, which the Inbox lists
    // under Need your answer (plan #1824).
    countPlanRunQuestions(client, userId),
    // Rows put aside until a later day leave the count too (plan #1843).
    loadSnoozeState(client, userId),
  ]);
  const waiting = withoutSnoozed(waitingOnYou(buildPlanTree(plan)), (row) => planRowRef(row.id), snoozes);
  const raisedAwake = withoutSnoozed(raised, (raise) => raiseRef(raise.id), snoozes);
  return raisedAwake.length + waiting.length + specChanges + runQuestions;
}
