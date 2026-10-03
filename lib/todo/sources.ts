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
      // Named by a ref, a task opens on the list scrolled to it.
      page: { title: 'title', href: (row) => `/todo/all?status=all&focus=${row.id}` },
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
    {
      table: 'todo.appointments',
      module: 'Todo',
      holds: 'Appointments and reservations they booked, read from the confirmation emails: doctor, dentist, haircut, a table.',
      weight: 'record',
      search: ['title', 'provider', 'location'],
      title: 'title',
      href: () => '/todo',
      note: "starts_on is the day in their zone and starts_at the instant when the mail gave a time. status 'cancelled' means a cancellation email came after the booking.",
    },
  ],
  notSources: [
    { table: 'todo.agenda_settings', reason: 'Settings.' },
    { table: 'todo.appointment_messages', reason: 'Mail sync bookkeeping for appointments.' },
    { table: 'todo.calendar_feeds', reason: 'Feed addresses.' },
    { table: 'todo.dismissals', reason: 'Dismissed agenda items.' },
    { table: 'todo.reply_threads', reason: 'Mail sync bookkeeping: which threads were judged for a reply task.' },
    { table: 'todo.task_links', reason: 'Links from tasks to other rows; read through tasks.' },
  ],
};
