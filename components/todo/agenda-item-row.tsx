'use client';

import { useTransition } from 'react';
import { Check, Clock, ExternalLink, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { completeItem, deferItem, dismissItem } from '@/app/todo/source-actions';
import type { AgendaItem } from '@/lib/todo/agenda/sources';

/**
 * One thing the agenda found somewhere else.
 *
 * Visually quieter than a task, and marked with where it came from, because
 * the difference matters: this is not yours to edit. The actions are whatever
 * its source can actually express -- a return deadline has no "done", because
 * a date is not a task.
 */
export function AgendaItemRow({ item, timezone }: { item: AgendaItem; timezone: string }) {
  const [pending, start] = useTransition();

  return (
    <div className={cn('group row-pad flex items-start gap-3', pending && 'opacity-50')}>
      {item.completable ? (
        <button
          type="button"
          aria-label="Mark done"
          onClick={() => start(() => completeItem(item.source, item.key))}
          className="press mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded border border-control transition-colors duration-150 hover:border-accent"
        >
          <Check className="size-3 opacity-0 group-hover:opacity-40" strokeWidth={2} aria-hidden />
        </button>
      ) : (
        <span
          className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded border border-dashed border-border"
          aria-hidden
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {item.link ? (
            <a
              href={item.link.href}
              className="text-ui font-medium text-ink transition-colors duration-150 hover:text-accent"
            >
              {item.title}
            </a>
          ) : (
            <span className="text-ui font-medium text-ink">{item.title}</span>
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
          onClick={() => start(() => deferItem(item.source, item.key))}
          className="press flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
        >
          <Clock className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Later</span>
        </button>
        <button
          type="button"
          title="Not this one"
          onClick={() => start(() => dismissItem(item.source, item.key))}
          className="press flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
        >
          <X className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Not this one</span>
        </button>
      </div>
    </div>
  );
}
