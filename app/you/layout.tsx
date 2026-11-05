import { shellFor } from '@/lib/shell/shell-for';
import { tabsFor, withBadges } from '@/lib/shell/tabs';
import { createYouClient } from '@/lib/you/auth/server';
import { ANSWER_HREF, countOpenDashQuestions } from '@/lib/you/dash-questions';

/**
 * Shell for the You workspace (plan #1991): what is true about you.
 *
 * Personality first, because it is the tab with something in it from day one
 * once it moves over from Learn. Details follows it (plan #2124.2): the
 * plain facts a form asks for. Insights follows the rest: it is where Dash
 * writes what it notices, and it reads the others. Board comes last (plan
 * #2540.3): the weekly meeting of five advisors, which reads all of it.
 *
 * The Ask tab carries the count of Dash's questions waiting for you (plan
 * #2635.3), shown only while one waits. A failed read leaves the count off,
 * not the page.
 */
export default async function YouLayout({ children }: { children: React.ReactNode }) {
  return shellFor({
    module: 'you',
    sections: async ({ user, owner }) => {
      const waiting = await createYouClient()
        .then((you) => countOpenDashQuestions(you, user.id))
        .catch(() => undefined);
      return withBadges(tabsFor('you', owner), { [ANSWER_HREF]: waiting });
    },
    children,
  });
}
