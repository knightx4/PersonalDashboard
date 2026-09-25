import type { ModuleSources } from '@/lib/sources/types';

/**
 * Todo's tables, as Goals reads them (lib/sources/types.ts). A new table in
 * todo goes in one of these two lists, or the gate says so.
 */
export const todoSources: ModuleSources = {
  sources: [
    {
      table: 'todo.tasks',
      module: 'Todo',
      holds: 'Tasks they gave themselves, open and done.',
      weight: 'record',
      search: ['title', 'body'],
      title: 'title',
      href: () => '/todo/all',
      note: 'A task that repeats a goal step is theirs to keep; do not propose it again as a step.',
    },
    {
      table: 'todo.events',
      module: 'Todo',
      holds: 'Events they put on their own calendar.',
      weight: 'record',
      search: ['title', 'body', 'location'],
      title: 'title',
      href: () => '/todo/calendar',
    },
    {
      table: 'todo.feed_events',
      module: 'Todo',
      holds: 'Events from the calendars they subscribe to.',
      weight: 'incidental',
      search: ['title', 'body', 'location'],
      title: 'title',
      href: () => '/todo/calendar',
    },
  ],
  notSources: [
    { table: 'todo.agenda_settings', reason: 'Settings.' },
    { table: 'todo.calendar_feeds', reason: 'Feed addresses.' },
    { table: 'todo.dismissals', reason: 'Dismissed agenda items.' },
    { table: 'todo.task_links', reason: 'Links from tasks to other rows; read through tasks.' },
  ],
};
