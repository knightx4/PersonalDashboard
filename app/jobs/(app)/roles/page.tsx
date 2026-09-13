import Link from 'next/link';
import { Table2 } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { SearchField } from '@/components/jobs/shell/search-field';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { matchesSearch, searchTerms } from '@/lib/jobs/search';
import { loadPipeline } from '@/lib/jobs/applications/load';
import {
  APPLICATION_SOURCES,
  APPLICATION_STATUSES,
  SOURCE_LABELS,
  type ApplicationStatus,
} from '@/lib/jobs/pipeline';
import { RolesTable, hrefFor } from './roles-table';
import { rolesDisplay } from '@/lib/jobs/roles-display';
import {
  groupRows,
  listDisplayMenu,
  NO_GROUP,
  parseListDisplay,
  sortRows,
} from '@/lib/list-display';
import { DisplayMenu } from '@/components/shell/display-menu';
import { GroupHeader } from '@/components/shell/group-header';

export const metadata = { title: 'Roles' };

/**
 * The same data as the board, as a sortable table.
 *
 * A kanban board stops being readable somewhere around forty items, and a real
 * search passes forty items. This is the view you live in after week three.
 */

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{
    sort?: string;
    status?: string;
    source?: string;
    q?: string;
    group?: string;
    hide?: string | string[];
  }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;

  const rows = await loadPipeline(supabase, user.id);

  const displaySpec = rolesDisplay();
  const display = parseListDisplay(displaySpec, params);
  const menu = listDisplayMenu(displaySpec, params);

  const status = APPLICATION_STATUSES.find((s) => s === params.status);
  const source = APPLICATION_SOURCES.find((s) => s === params.source);

  const terms = searchTerms(params.q);

  let filtered = rows;
  if (status) filtered = filtered.filter((row) => row.status === status);
  if (source) filtered = filtered.filter((row) => row.source === source);
  if (terms.length)
    filtered = filtered.filter((row) => matchesSearch([row.companyName, row.roleTitle], terms));
  const sections = groupRows(sortRows(filtered, display), display.groupBy);

  /** A filter link that keeps the arrangement: narrowing is not rearranging. */
  const railHref = (opts: { status?: string; source?: string }) =>
    hrefFor({
      q: params.q,
      sort: display.sort === displaySpec.defaultSort ? undefined : display.sort,
      group: display.group === NO_GROUP ? undefined : display.group,
      hide: display.hidden.length > 0 ? display.hidden.join(',') : undefined,
      ...opts,
    });

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
            <DisplayMenu menu={menu} />
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
              href={railHref({ source: params.source })}
              active={!status}
              count={rows.length}
            />
            {APPLICATION_STATUSES.filter((s) => statusCounts.has(s)).map((entry) => (
              <RailItem
                key={entry}
                label={entry.replace(/_/g, ' ')}
                href={railHref({ source: params.source, status: entry })}
                active={status === entry}
                count={statusCounts.get(entry)}
              />
            ))}
          </RailGroup>

          <RailGroup label="Source">
            <RailItem
              label="All"
              href={railHref({ status: params.status })}
              active={!source}
            />
            {APPLICATION_SOURCES.filter((s) => rows.some((r) => r.source === s)).map((entry) => (
              <RailItem
                key={entry}
                label={SOURCE_LABELS[entry]}
                href={railHref({ status: params.status, source: entry })}
                active={source === entry}
              />
            ))}
          </RailGroup>
        </LeftRail>

        <div className="min-w-0 flex-1 space-y-5">
          {sections.map((section) => (
            <div key={section.key} className="space-y-2">
              {display.group !== NO_GROUP && (
                <GroupHeader label={section.label} count={section.count} />
              )}
              <RolesTable rows={section.rows} sorts={menu.sorts} hidden={display.hidden} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
