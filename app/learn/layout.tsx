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
import { countNext } from '@/lib/learn/graph/load';

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
  const learnClient = await createLearnClient();
  const [readNow, learnNext] = await Promise.all([
    countReadNow(learnClient),
    countNext(learnClient),
  ]);

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
    // Practice Flow is the other end of Read now: the same module asked for
    // when you would rather answer than read. No badge, because there is
    // always a question waiting and a number that never goes down is not
    // information.
    {
      href: '/learn/flow',
      label: 'Practice Flow',
      icon: 'practiceFlow',
      exact: true,
    },
    // Learn next earns a tab on the same argument Read now does: it is not a
    // deeper view of a subject, it is every subject's next thing on one
    // screen, and the badge answers "is there anything" from the column. The
    // count is the rows the page would draw, so tapping the tab never finds a
    // different number of them.
    {
      href: '/learn/next',
      label: 'Learn next',
      icon: 'learnNext',
      exact: true,
      badge: learnNext,
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
    // The other half of the module. A subject is reached through here, and a
    // single concept through a subject, so both are alsoMatches rather than
    // tabs of their own.
    {
      href: '/learn/know',
      label: 'What you know',
      icon: 'know',
      exact: true,
      alsoMatches: ['/learn/s/', '/learn/c/'],
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
