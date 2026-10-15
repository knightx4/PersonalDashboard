'use client';

import { useState, useTransition } from 'react';
import Link from '@/components/ui/link';
import { Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FieldError } from '@/components/ui/field';
import { ModuleMark } from '@/components/ui/module-mark';
import { Timeline, type TimelineEntry } from '@/components/ui/timeline';
import { formatClock } from '@/lib/clock';
import { cn } from '@/lib/cn';
import type { DashTodayEntry, DashTodayGroup } from '@/lib/shell/dash-today';
import { changesLabel, dashTodayCount } from '@/lib/shell/dash-today-count';
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
  const count = dashTodayCount(groups);
  if (count === 0) return null;
  return (
    <Card id="dash-today" padding="standard" className="scroll-mt-bar">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-ui font-semibold text-ink">What Dash did today</h2>
        <span className="tabular text-small text-ink-muted">{changesLabel(count)}</span>
      </div>
      <DashTodayGroups groups={groups} timezone={timezone} undo={undo} className="mt-2" />
    </Card>
  );
}

/**
 * The groups without the card round them: Home draws them inside its rail's
 * fold (plan #1937.8), which carries the heading and the count.
 */
export function DashTodayGroups({
  groups,
  timezone,
  undo,
  className,
}: {
  groups: readonly DashTodayGroup[];
  timezone: string;
  undo: (id: string) => Promise<UndoDashTodayResult>;
  className?: string;
}) {
  return (
    <div className={cn('space-y-4', className)}>
      {groups.map((group) => (
        <DashTodayGroupList
          key={group.workspace ?? 'app'}
          group={group}
          timezone={timezone}
          undo={undo}
        />
      ))}
    </div>
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
  // Undo state sits here, not on each row, so the timeline can draw the
  // button as an entry's action and still show Undone and errors beneath it.
  const [undone, setUndone] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  function press(id: string) {
    setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id)));
    setPending((prev) => new Set(prev).add(id));
    void undo(id)
      .catch(
        (): UndoDashTodayResult => ({
          ok: false,
          error: 'That did not go through. Check your connection and try again.',
        }),
      )
      .then((result) => {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        if (result.ok) setUndone((prev) => new Set(prev).add(id));
        else setErrors((prev) => ({ ...prev, [id]: result.error }));
      });
  }

  // One change or none is a plain list; two or more are drawn as a timeline.
  const asTimeline = shown.length >= 2;
  const entries: TimelineEntry[] = asTimeline
    ? shown.map((entry): TimelineEntry => {
        const gone = entry.status === 'undone' || undone.has(entry.id);
        const note = gone ? undefined : (errors[entry.id] ?? entry.noUndo ?? undefined);
        return {
          id: entry.id,
          time: entry.at,
          // The quiet marks, not the green tick: green is for money coming
          // back (design law 4), and the struck mark already says undone.
          kind: gone ? 'dropped' : 'note',
          title: entry.sentence,
          body: note,
          // One link per entry: the comment a change came from wins over the
          // row it touched (plan #1518), which the sentence names anyway.
          link: gone
            ? undefined
            : entry.from
              ? { href: entry.from, label: 'Your comment' }
              : entry.href
                ? { href: entry.href, label: 'Open' }
                : undefined,
          action:
            // An undone change says so in the action slot, on the time's line.
            gone
              ? { label: 'Undone', disabled: true, onSelect: () => {} }
              : entry.noUndo
                ? undefined
                : {
                    label: pending.has(entry.id) ? 'Undoing…' : 'Undo',
                    disabled: pending.has(entry.id),
                    onSelect: () => press(entry.id),
                  },
        };
      })
    : [];

  return (
    <section aria-label={group.label}>
      <h3 className="flex items-center gap-2 text-small font-medium text-ink-muted">
        <ModuleMark module={group.workspace} size="sm" />
        {group.label}
      </h3>
      {asTimeline ? (
        <Timeline className="mt-2" entries={entries} timeZone={timezone} />
      ) : (
        <ul className="mt-1 divide-y divide-border">
          {shown.map((entry) => (
            <DashTodayRow key={entry.id} entry={entry} timezone={timezone} undo={undo} />
          ))}
        </ul>
      )}
      {folded > 0 && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="-ml-2"
          onClick={() => setOpen(true)}
        >
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
        <div className="min-w-0 flex-1">
          <p className={undone ? 'text-ui text-ink-muted' : 'text-ui text-ink'}>
            {entry.href && !undone ? (
              // Block, with a 44px hit area centred on it: a one-line
              // sentence is otherwise a 16px press target on a phone.
              <Link
                href={entry.href}
                // ui-ok: the hit area is the 44px touch minimum, not a control height
                className="relative block hover:text-accent before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']"
              >
                {entry.sentence}
              </Link>
            ) : (
              entry.sentence
            )}
          </p>
          {/* The time sits on this quiet line, so the sentence has the row's
              width: in Home's rail (plan #1627) the row is narrow at every
              screen size. */}
          <p className="text-small text-ink-muted">
            <span className="tabular">{time}</span>
            {entry.from && (
              <>
                <span aria-hidden>{' · '}</span>
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
            <Undo2 className="size-3.5" strokeWidth={1.75} aria-hidden />
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
            <Undo2 className="size-3.5" strokeWidth={1.75} aria-hidden />
            {pending ? 'Undoing…' : 'Undo'}
          </Button>
        )}
      </div>
    </li>
  );
}
