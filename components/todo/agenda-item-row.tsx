'use client';

import { Clock, ExternalLink, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { useOptimisticWrite } from '@/lib/use-optimistic-write';
import { completeItem, deferItem, dismissItem } from '@/app/todo/source-actions';
import type { AgendaItem } from '@/lib/todo/agenda/sources';

/** What the row has been asked to do, until the page is rebuilt without it. */
type ItemState = 'open' | 'done' | 'deferred' | 'dismissed';

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
            'press mt-0.5 flex size-[18px] shrink-0 items-center justify-center transition-colors duration-150',
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
          {item.link ? (
            <a
              href={item.link.href}
              className={cn(
                'text-ui font-medium text-ink transition-colors duration-150 hover:text-accent',
                shown === 'done' && 'line-through',
              )}
            >
              {item.title}
            </a>
          ) : (
            <span className={cn('text-ui font-medium text-ink', shown === 'done' && 'line-through')}>
              {item.title}
            </span>
          )}

          {item.at && (
            <span className="tabular text-small text-ink-muted">
              {new Intl.DateTimeFormat('en-GB', {
                timeZone: timezone,
                hour: '2-digit',
                minute: '2-digit',
              }).format(new Date(item.at))}
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
              className="truncate text-small text-ink-muted underline decoration-border underline-offset-2 transition-colors duration-150 hover:text-accent"
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
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        <button
          type="button"
          title="Later"
          onClick={() =>
            run({ state: 'deferred', write: () => deferItem(item.source, item.key) })
          }
          className="press flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
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
          className="press flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
        >
          <X className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Not this one</span>
        </button>
      </div>
    </div>
  );
}
