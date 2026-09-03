import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { WorkspaceNav, type NavSection } from '@/components/shell/workspace-nav';
import { loadModuleCounts } from '@/lib/modules/counts';
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
  const [{ data: profile }, settings, counts] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).single(),
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
  ]);

  /**
   * One section, because there is one page of content. Settings moved to the
   * gear, where every other workspace keeps it -- it was a nav tab here only
   * because this shell was written on its own.
   */
  const sections: NavSection[] = [
    { href: '/vault', label: 'Notes', exact: true, alsoMatches: ['/vault/n/'] },
  ];

  return (
    <div className="min-h-full" data-workspace="vault">
      <WorkspaceNav
        module="vault"
        sections={sections}
        settingsHref="/vault/settings"
        settingsLabel="Vault settings"
        displayName={profile?.display_name ?? null}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
        counts={switcherCounts(counts)}
        theme={settings.theme}
      />
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
