import { requireUser } from '@/lib/auth/server';
import { AppShell } from '@/components/shell/app-shell';
import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { estimatePaidActions, paidActionsUnder } from '@/lib/core/spend/paid-actions';
import { isOwner } from '@/lib/dev/owner';
import { loadModuleCounts } from '@/lib/modules/counts';
import { switcherCounts } from '@/lib/modules/switcher-counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadMainCheck } from '@/lib/shell/main-check';

/**
 * The questions you have asked Dash (plan #1090), in the account's chrome
 * rather than a workspace's: Dash reads every workspace, so wearing one of
 * their navigations would say otherwise. Same shell as /account.
 */
export default async function AskLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const core = await createCoreClient();
  const [settings, counts, raised, mainCheck, owner, costs] = await Promise.all([
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
    loadRaisedNotifications(user.id),
    loadMainCheck(),
    isOwner({ user }),
    // The follow-up box on a reopened question is a paid press.
    estimatePaidActions(core, user.id, paidActionsUnder('app/ask/')).catch(() => ({})),
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
        <PaidCostsProvider costs={costs}>
          <div className="mx-auto max-w-3xl">{children}</div>
        </PaidCostsProvider>
      </AppShell>
    </div>
  );
}
