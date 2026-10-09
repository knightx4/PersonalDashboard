import { createClient, requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { withNoteFiles } from '@/lib/feedback/files';
import { PageHeader } from '@/components/shell/page-header';
import { FeedbackQueueView } from '@/components/feedback/feedback-queue';
import { OtherUsersFeedback } from '@/components/feedback/other-users';
import {
  loadFeedbackQueue,
  loadOtherUsersFeedback,
  parseFeedbackKind,
} from '@/lib/feedback/load';

export const metadata = { title: 'Bugs and requests' };

/**
 * The one queue, in the workspace it belongs to.
 *
 * It was rendered twice before -- once under Shopping and once under the job
 * search -- because it belonged to neither and had to be reachable from both.
 * Now it has a place of its own and both of those are redirects to here.
 */
export default async function DevBugsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string | string[] }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const kind = parseFeedbackKind((await searchParams).kind);
  // Both over the same signed-in connection. The second is the only read in
  // the Dev workspace that does not filter to your own id: #413 settled that
  // the owner reads the other accounts' notes through RLS (migration 0086)
  // rather than through a service key, so it is the same client either way.
  const [queue, others] = await Promise.all([
    loadFeedbackQueue(supabase, user.id),
    loadOtherUsersFeedback(supabase, user.id),
  ]);
  // The files filed with each note (plan #1713), drawn under its text.
  await withNoteFiles(await createCoreClient(), queue.rows);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Bugs and requests" />
      <FeedbackQueueView queue={queue} kind={kind} />
      {/* Below both of your sections, and gone entirely when nobody else has
          filed anything. Read-only, per #414. */}
      <OtherUsersFeedback rows={others} />
    </div>
  );
}
