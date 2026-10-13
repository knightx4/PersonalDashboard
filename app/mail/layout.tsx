import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadMainCheck } from '@/lib/shell/main-check';
import { switcherCounts } from '@/lib/modules/switcher-counts';
import { AppShell } from '@/components/shell/app-shell';

/**
 * An email read inside the dashboard, in the account's chrome: mail belongs to
 * no one workspace. The shell lives here rather than in the page so that the
 * loading, error and not-found files draw inside it too (plan #1923).
 */
export default async function MailLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [settings, counts, raised, mainCheck, owner] = await Promise.all([
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
    loadRaisedNotifications(user.id),
    loadMainCheck(),
    isOwner({ user }),
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
        <div className="mx-auto max-w-3xl">{children}</div>
      </AppShell>
    </div>
  );
}
