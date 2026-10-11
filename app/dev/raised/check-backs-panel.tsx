import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SectionFold } from '@/components/ui/disclosure';
import { cn } from '@/lib/cn';
import { featureHref } from '@/lib/plan/feature-page';
import {
  dueWords,
  isDue,
  type CheckBackStep,
  type PlacedCheckBack,
} from '@/lib/plan/check-backs';
import { dropCheckBack } from './check-back-actions';

/**
 * What Dash has said it will come back to (supabase/migrations/0103).
 *
 * Under the status panel, because it answers the same question from the
 * other side: that panel says what is running now, this says what is set to
 * run later. Due ones first, one line each: when, then what, with where it
 * came from and whether the tick will wake a session for it on hover. These
 * are Dash's promises rather than yours, so they get a line and not a card.
 * Nothing is rendered when nothing is waiting (law 1).
 *
 * `now` is passed in, so the page reads the clock once and the list agrees
 * with itself.
 *
 * Each one names the plan row it was set for, linked: on the Dash tab to the
 * row's page, which opens its feature's Steps tab at it, and on a feature's
 * Steps tab, through `hrefOf`, to the row a little way down the same page.
 *
 * `now` is 0 on a client page before its clock has ticked, and the line says
 * the due day until it has.
 */
export function CheckBacksPanel({
  rows,
  now,
  hrefOf = (step) => featureHref(step.number),
}: {
  rows: readonly PlacedCheckBack[];
  now: number;
  hrefOf?: (step: CheckBackStep) => string;
}) {
  if (rows.length === 0) return null;

  return (
    <Card padding="dense">
      {/* Folds like every other section on the page (note 16a5d186), with
          the count on the closed line. */}
      <SectionFold title="Coming back to" count={rows.length}>
        <ul className="divide-y divide-border">
          {rows.map((row) => {
            const due = now > 0 && isDue(row, now);
            // Where it came from and how it is picked up, on hover: the line
            // itself is when and what.
            const how = [
              row.source ? `From ${row.source}` : null,
              row.wokeAt
                ? 'A session was woken for it'
                : row.wake
                  ? 'Wakes a session an hour after it falls due'
                  : 'Waits for a session to run',
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={row.id} className="row-pad flex items-baseline gap-3" title={how}>
                <span
                  className={cn(
                    'tabular w-20 shrink-0 text-small',
                    due ? 'font-medium text-caution' : 'text-ink-muted',
                  )}
                >
                  {due ? 'Due' : now > 0 ? dueWords(row.dueAt, now) : dueDay(row.dueAt)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body break-words text-ink">{row.title}</p>
                  {row.step && (
                    <p className="truncate text-small text-ink-muted">
                      For{' '}
                      <Link
                        href={hrefOf(row.step)}
                        className="press-area text-ink underline underline-offset-2"
                      >
                        #{row.step.outline} {row.step.title}
                      </Link>
                    </p>
                  )}
                  {row.detail && (
                    <p className="truncate text-small text-ink-muted">{row.detail}</p>
                  )}
                </div>
                <form action={dropCheckBack} className="shrink-0">
                  <input type="hidden" name="id" value={row.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    Drop
                  </Button>
                </form>
              </li>
            );
          })}
        </ul>
      </SectionFold>
    </Card>
  );
}

/** "12 Oct": the due day, for the moment before a client page's clock has ticked. */
function dueDay(dueAt: string): string {
  return new Date(dueAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
