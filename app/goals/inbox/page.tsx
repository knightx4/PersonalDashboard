import { PageHeader } from '@/components/shell/page-header';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { loadHomeForRequest } from '@/lib/goals/home-request';
import { goalInboxGroups } from '@/lib/goals/inbox';
import { todayIn } from '@/lib/todo/tasks/model';
import { GoalsInboxView } from './inbox-view';

export const metadata = { title: 'Inbox' };
export const dynamic = 'force-dynamic';

/**
 * Everything on you in Goals, from every goal rather than only the week's:
 * steps to do, questions Dash asked, flags, and proposals to say yes to.
 * The Home's Do next is the first five of the same list.
 *
 * The rows come from the same read as the Home and the tab's badge
 * (lib/goals/home-request.ts), so the count on the tab is the count here.
 */
export default async function GoalsInboxPage() {
  const user = await requireUser();
  const account = await loadAccountSettings(user.id);
  const [home, owner] = await Promise.all([
    loadHomeForRequest(user.id, todayIn(account.timezone)),
    // Ask Dash on a row starts a run, which only the owner's account may.
    isOwner({ user }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Inbox" />
      <GoalsInboxView
        groups={goalInboxGroups(home.onYou, home.dash)}
        laterOn={home.laterOn}
        preparable={home.preparable}
        canRun={owner}
      />
    </div>
  );
}
