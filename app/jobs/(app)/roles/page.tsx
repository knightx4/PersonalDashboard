import Link from 'next/link';
import { Table2 } from 'lucide-react';
import { redirect } from 'next/navigation';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { defaultViewHref, savedViewsFor } from '@/lib/saved-views/store';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { SearchField } from '@/components/shell/search-field';
import { SearchEmpty } from '@/components/shell/search-empty';
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
import {
  loadJobPreferences,
  loadOpeningStats,
  loadOpenSuggestions,
  withPreferenceMisses,
} from '@/lib/jobs/suggest/load';
import { loadOperationCost } from '@/lib/core/spend/load';
import { describeRun, loadLatestRun } from '@/lib/jobs/suggest/search-runs';
import { otherParams, parseOpeningView } from '@/lib/jobs/suggest/opening-view';
import { historyFromPipeline, withApplicationNotes, withOpeningNotes } from '@/lib/jobs/suggest/score-notes-load';
import { CHANCE_BAND_LABELS } from '@/lib/jobs/suggest/chance-check';
import { FIT_MINIMUMS, parseScoreMinimum, passesMinimum } from '@/lib/jobs/suggest/score-notes';
import { CHANCE_LABEL, FIT_SCORE_LABEL } from '@/lib/jobs/suggest/scores';
import { RecommendedRoles } from '../recommend/sections';

export const metadata = { title: 'Roles' };

// Search now on the recommended roles runs a web search in this page's server
// action, which can take a couple of minutes.
export const maxDuration = 300;

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
    minfit?: string;
    minchance?: string;
    // The recommended roles' own sort and filters (opening-view.ts).
    [key: `r${string}`]: string | string[] | undefined;
  }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;

  const core = await createCoreClient();
  const [pipeline, openings, preferences, sourceStats, searchCost, latestRun] = await Promise.all([
    loadPipeline(supabase, user.id),
    loadOpenSuggestions(supabase, user.id, 'apply'),
    loadJobPreferences(supabase, user.id),
    loadOpeningStats(supabase, user.id),
    loadOperationCost(core, 'jobs', 'find-openings'),
    loadLatestRun(supabase, user.id, 'apply'),
  ]);
  // Fit and chance with their reasons (plan #1206), read against the pipeline as history.
  const rows = await withApplicationNotes(supabase, user.id, pipeline);
  const recommended = withPreferenceMisses(withOpeningNotes(openings, historyFromPipeline(pipeline)), preferences);
  const recommendedProps = {
    suggestions: recommended,
    stats: sourceStats,
    searchCostMicros: searchCost,
    searchLine: describeRun(latestRun),
    view: parseOpeningView(params),
    keep: otherParams(params),
    pathname: '/jobs/roles',
  };

  const displaySpec = rolesDisplay();
  const display = parseListDisplay(displaySpec, params);
  const savedViews = await savedViewsFor(core, displaySpec.pathname);
  const openOn = defaultViewHref(savedViews, params);
  if (openOn) redirect(openOn);
  const menu = listDisplayMenu(displaySpec, params, savedViews);

  const status = APPLICATION_STATUSES.find((s) => s === params.status);
  const source = APPLICATION_SOURCES.find((s) => s === params.source);

  const terms = searchTerms(params.q);
  const minimum = parseScoreMinimum(params);

  let filtered = rows;
  if (status) filtered = filtered.filter((row) => row.status === status);
  if (source) filtered = filtered.filter((row) => row.source === source);
  // A row not scored passes, as an unscored opening passes the openings' filters.
  filtered = filtered.filter((row) => passesMinimum(row.scoreNote, minimum));
  if (terms.length)
    filtered = filtered.filter((row) => matchesSearch([row.companyName, row.roleTitle], terms));
  const sections = groupRows(sortRows(filtered, display), display.groupBy);

  /** A filter link that keeps the arrangement: narrowing is not rearranging. */
  const railHref = (opts: { status?: string; source?: string; minfit?: string; minchance?: string }) =>
    hrefFor({
      q: params.q,
      minfit: 'minfit' in opts ? opts.minfit : minimum.fit > 0 ? String(minimum.fit) : undefined,
      minchance: 'minchance' in opts ? opts.minchance : minimum.chance !== 'any' ? minimum.chance : undefined,
      sort: display.sort === displaySpec.defaultSort ? undefined : display.sort,
      group: display.group === NO_GROUP ? undefined : display.group,
      hide: display.hidden.length > 0 ? display.hidden.join(',') : undefined,
      ...opts,
    });

  const scored = rows.some((row) => row.scoreNote);

  const statusCounts = new Map<ApplicationStatus, number>();
  for (const row of rows) statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);

  if (rows.length === 0) {
    return (
      <>
        <PageHeader title="Roles" description="Every role, as a table." />
        <div className="mb-6">
          <RecommendedRoles {...recommendedProps} />
        </div>
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
            <Link href="/jobs/roles/new" className={buttonVariants({ size: 'sm' })}>
              Add a role
            </Link>
          </>
        }
      />

      {/* Above the table and its rail, full width: what Dash found is not
          narrowed by the filters, which describe roles already on file. */}
      <div className="mb-6">
        <RecommendedRoles {...recommendedProps} />
      </div>

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

          {scored && (
            <RailGroup label={FIT_SCORE_LABEL}>
              <RailItem
                label="Any"
                href={railHref({ status: params.status, source: params.source, minfit: undefined })}
                active={minimum.fit === 0}
              />
              {FIT_MINIMUMS.map((value) => (
                <RailItem
                  key={value}
                  label={`${value} and up`}
                  href={railHref({ status: params.status, source: params.source, minfit: String(value) })}
                  active={minimum.fit === value}
                />
              ))}
            </RailGroup>
          )}

          {scored && (
            <RailGroup label={CHANCE_LABEL}>
              <RailItem
                label="Any"
                href={railHref({ status: params.status, source: params.source, minchance: undefined })}
                active={minimum.chance === 'any'}
              />
              <RailItem
                label={`${CHANCE_BAND_LABELS.medium} or better`}
                href={railHref({ status: params.status, source: params.source, minchance: 'medium' })}
                active={minimum.chance === 'medium'}
              />
              <RailItem
                label={CHANCE_BAND_LABELS.high}
                href={railHref({ status: params.status, source: params.source, minchance: 'high' })}
                active={minimum.chance === 'high'}
              />
            </RailGroup>
          )}
        </LeftRail>

        <div className="min-w-0 flex-1 space-y-5">
          {/* Directly above the table it narrows, like every other list in the
              app. It sat in the header row beside Add a role until now. The
              status and source rails, the sort, the grouping and the hidden
              columns are all on the URL and the field carries them, so
              searching from a narrowed table stays narrowed. */}
          <SearchField placeholder="Search company or role" />

          {filtered.length === 0 && terms.length > 0 ? (
            <SearchEmpty query={params.q ?? ''} />
          ) : (
            sections.map((section) => (
              <div key={section.key} className="space-y-2">
                {display.group !== NO_GROUP && (
                  <GroupHeader label={section.label} count={section.count} />
                )}
                <RolesTable rows={section.rows} sorts={menu.sorts} hidden={display.hidden} />
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
