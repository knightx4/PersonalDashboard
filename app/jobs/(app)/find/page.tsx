import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { formatDate, loadPipeline } from '@/lib/jobs/applications/load';
import { loadLearningTracks } from '@/lib/jobs/learning/load';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadOperationCost } from '@/lib/core/spend/load';
import {
  loadJobPreferences,
  loadOpeningStats,
  loadOpenSuggestions,
  withPreferenceMisses,
} from '@/lib/jobs/suggest/load';
import { describeRun, loadLatestRun } from '@/lib/jobs/suggest/search-runs';
import { loadDiscoveredCompanies, loadLatestDiscoveryRun } from '@/lib/jobs/discover/watchlist-load';
import { describeDiscovery } from '@/lib/jobs/discover/watchlist-view';
import { otherParams, parseOpeningView } from '@/lib/jobs/suggest/opening-view';
import { historyFromPipeline, withOpeningNotes } from '@/lib/jobs/suggest/score-notes-load';
import { FindView } from './view';

export const metadata = { title: 'Find' };

// Search now on the recommended roles and on the people to meet runs a web
// search in this page's server actions, which can take a couple of minutes.
export const maxDuration = 300;

/**
 * Find: what the search is aiming at, and what Dash found that fits it
 * (plan #1589).
 *
 * The target titles and the industries never to suggest, which were in
 * Settings, lead the page. The recommended roles, which were above the Roles
 * table, the startups discovery found (feature #1679), and the people to
 * meet, which were above Contacts, follow. Career
 * goals, which was its own tab, closes it (decision #1585): the dated
 * entries (job_search.thoughts, 0026) and the learning tracks suggested from
 * them (job_search.learning_tracks, 0027). Goals reads the entries through
 * the sources catalogue, which links a row here.
 */
export default async function FindPage({
  searchParams,
}: {
  // The recommended roles' sort and filters (opening-view.ts).
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const core = await createCoreClient();
  const learn = await createLearnClient();
  const params = await searchParams;

  const [
    pipeline,
    openings,
    people,
    preferences,
    sourceStats,
    searchCost,
    latestRun,
    { data: profile },
    { data: thoughts },
    tracks,
    discovered,
    discoveryRun,
  ] = await Promise.all([
    loadPipeline(supabase, user.id),
    loadOpenSuggestions(supabase, user.id, 'apply'),
    loadOpenSuggestions(supabase, user.id, 'reach_out'),
    loadJobPreferences(supabase, user.id),
    loadOpeningStats(supabase, user.id),
    loadOperationCost(core, 'jobs', 'find-openings'),
    loadLatestRun(supabase, user.id, 'apply'),
    supabase
      .from('profiles')
      .select('timezone, target_titles, excluded_industries')
      .eq('id', user.id)
      .single(),
    supabase
      .from('thoughts')
      .select('id, body, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    // A failed read hides the section rather than failing the page.
    loadLearningTracks(supabase, learn, user.id).catch((error) => {
      console.error('[jobs find] learning tracks', error);
      return null;
    }),
    // A failed read shows the section empty rather than failing the page.
    loadJobPreferences(supabase, user.id).then((prefs) => loadDiscoveredCompanies(supabase, user.id, prefs)).catch((error) => {
      console.error('[jobs find] discovered companies', error);
      return [];
    }),
    loadLatestDiscoveryRun(supabase, user.id),
  ]);

  const recommended = withPreferenceMisses(
    withOpeningNotes(openings, historyFromPipeline(pipeline)),
    preferences,
  );
  const timezone = (profile?.timezone as string | null) ?? 'UTC';
  const entries = (thoughts ?? []) as Array<{
    id: string;
    body: string;
    created_at: string;
    updated_at: string;
  }>;

  return (
    <>
      <PageHeader title="Find" />
      <FindView
        aim={{
          targetTitles: ((profile?.target_titles as string[] | null) ?? []).join(', '),
          excludedIndustries: ((profile?.excluded_industries as string[] | null) ?? []).join(', '),
        }}
        roles={{
          suggestions: recommended,
          stats: sourceStats,
          searchCostMicros: searchCost,
          searchLine: describeRun(latestRun),
          view: parseOpeningView(params),
          keep: otherParams(params),
          pathname: '/jobs/find',
        }}
        companies={{ companies: discovered, status: describeDiscovery(discoveryRun) }}
        people={people}
        tracks={tracks}
        thoughts={entries.map((row) => ({
          id: row.id,
          body: row.body,
          written: formatDate(row.created_at, timezone),
          // A minute's grace, because the insert and its trigger stamp both
          // columns a few microseconds apart.
          edited:
            new Date(row.updated_at).getTime() - new Date(row.created_at).getTime() > 60_000
              ? formatDate(row.updated_at, timezone)
              : null,
        }))}
      />
    </>
  );
}
