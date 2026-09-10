import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { loadRaised } from '@/lib/raised/load';
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
 */
export default async function DevRaisedPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const queue = await loadRaised(supabase, user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Raised"
        description="Questions and risks a session has put to you. Answer one and the next run reads it; dismiss one it did not need to ask."
      />
      <RaisedView queue={queue} />
    </div>
  );
}
