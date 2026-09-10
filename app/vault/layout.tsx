import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadActivity } from '@/lib/shell/activity';
import { loadVaultBrief } from '@/lib/shell/brief';
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
  const [{ data: profile }, settings, counts, activity, raised] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).single(),
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
    loadActivity(),
    loadRaisedNotifications(user.id),
  ]);

  const brief = await loadVaultBrief();

  /**
   * One section, because there is one page of content. Settings moved to the
   * gear, where every other workspace keeps it -- it was a nav tab here only
   * because this shell was written on its own.
   */
  const sections: NavSection[] = [
    { href: '/vault', label: 'Notes', icon: 'notes', exact: true, alsoMatches: ['/vault/n/'] },
  ];

  return (
    <div data-workspace="vault">
      <AppShell
        module="vault"
        sections={sections}
        settingsHref="/vault/settings"
        settingsLabel="Vault settings"
        displayName={profile?.display_name ?? null}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
        counts={switcherCounts(counts)}
        theme={settings.theme}
        notifications={raised}
        activity={activity}
        brief={brief}
      >
        {children}
      </AppShell>
    </div>
  );
}
