import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SectionFold } from '@/components/ui/disclosure';
import { cn } from '@/lib/cn';
import { dueWords, isDue, type CheckBack } from '@/lib/plan/check-backs';
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
 */
export function CheckBacksPanel({ rows, now }: { rows: CheckBack[]; now: number }) {
  if (rows.length === 0) return null;

  return (
    <Card padding="dense">
      {/* Folds like every other section on the page (note 16a5d186), with
          the count on the closed line. */}
      <SectionFold title="Coming back to" count={rows.length}>
        <ul className="divide-y divide-border">
          {rows.map((row) => {
            const due = isDue(row, now);
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
                  {due ? 'Due' : dueWords(row.dueAt, now)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body break-words text-ink">{row.title}</p>
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
