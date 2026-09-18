import Link from 'next/link';
import { cn } from '@/lib/cn';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import { CompanyAvatar } from '@/components/jobs/ui/company-avatar';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCompBand, formatDate, shortAge, type PipelineRow } from '@/lib/jobs/applications/load';
import type { DisplayChoice } from '@/lib/list-display';

/**
 * The roles table, lifted out of the page so it can be photographed.
 *
 * Nothing about it changed on the way out. The page still loads, filters and
 * sorts; this is the half a person reads, and the preview gallery cannot
 * import a page whose first line opens a database connection.
 */

export function hrefFor(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const query = search.toString();
  return query ? `/jobs/roles?${query}` : '/jobs/roles';
}

export function RolesTable({
  rows,
  sorts,
  hidden = [],
}: {
  rows: PipelineRow[];
  /**
   * The sort links, already built. They come from the same place the Display
   * panel's do, so a column header and the panel cannot disagree about what is
   * sorted or drop the grouping on the way.
   */
  sorts: DisplayChoice[];
  /** Column ids turned off in the Display panel. Never the role title. */
  hidden?: readonly string[];
}) {
  const showing = (property: string) => !hidden.includes(property);

  return (
    <Table>
      <THead>
        <TR>
          {sorts
            .filter((entry) => showing(entry.id))
            .map((entry) => (
              <TH key={entry.id}>
                <Link
                  href={entry.href}
                  className={cn(
                    'transition-colors duration-150',
                    entry.chosen ? 'text-accent' : 'hover:text-ink',
                  )}
                >
                  {entry.label}
                </Link>
              </TH>
            ))}
          {/* Comp is a column without a sort, so it is not in the list above
              and gets its own header. */}
          {showing('comp') && <TH num>Comp</TH>}
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => (
          // The row goes to the role; the company is a second destination
          // and stays a link of its own in its cell.
          <TR key={row.applicationId} href={`/jobs/roles/${row.roleId}`}>
            <TD primary>
              {row.roleTitle}
              {row.attempt > 1 && (
                <span className="tabular ml-1.5 text-small font-normal text-ink-muted">
                  attempt {row.attempt}
                </span>
              )}
            </TD>
            {showing('company') && (
            <TD label="Company">
              {/* `relative z-over-link`: the primary cell's link stretches over the
                  whole row, so anything that is its own destination has to be
                  lifted out from under it. */}
              <Link
                href={`/jobs/companies/${row.companySlug}`}
                className="relative z-over-link flex items-center gap-2 text-ink-muted transition-colors duration-150 hover:text-accent max-md:justify-end"
              >
                <CompanyAvatar
                  company={{
                    name: row.companyName,
                    logoUrl: row.companyLogoUrl,
                    domains: row.companyDomains,
                    website: row.companyWebsite,
                  }}
                  className="size-5 rounded"
                  imageClassName="size-4"
                />
                <span className="truncate">{row.companyName}</span>
              </Link>
            </TD>
            )}
            {showing('status') && (
            <TD label="Status">
              <StatusBadge status={row.status} everSubmitted={row.submittedAt !== null} />
            </TD>
            )}
            {showing('activity') && (
            <TD label="Last activity" muted className="tabular">
              {shortAge(row.lastActivityAt)}
            </TD>
            )}
            {showing('applied') && (
            <TD label="Date applied" muted className="tabular">
              {formatDate(row.submittedAt)}
            </TD>
            )}
            {showing('excitement') && (
            <TD label="Excitement" muted className="tabular">
              {row.excitement ? '★'.repeat(row.excitement) : '—'}
            </TD>
            )}
            {showing('comp') && (
            <TD label="Comp" num muted>
              {formatCompBand(row.compMinCents, row.compMaxCents) ?? '—'}
            </TD>
            )}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
