import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadActivity } from '@/lib/shell/activity';
import { loadLearnBrief } from '@/lib/shell/brief';
import { switcherCounts } from '@/lib/modules/switcher-counts';
import { createLearnClient } from '@/lib/learn/auth/server';
import { countReadNow } from '@/lib/learn/tracks/load';

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
   * Two sections. A track and a reading are both reached through Tracks, so
   * they are `alsoMatches` rather than tabs of their own -- a nav that grows
   * an entry per depth level stops being navigation.
   *
   * Read now is the exception that earns a tab, because it is not a deeper
   * view of a track: it is every track's next thing on one shelf, and it is
   * the page you open when you have twenty minutes rather than a decision to
   * make. The badge is the count, so the tab answers "is there anything" from
   * the column.
   */
  const readNow = await countReadNow(await createLearnClient());

  const sections: NavSection[] = [
    {
      href: '/learn',
      label: 'Tracks',
      icon: 'tracks',
      exact: true,
      alsoMatches: ['/learn/t/', '/learn/r/', '/learn/new'],
    },
    {
      href: '/learn/now',
      label: 'Read now',
      icon: 'readNow',
      exact: true,
      badge: readNow,
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
