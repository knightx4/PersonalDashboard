'use client';

import { StateLabel } from '@/components/dev/state-label';
import { cardVariants } from '@/components/ui/card';
import { Meter } from '@/components/ui/meter';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { featureHref } from '@/lib/plan/feature-page';
import {
  featureCount,
  featureHealthFacts,
  type FeatureGroup,
  type FeatureRow,
} from '@/lib/plan/feature-table';
import { healthOf as healthWordsOf } from '@/lib/plan/health-words';
import { PLAN_PRIORITY_LABEL } from '@/lib/plan/load';
import { isClaudes } from '@/lib/plan/tree';

/** Seven columns: the colSpan of a module's heading row. */
const COLUMNS = 7;

/** Who has a feature: you when you kept it, Dash once approved, nobody before. */
function whoOf(node: FeatureRow['node']): string {
  if (node.assignee === 'me') return 'You';
  return isClaudes(node) ? 'Dash' : '—';
}

function Health({ row, className }: { row: FeatureRow; className?: string }) {
  const health = healthWordsOf(row.health, featureHealthFacts(row.node));
  return (
    <StateLabel
      tone={health.tone}
      title={health.title}
      word={health.word}
      glyph={health.glyph}
      className={className}
    />
  );
}

function Percent({ row }: { row: FeatureRow }) {
  if (row.percent === null) return <span className="text-ink-ghost">—</span>;
  return <span className="tabular">{row.percent}%</span>;
}

/**
 * Every open feature, one to a row, grouped by module (plan #1669).
 *
 * The list half of list and detail: pressing a row opens the feature's own
 * page. On a phone a row keeps its title, its health and how far through it
 * is, on one line under the title, and the rest of the columns go; the
 * feature page has them.
 */
export function FeatureTable({ groups }: { groups: readonly FeatureGroup[] }) {
  const count = featureCount(groups);

  return (
    <div className="space-y-3">
      <div className={cn(cardVariants({ padding: 'none' }), 'overflow-hidden')}>
        <Table aria-label="Open features by module">
          <THead>
            <tr className="border-b border-border">
              <TH>Feature</TH>
              <TH>Health</TH>
              <TH>Priority</TH>
              <TH>Size</TH>
              <TH>Who</TH>
              <TH num>Open</TH>
              <TH num>Done</TH>
            </tr>
          </THead>
          {groups.map((group) => (
            <TBody key={group.module ?? 'app'} className="border-b border-border last:border-b-0">
              <tr className="bg-sunken max-md:block">
                <th
                  scope="colgroup"
                  colSpan={COLUMNS}
                  className="px-4 py-1.5 text-left text-small font-semibold text-ink max-md:block"
                >
                  {group.label}{' '}
                  <span className="tabular font-normal text-ink-muted">{group.rows.length}</span>
                </th>
              </tr>
              {group.rows.map((row) => (
                <TR key={row.node.id} href={featureHref(row.node.number)}>
                  <TD primary className="max-md:block max-md:[&>a]:block max-md:[&>a]:min-h-11">
                    <span className="mr-1.5 tabular font-normal text-ink-muted">
                      #{row.node.number}
                    </span>
                    {row.node.title}
                    {/* The phone's one line under the title: health and how
                        far through, which is what the dropped columns leave. */}
                    <span className="mt-1 flex items-center gap-3 text-small font-normal md:hidden">
                      <Health row={row} />
                      {row.percent !== null && (
                        <span className="tabular text-ink-muted">{row.percent}% done</span>
                      )}
                    </span>
                  </TD>
                  <TD className="whitespace-nowrap max-md:hidden">
                    <Health row={row} />
                  </TD>
                  <TD muted className="whitespace-nowrap max-md:hidden">
                    {PLAN_PRIORITY_LABEL[row.node.priority]}
                  </TD>
                  <TD muted className="max-md:hidden">
                    {row.node.size ? row.node.size.toUpperCase() : '—'}
                  </TD>
                  <TD muted className="max-md:hidden">
                    {whoOf(row.node)}
                  </TD>
                  <TD num muted className="max-md:hidden">
                    {row.openSteps}
                  </TD>
                  <TD num className="max-md:hidden">
                    <span className="inline-flex items-center justify-end gap-2">
                      {row.percent !== null && (
                        <Meter
                          value={row.percent}
                          max={100}
                          label={`#${row.node.number}: ${row.percent}% done`}
                          fill="bg-positive"
                          className="w-12"
                        />
                      )}
                      <Percent row={row} />
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          ))}
        </Table>
      </div>
      <p className="text-small text-ink-muted">
        <span className="tabular font-semibold text-ink">{count}</span> open{' '}
        {count === 1 ? 'feature' : 'features'} across{' '}
        <span className="tabular font-semibold text-ink">{groups.length}</span>{' '}
        {groups.length === 1 ? 'module' : 'modules'}
      </p>
    </div>
  );
}
