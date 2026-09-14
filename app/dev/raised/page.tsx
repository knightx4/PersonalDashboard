import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { loadRaised } from '@/lib/raised/load';
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
  const [queue, digest, conversations] = await Promise.all([
    loadRaised(supabase, user.id),
    loadDigest(supabase, user.id),
    loadConversations(supabase, user.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Dash"
        description="What happened in the last day, the questions waiting on you, and every conversation you have had with Dash. Answer a question and the next run reads it; reply to a conversation and it goes back on the row it was started on."
      />
      <DigestPanel digest={digest} />
      <RaisedView queue={queue} />
      <ConversationsView conversations={conversations} />
    </div>
  );
}
