import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { suggestForDigest, type DigestContext } from '@/inngest/dev/suggest';
import { oneLine, whatHappened, whatIsReady, withSuggestions } from '@/lib/digest/build';
import { loadFeedbackQueue } from '@/lib/feedback/load';
import { loadIdeas } from '@/lib/ideas/load';
import { hasLiveFog, isDismissed, loadPlan, type PlanData, type PlanItem } from '@/lib/plan/load';
import { loadRaised } from '@/lib/raised/load';

/**
 * Writing the morning summary shown at the top of /dev/raised.
 *
 * A stage of the daily cron rather than a page load, for two reasons. The
 * suggestions cost a model call, and a summary rebuilt on every reload would
 * say something slightly different each time -- which is the opposite of what
 * a thing you read once in the morning is for.
 *
 * Idempotent by the unique constraint on (user_id, day): a retried cron finds
 * today's row already there and leaves it alone. That is also what makes the
 * summary the same all day.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How much of the board the model is shown. Enough to see a pattern in. */
const CONTEXT_LIMIT = 20;

export type DigestSummary = { written: number; skipped: number };

/** The UTC date the run started, which is the day the row covers. */
export function dayOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Whose plan to summarise.
 *
 * Everybody with a plan row, rather than everybody with an account. The dev
 * workspace is where this app is built and most accounts have nothing in it;
 * a summary of an empty plan is an empty page plus a model call.
 */
async function usersWithAPlan(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from('plan_items').select('user_id').limit(5000);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((row) => (row as { user_id: string }).user_id))];
}

/** `#12 The title`, the way a person refers to a step out loud. */
function ref(item: Pick<PlanItem, 'number' | 'title'>): string {
  return `#${item.number} ${oneLine(item.title)}`;
}

function daysAgo(at: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(at).getTime()) / DAY_MS);
}

/**
 * What the model is shown: the open state of the plan, and what closed
 * overnight so it does not report back what the page already says.
 *
 * Nothing dismissed is in it. A question put aside as not right now, or a
 * patch of fog put aside, is exactly the thing a summary must not raise again
 * -- that is what dismissing it was for. `workOrder` already drops them from
 * the ready list; these lists are read straight off the rows, so they say so
 * themselves.
 */
async function contextFor(input: {
  supabase: SupabaseClient;
  userId: string;
  now: Date;
  plan: PlanData;
  shipped: readonly string[];
}): Promise<DigestContext> {
  const { supabase, userId, now, plan } = input;
  const [ideas, raised] = await Promise.all([
    loadIdeas(supabase, userId),
    loadRaised(supabase, userId),
  ]);

  const open = plan.items.filter(
    (item) => item.status !== 'done' && item.status !== 'dropped' && !isDismissed(item),
  );

  return {
    openDecisions: open
      .filter((item) => item.kind === 'decision')
      .slice(0, CONTEXT_LIMIT)
      .map(ref),
    blockedSteps: open
      .filter((item) => item.status === 'blocked')
      .slice(0, CONTEXT_LIMIT)
      .map((item) => `${ref(item)} — ${oneLine(item.comment ?? 'no reason recorded', 200)}`),
    fogPatches: open
      .filter((item) => hasLiveFog(item))
      .slice(0, CONTEXT_LIMIT)
      .map((item) => `${ref(item)}: ${oneLine(item.fog as string, 300)}`),
    inProgress: open
      .filter((item) => item.status === 'in_progress')
      .slice(0, CONTEXT_LIMIT)
      .map(ref),
    // Yours and a session's own follow-ons, both unshaped and neither
    // dismissed -- which is what `mine` and `suggested` already mean.
    unshapedIdeas: [...ideas.mine, ...ideas.suggested]
      .slice(0, CONTEXT_LIMIT)
      .map((idea) => `${oneLine(idea.body)} (filed ${daysAgo(idea.createdAt, now)} days ago)`),
    openRaises: raised.open
      .slice(0, CONTEXT_LIMIT)
      .map((row) => `${oneLine(row.title)} — ${oneLine(row.ask ?? 'no ask recorded', 200)}`),
    shipped: [...input.shipped],
  };
}

/**
 * One account's summary, written if today's is not already there.
 *
 * Returns whether a row was written, so the cron can say what it did. The
 * suggestions are best-effort: without ANTHROPIC_API_KEY, and on any failure
 * inside the call, the factual half is still worth writing.
 */
export async function writeDigestFor(
  supabase: SupabaseClient,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  const day = dayOf(now);

  const { data: existing } = await supabase
    .from('dev_digests')
    .select('id')
    .eq('user_id', userId)
    .eq('day', day)
    .maybeSingle();
  if (existing) return false;

  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const [plan, notes] = await Promise.all([
    loadPlan(supabase, userId),
    loadFeedbackQueue(supabase, userId),
  ]);

  const happened = whatHappened({ plan, notes: notes.rows, since });
  const ready = whatIsReady(plan);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const suggestions = apiKey
    ? await suggestForDigest({
        apiKey,
        context: await contextFor({
          supabase,
          userId,
          now,
          plan,
          shipped: happened.map((event) => [event.ref, event.title].filter(Boolean).join(' ')),
        }),
      })
    : [];

  const { error } = await supabase.from('dev_digests').insert({
    user_id: userId,
    day,
    since,
    happened,
    attention: withSuggestions(ready, suggestions),
  });

  // A second cron tick racing the first loses the insert and that is the
  // right outcome: the row it lost to is today's summary.
  if (error) {
    if (error.code === '23505') return false;
    throw new Error(error.message);
  }
  return true;
}

/**
 * Every account's summary. One failure is reported and the rest still run,
 * the same way the daily cron isolates its stages.
 */
export async function runDevDigest(now = new Date()): Promise<DigestSummary> {
  const supabase = createServiceSupabase();
  const users = await usersWithAPlan(supabase);

  let written = 0;
  let skipped = 0;

  for (const userId of users) {
    try {
      if (await writeDigestFor(supabase, userId, now)) written += 1;
      else skipped += 1;
    } catch (error) {
      skipped += 1;
      console.error('[dev digest]', userId, error instanceof Error ? error.message : error);
    }
  }

  return { written, skipped };
}
