import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/auth/server';
import { isOwner } from '@/lib/dev/owner';
import { NoPermission } from '@/components/shell/no-permission';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadActivity } from '@/lib/shell/activity';
import { loadMainCheck } from '@/lib/shell/main-check';
import { switcherCounts } from '@/lib/modules/switcher-counts';
import { loadPlan } from '@/lib/plan/load';
import { buildPlanTree } from '@/lib/plan/tree';
import { waitingOnYou } from '@/lib/plan/waiting';
import { createCoreClient } from '@/lib/core/auth/server';
import { estimatePaidActions, paidActionsUnder } from '@/lib/core/spend/paid-actions';
import { PaidCostsProvider } from '@/components/ui/paid-hint';

/**
 * Shell for the workspace the app keeps about itself.
 *
 * Bugs and requests used to live under Shopping, which was where the queue
 * happened to be built rather than where it belongs: a bug filed from the job
 * search is not a shopping matter, and reading the list meant standing in a
 * workspace that had nothing to do with it. It is its own place now, with the
 * ideas list beside it.
 *
 * No onboarding gate and no settings of its own: nothing here needs a mailbox
 * connected, and there is nothing about this workspace to configure.
 */
export default async function DevLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();

  /**
   * The gate for the whole workspace, and it is deliberately the first thing
   * after the session rather than a check on each of the seven pages.
   *
   * Before the loaders, too. Everything below this line reads the owner's
   * plan, his bug queue and his raises, and a layout that loaded them and then
   * declined to draw them would have put them in the response of a person who
   * may not see them -- the answer would be right and the page would still be
   * a leak. Nothing behind here is fetched for anybody else.
   *
   * Not the whole of the wall, though. A layout is rendered once and does not
   * re-run for every navigation beneath it, and the buttons inside these pages
   * post to server actions that can be called without rendering anything at
   * all. Those are refused in their own right -- that is #417 -- and this
   * check is what stops the workspace being drawn, not what stops it being
   * reached.
   */
  if (!(await isOwner({ user, supabase }))) {
    return <NoPermission what="The Dev workspace" />;
  }

  const [settings, counts, activity, raised, plan, mainCheck, costs] = await Promise.all([
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
    loadActivity(),
    loadRaisedNotifications(user.id),
    loadPlan(supabase, user.id),
    loadMainCheck(),
    // The $ hint on a comment that asks Dash, and on a raise's "Yes, and…"
    // (plan #918).
    createCoreClient()
      .then((core) => estimatePaidActions(core, user.id, paidActionsUnder('app/dev/')))
      .catch(() => ({})),
  ]);

  /**
   * The badge is everything waiting on you, which is more than the raises.
   *
   * It used to be `raised.length`, so a step blocked on a credential added
   * nothing to it: #499 sat blocked for a day behind a tab reading zero. The
   * plan's half is derived the same way the Dash page derives the section it
   * lands in -- `waitingOnYou` over the same tree -- rather than counted again
   * here, because a badge that disagrees with the page it links to is worse
   * than no badge.
   */
  const waiting = waitingOnYou(buildPlanTree(plan));

  /**
   * Dash is first because it is the page the day starts on: the summary of the
   * last 24 hours, the questions a session needs answered before it can carry
   * on, and every conversation you have had with Dash. A question nobody reads
   * is a session that guessed.
   *
   * Then three lists: what was decided and is being built, what is wrong now,
   * and what is only being thought about. The plan leads them because it is
   * the page worked from most days (note ab08d2d3); a bug is filed when
   * something built is wrong, and an idea becomes a plan step when it is
   * decided on.
   *
   * UI sits below the three because it is not a list of work; it is the
   * standard the work is held to, and Surfaces below that because it is where
   * the standard gets checked against the thing: every surface framed at the width
   * it is read at, with a box to say what is wrong. A note written there lands
   * in the same queue as Bugs and requests, which is the point -- one inbox,
   * not two. It lives here rather than in a document because a
   * document describing an interface goes stale the week after it is written,
   * and this one renders the real components from the real tokens: if a swatch
   * on that page is wrong, the app is wrong.
   *
   * The changelog is last, at the bottom of the list. Everything above it is
   * something you go there to do; it is the one page you go to to look
   * something up, and its lines are the closed rows of the three lists at the
   * top. Finished work is consulted, not worked, so it sits at the end rather
   * than in the middle of the things that still want doing.
   */
  const sections: NavSection[] = [
    // The route stays /dev/raised, which keeps every link already written into
    // a notification, a comment and an old summary working.
    { href: '/dev/raised', label: 'Dash', icon: 'raised', badge: raised.length + waiting.length },
    { href: '/dev/plan', label: 'Plan', icon: 'plan' },
    { href: '/dev/bugs', label: 'Bugs and requests', icon: 'bugs' },
    { href: '/dev/ideas', label: 'Ideas', icon: 'ideas' },
    { href: '/dev/specs', label: 'Specs', icon: 'specs' },
    { href: '/dev/ui', label: 'UI', icon: 'ui' },
    { href: '/dev/surfaces', label: 'Surfaces', icon: 'surfaces' },
    { href: '/dev/changelog', label: 'Changelog', icon: 'changelog' },
  ];

  return (
    <div data-workspace="dev">
      <AppShell
        account={user.id}
        module="dev"
        sections={sections}
        feedbackHref="/dev/bugs"
        displayName={settings.displayName}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
        // Proved above: a non-owner never reaches this line.
        isOwner
        counts={switcherCounts(counts)}
        theme={settings.theme}
        notifications={raised}
        activity={activity}
        mainCheck={mainCheck}
      >
        <PaidCostsProvider costs={costs}>{children}</PaidCostsProvider>
      </AppShell>
    </div>
  );
}
