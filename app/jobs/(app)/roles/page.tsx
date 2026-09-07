import Link from 'next/link';
import { Table2 } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { cn } from '@/lib/cn';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { SearchField } from '@/components/jobs/shell/search-field';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import { CompanyAvatar } from '@/components/jobs/ui/company-avatar';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { matchesSearch, searchTerms } from '@/lib/jobs/search';
import {
  formatCompBand,
  formatDate,
  loadPipeline,
  shortAge,
  type PipelineRow,
} from '@/lib/jobs/applications/load';
import {
  APPLICATION_SOURCES,
  APPLICATION_STATUSES,
  SOURCE_LABELS,
  type ApplicationStatus,
} from '@/lib/jobs/pipeline';

export const metadata = { title: 'Roles' };

/**
 * The same data as the board, as a sortable table.
 *
 * A kanban board stops being readable somewhere around forty items, and a real
 * search passes forty items. This is the view you live in after week three.
 */

type SortKey = 'activity' | 'company' | 'title' | 'status' | 'applied' | 'excitement';

const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: 'activity', label: 'Last activity' },
  { id: 'company', label: 'Company' },
  { id: 'title', label: 'Role' },
  { id: 'status', label: 'Status' },
  { id: 'applied', label: 'Date applied' },
  { id: 'excitement', label: 'Excitement' },
];

function sortRows(rows: PipelineRow[], key: SortKey): PipelineRow[] {
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

function hrefFor(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const query = search.toString();
  return query ? `/jobs/roles?${query}` : '/jobs/roles';
}

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; status?: string; source?: string; q?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;

  const rows = await loadPipeline(supabase, user.id);

  const sort = (SORTS.find((s) => s.id === params.sort)?.id ?? 'activity') as SortKey;
  const status = APPLICATION_STATUSES.find((s) => s === params.status);
  const source = APPLICATION_SOURCES.find((s) => s === params.source);

  const terms = searchTerms(params.q);

  let filtered = rows;
  if (status) filtered = filtered.filter((row) => row.status === status);
  if (source) filtered = filtered.filter((row) => row.source === source);
  if (terms.length)
    filtered = filtered.filter((row) => matchesSearch([row.companyName, row.roleTitle], terms));
  filtered = sortRows(filtered, sort);

  const statusCounts = new Map<ApplicationStatus, number>();
  for (const row of rows) statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);

  if (rows.length === 0) {
    return (
      <>
        <PageHeader title="Roles" description="Every role, as a table." />
        <EmptyState
          icon={Table2}
          title="No roles yet"
          description="Add one by pasting a job link, or connect Gmail and let the confirmations you already sent fill this in."
          action={{ label: 'Add a role', href: '/jobs/roles/new' }}
          secondaryAction={{ label: 'Connect Gmail', href: '/jobs/settings' }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Roles"
        description={`${filtered.length} of ${rows.length} shown.`}
        actions={
          <>
            <SearchField />
            <Link href="/jobs/roles/new" className={buttonVariants({ size: 'sm' })}>
              Add a role
            </Link>
          </>
        }
      />

      <div className="flex flex-col gap-4 xl:flex-row xl:gap-6">
        <LeftRail>
          <RailGroup label="Status">
            <RailItem
              label="All"
              href={hrefFor({ sort: params.sort, source: params.source, q: params.q })}
              active={!status}
              count={rows.length}
            />
            {APPLICATION_STATUSES.filter((s) => statusCounts.has(s)).map((entry) => (
              <RailItem
                key={entry}
                label={entry.replace(/_/g, ' ')}
                href={hrefFor({
                  sort: params.sort,
                  source: params.source,
                  status: entry,
                  q: params.q,
                })}
                active={status === entry}
                count={statusCounts.get(entry)}
              />
            ))}
          </RailGroup>

          <RailGroup label="Source">
            <RailItem
              label="All"
              href={hrefFor({ sort: params.sort, status: params.status, q: params.q })}
              active={!source}
            />
            {APPLICATION_SOURCES.filter((s) => rows.some((r) => r.source === s)).map((entry) => (
              <RailItem
                key={entry}
                label={SOURCE_LABELS[entry]}
                href={hrefFor({
                  sort: params.sort,
                  status: params.status,
                  source: entry,
                  q: params.q,
                })}
                active={source === entry}
              />
            ))}
          </RailGroup>
        </LeftRail>

        <div className="min-w-0 flex-1">
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
              {filtered.map((row) => (
                // The row goes to the role; the company is a second destination
                // and stays a link of its own in its cell.
                <TR key={row.applicationId} href={`/jobs/roles/${row.roleId}`}>
                  <TD label="Last activity" muted className="tabular">
                    {shortAge(row.lastActivityAt)}
                  </TD>
                  <TD label="Company">
                    {/* `relative z-10`: the primary cell's link stretches over the
                        whole row, and this cell comes before it in the DOM, so
                        without a stacking position the row link would sit on top. */}
                    <Link
                      href={`/jobs/companies/${row.companySlug}`}
                      className="relative z-10 flex items-center gap-2 text-ink-muted transition-colors duration-150 hover:text-accent max-md:justify-end"
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
                  <TD primary>
                    {row.roleTitle}
                    {row.attempt > 1 && (
                      <span className="tabular ml-1.5 text-small font-normal text-ink-muted">
                        attempt {row.attempt}
                      </span>
                    )}
                  </TD>
                  <TD label="Status">
                    <StatusBadge status={row.status} everSubmitted={row.submittedAt !== null} />
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
        </div>
      </div>
    </>
  );
}
