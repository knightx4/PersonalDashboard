import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { AppShell } from '@/components/shell/app-shell';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadMainCheck } from '@/lib/shell/main-check';
import { switcherCounts } from '@/lib/modules/switcher-counts';
import { AccountView } from './view';

export const metadata = { title: 'Account' };

/**
 * The account, not a workspace.
 *
 * Everything here is true about you no matter which of the workspaces you are
 * in, which is exactly the test for what belongs: if turning a module off would
 * make the setting meaningless, it is a module setting and it lives behind that
 * module's own gear.
 *
 * It exists because the timezone did not have one home. It had two -- a column
 * on each workspace's `profiles` row, both defaulting to UTC, with one screen
 * editing one of them -- so the shopping side had silently been on UTC forever
 * and no page could merge the two workspaces without picking a side.
 *
 * Same chrome as /home rather than a workspace shell: this belongs to the
 * account, and wearing one workspace's navigation would imply otherwise.
 */
export default async function AccountPage() {
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
        <div className="mx-auto max-w-3xl">
          <p className="text-body text-ink-muted">
            Settings that hold across every workspace.
          </p>

          <div className="mt-5">
          <AccountView
            email={user.email ?? ''}
            settings={{
              displayName: settings.displayName ?? '',
              timezone: settings.timezone,
              displayCurrency: settings.displayCurrency,
              enabledModules: settings.enabledModules,
            }}
            isOwner={owner}
            />
          </div>
        </div>
      </AppShell>
    </div>
  );
}
