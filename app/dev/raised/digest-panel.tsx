import Link from 'next/link';
import { CardSection } from '@/components/ui/card';
import { groupHappened, type DigestEvent, type DigestGroup, type DigestPointer } from '@/lib/digest/build';
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
 *
 * What closed opens with the written account of the day and is then grouped
 * under the feature each row closed under, fifteen rows at most. Flat and
 * uncapped it was fifty-four lines on a busy day, which is a list rather than
 * a summary; the rest are on the changelog and the last line says how many.
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

function Events({ events }: { events: DigestEvent[] }) {
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

/**
 * One feature and what closed under it. The heading is the feature rather than
 * a line of its own, which is what stops six steps reading as six pieces of
 * work.
 */
function Group({ group }: { group: DigestGroup }) {
  return (
    <section className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-2">
        {group.ref && <Ref value={group.ref} />}
        <h3 className="min-w-0 flex-1 text-body font-semibold text-ink">{group.label}</h3>
      </div>
      <div className="ml-0.5 border-l border-border pl-3">
        <Events events={group.events} />
      </div>
    </section>
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

  const { groups, more } = groupHappened(digest.happened);

  return (
    <div className="space-y-3">
      <CardSection title="What happened" hint={`In the 24 hours to ${formatDay(digest.day)}`}>
        <div className="space-y-3">
          {/* The account of the day, above the rows it is an account of. Absent
              on a summary written before there was one, and on a day the model
              call did not happen. */}
          {digest.summary && (
            <p className="whitespace-pre-wrap text-body text-ink">{digest.summary}</p>
          )}

          {groups.length > 0 ? (
            <div className="space-y-3">
              {groups.map((group) => (
                <Group key={group.key} group={group} />
              ))}
            </div>
          ) : (
            <p className="text-body text-ink-muted">Nothing closed.</p>
          )}

          {more > 0 && (
            <p className="text-small text-ink-muted">
              {more} more closed.{' '}
              <Link href="/dev/changelog" className="underline underline-offset-2 hover:text-ink">
                See the changelog
              </Link>
              .
            </p>
          )}
        </div>
      </CardSection>

      {digest.attention.length > 0 && (
        <CardSection title="Worth a look">
          <Attention pointers={digest.attention} />
        </CardSection>
      )}
    </div>
  );
}
