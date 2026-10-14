'use client';

import type { ReactNode } from 'react';
import { whenDay, whenTime } from '@/lib/core/when';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import Link, { linkVariants } from '@/components/ui/link';
import { StatusGlyph } from '@/components/ui/status-glyph';
import type { StatusGlyph as GlyphName } from '@/lib/status-glyphs';

/**
 * A line of things that happened, newest first.
 *
 * Each entry is a mark on a thin line with its time, a title, and optionally a
 * body, a link and one action such as Undo. Where more than a day separates two
 * entries the line carries a label saying how long ("3 days earlier"), so a quiet
 * week reads as a quiet week instead of two rows that look adjacent.
 *
 * The marks are the status hexagons (components/ui/status-glyph.tsx) in the
 * tones the dev pages already use, so a kind is readable with the colour taken
 * away. `kind` names what happened; which hexagon and tone it gets is in KINDS
 * below and nowhere else.
 *
 * Motion: each entry fades up once on mount. The `timeline-in` utility in
 * app/globals.css is dropped under prefers-reduced-motion by the block there,
 * and `motion-reduce:animate-none` says so again on the element, so the list
 * is simply present for a person who asked for that.
 *
 * Times are drawn in 12-hour form, under the title, in `timeZone` (default UTC, so the server and the browser
 * draw the same text). Pass the person's own zone wherever the page has it.
 */

export type TimelineKind =
  | 'done'
  | 'started'
  | 'waiting'
  | 'blocked'
  | 'dropped'
  | 'question'
  | 'note';

const KINDS: Record<TimelineKind, { glyph: GlyphName; tone: string; word: string }> = {
  done: { glyph: 'check', tone: 'text-positive', word: 'Done' },
  started: { glyph: 'three-quarters', tone: 'text-accent', word: 'Started' },
  waiting: { glyph: 'dashed', tone: 'text-ink-muted', word: 'Waiting' },
  blocked: { glyph: 'bar', tone: 'text-caution', word: 'Blocked' },
  dropped: { glyph: 'slash', tone: 'text-ink-ghost', word: 'Dropped' },
  question: { glyph: 'question', tone: 'text-status-submitted', word: 'Question' },
  note: { glyph: 'empty', tone: 'text-ink-muted', word: 'Note' },
};

export type TimelineEntry = {
  /** Stable key for the row. */
  id: string;
  /** When it happened: a Date or an ISO string. */
  time: Date | string;
  kind: TimelineKind;
  /** The time is a day and nothing finer: the row shows the date and no clock. */
  dayOnly?: boolean;
  title: string;
  body?: string;
  /** Whose words the body is, so the person's and Dash's panels look different. */
  voice?: 'you' | 'dash';
  /** Anything else the row carries, drawn under the body and above the link: a mark, a picture, a button. */
  children?: ReactNode;
  link?: { href: string; label: string };
  /** One press on the row, such as Undo. */
  action?: { label: string; onSelect: () => void; disabled?: boolean };
};

const DAY_MS = 24 * 60 * 60 * 1000;

function ms(time: Date | string): number {
  return (time instanceof Date ? time : new Date(time)).getTime();
}

/**
 * The label for a gap, or null when no more than a day separates the two.
 * Exported for the tests and for a caller that draws its own line.
 */
export function gapLabel(newer: Date | string, older: Date | string): string | null {
  const span = ms(newer) - ms(older);
  if (!(span > DAY_MS)) return null;
  const days = Math.floor(span / DAY_MS);
  if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'} earlier`;
  const weeks = Math.floor(days / 7);
  if (days < 60) return `${weeks} weeks earlier`;
  const months = Math.floor(days / 30);
  return `${months} months earlier`;
}

/** The row's day as when.ts says it ("Today", "Monday", "4 Oct") and its time. */
function parts(time: Date | string, timeZone: string) {
  return { day: whenDay(time, { timeZone }), clock: whenTime(time, { timeZone }) };
}

export function Timeline({
  entries,
  timeZone = 'UTC',
  empty = 'Nothing has happened yet.',
  className,
}: {
  entries: readonly TimelineEntry[];
  timeZone?: string;
  /** Shown when there are no entries. */
  empty?: string;
  className?: string;
}) {
  if (entries.length === 0) {
    return <p className={cn('text-small text-ink-muted', className)}>{empty}</p>;
  }
  const sorted = [...entries].sort((a, b) => ms(b.time) - ms(a.time));

  return (
    <ol className={cn('m-0 list-none p-0', className)}>
      {sorted.map((entry, i) => {
        const kind = KINDS[entry.kind];
        const next = sorted[i + 1];
        const gap = next ? gapLabel(entry.time, next.time) : null;
        const here = parts(entry.time, timeZone);
        const above = i > 0 ? parts(sorted[i - 1].time, timeZone) : null;
        const sameDay = above && above.day === here.day;
        const when = entry.dayOnly ? here.day : sameDay ? here.clock : `${here.day}, ${here.clock}`;
        const isLast = i === sorted.length - 1;
        const external = entry.link ? !entry.link.href.startsWith('/') : false;

        return (
          <li key={entry.id} className="motion-reduce:animate-none timeline-in">
            <div className="flex gap-3">
              <div className="flex w-5 shrink-0 flex-col items-center">
                <span className={cn('mt-0.5 flex h-5 items-center', kind.tone)}>
                  <StatusGlyph glyph={kind.glyph} size={16} label={kind.word} />
                </span>
                {!isLast && <span aria-hidden className="mt-1 w-px flex-1 bg-border" />}
              </div>
              <div className={cn('min-w-0 flex-1', gap ? 'pb-2' : isLast ? '' : 'pb-4')}>
                <p className="text-ui font-medium text-ink">{entry.title}</p>
                {/* The time shares a line with the link and the action, so a short entry is two lines, not three. */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small">
                  <time
                    dateTime={(entry.time instanceof Date
                      ? entry.time
                      : new Date(entry.time)
                    ).toISOString()}
                    className="tabular text-small text-ink-muted"
                  >
                    {when}
                  </time>
                  {entry.link &&
                    (external ? (
                      <a
                        href={entry.link.href}
                        target="_blank"
                        rel="noreferrer"
                        className={cn(linkVariants({ tone: 'quiet' }), 'press-area')}
                      >
                        {entry.link.label}
                      </a>
                    ) : (
                      <Link
                        href={entry.link.href}
                        className={cn(linkVariants({ tone: 'quiet' }), 'press-area')}
                      >
                        {entry.link.label}
                      </Link>
                    ))}
                  {entry.action && (
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      disabled={entry.action.disabled}
                      onClick={entry.action.onSelect}
                    >
                      {entry.action.label}
                    </Button>
                  )}
                </div>
                {entry.body && (
                  <p
                    className={cn(
                      'mt-1.5 whitespace-pre-line rounded-control px-3 py-2 text-small text-ink-muted',
                      entry.voice === 'you'
                        ? 'border border-border bg-raised'
                        : entry.voice === 'dash'
                          ? 'border-l-2 border-accent bg-sunken'
                          : 'bg-sunken',
                    )}
                  >
                    {entry.body}
                  </p>
                )}
                {entry.children && <div className="mt-1">{entry.children}</div>}
              </div>
            </div>
            {gap && (
              <div className="flex gap-3" role="separator" aria-label={gap}>
                <div className="flex w-5 shrink-0 justify-center" aria-hidden>
                  <span className="w-px border-l border-dashed border-border" />
                </div>
                <p className="py-1.5 text-small italic text-ink-ghost">{gap}</p>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
