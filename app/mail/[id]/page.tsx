import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { fetchConversation } from '@/lib/inbox/fetch-conversation';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadMainCheck } from '@/lib/shell/main-check';
import { switcherCounts } from '@/lib/modules/switcher-counts';
import { AppShell } from '@/components/shell/app-shell';
import { MailView } from './mail-view';

export const metadata = { title: 'Email' };

/**
 * An email, read inside the dashboard.
 *
 * This is where "Open in Gmail" goes on a phone. A Gmail web link names the
 * conversation after a `#`, which the desktop site follows and mobile Gmail
 * ignores, so on a phone every link landed on the inbox. Bodies are never
 * stored, so the conversation is fetched from Gmail each time the page opens.
 */
export default async function MailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const core = await createCoreClient();
  const [settings, counts, raised, mainCheck, owner, conversation] = await Promise.all([
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
    loadRaisedNotifications(user.id),
    loadMainCheck(),
    isOwner({ user }),
    fetchConversation(core, { userId: user.id, gmailId: id }),
  ]);

  return (
    <div className="min-h-full">
      <AppShell
        account={user.id}
        module={null}
        sections={[]}
        displayName={settings.displayName}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
        isOwner={owner}
        counts={switcherCounts(counts)}
        theme={settings.theme}
        notifications={raised}
        mainCheck={mainCheck}
      >
        <MailView conversation={conversation} timezone={settings.timezone} />
      </AppShell>
    </div>
  );
}
