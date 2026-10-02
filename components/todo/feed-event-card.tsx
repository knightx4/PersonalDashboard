import Link from 'next/link';
import { CalendarDays, MapPin } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LinkedTasks } from '@/components/todo/linked-tasks';
import { spanLabel } from '@/lib/todo/events/model';
import type { SubscribedEventDetail } from '@/lib/todo/feeds/load';
import type { Task } from '@/lib/todo/tasks/model';
import { LinkedText } from '@/components/ui/linked-text';

/**
 * A subscribed appointment, opened.
 *
 * Clicking one used to do nothing at all, which is the right answer to "can I
 * change this" and the wrong one to "what is this": a pill is a truncated
 * title, and the room, the video link and the two lines the organiser wrote
 * are exactly what you clicked it for.
 *
 * So it opens, and the meeting itself only reads. No form and no delete,
 * because the row belongs to a calendar somewhere else and the next refresh
 * replaces it wholesale -- the card names that calendar instead, which is the
 * thing you would have to open in order to change anything.
 *
 * What you can do from here is write down what the meeting needs of you
 * (plan #1374): the same tasks section a role page has, linked to this
 * appointment on the date you opened. The link names the subscription, the
 * UID and that date rather than this row's id, so the list survives the
 * refresh that replaces the row.
 *
 * It sits where the event form sits and opens the same way -- `?feedEvent=<id>`
 * beside the view and the day -- so the page still holds no state of its own
 * and the back button still closes it.
 */
export function FeedEventCard({
  detail,
  view,
  anchor,
  timezone,
  tasks,
}: {
  detail: SubscribedEventDetail;
  /** Where Close goes: the view and the day you were looking at. */
  view: string;
  anchor: string;
  timezone: string;
  /** The open tasks about this appointment on this date. */
  tasks: Task[];
}) {
  const { event, feedName } = detail;

  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <h2 className="text-body font-semibold text-ink">{event.title}</h2>
          <p className="flex items-baseline gap-1.5 text-ui text-ink-muted">
            <CalendarDays className="size-4 shrink-0 self-center" strokeWidth={1.75} aria-hidden />
            {spanLabel(event, timezone)}
          </p>
        </div>

        <Link
          href={{ pathname: '/todo/calendar', query: { view, date: anchor } }}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          Close
        </Link>
      </div>

      {event.location && (
        <p className="mt-3 flex items-baseline gap-1.5 text-ui text-ink">
          <MapPin className="size-4 shrink-0 self-center" strokeWidth={1.75} aria-hidden />
          {/* As the file said it: a room, a postcode, a video link. Wrapped
              rather than truncated, because a link nobody can read the end of
              is a link nobody can use. */}
          <span className="break-words">{event.location}</span>
        </p>
      )}

      {event.body && (
        // Whatever the organiser wrote. Their line breaks are kept and nothing
        // else is parsed out of it, since it is text from somebody else's
        // calendar; only its web addresses open, in a new tab.
        <p className="mt-3 whitespace-pre-wrap break-words text-ui text-ink">
          <LinkedText text={event.body} />
        </p>
      )}

      <div className="mt-4 border-t border-border pt-3">
        <LinkedTasks
          target="appointment"
          targetId={event.id}
          returnTo="/todo/calendar"
          tasks={tasks}
          timezone={timezone}
          title="Tasks about this"
          addLabel="Add a task about this"
          compact
        />
      </div>

      <p className="mt-4 border-t border-border pt-3 text-small text-ink-muted">
        From {feedName}. The meeting is a copy, so it is read here and changed where it
        lives; the tasks about it are yours.
      </p>
    </Card>
  );
}
