import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { FeedbackQueueView } from '@/components/feedback/feedback-queue';
import { loadFeedbackQueue } from '@/lib/feedback/load';

export const metadata = { title: 'Bugs and requests' };

export default async function FeedbackPage() {
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
