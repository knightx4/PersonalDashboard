import { CardSection } from '@/components/ui/card';
import type { DigestEvent, DigestPointer } from '@/lib/digest/build';
import type { Digest } from '@/lib/digest/load';

/**
 * The morning summary, at the top of the page.
 *
 * Written once a day by the cron and read here as it was written, so the two
 * lists are the same all day however often the page is opened. Nothing on it
 * is computed at render time -- see `inngest/dev/digest.ts` for why.
 *
 * Nothing is drawn at all before the first one is written. An empty summary
 * would say "nothing happened" on a day nobody has looked at yet, which is a
 * different and stronger claim than the page has any evidence for.
 */

const EVENT_LABEL: Record<DigestEvent['kind'], string> = {
  step: 'Shipped',
  note: 'Fixed',
  decision: 'Answered',
};

const POINTER_LABEL: Record<DigestPointer['kind'], string> = {
  decision: 'Your answer',
  ready: 'Ready',
  suggestion: 'Noticed',
};

/**
 * UTC, because the day is the UTC date the run covered -- the same reason the
 * changelog formats its headings that way.
 *
 * Always printed, and never as "today": a cron that failed overnight leaves
 * the last summary on the page, and the date is how you tell.
 */
function formatDay(day: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 text-micro font-semibold uppercase tracking-wide text-ink-ghost">
      {children}
    </span>
  );
}

function Ref({ value }: { value: string }) {
  return <span className="tabular shrink-0 text-small text-ink-ghost">{value}</span>;
}

function Happened({ events }: { events: DigestEvent[] }) {
  return (
    <ul className="space-y-1.5">
      {events.map((event, index) => (
        <li key={`${event.kind}-${event.ref ?? index}`} className="space-y-0.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <Label>{EVENT_LABEL[event.kind]}</Label>
            {event.ref && <Ref value={event.ref} />}
            <span className="min-w-0 flex-1 text-body text-ink">{event.title}</span>
            {/* Short, because the line is a reminder of what shipped rather
                than the place anybody pastes a sha from. The changelog prints
                it whole. */}
            {event.commit && (
              <span className="font-mono shrink-0 text-micro text-ink-ghost">{event.commit}</span>
            )}
          </div>
          {event.note && <p className="text-small text-ink-muted">{event.note}</p>}
        </li>
      ))}
    </ul>
  );
}

function Attention({ pointers }: { pointers: DigestPointer[] }) {
  return (
    <ul className="space-y-1.5">
      {pointers.map((pointer, index) => (
        <li key={`${pointer.kind}-${pointer.ref ?? index}`} className="space-y-0.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <Label>{POINTER_LABEL[pointer.kind]}</Label>
            {pointer.ref && <Ref value={pointer.ref} />}
            <span className="min-w-0 flex-1 text-body text-ink">{pointer.title}</span>
          </div>
          {pointer.detail && <p className="text-small text-ink-muted">{pointer.detail}</p>}
        </li>
      ))}
    </ul>
  );
}

export function DigestPanel({ digest }: { digest: Digest | null }) {
  if (!digest) return null;

  return (
    <div className="space-y-3">
      <CardSection title="What happened" hint={`In the 24 hours to ${formatDay(digest.day)}`}>
        {digest.happened.length > 0 ? (
          <Happened events={digest.happened} />
        ) : (
          <p className="text-body text-ink-muted">Nothing closed.</p>
        )}
      </CardSection>

      {digest.attention.length > 0 && (
        <CardSection title="Worth a look">
          <Attention pointers={digest.attention} />
        </CardSection>
      )}
    </div>
  );
}
