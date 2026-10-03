import { requireUser } from '@/lib/auth/server';
import { AppShell } from '@/components/shell/app-shell';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { loadModuleCounts } from '@/lib/modules/counts';
import { switcherCounts } from '@/lib/modules/switcher-counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadMainCheck } from '@/lib/shell/main-check';

/**
 * Where a ref opens when its page needs more than the row's id
 * (lib/core/refs.ts). In the account's chrome, the same as /ask: a ref can
 * name a row in any workspace.
 */
export default async function OpenLayout({ children }: { children: React.ReactNode }) {
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
