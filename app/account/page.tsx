import { createClient, requireUser } from '@/lib/auth/server';
import { requestOrigin } from '@/lib/auth/origin';
import { createCoreClient } from '@/lib/core/auth/server';
import {
  connectedApps,
  loadConnectorCalls,
  type ConnectedApp,
  type ConnectorCallInput,
  type GrantInput,
} from '@/lib/connector/apps';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { AppShell } from '@/components/shell/app-shell';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadMainCheck } from '@/lib/shell/main-check';
import { switcherCounts } from '@/lib/modules/switcher-counts';
import { vapidPublicKey } from '@/lib/push/web-push';
import { tabFrom } from '@/lib/tabs';
import { ACCOUNT_TAB_ADDRESS, ACCOUNT_TABS, type AccountTab } from './tabs';
import { loadCaptureTokens, type CaptureTokenListing } from '@/lib/capture/tokens';
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
/**
 * The apps allowed through the connector and their newest calls (plan #1258).
 * A failure to read either side is said on the section rather than taking the
 * whole account page down, since the rest of the page does not depend on it.
 */
async function loadConnectedApps(
  userId: string,
): Promise<{ apps: ConnectedApp[]; failed: string | null }> {
  const [grants, calls] = await Promise.all([
    createClient()
      .then((supabase) => supabase.auth.oauth.listGrants())
      .then(({ data, error }): GrantInput[] | null => (error ? null : (data ?? [])))
      .catch(() => null),
    createCoreClient()
      .then((core) => loadConnectorCalls(core, userId))
      .catch((): ConnectorCallInput[] | null => null),
  ]);
  const failed =
    grants === null && calls === null
      ? 'Could not read your connected apps or their calls. Reload to try again.'
      : grants === null
        ? 'Could not read which apps are connected, so only their calls are listed. Reload to try again.'
        : calls === null
          ? 'Could not read the calls your apps made. Reload to try again.'
          : null;
  return { apps: connectedApps(grants ?? [], calls ?? []), failed };
}

/**
 * The person's capture tokens (plan #1705). A failure to read them is said on
 * the section, as with the connected apps.
 */
async function loadCapture(
  userId: string,
): Promise<{ tokens: CaptureTokenListing[]; failed: string | null }> {
  try {
    return { tokens: await loadCaptureTokens(await createCoreClient(), userId), failed: null };
  } catch {
    return { tokens: [], failed: 'Could not read your capture tokens. Reload to try again.' };
  }
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  // One section at a time behind tabs (plan #1628), and only the open tab's
  // data is read: the connected apps and their calls are Activity's alone.
  const tab = tabFrom((await searchParams).tab, ACCOUNT_TABS, ACCOUNT_TAB_ADDRESS) as AccountTab;
  const user = await requireUser();
  const [settings, counts, raised, mainCheck, owner, connected, capture, origin] = await Promise.all([
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
    loadRaisedNotifications(user.id),
    loadMainCheck(),
    isOwner({ user }),
    tab === 'activity' ? loadConnectedApps(user.id) : null,
    tab === 'activity' ? loadCapture(user.id) : null,
    requestOrigin(),
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
            tab={tab}
            email={user.email ?? ''}
            settings={{
              displayName: settings.displayName ?? '',
              timezone: settings.timezone,
              displayCurrency: settings.displayCurrency,
              enabledModules: settings.enabledModules,
            }}
            isOwner={owner}
            vapidPublicKey={vapidPublicKey()}
            connected={
              connected && {
                apps: connected.apps,
                failed: connected.failed,
                connectorAddress: `${origin}/api/mcp`,
              }
            }
            capture={capture && { ...capture, address: `${origin}/api/capture` }}
            />
          </div>
        </div>
      </AppShell>
    </div>
  );
}
