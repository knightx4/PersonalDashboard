import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadActivity } from '@/lib/shell/activity';
import { loadMainCheck } from '@/lib/shell/main-check';
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
  const [{ data: profile }, settings, counts, activity, raised, mainCheck, owner] =
    await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', user.id).single(),
      loadAccountSettings(user.id),
      loadModuleCounts(user.id),
      loadActivity(),
      loadRaisedNotifications(user.id),
      loadMainCheck(),
      isOwner({ user }),
    ]);

  const brief = await loadLearnBrief();

  /**
   * Learn now first, because it is what Learn opens on (plan #805), then
   * Practice Flow, then the subjects the flow asks about, then the rest. A
   * subject and a single idea are reached through Tracks, and a reading list
   * and a reading through Reading lists, so they are `alsoMatches` rather than
   * tabs of their own -- a nav that grows an entry per depth level stops being
   * navigation.
   *
   * There is no Learn next tab. Its re-checks are asked in the flow, its
   * readings are on Learn now, and /learn/next redirects.
   */
  const learnClient = await createLearnClient();
  const readNow = await countReadNow(learnClient);

  const sections: NavSection[] = [
    // Learn now replaced the Read now tab (plan #805). The badge counts the
    // readings you queued, which the feed shows first, and not the cards it
    // wrote: there are always about twenty of those, and a number that never
    // goes down is not information (plan #808).
    {
      href: '/learn/now',
      label: 'Learn now',
      icon: 'readNow',
      exact: true,
      badge: readNow,
    },
    // No badge, because there is always a question waiting and a number that
    // never goes down is not information.
    {
      href: '/learn/flow',
      label: 'Practice Flow',
      icon: 'practiceFlow',
      exact: true,
    },
    // The subjects, which are what "track" means on screen now (#774).
    {
      href: '/learn/know',
      label: 'Tracks',
      icon: 'know',
      exact: true,
      alsoMatches: ['/learn/s/', '/learn/c/'],
    },
    {
      href: '/learn/lists',
      label: 'Reading lists',
      icon: 'tracks',
      exact: true,
      alsoMatches: ['/learn/t/', '/learn/r/', '/learn/new'],
    },
    // Quizzes are not a deeper view of anything else here: they are over
    // material you chose out of the vault rather than over a subject the graph
    // holds, and they are where you go when there is a date in the diary. One
    // quiz and the screen you answer it on are both reached through the list.
    {
      href: '/learn/quiz',
      label: 'Quizzes',
      icon: 'quiz',
      exact: true,
      alsoMatches: ['/learn/quiz/'],
    },
  ];

  return (
    <div data-workspace="learn">
      <AppShell
        account={user.id}
        module="learn"
        sections={sections}
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
        {children}
      </AppShell>
    </div>
  );
}
