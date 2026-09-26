import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { dueWords, isDue, type CheckBack } from '@/lib/plan/check-backs';
import { dropCheckBack } from './check-back-actions';

/**
 * What Dash has said it will come back to (supabase/migrations/0103).
 *
 * Under the status panel, because it answers the same question from the
 * other side: that panel says what is running now, this says what is set to
 * run later. Due ones first, and each says whether the tick will wake a
 * session for it or it waits for one to run anyway. Nothing is rendered when
 * nothing is waiting (law 1).
 *
 * `now` is passed in, so the page reads the clock once and the list agrees
 * with itself.
 */
export function CheckBacksPanel({ rows, now }: { rows: CheckBack[]; now: number }) {
  if (rows.length === 0) return null;

  return (
    <Card padding="none">
      <h2 className="card-pad-x pt-(--card-p) text-ui font-semibold text-ink">Coming back to</h2>
      <ul className="divide-y divide-border">
        {rows.map((row) => {
          const due = isDue(row, now);
          return (
            <li key={row.id} className="card-pad-x row-pad">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 text-body font-medium break-words text-ink">{row.title}</p>
                <span className={due ? 'text-small font-medium text-caution' : 'text-small text-ink-muted'}>
                  Due {dueWords(row.dueAt, now)}
                </span>
              </div>
              {row.detail && <p className="mt-1 text-ui break-words text-ink-muted">{row.detail}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-small text-ink-muted">
                  {[
                    row.source ? `From ${row.source}` : null,
                    row.wokeAt
                      ? 'A session was woken for it'
                      : row.wake
                        ? 'Wakes a session an hour after it falls due'
                        : 'Waits for a session to run',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <form action={dropCheckBack} className="ml-auto">
                  <input type="hidden" name="id" value={row.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    Drop
                  </Button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
