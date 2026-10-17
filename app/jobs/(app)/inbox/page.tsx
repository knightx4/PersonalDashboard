import { WorkspaceInbox } from '@/components/inbox/workspace-inbox';
import { requireUser } from '@/lib/auth/server';
import { loadWorkspaceInbox } from '@/lib/inbox/workspace-inbox';
import { withWaitingCards } from './waiting-cards';

export const metadata = { title: 'Inbox' };
export const dynamic = 'force-dynamic';

/**
 * Everything in the job search whose move is on you, with its verbs on the row (plan
 * #1937.5): the agenda's one on-you list cut to this workspace
 * (lib/todo/agenda/workspace.ts), so a row here is the same row the agenda
 * shows, and a press changes it where it lives.
 *
 * What Today asked of you is here since plan #1937.9: the imports to check,
 * as one row opening the review queue; mail waiting on a reply, from the
 * job_waiting source and drawn with Prepare with Dash; and the reminders.
 */
export default async function JobsInboxPage() {
  const user = await requireUser();
  const inbox = await loadWorkspaceInbox(user.id, 'jobs');
  return <WorkspaceInbox workspace="jobs" rows={withWaitingCards(inbox.rows)} failed={inbox.failed} />;
}
