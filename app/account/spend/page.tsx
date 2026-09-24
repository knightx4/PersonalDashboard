import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadMainCheck } from '@/lib/shell/main-check';
import { switcherCounts } from '@/lib/modules/switcher-counts';
import { AppShell } from '@/components/shell/app-shell';
import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { formatMicroDollars, todayInTimezone } from '@/lib/money';
import { loadSpend } from '@/lib/core/spend/load';
import { TranscriptCredits } from '@/components/learn/transcript-credits';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadUsage, type Usage } from '@/lib/learn/youtube/load';
import {
  monthStart,
  rollUp,
  sinceLocalDate,
  tokensOf,
  totalOf,
  type SpendGroup,
  type SpendRow,
  type SpendTotal,
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
 * alone sends you back to a query.
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

function Total({ label, total }: { label: string; total: SpendTotal }) {
  return (
    <div className={cardVariants({ padding: 'dense' })}>
      <p className="text-ui text-ink-muted">{label}</p>
      <p className="mt-1 text-heading text-ink tabular-nums">
        {total.calls === 0 ? '—' : formatMicroDollars(total.micros)}
      </p>
      <p className="mt-0.5 text-small text-ink-muted">
        {total.calls === 0
          ? 'nothing yet'
          : `${total.calls} ${total.calls === 1 ? 'call' : 'calls'}${
              total.unpriced > 0
                ? ` · ${total.unpriced} not priced, so the total is short by them`
                : ''
            }`}
      </p>
    </div>
  );
}

function GroupRow({ group }: { group: SpendGroup }) {
  return (
    <li className="flex items-baseline justify-between gap-3 px-4 py-2.5">
      <span className="min-w-0">
        <span className="block text-ui text-ink">
          {group.module} · {group.operation}
        </span>
        <span className="block text-small text-ink-muted">
          {group.calls} {group.calls === 1 ? 'call' : 'calls'} · {formatTokens(group.tokens)} tokens
          {group.unpriced > 0 ? ` · ${group.unpriced} not priced` : ''}
        </span>
      </span>
      <span className="shrink-0 text-ui text-ink tabular-nums">
        {formatMicroDollars(group.micros)}
      </span>
    </li>
  );
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
          {row.cachedInputTokens > 0
            ? ` (${formatTokens(row.cachedInputTokens)} cached)`
            : ''}
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
  const user = await requireUser();
  const [settings, counts, raised, mainCheck, owner] = await Promise.all([
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
    loadRaisedNotifications(user.id),
    loadMainCheck(),
    isOwner({ user }),
  ]);

  const supabase = await createCoreClient();
  const rows = await loadSpend(supabase);
  // TranscriptAPI is billed in credits, not per token, so it is not a row in
  // model_spend. The owner, whose key it is, sees the month's credits here too.
  const transcripts: Usage | null = owner ? await loadUsage(await createLearnClient()) : null;

  const timezone = settings.timezone;
  const localDateOf = (instant: string) => todayInTimezone(timezone, new Date(instant));
  const thisMonth = sinceLocalDate(rows, monthStart(todayInTimezone(timezone)), localDateOf);

  const groups = rollUp(rows);
  const recent = rows.slice(0, 50);

  return (
    <div className="min-h-full">
      <AppShell
        account={user.id}
        module={null}
        sections={[]}
        displayName={settings.displayName}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
        isOwner={owner}
        counts={switcherCounts(counts)}
        theme={settings.theme}
        notifications={raised}
        mainCheck={mainCheck}
      >
        <div className="mx-auto max-w-3xl">
          <p className="mb-3">
            <Link
              href="/account"
              className="inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
            >
              <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
              Account
            </Link>
          </p>

          <PageHeader
            title="Spend"
            description="What the models have cost, per call, since this was switched on."
          />

          {transcripts && (transcripts.credits.used > 0 || transcripts.queue.fetched > 0) && (
            <div className="mb-6">
              <TranscriptCredits usage={transcripts} />
            </div>
          )}

          {rows.length === 0 ? (
            <p
              className={cn(
                cardVariants(),
                'border-dashed px-4 py-6 text-center text-body text-ink-muted',
              )}
            >
              Nothing has been spent yet. Every model call this app makes lands here — what it was
              doing, which model ran, and what it cost.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Total label="This month" total={totalOf(thisMonth)} />
                <Total label="All time" total={totalOf(rows)} />
              </div>

              <h2 className="mt-6 mb-2 text-ui font-semibold text-ink-muted">
                Where it goes
              </h2>
              <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
                {groups.map((group) => (
                  <GroupRow key={`${group.module}-${group.operation}`} group={group} />
                ))}
              </ul>

              <h2 className="mt-6 mb-2 text-ui font-semibold text-ink-muted">
                The last {recent.length === 1 ? 'call' : `${recent.length} calls`}
              </h2>
              <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
                {recent.map((row) => (
                  <CallRow key={row.id} row={row} timezone={timezone} />
                ))}
              </ul>
            </>
          )}
        </div>
      </AppShell>
    </div>
  );
}
