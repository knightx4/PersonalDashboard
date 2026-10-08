import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { SectionFold } from '@/components/ui/disclosure';
import { cn } from '@/lib/cn';
import { formatMicroDollars } from '@/lib/money';
import { isModuleId, moduleById } from '@/lib/modules';
import type { PageOpens } from '@/lib/usage/opens';
import { openedText, type FunctionSpend, type UsageGroup, type UsageReport } from '@/lib/usage/report';

/**
 * The Usage tab in Dev (plans #1482 and #1693). It opens on what each
 * function's model calls cost, from core.function_spend, biggest 30-day
 * spend first. Which pages are opened, from core.page_views, is folded
 * below: the pages not opened in 30 days, which the cut-back
 * (docs/CUT-BACK-SPEC.md) is decided from, and each workspace's opens.
 *
 * Apart from the route so a test can draw it from a fixture.
 */

const OUTSIDE = 'Outside a workspace';

/** The ledger's module as the app names it; `core` is the app as a whole. */
export function workspaceLabel(module: string): string {
  if (module === 'core') return OUTSIDE;
  return (isModuleId(module) && moduleById(module)?.label) || module;
}

/** Two decimals from a cent up, so 96 cents reads $0.96 rather than $0.9600. */
function spendText(micros: number): string {
  return formatMicroDollars(micros, { fromCent: true });
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function FunctionRow({ row }: { row: FunctionSpend }) {
  return (
    <li className="flex items-baseline justify-between gap-3 px-4 py-2.5">
      <span className="min-w-0">
        <span className="block truncate text-ui text-ink">{row.label}</span>
        <span className="block truncate text-small text-ink-muted">
          {workspaceLabel(row.workspace)}
          {row.unpriced30 > 0 && row.spend30 > 0 && ` · ${row.unpriced30} not priced`}
        </span>
      </span>
      <span className="shrink-0 text-right tabular-nums">
        {/* Every call unpriced: the cost is not known, which $0 would claim it is. */}
        {row.spend30 === 0 && row.unpriced30 > 0 ? (
          <span className="block text-ui text-ink-muted">not priced</span>
        ) : (
          <span className="block text-ui text-ink">{spendText(row.spend30)}</span>
        )}
        <span className="block text-small text-ink-muted">
          {row.spend7 > 0 ? `${spendText(row.spend7)} in 7 days` : 'nothing in 7 days'} ·{' '}
          {plural(row.calls30, 'call', 'calls')}
        </span>
      </span>
    </li>
  );
}

function FunctionList({ functions }: { functions: readonly FunctionSpend[] }) {
  if (functions.length === 0) {
    return (
      <p className={cn(cardVariants(), 'border-dashed px-4 py-6 text-center text-body text-ink-muted')}>
        No model calls in the last 30 days. Each function appears here, with what it cost, from its first call.
      </p>
    );
  }
  const total30 = functions.reduce((sum, row) => sum + row.spend30, 0);
  const total7 = functions.reduce((sum, row) => sum + row.spend7, 0);
  const calls = functions.reduce((sum, row) => sum + row.calls30, 0);
  const unpriced = functions.reduce((sum, row) => sum + row.unpriced30, 0);
  return (
    <>
      <p className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-small text-ink-muted">
        <span>
          <span className="text-body font-semibold text-ink tabular-nums">{spendText(total30)}</span> in
          30 days
        </span>
        <span className="tabular-nums">
          {total7 > 0 ? `${spendText(total7)} in 7 days` : 'nothing in 7 days'} · {plural(calls, 'call', 'calls')}
          {unpriced > 0 && `, ${unpriced} not priced`}
        </span>
      </p>
      <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {functions.map((row) => (
          <FunctionRow key={`${row.workspace}:${row.operation}`} row={row} />
        ))}
      </ul>
      <p className="mt-2 text-small text-ink-muted tabular-nums">{plural(functions.length, 'function', 'functions')}</p>
    </>
  );
}

function Counts({ opens7, opens30 }: { opens7: number; opens30: number }) {
  return (
    <span className="shrink-0 text-ui text-ink tabular-nums">
      {opens7} <span className="text-ink-muted">/ 7 days</span> · {opens30}{' '}
      <span className="text-ink-muted">/ 30 days</span>
    </span>
  );
}

function PageRow({ page, now, workspace }: { page: PageOpens; now: Date; workspace: string }) {
  return (
    <li className="px-4 py-2.5">
      <span className="block truncate font-mono text-ui text-ink">{page.route}</span>
      <span className="block truncate text-small text-ink-muted">
        {workspace} · last opened {openedText(page.lastOpened, now)}
      </span>
    </li>
  );
}

function GroupRow({ group }: { group: UsageGroup }) {
  const opened = group.pages.length;
  return (
    <li className="flex items-baseline justify-between gap-3 px-4 py-2.5">
      <span className="min-w-0">
        <span className="block truncate text-ui text-ink">{group.label}</span>
        <span className="block truncate text-small text-ink-muted">
          {plural(opened, 'page', 'pages')} opened
          {group.notOpened > 0 && ` · ${group.notOpened} not`}
        </span>
      </span>
      <Counts opens7={group.opens7} opens30={group.opens30} />
    </li>
  );
}

function PageOpensFold({ report, now }: { report: UsageReport; now: Date }) {
  const groups = report.groups.filter((group) => group.pages.length > 0 || group.notOpened > 0);
  const labels = new Map(groups.map((group) => [group.workspace, group.label]));
  const hint = report.anyOpens
    ? `${report.notOpened.length} not opened in 30 days`
    : 'nothing opened since recording started';
  return (
    <SectionFold title="Page opens" hint={hint} defaultOpen={false} className="mt-8">
      {!report.anyOpens && (
        <p className="text-small text-ink-muted">
          No page has been opened since recording started. Opens appear here from the next page you load.
        </p>
      )}
      {report.notOpened.length > 0 && (
        <section aria-labelledby="usage-not-opened">
          <h3 id="usage-not-opened" className="mb-2 text-ui font-semibold text-ink">
            Not opened in 30 days{' '}
            <span className="font-normal text-ink-muted tabular-nums">{report.notOpened.length}</span>
          </h3>
          <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
            {report.notOpened.map((page) => (
              <PageRow key={page.route} page={page} now={now} workspace={labels.get(page.workspace) ?? OUTSIDE} />
            ))}
          </ul>
        </section>
      )}
      {groups.length > 0 && report.anyOpens && (
        <section aria-labelledby="usage-by-workspace" className="mt-6">
          <h3 id="usage-by-workspace" className="mb-2 text-ui font-semibold text-ink">
            Opens by workspace
          </h3>
          <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
            {groups.map((group) => (
              <GroupRow key={`${group.workspace}-${group.label}`} group={group} />
            ))}
          </ul>
        </section>
      )}
    </SectionFold>
  );
}

export function UsageScreen({
  report,
  functions,
  now,
}: {
  report: UsageReport;
  functions: readonly FunctionSpend[];
  now: Date;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Usage" />
      <section aria-labelledby="usage-functions">
        <h2 id="usage-functions" className="sr-only">
          Spend by function
        </h2>
        <FunctionList functions={functions} />
      </section>
      <PageOpensFold report={report} now={now} />
    </div>
  );
}
