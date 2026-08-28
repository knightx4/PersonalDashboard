import { requireUser } from '@/lib/jobs/auth/server';
import { createClient } from '@/lib/auth/server';
import { PageHeader } from '@/components/jobs/shell/page-header';
import { FeedbackQueueView } from '@/components/feedback/feedback-queue';
import { loadFeedbackQueue } from '@/lib/feedback/load';

export const metadata = { title: 'Bugs and requests' };

/**
 * The same queue the shopping side shows.
 *
 * `feedback_items` lives in `public` rather than in either workspace's schema,
 * which is why this reaches for the commerce client: a bug is a bug wherever
 * you were standing when you hit it, and two lists would only mean two places
 * to forget something. The jobs shell is the only difference.
 */
export default async function JobsFeedbackPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const queue = await loadFeedbackQueue(supabase, user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Bugs and requests"
        description="Everything captured from the header button, from either workspace. Say “knock out the notes” in a session to have them worked top to bottom."
      />
      <FeedbackQueueView queue={queue} />
    </div>
  );
}
