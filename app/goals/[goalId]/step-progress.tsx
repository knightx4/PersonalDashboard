import { Disclosure } from '@/components/ui/disclosure';
import { formatDay } from '@/lib/goals/dates';
import {
  entryAmount,
  loggedWhen,
  tallyLine,
  type ProgressEntry,
  type ProgressSummary,
} from '@/lib/goals/progress';

/**
 * Partial progress on the goal page (plan #1276): what the entries logged on
 * a step or on the goal add up to, when one was last logged, and the entries
 * themselves. Everything here is read from `summariseProgress`
 * (lib/goals/progress.ts); nothing on the step records that it is under way.
 */

/** The summaries of one page, and the day they are read against. */
export type PageProgress = {
  /** YYYY-MM-DD in the account's zone, so "2 days ago" needs no clock here. */
  today: string;
  /** By step or goal id; items with nothing on them or beneath them are absent. */
  byItem: Record<string, ProgressSummary>;
};

/** "Last logged 2 days ago", or null when nothing is logged on it or beneath it. */
export function lastLoggedLine(summary: ProgressSummary | undefined, today: string): string | null {
  if (!summary?.latestOn) return null;
  return `Last logged ${loggedWhen(summary.latestOn, today)}`;
}

/**
 * The step's row line, in the When column: its tally ("7 bags so far"), or
 * "Under way" when its entries gave no amount, and its due date after it.
 * It wraps rather than truncating, as a rhythm's count does.
 */
export function UnderWayCell({ summary, due }: { summary: ProgressSummary; due?: string | null }) {
  return (
    <span className="whitespace-normal text-ink-muted">
      {tallyLine(summary.tallies) ?? 'Under way'}
      {due && ` · Due ${formatDay(due)}`}
    </span>
  );
}

/** Each entry, newest first: the day, the words, the amount. */
export function ProgressEntries({ entries }: { entries: readonly ProgressEntry[] }) {
  return (
    <ul className="space-y-1">
      {entries.map((entry) => {
        const counted = entryAmount(entry);
        return (
          <li key={entry.id} className="flex gap-3 text-small">
            <span className="tabular w-14 shrink-0 text-ink-muted">
              {formatDay(entry.happenedOn)}
            </span>
            <span className="min-w-0 flex-1 text-ink">{entry.text}</span>
            {counted && <span className="tabular shrink-0 text-ink-muted">{counted}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The opened step's progress: "Under way · 7 bags so far · last logged
 * yesterday", then its entries. Nothing for a step with no entries of its
 * own; its meta line says when anything beneath it was last logged.
 */
export function StepProgress({ summary, today }: { summary: ProgressSummary; today: string }) {
  if (summary.count === 0) return null;
  const tally = tallyLine(summary.tallies);
  const head = [
    summary.underWay ? 'Under way' : null,
    tally,
    summary.lastOn ? `last logged ${loggedWhen(summary.lastOn, today)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="space-y-1.5 px-1">
      <p className="text-small font-semibold text-ink-muted">
        {head.charAt(0).toUpperCase() + head.slice(1)}
      </p>
      <ProgressEntries entries={summary.entries} />
    </div>
  );
}

/**
 * What was logged on the goal itself, folded the way finished steps fold,
 * with its tally as the fact that makes opening it a choice.
 */
export function GoalProgressLog({ summary, today }: { summary: ProgressSummary; today: string }) {
  if (summary.count === 0) return null;
  const tally = tallyLine(summary.tallies);
  const when = summary.lastOn ? loggedWhen(summary.lastOn, today) : null;
  return (
    <Disclosure
      title="Logged on the goal"
      meta={[tally, when].filter(Boolean).join(' · ') || summary.count}
    >
      <div className="pb-1.5">
        <ProgressEntries entries={summary.entries} />
      </div>
    </Disclosure>
  );
}
