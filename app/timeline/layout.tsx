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
 * What you did across the app, month by month (plan #1118). In the account's
 * chrome rather than a workspace's, the same as /ask and /account: the page
 * reads every workspace, so wearing one of their navigations would say
 * otherwise.
 */
export default async function TimelineLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const core = await createCoreClient();
  const [settings, counts, raised, mainCheck, owner, costs] = await Promise.all([
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
    loadRaisedNotifications(user.id),
    loadMainCheck(),
    isOwner({ user }),
    // Writing a year's review is a paid press (plan #1121).
    estimatePaidActions(core, user.id, paidActionsUnder('app/timeline/')).catch(() => ({})),
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
