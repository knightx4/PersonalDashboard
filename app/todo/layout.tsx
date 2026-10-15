import { loadTodoBrief } from '@/lib/shell/brief';
import { shellFor } from '@/lib/shell/shell-for';
import { tabsFor } from '@/lib/shell/tabs';

/**
 * Shell for the todo workspace.
 *
 * The proxy already blocks unauthenticated requests; the shell's loader
 * checks again, as a second line rather than the first.
 *
 * No onboarding gate, for the same reason the vault has none: neither
 * workspace's onboarding says anything about a todo list, and bouncing someone
 * to a Gmail consent screen because they wanted to write down "renew the
 * passport" would be the wrong app answering the question.
 */
export default async function TodoLayout({ children }: { children: React.ReactNode }) {
  return shellFor({
    module: 'todo',
    /**
     * Now and Inbox first, as in every workspace (plan #1937.6). "Now" is the
     * agenda, what needs you next; "Inbox" is what is on you with its verbs on
     * the row; "Waiting" is what someone else has to move first (plan #1475);
     * "Calendar" is how the month is shaped; "All" is everything, including
     * what is finished. Anything another section would answer is probably a
     * filter on one of these.
     */
    sections: ({ owner }) => tabsFor('todo', owner),
    settingsHref: '/todo/settings',
    settingsLabel: 'Todo settings',
    brief: ({ user, settings }) => loadTodoBrief(user.id, settings.timezone),
    children,
  });
}
