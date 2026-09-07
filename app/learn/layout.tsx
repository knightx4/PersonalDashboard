import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadActivity } from '@/lib/shell/activity';
import { loadLearnBrief } from '@/lib/shell/brief';
import { switcherCounts } from '@/lib/modules/switcher-counts';

/**
 * Shell for the learn workspace.
 *
 * The proxy already blocks unauthenticated requests; the check here is a
 * second line, not the first.
 *
 * No onboarding gate, for the same reason the vault has none: nothing this
 * module does needs a Gmail grant, and bouncing somebody to a consent screen
 * because they pasted a reading list would be the wrong app answering.
 */
export default async function LearnLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const [{ data: profile }, settings, counts, activity] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).single(),
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
    loadActivity(),
  ]);

  const brief = await loadLearnBrief();

  /**
   * One section. A track and a reading are both reached through it, so they
   * are `alsoMatches` rather than tabs of their own -- a nav that grows an
   * entry per depth level stops being navigation.
   */
  const sections: NavSection[] = [
    {
      href: '/learn',
      label: 'Tracks',
      icon: 'tracks',
      exact: true,
      alsoMatches: ['/learn/t/', '/learn/r/', '/learn/new'],
    },
  ];

  return (
    <div data-workspace="learn">
      <AppShell
        module="learn"
        sections={sections}
        displayName={profile?.display_name ?? null}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
        counts={switcherCounts(counts)}
        theme={settings.theme}
        activity={activity}
        brief={brief}
      >
        {children}
      </AppShell>
    </div>
  );
}
