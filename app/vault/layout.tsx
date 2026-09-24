import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadActivity } from '@/lib/shell/activity';
import { loadMainCheck } from '@/lib/shell/main-check';
import { loadVaultBrief } from '@/lib/shell/brief';
import { createCoreClient } from '@/lib/core/auth/server';
import { estimatePaidActions, paidActionsUnder } from '@/lib/core/spend/paid-actions';
import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { switcherCounts } from '@/lib/modules/switcher-counts';

/**
 * Shell for the vault workspace.
 *
 * The proxy already blocks unauthenticated requests; the check here is a
 * second line, not the first.
 *
 * Unlike the other two workspaces this one has no onboarding gate. Neither
 * workspace's onboarding says anything about a vault, and bouncing someone to
 * a Gmail consent screen because they wanted to read their own notes would be
 * the wrong app answering the question.
 */
export default async function VaultLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const [{ data: profile }, settings, counts, activity, raised, mainCheck, owner, costs] =
    await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', user.id).single(),
      loadAccountSettings(user.id),
      loadModuleCounts(user.id),
      loadActivity(),
      loadRaisedNotifications(user.id),
      loadMainCheck(),
      isOwner({ user }),
      // Every paid button's $ hint in the vault, from one read of the spend
      // ledger (plan #918).
      createCoreClient()
        .then((core) => estimatePaidActions(core, user.id, paidActionsUnder('app/vault/')))
        .catch(() => ({})),
    ]);

  const brief = await loadVaultBrief();

  /**
   * The notes, and the map drawn from them (#758). Settings moved to the
   * gear, where every other workspace keeps it -- it was a nav tab here only
   * because this shell was written on its own.
   */
  const sections: NavSection[] = [
    { href: '/vault', label: 'Notes', icon: 'notes', exact: true, alsoMatches: ['/vault/n/'] },
    { href: '/vault/map', label: 'Map', icon: 'vaultMap' },
  ];

  return (
    <div data-workspace="vault">
      <AppShell
        account={user.id}
        module="vault"
        sections={sections}
        settingsHref="/vault/settings"
        settingsLabel="Vault settings"
        displayName={profile?.display_name ?? null}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
        isOwner={owner}
        counts={switcherCounts(counts)}
        theme={settings.theme}
        notifications={raised}
        activity={activity}
        mainCheck={mainCheck}
        brief={brief}
      >
        <PaidCostsProvider costs={costs}>{children}</PaidCostsProvider>
      </AppShell>
    </div>
  );
}
