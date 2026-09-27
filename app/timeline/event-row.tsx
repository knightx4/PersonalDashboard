import Link from 'next/link';
import { ModuleMark } from '@/components/ui/module-mark';
import { formatMoney } from '@/lib/money';
import { KIND_NOUNS, timelineHref, type TimelineEvent } from '@/lib/timeline/timeline';

/**
 * One event on the timeline, linked to where it lives: the day, the
 * workspace's mark, what it happened to and what happened. The timeline's
 * months list these, and so does "Show me" under an observation, where the
 * rows span twelve weeks and so carry the month (`withMonth`).
 */
export function EventRow({
  event,
  timezone,
  withMonth = false,
}: {
  event: TimelineEvent;
  timezone: string;
  withMonth?: boolean;
}) {
  const what = KIND_NOUNS[event.kind].one;
  const second = [
    what.charAt(0).toUpperCase() + what.slice(1),
    event.amount_cents != null ? formatMoney(event.amount_cents, event.currency ?? 'USD') : null,
    // An order's detail is its order number, which the amount says more usefully.
    event.kind === 'ordered' ? null : event.detail,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li>
      <Link href={timelineHref(event)} className="flex items-center gap-3 px-1 py-2 hover:bg-sunken">
        <span className="tabular w-12 shrink-0 text-small text-ink-muted">{dayLabel(event.occurred_at, timezone, withMonth)}</span>
        <ModuleMark module={event.module} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui text-ink">{event.title}</span>
          <span className="block truncate text-small text-ink-muted">{second}</span>
        </span>
      </Link>
    </li>
  );
}

/** "Sat 26", or "26 Sep" with the month, on the person's calendar. */
function dayLabel(iso: string, timezone: string, withMonth: boolean): string {
  const parts: Intl.DateTimeFormatOptions = withMonth
    ? { day: 'numeric', month: 'short', timeZone: timezone }
    : { weekday: 'short', day: 'numeric', timeZone: timezone };
  return new Intl.DateTimeFormat('en-GB', parts).format(new Date(iso));
}
