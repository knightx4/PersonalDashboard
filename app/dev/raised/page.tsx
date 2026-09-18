import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { loadRaised } from '@/lib/raised/load';
import { loadPlan, planRefTitles } from '@/lib/plan/load';
import { buildPlanTree } from '@/lib/plan/tree';
import { waitingGroups } from '@/lib/plan/waiting';
import { loadDigest } from '@/lib/digest/load';
import { loadConversations } from '@/lib/comments/recent';
import { loadFeatureFires, loadLastRuns } from '@/lib/plan/runs';
import { lastStoredPush } from '@/lib/plan/liveness';
import { loadOvernightRun, overnightStanding } from '@/lib/plan/overnight';
import { nightFrom } from '@/lib/digest/night';
import { planRoutine } from '@/lib/feedback/routine';
import { ConversationsView } from './conversations-view';
import { DigestPanel } from './digest-panel';
import { RaisedView } from './raised-view';
import { StatusPanel } from './status-panel';

export const metadata = { title: 'Dash' };

/**
 * The page you open in the morning: your day, and your conversations.
 *
 * Three sections, in the order you want them. The summary of the last 24 hours
 * is written once a day by the cron rather than built here, so opening the page
 * never costs a model call. Then what sessions have raised: a session that runs
 * into something outside the step it is building would otherwise say it in the
 * transcript, where you find it by opening Claude. Not the notes queue next
 * door, which is what you report as wrong, and not a plan decision, which
 * belongs to one feature.
 *
 * Then every conversation you have had, wherever it was started. A thread used
 * to be visible only from the row it was written on, which meant finding an
 * answer by remembering where the question was asked.
 *
 * Above all three, what is running. The two routines' states were on two other
 * pages, so the first question of the morning was the one this page could not
 * answer -- see `StatusPanel`.
 *
 * The route stays /dev/raised though the tab is called Dash -- #431 -- because
 * every notification, comment and old summary already links to it.
 */
export default async function DevRaisedPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [queue, digest, conversations, plan, overnight, fires, lastRuns, openNotes] =
    await Promise.all([
      loadRaised(supabase, user.id),
      loadDigest(supabase, user.id),
      loadConversations(supabase, user.id),
      loadPlan(supabase, user.id),
      // The runner's standing intention, and the presses its night has made:
      // the same rows and the same loaders /dev/plan reads, so the two pages
      // cannot come to different answers about what is running.
      loadOvernightRun(supabase, user.id),
      loadFeatureFires(supabase, user.id),
      loadLastRuns(supabase, user.id),
      // A count, not the rows: what makes "run it" answerable is how many are
      // waiting, and the queue itself is one link away.
      supabase
        .from('feedback_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .in('status', ['open', 'in_progress', 'blocked', 'planned']),
    ]);

  // The night as `nightFrom` reads it, exactly as the plan page reads it: the
  // control's totals come from the same rows the morning report is written
  // from, so nothing here can disagree with the digest below it.
  const standing = overnightStanding(overnight);
  const startedAt = overnight?.startedAt ?? null;
  const live = (standing === 'running' || standing === 'paused') && startedAt !== null;
  const night = live
    ? nightFrom({ run: overnight, fires, items: plan.items, since: startedAt })
    : null;
  const nightPush = live ? lastStoredPush(Object.values(lastRuns), startedAt) : null;

  // Everything waiting on you, in the three groups the section is drawn in:
  // what you have to go and do, what you have to answer, what you only have to
  // say yes to. Both halves in one call -- the plan's own (a blocked step, an
  // unanswered decision, a proposal nobody approved, all derived here rather
  // than filed by a session, so a step blocked on a credential reaches this
  // page without anybody remembering to raise it as well) and the raises the
  // queue is holding open.
  const groups = waitingGroups(buildPlanTree(plan), queue);

  // What every "#494" on this page is called. Built once here rather than
  // looked up where each one is drawn: a raise with nine references in it
  // would otherwise be nine lookups inside a render.
  const titles = planRefTitles(plan);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Dash"
        description="What happened in the last day, the questions waiting on you, and every conversation you have had with Dash. Answer a question and the next run reads it; reply to a conversation and it goes back on the row it was started on."
      />
      <StatusPanel
        run={overnight}
        canSend={Boolean(planRoutine().token)}
        night={night}
        push={nightPush}
        openNotes={openNotes.count ?? 0}
      />
      <DigestPanel digest={digest} />
      <RaisedView queue={queue} groups={groups} titles={titles} />
      <ConversationsView conversations={conversations} titles={titles} />
    </div>
  );
}
