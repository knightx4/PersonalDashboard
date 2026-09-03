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
    <div className={cn('group flex items-start gap-3 py-2.5', pending && 'opacity-50')}>
      {item.completable ? (
        <button
          type="button"
          aria-label="Mark done"
          onClick={() => start(() => completeItem(item.source, item.key))}
          className="press mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded border border-border-strong hover:border-brand"
        >
          <Check className="size-3 opacity-0 group-hover:opacity-40" strokeWidth={3} aria-hidden />
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
              className="text-[13px] font-medium text-ink hover:text-brand"
            >
              {item.title}
            </a>
          ) : (
            <span className="text-[13px] font-medium text-ink">{item.title}</span>
          )}

          {item.at && (
            <span className="tabular text-[12px] text-ink-muted">
              {new Intl.DateTimeFormat('en-GB', {
                timeZone: timezone,
                hour: '2-digit',
                minute: '2-digit',
              }).format(new Date(item.at))}
            </span>
          )}

          {item.detail && <span className="text-[12px] text-ink-muted">{item.detail}</span>}

          {item.action && (
            <a
              href={item.action.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-brand underline underline-offset-2"
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
          className="press flex size-7 items-center justify-center rounded text-ink-faint hover:bg-canvas hover:text-ink"
        >
          <Clock className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Later</span>
        </button>
        <button
          type="button"
          title="Not this one"
          onClick={() => start(() => dismissItem(item.source, item.key))}
          className="press flex size-7 items-center justify-center rounded text-ink-faint hover:bg-canvas hover:text-ink"
        >
          <X className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Not this one</span>
        </button>
      </div>
    </div>
  );
}
