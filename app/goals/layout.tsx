import { paidActionsUnder } from '@/lib/core/spend/paid-actions';
import { shellFor } from '@/lib/shell/shell-for';
import { loadHomeForRequest } from '@/lib/goals/home-request';
import { goalInboxCount } from '@/lib/goals/inbox';
import { todayIn } from '@/lib/todo/tasks/model';

/**
 * Shell for the goals workspace (docs/GOALS-SPEC.md, plan #923).
 *
 * The proxy already blocks unauthenticated requests; the shell's loader
 * checks again, as a second line rather than the first. No onboarding gate:
 * nothing here needs a Gmail grant.
 *
 * Two tabs: the home, which is the daily view (#926), and All goals, where
 * areas and goals are added and arranged (#924). The full tree of a goal
 * opens from either (#925), so it is a deeper view rather than a tab. Files
 * (core.files) and Runs (#1012) are pages without a tab: Files is linked
 * from All goals and from a goal's Details, Runs from What Dash did on the
 * home.
 */
export default async function GoalsLayout({ children }: { children: React.ReactNode }) {
  return shellFor({
    module: 'goals',
    sections: async ({ user, settings }) => {
      // The Inbox badge, from the same read the Home and Inbox pages draw from
      // (cached for the request). A failed read leaves the badge off, not the page.
      const inbox = await loadHomeForRequest(user.id, todayIn(settings.timezone))
        .then((home) => goalInboxCount(home.onYou, home.dash, home.waitingRuns))
        .catch(() => undefined);
      return [
        { href: '/goals', label: 'Home', icon: 'goalsHome', exact: true },
        // Everything on you across the goals, as the Inbox in Dev holds what is
        // waiting on you there.
        { href: '/goals/inbox', label: 'Inbox', icon: 'inbox', badge: inbox },
        { href: '/goals/all', label: 'All goals', icon: 'goalsAll' },
      ];
    },
    // Every paid button's $ hint in Goals, from one read of the spend
    // ledger: so far, reading a paste or a document into a form (#955).
    paidActions: paidActionsUnder('app/goals/'),
    children,
  });
}
