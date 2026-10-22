import { WorkspaceInbox } from '@/components/inbox/workspace-inbox';
import { requireUser } from '@/lib/auth/server';
import { loadWorkspaceInbox } from '@/lib/inbox/workspace-inbox';
import { loadReviewItems } from '@/lib/jobs/review/candidates';
import { sessionClients } from '@/lib/todo/agenda/clients';
import { reviewInboxRows } from './review-cards';
import { withWaitingCards } from './waiting-cards';

export const metadata = { title: 'Inbox' };
export const dynamic = 'force-dynamic';

/**
 * Everything in the job search whose move is on you, with its verbs on the row (plan
 * #1937.5): the agenda's one on-you list cut to this workspace
 * (lib/todo/agenda/workspace.ts), so a row here is the same row the agenda
 * shows, and a press changes it where it lives.
 *
 * What Today asked of you is here since plan #1937.9: mail waiting on a
 * reply, from the job_waiting source and drawn with Prepare with Dash, and
 * the reminders. The imports to check are listed item by item since plan
 * #2502.2, the first five with their own buttons and a row opening the rest
 * in Review, from the loader the Review page reads.
 */
export default async function JobsInboxPage() {
  const user = await requireUser();
  const [inbox, review] = await Promise.all([
    loadWorkspaceInbox(user.id, 'jobs'),
    loadReview(user.id),
  ]);
  const rows = [...(review ? reviewInboxRows(review.items, review.timezone) : []), ...withWaitingCards(inbox.rows)];
  const failed = review ? inbox.failed : ['Review', ...inbox.failed];
  return <WorkspaceInbox workspace="jobs" rows={rows} failed={failed} />;
}

/** The review queue and the timezone its dates are read in, or null when it could not be read. */
async function loadReview(userId: string) {
  try {
    const [supabase, core] = await Promise.all([sessionClients.jobs(), sessionClients.core()]);
    const [items, { data: profile }] = await Promise.all([
      loadReviewItems(supabase, core, userId),
      supabase.from('profiles').select('timezone').eq('id', userId).maybeSingle(),
    ]);
    return { items, timezone: (profile?.timezone as string | undefined) ?? 'UTC' };
  } catch {
    return null;
  }
}
