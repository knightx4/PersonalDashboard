import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { loadRaised } from '@/lib/raised/load';
import { loadPlan, planRefTitles } from '@/lib/plan/load';
import { buildPlanTree } from '@/lib/plan/tree';
import { waitingOnYou } from '@/lib/plan/waiting';
import { loadDigest } from '@/lib/digest/load';
import { loadConversations } from '@/lib/comments/recent';
import { ConversationsView } from './conversations-view';
import { DigestPanel } from './digest-panel';
import { RaisedView } from './raised-view';

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
 * The route stays /dev/raised though the tab is called Dash -- #431 -- because
 * every notification, comment and old summary already links to it.
 */
export default async function DevRaisedPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [queue, digest, conversations, plan] = await Promise.all([
    loadRaised(supabase, user.id),
    loadDigest(supabase, user.id),
    loadConversations(supabase, user.id),
    loadPlan(supabase, user.id),
  ]);

  // The plan's own half of "waiting on you": a blocked step, an unanswered
  // decision, a proposal nobody approved. Derived here rather than filed by a
  // session, so a step blocked on a credential reaches this page without
  // anybody remembering to raise it as well.
  const waiting = waitingOnYou(buildPlanTree(plan));

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
      <DigestPanel digest={digest} />
      <RaisedView queue={queue} waiting={waiting} titles={titles} />
      <ConversationsView conversations={conversations} titles={titles} />
    </div>
  );
}
