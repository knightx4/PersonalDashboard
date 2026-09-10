import Link from 'next/link';
import { cn } from '@/lib/cn';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import { CompanyAvatar } from '@/components/jobs/ui/company-avatar';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCompBand, formatDate, shortAge, type PipelineRow } from '@/lib/jobs/applications/load';
import { APPLICATION_STATUSES } from '@/lib/jobs/pipeline';

/**
 * The roles table, lifted out of the page so it can be photographed.
 *
 * Nothing about it changed on the way out. The page still loads, filters and
 * sorts; this is the half a person reads, and the preview gallery cannot
 * import a page whose first line opens a database connection.
 */

export type SortKey = 'activity' | 'company' | 'title' | 'status' | 'applied' | 'excitement';

/**
 * The role first, then who it is with, then where it stands.
 *
 * It used to open on Last activity and Company, which put the role title --
 * the only cell that says which row this is -- third. That is survivable at
 * 1280px, where the eye takes the whole row at once. Stacked at 390px it is
 * not: every pursuit read "Last activity 3d / Company Marshall Wace / then"
 * the thing you were looking for, seven lines each, eleven of them down the
 * page. Sorting is unaffected -- every column is still a sort link, and the
 * default is still last activity.
 */
export const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: 'title', label: 'Role' },
  { id: 'company', label: 'Company' },
  { id: 'status', label: 'Status' },
  { id: 'activity', label: 'Last activity' },
  { id: 'applied', label: 'Date applied' },
  { id: 'excitement', label: 'Excitement' },
];

export function sortRows(rows: PipelineRow[], key: SortKey): PipelineRow[] {
  const sorted = [...rows];
  switch (key) {
    case 'company':
      return sorted.sort((a, b) => a.companyName.localeCompare(b.companyName));
    case 'title':
      return sorted.sort((a, b) => a.roleTitle.localeCompare(b.roleTitle));
    case 'status':
      return sorted.sort(
        (a, b) =>
          APPLICATION_STATUSES.indexOf(a.status) - APPLICATION_STATUSES.indexOf(b.status),
      );
    case 'applied':
      return sorted.sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));
    case 'excitement':
      return sorted.sort((a, b) => (b.excitement ?? 0) - (a.excitement ?? 0));
    default:
      return sorted.sort((a, b) =>
        (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''),
      );
  }
}

export function hrefFor(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const query = search.toString();
  return query ? `/jobs/roles?${query}` : '/jobs/roles';
}

export function RolesTable({
  rows,
  sort,
  params,
}: {
  rows: PipelineRow[];
  sort: SortKey;
  params: { status?: string; source?: string; q?: string };
}) {
  return (
    <Table>
      <THead>
        <TR>
          {SORTS.map((entry) => (
            <TH key={entry.id}>
              <Link
                href={hrefFor({
                  sort: entry.id,
                  status: params.status,
                  source: params.source,
                  q: params.q,
                })}
                className={cn(
                  'transition-colors duration-150',
                  sort === entry.id ? 'text-accent' : 'hover:text-ink',
                )}
              >
                {entry.label}
              </Link>
            </TH>
          ))}
          <TH num>Comp</TH>
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
            <TD label="Status">
              <StatusBadge status={row.status} everSubmitted={row.submittedAt !== null} />
            </TD>
            <TD label="Last activity" muted className="tabular">
              {shortAge(row.lastActivityAt)}
            </TD>
            <TD label="Date applied" muted className="tabular">
              {formatDate(row.submittedAt)}
            </TD>
            <TD label="Excitement" muted className="tabular">
              {row.excitement ? '★'.repeat(row.excitement) : '—'}
            </TD>
            <TD label="Comp" num muted>
              {formatCompBand(row.compMinCents, row.compMaxCents) ?? '—'}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
