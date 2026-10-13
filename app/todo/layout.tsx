import { loadTodoBrief } from '@/lib/shell/brief';
import { shellFor } from '@/lib/shell/shell-for';

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
     * Four questions, four sections. "Agenda" is what needs you next;
     * "Waiting" is what someone else has to move first (plan #1475);
     * "Calendar" is how the month is shaped; "All" is everything, including what
     * is finished. Anything a fifth section would answer is probably a filter on
     * one of these.
     */
    sections: [
      { href: '/todo', label: 'Agenda', icon: 'agenda', exact: true },
      { href: '/todo/waiting', label: 'Waiting', icon: 'waiting' },
      { href: '/todo/calendar', label: 'Calendar', icon: 'calendar' },
      { href: '/todo/all', label: 'All', icon: 'tasks' },
    ],
    settingsHref: '/todo/settings',
    settingsLabel: 'Todo settings',
    brief: ({ user, settings }) => loadTodoBrief(user.id, settings.timezone),
    children,
  });
}
