import { sectionSubject } from '@/lib/core/section-path';
import { createCoreClient } from '@/lib/core/auth/server';
import { shellFor, type ShellFrame } from '@/lib/shell/shell-for';
import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { SpendOverview } from './spend-overview';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import { formatMicroDollars, todayInTimezone } from '@/lib/money';
import { readSpendPerDay, spendTotal, startOfLocalDay, usageWindow } from '@/lib/usage/per-day';
import { readFunctionSpend } from '@/lib/usage/function-spend';
import { SpendByModule } from './spend-by-module';
import { loadSpend } from '@/lib/core/spend/load';
import { compareEstimates, EVERY_OPERATION } from '@/lib/core/spend/comparison';
import { ESTIMATE_WINDOW_DAYS, loadCostRanges, MEASURED_MIN_RUNS } from '@/lib/core/spend/estimate';
import { EstimatesTable } from './estimates-table';
import { TranscriptCredits } from '@/components/learn/transcript-credits';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadUsage, type Usage } from '@/lib/learn/youtube/load';
import {
  byModule,
  monthStart,
  sumOf,
  tokensOf,
  type FunctionTotal,
  type SpendRow,
} from '@/lib/core/spend/summary';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Spend' };

/**
 * What the models have cost.
 *
 * Under the account rather than inside learn, on the rule the account page
 * states: if turning a module off would make a setting meaningless it belongs
 * to that module, and this survives every module being off. It is also about
 * to stop being a learn screen -- the job side extracts and drafts, shopping
 * reads receipts, and all of it lands in the same table.
 *
 * The rollup is the number you check a spec's estimate against; the rows are
 * what you read when the rollup surprises you. Both are here because either
 * alone sends you back to a query. The totals and the rollup are added up in
 * the database over the whole ledger, since it is tens of thousands of rows
 * and a capped read of the newest ones made "All time" smaller than the last
 * thirty days (note 7b696ccd).
 *
 * A call whose model had no published rate shows a blank cost and is counted
 * separately, never as $0.00. Zero is a claim, and this is the same rule the
 * share page follows for a price nobody checked.
 */

/** The number of tokens, written so a glance can compare two rows. */
function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

function CallRow({ row, timezone }: { row: SpendRow; timezone: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 px-4 py-2.5">
      <span className="min-w-0">
        <span className="block truncate text-ui text-ink">
          {row.module} · {row.operation}
        </span>
        <span className="block truncate text-small text-ink-muted">
          {todayInTimezone(timezone, new Date(row.createdAt))} · {row.model} ·{' '}
          {formatTokens(tokensOf(row))} tokens
          {row.cachedInputTokens > 0 ? ` (${formatTokens(row.cachedInputTokens)} cached)` : ''}
        </span>
      </span>
      <span className="shrink-0 text-ui text-ink tabular-nums">
        {/* Blank, not $0.00, when nobody could price it. */}
        {formatMicroDollars(row.costMicros)}
      </span>
    </li>
  );
}

export default async function SpendPage() {
  return shellFor({ module: null, children: spendContent });
}

/** How many of the latest calls the page lists one by one. */
const RECENT_CALLS = 50;

/** Before the ledger began, so a sum from here is the whole of it. */
const LEDGER_START = '1970-01-01T00:00:00.000Z';

async function spendContent({ user, settings, owner }: ShellFrame) {
  const supabase = await createCoreClient();
  const [rows, ranges] = await Promise.all([
    loadSpend(supabase, RECENT_CALLS),
    // One read of the ledger for every operation's thirty-day range: the same
    // figures the $ hints are drawn from. A failed read comes back empty, and
    // every row then shows its guess.
    loadCostRanges(supabase, user.id, EVERY_OPERATION),
  ]);
  const comparison = compareEstimates(ranges);
  const estimates = (
    <div className="mt-6">
      <EstimatesTable
        foreground={comparison.foreground}
        background={comparison.background}
        days={ESTIMATE_WINDOW_DAYS}
        minRuns={MEASURED_MIN_RUNS}
      />
    </div>
  );
  // TranscriptAPI is billed in credits, not per token, so it is not a row in
  // model_spend. The owner, whose key it is, sees the month's credits here too.
  const transcripts: Usage | null = owner ? await loadUsage(await createLearnClient()) : null;

  const timezone = settings.timezone;
  // The chart and the thirty-day card read the same whole local days, so the
  // bars add up to the amount beside them (plan #2036.3).
  const days = usageWindow(timezone);
  // The month is whole local days from the 1st, read the same way as the
  // chart; the functions are summed over the whole ledger, with this month's
  // share in the 7-day slot of the same read.
  const monthFrom = monthStart(days.today);
  const month = {
    today: days.today,
    span: Number(days.today.slice(8)),
    since: startOfLocalDay(monthFrom, timezone),
    since7: startOfLocalDay(monthFrom, timezone),
  };
  const [perDay, thisMonth, functions] =
    rows.length > 0
      ? await Promise.all([
          readSpendPerDay(supabase, timezone, days),
          readSpendPerDay(supabase, timezone, month),
          readFunctionSpend(supabase, { since7: month.since7, since: LEDGER_START }),
        ])
      : [null, null, []];

  const allFunctions: FunctionTotal[] = functions.map((fn) => ({
    module: fn.workspace,
    operation: fn.operation,
    calls: fn.calls30,
    micros: fn.spend30,
    unpriced: fn.unpriced30,
  }));
  const groups = byModule(allFunctions);

  return (
    <>

      <PageHeader
        subject={sectionSubject('/account', 'Account', { label: 'Spend', href: '/account/spend' })}
        title="Spend"
        description="What the models have cost, per call, since this was switched on."
      />

      {transcripts && (transcripts.credits.used > 0 || transcripts.queue.fetched > 0) && (
        <div className="mb-6">
          <TranscriptCredits usage={transcripts} />
        </div>
      )}

      {rows.length === 0 && (
        <>
          <EmptyState
            size="box"
            title="Nothing has been spent yet."
            description="Every model call this app makes lands here — what it was doing, which model ran, and what it cost."
          />
          {estimates}
        </>
      )}
      {rows.length > 0 && (
        <>
          <SpendOverview
            values={perDay?.values ?? []}
            today={days.today}
            span={days.span}
            last30={perDay ? spendTotal(perDay) : { calls: 0, micros: 0, unpriced: 0 }}
            thisMonth={thisMonth ? spendTotal(thisMonth) : { calls: 0, micros: 0, unpriced: 0 }}
            allTime={sumOf(allFunctions)}
          />

          <h2 className="mt-6 mb-2 text-ui font-semibold text-ink-muted">Where it goes</h2>
          <SpendByModule groups={groups} />

          {estimates}

          <h2 className="mt-6 mb-2 text-ui font-semibold text-ink-muted">
            The last {rows.length === 1 ? 'call' : `${rows.length} calls`}
          </h2>
          <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
            {rows.map((row) => (
              <CallRow key={row.id} row={row} timezone={timezone} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
