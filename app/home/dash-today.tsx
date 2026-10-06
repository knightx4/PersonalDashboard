'use client';

import { useState, useTransition } from 'react';
import Link from '@/components/ui/link';
import { Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FieldError } from '@/components/ui/field';
import { ModuleMark } from '@/components/ui/module-mark';
import { formatClock } from '@/lib/clock';
import type { DashTodayEntry, DashTodayGroup } from '@/lib/shell/dash-today';
import type { UndoDashTodayResult } from './actions';

/** How many rows a group shows before the rest fold under "Show N more". */
export const GROUP_SHOWN = 4;

/**
 * What Dash changed today, by workspace, each with Undo (plan #1461). The
 * page leaves it out on a day Dash changed nothing.
 *
 * A busy day can put dozens of plan closes under Dev, so each group shows its
 * newest few and folds the rest. An undo that goes through leaves the row in
 * place, said as undone, so the press has something to answer it; the next
 * load lists it the same way. A change recorded with no Undo (plan #1571)
 * says why beneath its sentence instead of offering the button. A change
 * made in a thread links to the row whose thread asked for it (plan #1518).
 */
export function DashTodaySection({
  groups,
  timezone,
  undo,
}: {
  groups: readonly DashTodayGroup[];
  timezone: string;
  /** undoDashToday from ./actions, or a fixture. Never throws. */
  undo: (id: string) => Promise<UndoDashTodayResult>;
}) {
  const count = groups.reduce((sum, group) => sum + group.entries.length, 0);
  if (count === 0) return null;
  return (
    <Card id="dash-today" padding="standard" className="mt-4 scroll-mt-bar">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-ui font-semibold text-ink">What Dash did today</h2>
        <span className="tabular text-small text-ink-muted">
          {count} {count === 1 ? 'change' : 'changes'}
        </span>
      </div>
      <div className="mt-2 space-y-4">
        {groups.map((group) => (
          <DashTodayGroupList
            key={group.workspace ?? 'app'}
            group={group}
            timezone={timezone}
            undo={undo}
          />
        ))}
      </div>
    </Card>
  );
}

function DashTodayGroupList({
  group,
  timezone,
  undo,
}: {
  group: DashTodayGroup;
  timezone: string;
  undo: (id: string) => Promise<UndoDashTodayResult>;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? group.entries : group.entries.slice(0, GROUP_SHOWN);
  const folded = group.entries.length - shown.length;
  return (
    <section aria-label={group.label}>
      <h3 className="flex items-center gap-2 text-small font-medium text-ink-muted">
        <ModuleMark module={group.workspace} size="sm" />
        {group.label}
      </h3>
      <ul className="mt-1 divide-y divide-border">
        {shown.map((entry) => (
          <DashTodayRow key={entry.id} entry={entry} timezone={timezone} undo={undo} />
        ))}
      </ul>
      {folded > 0 && (
        <Button type="button" size="sm" variant="ghost" className="-ml-2" onClick={() => setOpen(true)}>
          Show {folded} more
        </Button>
      )}
    </section>
  );
}

function DashTodayRow({
  entry,
  timezone,
  undo,
}: {
  entry: DashTodayEntry;
  timezone: string;
  undo: (id: string) => Promise<UndoDashTodayResult>;
}) {
  const [undone, setUndone] = useState(entry.status === 'undone');
  const [error, setError] = useState<string | null>(null);
  const [pending, startUndo] = useTransition();

  function press() {
    setError(null);
    startUndo(async () => {
      const result = await undo(entry.id).catch(
        (): UndoDashTodayResult => ({
          ok: false,
          error: 'That did not go through. Check your connection and try again.',
        }),
      );
      if (result.ok) setUndone(true);
      else setError(result.error);
    });
  }

  const time = formatClock(entry.at, { timeZone: timezone });
  return (
    <li className="py-2">
      <div className="flex items-baseline gap-3">
        <span className="tabular hidden w-16 shrink-0 text-small text-ink-muted sm:block">{time}</span>
        <div className="min-w-0 flex-1">
          <p className={undone ? 'text-ui text-ink-muted' : 'text-ui text-ink'}>
            {entry.href && !undone ? (
              // Block, with a 44px hit area centred on it: a one-line
              // sentence is otherwise a 16px press target on a phone.
              <Link
                href={entry.href}
                className="relative block hover:text-accent before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']"
              >
                {entry.sentence}
              </Link>
            ) : (
              entry.sentence
            )}
          </p>
          {/* On a phone the time sits on this quiet line, so the sentence
              has the row's width; from sm up it has its own column. */}
          <p className={entry.from ? 'text-small text-ink-muted' : 'text-small text-ink-muted sm:hidden'}>
            <span className="tabular sm:hidden">{time}</span>
            {entry.from && (
              <>
                <span className="sm:hidden" aria-hidden>
                  {' · '}
                </span>
                <Link href={entry.from} className="hover:text-accent">
                  From your comment
                </Link>
              </>
            )}
          </p>
          {entry.noUndo && !undone && <p className="text-small text-ink-muted">{entry.noUndo}</p>}
          {error && <FieldError>{error}</FieldError>}
        </div>
        {undone ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-small font-medium text-ink-muted">
            <Undo2 className="size-3.5" strokeWidth={2} aria-hidden />
            Undone
          </span>
        ) : entry.noUndo ? null : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="-mr-2 shrink-0"
            pending={pending}
            disabled={pending}
            onClick={press}
          >
            <Undo2 className="size-3.5" strokeWidth={2} aria-hidden />
            {pending ? 'Undoing…' : 'Undo'}
          </Button>
        )}
      </div>
    </li>
  );
}
