import Link from '@/components/ui/link';
import { ArrowDown, ArrowUp, Eye } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { money } from '@/lib/watch/format';
import { whenLabel } from '@/lib/shell/home-model';
import { StopWatchButton } from './stop-watch';
import {
  endsLabel,
  hearLabel,
  watchDirection,
  type WatchingRow,
} from '@/lib/shell/watching-model';

/**
 * The home page's Watching section (plan #1295): each watch Dash is running,
 * with the latest price, which way it has gone, when you will hear, when it
 * ends and the goal it serves. Its id is where every watch push opens
 * (WATCH_URL, lib/watch/format.ts). The page leaves it out when nothing is
 * running.
 */
export function WatchingSection({
  rows,
  now,
  timezone,
}: {
  rows: readonly WatchingRow[];
  now: Date;
  timezone: string;
}) {
  return (
    <Card id="watching" padding="standard" className="scroll-mt-bar">
      <h2 className="flex items-center gap-2 text-ui font-semibold text-ink">
        <Eye className="size-4 text-accent" strokeWidth={1.75} aria-hidden />
        Watching
      </h2>
      <ul className="mt-2 divide-y divide-border">
        {rows.map((row) => (
          <WatchRow key={row.id} row={row} now={now} timezone={timezone} />
        ))}
      </ul>
    </Card>
  );
}

/** The mark an Updates line from a watch carries, in place of a workspace's. */
export function WatchMark() {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-[6px] bg-accent-tint">
      <Eye className="size-3.5 text-accent" strokeWidth={1.75} aria-hidden />
    </span>
  );
}

function WatchRow({ row, now, timezone }: { row: WatchingRow; now: Date; timezone: string }) {
  const direction = watchDirection(row.first, row.latest, row.currency, row.readings);
  const hear = hearLabel(row);
  const checked = row.checkedAt ? whenLabel(row.checkedAt, now, timezone) : null;

  return (
    <li id={`watch-${row.id}`} className="py-3">
      <div
        className={cn(
          'flex items-start gap-3',
          // A watch that fired is the one thing here asking you to act.
          row.fired && '-mx-2 rounded-lg bg-positive-tint px-2 py-2',
        )}
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="press-area block text-ui font-medium text-ink hover:text-accent"
          >
            {row.title}
          </a>

          {row.fired && (
            <p className="text-small font-medium text-positive">
              {row.below !== null ? `Under ${money(row.below, row.currency)}` : 'Fired'} at{' '}
              {money(row.fired.value, row.currency)}, {lowerFirst(whenLabel(row.fired.at, now, timezone))}
            </p>
          )}

          {row.failing ? (
            <p className="text-small text-caution">
              The last check{checked ? `, ${lowerFirst(checked)},` : ''} could not read the page: {row.failing}
            </p>
          ) : (
            <p className="flex flex-wrap items-center gap-x-1.5 text-small text-ink-muted">
              {direction && (
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5',
                    direction.tone === 'down' && 'text-positive',
                  )}
                >
                  {direction.tone === 'down' && <ArrowDown className="size-3" aria-hidden />}
                  {direction.tone === 'up' && <ArrowUp className="size-3" aria-hidden />}
                  {direction.text}
                </span>
              )}
              {direction && checked && <span aria-hidden>·</span>}
              {checked ? <span>checked {lowerFirst(checked)}</span> : <span>No check yet</span>}
            </p>
          )}

          <p className="text-small text-ink-muted">
            {[hear, endsLabel(row.endsAt, now, timezone)].filter(Boolean).join(' · ')}
          </p>

          {row.goal && (
            <p className="text-small text-ink-muted">
              For{' '}
              <Link href={row.goal.href} className="font-medium text-accent hover:underline">
                {row.goal.title}
              </Link>
            </p>
          )}

          {row.report && (
            <p className="line-clamp-2 text-small text-ink-muted" title={row.report.title}>
              {row.report.body}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="tabular text-body font-semibold text-ink">
            {row.latest !== null ? money(row.latest, row.currency) : '--'}
          </span>
          <StopWatchButton id={row.id} />
        </div>
      </div>
    </li>
  );
}

function lowerFirst(text: string): string {
  // "3h ago" and "Yesterday" read mid-sentence; a weekday keeps its capital.
  return /^(Just|Yesterday)/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}
