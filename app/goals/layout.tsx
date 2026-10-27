import { shellFor } from '@/lib/shell/shell-for';
import { tabsFor, withBadges } from '@/lib/shell/tabs';
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
 * Four tabs: the home, which is the daily view (#926), the Inbox, All goals,
 * where areas and goals are added and arranged (#924), and Hours, the time
 * logged on every goal with an Hours logged metric (goals 0089). The full tree of a goal
 * opens from either (#925), so it is a deeper view rather than a tab. Files
 * (core.files) and Runs (#1012) are pages without a tab: Files is linked
 * from All goals and from a goal's Details, Runs from What Dash did on the
 * home.
 */
export default async function GoalsLayout({ children }: { children: React.ReactNode }) {
  return shellFor({
    module: 'goals',
    // The tabs are in lib/shell/tabs.ts (plan #2208.3); the Inbox's count is
    // put on here, because it is read for the request.
    sections: async ({ user, settings, owner }) => {
      // The Inbox badge, from the same read the Home and Inbox pages draw from
      // (cached for the request). A failed read leaves the badge off, not the page.
      const inbox = await loadHomeForRequest(user.id, todayIn(settings.timezone))
        .then((home) => goalInboxCount(home.onYou, home.dash, home.waitingRuns))
        .catch(() => undefined);
      return withBadges(tabsFor('goals', owner), { '/goals/inbox': inbox });
    },
    // Whether the morning and weekly runs start (plan #1937.10).
    settingsHref: '/goals/settings',
    settingsLabel: 'Goals settings',
    children,
  });
}
