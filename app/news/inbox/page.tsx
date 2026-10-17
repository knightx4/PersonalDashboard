import { WorkspaceInbox } from '@/components/inbox/workspace-inbox';
import { requireUser } from '@/lib/auth/server';
import { loadWorkspaceInbox } from '@/lib/inbox/workspace-inbox';

export const metadata = { title: 'Inbox' };
export const dynamic = 'force-dynamic';

/**
 * Everything in News whose move is on you, with its verbs on the row (plan
 * #1937.5): the agenda's one on-you list cut to this workspace
 * (lib/todo/agenda/workspace.ts), so a row here is the same row the agenda
 * shows, and a press changes it where it lives.
 */
export default async function NewsInboxPage() {
  const user = await requireUser();
  const inbox = await loadWorkspaceInbox(user.id, 'news');
  return <WorkspaceInbox workspace="news" rows={inbox.rows} failed={inbox.failed} />;
}
