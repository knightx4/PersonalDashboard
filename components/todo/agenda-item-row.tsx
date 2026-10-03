'use client';

import { Clock, ExternalLink, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ModuleMark } from '@/components/ui/module-mark';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { useOptimisticWrite } from '@/lib/use-optimistic-write';
import { answerItem, completeItem, deferItem, dismissItem } from '@/app/todo/source-actions';
import type { AgendaItem, AgendaItemOption } from '@/lib/todo/agenda/sources';
import { formatClock } from '@/lib/clock';

/** What the row has been asked to do, until the page is rebuilt without it. */
type ItemState = 'open' | 'done' | 'answered' | 'deferred' | 'dismissed';

/**
 * One thing the agenda found somewhere else.
 *
 * Visually quieter than a task, and marked with where it came from, because
 * the difference matters: this is not yours to edit. The actions are whatever
 * its source can actually express -- a return deadline has no "done", because
 * a date is not a task.
 */
export function AgendaItemRow({ item, timezone }: { item: AgendaItem; timezone: string }) {
  /**
   * What has been done to this item, before the source has confirmed it.
   *
   * The row cannot take itself off the list -- the page rebuilds the agenda
   * from the sources -- so the immediate answer is the row marking itself:
   * ticked and struck through for a finish, faded for a "later" or a "not this
   * one". It is drawn against a fixed 'open', because an item is on the agenda
   * exactly while it is outstanding, so a refused write leaves the row as it
   * was and the hook's toast says which source refused it and why.
   */
  const { shown, run, failed } = useOptimisticWrite<
    ItemState,
    { state: ItemState; write: () => Promise<{ error: string | null }> }
  >({
    value: 'open',
    apply: (_current, change) => change.state,
    write: (change) => change.write(),
  });

  const acted = shown !== 'open';

  return (
    <div
      className={cn(
        'group row-pad flex items-start gap-3',
        acted && 'opacity-60',
        failed && 'bg-danger-tint',
      )}
    >
      {/* The grip gutter, empty. A task row keeps a 12px margin here for its
          drag handle; an agenda item cannot be reordered and so has no handle
          to put in it. Leaving the gutter out moved the checkbox 20px left,
          which in a list that interleaves both kinds read as the borrowed rows
          being indented differently from the real ones. The column has to be
          there whether or not anything is drawn in it, on exactly the same
          media query, or the two kinds fall out of line the moment there is a
          pointer. */}
      <span className="-ml-1 mt-0.5 hidden w-3 shrink-0 [@media(hover:hover)]:block" aria-hidden />

      {/* The same hexagon a task draws, for the same reason a task stopped
          drawing a bordered box: the shape is the state, and a rounded square
          beside a row of hexagons reads as a different kind of thing rather
          than as the same list. An item you can tick takes the task ladder --
          empty until it is done, then the tick. One you cannot takes the
          dashed hexagon, which is the glyph for a state that is not on a
          ladder at all: an interview or a return deadline is an appointment,
          not something you finish. */}
      {item.completable ? (
        <button
          type="button"
          aria-label="Mark done"
          onClick={() => run({ state: 'done', write: () => completeItem(item.source, item.key) })}
          className={cn(
            'press mt-0.5 flex size-[18px] shrink-0 items-center justify-center transition-colors duration-quick',
            shown === 'done' ? 'text-status-offer' : 'text-ink-muted hover:text-accent',
          )}
        >
          <StatusGlyph glyph={shown === 'done' ? 'check' : 'empty'} size={16} />
        </button>
      ) : (
        <span
          className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center text-ink-muted"
          aria-hidden
        >
          <StatusGlyph glyph="dashed" size={16} />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {/* What came from Goals carries the Goals mark, the lime flag, so a
              step towards a goal is told apart from a task at a glance (note
              134ec065). The mark rather than a green row: green on this app
              means money came back (law 4), and the mark is the colour the
              person asked for with the shape that says why. */}
          {item.source === 'goal_steps' && (
            <span className="self-center">
              <ModuleMark module="goals" size="xs" />
              <span className="sr-only">From Goals: </span>
            </span>
          )}
          {item.link ? (
            <a
              href={item.link.href}
              className={cn(
                'text-ui font-medium text-ink transition-colors duration-quick hover:text-accent',
                shown === 'done' && 'line-through',
              )}
            >
              {item.title}
            </a>
          ) : (
            <span
              className={cn('text-ui font-medium text-ink', shown === 'done' && 'line-through')}
            >
              {item.title}
            </span>
          )}

          {item.at && (
            <span className="tabular text-small text-ink-muted">
              {formatClock(item.at, { timeZone: timezone })}
            </span>
          )}

          {item.detail && <span className="text-small text-ink-muted">{item.detail}</span>}

          {/* Where this thing lives, named and underlined. The title is a link
              too, but a bold heading that happens to be clickable is not an
              affordance anyone sees -- least of all on a phone, where there is
              no hover to reveal it. This matches a linked task's anchor, so
              "click through to the job" reads the same on both kinds of row. */}
          {item.link && (
            <a
              href={item.link.href}
              className="truncate text-small text-ink-muted underline decoration-border underline-offset-2 transition-colors duration-quick hover:text-accent"
            >
              {item.link.label}
            </a>
          )}

          {item.action && (
            <a
              href={item.action.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-small font-medium text-accent underline underline-offset-2"
            >
              <ExternalLink className="size-3" strokeWidth={1.75} aria-hidden />
              {item.action.label}
            </a>
          )}
        </div>

        {item.options && item.options.length > 0 && (
          <ItemOptions
            options={item.options}
            disabled={acted}
            onChoose={(option) =>
              run({
                state: 'answered',
                write: () => answerItem(item.source, item.key, option.answer),
              })
            }
          />
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        <button
          type="button"
          title="Later"
          onClick={() => run({ state: 'deferred', write: () => deferItem(item.source, item.key) })}
          className="press flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-quick hover:bg-sunken hover:text-ink"
        >
          <Clock className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Later</span>
        </button>
        <button
          type="button"
          title="Not this one"
          onClick={() =>
            run({ state: 'dismissed', write: () => dismissItem(item.source, item.key) })
          }
          className="press flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-quick hover:bg-sunken hover:text-ink"
        >
          <X className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Not this one</span>
        </button>
      </div>
    </div>
  );
}

/**
 * A question's lettered options as buttons (plan #1267), drawn the way the
 * goal page draws them (TheOptions in components/dev/question.tsx): the
 * letter in a badge, the option's name beside it, and a soft green ring on
 * the one the question recommends. Here a press answers at once, since the
 * row has no box to fill; saying it differently is the goal page's job, which
 * the title links to.
 */
function ItemOptions({
  options,
  disabled,
  onChoose,
}: {
  options: AgendaItemOption[];
  disabled: boolean;
  onChoose: (option: AgendaItemOption) => void;
}) {
  return (
    <ul className="mt-1 flex flex-wrap gap-1" aria-label="Answer with">
      {options.map((option) => (
        <li key={option.letter}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChoose(option)}
            title={`Answer ${option.letter}: ${option.label}${option.recommended ? ' (recommended)' : ''}`}
            className="press flex items-start gap-1.5 rounded-control bg-sunken px-1.5 py-1 text-left transition-colors duration-quick hover:bg-accent-tint disabled:pointer-events-none"
          >
            <span
              aria-hidden
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-control text-micro font-semibold uppercase',
                option.recommended
                  ? 'bg-positive-tint text-positive ring-2 ring-positive/50'
                  : 'bg-surface text-ink',
              )}
            >
              {option.letter}
            </span>
            <span className="text-small text-ink">
              {option.label}
              {option.recommended && <span className="sr-only"> (recommended)</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
