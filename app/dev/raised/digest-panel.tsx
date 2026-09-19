import Link from 'next/link';
import { Moon } from 'lucide-react';
import { OvernightState } from '@/components/dev/overnight-state';
import { Card } from '@/components/ui/card';
import { Disclosure, SectionFold } from '@/components/ui/disclosure';
import { groupHappened, type DigestEvent, type DigestGroup } from '@/lib/digest/build';
import type { Digest } from '@/lib/digest/load';
import { nightBudgetLine, nightLine, nightRows, type DigestNight } from '@/lib/digest/night';

/**
 * The morning summary, at the top of the page.
 *
 * Written once a day by the cron and read here as it was written, so it says
 * the same thing all day however often the page is opened. Nothing on it is
 * computed at render time -- see `inngest/dev/digest.ts` for why.
 *
 * It draws the day, and above it one line on what the night filed. The stored
 * summary also carries an attention list -- what the night noticed about the
 * board -- which used to be a second card here called "Worth a look". #623
 * moved those lines to the ideas page, so this file no longer reads
 * `digest.attention`; the night still writes it. What it reads instead is the
 * count of ideas that reading turned into, because otherwise nothing on Dash
 * says they arrived.
 *
 * Nothing is drawn at all before the first one is written. An empty summary
 * would say "nothing happened" on a day nobody has looked at yet, which is a
 * different and stronger claim than the page has any evidence for.
 *
 * The written account of the day is the whole of what is shown: one paragraph,
 * and then a fold. Everything under it -- the night the runner had, and what
 * closed grouped under the feature it closed beneath -- is the evidence for
 * that paragraph rather than a second telling of it, and reading it is a
 * choice. It used to be laid out flat, which made the one thing worth reading
 * every morning the third thing on the card and put fifty-four lines of rows
 * above the questions waiting underneath.
 *
 * Inside the fold the night is first, because it is the thing you went to bed
 * wondering about: the runner worked while you were asleep and nothing else on
 * the page says what it did. Every word of it is the runner's own -- the state
 * word and the shape are the ones the control on the plan page draws, and the
 * sentence saying why it stopped is the sentence the row carries, printed
 * verbatim. What closed is fifteen rows at most; the rest are on the changelog
 * and the last line says how many.
 */

const EVENT_LABEL: Record<DigestEvent['kind'], string> = {
  step: 'Shipped',
  note: 'Fixed',
  decision: 'Answered',
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

/**
 * The night, above everything else that happened.
 *
 * One list rather than three, in the order the night made them: what it
 * worked, what closed, what it left stopped. The same labelled rows the rest
 * of the summary uses, because it is the same kind of fact -- a thing that
 * happened, named by its number.
 *
 * The two silences are said out loud. A night that fired nothing and a night
 * whose sessions closed nothing are the two outcomes worth getting out of bed
 * for, and a report that just showed a short list would leave you counting.
 *
 * A blocked row carries the feature it stops, where one of the closed rows
 * does not: the feature is already named above as worked, and the blocked step
 * is the one you are about to do something about.
 *
 * Each list is cut at ten and says how many it cut, the same way the day's own
 * rows are: the stored night holds all of them, and a busy night's thirty
 * closed steps are a list rather than a report. The changelog has the rest.
 */
function Night({ night }: { night: DigestNight }) {
  const worked = nightRows(night.features);
  const closed = nightRows(night.closed);
  const blocked = nightRows(night.blocked);

  return (
    <section aria-label="The overnight runner" className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-body font-semibold text-ink">
          <Moon className="size-4 text-ink-muted" aria-hidden />
          Overnight
        </span>
        <OvernightState standing={night.standing} />
        <span className="tabular text-small text-ink-muted">{nightBudgetLine(night)}</span>
      </div>

      <p className="text-body text-ink">{nightLine(night)}</p>

      <div className="ml-0.5 border-l border-border pl-3">
        <ul className="space-y-1.5">
          {worked.shown.map((feature) => (
            <li key={`worked-${feature.ref}`} className="flex flex-wrap items-baseline gap-2">
              <Label>Worked</Label>
              <Ref value={feature.ref} />
              <span className="min-w-0 flex-1 text-body text-ink">{feature.title}</span>
            </li>
          ))}
          {closed.shown.map((step) => (
            <li key={`closed-${step.ref}`} className="flex flex-wrap items-baseline gap-2">
              <Label>Closed</Label>
              <Ref value={step.ref} />
              <span className="min-w-0 flex-1 text-body text-ink">{step.title}</span>
            </li>
          ))}
          {blocked.shown.map((step) => (
            <li key={`blocked-${step.ref}`} className="space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <Label>Blocked</Label>
                <Ref value={step.ref} />
                <span className="min-w-0 flex-1 text-body text-ink">{step.title}</span>
                {step.feature && <Ref value={step.feature.ref} />}
              </div>
              {step.ask && <p className="text-small text-ink-muted">{step.ask}</p>}
            </li>
          ))}
        </ul>

        {night.features.length === 0 && (
          <p className="text-body text-ink-muted">It fired nothing.</p>
        )}
        {night.features.length > 0 && night.closed.length === 0 && (
          <p className="text-small text-ink-muted">No step closed.</p>
        )}
        {(worked.more > 0 || closed.more > 0 || blocked.more > 0) && (
          <p className="text-small text-ink-muted">
            {[
              worked.more > 0 && `${worked.more} more worked`,
              closed.more > 0 && `${closed.more} more closed`,
              blocked.more > 0 && `${blocked.more} more blocked`,
            ]
              .filter(Boolean)
              .join(' · ')}
            .
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * What the night filed, above the account of the day.
 *
 * Drawn only when there is a number to say. A line reading "0 new ideas" is a
 * report on nothing having happened, and it would be on the page every day the
 * reading found nothing worth writing down -- which is most of them.
 *
 * It says how many and where they are, and not what they were. Naming them
 * here would be the Worth a look card again, in a thinner font: the ideas page
 * is where a suggestion is read, put aside or shaped, and this line exists to
 * send you there.
 */
function IdeasFiled({ count }: { count: number }) {
  if (count < 1) return null;

  return (
    <p className="text-body text-ink">
      {count === 1 ? 'One new idea was' : `${count} new ideas were`} filed overnight.{' '}
      {count === 1 ? 'It is' : 'They are'} on the{' '}
      <Link href="/dev/ideas" className="underline underline-offset-2 hover:text-ink">
        ideas page
      </Link>
      .
    </p>
  );
}

export function DigestPanel({ digest }: { digest: Digest | null }) {
  if (!digest) return null;

  const { groups, more } = groupHappened(digest.happened);

  // Folded by its own heading rather than drawn open forever. This is the
  // longest thing on the page -- an account of the day plus fifteen rows
  // grouped under their features -- and it is also the part you are done with
  // first: you read the summary, and then you want the questions underneath
  // it. The day is on the closed line, because a cron that failed overnight
  // leaves yesterday's summary here and the date is how you tell. Law 10.
  return (
    <Card padding="dense">
      <SectionFold title="What happened" hint={`In the 24 hours to ${formatDay(digest.day)}`}>
        <div className="space-y-3">
          {/* Above the account of the day, because it is the only new thing on
              the page that is not a question: the account says what closed,
              and an idea filed last night closed nothing. */}
          <IdeasFiled count={digest.ideasFiled} />

          {/* The paragraph, and nothing else above the fold. Absent on a
              summary written before there was one, and on a day the model
              call did not happen -- and then the fold is the whole card,
              which is why it says what is in it on its closed line. */}
          {digest.summary ? (
            <p className="whitespace-pre-wrap text-body text-ink">{digest.summary}</p>
          ) : (
            <p className="text-body text-ink-muted">No account was written for this day.</p>
          )}

          {/* Everything the paragraph is an account of, folded (law 10). The
              closed line carries the counts, so opening it is a choice
              rather than a check: a night that fired two features and a day
              that closed none are both legible without it. */}
          <Disclosure
            title="The detail"
            meta={[
              digest.night ? nightBudgetLine(digest.night) : null,
              // `more` is the remainder past the cut, so `happened` is
              // already the whole count and adding it would say it twice.
              digest.happened.length > 0
                ? `${digest.happened.length} closed`
                : 'nothing closed',
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            <div className="space-y-3">
              {digest.night && <Night night={digest.night} />}

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
                  <Link
                    href="/dev/changelog"
                    className="underline underline-offset-2 hover:text-ink"
                  >
                    See the changelog
                  </Link>
                  .
                </p>
              )}
            </div>
          </Disclosure>
        </div>
      </SectionFold>
    </Card>
  );
}
