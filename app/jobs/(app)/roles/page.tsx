import Link from 'next/link';
import { Table2 } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { LeftRail, RailGroup, RailItem } from '@/components/jobs/shell/left-rail';
import { PageHeader } from '@/components/jobs/shell/page-header';
import { SearchField } from '@/components/jobs/shell/search-field';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
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

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
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

        <div className="min-w-0 flex-1 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-ink-faint">
                {SORTS.map((entry) => (
                  <th key={entry.id} className="px-2 py-2 font-semibold">
                    <Link
                      href={hrefFor({
                        sort: entry.id,
                        status: params.status,
                        source: params.source,
                        q: params.q,
                      })}
                      className={sort === entry.id ? 'text-brand' : 'hover:text-ink'}
                    >
                      {entry.label}
                    </Link>
                  </th>
                ))}
                <th className="px-2 py-2 font-semibold">Comp</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.applicationId}
                  className="border-b border-border transition-colors duration-150 hover:bg-surface"
                >
                  <td className="tabular px-2 py-1.5 text-ink-muted">
                    {shortAge(row.lastActivityAt)}
                  </td>
                  <td className="px-2 py-1.5">
                    <Link
                      href={`/jobs/companies/${row.companySlug}`}
                      className="text-ink-muted hover:text-brand"
                    >
                      {row.companyName}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">
                    <Link href={`/jobs/roles/${row.roleId}`} className="font-medium text-ink hover:text-brand">
                      {row.roleTitle}
                    </Link>
                    {row.attempt > 1 && (
                      <span className="tabular ml-1.5 text-[11px] text-ink-faint">
                        attempt {row.attempt}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="tabular px-2 py-1.5 text-ink-muted">
                    {formatDate(row.submittedAt)}
                  </td>
                  <td className="tabular px-2 py-1.5 text-ink-faint">
                    {row.excitement ? '★'.repeat(row.excitement) : '—'}
                  </td>
                  <td className="tabular px-2 py-1.5 text-ink-muted">
                    {formatCompBand(row.compMinCents, row.compMaxCents) ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
