'use client';

import { useActionState } from 'react';
import { ChevronRight, MessageCircleQuestion } from 'lucide-react';
import { dismissRaise, reopenRaise, type RaisedActionState } from './actions';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldError } from '@/components/ui/field';
import { MODULES, type ModuleId } from '@/lib/modules';
import type { RaisedQueue, RaisedRow } from '@/lib/raised/load';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

const MODULE_LABEL: Record<ModuleId, string> = Object.fromEntries(
  MODULES.map((module) => [module.id, module.label]),
) as Record<ModuleId, string>;

/** "Everything" rather than an empty label, the same as the ideas list. */
function scopeLabel(module: ModuleId | null): string {
  return module ? MODULE_LABEL[module] : 'Everything';
}

function StatusLabel({ row }: { row: RaisedRow }) {
  if (row.status === 'open') return null;
  return (
    <span className="text-small text-ink-muted">
      {row.status === 'answered' ? 'Answered' : 'Dismissed'}
    </span>
  );
}

function RaiseCard({ row }: { row: RaisedRow }) {
  const [dismissState, dismissAction, dismissPending] = useActionState(
    dismissRaise,
    {} as RaisedActionState,
  );
  const [reopenState, reopenAction, reopenPending] = useActionState(
    reopenRaise,
    {} as RaisedActionState,
  );

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-accent-tint px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-accent">
          {scopeLabel(row.module)}
        </span>
        <span className="tabular text-small text-ink-muted">{row.createdAt.slice(0, 10)}</span>
        <StatusLabel row={row} />
      </div>

      <p className="text-body font-semibold text-ink">{row.title}</p>
      {row.detail && <p className="whitespace-pre-wrap text-body text-ink">{row.detail}</p>}

      {/* Which run raised it. Without this a raise is a voice from nowhere, and
          the first thing you want to know is what it was doing at the time. */}
      {row.source && <p className="text-small text-ink-muted">Raised by {row.source}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {row.status === 'open' ? (
          <form action={dismissAction}>
            <input type="hidden" name="id" value={row.id} />
            <Button type="submit" size="sm" variant="ghost" pending={dismissPending}>
              Dismiss
            </Button>
          </form>
        ) : (
          <form action={reopenAction}>
            <input type="hidden" name="id" value={row.id} />
            <Button type="submit" size="sm" variant="ghost" pending={reopenPending}>
              Reopen
            </Button>
          </form>
        )}
        <FieldError>{dismissState.error ?? reopenState.error}</FieldError>
      </div>
    </li>
  );
}

/**
 * What sessions have asked you, open ones first.
 *
 * Answered and dismissed rows go under a disclosure rather than in the list:
 * the reason to open this page is what is still waiting, and a closed raise is
 * kept so that a session can read the answer back rather than so you can read
 * it again.
 */
export function RaisedView({ queue }: { queue: RaisedQueue }) {
  return (
    <div className="space-y-6">
      {queue.open.length === 0 && (
        <EmptyState
          icon={MessageCircleQuestion}
          title="Nothing waiting on you"
          description="A session writes here when it needs something you have to decide — a risk it found while building something else, or a question of taste it will not answer on its own."
        />
      )}

      {queue.open.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-body font-semibold text-ink">
            Waiting on you <span className="font-normal text-ink-muted">({queue.open.length})</span>
          </h2>
          <ul className={cn(cardVariants(), 'divide-y divide-border')}>
            {queue.open.map((row) => (
              <RaiseCard key={row.id} row={row} />
            ))}
          </ul>
        </section>
      )}

      {queue.closed.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-body font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="size-4 shrink-0 text-ink-ghost transition-transform duration-150 group-open:rotate-90"
              strokeWidth={1.75}
              aria-hidden
            />
            Closed <span className="font-normal text-ink-muted">({queue.closed.length})</span>
          </summary>
          <ul className={cn(cardVariants(), 'mt-2 divide-y divide-border')}>
            {queue.closed.map((row) => (
              <RaiseCard key={row.id} row={row} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
