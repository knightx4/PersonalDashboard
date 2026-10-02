import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { formatMicroDollars } from '@/lib/money';
import type { PageOpens } from '@/lib/usage/opens';
import { openedText, type UsageGroup, type UsageReport } from '@/lib/usage/report';

/**
 * The Usage tab in Dev (plan #1482): which pages are opened, from
 * core.page_views, and what each workspace's model calls cost, from
 * core.model_spend. The pages not opened in 30 days come first, since they
 * are what the cut-back (docs/CUT-BACK-SPEC.md) is decided from.
 *
 * Apart from the route so a test can draw it from a fixture.
 */

function Counts({ opens7, opens30 }: { opens7: number; opens30: number }) {
  return (
    <span className="shrink-0 text-ui text-ink tabular-nums">
      {opens7} <span className="text-ink-muted">/ 7 days</span> · {opens30}{' '}
      <span className="text-ink-muted">/ 30 days</span>
    </span>
  );
}

function PageRow({ page, now, showWorkspace }: { page: PageOpens; now: Date; showWorkspace?: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 px-4 py-2.5">
      <span className="min-w-0">
        <span className="block truncate font-mono text-ui text-ink">{page.route}</span>
        <span className="block truncate text-small text-ink-muted">
          {showWorkspace ? `${showWorkspace} · ` : ''}
          last opened {openedText(page.lastOpened, now)}
        </span>
      </span>
      {page.opens30 > 0 && <Counts opens7={page.opens7} opens30={page.opens30} />}
    </li>
  );
}

function spendLine(group: UsageGroup): string {
  if (!group.spend) return 'No model spend in 30 days';
  const { spend7, spend30, calls30, unpriced30 } = group.spend;
  return (
    `${formatMicroDollars(spend30)} spent in 30 days (${formatMicroDollars(spend7)} in 7) over ` +
    `${calls30} ${calls30 === 1 ? 'call' : 'calls'}` +
    (unpriced30 > 0 ? `, ${unpriced30} not priced` : '')
  );
}

function Group({ group, now }: { group: UsageGroup; now: Date }) {
  const id = `usage-${(group.workspace ?? group.label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="mt-6">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-ui font-semibold text-ink">
          {group.label}
        </h2>
        <Counts opens7={group.opens7} opens30={group.opens30} />
      </div>
      <p className="mb-2 text-small text-ink-muted">
        {spendLine(group)}
        {group.notOpened > 0 &&
          ` · ${group.notOpened} ${group.notOpened === 1 ? 'page' : 'pages'} not opened, listed above`}
      </p>
      {group.pages.length > 0 && (
        <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
          {group.pages.map((page) => (
            <PageRow key={page.route} page={page} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function UsageScreen({ report, now }: { report: UsageReport; now: Date }) {
  const labels = new Map(report.groups.map((group) => [group.workspace, group.label]));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Usage"
        description="How often each page was opened in the last 7 and 30 days, and what each workspace's model calls cost. Spend is per workspace: the ledger records which workspace a call was for, not which page."
      />

      {!report.anyOpens && (
        <p className={cn(cardVariants(), 'mb-6 border-dashed px-4 py-6 text-center text-body text-ink-muted')}>
          No page has been opened since recording started. Opens appear here from the next page you load.
        </p>
      )}

      {report.notOpened.length > 0 && (
        <section aria-labelledby="usage-not-opened">
          <h2 id="usage-not-opened" className="mb-2 text-ui font-semibold text-ink">
            Not opened in 30 days{' '}
            <span className="font-normal text-ink-muted tabular-nums">{report.notOpened.length}</span>
          </h2>
          <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
            {report.notOpened.map((page) => (
              <PageRow
                key={page.route}
                page={page}
                now={now}
                showWorkspace={labels.get(page.workspace) ?? 'Outside a workspace'}
              />
            ))}
          </ul>
        </section>
      )}

      {report.groups.map((group) => (
        <Group key={`${group.workspace}-${group.label}`} group={group} now={now} />
      ))}
    </div>
  );
}
