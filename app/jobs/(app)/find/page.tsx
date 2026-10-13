import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { loadPipeline } from '@/lib/jobs/applications/load';
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
import { setupGaps } from '@/lib/jobs/suggest/gaps';
import { readMinFitScore } from '@/lib/jobs/suggest/fit-gate';
import { jevEnabledFor } from '@/lib/jev/enabled';
import { FindView } from './view';

export const metadata = { title: 'Find' };

// Search now on the recommended roles and on the people to meet runs a web
// search in this page's server actions, which can take a couple of minutes.
export const maxDuration = 300;

/**
 * Find: what the search is aiming at, and the roles, companies and people
 * Dash found that fit it (plan #1589).
 *
 * The target titles and the industries never to suggest lead the page. The
 * recommended roles, the startups discovery found (feature #1679) and the
 * people to meet follow. Find holds only what helps find the next job: the
 * career goals entries the searches read are written on Settings, and the
 * learning tracks once suggested from them are no longer offered here.
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
    goalEntries,
    discovered,
    discoveryRun,
    resume,
    jevOn,
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
      .select('target_titles, excluded_industries, min_fit_score')
      .eq('id', user.id)
      .single(),
    // Only counted: the setup list asks for a career goals entry until
    // there is one, and links to Settings where they are written.
    supabase.from('thoughts').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    // A failed read shows the section empty rather than failing the page.
    loadJobPreferences(supabase, user.id).then((prefs) => loadDiscoveredCompanies(supabase, user.id, prefs)).catch((error) => {
      console.error('[jobs find] discovered companies', error);
      return [];
    }),
    loadLatestDiscoveryRun(supabase, user.id),
    supabase
      .from('resume_versions')
      .select('id')
      .eq('user_id', user.id)
      .not('text_content', 'is', null)
      .limit(1)
      .maybeSingle(),
    jevEnabledFor(core, user.id),
  ]);

  const recommended = withPreferenceMisses(
    withOpeningNotes(openings, historyFromPipeline(pipeline)),
    preferences,
  );

  return (
    <>
      <PageHeader title="Find" />
      <FindView
        aim={{
          targetTitles: ((profile?.target_titles as string[] | null) ?? []).join(', '),
          excludedIndustries: ((profile?.excluded_industries as string[] | null) ?? []).join(', '),
          gaps: setupGaps({
            preferences,
            targetTitles: (profile?.target_titles as string[] | null) ?? [],
            goalEntries: goalEntries.count ?? 0,
            hasResume: !!resume.data,
            jevOn,
            minFitScore: readMinFitScore(profile?.min_fit_score),
          }),
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
      />
    </>
  );
}
