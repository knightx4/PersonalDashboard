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
import { createCoreClient } from '@/lib/core/auth/server';
import { estimatePaidActions, paidActionsUnder } from '@/lib/core/spend/paid-actions';
import { PaidCostsProvider } from '@/components/ui/paid-hint';

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
  // Every paid button's $ hint in Learn, from one read of the spend ledger
  // (plan #917). Here rather than on each page because the buttons sit in
  // forms several components deep, and the figures change slowly enough that
  // one read per visit to the module is plenty.
  const [{ data: profile }, settings, counts, activity, raised, mainCheck, owner, costs] =
    await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', user.id).single(),
      loadAccountSettings(user.id),
      loadModuleCounts(user.id),
      loadActivity(),
      loadRaisedNotifications(user.id),
      loadMainCheck(),
      isOwner({ user }),
      createCoreClient()
        .then((core) => estimatePaidActions(core, user.id, paidActionsUnder('app/learn/')))
        .catch(() => ({})),
    ]);

  const brief = await loadLearnBrief();

  /**
   * Now first (plan #1486): the feed, with what is waiting in a strip at the
   * top and the practice questions behind its Practice only switch. Home and
   * Practice Flow were tabs of their own until then, and /learn/home and
   * /learn/flow redirect to Now. Then the subjects, then the rest. A subject,
   * a single idea and a quiz are reached through Subjects, and a reading list
   * and a reading through Reading lists, so they are `alsoMatches` rather
   * than tabs of their own -- a nav that grows an entry per depth level stops being
   * navigation.
   *
   * There is no Learn next tab. Its re-checks are asked in the practice
   * questions, its readings are on Now, and /learn/next redirects.
   */
  const learnClient = await createLearnClient();
  const readNow = await countReadNow(learnClient);

  const sections: NavSection[] = [
    // Learn now replaced the Read now tab (plan #805) and became Now (plan
    // #1486). The badge counts the readings you queued, which the feed shows
    // first, and not the cards it wrote: there are always about twenty of
    // those, and a number that never goes down is not information (plan #808).
    {
      href: '/learn/now',
      label: 'Now',
      icon: 'readNow',
      exact: true,
      badge: readNow,
    },
    // The subjects (plan #1487; the code still says subject, and the
    // database's `tracks` are reading lists). Quizzes are a section of this
    // page, so one quiz and the screen you answer it on light this tab too.
    {
      href: '/learn/know',
      label: 'Subjects',
      icon: 'know',
      exact: true,
      alsoMatches: ['/learn/s/', '/learn/c/', '/learn/quiz'],
    },
    // No Goals tab (plan #1491): the learning goals are goals in the Learn
    // area on /goals, linked from Subjects, and /learn/goals redirects there.
    {
      href: '/learn/lists',
      label: 'Reading lists',
      icon: 'tracks',
      exact: true,
      alsoMatches: ['/learn/t/', '/learn/r/', '/learn/new'],
    },
    // Everything video on one page (plan #1488): your list (plan #1069), the
    // clips cut from it (plan #1400) and the YouTube library, which were three
    // tabs until then. /learn/clips and /learn/youtube redirect to their
    // sections, and a library channel, playlist or video lights this tab. The
    // owner's alone, because every transcript the library fetches spends the
    // owner's TranscriptAPI credits.
    ...(owner
      ? [
          {
            href: '/learn/videos',
            label: 'Videos',
            icon: 'videos' as const,
            exact: true,
            alsoMatches: ['/learn/videos/', '/learn/clips', '/learn/youtube'],
          },
        ]
      : []),
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
        <PaidCostsProvider costs={costs}>{children}</PaidCostsProvider>
      </AppShell>
    </div>
  );
}
