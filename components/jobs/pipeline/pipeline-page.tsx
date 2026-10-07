import Link from 'next/link';
import { KanbanSquare } from 'lucide-react';
import { PipelineBoard } from '@/components/jobs/pipeline/board';
import { PipelineFilters } from '@/components/jobs/pipeline/filters';
import { RolesTable } from '@/components/jobs/pipeline/table';
import { PipelineViewToggle } from '@/components/jobs/pipeline/view-toggle';
import { DisplayMenu } from '@/components/shell/display-menu';
import { GroupHeader } from '@/components/shell/group-header';
import { PageHeader } from '@/components/shell/page-header';
import { SearchEmpty } from '@/components/shell/search-empty';
import { SearchField } from '@/components/shell/search-field';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import type { PipelineRow } from '@/lib/jobs/applications/load';
import { APPLICATION_SOURCES, isLive, type ApplicationSource } from '@/lib/jobs/pipeline';
import { openApplications } from '@/lib/jobs/board-moment';
import {
  filterPipeline,
  pageOf,
  parsePipeline,
  pipelineDescription,
  pipelineHref,
  withoutPage,
  type PipelineParams,
} from '@/lib/jobs/pipeline-view';
import { rolesDisplay } from '@/lib/jobs/roles-display';
import {
  NO_GROUP,
  groupRows,
  listDisplayMenu,
  parseListDisplay,
  sortRows,
} from '@/lib/list-display';
import type { SavedView } from '@/lib/saved-views/store';

/**
 * The Pipeline page, drawn from rows already loaded (plan #1590).
 *
 * One page where there were two: the board and the table are views of it,
 * kept in the address, and both open on the live applications. The closed
 * ones are a status filter that takes you to the table, a page at a time.
 * One line of filters serves both views: status, source, excitement, fit and
 * chance. The page is one column, the list-and-detail pattern's list: the
 * header, the search and the filters, then the board or the table, then the
 * count.
 *
 * Here rather than in the page so the gallery can draw the whole page from
 * fixtures; the page itself only loads the rows and the saved views.
 */
export function PipelinePage({
  rows,
  params,
  savedViews = [],
  working = [],
  hasInbox = false,
}: {
  /** Every application, live and closed, with its fit and chance. */
  rows: readonly PipelineRow[];
  params: PipelineParams;
  savedViews?: readonly SavedView[];
  /** Refs an open Ask Dash hand-off is about (plan #1568). */
  working?: readonly string[];
  /** Whether an inbox is connected, which changes what the empty page suggests. */
  hasInbox?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <>
        <PageHeader title="Pipeline" />
        <EmptyState
          icon={KanbanSquare}
          title="Nothing in the pipeline yet"
          description={
            hasInbox
              ? 'Add a role by pasting a job link, or wait for the next inbox scan to find your confirmations.'
              : 'Add a role by pasting a job link, or capture one with the bookmarklet.'
          }
          action={{ label: 'Add a role', href: '/jobs/roles/new' }}
          secondaryAction={
            hasInbox
              ? { label: 'Inbox settings', href: '/jobs/settings' }
              : { label: 'Settings', href: '/jobs/settings' }
          }
        />
      </>
    );
  }

  const state = parsePipeline(params);
  const { scoped, filtered } = filterPipeline(rows, state);
  const liveCount = rows.filter((row) => isLive(row.status)).length;
  const href = (changes: Partial<Record<keyof PipelineParams, string | undefined>>) =>
    pipelineHref(params, changes);

  const displaySpec = rolesDisplay();
  // The table's sort, grouping and columns keep every filter but not the
  // page: page 4 of a different order is nobody's place in it.
  const listParams = { ...withoutPage(params), ...(state.view === 'table' ? { view: 'table' } : {}) };
  const menu = listDisplayMenu(displaySpec, listParams, savedViews);
  const display = parseListDisplay(displaySpec, listParams);

  const countsBySource = new Map<ApplicationSource, number>();
  for (const row of scoped) countsBySource.set(row.source, (countsBySource.get(row.source) ?? 0) + 1);
  const scored = rows.some((row) => row.scoreNote);

  const header = (
    <PageHeader
      title="Pipeline"
      actions={
        <>
          <PipelineViewToggle view={state.view} params={params} />
          {state.view === 'table' && <DisplayMenu menu={menu} />}
          <Link href="/jobs/roles/new" className={buttonVariants({ size: 'sm' })}>
            Add a role
          </Link>
        </>
      }
    />
  );

  const tools = (
    <div className="mb-4 space-y-2">
      <SearchField placeholder="Search company or role" />
      <PipelineFilters
        params={params}
        state={state}
        counts={{ live: liveCount, closed: rows.length - liveCount, all: rows.length }}
        sources={APPLICATION_SOURCES.filter((s) => countsBySource.has(s)).map(
          (source) => [source, countsBySource.get(source) ?? 0] as const,
        )}
        scored={scored}
      />
    </div>
  );

  const searchedOut = filtered.length === 0 && state.terms.length > 0;
  // The count, once, after the rows (the list-and-detail pattern).
  const count = pipelineDescription(state, filtered.length, scoped.length, params.q);

  if (state.view === 'board') {
    return (
      <>
        {header}
        {tools}
        {searchedOut ? (
          <SearchEmpty query={params.q ?? ''} />
        ) : (
          <>
            <PipelineBoard rows={filtered} openCount={openApplications(rows)} working={working} />
            <p className="tabular mt-3 text-small text-ink-muted">{count}</p>
          </>
        )}
      </>
    );
  }

  const paged = pageOf(sortRows(filtered, display), state.page);
  const sections = groupRows(paged.rows, display.groupBy);

  return (
    <>
      {header}
      {tools}
      {searchedOut ? (
        <SearchEmpty query={params.q ?? ''} />
      ) : filtered.length === 0 ? (
        <p className="text-ui text-ink-muted">No applications match these filters.</p>
      ) : (
        <div className="space-y-5">
          {sections.map((section) => (
            <div key={section.key} className="space-y-2">
              {display.group !== NO_GROUP && <GroupHeader label={section.label} count={section.count} />}
              <RolesTable rows={section.rows} sorts={menu.sorts} hidden={display.hidden} />
            </div>
          ))}
          <nav aria-label="Pages" className="flex items-center justify-between gap-3">
            <span className="tabular text-small text-ink-muted">
              {paged.pages > 1 ? `${paged.first}–${paged.last} · ${count}` : count}
            </span>
            {paged.pages > 1 && (
              <span className="flex gap-2">
                {paged.page > 1 && (
                  <Link
                    href={href({ page: String(paged.page - 1) })}
                    className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                  >
                    Previous
                  </Link>
                )}
                {paged.page < paged.pages && (
                  <Link
                    href={href({ page: String(paged.page + 1) })}
                    className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                  >
                    Next
                  </Link>
                )}
              </span>
            )}
          </nav>
        </div>
      )}
    </>
  );
}
