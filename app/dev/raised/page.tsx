import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { loadRaised } from '@/lib/raised/load';
import { loadDigest } from '@/lib/digest/load';
import { DigestPanel } from './digest-panel';
import { RaisedView } from './raised-view';

export const metadata = { title: 'Raised' };

/**
 * What Claude needs from you.
 *
 * A session that runs into something outside the step it is building has
 * nowhere to put it, so it says it in the transcript and you find out by
 * opening Claude. It writes a row here instead. Not the notes queue next door,
 * which is what you report as wrong, and not a plan decision, which belongs to
 * one feature: this is for what has no other home.
 *
 * Above the queue, the morning summary: what closed in the last day and what
 * is worth a look. It is written once a day by the cron rather than built
 * here, so opening this page never costs a model call.
 */
export default async function DevRaisedPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [queue, digest] = await Promise.all([
    loadRaised(supabase, user.id),
    loadDigest(supabase, user.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Raised"
        description="Questions and risks a session has put to you. Answer one and the next run reads it; dismiss one it did not need to ask."
      />
      <DigestPanel digest={digest} />
      <RaisedView queue={queue} />
    </div>
  );
}
